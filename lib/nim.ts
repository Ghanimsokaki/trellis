/**
 * NVIDIA NIM client — server side only.
 *
 * Two hosted NIMs are used:
 *  • microsoft/trellis  → 2D image (or text) → 3D GLB asset
 *  • FLUX.1 / SDXL NIM  → text → 2D concept render (fed into TRELLIS)
 *
 * All models live behind one key: https://build.nvidia.com
 */

import {
  DEFAULT_SETTINGS,
  type ConceptResponse,
  type EngineId,
  type GenSettings,
  type MeshMeta,
} from "./types";

export const API_BASE = (process.env.NVIDIA_API_BASE || "https://ai.api.nvidia.com/v1").replace(/\/+$/, "");
const NVCF_BASE = (process.env.NVIDIA_NVCF_BASE || "https://api.nvcf.nvidia.com/v2/nvcf").replace(/\/+$/, "");

export const TRELLIS_MODEL = process.env.NVIDIA_TRELLIS_MODEL || "microsoft/trellis";

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

export function isConfigured(): boolean {
  return resolveKey().key !== null;
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

function pickMessage(payload: Record<string, unknown>): string | undefined {
  const candidates = [payload.detail, payload.message, payload.error, payload.title, payload.raw];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim().slice(0, 400);
    if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      for (const key of ["message", "detail", "error", "description"]) {
        if (typeof nested[key] === "string" && (nested[key] as string).trim()) {
          return (nested[key] as string).trim().slice(0, 400);
        }
      }
    }
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
  options: { timeoutMs: number; label: string; retries?: number; allowNoKey?: boolean },
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

export function normalizeSettings(input?: Partial<GenSettings>): GenSettings {
  const merged = { ...DEFAULTS, ...(input ?? {}) };
  return {
    seed: Number.isFinite(merged.seed) && merged.seed > 0 ? Math.floor(clamp(merged.seed, 1, 2_147_483_646, 0)) : 0,
    slatSteps: Math.floor(clamp(merged.slatSteps, 10, 50, DEFAULTS.slatSteps)),
    ssSteps: Math.floor(clamp(merged.ssSteps, 10, 50, DEFAULTS.ssSteps)),
    slatCfg: clamp(merged.slatCfg, 1, 10, DEFAULTS.slatCfg),
    ssCfg: clamp(merged.ssCfg, 1, 10, DEFAULTS.ssCfg),
  };
}

/** Prompt used for the 2D concept render that TRELLIS lifts into 3D. */
export function buildConceptPrompt(prompt: string): string {
  const subject = prompt.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
  return [
    subject,
    "single isolated object, centered, full object visible in frame",
    "three-quarter front view, slightly above horizon",
    "plain light neutral studio background, soft even lighting, subtle contact shadow",
    "clean product render, crisp silhouette, high detail, no text, no watermark, no extra props",
  ].join(", ");
}

export type MeshInput =
  | { mode: "image"; image: string; prompt?: string | null }
  | { mode: "text"; prompt: string };

/** TRELLIS image-to-3D / text-to-3D. Returns a binary GLB. */
export async function generateMesh(
  input: MeshInput,
  settingsInput: Partial<GenSettings> | undefined,
  options: { engine: EngineId; imageModel?: string | null; conceptPrompt?: string | null; timeoutMs?: number },
): Promise<{ glb: Uint8Array; meta: MeshMeta }> {
  const settings = normalizeSettings(settingsInput);
  const started = Date.now();

  const payload: Record<string, unknown> = {
    mode: input.mode,
    seed: settings.seed,
    slat_cfg_scale: settings.slatCfg,
    ss_cfg_scale: settings.ssCfg,
    slat_sampling_steps: settings.slatSteps,
    ss_sampling_steps: settings.ssSteps,
  };

  if (input.mode === "image") {
    payload.image = input.image;
  } else {
    payload.prompt = input.prompt;
  }

  // Point this at a self-hosted TRELLIS NIM (…/v1/infer) if you run your own GPU.
  const trellisUrl = process.env.NVIDIA_TRELLIS_INFER_URL?.trim() || `/genai/${TRELLIS_MODEL}`;
  const selfHosted = /^https?:\/\//.test(trellisUrl);

  const { payload: result, requestId } = await callNim(trellisUrl, payload, {
    timeoutMs: options.timeoutMs ?? 290_000,
    label: "TRELLIS",
    retries: 1,
    allowNoKey: selfHosted,
  });

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
