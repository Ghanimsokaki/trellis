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
  /** optional multi-view input (up to 8 views) — TRELLIS averages them */
  images?: string[];
  engine?: EngineId;
  imageModel?: string | null;
  conceptPrompt?: string | null;
  settings?: Partial<GenSettings>;
};

/** Vercel caps serverless request bodies at 4.5 MB; stay under it in base64 chars. */
const MAX_TOTAL_IMAGE_CHARS = 4_200_000;
const DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/;

function encodeMeta(meta: MeshMeta): string {
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
    const engine: EngineId =
      body.engine === "trellis-text" ? "trellis-text" : body.engine === "image" ? "image" : "pipeline";

    const images = (body.images ?? []).map((entry) => entry.trim()).filter(Boolean);

    if (mode === "text") {
      if (prompt.length < 3) return validationError("Describe the object you want to generate.");
      if (prompt.length > 600) return validationError("Keep the prompt under 600 characters.");
    } else {
      const single = (body.image ?? "").trim();
      const incoming = images.length > 0 ? images : single ? [single] : [];
      if (incoming.length === 0) return validationError("An input image is required.");
      if (incoming.length > 8) return validationError("TRELLIS accepts at most 8 views.");

      const totalChars = incoming.reduce((sum, entry) => sum + entry.length, 0);
      if (totalChars > MAX_TOTAL_IMAGE_CHARS) {
        return validationError(
          "Those images are too large to send through a serverless function (max ~3 MB).",
          "The studio already fits each upload into a 1024² JPEG — try one view, or a smaller file.",
        );
      }
      for (const entry of incoming) {
        if (!DATA_URL.test(entry)) {
          return validationError("Images must be base64 data URLs (PNG, JPG or WEBP).");
        }
      }
    }

    const single = (body.image ?? "").trim();
    const input =
      mode === "text"
        ? ({ mode: "text", prompt } as const)
        : ({
            mode: "image",
            image: images[0] ?? single,
            images: images.length > 0 ? images : undefined,
            prompt: prompt || null,
          } as const);

    const { glb, meta } = await generateMesh(input, body.settings, {
      engine,
      imageModel: mode === "image" ? body.imageModel ?? null : null,
      conceptPrompt: body.conceptPrompt ?? null,
    });

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
