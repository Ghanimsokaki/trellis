/**
 * Layer 2 — Resolve.
 *
 * The hosted TRELLIS preview cannot take a user photo (only catalogue
 * `example_id`s), so the forge needs a way to reach a *compatible* reference.
 * This layer asks the web for more material on the subject: extra photos to
 * feed a self-hosted TRELLIS, and ready-made 3D models the user can compare
 * against.
 *
 * Providers are optional and pluggable — Brave, Tavily or Serper when a key is
 * present, DuckDuckGo's HTML endpoint as a keyless default. Every failure is
 * swallowed into a note: search must never break a generation.
 */
import type { ImageSpec, SourceRef } from "./types";

export type SearchHit = { title: string; url: string; snippet: string };
export type AssetCandidate = { name: string; url: string; source: string };

export type SearchReport = {
  enabled: boolean;
  provider: string;
  queries: string[];
  hits: SearchHit[];
  assets: AssetCandidate[];
  note?: string;
};

const TIMEOUT_MS = 9_000;
const MAX_HITS = 8;
const MAX_ASSETS = 6;

const ASSET_HOSTS = [
  "sketchfab.com",
  "poly.pizza",
  "objaverse",
  "thingiverse.com",
  "cults3d.com",
  "free3d.com",
  "cgtrader.com",
  "smithsonian3d",
];

type Provider = "brave" | "tavily" | "serper" | "duckduckgo" | "mock";

function provider(): Provider {
  const forced = (process.env.TRELLIS_SEARCH_PROVIDER || "").toLowerCase();
  if (forced === "mock" || forced === "duckduckgo" || forced === "brave" || forced === "tavily" || forced === "serper") {
    return forced as Provider;
  }
  if (process.env.BRAVE_SEARCH_API_KEY) return "brave";
  if (process.env.TAVILY_API_KEY) return "tavily";
  if (process.env.SERPER_API_KEY) return "serper";
  return "duckduckgo";
}

/** Search is on unless explicitly disabled; the keyless provider always works. */
export function searchConfigured(): { enabled: boolean; provider: string } {
  if ((process.env.TRELLIS_SEARCH || "auto").toLowerCase() === "off") {
    return { enabled: false, provider: "disabled" };
  }
  return { enabled: true, provider: provider() };
}

function base(): string {
  return (process.env.NVIDIA_SEARCH_BASE || "").replace(/\/+$/, "");
}

async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function getText(url: string): Promise<string> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "text/html", "User-Agent": "TrellisForge/1.0 (+https://github.com/Ghanimsokaki/trellis)" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function brave(query: string): Promise<SearchHit[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY as string;
  const payload = (await getJson(
    `${base() || "https://api.search.brave.com"}/res/v1/web/search?count=${MAX_HITS}&q=${encodeURIComponent(query)}`,
    { headers: { "X-Subscription-Token": key } },
  )) as { web?: { results?: Array<Record<string, unknown>> } };
  const rows = payload.web?.results ?? [];
  return rows.map((row) => ({
    title: stripHtml(String(row.title ?? "")),
    url: String(row.url ?? ""),
    snippet: stripHtml(String(row.description ?? "")),
  }));
}

async function tavily(query: string): Promise<SearchHit[]> {
  const payload = (await getJson(`${base() || "https://api.tavily.com"}/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      max_results: MAX_HITS,
      search_depth: "basic",
    }),
  })) as { results?: Array<Record<string, unknown>> };
  return (payload.results ?? []).map((row) => ({
    title: stripHtml(String(row.title ?? "")),
    url: String(row.url ?? ""),
    snippet: stripHtml(String(row.content ?? "")),
  }));
}

async function serper(query: string): Promise<SearchHit[]> {
  const payload = (await getJson(`${base() || "https://google.serper.dev"}/search`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-KEY": process.env.SERPER_API_KEY as string },
    body: JSON.stringify({ q: query, num: MAX_HITS }),
  })) as { organic?: Array<Record<string, unknown>> };
  return (payload.organic ?? []).map((row) => ({
    title: stripHtml(String(row.title ?? "")),
    url: String(row.link ?? ""),
    snippet: stripHtml(String(row.snippet ?? "")),
  }));
}

/** Keyless fallback: DuckDuckGo's no-JS HTML endpoint. */
async function duckduckgo(query: string): Promise<SearchHit[]> {
  const html = await getText(
    `${base() || "https://html.duckduckgo.com"}/html/?q=${encodeURIComponent(query)}`,
  );
  const hits: SearchHit[] = [];
  const pattern = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && hits.length < MAX_HITS) {
    let url = match[1];
    // DuckDuckGo wraps outbound links: /l/?uddg=<encoded>
    const wrapped = /[?&]uddg=([^&]+)/.exec(url);
    if (wrapped) url = decodeURIComponent(wrapped[1]);
    if (!/^https?:\/\//.test(url)) continue;
    hits.push({ title: stripHtml(match[2]), url, snippet: "" });
  }
  return hits;
}

async function mock(query: string): Promise<SearchHit[]> {
  const payload = (await getJson(
    `${base() || "http://localhost:8096"}/search?q=${encodeURIComponent(query)}`,
  )) as { results?: Array<Record<string, unknown>> };
  return (payload.results ?? []).map((row) => ({
    title: String(row.title ?? ""),
    url: String(row.url ?? ""),
    snippet: String(row.snippet ?? ""),
  }));
}

async function searchOnce(query: string): Promise<SearchHit[]> {
  switch (provider()) {
    case "brave":
      return brave(query);
    case "tavily":
      return tavily(query);
    case "serper":
      return serper(query);
    case "mock":
      return mock(query);
    default:
      return duckduckgo(query);
  }
}

function dedupe(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    if (!hit.url || seen.has(hit.url)) continue;
    seen.add(hit.url);
    out.push(hit);
    if (out.length >= MAX_HITS) break;
  }
  return out;
}

function candidateCatalog(spec: ImageSpec): AssetCandidate[] {
  const term = encodeURIComponent(spec.subject || "3d model");
  return [
    { name: `Sketchfab · ${spec.subject}`, url: `https://sketchfab.com/search?q=${term}&type=models`, source: "sketchfab" },
    { name: `Poly Pizza · ${spec.subject}`, url: `https://poly.pizza/search/${term}`, source: "poly.pizza" },
    { name: `Thingiverse · ${spec.subject}`, url: `https://www.thingiverse.com/search?q=${term}`, source: "thingiverse" },
  ];
}

/**
 * Run the resolver. Never throws: a dead provider degrades to catalogue links
 * so the UI can still say "here is where a compatible model would be".
 */
export async function searchCompatible(
  spec: ImageSpec,
  options: { queries?: string[]; timeoutMs?: number } = {},
): Promise<SearchReport> {
  const { enabled, provider: name } = searchConfigured();
  const queries = (options.queries ?? spec.queries ?? []).slice(0, 2);
  if (queries.length === 0) queries.push(`${spec.subject} 3d model`);

  if (!enabled) {
    return {
      enabled: false,
      provider: "disabled",
      queries,
      hits: [],
      assets: candidateCatalog(spec),
      note: "Web search is switched off (TRELLIS_SEARCH=off); catalogue links only.",
    };
  }

  const started = Date.now();
  const hits: SearchHit[] = [];
  for (const query of queries) {
    if (Date.now() - started > (options.timeoutMs ?? 12_000)) break;
    try {
      hits.push(...(await searchOnce(query)));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      return {
        enabled: true,
        provider: name,
        queries,
        hits: dedupe(hits),
        assets: candidateCatalog(spec),
        note: `${name} search failed (${reason}); falling back to catalogue links.`,
      };
    }
  }

  const unique = dedupe(hits);
  const assets: AssetCandidate[] = candidateCatalog(spec);
  for (const hit of unique) {
    const host = ASSET_HOSTS.find((entry) => hit.url.includes(entry));
    if (host && assets.length < MAX_ASSETS) {
      assets.push({ name: hit.title || hit.url, url: hit.url, source: host });
    }
  }

  return {
    enabled: true,
    provider: name,
    queries,
    hits: unique,
    assets: assets.slice(0, MAX_ASSETS),
    note: unique.length === 0 ? "No matching references came back — using the description alone." : undefined,
  };
}

export function toSources(report: SearchReport, limit = 5): SourceRef[] {
  const merged: SourceRef[] = [...report.hits.map((hit) => ({ title: hit.title || hit.url, url: hit.url }))];
  for (const asset of report.assets) {
    if (!merged.some((entry) => entry.url === asset.url)) merged.push({ title: asset.name, url: asset.url });
    if (merged.length >= limit) break;
  }
  return merged.slice(0, limit);
}
