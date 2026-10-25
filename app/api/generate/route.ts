import { jsonError, readJsonBody, validationError } from "@/lib/http";
import { generateMesh } from "@/lib/nim";
import type { EngineId, GenSettings, MeshMeta } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** TRELLIS needs room to breathe. Vercel clamps this to your plan's limit. */
export const maxDuration = 300;

type GenerateBody = {
  mode?: "image" | "text";
  prompt?: string;
  image?: string;
  engine?: EngineId;
  imageModel?: string | null;
  conceptPrompt?: string | null;
  settings?: Partial<GenSettings>;
};

const MAX_IMAGE_CHARS = 4_200_000; // ~3.1 MB decoded, under Vercel's 4.5 MB body cap
const DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/;

function encodeMeta(meta: MeshMeta): string {
  // ASCII-safe header payload.
  return Buffer.from(JSON.stringify(meta), "utf8").toString("base64");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<GenerateBody>(request);
    const mode = body.mode === "text" ? "text" : "image";
    const prompt = (body.prompt ?? "").trim();
    const engine: EngineId = body.engine === "trellis-text" ? "trellis-text" : body.engine === "image" ? "image" : "pipeline";

    if (mode === "text") {
      if (prompt.length < 3) return validationError("Describe the object you want to generate.");
      if (prompt.length > 600) return validationError("Keep the prompt under 600 characters.");
    } else {
      const image = (body.image ?? "").trim();
      if (!image) return validationError("An input image is required.");
      if (image.length > MAX_IMAGE_CHARS) {
        return validationError(
          "That image is too large for a serverless request (max ~3 MB).",
          "The studio downscales images before upload — try a smaller file or a PNG/JPG screenshot.",
        );
      }
      if (!DATA_URL.test(image)) {
        return validationError("The image must be a base64 data URL (PNG, JPG or WEBP).");
      }
    }

    const { glb, meta } = await generateMesh(
      mode === "text" ? { mode: "text", prompt } : { mode: "image", image: body.image!.trim(), prompt: prompt || null },
      body.settings,
      {
        engine,
        imageModel: mode === "image" ? body.imageModel ?? null : null,
        conceptPrompt: body.conceptPrompt ?? null,
      },
    );

    const filename = `trellis-${meta.seed || "random"}-${Date.now().toString(36)}.glb`;

    return new Response(toArrayBuffer(glb), {
      status: 200,
      headers: {
        "content-type": "model/gltf-binary",
        "content-length": String(glb.byteLength),
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        "x-trellis-meta": encodeMeta(meta),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
