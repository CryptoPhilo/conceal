import type { FastifyInstance } from "fastify";

// Forwarding setup guides per provider
const FORWARDING_GUIDES: Record<string, {
  provider: string;
  displayName: string;
  forwardingAddress: string;
  steps: string[];
  settingsUrl: string;
  notes?: string;
}> = {
  gmail: {
    provider: "gmail",
    displayName: "Gmail",
    forwardingAddress: `forward@${process.env.MASKING_DOMAIN ?? "shadow.yourdomain.com"}`,
    settingsUrl: "https://mail.google.com/mail/u/0/#settings/fwdandpop",
    steps: [
      "Open Gmail Settings → See all settings → Forwarding and POP/IMAP",
      "Click 'Add a forwarding address' and enter the forwarding address below",
      "Check your Shadow inbox for the confirmation code from Google",
      "Enter the confirmation code in Gmail and click Proceed",
      "Select 'Forward a copy of incoming mail' and choose what to do with originals (Keep / Mark as read / Delete)",
      "Click Save Changes",
    ],
    notes:
      "Gmail forwards all incoming mail. Use server-side filters in Gmail to forward only specific categories (e.g. newsletters) for more targeted control.",
  },
  outlook: {
    provider: "outlook",
    displayName: "Outlook / Microsoft 365",
    forwardingAddress: `forward@${process.env.MASKING_DOMAIN ?? "shadow.yourdomain.com"}`,
    settingsUrl: "https://outlook.live.com/mail/options/mail/messageContent",
    steps: [
      "Go to Outlook Settings (gear icon) → View all Outlook settings",
      "Navigate to Mail → Forwarding",
      "Enable 'Enable forwarding' and enter the forwarding address below",
      "Optionally enable 'Keep a copy of forwarded messages'",
      "Click Save",
    ],
    notes:
      "Microsoft 365 business accounts may require an admin to enable external forwarding. Contact your IT department if the option is grayed out.",
  },
  yahoo: {
    provider: "yahoo",
    displayName: "Yahoo Mail",
    forwardingAddress: `forward@${process.env.MASKING_DOMAIN ?? "shadow.yourdomain.com"}`,
    settingsUrl: "https://mail.yahoo.com/d/settings/1",
    steps: [
      "Open Yahoo Mail Settings → More Settings → Mailboxes",
      "Select your Yahoo email address",
      "Scroll to 'Forwarding' and enter the forwarding address below",
      "Click Verify and follow the verification link in your inbox",
      "Return to Settings and enable forwarding",
    ],
  },
  icloud: {
    provider: "icloud",
    displayName: "iCloud Mail",
    forwardingAddress: `forward@${process.env.MASKING_DOMAIN ?? "shadow.yourdomain.com"}`,
    settingsUrl: "https://www.icloud.com/settings/",
    steps: [
      "Sign in to iCloud.com and open Mail",
      "Click the Settings gear → Preferences → General",
      "Check 'Forward my email to' and enter the forwarding address below",
      "Click Done",
    ],
  },
  protonmail: {
    provider: "protonmail",
    displayName: "Proton Mail",
    forwardingAddress: `forward@${process.env.MASKING_DOMAIN ?? "shadow.yourdomain.com"}`,
    settingsUrl: "https://mail.proton.me/u/0/mail/settings",
    steps: [
      "Open Proton Mail Settings → All settings → Email → Auto-forwarding (Proton Unlimited or Business plan required)",
      "Click 'Add forwarding rule'",
      "Enter the forwarding address and select which messages to forward",
      "Verify your ownership via the confirmation email sent to the forwarding address",
      "Enable the forwarding rule",
    ],
    notes:
      "Auto-forwarding in Proton Mail requires a paid plan. Free accounts can use IMAP connection instead via the 'Add email account' option.",
  },
};

// iOS MDM profile template for email account configuration
function buildIosMdmProfile(params: {
  emailAddress: string;
  displayName: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}): string {
  const uuid = randomUuid();
  const accountUuid = randomUuid();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>EmailAccountDescription</key>
      <string>${escapeXml(params.displayName)} via Shadow</string>
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
      <string>Configures IMAP email account</string>
      <key>PayloadDisplayName</key>
      <string>${escapeXml(params.displayName)}</string>
      <key>PayloadIdentifier</key>
      <string>com.shadow.email.${accountUuid}</string>
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
  <string>Shadow Email Configuration</string>
  <key>PayloadDisplayName</key>
  <string>Shadow Email Setup</string>
  <key>PayloadIdentifier</key>
  <string>com.shadow.email.profile.${uuid}</string>
  <key>PayloadOrganization</key>
  <string>Shadow</string>
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
      const guide = FORWARDING_GUIDES[provider.toLowerCase()];
      if (!guide) {
        return reply.status(404).send({
          error: "unsupported_provider",
          supported: Object.keys(FORWARDING_GUIDES),
        });
      }
      return guide;
    }
  );

  // List all available forwarding guides
  app.get(
    "/onboarding/forwarding-guides",
    { onRequest: [app.authenticate] },
    async () => {
      return Object.values(FORWARDING_GUIDES).map(({ provider, displayName, settingsUrl }) => ({
        provider,
        displayName,
        settingsUrl,
      }));
    }
  );

  // Generate iOS MDM profile for IMAP account setup
  // Query: emailAddress, displayName, imapHost, imapPort (opt), smtpHost, smtpPort (opt)
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

      const plist = buildIosMdmProfile({
        emailAddress,
        displayName,
        imapHost,
        imapPort: parseInt(qs.imapPort ?? "993", 10),
        smtpHost,
        smtpPort: parseInt(qs.smtpPort ?? "587", 10),
      });

      const filename = `shadow-email-${emailAddress.replace(/@/g, "_at_")}.mobileconfig`;
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
        setup_instructions: [
          "Open Gmail / Samsung Email / your preferred mail app on Android",
          "Add account → Other",
          "Enter your email address and tap Next",
          "Select IMAP",
          "Enter the incoming server settings below",
          "Enter the outgoing server settings below",
          "Follow any remaining prompts to complete setup",
        ],
      };

      const filename = `shadow-email-${emailAddress.replace(/@/g, "_at_")}.json`;
      reply.header("Content-Type", "application/json");
      reply.header("Content-Disposition", `attachment; filename="${filename}"`);
      return reply.send(config);
    }
  );
}
