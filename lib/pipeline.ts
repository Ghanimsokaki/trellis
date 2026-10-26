/**
 * The multi-layer forge.
 *
 * NVIDIA's hosted TRELLIS preview only reconstructs four catalogue images
 * (`data:image/png;example_id,0…3`), so a user photo cannot be lifted to a mesh
 * on that endpoint at any price — inline base64 and NVCF assets are both
 * rejected. Instead of failing, the forge runs the photo through layers:
 *
 *   1. perceive  — a vision NIM describes the object, its parts and palette
 *   2. resolve   — optional web search for more references / a matching asset
 *   3. forge     — TRELLIS image mode when a self-hosted NIM is available
 *                  (exact), otherwise TRELLIS text mode on the description
 *   4. report    — every layer, its outcome and the resulting fidelity
 *
 * A self-hosted TRELLIS (`NVIDIA_TRELLIS_INFER_URL`) keeps the photo itself, so
 * the mesh is image-conditioned and exact. On the hosted preview the mesh is a
 * reconstruction of the description — labelled as such in the UI.
 */
import { NimError, generateMesh, isSelfHosted, normalizeSettings } from "./nim";
import { searchCompatible, toSources } from "./search";
import { analyzeImage, fitPrompt, specFromPrompt } from "./vision";
import type {
  EngineId,
  Fidelity,
  ForgeRoute,
  GenSettings,
  ImageSpec,
  LayerInfo,
  MeshMeta,
} from "./types";

export type ForgeInput =
  | { mode: "image"; image: string; images?: string[]; prompt?: string | null; engine: EngineId }
  | { mode: "text"; prompt: string; engine: EngineId };

export type ForgeOptions = {
  imageModel?: string | null;
  conceptPrompt?: string | null;
  /** Set false to skip the resolve layer's web search for this run. */
  search?: boolean;
  timeoutMs?: number;
};

export type ForgeResult = { glb: Uint8Array; meta: MeshMeta };

type Layer = Omit<LayerInfo, "state"> & { state: LayerInfo["state"] };

class Recorder {
  readonly layers: Layer[] = [];

  async run<T>(id: string, label: string, task: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      const value = await task();
      this.layers.push({ id, label, state: "done", detail: "ok", ms: Date.now() - started });
      return value;
    } catch (error) {
      this.layers.push({
        id,
        label,
        state: "failed",
        detail: error instanceof Error ? error.message.slice(0, 180) : "unknown error",
        ms: Date.now() - started,
      });
      throw error;
    }
  }

  skip(id: string, label: string, detail: string) {
    this.layers.push({ id, label, state: "skipped", detail, ms: 0 });
  }

  note(id: string, detail: string) {
    const layer = this.layers.find((entry) => entry.id === id);
    if (layer) layer.detail = detail.slice(0, 220);
  }
}

function fidelityFor(route: ForgeRoute): Fidelity {
  if (route === "image-native") return "exact";
  return "described";
}

/**
 * Should the forge even try TRELLIS image mode against the hosted gateway?
 * `NVIDIA_TRELLIS_IMAGE_MODE=always` opts in (for accounts that do serve user
 * images); the default skips three doomed requests (~90 s) and goes straight to
 * the caption bridge.
 */
function tryHostedImage(): boolean {
  const mode = (process.env.NVIDIA_TRELLIS_IMAGE_MODE || "auto").toLowerCase();
  return mode === "always" || mode === "force";
}

function describeRoute(route: ForgeRoute, selfHosted: boolean): string {
  if (route === "image-native") return "TRELLIS image mode · the photo itself conditions the mesh";
  if (route === "text-only") return "TRELLIS text mode · built from your written prompt";
  return selfHosted
    ? "TRELLIS text mode · description of the photo"
    : "TRELLIS text mode · hosted preview refuses user photos, so the description drives the mesh";
}

export async function runLayeredForge(
  input: ForgeInput,
  settingsInput: Partial<GenSettings> | undefined,
  options: ForgeOptions = {},
): Promise<ForgeResult> {
  const settings = normalizeSettings(settingsInput);
  const recorder = new Recorder();
  const selfHosted = isSelfHosted();

  // ---------------------------------------------------------------- text only
  if (input.mode === "text") {
    const prompt = input.prompt.trim();
    const result = await recorder.run("forge", "Forge", () =>
      generateMesh({ mode: "text", prompt }, settings, {
        engine: input.engine === "pipeline" ? "trellis-text" : input.engine,
        timeoutMs: options.timeoutMs,
      }),
    );
    const sent = fitPrompt(prompt, "a detailed isolated 3D asset");
    recorder.note("forge", `“${sent}” (${sent.length}/77 chars${sent.length < prompt.length ? ", clipped" : ""})`);
    return {
      glb: result.glb,
      meta: {
        ...result.meta,
        route: "text-only",
        fidelity: "described",
        layers: recorder.layers,
        spec: null,
        sources: [],
      },
    };
  }

  // -------------------------------------------------------- 1. perceive layer
  const primary = input.image;
  const extraViews = (input.images ?? []).filter((view) => view && view !== primary);
  let spec: ImageSpec;
  let visionModel: string | null = null;
  let perceiveWarning: string | undefined;

  try {
    const analysed = await recorder.run("perceive", "Perceive", () =>
      analyzeImage(primary, { prompt: input.prompt ?? null }),
    );
    spec = analysed.spec;
    visionModel = analysed.model;
    perceiveWarning = analysed.warning;
    recorder.note(
      "perceive",
      analysed.usedVision
        ? `${spec.subject} · ${spec.category} · ${Math.round(spec.confidence * 100)}% confident`
        : `description from your brief (${perceiveWarning ?? "vision unavailable"})`,
    );
  } catch (error) {
    if (!(input.prompt ?? "").trim()) {
      throw new NimError("Could not read that image, and there is no written prompt to fall back on.", {
        status: 502,
        code: "perceive_failed",
        hint: "Add a one-line description next to the image (e.g. “oval saucer hull with two nacelles”), or retry with a clearer crop.",
        detail: error instanceof NimError ? error.detail : error instanceof Error ? error.message : undefined,
      });
    }
    spec = specFromPrompt(input.prompt as string);
    recorder.note("perceive", "vision unavailable — used the written brief");
  }

  // --------------------------------------------------------- 2. resolve layer
  let searchReport = null as Awaited<ReturnType<typeof searchCompatible>> | null;
  if (options.search === false) {
    recorder.skip("resolve", "Resolve", "web search disabled for this run");
  } else {
    try {
      searchReport = await recorder.run("resolve", "Resolve", () => searchCompatible(spec));
      if (!searchReport.enabled) {
        const layer = recorder.layers.find((entry) => entry.id === "resolve");
        if (layer) layer.state = "skipped";
      }
      recorder.note(
        "resolve",
        searchReport.enabled
          ? `${searchReport.provider} · ${searchReport.hits.length} reference${searchReport.hits.length === 1 ? "" : "s"} · ${searchReport.assets.length} catalogue link${searchReport.assets.length === 1 ? "" : "s"}${searchReport.note ? ` — ${searchReport.note}` : ""}`
          : searchReport.note ?? "search disabled",
      );
    } catch (error) {
      recorder.skip("resolve", "Resolve", error instanceof Error ? error.message : "search unavailable");
    }
  }

  // ----------------------------------------------------------- 3. route choice
  const wantsNative = selfHosted || tryHostedImage();
  let route: ForgeRoute = wantsNative ? "image-native" : "caption-bridge";

  const forgeNative = async () =>
    generateMesh(
      {
        mode: "image",
        image: primary,
        images: extraViews.length > 0 ? [primary, ...extraViews] : undefined,
        prompt: input.prompt ?? null,
      },
      settings,
      { engine: input.engine === "pipeline" ? "pipeline" : "image", timeoutMs: options.timeoutMs },
    );

  let result: Awaited<ReturnType<typeof generateMesh>> | null = null;

  if (route === "image-native") {
    const started = Date.now();
    try {
      result = await forgeNative();
      recorder.layers.push({
        id: "forge",
        label: "Forge",
        state: "done",
        detail: `${describeRoute(route, selfHosted)}${extraViews.length > 0 ? ` · ${extraViews.length + 1} views` : ""}`,
        ms: Date.now() - started,
      });
    } catch (error) {
      const rejected =
        error instanceof NimError &&
        (error.code === "nim_image_rejected" ||
          /example_id|invalid form/i.test(`${error.detail ?? ""} ${error.message}`));
      if (!rejected) throw error;
      recorder.layers.push({
        id: "forge",
        label: "Forge · image mode",
        state: "failed",
        detail: "the endpoint accepts catalogue example_ids only — switching to the caption bridge",
        ms: Date.now() - started,
      });
      route = "caption-bridge";
    }
  }

  // ------------------------------------------------------ 4. caption bridge
  if (!result) {
    const caption = fitPrompt(spec.prompt, spec.subject || "a detailed isolated 3D asset");
    result = await recorder.run("bridge", "Caption → 3D", () =>
      generateMesh({ mode: "text", prompt: caption }, settings, {
        engine: "trellis-text",
        timeoutMs: options.timeoutMs,
      }),
    );
    recorder.note("bridge", `“${caption}” (${caption.length}/77 chars)`);
  }

  if (extraViews.length > 0 && route !== "image-native") {
    recorder.skip(
      "views",
      "Multi-view",
      `${extraViews.length} extra view${extraViews.length === 1 ? "" : "s"} ignored — the hosted endpoint takes text only. Self-host TRELLIS to use them.`,
    );
  }

  const sources = searchReport ? toSources(searchReport) : [];

  return {
    glb: result.glb,
    meta: {
      ...result.meta,
      // Keep the original intent: the browser asked for an image-conditioned asset.
      mode: "image",
      engine: input.engine,
      prompt: input.mode === "image" ? (input.prompt ?? spec.prompt) : result.meta.prompt,
      imageModel: options.imageModel ?? result.meta.imageModel,
      conceptPrompt: options.conceptPrompt ?? result.meta.conceptPrompt,
      route,
      fidelity: fidelityFor(route),
      layers: recorder.layers,
      spec: { ...spec, prompt: fitPrompt(spec.prompt, spec.subject) },
      sources,
      visionModel,
    },
  };
}
