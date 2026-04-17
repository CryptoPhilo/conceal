import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getDb } from "../db.js";
import { encrypt } from "../lib/crypto.js";
import { Redis } from "ioredis";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

const PROVIDERS = {
  gmail: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify",
    clientId: () => process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET ?? "",
  },
  outlook: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: "https://outlook.office.com/IMAP.AccessAsUser.All offline_access email openid",
    clientId: () => process.env.OUTLOOK_CLIENT_ID ?? "",
    clientSecret: () => process.env.OUTLOOK_CLIENT_SECRET ?? "",
  },
  yahoo: {
    authUrl: "https://api.login.yahoo.com/oauth2/request_auth",
    tokenUrl: "https://api.login.yahoo.com/oauth2/get_token",
    scopes: "mail-r openid",
    clientId: () => process.env.YAHOO_CLIENT_ID ?? "",
    clientSecret: () => process.env.YAHOO_CLIENT_SECRET ?? "",
  },
} as const;

type Provider = keyof typeof PROVIDERS;

function getRedirectUri(provider: string): string {
  const base = process.env.API_BASE_URL ?? "https://api.shadow.yourdomain.com";
  return `${base}/v1/oauth/callback?provider=${provider}`;
}

export async function oauthRoutes(app: FastifyInstance) {
  // Initiate OAuth flow — returns redirect URL
  app.get<{ Params: { provider: string } }>(
    "/oauth/:provider/authorize",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { provider } = req.params;
      if (!(provider in PROVIDERS)) {
        return reply.status(400).send({ error: "unsupported_provider", supported: Object.keys(PROVIDERS) });
      }
      const cfg = PROVIDERS[provider as Provider];
      const userId = (req.user as { sub: string }).sub;

      const state = randomBytes(16).toString("hex");
      // Store state → userId mapping in Redis with 10min TTL
      await redis.set(`oauth:state:${state}`, userId, "EX", 600);

      const params = new URLSearchParams({
        client_id: cfg.clientId(),
        redirect_uri: getRedirectUri(provider),
        response_type: "code",
        scope: cfg.scopes,
        state,
        access_type: provider === "gmail" ? "offline" : "",
        prompt: provider === "gmail" ? "consent" : "",
      });
      // Remove empty params
      for (const [k, v] of [...params.entries()]) {
        if (!v) params.delete(k);
      }

      return { redirect_url: `${cfg.authUrl}?${params.toString()}` };
    }
  );

  // OAuth callback — exchanges code for tokens
  app.get<{ Querystring: { code?: string; state?: string; provider?: string; error?: string } }>(
    "/oauth/callback",
    async (req, reply) => {
      const { code, state, provider, error } = req.query;

      if (error) {
        return reply.redirect(`${process.env.APP_BASE_URL ?? "https://app.shadow.yourdomain.com"}/onboarding?error=${error}`);
      }

      if (!code || !state || !provider || !(provider in PROVIDERS)) {
        return reply.status(400).send({ error: "invalid_callback" });
      }

      const userId = await redis.get(`oauth:state:${state}`);
      if (!userId) {
        return reply.status(400).send({ error: "invalid_or_expired_state" });
      }
      await redis.del(`oauth:state:${state}`);

      const cfg = PROVIDERS[provider as Provider];
      const tokenRes = await fetch(cfg.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId(),
          client_secret: cfg.clientSecret(),
          redirect_uri: getRedirectUri(provider),
          grant_type: "authorization_code",
        }).toString(),
      });

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        app.log.error({ provider, body }, "OAuth token exchange failed");
        return reply.status(502).send({ error: "token_exchange_failed" });
      }

      const tokens = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        id_token?: string;
        email?: string;
      };

      // Extract email address from the token response or userinfo
      let emailAddress = tokens.email ?? "";
      if (!emailAddress) {
        emailAddress = await fetchEmailFromProvider(provider as Provider, tokens.access_token);
      }

      const expiresAt = tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null;

      const sql = getDb();
      await sql`
        INSERT INTO connected_accounts
          (user_id, provider, email_address, access_token_enc, refresh_token_enc, token_expires_at)
        VALUES (
          ${userId}, ${provider}, ${emailAddress},
          ${encrypt(tokens.access_token)},
          ${tokens.refresh_token ? encrypt(tokens.refresh_token) : null},
          ${expiresAt}
        )
        ON CONFLICT (user_id, email_address)
        DO UPDATE SET
          access_token_enc  = EXCLUDED.access_token_enc,
          refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, connected_accounts.refresh_token_enc),
          token_expires_at  = EXCLUDED.token_expires_at,
          status            = 'active'
      `;

      return reply.redirect(
        `${process.env.APP_BASE_URL ?? "https://app.shadow.yourdomain.com"}/onboarding?step=2&provider=${provider}`
      );
    }
  );
}

async function fetchEmailFromProvider(provider: Provider, accessToken: string): Promise<string> {
  try {
    if (provider === "gmail") {
      const r = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await r.json()) as { email?: string };
      return data.email ?? "";
    }
    if (provider === "outlook") {
      const r = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await r.json()) as { mail?: string; userPrincipalName?: string };
      return data.mail ?? data.userPrincipalName ?? "";
    }
    if (provider === "yahoo") {
      const r = await fetch("https://api.login.yahoo.com/openid/v1/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await r.json()) as { email?: string };
      return data.email ?? "";
    }
  } catch {
    // Non-fatal: email address may already be set from tokens
  }
  return "";
}
