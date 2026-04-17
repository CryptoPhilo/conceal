import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import type { DeliveryJob } from "@shadow/shared";
import { loadDeliveryDestinations, markEmailDelivered } from "../db.js";

const DIGEST_TTL_SECONDS = 86400;

interface SlackConfig {
  webhookUrl: string;
}

interface NotionConfig {
  token: string;
  databaseId: string;
}

interface EmailDigestConfig {
  // no extra config needed beyond userId
  [key: string]: unknown;
}

type DestinationConfig = SlackConfig | NotionConfig | EmailDigestConfig;

async function deliverToSlack(
  config: SlackConfig,
  summary: string,
  priorityScore: number,
  job: Job<DeliveryJob>
): Promise<void> {
  try {
    const res = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `📧 ${summary}\nPriority: ${priorityScore}/100`,
        username: "Shadow Email",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      job.log(`[delivery] slack webhook returned ${res.status}`);
    }
  } catch (err) {
    job.log(`[delivery] slack delivery failed: ${String(err)}`);
  }
}

async function deliverToNotion(
  config: NotionConfig,
  summary: string,
  priorityScore: number,
  job: Job<DeliveryJob>
): Promise<void> {
  try {
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "Notion-Version": "2022-06-28",
      },
      body: JSON.stringify({
        parent: { database_id: config.databaseId },
        properties: {
          title: {
            title: [{ type: "text", text: { content: summary } }],
          },
          Priority: {
            number: priorityScore,
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      job.log(`[delivery] notion API returned ${res.status}`);
    }
  } catch (err) {
    job.log(`[delivery] notion delivery failed: ${String(err)}`);
  }
}

async function deliverToEmailDigest(
  redis: Redis,
  userId: string,
  summary: string,
  job: Job<DeliveryJob>
): Promise<void> {
  const key = `digest:${userId}`;
  try {
    await redis.rpush(key, JSON.stringify({ summary, ts: Date.now() }));
    await redis.expire(key, DIGEST_TTL_SECONDS);
  } catch (err) {
    job.log(`[delivery] email_digest redis push failed: ${String(err)}`);
  }
}

export async function processDelivery(
  job: Job<DeliveryJob>,
  redis: Redis
): Promise<void> {
  const data = job.data;

  job.log(
    `[delivery] processing — action=${data.brainAction} score=${data.priorityScore}`
  );

  let destinations: Array<{ id: string; type: string; configEnc: Record<string, unknown> }> = [];
  try {
    destinations = await loadDeliveryDestinations(data.userId);
  } catch (err) {
    job.log(`[delivery] warn: loadDeliveryDestinations failed: ${String(err)}`);
  }

  job.log(`[delivery] found ${destinations.length} active destination(s)`);

  for (const dest of destinations) {
    const cfg = dest.configEnc as DestinationConfig;

    switch (dest.type) {
      case "slack": {
        const slackCfg = cfg as SlackConfig;
        if (slackCfg.webhookUrl) {
          await deliverToSlack(slackCfg, data.summary, data.priorityScore, job);
          job.log(`[delivery] delivered to slack dest=${dest.id}`);
        } else {
          job.log(`[delivery] slack dest=${dest.id} missing webhookUrl — skipping`);
        }
        break;
      }
      case "notion": {
        const notionCfg = cfg as NotionConfig;
        if (notionCfg.token && notionCfg.databaseId) {
          await deliverToNotion(notionCfg, data.summary, data.priorityScore, job);
          job.log(`[delivery] delivered to notion dest=${dest.id}`);
        } else {
          job.log(`[delivery] notion dest=${dest.id} missing token/databaseId — skipping`);
        }
        break;
      }
      case "email_digest": {
        await deliverToEmailDigest(redis, data.userId, data.summary, job);
        job.log(`[delivery] pushed to email_digest digest:${data.userId}`);
        break;
      }
      default:
        job.log(`[delivery] unknown destination type=${dest.type} — skipping`);
    }
  }

  if (data.replyDraft) {
    job.log(
      `[delivery] reply draft available (SES wiring pending): "${data.replyDraft.slice(0, 80)}"`
    );
  }

  try {
    await markEmailDelivered(data.senderHash, data.subjectHash, data.userId);
  } catch (err) {
    job.log(`[delivery] warn: markEmailDelivered failed: ${String(err)}`);
  }

  job.log("[delivery] done");
}
