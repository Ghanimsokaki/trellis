import { jsonError, readJsonBody, validationError } from "@/lib/http";
import { generateConcept, IMAGE_MODELS } from "@/lib/nim";
import type { GenSettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type ConceptBody = {
  prompt?: string;
  settings?: Partial<GenSettings>;
  imageModel?: string;
};

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<ConceptBody>(request);
    const prompt = (body.prompt ?? "").trim();

    if (prompt.length < 3) {
      return validationError("Describe what you want to build (at least 3 characters).");
    }
    if (prompt.length > 600) {
      return validationError("Keep the prompt under 600 characters.", "Long prompts get truncated by the diffusion model.");
    }
    if (body.imageModel && !IMAGE_MODELS.some((model) => model.id === body.imageModel)) {
      return validationError("Unknown text-to-image model.");
    }

    const concept = await generateConcept(prompt, body.settings, { model: body.imageModel });
    return Response.json(concept, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
