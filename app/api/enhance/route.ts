import { jsonError, readJsonBody, validationError } from "@/lib/http";
import { NimError, enhancePrompt, isConfigured } from "@/lib/nim";
import { composeDetailedPrompt, needsShapeWords } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type EnhanceBody = { prompt?: string; offline?: boolean };

/**
 * Meshy-style "improve prompt".
 *
 * Tries the hosted chat NIM first. If the key is missing, the model is rate
 * limited, or the gateway misbehaves, it degrades to the deterministic offline
 * enhancer instead of failing the user's click.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<EnhanceBody>(request);
    const prompt = (body.prompt ?? "").trim();
    if (prompt.length < 3) {
      return validationError("Write a starting prompt (at least 3 characters) to enhance.");
    }
    if (prompt.length > 600) {
      return validationError("Keep the prompt under 600 characters.");
    }

    const offline = () => ({
      prompt: composeDetailedPrompt(prompt),
      original: prompt,
      model: "offline-composer",
      elapsedMs: 0,
      offline: true,
      addedShapeWords: needsShapeWords(prompt),
    });

    if (body.offline || !isConfigured()) {
      return Response.json(offline(), { headers: { "cache-control": "no-store" } });
    }

    try {
      const enhanced = await enhancePrompt(prompt);
      return Response.json(
        {
          prompt: enhanced.prompt,
          original: prompt,
          model: enhanced.model,
          elapsedMs: enhanced.elapsedMs,
          offline: false,
          addedShapeWords: needsShapeWords(prompt),
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      // Never block the click: fall back to the local composer.
      if (error instanceof NimError) {
        return Response.json(
          {
            ...offline(),
            fallbackReason: `${error.message}${error.hint ? ` — ${error.hint}` : ""}`,
          },
          { headers: { "cache-control": "no-store" } },
        );
      }
      throw error;
    }
  } catch (error) {
    return jsonError(error);
  }
}
