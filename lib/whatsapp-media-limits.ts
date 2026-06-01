/** Meta WhatsApp Cloud API — max asset size when sending image/video messages */
export const WHATSAPP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const WHATSAPP_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
/** דשבורד: העלאת תמונה (כיווץ אוטומטי לפני שליחה אם מעל 5MB) */
export const DASHBOARD_IMAGE_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

export function whatsappMediaMaxBytes(isVideo: boolean): number {
  return isVideo ? WHATSAPP_VIDEO_MAX_BYTES : WHATSAPP_IMAGE_MAX_BYTES;
}

export async function probePublicMediaBytes(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (!res.ok) return null;
    const len = res.headers.get("content-length");
    if (!len) return null;
    const n = Number.parseInt(len, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function isLikelyVideoFile(file: Pick<File, "type" | "name">): boolean {
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|mov|webm)$/i.test(file.name);
}

export function maxWhatsAppUploadBytesForFile(file: Pick<File, "type" | "name">): number {
  return whatsappMediaMaxBytes(isLikelyVideoFile(file));
}

export function dashboardMaxUploadBytesForFile(file: Pick<File, "type" | "name">): number {
  if (isLikelyVideoFile(file)) return WHATSAPP_VIDEO_MAX_BYTES;
  return DASHBOARD_IMAGE_UPLOAD_MAX_BYTES;
}
