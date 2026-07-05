import { compressImageForWhatsAppIfNeeded } from "@/lib/compress-image-for-whatsapp";
import { dashboardMaxUploadBytesForFile } from "@/lib/whatsapp-media-limits";

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
