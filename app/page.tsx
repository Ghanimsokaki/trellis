import { Studio } from "@/components/Studio";
import { API_BASE, DEFAULT_IMAGE_MODEL, IMAGE_MODELS, TRELLIS_MODEL, resolveKey } from "@/lib/nim";
import type { HealthResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export default function Home() {
  const { variable } = resolveKey();
  const initialHealth: HealthResponse = {
    configured: variable !== null,
    authVariable: variable,
    trellisModel: TRELLIS_MODEL,
    imageModel: DEFAULT_IMAGE_MODEL,
    imageModels: IMAGE_MODELS.map((model) => model.id),
    apiBase: API_BASE,
    maxDurationSeconds: Number(process.env.NVIDIA_MAX_DURATION || 300),
  };

  return <Studio initialHealth={initialHealth} />;
}
