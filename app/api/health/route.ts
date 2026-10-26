import {
  API_BASE,
  ASSETS_API_BASE,
  DEFAULT_IMAGE_MODEL,
  IMAGE_MODELS,
  TRELLIS_MODEL,
  VISION_MODEL,
  isSelfHosted,
  resolveKey,
} from "@/lib/nim";
import { searchConfigured } from "@/lib/search";
import { VIEW_MODEL, viewSynthesisCapability } from "@/lib/synth";
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
    // Hosted functions get images as NVCF assets (inline base64 is capped ~180 KB).
    imageTransport: selfHosted ? "inline" : "asset",
    assetsBase: ASSETS_API_BASE,
    // Hosted TRELLIS only accepts catalogue example_ids, so photos go through the caption bridge.
    trellisImageMode: selfHosted ? "native" : "caption",
    visionModel: VISION_MODEL,
    searchProvider: searchConfigured().provider,
    viewSynthesis: viewSynthesisCapability().mode,
    viewModel: VIEW_MODEL,
  };

  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
