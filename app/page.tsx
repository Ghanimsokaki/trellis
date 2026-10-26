import { Studio } from "@/components/Studio";
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

export const dynamic = "force-dynamic";

export default function Home() {
  const { variable } = resolveKey();
  const selfHosted = isSelfHosted();
  const initialHealth: HealthResponse = {
    configured: variable !== null || selfHosted,
    hasKey: variable !== null,
    selfHosted,
    authVariable: variable,
    trellisModel: TRELLIS_MODEL,
    imageModel: DEFAULT_IMAGE_MODEL,
    imageModels: IMAGE_MODELS.map((model) => model.id),
    apiBase: API_BASE,
    maxDurationSeconds: Number(process.env.NVIDIA_MAX_DURATION || 300),
    imageTransport: selfHosted ? "inline" : "asset",
    assetsBase: ASSETS_API_BASE,
    trellisImageMode: selfHosted ? "native" : "caption",
    visionModel: VISION_MODEL,
    searchProvider: searchConfigured().provider,
    viewSynthesis: viewSynthesisCapability().mode,
    viewModel: VIEW_MODEL,
  };

  return <Studio initialHealth={initialHealth} />;
}
