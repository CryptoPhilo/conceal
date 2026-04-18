import type { SESEvent, SESHandler } from "aws-lambda";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { QUEUE_NAMES, type InboundEmailJob } from "@shadow/shared";
import { lookupMasking, getUserEmail, insertEmailLog } from "./db.js";
import { sha256 } from "./crypto.js";
import { sendBounce } from "./bounce.js";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
const S3_BUCKET = process.env.SES_BUCKET_NAME!;

let _queue: Queue<InboundEmailJob> | undefined;

function getQueue() {
  if (!_queue) {
    const redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
    _queue = new Queue<InboundEmailJob>(QUEUE_NAMES.INBOUND, { connection: redis });
  }
  return _queue;
}

export const handler: SESHandler = async (event: SESEvent) => {
  await Promise.all(event.Records.map(processRecord));
};

async function processRecord(record: SESEvent["Records"][number]) {
  const ses = record.ses;
  const mail = ses.mail;
  const receipt = ses.receipt;

  const messageId = mail.messageId;
  const recipients = receipt.recipients;
  const fromAddresses = mail.commonHeaders.from ?? [];
  const subject = mail.commonHeaders.subject ?? "";
  const toAddresses = mail.commonHeaders.to ?? [];
  const ccAddresses = mail.commonHeaders.cc ?? [];
  const rawS3Key = `emails/${messageId}`;

  await Promise.all(recipients.map((recipient) => routeRecipient(recipient, fromAddresses, subject, toAddresses, ccAddresses, messageId, rawS3Key)));

  await deleteFromS3(rawS3Key);
}

async function routeRecipient(
  maskingAddress: string,
  fromAddresses: string[],
  subject: string,
  toAddresses: string[],
  ccAddresses: string[],
  messageId: string,
  rawS3Key: string
) {
  const row = await lookupMasking(maskingAddress);
  const originalFrom = fromAddresses[0] ?? "unknown";

  if (!row || !row.active) {
    if (row && !row.active) {
      await insertEmailLog({
        userId: row.user_id,
        maskingAddressId: row.id,
        senderHash: sha256(originalFrom),
        subjectHash: sha256(subject),
        receivedAt: new Date(),
        actionTaken: "bounced",
      });
    }
    await sendBounce(maskingAddress, originalFrom);
    return;
  }

  const realEmail = await getUserEmail(row.user_id);
  if (!realEmail) {
    await sendBounce(maskingAddress, originalFrom);
    return;
  }

  const senderHash = sha256(originalFrom);
  const subjectHash = sha256(subject);
  const { domain: senderDomain, localPart: senderLocalPart } = extractSenderParts(originalFrom);

  await insertEmailLog({
    userId: row.user_id,
    maskingAddressId: row.id,
    senderHash,
    subjectHash,
    receivedAt: new Date(),
    actionTaken: "delivered",
    senderDomain,
  });

  const job: InboundEmailJob = {
    messageId,
    maskingAddress,
    realAddress: realEmail,
    userId: row.user_id,
    senderHash,
    subjectHash,
    senderDomain,
    senderLocalPart,
    subject,
    rawS3Key,
    receivedAt: new Date().toISOString(),
    toAddresses,
    ccAddresses,
  };

  await getQueue().add("inbound", job, {
    removeOnComplete: true,
    removeOnFail: 1000,
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  });
}

function extractSenderParts(fromHeader: string): { domain: string; localPart: string } {
  const match = fromHeader.match(/<([^>]+)>/) ?? fromHeader.match(/(\S+@\S+)/);
  const email = (match?.[1] ?? fromHeader).toLowerCase();
  const [localPart, domain] = email.split("@");
  return { domain: domain ?? "unknown", localPart: localPart ?? "unknown" };
}

async function deleteFromS3(key: string) {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  } catch {
    // S3 delete failure is non-fatal — TTL policy handles cleanup
  }
}
