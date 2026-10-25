/**
 * Shared types used by both the browser UI and the server routes.
 * Keep this file free of Node-only imports.
 */

export type EngineId = "pipeline" | "trellis-text" | "image";

export type GenSettings = {
  /** 0 = let the model pick a random seed */
  seed: number;
  /** structured-latent (SLAT) diffusion steps */
  slatSteps: number;
  /** sparse-structure diffusion steps */
  ssSteps: number;
  /** structured-latent classifier-free guidance */
  slatCfg: number;
  /** sparse-structure classifier-free guidance */
  ssCfg: number;
};

export const DEFAULT_SETTINGS: GenSettings = {
  seed: 0,
  slatSteps: 25,
  ssSteps: 25,
  slatCfg: 3,
  ssCfg: 7.5,
};

export type MeshMeta = {
  engine: EngineId;
  mode: "text" | "image";
  prompt: string | null;
  seed: number;
  model: string;
  imageModel: string | null;
  conceptPrompt: string | null;
  elapsedMs: number;
  bytes: number;
  requestId: string | null;
  createdAt: string;
};

export type ConceptResponse = {
  image: string;
  prompt: string;
  rawPrompt: string;
  seed: number;
  model: string;
  elapsedMs: number;
};

export type HealthResponse = {
  configured: boolean;
  hasKey: boolean;
  selfHosted: boolean;
  authVariable: string | null;
  trellisModel: string;
  imageModel: string;
  imageModels: string[];
  apiBase: string;
  maxDurationSeconds: number;
};

export type StepState = "idle" | "active" | "done" | "error";

export type PipelineStage = {
  id: string;
  label: string;
  detail: string;
  state: StepState;
};

export type Asset = {
  id: string;
  url: string;
  bytes: number;
  name: string;
  meta: MeshMeta;
  conceptImage: string | null;
  stats: { triangles: number; vertices: number; meshes: number } | null;
  createdAt: number;
};

export function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_646) + 1;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}
