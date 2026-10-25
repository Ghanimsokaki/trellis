"use client";

import type { ConceptResponse, GenSettings, MeshMeta } from "./types";

export class ApiFailure extends Error {
  hint: string | null;
  detail: string | null;
  requestId: string | null;
  status: number;

  constructor(
    message: string,
    options: { hint?: string | null; detail?: string | null; requestId?: string | null; status?: number } = {},
  ) {
    super(message);
    this.name = "ApiFailure";
    this.hint = options.hint ?? null;
    this.detail = options.detail ?? null;
    this.requestId = options.requestId ?? null;
    this.status = options.status ?? 500;
  }
}

async function postJson(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiFailure("The studio could not reach its own API route.", {
      hint: "Check that the dev server / deployment is running, then retry.",
    });
  }

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    let payload: Record<string, unknown> = {};
    let text = "";
    try {
      if (contentType.includes("application/json")) {
        payload = (await response.json()) as Record<string, unknown>;
      } else {
        text = await response.text();
      }
    } catch {
      payload = {};
    }

    if (typeof payload.error === "string" && payload.error) {
      throw new ApiFailure(payload.error, {
        hint: typeof payload.hint === "string" ? payload.hint : null,
        detail: typeof payload.detail === "string" ? payload.detail : null,
        requestId: typeof payload.requestId === "string" ? payload.requestId : null,
        status: response.status,
      });
    }

    // The platform (not our route) answered — a killed function returns HTML.
    if (response.status === 504) {
      throw new ApiFailure("The 3D job ran past the function time limit.", {
        hint:
          "Vercel stops functions at 60s on Hobby and 300s on Pro. The studio will retry in Fast mode (15 steps) automatically — you can also lower the steps yourself.",
        detail: text.slice(0, 300) || null,
        status: 504,
      });
    }
    if (response.status === 413) {
      throw new ApiFailure("The upload was too large for the serverless function.", {
        hint: "Keep a single 1024² view under ~3 MB. The studio already downscales — try one view instead of several.",
        detail: text.slice(0, 300) || null,
        status: 413,
      });
    }
    if (response.status === 502 || response.status === 503) {
      throw new ApiFailure("The server could not reach NVIDIA NIM.", {
        hint: "NVIDIA's hosted TRELLIS function occasionally errors out. Retry in a moment, or use the other engine.",
        detail: text.slice(0, 300) || null,
        status: response.status,
      });
    }

    throw new ApiFailure(`Request failed with HTTP ${response.status}.`, {
      detail: text.slice(0, 300) || null,
      status: response.status,
    });
  }

  return response;
}

function decodeMeta(header: string): MeshMeta | null {
  try {
    const binary = atob(header);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as MeshMeta;
  } catch {
    return null;
  }
}

function fallbackMeta(bytes: number): MeshMeta {
  return {
    engine: "image",
    mode: "image",
    prompt: null,
    seed: 0,
    model: "microsoft/trellis",
    imageModel: null,
    conceptPrompt: null,
    elapsedMs: 0,
    bytes,
    requestId: null,
    createdAt: new Date().toISOString(),
  };
}

export async function requestConcept(
  payload: { prompt: string; settings: GenSettings; imageModel: string },
  signal: AbortSignal,
): Promise<ConceptResponse> {
  const response = await postJson("/api/concept", payload, signal);
  return (await response.json()) as ConceptResponse;
}

export async function requestMesh(
  payload: {
    mode: "text" | "image";
    prompt?: string;
    image?: string;
    images?: string[];
    engine: "pipeline" | "trellis-text" | "image";
    imageModel?: string | null;
    conceptPrompt?: string | null;
    settings: GenSettings;
  },
  signal: AbortSignal,
): Promise<{ blob: Blob; meta: MeshMeta }> {
  const response = await postJson("/api/generate", payload, signal);
  const blob = await response.blob();
  const header = response.headers.get("x-trellis-meta");
  const meta = header ? decodeMeta(header) : null;
  return { blob, meta: meta ?? fallbackMeta(blob.size) };
}

export type EnhanceResponse = {
  prompt: string;
  original: string;
  model: string;
  elapsedMs: number;
  offline: boolean;
  addedShapeWords: boolean;
  fallbackReason?: string;
};

/** Meshy-style prompt improvement (LLM NIM, with an offline fallback). */
export async function requestEnhance(prompt: string, signal?: AbortSignal): Promise<EnhanceResponse> {
  const response = await fetch("/api/enhance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal,
  });
  if (!response.ok) {
    let message = `Prompt enhancement failed (HTTP ${response.status}).`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      /* keep the generic message */
    }
    throw new ApiFailure(message, { status: response.status });
  }
  return (await response.json()) as EnhanceResponse;
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" : error instanceof Error && error.name === "AbortError";
}

export function slugifyPrompt(prompt: string | null): string {
  if (!prompt) return "trellis-asset";
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .split("-")
    .slice(0, 4)
    .join("-");
  return slug || "trellis-asset";
}
