"use client";

export type PreparedImage = {
  dataUrl: string;
  name: string;
  width: number;
  height: number;
  bytes: number;
};

const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return dataUrl.length;
  const base64 = dataUrl.slice(comma + 1);
  return Math.round((base64.length * 3) / 4);
}

/**
 * Downscale + flatten an upload into a JPEG data URL that fits comfortably
 * inside Vercel's 4.5 MB serverless request limit.
 */
export async function prepareImageFile(file: File, maxDimension = 1024): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("That file is not an image. Use PNG, JPG or WEBP.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Image is larger than 24 MB. Try a smaller file.");
  }

  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot process images.");

  // TRELLIS is happiest with a single object on a plain background.
  context.fillStyle = "#f4f5f7";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  return {
    dataUrl,
    name: file.name || "upload",
    width,
    height,
    bytes: estimateDataUrlBytes(dataUrl),
  };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img> decoding
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not decode that image."));
      image.src = url;
    });
    return image;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
