import crypto from "crypto";

function getSecret(): Buffer {
  const secret = process.env.PAYMENT_SESSION_SECRET?.trim() || "";
  if (!secret) throw new Error("missing_payment_session_secret");
  // Derive fixed length key
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptPaymentSessionSecret(plaintext: string): string {
  const key = getSecret();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const tag = cipher.getAuthTag();
  // base64(iv).base64(tag).base64(ciphertext)
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decryptPaymentSessionSecret(payload: string): string {
  const key = getSecret();
  const [ivB64, tagB64, encB64] = String(payload || "").split(".");
  if (!ivB64 || !tagB64 || !encB64) throw new Error("bad_ciphertext");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const enc = Buffer.from(encB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

