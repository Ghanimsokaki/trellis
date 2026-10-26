"use client";

import { useState } from "react";
import type { MeshMeta } from "@/lib/types";

const FIDELITY: Record<string, { label: string; className: string; blurb: string }> = {
  exact: {
    label: "photo-exact",
    className: "border-lime-glow/30 bg-lime-glow/10 text-lime-glow",
    blurb: "the photo itself conditioned the mesh",
  },
  approximate: {
    label: "approximate",
    className: "border-amber-300/30 bg-amber-300/10 text-amber-200",
    blurb: "reconstructed from a mixed description",
  },
  described: {
    label: "from description",
    className: "border-aqua/30 bg-aqua/10 text-aqua",
    blurb: "geometry follows the vision layer's description, not the raw pixels",
  },
};

const DOT: Record<string, string> = {
  done: "bg-lime-glow",
  skipped: "bg-mist-500",
  failed: "bg-rose-400",
};

const ROUTE: Record<string, string> = {
  "image-native": "image → mesh",
  "caption-bridge": "photo → description → mesh",
  "text-only": "prompt → mesh",
};

function ms(value: number): string {
  if (!value) return "—";
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;
}

/**
 * Shows what the multi-layer forge actually did for the loaded asset:
 * route, fidelity, each layer's outcome, and the references the resolve
 * layer found. Hosted TRELLIS cannot take a photo, so this is where the
 * studio is honest about what the mesh is based on.
 */
export function LayerReport({ meta }: { meta: MeshMeta }) {
  const [open, setOpen] = useState(false);
  const layers = meta.layers ?? [];
  if (layers.length === 0) return null;

  const fidelity = FIDELITY[meta.fidelity ?? "described"] ?? FIDELITY.described;
  const sources = meta.sources ?? [];
  const spec = meta.spec ?? null;

  return (
    <div className="glass-soft pointer-events-auto w-full max-w-[290px] rounded-xl p-2.5 text-left">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-2"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className={`mono rounded-md border px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.12em] ${fidelity.className}`}>
            {fidelity.label}
          </span>
          <span className="mono text-[10px] uppercase tracking-[0.14em] text-mist-400">
            {layers.length} layer{layers.length === 1 ? "" : "s"}
          </span>
        </span>
        <span className="mono text-[10px] text-mist-500">{open ? "hide" : "details"}</span>
      </button>

      <p className="mono mt-1.5 text-[10.5px] leading-relaxed text-mist-400">
        {ROUTE[meta.route ?? "text-only"] ?? meta.route} · {fidelity.blurb}
      </p>

      {open ? (
        <div className="mt-2 space-y-2">
          <ol className="space-y-1.5">
            {layers.map((layer) => (
              <li key={layer.id} className="flex gap-2">
                <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${DOT[layer.state] ?? "bg-mist-500"}`} />
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11.5px] font-medium text-mist-100">{layer.label}</span>
                    <span className="mono shrink-0 text-[9.5px] text-mist-500">{ms(layer.ms)}</span>
                  </div>
                  <p className="text-[10.5px] leading-snug text-mist-400">{layer.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          {spec ? (
            <div className="rounded-lg border border-white/[0.07] bg-black/25 px-2 py-1.5">
              <p className="mono text-[9px] uppercase tracking-[0.14em] text-mist-500">perceived</p>
              <p className="mt-0.5 text-[10.5px] leading-snug text-mist-300">
                {spec.subject}
                {spec.parts.length > 0 ? ` · ${spec.parts.slice(0, 4).join(", ")}` : ""}
              </p>
              {spec.prompt ? (
                <p className="mono mt-1 text-[9.5px] leading-snug text-lime-glow/70">
                  “{spec.prompt}” · {spec.prompt.length}/77
                </p>
              ) : null}
            </div>
          ) : null}

          {sources.length > 0 ? (
            <div>
              <p className="mono text-[9px] uppercase tracking-[0.14em] text-mist-500">compatible references</p>
              <ul className="mt-1 space-y-0.5">
                {sources.map((source) => (
                  <li key={source.url} className="truncate">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[10.5px] text-aqua/80 underline decoration-aqua/25 underline-offset-2 hover:text-aqua"
                    >
                      {source.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
