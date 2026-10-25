"use client";

import { useRef, useState } from "react";
import {
  IconAlert,
  IconArrowRight,
  IconCheck,
  IconDice,
  IconImage,
  IconKey,
  IconSparkles,
  IconSpinner,
  IconTrash,
  IconUpload,
  IconX,
} from "@/components/Icons";
import { PRESETS } from "@/lib/presets";
import {
  FILTER_PRESETS,
  PLATE_COLORS,
  RAW_FILTERS,
  type FilterSettings,
  type PlateColor,
  type PreparedImage,
} from "@/lib/image";
import { DEFAULT_SETTINGS, formatMs, randomSeed, type GenSettings, type PipelineStage } from "@/lib/types";

export type EngineChoice = "pipeline" | "trellis-text";
export type Mode = "prompt" | "image";

export type GenerationError = {
  message: string;
  hint?: string | null;
  detail?: string | null;
  requestId?: string | null;
};

type Props = {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  onEnhance: () => void;
  enhancing: boolean;
  enhanceHint: string | null;
  engine: EngineChoice;
  onEngineChange: (engine: EngineChoice) => void;
  settings: GenSettings;
  onSettingsChange: (patch: Partial<GenSettings>) => void;
  image: PreparedImage | null;
  onPickFile: (file: File) => void;
  onClearImage: () => void;
  imageError: string | null;
  filters: FilterSettings;
  onFiltersChange: (patch: Partial<FilterSettings>) => void;
  onPreset: (filters: FilterSettings) => void;
  preparing: boolean;
  extraViews: PreparedImage[];
  onAddView: (file: File) => void;
  onRemoveView: (index: number) => void;
  busy: boolean;
  stages: PipelineStage[];
  elapsedMs: number;
  error: GenerationError | null;
  onDismissError: () => void;
  onRun: () => void;
  onCancel: () => void;
  configured: boolean;
  imageModel: string;
  imageModels: string[];
  onImageModelChange: (id: string) => void;
};

const STEPS_PRESETS = [
  { label: "Draft 15", steps: 15, detail: "Fastest — fits Vercel Hobby's 60s function limit" },
  { label: "Standard 25", steps: 25, detail: "Balanced default" },
  { label: "High 35", steps: 35, detail: "Finer detail, slower — needs Vercel Pro" },
] as const;

const ENGINES: Array<{ id: EngineChoice; title: string; detail: string; badge?: string; models: string }> = [
  {
    id: "pipeline",
    title: "Concept render → 3D",
    detail: "A NIM diffusion model paints the object first, then TRELLIS lifts it into a mesh.",
    badge: "Best quality",
    models: "FLUX + TRELLIS",
  },
  {
    id: "trellis-text",
    title: "Direct text → 3D",
    detail: "TRELLIS text-large builds the mesh straight from the prompt. Fastest path.",
    models: "TRELLIS text-large",
  },
];

function prettyModel(id: string): string {
  return id.replace(/^black-forest-labs\//, "").replace(/^stabilityai\//, "").replace(/-/g, " ");
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-mist-300">{label}</span>
        <span className="mono text-[11px] text-lime-glow/90">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ ["--fill" as string]: `${percent}%` }}
        className="mt-1"
        aria-label={label}
      />
    </label>
  );
}

export function ControlDeck(props: Props) {
  const {
    mode,
    onModeChange,
    prompt,
    onPromptChange,
    onEnhance,
    enhancing,
    enhanceHint,
    engine,
    onEngineChange,
    settings,
    onSettingsChange,
    image,
    onPickFile,
    onClearImage,
    imageError,
    filters,
    onFiltersChange,
    onPreset,
    preparing,
    extraViews,
    onAddView,
    onRemoveView,
    busy,
    stages,
    elapsedMs,
    error,
    onDismissError,
    onRun,
    onCancel,
    configured,
    imageModel,
    imageModels,
    onImageModelChange,
  } = props;

  const fileInput = useRef<HTMLInputElement | null>(null);
  const viewInput = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [activePresetId, setActivePresetId] = useState<string>(() => matchingPresetId(filters));

  const showStages = stages.some((stage) => stage.state !== "idle");
  const canRun =
    configured &&
    !busy &&
    (mode === "image" ? Boolean(image) : prompt.trim().length >= 3);

  return (
    <section className="glass flex flex-col gap-4 rounded-2xl p-4 sm:p-5">
      <header className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-mist-100">
          <IconSparkles className="h-4 w-4 text-lime-glow" />
          Compose
        </h2>
        <span className="chip mono text-[10.5px] tracking-wide">
          <IconKey className="h-3 w-3" />
          {configured ? "nim ready" : "no key"}
        </span>
      </header>

      <div className="segmented" role="tablist" aria-label="Generation mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "prompt"}
          data-active={mode === "prompt"}
          onClick={() => onModeChange("prompt")}
          className="flex items-center justify-center gap-1.5"
        >
          <IconSparkles className="h-3.5 w-3.5" />
          Prompt
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "image"}
          data-active={mode === "image"}
          onClick={() => onModeChange("image")}
          className="flex items-center justify-center gap-1.5"
        >
          <IconImage className="h-3.5 w-3.5" />
          Image
        </button>
      </div>

      {mode === "prompt" ? (
        <>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="subject" className="label">
                Subject
              </label>
              <div className="flex items-center gap-2">
                <span className="mono text-[11px] text-mist-500">{prompt.length}/600</span>
                <button
                  type="button"
                  onClick={onEnhance}
                  disabled={enhancing || busy || prompt.trim().length < 3}
                  className="chip"
                  title="Rewrite the prompt with an NVIDIA LLM (falls back to a local composer)"
                  style={{ borderColor: "rgba(103,232,249,0.3)", color: "#67e8f9" }}
                >
                  {enhancing ? (
                    <IconSpinner className="h-3 w-3 animate-spin" />
                  ) : (
                    <IconSparkles className="h-3 w-3" />
                  )}
                  Enhance
                </button>
              </div>
            </div>
            <textarea
              id="subject"
              value={prompt}
              onChange={(event) => onPromptChange(event.target.value.slice(0, 600))}
              maxLength={600}
              rows={4}
              placeholder="a weathered brass diving helmet with a cracked glass visor…"
              className="field mt-2 min-h-[104px] resize-none"
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  if (canRun) onRun();
                }
              }}
            />
            {enhanceHint ? (
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-aqua/80">{enhanceHint}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="chip"
                  onClick={() => onPromptChange(preset.prompt)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label">Engine</span>
            <div className="mt-2 grid gap-2">
              {ENGINES.map((option) => {
                const active = engine === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onEngineChange(option.id)}
                    aria-pressed={active}
                    className={`group relative flex items-start gap-3 rounded-xl border p-3 text-left transition ${
                      active
                        ? "border-lime-glow/45 bg-lime-glow/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                        : "border-white/[0.07] bg-white/[0.015] hover:border-white/15 hover:bg-white/[0.04]"
                    }`}
                  >
                    <span
                      className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border transition ${
                        active ? "border-lime-glow bg-lime-glow/20" : "border-white/25"
                      }`}
                    >
                      {active ? <span className="h-1.5 w-1.5 rounded-full bg-lime-glow" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-mist-100">{option.title}</span>
                        {option.badge ? (
                          <span className="rounded-full border border-aqua/25 bg-aqua/10 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-aqua">
                            {option.badge}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-[11.5px] leading-relaxed text-mist-500">{option.detail}</span>
                      <span className="mono mt-1.5 block text-[10px] uppercase tracking-wider text-mist-500/80">
                        {option.models}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div>
          <span className="label">Reference image</span>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onPickFile(file);
              event.target.value = "";
            }}
          />
          <input
            ref={viewInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onAddView(file);
              event.target.value = "";
            }}
          />
          {image ? (
            <div className="mt-2 overflow-hidden rounded-xl border border-white/[0.08] bg-ink-950/60">
              <div className="relative aspect-square w-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.dataUrl} alt="Prepared reference" className="h-full w-full object-contain" />
                <span className="absolute left-2 top-2 rounded-full border border-lime-glow/30 bg-ink-950/80 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-lime-glow">
                  what TRELLIS sees
                </span>
                <button
                  type="button"
                  onClick={onClearImage}
                  className="btn-icon absolute right-2 top-2 h-8 w-8"
                  aria-label="Remove image"
                >
                  <IconTrash className="h-3.5 w-3.5" />
                </button>
                {preparing ? (
                  <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full border border-lime-glow/30 bg-ink-950/85 px-2 py-1">
                    <IconSpinner className="h-3 w-3 animate-spin text-lime-glow" />
                    <span className="mono text-[9px] uppercase tracking-wider text-lime-glow">filtering</span>
                  </span>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-3 py-2">
                <span className="truncate text-[11.5px] text-mist-300">{image.name}</span>
                <span className="mono shrink-0 text-[10.5px] text-mist-500">
                  {image.width}×{image.height}
                </span>
              </div>

              <div className="border-t border-white/[0.06] px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="label">Filters</span>
                  <span className="mono text-[9.5px] uppercase tracking-wider text-mist-500">
                    {filters.matte ? "cut-out · paper bg" : "full frame"}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {FILTER_PRESETS.map((preset) => {
                    const active = preset.id === activePresetId;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className="chip"
                        data-active={active}
                        title={preset.detail}
                        onClick={() => {
                          setActivePresetId(preset.id);
                          onPreset(preset.filters);
                        }}
                        style={
                          active
                            ? { borderColor: "rgba(154,230,0,0.5)", color: "#c6ff45", background: "rgba(154,230,0,0.08)" }
                            : undefined
                        }
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setTuning((value) => !value)}
                  className="mt-2 flex w-full items-center justify-between text-[11px] font-medium text-mist-300 transition hover:text-mist-100"
                  aria-expanded={tuning}
                >
                  <span>Fine tune</span>
                  <span className={`text-mist-500 transition-transform ${tuning ? "rotate-180" : ""}`}>
                    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </button>

                {tuning ? (
                  <div className="mt-2 grid gap-2.5">
                    <label className="flex cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={filters.matte}
                        onChange={(event) => {
                          setActivePresetId("custom");
                          onFiltersChange({ matte: event.target.checked });
                        }}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-lime-glow"
                      />
                      <span className="min-w-0">
                        <span className="block text-[11.5px] font-medium text-mist-100">Cut the background out</span>
                        <span className="mono block truncate text-[10px] text-mist-500">
                          {image.matte
                            ? `matte on · ${image.matte.removed} island${image.matte.removed === 1 ? "" : "s"} removed · object ${(image.matte.coverage * 100).toFixed(0)}% of frame`
                            : "matte off · original background kept"}
                        </span>
                      </span>
                    </label>

                    <label className="flex cursor-pointer items-center justify-between gap-2">
                      <span className="text-[11.5px] font-medium text-mist-100">Auto levels</span>
                      <input
                        type="checkbox"
                        checked={filters.autoLevels}
                        onChange={(event) => {
                          setActivePresetId("custom");
                          onFiltersChange({ autoLevels: event.target.checked });
                        }}
                        className="h-3.5 w-3.5 accent-lime-glow"
                      />
                    </label>

                    <MiniSlider
                      label="Exposure"
                      value={filters.brightness}
                      min={-50}
                      max={50}
                      onChange={(value) => {
                        setActivePresetId("custom");
                        onFiltersChange({ brightness: value });
                      }}
                    />
                    <MiniSlider
                      label="Contrast"
                      value={filters.contrast}
                      min={-50}
                      max={50}
                      onChange={(value) => {
                        setActivePresetId("custom");
                        onFiltersChange({ contrast: value });
                      }}
                    />
                    <MiniSlider
                      label="Saturation"
                      value={filters.saturation}
                      min={-50}
                      max={50}
                      onChange={(value) => {
                        setActivePresetId("custom");
                        onFiltersChange({ saturation: value });
                      }}
                    />
                    <MiniSlider
                      label="Sharpen"
                      value={filters.sharpen}
                      min={0}
                      max={100}
                      onChange={(value) => {
                        setActivePresetId("custom");
                        onFiltersChange({ sharpen: value });
                      }}
                    />

                    <div>
                      <span className="text-[11.5px] font-medium text-mist-100">Backdrop</span>
                      <div className="mt-1 grid grid-cols-4 gap-1.5">
                        {(Object.keys(PLATE_COLORS) as PlateColor[]).map((plate) => (
                          <button
                            key={plate}
                            type="button"
                            onClick={() => {
                              setActivePresetId("custom");
                              onFiltersChange({ plate });
                            }}
                            className="flex items-center justify-center gap-1 rounded-lg border py-1 text-[10px] capitalize transition"
                            style={{
                              borderColor: filters.plate === plate ? "rgba(154,230,0,0.5)" : "rgba(255,255,255,0.1)",
                              color: filters.plate === plate ? "#c6ff45" : "rgba(179,192,212,0.9)",
                            }}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full border border-white/20"
                              style={{ background: PLATE_COLORS[plate] }}
                            />
                            {plate}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="justify-self-start text-[10.5px] font-medium text-mist-500 underline decoration-white/20 underline-offset-2 hover:text-mist-100"
                      onClick={() => {
                        setActivePresetId("raw");
                        onPreset(RAW_FILTERS);
                      }}
                    >
                      Reset to raw upload
                    </button>
                  </div>
                ) : null}
              </div>

              {image.originalDataUrl ? (
                <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.originalDataUrl}
                    alt="Original upload"
                    className="h-9 w-14 shrink-0 rounded border border-white/10 object-cover opacity-80"
                  />
                  <span className="mono text-[9.5px] leading-tight text-mist-500">
                    original upload · kept local only
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files?.[0];
                if (file) onPickFile(file);
              }}
              className={`mt-2 flex w-full flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition ${
                dragging
                  ? "border-lime-glow/70 bg-lime-glow/[0.08]"
                  : "border-white/15 bg-white/[0.015] hover:border-white/30 hover:bg-white/[0.04]"
              }`}
            >
              <span className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-lime-glow">
                <IconUpload className="h-4 w-4" />
              </span>
              <span className="text-[13px] font-medium text-mist-100">Drop an image, or click to browse</span>
              <span className="max-w-[15rem] text-[11px] leading-relaxed text-mist-500">
                One object, three-quarter view. PNG · JPG · WEBP — auto-fitted to 1024², background cut out and
                tone-corrected before it is sent.
              </span>
            </button>
          )}
          {image ? (
            <div className="mt-2">
              <div className="flex items-center justify-between">
                <span className="label">Extra views · optional</span>
                <span className="mono text-[10px] text-mist-500">{extraViews.length + 1}/3</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                {extraViews.map((view, index) => (
                  <div key={`${view.name}-${index}`} className="relative h-12 w-12 overflow-hidden rounded-lg border border-white/10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={view.dataUrl} alt={view.name} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => onRemoveView(index)}
                      className="absolute right-0 top-0 grid h-4 w-4 place-items-center rounded-bl bg-ink-950/85 text-mist-300 hover:text-rose-200"
                      aria-label="Remove view"
                    >
                      <IconX className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
                {extraViews.length < 2 ? (
                  <button
                    type="button"
                    onClick={() => viewInput.current?.click()}
                    className="grid h-12 w-12 place-items-center rounded-lg border border-dashed border-white/20 text-mist-300 transition hover:border-lime-glow/60 hover:text-lime-glow"
                    title="Add another view (front / top / side)"
                  >
                    <span className="text-lg leading-none">+</span>
                  </button>
                ) : null}
                <p className="ml-1 max-w-[10rem] text-[10px] leading-snug text-mist-500">
                  TRELLIS averages up to 8 views — front + top + side fixes nacelle spacing on ships.
                </p>
              </div>
            </div>
          ) : null}

          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-mist-500">
            <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-aqua/70" />
            You can also paste an image from your clipboard anywhere in the studio.
          </p>
          {imageError ? <p className="mt-2 text-[11.5px] text-rose-300">{imageError}</p> : null}
        </div>
      )}

      <div className="rounded-xl border border-white/[0.07] bg-ink-950/40">
        <button
          type="button"
          onClick={() => setAdvanced((value) => !value)}
          className="flex w-full items-center justify-between px-3 py-2.5 text-left"
          aria-expanded={advanced}
        >
          <span className="flex items-center gap-2 text-[12px] font-semibold text-mist-300">
            Sampling
            <span className="mono text-[10.5px] font-normal text-mist-500">
              {settings.slatSteps}/{settings.ssSteps} steps · cfg {settings.slatCfg}/{settings.ssCfg} · seed{" "}
              {settings.seed || "auto"}
            </span>
          </span>
          <span className={`text-mist-500 transition-transform ${advanced ? "rotate-180" : ""}`}>
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        {advanced ? (
          <div className="grid gap-3 border-t border-white/[0.06] px-3 py-3">
            <div>
              <span className="text-[12px] font-medium text-mist-300">Quality</span>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                {STEPS_PRESETS.map((preset) => {
                  const active = settings.slatSteps === preset.steps && settings.ssSteps === preset.steps;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => onSettingsChange({ slatSteps: preset.steps, ssSteps: preset.steps })}
                      className="chip justify-center"
                      data-active={active}
                      title={preset.detail}
                      style={active ? { borderColor: "rgba(154,230,0,0.5)", color: "#c6ff45", background: "rgba(154,230,0,0.08)" } : undefined}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-[10px] leading-snug text-mist-500">
                Meshy-style quality tiers. Vercel stops functions at 60 s on Hobby, where Draft 15 is the safe choice.
              </p>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex-1">
                <span className="text-[12px] font-medium text-mist-300">Seed</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={settings.seed}
                  onChange={(event) => onSettingsChange({ seed: Math.max(0, Number(event.target.value) || 0) })}
                  className="field mono mt-1 py-1.5 text-[12.5px]"
                  placeholder="0 = random"
                />
              </label>
              <button
                type="button"
                className="btn-ghost h-[34px] px-2"
                onClick={() => onSettingsChange({ seed: randomSeed() })}
                title="Random seed"
              >
                <IconDice className="h-4 w-4" />
              </button>
            </div>
            <Slider
              label="Latent steps"
              value={settings.slatSteps}
              min={10}
              max={50}
              step={1}
              onChange={(value) => onSettingsChange({ slatSteps: value })}
            />
            <Slider
              label="Sparse structure steps"
              value={settings.ssSteps}
              min={10}
              max={50}
              step={1}
              onChange={(value) => onSettingsChange({ ssSteps: value })}
            />
            <Slider
              label="Latent CFG"
              value={settings.slatCfg}
              min={1}
              max={10}
              step={0.5}
              onChange={(value) => onSettingsChange({ slatCfg: value })}
            />
            <Slider
              label="Sparse CFG"
              value={settings.ssCfg}
              min={1}
              max={10}
              step={0.5}
              onChange={(value) => onSettingsChange({ ssCfg: value })}
            />
            {mode === "prompt" && engine === "pipeline" ? (
              <label className="block">
                <span className="text-[12px] font-medium text-mist-300">Concept model</span>
                <select
                  value={imageModel}
                  onChange={(event) => onImageModelChange(event.target.value)}
                  className="field mt-1 py-1.5 text-[12.5px] capitalize"
                >
                  {imageModels.map((id) => (
                    <option key={id} value={id} className="bg-ink-900">
                      {prettyModel(id)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              className="justify-self-start text-[11px] font-medium text-mist-500 underline decoration-white/20 underline-offset-2 hover:text-mist-100"
              onClick={() => onSettingsChange(DEFAULT_SETTINGS)}
            >
              Reset to defaults
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" className="btn-primary flex-1" onClick={onRun} disabled={!canRun}>
          {busy ? (
            <>
              <IconSpinner className="h-4 w-4 animate-spin" />
              Forging… <span className="mono text-[12px] opacity-80">{formatMs(elapsedMs)}</span>
            </>
          ) : (
            <>
              Forge 3D model
              <IconArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
        {busy ? (
          <button type="button" className="btn-ghost h-[46px]" onClick={onCancel}>
            Stop
          </button>
        ) : null}
      </div>

      {!busy ? (
        <p className="text-center text-[10px] text-mist-500">
          <kbd className="mono rounded border border-white/10 bg-white/[0.04] px-1 py-0.5 text-[9.5px]">⌘/ctrl</kbd>
          {" + "}
          <kbd className="mono rounded border border-white/10 bg-white/[0.04] px-1 py-0.5 text-[9.5px]">↵</kbd> to forge
        </p>
      ) : null}

      {!configured ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5 text-[11.5px] leading-relaxed text-amber-200/90">
          <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Add <code className="mono text-amber-100">NVIDIA_API_KEY</code> to your Vercel environment (or{" "}
            <code className="mono text-amber-100">.env.local</code>) and redeploy. Free keys: build.nvidia.com →
            Settings → API Keys.
          </span>
        </div>
      ) : null}

      {showStages ? (
        <ol className="grid gap-1.5 rounded-xl border border-white/[0.06] bg-ink-950/40 p-3">
          {stages.map((stage, index) => (
            <li key={stage.id} className="flex items-start gap-2.5">
              <span
                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px] font-bold ${
                  stage.state === "done"
                    ? "border-lime-glow/60 bg-lime-glow/20 text-lime-glow"
                    : stage.state === "active"
                      ? "border-aqua/60 bg-aqua/15 text-aqua"
                      : stage.state === "error"
                        ? "border-rose-400/60 bg-rose-500/15 text-rose-300"
                        : "border-white/12 text-mist-500"
                }`}
              >
                {stage.state === "done" ? (
                  <IconCheck className="h-2.5 w-2.5" strokeWidth={3} />
                ) : stage.state === "active" ? (
                  <IconSpinner className="h-3 w-3 animate-spin" />
                ) : stage.state === "error" ? (
                  <IconX className="h-2.5 w-2.5" strokeWidth={3} />
                ) : (
                  index + 1
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[12px] font-medium ${
                    stage.state === "idle" ? "text-mist-500" : "text-mist-100"
                  }`}
                >
                  {stage.label}
                </span>
                <span className="mono block truncate text-[10.5px] text-mist-500">{stage.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {error ? (
        <div className="rise rounded-xl border border-rose-400/25 bg-rose-500/[0.08] p-3">
          <div className="flex items-start gap-2">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-rose-100">{error.message}</p>
              {error.hint ? (
                <p className="mt-1 text-[11.5px] leading-relaxed text-rose-200/80">{error.hint}</p>
              ) : null}
              {error.detail ? (
                <pre className="mono mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md border border-rose-300/20 bg-black/40 p-2 text-[10px] leading-relaxed text-rose-200/75">
                  {error.detail}
                </pre>
              ) : null}
              {error.requestId ? (
                <p className="mono mt-1.5 truncate text-[10px] text-rose-200/50">nvcf-reqid {error.requestId}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onDismissError}
              className="text-rose-200/60 transition hover:text-rose-100"
              aria-label="Dismiss error"
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Which preset the current filter values correspond to (or "custom"). */
function matchingPresetId(filters: FilterSettings): string {
  const match = FILTER_PRESETS.find(
    (preset) =>
      preset.filters.matte === filters.matte &&
      preset.filters.plate === filters.plate &&
      preset.filters.autoLevels === filters.autoLevels &&
      preset.filters.brightness === filters.brightness &&
      preset.filters.contrast === filters.contrast &&
      preset.filters.saturation === filters.saturation &&
      preset.filters.sharpen === filters.sharpen,
  );
  return match ? match.id : "custom";
}

function MiniSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[11.5px] font-medium text-mist-100">{label}</span>
        <span className="mono text-[10px] text-lime-glow/90">{value > 0 ? `+${value}` : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ ["--fill" as string]: `${percent}%` }}
        className="mt-0.5"
        aria-label={label}
      />
    </label>
  );
}
