/**
 * Layer 1 — Perceive.
 *
 * The hosted TRELLIS preview endpoint only accepts four catalogue images
 * (`data:image/png;example_id,0…3`), so a user photo can never reach the image
 * branch there. This layer looks at the photo with a vision NIM and turns it
 * into (a) a structured description we can show the user, (b) a ≤77-character
 * prompt the text branch accepts, and (c) web queries the resolve layer runs
 * when a search provider is configured.
 */
import { TRELLIS_PROMPT_MAX, VISION_MODEL, chatNim } from "./nim";
import { composeDetailedPrompt, needsShapeWords } from "./prompts";
import type { ImageSpec } from "./types";

const SYSTEM = [
  "You are the perception layer of a 3D asset pipeline.",
  "You receive ONE photo of a single object and describe its FORM so a text-to-3D model can rebuild it.",
  "Return ONLY minified JSON with these keys:",
  '{"subject":"short name","category":"spaceship|vehicle|creature|prop|furniture|architecture|other",',
  '"silhouette":"one sentence on overall shape and proportions",',
  '"parts":["named parts, max 6"],"palette":["#rrggbb, max 4"],',
  '"material":"surface finish in a few words",',
  `"prompt":"a comma-separated 3D prompt of at most ${TRELLIS_PROMPT_MAX} characters: shape words first, then parts, then material/colour",`,
  '"queries":["2-3 web search queries that would find more photos or a matching 3D model of this exact subject"],',
  '"confidence":0.0-1.0,"notes":"optional caveat, e.g. background clutter or occlusion"}',
  "Rules: describe geometry, never lore. No brands, people, scenes, lighting, camera or mood words.",
  "If the photo is a full scene, still isolate the most important object.",
].join(" ");

type SpecPayload = Partial<ImageSpec> & { subject?: unknown };

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, limit);
}

/** Squeeze arbitrary text into TRELLIS' 77-character prompt budget. */
export function fitPrompt(text: string, fallback = "a detailed isolated 3D asset"): string {
  const flat = text
    .replace(/[`"'“”]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[,\s]+$/, "")
    .trim();
  const source = flat || fallback;
  if (source.length <= TRELLIS_PROMPT_MAX) return source.toLowerCase();

  const words = source.split(" ");
  const kept: string[] = [];
  for (const word of words) {
    if ([...kept, word].join(" ").length > TRELLIS_PROMPT_MAX) break;
    kept.push(word);
  }
  const clipped = kept.join(" ").replace(/[,\s]+$/, "");
  return (clipped || source.slice(0, TRELLIS_PROMPT_MAX)).toLowerCase();
}

function coerceSpec(raw: unknown, userPrompt: string): ImageSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as SpecPayload;
  const subject = asString(payload.subject);
  if (!subject) return null;

  const parts = asStringArray(payload.parts, 6);
  const silhouette = asString(payload.silhouette, subject);
  const material = asString(payload.material, "");
  const category = asString(payload.category, "other");

  // Prefer the model's own prompt, but keep the subject in front of it.
  const drafted = asString(payload.prompt);
  const assembled =
    drafted.length >= 12
      ? drafted
      : [subject, silhouette, ...parts, material].filter(Boolean).join(", ");

  const queries = asStringArray(payload.queries, 3);
  if (queries.length === 0) queries.push(`${subject} 3d model`, `${subject} side view photo`);

  const confidenceRaw = typeof payload.confidence === "number" ? payload.confidence : 0.6;

  return {
    subject,
    category,
    silhouette,
    parts,
    palette: asStringArray(payload.palette, 4),
    material,
    prompt: fitPrompt(assembled, subject),
    queries,
    confidence: Math.min(1, Math.max(0, confidenceRaw)),
    notes: asString(payload.notes) || undefined,
  };
}

function parseJsonBlock(content: string): unknown {
  const trimmed = content
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** Offline spec used when the vision model is unavailable but the user typed a prompt. */
export function specFromPrompt(prompt: string): ImageSpec {
  const subject = prompt.trim().replace(/\s+/g, " ").slice(0, 80);
  const detailed = needsShapeWords(subject) ? composeDetailedPrompt(subject) : subject;
  return {
    subject: subject || "reference object",
    category: "other",
    silhouette: "shape inferred from the written brief (no vision pass)",
    parts: [],
    palette: [],
    material: "",
    prompt: fitPrompt(detailed || subject),
    queries: [`${subject || "reference object"} 3d model`],
    confidence: 0.35,
    notes: "Vision layer unavailable — description came from your prompt, not the photo.",
  };
}

export type AnalyzeResult = {
  spec: ImageSpec;
  model: string;
  elapsedMs: number;
  usedVision: boolean;
  warning?: string;
};

/**
 * Describe the reference photo.
 * Throws only when there is nothing to fall back to (no vision and no prompt).
 */
export async function analyzeImage(
  dataUrl: string,
  options: { prompt?: string | null; timeoutMs?: number } = {},
): Promise<AnalyzeResult> {
  const fallbackPrompt = (options.prompt ?? "").trim();
  const started = Date.now();

  try {
    const { content, model } = await chatNim(
      [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this object for text-to-3D reconstruction." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      {
        model: VISION_MODEL,
        label: "Perceive",
        timeoutMs: options.timeoutMs ?? 45_000,
        temperature: 0.1,
        maxTokens: 600,
        responseFormat: "json",
      },
    );

    const spec = coerceSpec(parseJsonBlock(content), fallbackPrompt);
    if (spec) {
      return { spec, model, elapsedMs: Date.now() - started, usedVision: true };
    }
    if (fallbackPrompt) {
      return {
        spec: specFromPrompt(fallbackPrompt),
        model,
        elapsedMs: Date.now() - started,
        usedVision: false,
        warning: "The vision model answered in an unexpected format, so the written brief was used.",
      };
    }
    throw new Error("The vision model returned an unexpected format.");
  } catch (error) {
    if (fallbackPrompt) {
      return {
        spec: specFromPrompt(fallbackPrompt),
        model: VISION_MODEL,
        elapsedMs: Date.now() - started,
        usedVision: false,
        warning: `vision pass failed (${(error instanceof Error ? error.message : "unknown error").slice(0, 60)}) — used your written brief`,
      };
    }
    throw error;
  }
}
