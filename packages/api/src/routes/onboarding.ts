import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";
import { t, tSteps } from "../lib/i18n.js";

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

export async function onboardingRoutes(app: FastifyInstance) {
  // Forwarding guide for a given email provider
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

  // List all available forwarding guides
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

  // Generate Android email account configuration (JSON format for setup apps)
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
        account: {
          displayName,
          emailAddress,
        },
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
