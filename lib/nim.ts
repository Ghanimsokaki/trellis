/**
 * NVIDIA NIM client — server side only.
 *
 * Two hosted NIMs are used:
 *  • microsoft/trellis  → 2D image (or text) → 3D GLB asset
 *  • FLUX.1 / SDXL NIM  → text → 2D concept render (fed into TRELLIS)
 *
 * All models live behind one key: https://build.nvidia.com
 */

import { conceptSuffix } from "./prompts";
import {
  DEFAULT_SETTINGS,
  type ConceptResponse,
  type EngineId,
  type GenSettings,
  type MeshMeta,
} from "./types";

export const API_BASE = (process.env.NVIDIA_API_BASE || "https://ai.api.nvidia.com/v1").replace(/\/+$/, "");
const NVCF_BASE = (process.env.NVIDIA_NVCF_BASE || "https://api.nvcf.nvidia.com/v2/nvcf").replace(/\/+$/, "");
/** NVCF asset storage, used to hand images to hosted functions. */
const ASSETS_BASE = (process.env.NVIDIA_ASSETS_BASE || "https://api.nvcf.nvidia.com/v2/nvcf/assets").replace(/\/+$/, "");
/** OpenAI-compatible hosted base, used for the prompt-enhancement LLM. */
const CHAT_BASE = (process.env.NVIDIA_CHAT_BASE || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");

export const TRELLIS_MODEL = process.env.NVIDIA_TRELLIS_MODEL || "microsoft/trellis";
/** Small hosted chat model used to rewrite/expand prompts. */
export const ENHANCE_MODEL = process.env.NVIDIA_ENHANCE_MODEL || "meta/llama-3.1-8b-instruct";

/** Vision-language model used by the perceive layer of the layered forge. */
export const VISION_MODEL = process.env.NVIDIA_VISION_MODEL || "meta/llama-3.2-11b-vision-instruct";

/** Hosted TRELLIS validates `prompt` with length ≤ 77. */
export const TRELLIS_PROMPT_MAX = 77;

/**
 * Text-to-image NIMs used for the concept render stage. Both are free to call
 * with a build.nvidia.com key; `steps` stays inside each model's schema limits.
 */
export const IMAGE_MODELS = [
  {
    id: "black-forest-labs/flux.1-schnell",
    label: "FLUX.1 Schnell",
    note: "4-step distilled — fastest concept render",
    steps: 4,
  },
  {
    id: "black-forest-labs/flux.1-dev",
    label: "FLUX.1 Dev",
    note: "Higher fidelity, slower",
    steps: 30,
  },
] as const;

export const DEFAULT_IMAGE_MODEL = (() => {
  const fromEnv = process.env.NVIDIA_IMAGE_MODEL?.trim();
  if (fromEnv && IMAGE_MODELS.some((m) => m.id === fromEnv)) return fromEnv;
  return IMAGE_MODELS[0].id;
})();

/** Which env var supplied the key (never expose the value itself). */
export function resolveKey(): { key: string | null; variable: string | null } {
  const candidates = ["NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY", "NIM_API_KEY"] as const;
  for (const variable of candidates) {
    const value = process.env[variable];
    if (value && value.trim().length > 0) return { key: value.trim(), variable };
  }
  return { key: null, variable: null };
}

/** A self-hosted TRELLIS NIM (NVIDIA_TRELLIS_INFER_URL) needs no key. */
export function isSelfHosted(): boolean {
  return Boolean(process.env.NVIDIA_TRELLIS_INFER_URL?.trim());
}

export function isConfigured(): boolean {
  return resolveKey().key !== null || isSelfHosted();
}

export class NimError extends Error {
  status: number;
  code: string;
  hint?: string;
  requestId?: string;
  detail?: string;

  constructor(message: string, init: { status?: number; code?: string; hint?: string; requestId?: string; detail?: string } = {}) {
    super(message);
    this.name = "NimError";
    this.status = init.status ?? 500;
    this.code = init.code ?? "nim_error";
    this.hint = init.hint;
    this.requestId = init.requestId;
    this.detail = init.detail;
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      status: this.status,
      hint: this.hint ?? null,
      requestId: this.requestId ?? null,
      detail: this.detail ?? null,
    };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new NimError(
        `NVIDIA NIM did not answer within ${Math.round(timeoutMs / 1000)}s.`,
        {
          status: 504,
          code: "nim_timeout",
          hint: "TRELLIS can take 30–90s per asset. On Vercel Hobby, functions are capped at 60s — upgrade to Pro (300s) or retry.",
        },
      );
    }
    throw new NimError(
      `Could not reach NVIDIA NIM: ${error instanceof Error ? error.message : "network error"}`,
      { status: 502, code: "nim_network" },
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text.slice(0, 600) };
  }
}

/** Flatten FastAPI-style `detail: [{ loc, msg, type }]` into a readable string. */
function describeDetail(detail: unknown): string | undefined {
  if (typeof detail === "string" && detail.trim()) return detail.trim().slice(0, 600);
  if (Array.isArray(detail)) {
    const parts = detail
      .map((entry) => {
        if (!entry || typeof entry !== "object") return String(entry ?? "");
        const item = entry as Record<string, unknown>;
        const loc = Array.isArray(item.loc) ? item.loc.join(".") : "";
        const msg = typeof item.msg === "string" ? item.msg : typeof item.message === "string" ? item.message : "";
        return [loc, msg].filter(Boolean).join(": ");
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join(" · ").slice(0, 600);
  }
  if (detail && typeof detail === "object") {
    const nested = detail as Record<string, unknown>;
    for (const key of ["message", "detail", "error", "description", "msg"]) {
      const value = nested[key];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 600);
    }
    try {
      return JSON.stringify(detail).slice(0, 600);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function pickMessage(payload: Record<string, unknown>): string | undefined {
  for (const candidate of [payload.detail, payload.message, payload.error, payload.title, payload.raw]) {
    if (candidate === undefined || candidate === null) continue;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 600);
    const described = describeDetail(candidate);
    if (described) return described;
  }
  return undefined;
}

function mapHttpError(status: number, payload: Record<string, unknown>, requestId: string | null, label: string): NimError {
  const upstream = pickMessage(payload);
  const detail = upstream ? `${label}: ${upstream}` : `${label} failed (HTTP ${status}).`;

  if (status === 401 || status === 403) {
    return new NimError("NVIDIA NIM rejected the API key.", {
      status,
      code: "nim_auth",
      hint: "Create a free key at build.nvidia.com/settings/api-keys and set NVIDIA_API_KEY (Vercel → Settings → Environment Variables), then redeploy.",
      detail,
      requestId: requestId ?? undefined,
    });
  }
  if (status === 402) {
    return new NimError("NVIDIA NIM reports no remaining trial usage for this key.", {
      status,
      code: "nim_quota",
      hint: "Hosted NIM is free within per-model rate limits. Wait a moment, or self-host TRELLIS with an NGC key.",
      detail,
      requestId: requestId ?? undefined,
    });
  }
  if (status === 404) {
    return new NimError("That NIM model is not available on your account.", {
      status,
      code: "nim_model_unavailable",
      hint: "Check NVIDIA_TRELLIS_MODEL / NVIDIA_IMAGE_MODEL, and make sure the model is enabled on build.nvidia.com.",
      detail,
      requestId: requestId ?? undefined,
    });
  }
  if (status === 410) {
    return new NimError("NVIDIA no longer serves this endpoint for your organization.", {
      status,
      code: "nim_gone",
      hint: "Enable “Public API Endpoints” for your NVIDIA org, or switch models with NVIDIA_IMAGE_MODEL.",
      detail,
      requestId: requestId ?? undefined,
    });
  }
  if (status === 422 || status === 400) {
    return new NimError("NVIDIA NIM could not use the request payload.", {
      status,
      code: "nim_bad_request",
      hint: "Try a different image / shorter prompt, or reset the advanced sampling settings.",
      detail,
      requestId: requestId ?? undefined,
    });
  }
  if (status === 504 || status === 408) {
    return new NimError("The 3D job ran out of time before it finished.", {
      status: 504,
      code: "nim_timeout",
      hint: "Vercel caps function duration (60s on Hobby, 300s on Pro). Lower the sampling steps in the fast preset, or split the run: generate the image, then lift it.",
      detail,
      requestId: requestId ?? undefined,
    });
  }
  if (status === 429) {
    return new NimError("NVIDIA NIM rate limit hit.", {
      status,
      code: "nim_rate_limit",
      hint: "Free hosted NIM allows a limited number of requests per minute per model — wait ~30s and retry.",
      detail,
      requestId: requestId ?? undefined,
    });
  }
  if (status >= 500) {
    return new NimError("NVIDIA NIM returned an internal error.", {
      status,
      code: "nim_upstream",
      hint: "The hosted TRELLIS function occasionally errors out. Retry, or use another engine (Text → Image → 3D).",
      detail,
      requestId: requestId ?? undefined,
    });
  }
  return new NimError(detail, { status, code: "nim_error", detail, requestId: requestId ?? undefined });
}

/** Poll an async NVCF invocation until it finishes. */
async function pollNvcf(requestId: string, key: string, deadline: number, label: string): Promise<Record<string, unknown>> {
  const url = `${NVCF_BASE}/pexec/status/${encodeURIComponent(requestId)}`;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    await sleep(Math.min(1500 + attempt * 500, 4000));

    const response = await fetchWithTimeout(
      url,
      { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } },
      30_000,
    );

    const payload = await readJson(response);
    const status = response.headers.get("nvcf-status");

    if (response.ok && status !== "pending" && status !== "running" && status !== "fulfilled-pending") {
      return payload;
    }
    if (response.status === 202) continue;
    if (response.ok) continue;
    if (response.status === 429) continue;
    throw mapHttpError(response.status, payload, requestId, label);
  }

  throw new NimError("Timed out waiting for the NVIDIA NIM job to finish.", {
    status: 504,
    code: "nim_timeout",
    hint: "Hosted TRELLIS can queue for a while. Retry, or raise the function timeout on Vercel Pro/Enterprise.",
    requestId,
  });
}

async function callNim(
  path: string,
  body: Record<string, unknown>,
  options: { timeoutMs: number; label: string; retries?: number; allowNoKey?: boolean; headers?: Record<string, string> },
): Promise<{ payload: Record<string, unknown>; requestId: string | null }> {
  const { key } = resolveKey();
  if (!key && !options.allowNoKey) {
    throw new NimError("NVIDIA_API_KEY is not configured.", {
      status: 500,
      code: "nim_missing_key",
      hint: "Add NVIDIA_API_KEY to .env.local for local dev, or to Vercel → Settings → Environment Variables and redeploy.",
    });
  }

  const url = /^https?:\/\//.test(path) ? path : `${API_BASE}${path}`;
  const deadline = Date.now() + options.timeoutMs;
  const retries = options.retries ?? 1;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(options.headers ?? {}),
        },
        body: JSON.stringify(body),
      },
      Math.max(deadline - Date.now(), 15_000),
    );

    const requestId = response.headers.get("nvcf-reqid") ?? response.headers.get("nvcf-request-id");
    const upstreamStatus = response.headers.get("nvcf-status");

    if (response.status === 202 || upstreamStatus === "pending" || upstreamStatus === "running") {
      if (!requestId) {
        throw new NimError("NVIDIA NIM queued the job but returned no request id.", {
          status: 502,
          code: "nim_no_request_id",
        });
      }
      const payload = await pollNvcf(requestId, key ?? "", deadline, options.label);
      return { payload, requestId };
    }

    const payload = await readJson(response);
    if (response.ok) return { payload, requestId };

    const error = mapHttpError(response.status, payload, requestId, options.label);
    const retryable = response.status === 429 || response.status === 503 || (response.status === 500 && attempt < retries);
    if (retryable && attempt < retries) {
      await sleep(2500 + attempt * 2500);
      continue;
    }
    throw error;
  }

  throw new NimError("NVIDIA NIM request failed after retries.", { status: 502, code: "nim_upstream" });
}

type Artifact = { base64: string; seed?: number; finishReason?: string };

function extractArtifact(payload: Record<string, unknown>): Artifact | null {
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  const first = artifacts[0] as Record<string, unknown> | undefined;
  const candidates: unknown[] = [first?.base64, first?.data, first?.b64_json, payload.base64, payload.glb, payload.image];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 32) {
      const base64 = candidate.includes(",") ? candidate.slice(candidate.indexOf(",") + 1) : candidate;
      return {
        base64,
        seed: typeof first?.seed === "number" ? first.seed : undefined,
        finishReason: typeof first?.finishReason === "string" ? first.finishReason : undefined,
      };
    }
  }
  return null;
}

function assertSuccess(artifact: Artifact, requestId: string | null, modelLabel: string) {
  if (!artifact.finishReason || artifact.finishReason === "SUCCESS") return;
  if (artifact.finishReason === "CONTENT_FILTERED") {
    throw new NimError(`${modelLabel} blocked that request with its content filter.`, {
      status: 422,
      code: "content_filtered",
      hint: "Rewrite the prompt without people, brands or restricted content — product-style objects work best.",
      requestId: requestId ?? undefined,
    });
  }
  throw new NimError(`${modelLabel} reported ${artifact.finishReason}.`, {
    status: 502,
    code: "nim_artifact_error",
    hint: "Retry the generation, or simplify the prompt.",
    requestId: requestId ?? undefined,
  });
}

function sniffMime(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "image/webp";
  return "image/png";
}

const DEFAULTS: GenSettings = DEFAULT_SETTINGS;

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** CFG scales are `exclusiveMinimum: 1.0` in the TRELLIS schema — 1 is rejected. */
export const CFG_MIN = 1.05;

export function normalizeSettings(input?: Partial<GenSettings>): GenSettings {
  const merged = { ...DEFAULTS, ...(input ?? {}) };
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    seed: Number.isFinite(merged.seed) && merged.seed > 0 ? Math.floor(clamp(merged.seed, 1, 2_147_483_646, 0)) : 0,
    slatSteps: Math.floor(clamp(merged.slatSteps, 10, 50, DEFAULTS.slatSteps)),
    ssSteps: Math.floor(clamp(merged.ssSteps, 10, 50, DEFAULTS.ssSteps)),
    slatCfg: round(clamp(merged.slatCfg, CFG_MIN, 10, DEFAULTS.slatCfg)),
    ssCfg: round(clamp(merged.ssCfg, CFG_MIN, 10, DEFAULTS.ssCfg)),
  };
}

/** Prompt used for the 2D concept render that TRELLIS lifts into 3D. */
/**
 * TRELLIS rejects prompts longer than 77 characters, and it rejects the whole
 * request (422) rather than truncating. Trim on a word boundary and drop
 * trailing filler so the surviving text still reads as a description.
 */
export function clampTrellisPrompt(prompt: string): string {
  const flat = prompt.replace(/\s+/g, " ").trim();
  if (flat.length <= TRELLIS_PROMPT_MAX) return flat;

  const words = flat.split(" ");
  const kept: string[] = [];
  for (const word of words) {
    const next = [...kept, word].join(" ");
    if (next.length > TRELLIS_PROMPT_MAX) break;
    kept.push(word);
  }
  const clipped = (kept.length > 0 ? kept.join(" ") : flat.slice(0, TRELLIS_PROMPT_MAX))
    .replace(/[,;:.\-\s]+$/, "")
    .trim();
  return clipped || flat.slice(0, TRELLIS_PROMPT_MAX);
}

export function buildConceptPrompt(prompt: string): string {
  return `${prompt.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "")}, ${conceptSuffix("three-quarter")}`;
}

export type MeshInput =
  | { mode: "image"; image: string; prompt?: string | null; images?: string[] }
  | { mode: "text"; prompt: string };

type TrellisPayload = Record<string, unknown>;

type ImageRef = { mime: string; base64: string };

function parseDataUrl(value: string): ImageRef | null {
  const match = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(value.trim());
  if (!match) return null;
  return { mime: match[1].toLowerCase(), base64: match[2].replace(/\s+/g, "") };
}

/**
 * Upload an image to NVCF asset storage.
 *
 * Hosted functions other than the small-inline case require assets: POST to the
 * assets API for a presigned URL, PUT the bytes, then reference the returned id
 * with `NVCF-INPUT-ASSET-REFERENCES`. This is the documented path for any image
 * that does not fit inline (~180 KB) and the only path the hosted TRELLIS
 * gateway accepts for some accounts — it rejects `;base64,` with
 * "Expected: example_id, got: base64".
 */
async function uploadAsset(
  data: Uint8Array,
  mime: string,
  options: { timeoutMs?: number } = {},
): Promise<{ assetId: string; bytes: number }> {
  const { key } = resolveKey();
  if (!key) {
    throw new NimError("An API key is required to upload the image as an NVCF asset.", {
      status: 500,
      code: "nim_missing_key",
    });
  }

  const createResponse = await fetchWithTimeout(
    ASSETS_BASE,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ contentType: mime, description: "Trellis Forge reference image" }),
    },
    options.timeoutMs ?? 30_000,
  );

  const created = await readJson(createResponse);
  if (!createResponse.ok) {
    throw mapHttpError(createResponse.status, created, createResponse.headers.get("nvcf-reqid"), "Asset upload");
  }

  const assetId = typeof created.assetId === "string" ? created.assetId : null;
  const uploadUrl = typeof created.uploadUrl === "string" ? created.uploadUrl : null;
  if (!assetId || !uploadUrl) {
    throw new NimError("NVIDIA's asset service did not return an upload URL.", {
      status: 502,
      code: "asset_create_failed",
      detail: JSON.stringify(created).slice(0, 300),
    });
  }

  const putResponse = await fetchWithTimeout(
    uploadUrl,
    {
      method: "PUT",
      headers: {
        "x-amz-meta-nvcf-asset-description": "Trellis Forge reference image",
        "content-type": mime,
      },
      body: new Uint8Array(data),
    },
    options.timeoutMs ?? 60_000,
  );

  if (!putResponse.ok) {
    throw new NimError("Uploading the image to NVIDIA's asset store failed.", {
      status: 502,
      code: "asset_put_failed",
      hint: "Retry — presigned URLs expire quickly. If it persists, use a smaller image.",
      detail: `HTTP ${putResponse.status} from the presigned URL`,
    });
  }

  return { assetId, bytes: data.byteLength };
}

/** Base URL of NVCF asset storage (reported by /api/health). */
export const ASSETS_API_BASE = ASSETS_BASE;

/**
 * How the image is referenced for a hosted TRELLIS call.
 * `NVIDIA_TRELLIS_IMAGE_REF` can force one: auto | asset | base64.
 */
function hostedImageRefMode(): "auto" | "asset" | "base64" {
  const value = (process.env.NVIDIA_TRELLIS_IMAGE_REF || "auto").toLowerCase();
  if (value === "asset" || value === "base64") return value;
  return "auto";
}

/**
 * Build one TRELLIS body.
 *
 * The hosted gateway validates more strictly than the container schema (the
 * reference snippet on build.nvidia.com sends image + seed only), so the body
 * stays minimal and only carries fields the user actually changed. `mode` is
 * omitted on purpose — NIM infers it from image/prompt.
 */
function buildTrellisPayload(input: MeshInput, settings: GenSettings | null): TrellisPayload {
  const media: TrellisPayload =
    input.mode === "image"
      ? { image: input.images && input.images.length > 1 ? input.images : input.image }
      : { prompt: clampTrellisPrompt(input.prompt) };

  const body: TrellisPayload = { ...media, seed: settings?.seed ?? 0 };
  if (!settings) return body;

  if (settings.slatCfg !== DEFAULT_SETTINGS.slatCfg) body.slat_cfg_scale = settings.slatCfg;
  if (settings.ssCfg !== DEFAULT_SETTINGS.ssCfg) body.ss_cfg_scale = settings.ssCfg;
  if (settings.slatSteps !== DEFAULT_SETTINGS.slatSteps) body.slat_sampling_steps = settings.slatSteps;
  if (settings.ssSteps !== DEFAULT_SETTINGS.ssSteps) body.ss_sampling_steps = settings.ssSteps;
  if (input.mode === "image" && input.images && input.images.length > 1) body.multiimage_algo = "multidiffusion";

  return body;
}

/** Turn a schema rejection on the final rung into something a human can act on. */
function rejectionError(mode: "text" | "image", error: NimError, trail: string[]): NimError {
  const wantsExample = /example_id/i.test(error.detail ?? "");
  const detail = trail.join(" | ");

  if (mode === "text") {
    return new NimError("NVIDIA rejected the text prompt.", {
      status: error.status,
      code: "nim_prompt_rejected",
      hint: wantsExample
        ? "This hosted TRELLIS function only accepts catalog examples (`example_id`) on some accounts, so free-form prompts are refused. Run your own TRELLIS NIM, or use the Image → 3D tab with a reference picture."
        : "Shorten the prompt and retry, or switch to Image → 3D with a reference picture.",
      detail,
      requestId: error.requestId ?? undefined,
    });
  }

  return new NimError("NVIDIA rejected every way of sending that image.", {
    status: error.status,
    code: "nim_image_rejected",
    hint: wantsExample
      ? "The hosted TRELLIS function is asking for a catalog example (`example_id`), which means this account is not accepting user images. Try the Prompt → Direct text → 3D tab, run your own TRELLIS NIM via NVIDIA_TRELLIS_INFER_URL, or use the build.nvidia.com playground."
      : "Try a smaller image, the Direct text → 3D engine, or a self-hosted TRELLIS NIM (NVIDIA_TRELLIS_INFER_URL).",
    detail,
    requestId: error.requestId ?? undefined,
  });
}

export async function generateMesh(
  input: MeshInput,
  settingsInput: Partial<GenSettings> | undefined,
  options: {
    engine: EngineId;
    imageModel?: string | null;
    conceptPrompt?: string | null;
    timeoutMs?: number;
  },
): Promise<{ glb: Uint8Array; meta: MeshMeta }> {
  const settings = normalizeSettings(settingsInput);
  const started = Date.now();

  // Point this at a self-hosted TRELLIS NIM (…/v1/infer) if you run your own GPU.
  const trellisUrl = process.env.NVIDIA_TRELLIS_INFER_URL?.trim() || `/genai/${TRELLIS_MODEL}`;
  const selfHosted = /^https?:\/\//.test(trellisUrl);
  const timeoutMs = options.timeoutMs ?? 290_000;

  type Attempt = { body: TrellisPayload; headers?: Record<string, string>; label: string };
  const attempts: Attempt[] = [];
  const notes: string[] = [];

  if (input.mode === "image") {
    const sources = input.images && input.images.length > 1 ? input.images : [input.image];
    const refs = sources
      .map(parseDataUrl)
      .filter((entry): entry is ImageRef => entry !== null);
    const refMode = hostedImageRefMode();
    const inline = { body: buildTrellisPayload(input, settings), label: "inline base64" };

    if (selfHosted || refMode === "base64" || refs.length === 0) {
      // Local NIM containers take inline base64; so does the last-ditch attempt.
      attempts.push(inline);
    } else {
      // Hosted: upload to NVCF asset storage, then reference the ids. This is the
      // only shape the hosted gateway reliably accepts — inline base64 gets
      // "Expected: example_id, got: base64" for anything past the tiny-image case.
      const uploaded: { assetId: string; mime: string }[] = [];
      for (const ref of refs) {
        try {
          const bytes = new Uint8Array(Buffer.from(ref.base64, "base64"));
          const asset = await uploadAsset(bytes, ref.mime, { timeoutMs: 90_000 });
          uploaded.push({ assetId: asset.assetId, mime: ref.mime });
          notes.push(`asset ${asset.assetId} (${Math.round(asset.bytes / 1024)} KB ${ref.mime})`);
        } catch (error) {
          const reason =
            error instanceof NimError ? `${error.message}${error.detail ? ` — ${error.detail}` : ""}` : "unknown error";
          notes.push(`asset upload failed: ${reason}`);
          break;
        }
      }

      if (uploaded.length === refs.length && uploaded.length > 0) {
        const ids = uploaded.map((entry) => entry.assetId).join(",");
        const headers = { "NVCF-INPUT-ASSET-REFERENCES": ids };
        const assetUrls = uploaded.map((entry) => `data:${entry.mime};asset_id,${entry.assetId}`);
        const assetMedia = assetUrls.length > 1 ? assetUrls : assetUrls[0];

        attempts.push({
          body: {
            image: assetMedia,
            seed: settings.seed,
            ...(uploaded.length > 1 ? { multiimage_algo: "multidiffusion" } : {}),
          },
          headers,
          label: `asset reference (${uploaded.length} view${uploaded.length > 1 ? "s" : ""})`,
        });
        if (uploaded.length === 1) {
          attempts.push({ body: { image: uploaded[0].assetId, seed: settings.seed }, headers, label: "bare asset id" });
        }
      }

      attempts.push(inline);
    }
  } else {
    attempts.push({ body: buildTrellisPayload(input, settings), label: "text prompt" });
  }

  // De-duplicate identical bodies+headers.
  const seen = new Set<string>();
  const unique = attempts.filter((attempt) => {
    const key = JSON.stringify([attempt.body, attempt.headers ?? {}]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let result: Record<string, unknown> | null = null;
  let requestId: string | null = null;
  let imageRef: "asset" | "inline" | undefined = undefined;
  const tried: string[] = [];

  for (let index = 0; index < unique.length; index += 1) {
    const attempt = unique[index];
    try {
      const response = await callNim(trellisUrl, attempt.body, {
        timeoutMs,
        label: "TRELLIS",
        retries: index === 0 ? 1 : 0,
        allowNoKey: selfHosted,
        headers: attempt.headers,
      });
      result = response.payload;
      requestId = response.requestId;
      imageRef = attempt.label.startsWith("asset") || attempt.label === "bare asset id" ? "asset" : "inline";
      if (index > 0) tried.push(`accepted via ${attempt.label}`);
      break;
    } catch (error) {
      if (!(error instanceof NimError)) throw error;
      tried.push(`${index + 1}/${unique.length} ${attempt.label}: ${error.status} ${error.detail ?? error.message}`);
      const schemaProblem = error.status === 400 || error.status === 422;
      if (!schemaProblem) throw error;
      // The last rung: explain what the gateway actually wants.
      if (index === unique.length - 1) {
        throw rejectionError(input.mode, error, [...notes, ...tried]);
      }
    }
  }

  if (!result) {
    throw new NimError("TRELLIS request failed.", { status: 502, code: "nim_upstream", detail: tried.join(" | ") });
  }

  const artifact = extractArtifact(result);
  if (!artifact) {
    throw new NimError("TRELLIS returned no 3D artifact.", {
      status: 502,
      code: "nim_empty_artifact",
      hint: "Retry — the hosted function sometimes returns an empty payload. If it persists, use a simpler prompt.",
      requestId: requestId ?? undefined,
      detail: JSON.stringify(result).slice(0, 400),
    });
  }

  assertSuccess(artifact, requestId ?? null, "TRELLIS");

  const bytes = new Uint8Array(Buffer.from(artifact.base64, "base64"));
  const isGlb = bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46; // "glTF"
  if (!isGlb) {
    throw new NimError("TRELLIS returned data that is not a GLB file.", {
      status: 502,
      code: "nim_bad_artifact",
      hint: "Retry the generation.",
      requestId: requestId ?? undefined,
      detail: `first bytes: ${Array.from(bytes.slice(0, 8)).join(" ")}`,
    });
  }

  const meta: MeshMeta = {
    engine: options.engine,
    mode: input.mode,
    prompt: input.mode === "text" ? input.prompt : input.prompt ?? null,
    seed: artifact.seed ?? settings.seed,
    model: TRELLIS_MODEL,
    imageModel: options.imageModel ?? null,
    conceptPrompt: options.conceptPrompt ?? null,
    elapsedMs: Date.now() - started,
    bytes: bytes.byteLength,
    requestId: requestId ?? null,
    createdAt: new Date().toISOString(),
    ...(input.mode === "image" && imageRef ? { imageRef } : {}),
  };

  return { glb: bytes, meta };
}

/** Text → 2D concept render (FLUX / SDXL NIM). */
export async function generateConcept(
  prompt: string,
  settingsInput: Partial<GenSettings> | undefined,
  options: { model?: string } = {},
): Promise<ConceptResponse> {
  const settings = normalizeSettings(settingsInput);
  const model = options.model && IMAGE_MODELS.some((m) => m.id === options.model) ? options.model : DEFAULT_IMAGE_MODEL;
  const steps = IMAGE_MODELS.find((m) => m.id === model)?.steps ?? 4;
  const enhanced = buildConceptPrompt(prompt);
  const started = Date.now();

  const body: Record<string, unknown> = {
    prompt: enhanced,
    width: 1024,
    height: 1024,
    seed: settings.seed,
    steps,
  };
  // NIM models validate strictly, so only send fields each family supports.
  if (model.includes("flux.1-dev")) {
    body.mode = "base";
    body.steps = Math.max(steps, 25);
  }

  const { payload, requestId } = await callNim(`/genai/${model}`, body, {
    timeoutMs: 120_000,
    label: "Concept render",
    retries: 1,
  });

  const artifact = extractArtifact(payload);
  if (!artifact) {
    throw new NimError("The concept render returned no image.", {
      status: 502,
      code: "nim_empty_artifact",
      hint: "Retry, or pick another text-to-image model in the advanced settings.",
      requestId: requestId ?? undefined,
    });
  }

  assertSuccess(artifact, requestId ?? null, "Concept render");

  const bytes = Buffer.from(artifact.base64, "base64");
  if (bytes.byteLength > 3_600_000) {
    throw new NimError("The concept render is too large to send back through the API.", {
      status: 502,
      code: "concept_too_large",
    });
  }

  return {
    image: `data:${sniffMime(new Uint8Array(bytes))};base64,${artifact.base64}`,
    prompt: enhanced,
    rawPrompt: prompt,
    seed: artifact.seed ?? settings.seed,
    model,
    elapsedMs: Date.now() - started,
  };
}

/**
 * Prompt rewriting with a hosted chat NIM (OpenAI-compatible endpoint).
 * Returns a single-line, model-friendly description of the subject.
 */
export async function enhancePrompt(
  prompt: string,
  options: { timeoutMs?: number } = {},
): Promise<{ prompt: string; model: string; elapsedMs: number }> {
  const started = Date.now();
  const system = [
    "You rewrite prompts for a text-to-3D asset generator (Microsoft TRELLIS).",
    "Given a short description, return ONE line, max 90 words, describing the object itself:",
    "its form, main parts, materials and colours, as a single isolated object.",
    "Mention geometry words (hull, saucer, nacelle, pylon, handle, spout, roof, legs) when relevant.",
    "Never add scenes, background, lighting, camera, mood, brand names, people or text.",
    "No preamble, no quotes, no lists — output the prompt only.",
  ].join(" ");

  const { payload } = await callNim(
    `${CHAT_BASE}/chat/completions`,
    {
      model: ENHANCE_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt.slice(0, 600) },
      ],
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 220,
      stream: false,
    },
    { timeoutMs: options.timeoutMs ?? 30_000, label: "Prompt enhancer", retries: 1 },
  );

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = (choices[0] as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined;
  const content = typeof message?.content === "string" ? message.content : "";

  const cleaned = content
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^["'“”\s]+|["'“”\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < 8) {
    throw new NimError("The prompt enhancer returned nothing usable.", {
      status: 502,
      code: "enhance_empty",
      hint: "Try again, or use the offline enhancer (it adds shape and material words locally).",
    });
  }

  return { prompt: cleaned.slice(0, 600), model: ENHANCE_MODEL, elapsedMs: Date.now() - started };
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

/**
 * OpenAI-compatible chat call against the hosted integrate endpoint.
 * Used by the perceive (vision) and resolve layers.
 */
export async function chatNim(
  messages: ChatMessage[],
  options: {
    model?: string;
    timeoutMs?: number;
    label?: string;
    temperature?: number;
    maxTokens?: number;
    responseFormat?: "json" | null;
  } = {},
): Promise<{ content: string; model: string; requestId: string | null; elapsedMs: number }> {
  const started = Date.now();
  const model = options.model || ENHANCE_MODEL;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.2,
    top_p: 0.9,
    max_tokens: options.maxTokens ?? 700,
    stream: false,
  };
  if (options.responseFormat === "json") body.response_format = { type: "json_object" };

  const { payload, requestId } = await callNim(`${CHAT_BASE}/chat/completions`, body, {
    timeoutMs: options.timeoutMs ?? 45_000,
    label: options.label ?? "Chat",
    retries: 1,
  });

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = (choices[0] as Record<string, unknown> | undefined)?.message as Record<string, unknown> | undefined;
  const content = typeof message?.content === "string" ? message.content : "";

  if (!content.trim()) {
    throw new NimError(`${options.label ?? "Chat"} returned an empty message.`, {
      status: 502,
      code: "chat_empty",
      requestId: requestId ?? undefined,
    });
  }

  return { content, model, requestId: requestId ?? null, elapsedMs: Date.now() - started };
}
