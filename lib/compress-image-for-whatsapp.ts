import { WHATSAPP_IMAGE_MAX_BYTES } from "@/lib/whatsapp-media-limits";

export function isRasterImageFile(file: Pick<File, "type" | "name">): boolean {
  const t = (file.type ?? "").toLowerCase();
  if (t === "image/svg+xml" || t.includes("svg")) return false;
  if (t.startsWith("image/")) return true;
  return /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name);
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))),
      "image/jpeg",
      quality
    );
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

async function renderJpegUnderMaxBytes(
  img: HTMLImageElement,
  maxBytes: number,
  startWidth: number,
  startHeight: number
): Promise<Blob> {
  let width = Math.max(1, Math.round(startWidth));
  let height = Math.max(1, Math.round(startHeight));

  for (let shrinkPass = 0; shrinkPass < 6; shrinkPass++) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d unavailable");
    ctx.drawImage(img, 0, 0, width, height);

    for (let q = 0.9; q >= 0.42; q -= 0.06) {
      const blob = await canvasToJpegBlob(canvas, q);
      if (blob.size <= maxBytes) return blob;
    }

    width = Math.max(1, Math.round(width * 0.82));
    height = Math.max(1, Math.round(height * 0.82));
  }

  throw new Error("could not compress image under WhatsApp limit");
}

/**
 * תמונות מעל מגבלת WhatsApp (5MB) — כיווץ בדפדפן (Canvas + toBlob).
 * מתחת למגבלה — מחזיר את הקובץ המקורי ללא שינוי.
 */
export async function compressImageForWhatsAppIfNeeded(file: File): Promise<File> {
  if (typeof document === "undefined") {
    throw new Error("compressImageForWhatsAppIfNeeded requires a browser");
  }
  if (!isRasterImageFile(file)) return file;
  if (file.size <= WHATSAPP_IMAGE_MAX_BYTES) return file;

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageElement(url);
    const maxEdge = 4096;
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;
    if (!width || !height) throw new Error("invalid image dimensions");
    if (width > maxEdge || height > maxEdge) {
      const scale = maxEdge / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const blob = await renderJpegUnderMaxBytes(img, WHATSAPP_IMAGE_MAX_BYTES, width, height);
    const baseName = file.name.replace(/\.[^.]+$/i, "") || "image";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
