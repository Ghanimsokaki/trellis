import { jsonError, readJsonBody, validationError } from "@/lib/http";
import { synthesizeViews, viewSynthesisCapability } from "@/lib/synth";
import type { ImageSpec } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ViewsBody = {
  image?: string;
  /** optional description from the perceive layer, sharpens the edit prompts */
  subject?: string;
  material?: string;
  count?: number;
  seed?: number;
};

const DATA_URL = /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/;
/** Kontext edits one image; keep the payload inside the serverless body cap. */
const MAX_CHARS = 4_200_000;

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<ViewsBody>(request);
    const image = (body.image ?? "").trim();
    if (!image) return validationError("An input image is required.");
    if (image.length > MAX_CHARS) {
      return validationError("That image is too large to send through a serverless function (max ~3 MB).");
    }
    if (!DATA_URL.test(image)) {
      return validationError("Images must be base64 data URLs (PNG, JPG or WEBP).");
    }

    const capability = viewSynthesisCapability();
    if (capability.mode === "off") {
      return Response.json(
        {
          views: [],
          model: capability.model,
          mode: capability.mode,
          skipped: "View synthesis is switched off (NVIDIA_SYNTH_VIEWS=off).",
          elapsedMs: 0,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }

    const spec = body.subject
      ? ({
          subject: body.subject,
          material: body.material ?? "",
        } as unknown as ImageSpec)
      : null;

    const result = await synthesizeViews(image, spec, {
      count: body.count,
      seed: body.seed,
    });

    return Response.json(
      {
        views: result.views.map((view) => ({ dataUrl: view.dataUrl, label: view.label })),
        model: result.model,
        mode: result.mode,
        skipped: result.skipped ?? null,
        elapsedMs: result.elapsedMs,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export function GET() {
  const capability = viewSynthesisCapability();
  return Response.json(
    { mode: capability.mode, model: capability.model, maxViews: capability.maxViews },
    { headers: { "cache-control": "no-store" } },
  );
}
