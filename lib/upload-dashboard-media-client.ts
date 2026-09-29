import { compressImageForWhatsAppIfNeeded } from "@/lib/compress-image-for-whatsapp";
import {
  dashboardMaxUploadBytesForFile,
  WHATSAPP_IMAGE_MAX_BYTES,
  WHATSAPP_VIDEO_MAX_BYTES,
} from "@/lib/whatsapp-media-limits";

export type DashboardMediaUploadErrorCode =
  | "webp_not_supported"
  | "image_only"
  | "file_too_large"
  | "compress_failed"
  | "invalid_server_response"
  | "upload_prep_failed"
  | "no_signed_url"
  | "storage_upload_failed"
  | "network";

export async function uploadDashboardImageFile(file: File): Promise<string> {
  if (file.type === "image/webp" || /\.webp$/i.test(file.name)) {
    throw new Error("webp_not_supported");
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("image_only");
  }
  const maxBytes = dashboardMaxUploadBytesForFile(file);
  if (file.size <= 0 || file.size > maxBytes) {
    throw new Error("file_too_large");
  }

  let uploadFile: File;
  try {
    uploadFile = await compressImageForWhatsAppIfNeeded(file);
  } catch {
    throw new Error("compress_failed");
  }

  const signRes = await fetch("/api/dashboard/upload-media-signed-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: uploadFile.name,
      contentType: uploadFile.type || "application/octet-stream",
      fileSize: uploadFile.size,
    }),
  });

  let signJson: { signedUrl?: string; publicUrl?: string; error?: string } = {};
  try {
    signJson = (await signRes.json()) as typeof signJson;
  } catch {
    throw new Error("invalid_server_response");
  }
  if (!signRes.ok) {
    throw new Error(signJson.error?.trim() ? "upload_prep_failed" : "upload_prep_failed");
  }

  const signedUrl = signJson.signedUrl?.trim();
  const publicUrl = signJson.publicUrl?.trim();
  if (!signedUrl || !publicUrl) {
    throw new Error("no_signed_url");
  }

  const putRes = await fetch(signedUrl, {
    method: "PUT",
    headers: {
      "x-upsert": "true",
      "Content-Type": uploadFile.type || "application/octet-stream",
    },
    body: uploadFile,
  });
  if (!putRes.ok) {
    throw new Error("storage_upload_failed");
  }

  return publicUrl;
}

function isJpegOrPng(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/jpeg" || type === "image/png") return true;
  return /\.(jpe?g|png)$/i.test(file.name);
}

function isMp4Or3gp(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === "video/mp4" || type === "video/3gpp" || type === "video/3gp") return true;
  return /\.(mp4|3gp|3gpp)$/i.test(file.name);
}

/** תמונה או סרטון לפי מגבלות Cloud API: JPG/PNG עד 5MB, MP4/3GP עד 16MB. */
export async function uploadDashboardWhatsAppMedia(file: File): Promise<{ url: string; kind: "image" | "video" }> {
  if (file.type === "image/webp" || /\.webp$/i.test(file.name)) {
    throw new Error("WebP לא נתמך בוואטסאפ. העלי JPG או PNG.");
  }
  const video = isMp4Or3gp(file);
  const image = !video && isJpegOrPng(file);
  if (!video && !image) {
    throw new Error("וואטסאפ מקבל תמונת JPG או PNG, או סרטון MP4 או 3GP.");
  }
  const maxBytes = video ? WHATSAPP_VIDEO_MAX_BYTES : dashboardMaxUploadBytesForFile(file);
  if (file.size <= 0 || file.size > maxBytes) {
    throw new Error(video ? "הסרטון גדול מ־16MB, המקסימום של וואטסאפ." : "התמונה גדולה מדי להעלאה.");
  }

  let uploadFile = file;
  if (image) {
    try {
      uploadFile = await compressImageForWhatsAppIfNeeded(file);
    } catch {
      throw new Error("לא הצלחנו לכווץ את התמונה אל מתחת ל־5MB.");
    }
    if (uploadFile.size > WHATSAPP_IMAGE_MAX_BYTES) {
      throw new Error("התמונה נשארה מעל 5MB אחרי כיווץ.");
    }
  }

  const signRes = await fetch("/api/dashboard/upload-media-signed-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: uploadFile.name,
      contentType: uploadFile.type || (video ? "video/mp4" : "image/jpeg"),
      fileSize: uploadFile.size,
    }),
  });
  let signJson: { signedUrl?: string; publicUrl?: string; error?: string } = {};
  try {
    signJson = (await signRes.json()) as typeof signJson;
  } catch {
    throw new Error("תשובת שרת לא תקינה.");
  }
  if (!signRes.ok) {
    throw new Error(signJson.error?.trim() || "הכנת ההעלאה נכשלה.");
  }
  const signedUrl = signJson.signedUrl?.trim();
  const publicUrl = signJson.publicUrl?.trim();
  if (!signedUrl || !publicUrl) throw new Error("לא התקבל קישור להעלאה.");

  const putRes = await fetch(signedUrl, {
    method: "PUT",
    headers: {
      "x-upsert": "true",
      "Content-Type": uploadFile.type || "application/octet-stream",
    },
    body: uploadFile,
  });
  if (!putRes.ok) throw new Error("ההעלאה נכשלה.");
  return { url: publicUrl, kind: video ? "video" : "image" };
}
