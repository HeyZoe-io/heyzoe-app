import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

let unavailableLogged = false;

export function resetFieldEncryptionStateForTests(): void {
  unavailableLogged = false;
}

function logUnavailable(): void {
  if (unavailableLogged) return;
  unavailableLogged = true;
  console.error("[field_encryption_unavailable]");
}

/** 32-byte key, or null when the env var is missing or not 32 bytes. */
export function fieldEncryptionKey(): Buffer | null {
  const raw = process.env.FIELD_ENCRYPTION_KEY?.trim() ?? "";
  if (!raw) {
    logUnavailable();
    return null;
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_BYTES) {
    logUnavailable();
    return null;
  }
  return buf;
}

/** `v1:<iv_b64>:<tag_b64>:<ciphertext_b64>`. Null when the key is unavailable. */
export function encryptField(plaintext: string, aad: string): string | null {
  const key = fieldEncryptionKey();
  if (!key) return null;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_BYTES) return null;
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/** Null on a bad payload, wrong AAD, or tampered tag. Does not log. */
export function decryptField(payload: string, aad: string): string | null {
  const key = fieldEncryptionKey();
  if (!key) return null;
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const iv = Buffer.from(parts[1] ?? "", "base64");
  const tag = Buffer.from(parts[2] ?? "", "base64");
  const data = Buffer.from(parts[3] ?? "", "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || data.length === 0) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function fieldAad(column: string, rowId: string | number): string {
  return `businesses.${column}:${rowId}`;
}
