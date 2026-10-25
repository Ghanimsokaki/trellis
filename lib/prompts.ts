/**
 * Prompt helpers shared by the browser and the server.
 *
 * `composeDetailedPrompt` is the offline enhancer: it never calls an API, so
 * the "Enhance" button still does something useful when the LLM NIM is
 * unreachable or no key is configured.
 */

const SHAPE_HINTS = [
  "single isolated object",
  "centered, whole object in frame",
  "three-quarter front view, slightly above horizon",
  "clean silhouette with clear separation between parts",
];

const MATERIAL_HINTS = [
  "crisp panel lines and panel edges",
  "physically based materials, subtle metal and roughness variation",
  "soft studio lighting with a gentle contact shadow",
  "plain light neutral background",
];

const QUALITY_HINTS = [
  "game-ready asset, uniform texel density",
  "high detail, no text, no watermark, no extra props",
];

/** Deterministic, dependency-free prompt enrichment. */
export function composeDetailedPrompt(prompt: string): string {
  const subject = prompt
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!,;:\s]+$/, "");
  if (!subject) return "";

  const lower = subject.toLowerCase();
  const missing = (hints: string[]) => hints.filter((hint) => !lower.includes(hint.split(",")[0]));
  const parts = [subject, ...missing(SHAPE_HINTS), ...missing(MATERIAL_HINTS).slice(0, 2), ...missing(QUALITY_HINTS).slice(0, 1)];

  // Keep it inside what TRELLIS accepts and diffusion models follow well.
  const joined = parts.join(", ");
  return joined.length > 580 ? `${subject}, ${SHAPE_HINTS[0]}, ${SHAPE_HINTS[2]}, ${MATERIAL_HINTS[2]}` : joined;
}

/** Guard for prompts that are really just a name ("USS Odyssey"). */
export function needsShapeWords(prompt: string): boolean {
  const words = prompt.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2) return true;
  return !/(hull|saucer|nacelle|pylon|wing|body|shell|handle|spout|leg|blade|barrel|lens|frame|roof|wheel|arm|dome|fin|thruster)/i.test(
    prompt,
  );
}

/** Short guidance appended to the concept render prompt. */
export function conceptSuffix(view: "three-quarter" | "front" | "side" | "top" = "three-quarter"): string {
  const views: Record<string, string> = {
    "three-quarter": "three-quarter front view, slightly above horizon",
    front: "straight front orthographic view",
    side: "straight side orthographic view",
    top: "straight top-down orthographic view",
  };
  return [
    SHAPE_HINTS[0],
    SHAPE_HINTS[1],
    views[view],
    MATERIAL_HINTS[3],
    MATERIAL_HINTS[2],
    "clean product render, crisp silhouette, high detail, no text, no watermark, no extra props",
  ].join(", ");
}
