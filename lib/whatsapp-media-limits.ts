/** Meta WhatsApp Cloud API — max asset size when sending image/video/audio messages */
export const WHATSAPP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const WHATSAPP_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
/** הקלטה: אותו תקרה כמו סרטון. וואטסאפ מקבל MP3, M4A, AAC, OGG (Opus) ו-AMR. */
export const WHATSAPP_AUDIO_MAX_BYTES = 16 * 1024 * 1024;
/** Caption on an image or video message. Longer text must go out as a separate message. */
export const WHATSAPP_MEDIA_CAPTION_MAX_CHARS = 1024;
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

/** MIME שוואטסאפ מקבל להודעת אודיו. null = לא הקלטה נתמכת. */
export function whatsappAudioContentType(file: { type?: string; name?: string }): string | null {
  const name = String(file.name ?? "");
  const type = String(file.type ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (/\.mp3$/i.test(name) || type === "audio/mpeg" || type === "audio/mp3") return "audio/mpeg";
  if (/\.m4a$/i.test(name) || type === "audio/mp4" || type === "audio/x-m4a" || type === "audio/m4a") {
    return "audio/mp4";
  }
  if (/\.aac$/i.test(name) || type === "audio/aac" || type === "audio/aacp") return "audio/aac";
  if (/\.(ogg|opus)$/i.test(name) || type === "audio/ogg" || type === "audio/opus") return "audio/ogg";
  if (/\.amr$/i.test(name) || type === "audio/amr" || type === "audio/amr-wb") return "audio/amr";
  return null;
}

export function isLikelyWhatsAppAudioFile(file: { type?: string; name?: string }): boolean {
  return whatsappAudioContentType(file) != null;
}

/** קובץ שמע שוואטסאפ לא ישלח (WAV, FLAC, הקלטת דפדפן ב-WebM). */
export function isUnsupportedDashboardAudioFile(file: { type?: string; name?: string }): boolean {
  if (isLikelyWhatsAppAudioFile(file)) return false;
  const type = String(file.type ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const name = String(file.name ?? "");
  if (type.startsWith("audio/")) return true;
  return /\.(wav|flac|aiff|aif|wma)$/i.test(name);
}

export function ensureWhatsAppAudioFilename(name: string, mime: string): string {
  const base = name.trim() || "recording";
  if (/\.(mp3|m4a|aac|ogg|opus|amr)$/i.test(base)) return base;
  const ext =
    mime === "audio/mpeg"
      ? "mp3"
      : mime === "audio/mp4"
        ? "m4a"
        : mime === "audio/ogg"
          ? "ogg"
          : mime === "audio/amr"
            ? "amr"
            : "aac";
  return `${base}.${ext}`;
}

export function isWhatsAppAudioUrl(url: string): boolean {
  return /\.(mp3|m4a|aac|ogg|opus|amr)(\?|#|$)/i.test(url);
}

/** בועת הקלטה בוואטסאפ דורשת OGG עם Opus. */
export function isWhatsAppVoiceNoteAudio(input: { url?: string; mime?: string }): boolean {
  const mime = String(input.mime ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime === "audio/ogg" || mime === "audio/opus") return true;
  return /\.(ogg|opus)(\?|#|$)/i.test(String(input.url ?? ""));
}

export function whatsappAudioMimeFromUrl(url: string): string {
  let name = url;
  try {
    name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? url);
  } catch {
    /* keep url */
  }
  return whatsappAudioContentType({ name }) ?? "audio/mpeg";
}

export function maxWhatsAppUploadBytesForFile(file: Pick<File, "type" | "name">): number {
  if (isLikelyWhatsAppAudioFile(file)) return WHATSAPP_AUDIO_MAX_BYTES;
  return whatsappMediaMaxBytes(isLikelyVideoFile(file));
}

export function dashboardMaxUploadBytesForFile(file: Pick<File, "type" | "name">): number {
  if (isLikelyVideoFile(file)) return WHATSAPP_VIDEO_MAX_BYTES;
  if (isLikelyWhatsAppAudioFile(file)) return WHATSAPP_AUDIO_MAX_BYTES;
  return DASHBOARD_IMAGE_UPLOAD_MAX_BYTES;
}
