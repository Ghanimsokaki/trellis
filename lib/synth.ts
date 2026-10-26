/**
 * Layer 3 (optional) — Synthesize views.
 *
 * TRELLIS is noticeably better with more than one view, and the hosted preview
 * will not take a user photo at all. FLUX.1-Kontext is an image-editing model,
 * so it can *turn* the photo into the other camera angles a reconstruction
 * wants:
 *
 *   photo ──▶ Kontext("rotate 90° left, same object, plain background")
 *         └─▶ Kontext("rear view …")
 *         └─▶ TRELLIS(photo + synthesized views)
 *
 * Honest capability note: the hosted Kontext preview is documented the same way
 * as TRELLIS — "Preview API NIM supports only a predefined set of images" — so
 * for most accounts this layer only does real work against a self-hosted
 * Kontext NIM (`NVIDIA_KONTEXT_URL`). When the hosted call is refused, the
 * layer reports it and the forge keeps using the views you uploaded yourself.
 */
import { API_BASE, NimError, callNim, hostedImageInput, isSelfHosted } from "./nim";
import type { ImageSpec } from "./types";

export const VIEW_MODEL = process.env.NVIDIA_VIEW_MODEL || "black-forest-labs/flux.1-kontext-dev";

/**
 * Self-hosted Kontext (`…/v1/infer`) takes inline base64; the hosted preview
 * needs NVCF asset references and, for most accounts, refuses user images.
 */
function kontextUrl(): { url: string; hosted: boolean } {
  const override = process.env.NVIDIA_KONTEXT_URL?.trim();
  if (override) return { url: override, hosted: false };
  return { url: `/genai/${VIEW_MODEL}`, hosted: true };
}

export type ViewSynthesisMode = "native" | "hosted" | "off";

export function viewSynthesisCapability(): { mode: ViewSynthesisMode; model: string; maxViews: number } {
  const setting = (process.env.NVIDIA_SYNTH_VIEWS || "auto").toLowerCase();
  const model = VIEW_MODEL;
  const maxViews = Math.min(Math.max(Number(process.env.NVIDIA_SYNTH_VIEW_COUNT || 2), 1), 4);
  if (setting === "off" || setting === "0" || setting === "false") return { mode: "off", model, maxViews };
  const { hosted } = kontextUrl();
  return { mode: hosted ? "hosted" : "native", model, maxViews };
}

export type SynthView = { dataUrl: string; label: string; prompt: string };

export type SynthResult = {
  views: SynthView[];
  model: string;
  mode: ViewSynthesisMode;
  elapsedMs: number;
  /** why the layer produced nothing (capability, refusal, or partial failure) */
  skipped?: string;
};

type ViewRequest = { label: string; prompt: string };

function viewRequests(spec: ImageSpec | null, count: number): ViewRequest[] {
  const subject = spec?.subject ? ` the ${spec.subject}` : " the object";
  const keep = spec?.material ? ` Keep its ${spec.material} and proportions identical.` : " Keep its proportions and colours identical.";
  const base = [
    { label: "left side", prompt: `Turn${subject} 90 degrees so we see its left side profile. Keep the same object, same materials and scale.${keep} Isolated on a plain white background, no scene, no text, no extra objects.` },
    { label: "rear", prompt: `Show the rear of${subject} from directly behind. Keep the same object, same materials and scale.${keep} Isolated on a plain white background, no scene, no text, no extra objects.` },
    { label: "three-quarter", prompt: `Show${subject} from a raised three-quarter front angle. Keep the same object, same materials and scale.${keep} Isolated on a plain white background, no scene, no text, no extra objects.` },
    { label: "top", prompt: `Show${subject} from directly above. Keep the same object, same materials and scale.${keep} Isolated on a plain white background, no scene, no text, no extra objects.` },
  ];
  return base.slice(0, Math.max(1, count));
}

/** Remember a hosted refusal so we stop paying for it on every generation. */
let hostedRefused: string | null = null;

export function hostedSynthesisBlocked(): string | null {
  return hostedRefused;
}

function imageFromArtifact(payload: Record<string, unknown>): string | null {
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  const first = artifacts[0] as Record<string, unknown> | undefined;
  const candidates = [first?.base64, payload.base64, (payload.data as Record<string, unknown> | undefined)?.b64_json];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 64) {
      const mime =
        candidate.startsWith("/9j/") ? "image/jpeg" : candidate.startsWith("UklGR") ? "image/webp" : "image/png";
      return `data:${mime};base64,${candidate.replace(/^data:[^,]+,/, "")}`;
    }
  }
  return null;
}

/**
 * Ask Kontext for extra camera angles of the same object.
 * Never throws: the forge always has the original photo to fall back on.
 */
export async function synthesizeViews(
  image: string,
  spec: ImageSpec | null,
  options: { count?: number; timeoutMs?: number; seed?: number } = {},
): Promise<SynthResult> {
  const started = Date.now();
  const { mode, model, maxViews } = viewSynthesisCapability();
  const count = Math.min(Math.max(options.count ?? maxViews, 1), maxViews);

  if (mode === "off") {
    return { views: [], model, mode, elapsedMs: 0, skipped: "view synthesis is off (NVIDIA_SYNTH_VIEWS=off)" };
  }
  if (mode === "hosted" && hostedRefused) {
    return { views: [], model, mode, elapsedMs: 0, skipped: hostedRefused };
  }

  const { url, hosted } = kontextUrl();
  const requests = viewRequests(spec, count);
  const views: SynthView[] = [];
  let skipped: string | undefined;

  for (const request of requests) {
    try {
      const prepared = await hostedImageInput(image, { hosted, timeoutMs: 60_000 });
      const { payload } = await callNim(
        url,
        {
          prompt: request.prompt.slice(0, 9_000),
          image: prepared.value,
          aspect_ratio: "match_input_image",
          cfg_scale: 3.5,
          steps: 30,
          seed: options.seed ?? 0,
        },
        {
          timeoutMs: options.timeoutMs ?? 120_000,
          label: "View synthesis",
          retries: 0,
          allowNoKey: !hosted,
          headers: prepared.headers,
        },
      );

      const dataUrl = imageFromArtifact(payload);
      if (!dataUrl) {
        skipped = `Kontext returned no image for the ${request.label} view.`;
        break;
      }
      views.push({ dataUrl, label: request.label, prompt: request.prompt });
    } catch (error) {
      const detail =
        error instanceof NimError ? `${error.detail ?? ""} ${error.message}`.trim() : error instanceof Error ? error.message : "unknown error";
      if (/example_id/i.test(detail)) {
        const reason =
          "the hosted Kontext preview only edits its own catalogue images — set NVIDIA_KONTEXT_URL to a self-hosted Kontext NIM to synthesize views";
        if (hosted) hostedRefused = reason;
        skipped = reason;
      } else {
        skipped = `Kontext failed (${detail.slice(0, 120)}).`;
      }
      break;
    }
  }

  return {
    views,
    model,
    mode,
    elapsedMs: Date.now() - started,
    skipped: views.length === 0 ? skipped ?? "no views were produced" : skipped,
  };
}

/** Public description for /api/health and the UI. */
export function describeViewSynthesis(): { mode: ViewSynthesisMode; model: string; endpoint: string } {
  const { url, hosted } = kontextUrl();
  return {
    mode: viewSynthesisCapability().mode,
    model: VIEW_MODEL,
    endpoint: hosted ? `${API_BASE}${url}` : url,
  };
}
