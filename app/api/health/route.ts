import { API_BASE, DEFAULT_IMAGE_MODEL, IMAGE_MODELS, TRELLIS_MODEL, isSelfHosted, resolveKey } from "@/lib/nim";
import type { HealthResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const { variable } = resolveKey();
  const selfHosted = isSelfHosted();
  const body: HealthResponse = {
    configured: variable !== null || selfHosted,
    hasKey: variable !== null,
    selfHosted,
    authVariable: variable,
    trellisModel: TRELLIS_MODEL,
    imageModel: DEFAULT_IMAGE_MODEL,
    imageModels: IMAGE_MODELS.map((model) => model.id),
    apiBase: API_BASE,
    maxDurationSeconds: Number(process.env.NVIDIA_MAX_DURATION || 300),
  };

  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
