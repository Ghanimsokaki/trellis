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
    let payload: Record<string, unknown> = {};
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const message =
      typeof payload.error === "string" && payload.error
        ? payload.error
        : `Request failed with HTTP ${response.status}.`;
    throw new ApiFailure(message, {
      hint: typeof payload.hint === "string" ? payload.hint : null,
      detail: typeof payload.detail === "string" ? payload.detail : null,
      requestId: typeof payload.requestId === "string" ? payload.requestId : null,
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
