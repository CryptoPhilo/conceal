import type { Job } from "bullmq";
import type { EmailAnalysisJob } from "@shadow/shared";
import { getDb } from "../db.js";
import { decrypt } from "../lib/crypto.js";

// Subscription/newsletter detection patterns
const NEWSLETTER_PATTERNS = [
  /list-unsubscribe/i,
  /unsubscribe/i,
  /newsletter/i,
  /\bpromotion(s)?\b/i,
  /\bmarketing\b/i,
  /\bno.?reply@/i,
  /bulk/i,
  /precedence:\s*bulk/i,
];

const SUBSCRIPTION_FROM_PATTERNS = [
  /@newsletter\./i,
  /@marketing\./i,
  /@noreply\./i,
  /@no-reply\./i,
  /@updates?\./i,
  /@notifications?\./i,
  /@info\./i,
  /@hello\./i,
  /@team\./i,
  /@mail\./i,
];

interface EmailSummary {
  from: string;
  subject: string;
  date: string;
  headers?: Record<string, string>;
}

function classifyEmail(email: EmailSummary): "subscription" | "newsletter" | "normal" {
  const combined = `${email.from} ${email.subject} ${JSON.stringify(email.headers ?? {})}`.toLowerCase();

  if (NEWSLETTER_PATTERNS.some((p) => p.test(combined))) {
    return "newsletter";
  }
  if (SUBSCRIPTION_FROM_PATTERNS.some((p) => p.test(email.from))) {
    return "subscription";
  }
  return "normal";
}

async function fetchGmailEmails(
  accessToken: string,
  limit: number
): Promise<EmailSummary[]> {
  const results: EmailSummary[] = [];
  let pageToken: string | undefined;

  while (results.length < limit) {
    const params = new URLSearchParams({
      maxResults: String(Math.min(100, limit - results.length)),
      q: "in:inbox",
      ...(pageToken ? { pageToken } : {}),
    });

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!listRes.ok) break;

    const listData = (await listRes.json()) as {
      messages?: Array<{ id: string }>;
      nextPageToken?: string;
    };
    if (!listData.messages?.length) break;

    // Fetch metadata only (headers) — never read body
    await Promise.all(
      listData.messages.map(async (msg) => {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=List-Unsubscribe&metadataHeaders=Precedence`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!msgRes.ok) return;
        const msgData = (await msgRes.json()) as {
          payload?: { headers?: Array<{ name: string; value: string }> };
        };
        const headers: Record<string, string> = {};
        for (const h of msgData.payload?.headers ?? []) {
          headers[h.name.toLowerCase()] = h.value;
        }
        results.push({
          from: headers["from"] ?? "",
          subject: headers["subject"] ?? "",
          date: headers["date"] ?? "",
          headers,
        });
      })
    );

    pageToken = listData.nextPageToken;
    if (!pageToken) break;
  }

  return results;
}

async function fetchOutlookEmails(
  accessToken: string,
  limit: number
): Promise<EmailSummary[]> {
  const results: EmailSummary[] = [];
  let nextLink: string | undefined = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$select=from,subject,receivedDateTime,internetMessageHeaders&$top=50`;

  while (results.length < limit && nextLink) {
    const res = await fetch(nextLink, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) break;

    const data = (await res.json()) as {
      value?: Array<{
        from?: { emailAddress?: { address?: string } };
        subject?: string;
        receivedDateTime?: string;
        internetMessageHeaders?: Array<{ name: string; value: string }>;
      }>;
      "@odata.nextLink"?: string;
    };

    for (const msg of data.value ?? []) {
      const headers: Record<string, string> = {};
      for (const h of msg.internetMessageHeaders ?? []) {
        headers[h.name.toLowerCase()] = h.value;
      }
      results.push({
        from: msg.from?.emailAddress?.address ?? "",
        subject: msg.subject ?? "",
        date: msg.receivedDateTime ?? "",
        headers,
      });
      if (results.length >= limit) break;
    }

    nextLink = data["@odata.nextLink"];
  }

  return results;
}

export async function processEmailAnalysis(job: Job<EmailAnalysisJob>): Promise<void> {
  const { userId, connectedAccountId, provider, jobId, limit = 500 } = job.data;
  const sql = getDb();

  // Mark job as running
  await sql`
    UPDATE email_analysis_jobs
    SET status = 'running', started_at = now()
    WHERE id = ${jobId}
  `;

  try {
    const [account] = await sql<Array<{
      access_token_enc: string | null;
      status: string;
    }>>`
      SELECT access_token_enc, status
      FROM connected_accounts
      WHERE id = ${connectedAccountId} AND user_id = ${userId}
    `;

    if (!account || account.status !== "active") {
      throw new Error("account_not_active");
    }

    let emails: EmailSummary[] = [];

    if (provider === "gmail" && account.access_token_enc) {
      const accessToken = decrypt(account.access_token_enc);
      emails = await fetchGmailEmails(accessToken, limit);
    } else if (provider === "outlook" && account.access_token_enc) {
      const accessToken = decrypt(account.access_token_enc);
      emails = await fetchOutlookEmails(accessToken, limit);
    } else {
      // IMAP / Yahoo: heuristic analysis only based on what's possible without full protocol
      // For a real implementation, use an IMAP library (imapflow) in a separate subprocess
      // For now, mark as done with 0 scanned to signal no IMAP client available
    }

    let subscriptionsFound = 0;
    let newslettersFound = 0;

    for (const email of emails) {
      const kind = classifyEmail(email);
      if (kind === "subscription") subscriptionsFound++;
      if (kind === "newsletter") newslettersFound++;
    }

    // Update last_synced_at on the account
    await sql`
      UPDATE connected_accounts SET last_synced_at = now() WHERE id = ${connectedAccountId}
    `;

    await sql`
      UPDATE email_analysis_jobs
      SET
        status = 'done',
        emails_scanned = ${emails.length},
        subscriptions_found = ${subscriptionsFound},
        newsletters_found = ${newslettersFound},
        completed_at = now()
      WHERE id = ${jobId}
    `;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`
      UPDATE email_analysis_jobs
      SET status = 'error', error_message = ${message}, completed_at = now()
      WHERE id = ${jobId}
    `;
    throw err;
  }
}
