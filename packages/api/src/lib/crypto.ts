import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_HEX = process.env.TOKEN_ENCRYPTION_KEY ?? "";

function getKey(): Buffer {
  if (KEY_HEX.length !== 64) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)");
  }
  return Buffer.from(KEY_HEX, "hex");
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv(12):tag(16):ciphertext — all hex
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(encoded: string): string {
  const key = getKey();
  const [ivHex, tagHex, cipherHex] = encoded.split(":");
  if (!ivHex || !tagHex || !cipherHex) throw new Error("invalid encrypted format");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(cipherHex, "hex");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ciphertext).toString("utf8") + decipher.final("utf8");
}
