"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ControlDeck, type EngineChoice, type GenerationError, type Mode } from "@/components/ControlDeck";
import { HistoryRail } from "@/components/HistoryRail";
import { ViewerStage } from "@/components/ViewerStage";
import type { DisplayMode, MeshStats, ViewerStatus } from "@/components/ThreeViewer";
import { IconCube, IconExternal, IconKey } from "@/components/Icons";
import { prepareImageFile, type PreparedImage } from "@/lib/image";
import { ApiFailure, isAbort, requestConcept, requestMesh, slugifyPrompt } from "@/lib/client";
import { EXAMPLE_PROMPT } from "@/lib/presets";
import {
  DEFAULT_SETTINGS,
  formatMs,
  randomSeed,
  type Asset,
  type ConceptResponse,
  type GenSettings,
  type HealthResponse,
  type MeshMeta,
  type PipelineStage,
} from "@/lib/types";

type Props = { initialHealth: HealthResponse };

type Plan = Array<{ label: string; detail: string }>;

function shortModel(id: string): string {
  return id
    .replace(/^black-forest-labs\//, "")
    .replace(/^stabilityai\//, "")
    .replace(/^microsoft\//, "")
    .replace(/-/g, " ");
}

function buildPlan(mode: Mode, engine: EngineChoice, imageModel: string): Plan {
  if (mode === "image") {
    return [
      { label: "Image → 3D", detail: "TRELLIS image-large · lifting to mesh" },
      { label: "Preview", detail: "parsing GLB & PBR materials" },
    ];
  }
  if (engine === "trellis-text") {
    return [
      { label: "Text → 3D", detail: "TRELLIS text-large · sampling mesh" },
      { label: "Preview", detail: "parsing GLB & PBR materials" },
    ];
  }
  return [
    { label: "Concept render", detail: `${shortModel(imageModel)} · 1024²` },
    { label: "Image → 3D", detail: "TRELLIS image-large · lifting to mesh" },
    { label: "Preview", detail: "parsing GLB & PBR materials" },
  ];
}

function toStages(plan: Plan, active: number): PipelineStage[] {
  return plan.map((step, index) => ({
    id: `${index}-${step.label}`,
    label: step.label,
    detail: step.detail,
    state: index < active ? "done" : index === active ? "active" : "idle",
  }));
}

export function Studio({ initialHealth }: Props) {
  const [health, setHealth] = useState<HealthResponse>(initialHealth);
  const [mode, setMode] = useState<Mode>("prompt");
  const [engine, setEngine] = useState<EngineChoice>("pipeline");
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);
  const [settings, setSettings] = useState<GenSettings>(DEFAULT_SETTINGS);
  const [imageModel, setImageModel] = useState(initialHealth.imageModel);

  const [image, setImage] = useState<PreparedImage | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [extraViews, setExtraViews] = useState<PreparedImage[]>([]);
  const [matte, setMatte] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [error, setError] = useState<GenerationError | null>(null);
  const [concept, setConcept] = useState<ConceptResponse | null>(null);

  const [asset, setAsset] = useState<Asset | null>(null);
  const [history, setHistory] = useState<Asset[]>([]);
  const [stats, setStats] = useState<MeshStats | null>(null);
  const [viewerStatus, setViewerStatus] = useState<ViewerStatus>("idle");
  const [viewerError, setViewerError] = useState<string | null>(null);

  const [display, setDisplay] = useState<DisplayMode>("textured");
  const [autoRotate, setAutoRotate] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [resetToken, setResetToken] = useState(0);
  const [demoLoading, setDemoLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<Asset[]>([]);
  historyRef.current = history;

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (!response.ok) return;
      setHealth((await response.json()) as HealthResponse);
    } catch {
      /* offline is fine — keep the server-rendered values */
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (toastRef.current) clearTimeout(toastRef.current);
      historyRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    },
    [],
  );

  const commitAsset = useCallback((blob: Blob, meta: MeshMeta, conceptImage: string | null): Asset => {
    const url = URL.createObjectURL(blob);
    const nextAsset: Asset = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      url,
      bytes: blob.size,
      name: `${slugifyPrompt(meta.prompt)}-${meta.seed || "seed"}.glb`,
      meta,
      conceptImage,
      stats: null,
      createdAt: Date.now(),
    };
    setStats(null);
    setAsset(nextAsset);
    setHistory((previous) => {
      const next = [nextAsset, ...previous].slice(0, 8);
      previous.filter((item) => !next.includes(item)).forEach((item) => URL.revokeObjectURL(item.url));
      return next;
    });
    return nextAsset;
  }, []);

  const prepare = useCallback(async (file: File, useMatte: boolean) => {
    setPreparing(true);
    setImageError(null);
    try {
      const prepared = await prepareImageFile(file, { matte: useMatte });
      setImage(prepared);
      return prepared;
    } catch (fileError) {
      setImageError(fileError instanceof Error ? fileError.message : "Could not read that image.");
      return null;
    } finally {
      setPreparing(false);
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setMode("image");
      setError(null);
      setRawFile(file);
      const prepared = await prepare(file, matte);
      if (prepared && !prepared.matte && matte) {
        setImageError("Could not separate a clean object — the background is not uniform. Upload a single object on a plain background.");
      }
    },
    [matte, prepare],
  );

  const handleAddView = useCallback(
    async (file: File) => {
      if (extraFiles.length >= 2) return;
      setImageError(null);
      try {
        const prepared = await prepareImageFile(file, { matte });
        setExtraFiles((previous) => [...previous, file].slice(0, 2));
        setExtraViews((previous) => [...previous, prepared].slice(0, 2));
      } catch (viewError) {
        setImageError(viewError instanceof Error ? viewError.message : "Could not read that view.");
      }
    },
    [extraFiles.length, matte],
  );

  const handleRemoveView = useCallback((index: number) => {
    setExtraFiles((previous) => previous.filter((_, position) => position !== index));
    setExtraViews((previous) => previous.filter((_, position) => position !== index));
  }, []);

  const handleMatteChange = useCallback(
    (value: boolean) => {
      setMatte(value);
      setImageError(null);
      if (rawFile) void prepare(rawFile, value);
      if (extraFiles.length > 0) {
        void Promise.all(extraFiles.map((file) => prepareImageFile(file, { matte: value })))
          .then((prepared) => setExtraViews(prepared.filter((entry): entry is PreparedImage => entry !== null)))
          .catch(() => undefined);
      }
    },
    [extraFiles, prepare, rawFile],
  );

  const run = useCallback(async (overrides?: Partial<GenSettings>, attempt = 0) => {
    if (inFlightRef.current) return;
    const activeSettings: GenSettings = { ...settings, ...(overrides ?? {}) };
    if (!health.configured) {
      setError({
        message: "NVIDIA_API_KEY is not configured.",
        hint: "Add it in Vercel → Settings → Environment Variables (or .env.local), then redeploy. Free key: build.nvidia.com/settings/api-keys.",
      });
      return;
    }
    const trimmed = prompt.trim();
    if (mode === "prompt" && engine === "pipeline" && !health.hasKey) {
      setError({
        message: "The concept render needs a hosted NVIDIA key.",
        hint: "NVIDIA_API_KEY is missing, so FLUX can't paint the reference. Add the key, or switch the engine to Direct text → 3D (that path can run against your self-hosted TRELLIS).",
      });
      return;
    }
    if (mode === "prompt" && trimmed.length < 3) {
      setError({ message: "Describe what to build first.", hint: "Try one of the example chips above." });
      return;
    }
    if (mode === "image" && !image) {
      setError({ message: "Add a reference image first.", hint: "Drop a PNG/JPG into the image tab, or paste one." });
      return;
    }

    const plan = buildPlan(mode, engine, imageModel);
    const controller = new AbortController();
    abortRef.current = controller;
    inFlightRef.current = true;

    setError(null);
    setViewerError(null);
    setConcept(null);
    setBusy(true);
    setElapsedMs(0);
    setStages(toStages(plan, 0));

    const startedAt = Date.now();
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 200);

    try {
      let conceptResult: ConceptResponse | null = null;
      let imageData = image?.dataUrl ?? null;

      if (mode === "prompt" && engine === "pipeline") {
        conceptResult = await requestConcept({ prompt: trimmed, settings: activeSettings, imageModel }, controller.signal);
        setConcept(conceptResult);
        imageData = conceptResult.image;
      }

      const trellisIndex = mode === "prompt" && engine === "pipeline" ? 1 : 0;
      setStages(toStages(plan, trellisIndex));

      const payload =
        mode === "prompt" && engine === "trellis-text"
          ? ({ mode: "text", prompt: trimmed, engine: "trellis-text", settings: activeSettings } as const)
          : ({
              mode: "image",
              image: imageData!,
              images:
                mode === "image" && extraViews.length > 0
                  ? [imageData!, ...extraViews.map((view) => view.dataUrl)]
                  : undefined,
              prompt: mode === "prompt" ? trimmed : undefined,
              engine: mode === "image" ? "image" : "pipeline",
              imageModel: conceptResult?.model ?? null,
              conceptPrompt: conceptResult?.prompt ?? null,
              settings: activeSettings,
            } as const);

      const result = await requestMesh(payload, controller.signal);
      setStages(toStages(plan, plan.length - 1));
      setSettings((previous) => ({ ...previous, ...activeSettings }));
      commitAsset(result.blob, result.meta, conceptResult?.image ?? imageData);
      setElapsedMs(Date.now() - startedAt);
      notify("Mesh ready — orbit it or download the GLB");
    } catch (runError) {
      if (isAbort(runError)) {
        setStages((previous) => previous.map((stage) => (stage.state === "active" ? { ...stage, state: "idle" } : stage)));
        notify("Generation cancelled");
      } else if (runError instanceof ApiFailure && runError.status === 504 && attempt === 0 && activeSettings.slatSteps > 15) {
        // Vercel killed the function: retry once at 15 steps, which usually fits.
        notify("Timed out — retrying in Fast mode (15 steps)…");
        setStages([]);
        setTimeout(() => {
          void runRef.current({ slatSteps: 15, ssSteps: 15 }, 1);
        }, 80);
        return;
      } else {
        const generationError: GenerationError =
          runError instanceof ApiFailure
            ? {
                message: runError.message,
                hint: runError.hint,
                detail: runError.detail,
                requestId: runError.requestId,
              }
            : { message: runError instanceof Error ? runError.message : "Generation failed." };
        setError(generationError);
        setStages((previous) => previous.map((stage) => (stage.state === "active" ? { ...stage, state: "error" } : stage)));
      }
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      abortRef.current = null;
      inFlightRef.current = false;
      setBusy(false);
    }
  }, [busy, commitAsset, engine, health.configured, health.hasKey, image, imageModel, mode, notify, prompt, settings]);

  const runRef = useRef(run);
  runRef.current = run;

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const variation = useCallback(() => {
    const nextSeed = randomSeed();
    setSettings((previous) => ({ ...previous, seed: nextSeed }));
    void runRef.current({ seed: nextSeed });
  }, []);

  const handleViewerStatus = useCallback((status: ViewerStatus, message?: string) => {
    setViewerStatus(status);
    setViewerError(status === "error" ? message ?? "The mesh could not be previewed." : null);
    if (status === "ready") {
      setStages((previous) => previous.map((stage) => ({ ...stage, state: "done" })));
    }
    if (status === "loading") {
      setStages((previous) =>
        previous.length === 0
          ? previous
          : previous.map((stage, index) =>
              index === previous.length - 1 && stage.state === "idle" ? { ...stage, state: "active" } : stage,
            ),
      );
    }
  }, []);

  const downloadAsset = useCallback(
    (target?: Asset | null) => {
      const candidate = target ?? asset;
      if (!candidate) return;
      const anchor = document.createElement("a");
      anchor.href = candidate.url;
      anchor.download = candidate.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      notify(`Downloading ${candidate.name}`);
    },
    [asset, notify],
  );

  const loadDemo = useCallback(async () => {
    if (demoLoading) return;
    setDemoLoading(true);
    setError(null);
    try {
      const response = await fetch("/demo.glb", { cache: "no-store" });
      if (!response.ok) throw new Error("The sample asset could not be loaded.");
      const blob = await response.blob();
      const meta: MeshMeta = {
        engine: "image",
        mode: "image",
        prompt: "Crystal cluster — bundled sample asset",
        seed: 424242,
        model: health.trellisModel,
        imageModel: null,
        conceptPrompt: null,
        elapsedMs: 0,
        bytes: blob.size,
        requestId: null,
        createdAt: new Date().toISOString(),
      };
      commitAsset(blob, meta, null);
      setStages([]);
      setConcept(null);
      notify("Sample asset loaded");
    } catch (demoError) {
      setError({ message: demoError instanceof Error ? demoError.message : "Could not load the sample." });
    } finally {
      setDemoLoading(false);
    }
  }, [commitAsset, demoLoading, health.trellisModel, notify]);

  const selectAsset = useCallback((selected: Asset) => {
    setAsset(selected);
    setStats(selected.stats ?? null);
    setViewerError(null);
    if (selected.conceptImage) {
      setConcept({
        image: selected.conceptImage,
        prompt: selected.meta.conceptPrompt ?? selected.meta.prompt ?? "",
        rawPrompt: selected.meta.prompt ?? "",
        seed: selected.meta.seed,
        model: selected.meta.imageModel ?? "",
        elapsedMs: 0,
      });
    } else {
      setConcept(null);
    }
  }, []);

  const removeAsset = useCallback(
    (target: Asset) => {
      setHistory((previous) => previous.filter((item) => item.id !== target.id));
      if (asset?.id === target.id) {
        setAsset(null);
        setStats(null);
        setConcept(null);
      }
      URL.revokeObjectURL(target.url);
    },
    [asset?.id],
  );

  // Paste an image anywhere in the studio.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      if (file) {
        event.preventDefault();
        void handleFile(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFile]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void runRef.current();
      }
      if (event.key === "Escape" && abortRef.current) {
        abortRef.current.abort();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const updateSettings = useCallback((patch: Partial<GenSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
  }, []);

  return (
    <>
      <SiteHeader health={health} />

      <main className="mx-auto w-full max-w-[1560px] flex-1 px-4 pb-12 lg:px-6">
        <section className="flex flex-col gap-6 pb-6 pt-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="chip border-lime-glow/25 bg-lime-glow/[0.08] font-semibold text-lime-glow">
                <span className="pulse-soft h-1.5 w-1.5 rounded-full bg-lime-glow" />
                NIM 3D pipeline
              </span>
              <span className="chip mono text-[10px]">GLB · PBR</span>
              <span className="chip mono text-[10px]">free hosted models</span>
            </div>
            <h1 className="text-[2rem] font-semibold leading-[1.04] tracking-[-0.02em] sm:text-[2.7rem]">
              Prompt in. <span className="text-gradient">Textured mesh out.</span>
            </h1>
            <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-mist-300">
              One sentence — or one photo — becomes a game-ready 3D asset. A NIM diffusion model paints the concept,
              Microsoft TRELLIS lifts it into geometry and PBR materials, and the GLB drops straight into your scene.
            </p>
          </div>

          <div className="grid w-full max-w-lg grid-cols-2 gap-2 sm:grid-cols-3 lg:w-auto">
            <InfoTile label="3D model" value="TRELLIS" sub={shortModel(health.trellisModel)} />
            <InfoTile label="Concept" value={shortModel(health.imageModel).toUpperCase()} sub="NIM text-to-image" />
            <InfoTile label="Output" value="GLB" sub="PBR · mesh + textures" />
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(340px,400px)_minmax(0,1fr)]">
          <ControlDeck
            mode={mode}
            onModeChange={(next) => {
              setMode(next);
              setError(null);
            }}
            prompt={prompt}
            onPromptChange={setPrompt}
            engine={engine}
            onEngineChange={setEngine}
            settings={settings}
            onSettingsChange={updateSettings}
            image={image}
            onPickFile={(file) => void handleFile(file)}
            onClearImage={() => {
              setImage(null);
              setImageError(null);
              setRawFile(null);
              setExtraFiles([]);
              setExtraViews([]);
            }}
            imageError={imageError}
            matte={matte}
            onMatteChange={handleMatteChange}
            preparing={preparing}
            extraViews={extraViews}
            onAddView={(file) => void handleAddView(file)}
            onRemoveView={handleRemoveView}
            busy={busy}
            stages={stages}
            elapsedMs={elapsedMs}
            error={error}
            onDismissError={() => setError(null)}
            onRun={() => void run()}
            onCancel={cancel}
            configured={health.configured}
            imageModel={imageModel}
            imageModels={health.imageModels}
            onImageModelChange={setImageModel}
          />

          <div className="flex min-w-0 flex-col gap-4">
            <ViewerStage
              asset={asset}
              concept={concept}
              busy={busy}
              stages={stages}
              elapsedMs={elapsedMs}
              stats={stats}
              viewerStatus={viewerStatus}
              viewerError={viewerError}
              demoLoading={demoLoading}
              resetToken={resetToken}
              display={display}
              autoRotate={autoRotate}
              showGrid={showGrid}
              onDisplayChange={setDisplay}
              onAutoRotateChange={setAutoRotate}
              onShowGridChange={setShowGrid}
              onStats={setStats}
              onViewerStatus={handleViewerStatus}
              onDownload={() => downloadAsset()}
              onLoadDemo={() => void loadDemo()}
              onReset={() => setResetToken((token) => token + 1)}
              onCancel={cancel}
              onVariation={variation}
              canVariation={health.configured && (mode === "prompt" ? prompt.trim().length >= 3 : Boolean(image))}
            />
            <HistoryRail
              assets={history}
              activeId={asset?.id ?? null}
              onSelect={selectAsset}
              onDownload={downloadAsset}
              onRemove={removeAsset}
            />
          </div>
        </div>

        <section className="mt-8 grid gap-3 md:grid-cols-3">
          <StepCard
            index="01"
            title="Compose"
            body="Type a subject, pick an engine, or drop a photo of a real object. The studio flattens and downscales uploads to 1024px automatically."
          />
          <StepCard
            index="02"
            title="Render concept"
            body="FLUX.1 Schnell on NVIDIA NIM paints a centred product shot, which is the best possible input for the 3D lift."
          />
          <StepCard
            index="03"
            title="Lift to 3D"
            body="TRELLIS samples a sparse structure and structured latents, then returns a PBR-textured GLB — download it or drop it in Blender."
          />
        </section>

        <section className="glass mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3">
          <span className="label">NIM models</span>
          <ModelPill name={health.trellisModel} role="3d · mesh + pbr" highlight />
          {health.imageModels.map((id) => (
            <ModelPill key={id} name={id} role="concept render" />
          ))}
          <span className="mono ml-auto hidden text-[10px] uppercase tracking-[0.14em] text-mist-500 sm:block">
            one key · build.nvidia.com
          </span>
        </section>

        <footer className="mt-6 flex flex-col gap-3 border-t border-white/[0.07] pt-5 text-[11px] text-mist-500 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="mono flex items-center gap-1.5 uppercase tracking-[0.14em]">
              <IconKey className="h-3 w-3 text-lime-glow/80" />
              {health.configured ? health.authVariable : "NVIDIA_API_KEY"} · Vercel env
            </span>
            <span className="hidden h-3 w-px bg-white/10 sm:block" />
            <span className="mono">
              api {health.apiBase} · model {health.trellisModel} · {formatMs(health.maxDurationSeconds * 1000)} max
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="chip mono hidden text-[10px] sm:inline-flex">▲ vercel ready</span>
            <span className="mono hidden uppercase tracking-[0.14em] lg:block">MIT model · Apache-2.0 app</span>
            <a
              className="btn-ghost"
              href="https://build.nvidia.com/microsoft/trellis"
              target="_blank"
              rel="noreferrer"
            >
              build.nvidia.com
              <IconExternal className="h-3 w-3" />
            </a>
          </div>
        </footer>
      </main>

      {toast ? (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 -translate-x-1/2">
          <div className="rise glass-soft flex items-center gap-2 rounded-full px-3.5 py-2 text-[12px] text-mist-100 shadow-2xl">
            <span className="h-1.5 w-1.5 rounded-full bg-lime-glow" />
            {toast}
          </div>
        </div>
      ) : null}
    </>
  );
}

function SiteHeader({ health }: { health: HealthResponse }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1560px] items-center gap-3 px-4 lg:px-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-lime-glow/25 bg-gradient-to-br from-lime-glow/20 to-transparent text-lime-glow shadow-[0_12px_32px_-16px_rgba(154,230,0,0.9)]">
            <IconCube className="h-5 w-5" />
          </span>
          <span className="leading-tight">
            <span className="block text-[13.5px] font-semibold tracking-tight text-mist-100">Trellis Forge</span>
            <span className="mono block text-[9px] uppercase tracking-[0.2em] text-mist-500">nvidia nim · 3d studio</span>
          </span>
        </div>

        <span className="mx-1 hidden h-8 w-px bg-white/10 sm:block" />
        <span className="chip mono hidden text-[10px] sm:inline-flex">Microsoft TRELLIS 1.2B</span>

        <div className="ml-auto flex items-center gap-2">
          <span
            className={`chip mono text-[10px] ${
              health.configured
                ? "border-lime-glow/30 bg-lime-glow/[0.07] text-lime-glow"
                : "border-amber-400/30 bg-amber-400/[0.07] text-amber-200"
            }`}
            title={health.configured ? "The server can sign NIM requests" : "Add NVIDIA_API_KEY to enable generation"}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${health.configured ? "bg-lime-glow" : "bg-amber-300"}`} />
            {health.configured
              ? health.selfHosted && !health.hasKey
                ? "self-hosted NIM"
                : `${health.authVariable ?? "NVIDIA_API_KEY"} linked`
              : "key missing"}
          </span>
          <a
            className="btn-ghost hidden sm:inline-flex"
            href="https://build.nvidia.com/microsoft/trellis"
            target="_blank"
            rel="noreferrer"
          >
            Model card
            <IconExternal className="h-3 w-3" />
          </a>
        </div>
      </div>
    </header>
  );
}

function ModelPill({ name, role, highlight }: { name: string; role: string; highlight?: boolean }) {
  return (
    <span
      className={`chip mono text-[10px] ${
        highlight ? "border-lime-glow/30 bg-lime-glow/[0.07] text-lime-glow" : "text-mist-300"
      }`}
    >
      <IconCube className="h-3 w-3 opacity-70" />
      {name}
      <span className="text-mist-500">· {role}</span>
    </span>
  );
}

function InfoTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="glass rounded-xl px-3 py-2.5">
      <p className="mono text-[9px] uppercase tracking-[0.16em] text-mist-500">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-semibold text-mist-100">{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-mist-500">{sub}</p>
    </div>
  );
}

function StepCard({ index, title, body }: { index: string; title: string; body: string }) {
  return (
    <div className="glass group relative overflow-hidden rounded-2xl p-4">
      <div className="flex items-baseline gap-2">
        <span className="mono text-[10px] tracking-[0.18em] text-lime-glow/80">{index}</span>
        <h3 className="text-[12.5px] font-semibold text-mist-100">{title}</h3>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist-500">{body}</p>
      <span className="pointer-events-none absolute -right-6 -top-6 h-16 w-16 rounded-full bg-lime-glow/[0.07] blur-2xl transition group-hover:bg-lime-glow/[0.14]" />
    </div>
  );
}
