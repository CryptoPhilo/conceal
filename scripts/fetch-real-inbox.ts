#!/usr/bin/env tsx
/**
 * Fetch entire Gmail inbox and save to JSONL for bulk pipeline testing.
 *
 * Usage:
 *   GMAIL_ACCESS_TOKEN=<token> npx tsx scripts/fetch-real-inbox.ts
 *   GMAIL_ACCESS_TOKEN=<token> npx tsx scripts/fetch-real-inbox.ts --output custom.jsonl
 *
 * Options (env vars):
 *   GMAIL_ACCESS_TOKEN   Required. A valid Gmail OAuth2 access token.
 *   GMAIL_REFRESH_TOKEN  Optional. Refresh token — used to get new access token if needed.
 *   GOOGLE_CLIENT_ID     Required when using refresh token.
 *   GOOGLE_CLIENT_SECRET Required when using refresh token.
 *
 * CLI flags:
 *   --output <path>  Output JSONL file path (default: inbox-raw.jsonl)
 *   --query <q>      Gmail search query (default: "in:inbox")
 */

import { writeFileSync, appendFileSync, existsSync, unlinkSync } from "node:fs";
import { parseArgs } from "node:util";

const BODY_PREVIEW_CHARS = 1000;

interface GmailMessage {
  id: string;
  from: string;
  subject: string;
  date: string;
  senderDomain: string;
  senderLocalPart: string;
  listUnsubscribe?: string;
  precedence?: string;
  bodyPreview?: string;
}

const { values: args } = parseArgs({
  options: {
    output: { type: "string", default: "inbox-raw.jsonl" },
    query: { type: "string", default: "in:inbox" },
  },
  strict: false,
});

const OUTPUT_FILE = args.output as string;
const GMAIL_QUERY = args.query as string;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(
      "GMAIL_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET required for token refresh"
    );
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

function extractBodyText(part: GmailPart): string {
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  if (part.parts) {
    for (const child of part.parts) {
      const text = extractBodyText(child);
      if (text) return text;
    }
  }
  return "";
}

function parseSender(fromHeader: string): { domain: string; localPart: string } {
  const emailMatch = fromHeader.match(/<([^>]+)>/) ?? fromHeader.match(/(\S+@\S+)/);
  const email = (emailMatch?.[1] ?? fromHeader).toLowerCase().trim();
  const atIdx = email.lastIndexOf("@");
  if (atIdx < 0) return { domain: email, localPart: "" };
  return {
    domain: email.slice(atIdx + 1).replace(/[>;\s].*$/, ""),
    localPart: email.slice(0, atIdx),
  };
}

async function fetchAllInbox(accessToken: string): Promise<GmailMessage[]> {
  const results: GmailMessage[] = [];
  let pageToken: string | undefined;
  let page = 0;

  process.stdout.write("Fetching message list");

  while (true) {
    const params = new URLSearchParams({ maxResults: "500", q: GMAIL_QUERY });
    if (pageToken) params.set("pageToken", pageToken);

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (listRes.status === 401) {
      throw new Error("Access token expired — provide GMAIL_REFRESH_TOKEN or a fresh access token");
    }
    if (!listRes.ok) {
      const err = await listRes.text();
      throw new Error(`Gmail list API error ${listRes.status}: ${err}`);
    }

    const listData = (await listRes.json()) as {
      messages?: Array<{ id: string }>;
      nextPageToken?: string;
      resultSizeEstimate?: number;
    };

    if (!listData.messages?.length) break;

    page++;
    process.stdout.write(` [p${page}: ${listData.messages.length} msgs]`);

    // Fetch metadata for this page in parallel (batches of 20)
    const BATCH = 20;
    for (let i = 0; i < listData.messages.length; i += BATCH) {
      const batch = listData.messages.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (msg) => {
          const msgRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!msgRes.ok) return;

          const msgData = (await msgRes.json()) as {
            payload?: {
              headers?: Array<{ name: string; value: string }>;
              mimeType?: string;
              body?: { data?: string };
              parts?: GmailPart[];
            };
          };
          const headers: Record<string, string> = {};
          for (const h of msgData.payload?.headers ?? []) {
            headers[h.name.toLowerCase()] = h.value;
          }

          const from = headers["from"] ?? "";
          const { domain, localPart } = parseSender(from);

          const rawBody = msgData.payload ? extractBodyText(msgData.payload as GmailPart) : "";
          const bodyPreview = rawBody.slice(0, BODY_PREVIEW_CHARS).trim() || undefined;

          const entry: GmailMessage = {
            id: msg.id,
            from,
            subject: headers["subject"] ?? "",
            date: headers["date"] ?? "",
            senderDomain: domain,
            senderLocalPart: localPart,
            ...(headers["list-unsubscribe"] ? { listUnsubscribe: headers["list-unsubscribe"] } : {}),
            ...(headers["precedence"] ? { precedence: headers["precedence"] } : {}),
            ...(bodyPreview ? { bodyPreview } : {}),
          };

          results.push(entry);
        })
      );
    }

    pageToken = listData.nextPageToken;
    if (!pageToken) break;
  }

  console.log("");
  return results;
}

async function main() {
  let accessToken = process.env.GMAIL_ACCESS_TOKEN;

  if (!accessToken) {
    if (process.env.GMAIL_REFRESH_TOKEN) {
      console.log("No access token — refreshing from GMAIL_REFRESH_TOKEN...");
      accessToken = await refreshAccessToken();
    } else {
      console.error(
        "Error: GMAIL_ACCESS_TOKEN (or GMAIL_REFRESH_TOKEN + credentials) is required"
      );
      process.exit(1);
    }
  }

  if (existsSync(OUTPUT_FILE)) {
    unlinkSync(OUTPUT_FILE);
  }

  console.log(`Fetching inbox from Gmail (query: "${GMAIL_QUERY}")...`);
  const messages = await fetchAllInbox(accessToken);

  for (const msg of messages) {
    appendFileSync(OUTPUT_FILE, JSON.stringify(msg) + "\n");
  }

  console.log(`\nDone. ${messages.length} messages written to ${OUTPUT_FILE}`);

  const domains = new Map<string, number>();
  for (const msg of messages) {
    domains.set(msg.senderDomain, (domains.get(msg.senderDomain) ?? 0) + 1);
  }
  const top10 = [...domains.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  console.log("\nTop 10 sender domains:");
  for (const [domain, count] of top10) {
    console.log(`  ${count.toString().padStart(4)}  ${domain}`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
