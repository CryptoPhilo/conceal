import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "../db.js";
import { encrypt } from "../lib/crypto.js";
import { t, tSteps } from "../lib/i18n.js";
import { Redis } from "ioredis";
import { Queue } from "bullmq";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const analysisQueue = new Queue("email-analysis", { connection: redis });

const MASKING_DOMAIN = process.env.MASKING_DOMAIN ?? "shadow.yourdomain.com";

const PROVIDER_KEYS = ["gmail", "outlook", "yahoo", "icloud", "protonmail"] as const;
type ProviderKey = (typeof PROVIDER_KEYS)[number];

const FORWARDING_URLS: Record<ProviderKey, string> = {
  gmail: "https://mail.google.com/mail/u/0/#settings/fwdandpop",
  outlook: "https://outlook.live.com/mail/options/mail/messageContent",
  yahoo: "https://mail.yahoo.com/d/settings/1",
  icloud: "https://www.icloud.com/settings/",
  protonmail: "https://mail.proton.me/u/0/mail/settings",
};

function getForwardingAddress(): string {
  return `forward@${MASKING_DOMAIN}`;
}

async function getUserLocale(userId: string): Promise<string> {
  try {
    const sql = getDb();
    const [row] = await sql<{ preferred_language: string }[]>`
      SELECT preferred_language FROM users WHERE id = ${userId} LIMIT 1
    `;
    return row?.preferred_language ?? "ko";
  } catch {
    return "ko";
  }
}

function buildGuide(provider: ProviderKey, locale: string) {
  const prefix = `forwarding.${provider}`;
  const forwardingAddress = getForwardingAddress();
  return {
    provider,
    displayName: t(`${prefix}.display_name`, locale),
    forwardingAddress,
    steps: tSteps(`${prefix}.steps`, locale),
    settingsUrl: FORWARDING_URLS[provider],
    ...(locale === "ko" || locale === "en"
      ? (() => {
          const notes = t(`${prefix}.notes`, locale);
          return notes !== `${prefix}.notes` ? { notes } : {};
        })()
      : {}),
  };
}

// iOS MDM profile template for email account configuration
function buildIosMdmProfile(params: {
  emailAddress: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  locale: string;
}): string {
  const uuid = randomUuid();
  const accountUuid = randomUuid();
  const accountDescription = `${escapeXml(params.displayName)} ${t("mdm.ios.account_description_suffix", params.locale)}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>EmailAccountDescription</key>
      <string>${accountDescription}</string>
      <key>EmailAccountName</key>
      <string>${escapeXml(params.displayName)}</string>
      <key>EmailAccountType</key>
      <string>EmailTypeIMAP</string>
      <key>EmailAddress</key>
      <string>${escapeXml(params.emailAddress)}</string>
      <key>IncomingMailServerHostName</key>
      <string>${escapeXml(params.imapHost)}</string>
      <key>IncomingMailServerPortNumber</key>
      <integer>${params.imapPort}</integer>
      <key>IncomingMailServerUseSSL</key>
      <true/>
      <key>IncomingMailServerUsername</key>
      <string>${escapeXml(params.emailAddress)}</string>
      <key>OutgoingMailServerHostName</key>
      <string>${escapeXml(params.smtpHost)}</string>
      <key>OutgoingMailServerPortNumber</key>
      <integer>${params.smtpPort}</integer>
      <key>OutgoingMailServerUseSSL</key>
      <true/>
      <key>OutgoingMailServerUsername</key>
      <string>${escapeXml(params.emailAddress)}</string>
      <key>PayloadDescription</key>
      <string>${t("mdm.ios.payload_description", params.locale)}</string>
      <key>PayloadDisplayName</key>
      <string>${escapeXml(params.displayName)}</string>
      <key>PayloadIdentifier</key>
      <string>com.conceal.email.${accountUuid}</string>
      <key>PayloadType</key>
      <string>com.apple.mail.managed</string>
      <key>PayloadUUID</key>
      <string>${accountUuid}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>SMIMEEnabled</key>
      <false/>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>${t("mdm.ios.profile_description", params.locale)}</string>
  <key>PayloadDisplayName</key>
  <string>${t("mdm.ios.profile_display_name", params.locale)}</string>
  <key>PayloadIdentifier</key>
  <string>com.conceal.email.profile.${uuid}</string>
  <key>PayloadOrganization</key>
  <string>${t("mdm.ios.organization", params.locale)}</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${uuid}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>`;
}

function randomUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Sanitize a string for use as an anycode.com local part
function sanitizeLocalPart(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 40) || "user";
}

const Step2Schema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("web_dashboard"),
    urgentAlertEmail: z.string().email().optional(),
  }),
  z.object({
    mode: z.literal("email_new"),
    localPart: z.string().min(1).max(40),
  }),
  z.object({
    mode: z.literal("email_existing"),
    emailAddress: z.string().email(),
  }),
]);

export async function onboardingRoutes(app: FastifyInstance) {
  // ── Step 0/1/2 onboarding flow ──────────────────────────────────────────────

  // GET /v1/onboarding/status — current onboarding state for the authenticated user
  app.get(
    "/onboarding/status",
    { onRequest: [app.authenticate] },
    async (req) => {
      const sql = getDb();
      const userId = (req.user as { sub: string }).sub;

      const [user] = await sql<Array<{
        email: string;
        onboarding_step: number;
        onboarding_completed_at: string | null;
      }>>`
        SELECT email, onboarding_step, onboarding_completed_at
        FROM users WHERE id = ${userId}
      `;

      const accounts = await sql<Array<{ count: string }>>`
        SELECT COUNT(*) AS count FROM connected_accounts WHERE user_id = ${userId}
      `;
      const destinations = await sql<Array<{ count: string }>>`
        SELECT COUNT(*) AS count FROM delivery_destinations WHERE user_id = ${userId}
      `;

      return {
        authEmail: user.email,
        onboardingStep: user.onboarding_step,
        onboardingCompleted: user.onboarding_completed_at !== null,
        connectedAccountCount: parseInt(accounts[0].count, 10),
        deliveryDestinationCount: parseInt(destinations[0].count, 10),
      };
    }
  );

  // POST /v1/onboarding/step0/accept — connect the Google auth email as a managed account
  // Called when user taps "네, 이 이메일로 시작할게요" (Step 0 primary CTA).
  // The OAuth tokens are NOT available here; this marks that the user wants Gmail
  // connected and returns the authorize URL so the frontend can redirect.
  app.post(
    "/onboarding/step0/accept",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const sql = getDb();
      const userId = (req.user as { sub: string }).sub;

      const [user] = await sql<Array<{ email: string }>>`
        SELECT email FROM users WHERE id = ${userId}
      `;

      // Advance onboarding step so the frontend knows to redirect back to step 2
      await sql`
        UPDATE users SET onboarding_step = 1 WHERE id = ${userId}
      `;

      // Return the Gmail OAuth redirect URL for the frontend to initiate connection
      const base = process.env.API_BASE_URL ?? "https://api.shadow.yourdomain.com";
      return {
        authEmail: user.email,
        nextAction: "oauth_connect",
        oauthUrl: `${base}/v1/oauth/gmail/authorize`,
      };
    }
  );

  // POST /v1/onboarding/step0/skip — user wants to connect a different email (go to Step 1)
  app.post(
    "/onboarding/step0/skip",
    { onRequest: [app.authenticate] },
    async (req) => {
      const sql = getDb();
      const userId = (req.user as { sub: string }).sub;
      await sql`UPDATE users SET onboarding_step = 1 WHERE id = ${userId}`;
      return { onboardingStep: 1 };
    }
  );

  // POST /v1/onboarding/step1/connect-imap — add a non-OAuth email account during onboarding
  // (OAuth path uses the existing /v1/oauth/:provider/authorize flow)
  const Step1ImapSchema = z.object({
    emailAddress: z.string().email(),
    imapHost: z.string().min(1),
    imapPort: z.number().int().min(1).max(65535).default(993),
    imapTls: z.boolean().default(true),
    smtpHost: z.string().min(1),
    smtpPort: z.number().int().min(1).max(65535).default(587),
    password: z.string().min(1),
  });

  app.post(
    "/onboarding/step1/connect-imap",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const sql = getDb();
      const userId = (req.user as { sub: string }).sub;
      const body = Step1ImapSchema.parse(req.body);

      const [existing] = await sql`
        SELECT id FROM connected_accounts
        WHERE user_id = ${userId} AND email_address = ${body.emailAddress}
      `;
      if (existing) {
        return reply.status(409).send({ error: "account_already_connected" });
      }

      const [row] = await sql<Array<{ id: string; provider: string; email_address: string; status: string; created_at: Date }>>`
        INSERT INTO connected_accounts
          (user_id, provider, email_address, access_token_enc,
           imap_host, imap_port, imap_tls, smtp_host, smtp_port)
        VALUES (
          ${userId}, 'imap', ${body.emailAddress}, ${encrypt(body.password)},
          ${body.imapHost}, ${body.imapPort}, ${body.imapTls},
          ${body.smtpHost}, ${body.smtpPort}
        )
        RETURNING id, provider, email_address, status, created_at
      `;

      await analysisQueue.add(
        "analyze",
        { userId, connectedAccountId: row.id, provider: "imap" },
        { attempts: 3, backoff: { type: "exponential", delay: 5000 } }
      );

      await sql`UPDATE users SET onboarding_step = 2 WHERE id = ${userId}`;

      return reply.status(201).send({ ...row, onboardingStep: 2 });
    }
  );

  // POST /v1/onboarding/step2/setup — choose how to receive summaries
  // mode: "web_dashboard" | "email_new" | "email_existing"
  app.post(
    "/onboarding/step2/setup",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const sql = getDb();
      const userId = (req.user as { sub: string }).sub;
      const body = Step2Schema.parse(req.body);

      // Remove any existing delivery destination from onboarding (idempotent re-setup)
      await sql`
        DELETE FROM delivery_destinations
        WHERE user_id = ${userId} AND type IN ('web_dashboard', 'email_digest')
      `;

      if (body.mode === "web_dashboard") {
        const config: Record<string, string> = {};
        if (body.urgentAlertEmail) config.urgentAlertEmail = body.urgentAlertEmail;

        const [row] = await sql<Array<{ id: string; type: string; active: boolean; created_at: Date }>>`
          INSERT INTO delivery_destinations (user_id, type, config_enc)
          VALUES (${userId}, 'web_dashboard', ${sql.json(config)})
          RETURNING id, type, active, created_at
        `;

        await sql`
          UPDATE users
          SET onboarding_step = 3, onboarding_completed_at = now()
          WHERE id = ${userId}
        `;

        return reply.status(201).send({
          destination: row,
          onboardingCompleted: true,
        });
      }

      if (body.mode === "email_new") {
        const localPart = sanitizeLocalPart(body.localPart);

        // Check availability
        const [taken] = await sql`
          SELECT id FROM anycode_addresses WHERE local_part = ${localPart}
        `;
        if (taken) {
          return reply.status(409).send({ error: "address_taken", localPart });
        }

        const [alias] = await sql<Array<{ address: string }>>`
          INSERT INTO anycode_addresses (user_id, local_part)
          VALUES (${userId}, ${localPart})
          RETURNING address
        `;

        const [row] = await sql<Array<{ id: string; type: string; active: boolean; created_at: Date }>>`
          INSERT INTO delivery_destinations (user_id, type, config_enc)
          VALUES (${userId}, 'email_digest', ${sql.json({ emailAddress: alias.address, source: "anycode" })})
          RETURNING id, type, active, created_at
        `;

        await sql`
          UPDATE users
          SET onboarding_step = 3, onboarding_completed_at = now()
          WHERE id = ${userId}
        `;

        return reply.status(201).send({
          destination: row,
          emailAddress: alias.address,
          onboardingCompleted: true,
        });
      }

      // email_existing
      const [row] = await sql<Array<{ id: string; type: string; active: boolean; created_at: Date }>>`
        INSERT INTO delivery_destinations (user_id, type, config_enc)
        VALUES (${userId}, 'email_digest', ${sql.json({ emailAddress: body.emailAddress, source: "existing" })})
        RETURNING id, type, active, created_at
      `;

      await sql`
        UPDATE users
        SET onboarding_step = 3, onboarding_completed_at = now()
        WHERE id = ${userId}
      `;

      return reply.status(201).send({
        destination: row,
        emailAddress: body.emailAddress,
        onboardingCompleted: true,
      });
    }
  );

  // GET /v1/onboarding/step2/check-address — check anycode.com address availability
  app.get<{ Querystring: { localPart: string } }>(
    "/onboarding/step2/check-address",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { localPart } = req.query;
      if (!localPart) return reply.status(400).send({ error: "missing_local_part" });

      const sql = getDb();
      const sanitized = sanitizeLocalPart(localPart);
      const [taken] = await sql`
        SELECT id FROM anycode_addresses WHERE local_part = ${sanitized}
      `;

      return {
        localPart: sanitized,
        address: `${sanitized}@anycode.com`,
        available: !taken,
      };
    }
  );

  // ── Legacy forwarding guides & mobile profiles ───────────────────────────────

  app.get<{ Params: { provider: string } }>(
    "/onboarding/forwarding-guide/:provider",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { provider } = req.params;
      if (!PROVIDER_KEYS.includes(provider.toLowerCase() as ProviderKey)) {
        return reply.status(404).send({
          error: "unsupported_provider",
          supported: [...PROVIDER_KEYS],
        });
      }
      const userId = (req.user as { sub: string }).sub;
      const locale = await getUserLocale(userId);
      return buildGuide(provider.toLowerCase() as ProviderKey, locale);
    }
  );

  app.get(
    "/onboarding/forwarding-guides",
    { onRequest: [app.authenticate] },
    async (req) => {
      const userId = (req.user as { sub: string }).sub;
      const locale = await getUserLocale(userId);
      return PROVIDER_KEYS.map(provider => ({
        provider,
        displayName: t(`forwarding.${provider}.display_name`, locale),
        settingsUrl: FORWARDING_URLS[provider],
      }));
    }
  );

  // Generate iOS MDM profile for IMAP account setup
  app.get(
    "/onboarding/mobile-profile/ios",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const qs = req.query as Record<string, string>;
      const emailAddress = qs.emailAddress ?? "";
      const displayName = qs.displayName ?? emailAddress;
      const imapHost = qs.imapHost ?? "";
      const smtpHost = qs.smtpHost ?? "";

      if (!emailAddress || !imapHost || !smtpHost) {
        return reply.status(400).send({
          error: "missing_params",
          required: ["emailAddress", "imapHost", "smtpHost"],
        });
      }

      const userId = (req.user as { sub: string }).sub;
      const locale = await getUserLocale(userId);

      const plist = buildIosMdmProfile({
        emailAddress,
        displayName,
        imapHost,
        imapPort: parseInt(qs.imapPort ?? "993", 10),
        smtpHost,
        smtpPort: parseInt(qs.smtpPort ?? "587", 10),
        locale,
      });

      const filename = `conceal-email-${emailAddress.replace(/@/g, "_at_")}.mobileconfig`;
      reply.header("Content-Type", "application/x-apple-aspen-config");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      return reply.send(plist);
    }
  );

  app.get(
    "/onboarding/mobile-profile/android",
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const qs = req.query as Record<string, string>;
      const emailAddress = qs.emailAddress ?? "";
      const displayName = qs.displayName ?? emailAddress;
      const imapHost = qs.imapHost ?? "";
      const smtpHost = qs.smtpHost ?? "";

      if (!emailAddress || !imapHost || !smtpHost) {
        return reply.status(400).send({
          error: "missing_params",
          required: ["emailAddress", "imapHost", "smtpHost"],
        });
      }

      const userId = (req.user as { sub: string }).sub;
      const locale = await getUserLocale(userId);

      const config = {
        account: { displayName, emailAddress },
        incomingServer: {
          protocol: "IMAP",
          host: imapHost,
          port: parseInt(qs.imapPort ?? "993", 10),
          security: "SSL_TLS",
          username: emailAddress,
        },
        outgoingServer: {
          protocol: "SMTP",
          host: smtpHost,
          port: parseInt(qs.smtpPort ?? "587", 10),
          security: "STARTTLS",
          username: emailAddress,
          requiresAuth: true,
        },
        setup_instructions: tSteps("android.setup.steps", locale),
      };

      const filename = `conceal-email-${emailAddress.replace(/@/g, "_at_")}.json`;
      reply.header("Content-Type", "application/json");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      return reply.send(config);
    }
  );
}
