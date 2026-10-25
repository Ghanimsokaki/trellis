"use client";

import { useRef, useState } from "react";
import {
  ThreeViewer,
  type DisplayMode,
  type MeshStats,
  type ViewerApi,
  type ViewerStatus,
} from "@/components/ThreeViewer";
import { EXPORT_FORMATS, exportMesh, saveExport, saveSnapshot, type ExportFormat } from "@/lib/export";
import {
  IconCheck,
  IconCube,
  IconDice,
  IconDownload,
  IconGrid,
  IconImage,
  IconRotate,
  IconSparkles,
  IconSpinner,
  IconSun,
  IconWireframe,
  IconX,
} from "@/components/Icons";
import { formatBytes, formatMs, formatNumber, type Asset, type ConceptResponse, type PipelineStage } from "@/lib/types";

type Props = {
  asset: Asset | null;
  concept: ConceptResponse | null;
  busy: boolean;
  stages: PipelineStage[];
  elapsedMs: number;
  stats: MeshStats | null;
  viewerStatus: ViewerStatus;
  viewerError: string | null;
  demoLoading: boolean;
  resetToken: number;
  display: DisplayMode;
  autoRotate: boolean;
  showGrid: boolean;
  onDisplayChange: (mode: DisplayMode) => void;
  onAutoRotateChange: (value: boolean) => void;
  onShowGridChange: (value: boolean) => void;
  onStats: (stats: MeshStats) => void;
  onViewerStatus: (status: ViewerStatus, message?: string) => void;
  onLoadDemo: () => void;
  onReset: () => void;
  onCancel: () => void;
  onVariation: () => void;
  canVariation: boolean;
};

const DISPLAY_OPTIONS: Array<{ id: DisplayMode; label: string; icon: React.ReactNode }> = [
  { id: "textured", label: "PBR materials", icon: <IconSun className="h-3.5 w-3.5" /> },
  { id: "clay", label: "Clay study", icon: <IconCube className="h-3.5 w-3.5" /> },
  { id: "wire", label: "Wireframe", icon: <IconWireframe className="h-3.5 w-3.5" /> },
];

export function ViewerStage(props: Props) {
  const {
    asset,
    concept,
    busy,
    stages,
    elapsedMs,
    stats,
    viewerStatus,
    viewerError,
    demoLoading,
    resetToken,
    display,
    autoRotate,
    showGrid,
    onDisplayChange,
    onAutoRotateChange,
    onShowGridChange,
    onStats,
    onViewerStatus,
    onLoadDemo,
    onReset,
    onCancel,
    onVariation,
    canVariation,
  } = props;

  const [lightbox, setLightbox] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("glb");
  const [lowPoly, setLowPoly] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const viewerApi = useRef<ViewerApi | null>(null);

  const runExport = async () => {
    if (!asset || exporting) return;
    setExporting(true);
    setExportError(null);
    setExportNote(null);
    try {
      const result = await exportMesh(asset.url, asset.name, exportFormat, {
        detail: lowPoly ? 0.35 : 1,
      });
      saveExport(result);
      const formatLabel = EXPORT_FORMATS.find((entry) => entry.id === exportFormat)?.label ?? exportFormat.toUpperCase();
      setExportNote(`${formatLabel} saved${result.triangles ? ` · ${result.triangles.toLocaleString()} tris` : ""}`);
      setExportOpen(false);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const captureTurntable = async () => {
    if (!asset || capturing) return;
    setCapturing(true);
    try {
      const api = viewerApi.current;
      const shots: string[] = [];
      const angles = [0, 90, 180, 270];
      for (const angle of angles) {
        api?.orbitTo(angle);
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const shot = api?.snapshot();
        if (shot) shots.push(shot);
      }
      api?.orbitTo(35);
      if (shots.length === 0) throw new Error("Could not capture the viewport.");
      if (shots.length === 1) {
        await saveSnapshot(shots[0], asset.name);
      } else {
        for (let index = 0; index < shots.length; index += 1) {
          await saveSnapshot(shots[index], `${asset.name}-view-${index + 1}`);
        }
      }
      setExportNote(`${shots.length} turntable PNG${shots.length === 1 ? "" : "s"} saved`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Capture failed.");
    } finally {
      setCapturing(false);
    }
  };
  const activeStage = stages.find((stage) => stage.state === "active") ?? stages[stages.length - 1];
  const showEmpty = !asset && !busy;

  return (
    <>
    <section className="glass relative overflow-hidden rounded-2xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-3">
        <div className="flex flex-col gap-2">
          <span className="glass-soft pointer-events-auto flex items-center gap-2 rounded-full px-2.5 py-1">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                viewerStatus === "error"
                  ? "bg-rose-400"
                  : busy || viewerStatus === "loading"
                    ? "bg-aqua pulse-soft"
                    : "bg-lime-glow"
              }`}
            />
            <span className="mono text-[10px] uppercase tracking-[0.16em] text-mist-300">
              {viewerStatus === "loading" ? "loading mesh" : busy ? "generating" : "viewport"}
            </span>
          </span>

          {concept ? (
            <button
              type="button"
              onClick={() => setLightbox(true)}
              className="glass-soft pointer-events-auto group relative hidden w-[124px] overflow-hidden rounded-xl text-left sm:block"
              title="Open the concept render"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={concept.image} alt="Concept render" className="h-[92px] w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 pb-1.5 pt-4">
                <span className="mono block text-[9px] uppercase tracking-wider text-lime-glow/90">concept</span>
                <span className="mono block truncate text-[9px] text-mist-300">{concept.model.split("/").pop()}</span>
              </span>
            </button>
          ) : null}
        </div>

        <div className="glass-soft pointer-events-auto flex items-center gap-0.5 rounded-xl p-1">
          {DISPLAY_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className="btn-icon h-8 w-8 border-transparent bg-transparent sm:h-[2.1rem] sm:w-[2.1rem]"
              data-active={display === option.id}
              onClick={() => onDisplayChange(option.id)}
              title={option.label}
              aria-label={option.label}
            >
              {option.icon}
            </button>
          ))}
          <span className="mx-0.5 h-4 w-px bg-white/10" />
          <button
            type="button"
            className="btn-icon h-8 w-8 border-transparent bg-transparent sm:h-[2.1rem] sm:w-[2.1rem]"
            data-active={autoRotate}
            onClick={() => onAutoRotateChange(!autoRotate)}
            title="Auto-rotate"
            aria-label="Auto-rotate"
          >
            <IconRotate className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className="btn-icon h-8 w-8 border-transparent bg-transparent sm:h-[2.1rem] sm:w-[2.1rem]"
            data-active={showGrid}
            onClick={() => onShowGridChange(!showGrid)}
            title="Ground grid"
            aria-label="Ground grid"
          >
            <IconGrid className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative h-[420px] w-full sm:h-[480px] xl:h-[min(66vh,660px)]">
        <ThreeViewer
          url={asset?.url ?? null}
          autoRotate={autoRotate}
          showGrid={showGrid}
          display={display}
          resetToken={resetToken}
          apiRef={viewerApi}
          onStats={onStats}
          onStatus={onViewerStatus}
        />
        <div className="pointer-events-none absolute inset-0 z-0 scan opacity-[0.13]" />

        {showEmpty ? (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center px-6">
            <div className="pointer-events-auto max-w-sm text-center">
              <div className="float-y mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-lime-glow shadow-[0_20px_60px_-30px_rgba(154,230,0,0.8)]">
                <IconCube className="h-6 w-6" />
              </div>
              <h3 className="text-[15px] font-semibold text-mist-100">Your mesh materializes here</h3>
              <p className="mx-auto mt-1.5 max-w-[19rem] text-[12px] leading-relaxed text-mist-500">
                Describe an object, or drop a photo. TRELLIS on NVIDIA NIM returns a textured GLB you can orbit and
                download.
              </p>
              <button type="button" className="btn-ghost mx-auto mt-4" onClick={onLoadDemo} disabled={demoLoading}>
                {demoLoading ? <IconSpinner className="h-3.5 w-3.5 animate-spin" /> : <IconSparkles className="h-3.5 w-3.5 text-lime-glow" />}
                Load sample asset
              </button>
            </div>
          </div>
        ) : null}

        {busy ? (
          <div className="absolute inset-0 z-20 grid place-items-center bg-ink-950/55 px-6 backdrop-blur-[3px]">
            <div className="w-full max-w-xs text-center">
              <div className="relative mx-auto mb-5 grid h-24 w-24 place-items-center">
                <span className="absolute inset-0 rounded-full border border-lime-glow/25 spin-slow" />
                <span
                  className="absolute inset-2 rounded-full border border-dashed border-aqua/30 spin-slow"
                  style={{ animationDirection: "reverse", animationDuration: "6s" }}
                />
                <span className="absolute inset-5 rounded-full bg-lime-glow/10 blur-md" />
                <IconSpinner className="relative h-6 w-6 animate-spin text-lime-glow" />
              </div>
              <p className="text-[13.5px] font-semibold text-mist-100">{activeStage?.label ?? "Working…"}</p>
              <p className="mono mt-1 text-[10.5px] uppercase tracking-[0.14em] text-mist-500">{activeStage?.detail}</p>
              <div className="relative mx-auto mt-4 h-1 w-48 overflow-hidden rounded-full bg-white/10">
                <span className="sheen absolute inset-0 rounded-full bg-gradient-to-r from-lime-glow/40 via-lime-glow to-aqua/70" />
              </div>
              <div className="mt-3 flex items-center justify-center gap-3">
                <span className="mono text-[11px] text-mist-300">{formatMs(elapsedMs)}</span>
                <span className="h-3 w-px bg-white/15" />
                <button
                  type="button"
                  onClick={onCancel}
                  className="text-[11px] font-medium text-mist-500 underline decoration-white/20 underline-offset-2 transition hover:text-mist-100"
                >
                  cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {viewerError ? (
          <div className="absolute inset-x-3 bottom-3 z-20 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-200">
            {viewerError}
          </div>
        ) : null}

        {asset && stats ? (
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 hidden items-center gap-3 rounded-lg border border-white/[0.07] bg-ink-950/60 px-2.5 py-1.5 backdrop-blur sm:flex">
            <Stat label="tris" value={formatNumber(stats.triangles)} />
            <span className="h-3 w-px bg-white/10" />
            <Stat label="verts" value={formatNumber(stats.vertices)} />
            <span className="h-3 w-px bg-white/10" />
            <Stat label="meshes" value={formatNumber(stats.meshes)} />
          </div>
        ) : null}
      </div>

      <div className="relative z-10 flex flex-col gap-3 border-t border-white/[0.07] bg-ink-950/45 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-medium text-mist-100">
            {asset ? asset.meta.prompt || "Image → 3D asset" : busy ? "Forging a new asset…" : "No asset loaded"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {asset ? (
              <>
                <Meta label={asset.meta.engine === "pipeline" ? "FLUX + TRELLIS" : asset.meta.engine === "trellis-text" ? "TRELLIS text" : "TRELLIS image"} />
                <Meta label={`seed ${asset.meta.seed || "auto"}`} />
                <Meta label={formatBytes(asset.bytes)} />
                <Meta label={formatMs(asset.meta.elapsedMs)} />
                <Meta label="GLB · PBR" />
              </>
            ) : (
              <span className="mono text-[10.5px] uppercase tracking-[0.14em] text-mist-500">
                orbit · zoom · pan disabled
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="btn-ghost hidden sm:inline-flex"
            onClick={onVariation}
            disabled={!canVariation || busy}
            title="Generate a new variation with a fresh seed"
          >
            <IconDice className="h-3.5 w-3.5" />
            Variation
          </button>
          <button type="button" className="btn-ghost hidden md:inline-flex" onClick={onReset} disabled={!asset}>
            <IconRotate className="h-3.5 w-3.5" />
            Reframe
          </button>
          <button
            type="button"
            className="btn-ghost hidden sm:inline-flex"
            onClick={() => void captureTurntable()}
            disabled={!asset || capturing}
            title="Save 4 turntable PNG views"
          >
            {capturing ? <IconSpinner className="h-3.5 w-3.5 animate-spin" /> : <IconImage className="h-3.5 w-3.5" />}
            PNG
          </button>

          <div className="relative">
            <button
              type="button"
              className="btn-primary px-3 py-2 text-[12.5px]"
              onClick={() => setExportOpen((value) => !value)}
              disabled={!asset}
              aria-expanded={exportOpen}
              aria-haspopup="menu"
            >
              <IconDownload className="h-3.5 w-3.5" />
              Export
              <span className="mono text-[10px] uppercase opacity-70">
                {EXPORT_FORMATS.find((entry) => entry.id === exportFormat)?.label}
              </span>
            </button>

            {exportOpen && asset ? (
              <div
                role="menu"
                className="glass absolute bottom-[calc(100%+8px)] right-0 z-30 w-[268px] rounded-xl p-2"
              >
                <div className="grid gap-0.5">
                  {EXPORT_FORMATS.map((format) => (
                    <button
                      key={format.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={exportFormat === format.id}
                      onClick={() => setExportFormat(format.id)}
                      className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.06]"
                    >
                      <span className="mt-0.5 w-3 shrink-0 text-lime-glow">
                        {exportFormat === format.id ? <IconCheck className="h-3 w-3" strokeWidth={3} /> : null}
                      </span>
                      <span className="min-w-0">
                        <span className="mono block text-[11px] font-semibold uppercase tracking-wider text-mist-100">
                          {format.label}
                        </span>
                        <span className="block text-[10px] leading-snug text-mist-500">{format.detail}</span>
                      </span>
                    </button>
                  ))}
                </div>

                <label className="mt-1.5 flex cursor-pointer items-start gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2 py-1.5">
                  <input
                    type="checkbox"
                    checked={lowPoly}
                    onChange={(event) => setLowPoly(event.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 accent-lime-glow"
                  />
                  <span>
                    <span className="block text-[11px] font-medium text-mist-100">Low-poly (35 %)</span>
                    <span className="mono block text-[9.5px] text-mist-500">
                      LOD export, decimated in your browser
                    </span>
                  </span>
                </label>

                <button
                  type="button"
                  className="btn-primary mt-1.5 w-full px-2 py-1.5 text-[12px]"
                  onClick={() => void runExport()}
                  disabled={exporting}
                >
                  {exporting ? <IconSpinner className="h-3.5 w-3.5 animate-spin" /> : <IconDownload className="h-3.5 w-3.5" />}
                  {exporting ? (lowPoly ? "Decimating…" : "Converting…") : `Save ${exportFormat.toUpperCase()}`}
                </button>

                {exportNote ? <p className="mt-1.5 px-1 text-[10px] text-lime-glow/80">{exportNote}</p> : null}
                {exportError ? <p className="mt-1.5 px-1 text-[10px] text-rose-300">{exportError}</p> : null}
                <p className="mt-1 px-1 text-[9.5px] leading-snug text-mist-500">
                  Converted locally from the GLB — no extra API call.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

    </section>
    {lightbox && concept ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-6 backdrop-blur-sm"
          onClick={() => setLightbox(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-full w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-ink-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={concept.image} alt="Concept render" className="max-h-[70vh] w-full object-contain" />
            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
              <div className="min-w-0">
                <p className="mono text-[10px] uppercase tracking-wider text-lime-glow/80">concept render</p>
                <p className="truncate text-[12px] text-mist-300">{concept.prompt}</p>
              </div>
              <button type="button" className="btn-icon" onClick={() => setLightbox(false)} aria-label="Close">
                <IconX className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="mono text-[10px] text-mist-500">{label}</span>
      <span className="mono text-[11px] text-mist-100">{value}</span>
    </span>
  );
}

function Meta({ label }: { label: string }) {
  return (
    <span className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-mist-500">
      <span className="h-1 w-1 rounded-full bg-white/20" />
      {label}
    </span>
  );
}
