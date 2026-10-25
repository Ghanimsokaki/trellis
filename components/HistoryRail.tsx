"use client";

import { IconCube, IconDownload, IconTrash } from "@/components/Icons";
import { formatBytes, type Asset } from "@/lib/types";

type Props = {
  assets: Asset[];
  activeId: string | null;
  onSelect: (asset: Asset) => void;
  onDownload: (asset: Asset) => void;
  onRemove: (asset: Asset) => void;
};

export function HistoryRail({ assets, activeId, onSelect, onDownload, onRemove }: Props) {
  if (assets.length === 0) {
    return (
      <section className="glass flex items-center justify-between gap-4 rounded-2xl px-4 py-3">
        <div>
          <h2 className="text-[12.5px] font-semibold text-mist-100">Session gallery</h2>
          <p className="mt-0.5 text-[11px] text-mist-500">
            Generated assets stack up here while the tab stays open — GLBs are never uploaded anywhere else.
          </p>
        </div>
        <span className="mono hidden shrink-0 text-[10px] uppercase tracking-[0.16em] text-mist-500 sm:block">
          0 assets
        </span>
      </section>
    );
  }

  return (
    <section className="glass rounded-2xl px-3 py-3">
      <header className="mb-2 flex items-center justify-between gap-3 px-1">
        <h2 className="flex items-center gap-2 text-[12.5px] font-semibold text-mist-100">
          Session gallery
          <span className="mono rounded-full border border-white/10 px-1.5 py-0.5 text-[9.5px] text-mist-500">
            {assets.length}
          </span>
        </h2>
        <span className="mono text-[9.5px] uppercase tracking-[0.16em] text-mist-500">click to load</span>
      </header>

      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {assets.map((asset) => {
          const active = asset.id === activeId;
          return (
            <div
              key={asset.id}
              className={`group relative w-[164px] shrink-0 overflow-hidden rounded-xl border transition ${
                active
                  ? "border-lime-glow/50 bg-lime-glow/[0.06]"
                  : "border-white/[0.07] bg-white/[0.02] hover:border-white/20"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(asset)}
                className="block w-full text-left"
                aria-pressed={active}
              >
                <div className="relative h-[68px] w-full overflow-hidden bg-gradient-to-br from-ink-800 to-ink-950">
                  {asset.conceptImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.conceptImage} alt="" className="h-full w-full object-cover opacity-90" />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-lime-glow/45">
                      <IconCube className="h-6 w-6" />
                    </span>
                  )}
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/80 via-transparent to-transparent" />
                  {active ? (
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-lime-glow px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider text-ink-950">
                      live
                    </span>
                  ) : null}
                </div>
                <div className="px-2 pb-2 pt-1.5">
                  <p className="line-clamp-2 h-[26px] text-[10.5px] leading-[13px] text-mist-300">
                    {asset.meta.prompt || "Image → 3D asset"}
                  </p>
                  <p className="mono mt-1 truncate text-[9px] uppercase tracking-wider text-mist-500">
                    {asset.meta.engine === "pipeline" ? "flux+trellis" : asset.meta.engine} · {formatBytes(asset.bytes)}
                  </p>
                </div>
              </button>

              <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                <button
                  type="button"
                  className="btn-icon h-6 w-6 bg-ink-950/80"
                  onClick={() => onDownload(asset)}
                  aria-label="Download GLB"
                  title="Download GLB"
                >
                  <IconDownload className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="btn-icon h-6 w-6 bg-ink-950/80 hover:border-rose-400/50 hover:bg-rose-500/15 hover:text-rose-200"
                  onClick={() => onRemove(asset)}
                  aria-label="Remove from gallery"
                  title="Remove"
                >
                  <IconTrash className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
