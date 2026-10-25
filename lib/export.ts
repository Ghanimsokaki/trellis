"use client";

/**
 * Client-side export pipeline (Meshy/Tripo-style output options).
 *
 * TRELLIS hands us one GLB; from that single mesh we can produce the formats a
 * game/DCC pipeline actually wants — OBJ, STL, PLY, USDZ for AR — plus an
 * optional decimated "low-poly" version for LOD work.
 *
 * Everything runs in the browser: no extra API calls, no server round-trip.
 */

export type ExportFormat = "glb" | "obj" | "stl" | "ply" | "usdz";

export type ExportOptions = {
  /** keep this share of vertices (0.05 – 1). 1 = untouched */
  detail?: number;
  /** pre-fetched GLB bytes (used by tests, and to avoid a second download) */
  buffer?: ArrayBuffer;
};

export type ExportResult = {
  blob: Blob;
  filename: string;
  format: ExportFormat;
  bytes: number;
  triangles: number;
  note?: string;
};

export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; detail: string; extension: string; mime: string }> = [
  { id: "glb", label: "GLB", detail: "mesh + PBR materials — Blender, Godot, Unity, three.js", extension: "glb", mime: "model/gltf-binary" },
  { id: "obj", label: "OBJ", detail: "universal, geometry + material refs", extension: "obj", mime: "text/plain" },
  { id: "stl", label: "STL", detail: "3D printing / CAD, geometry only", extension: "stl", mime: "model/stl" },
  { id: "ply", label: "PLY", detail: "scan-style point/triangle data, good for research", extension: "ply", mime: "application/octet-stream" },
  { id: "usdz", label: "USDZ", detail: "AR Quick Look on iPhone/iPad", extension: "usdz", mime: "model/vnd.usdz+zip" },
];

export function slugifyExportName(name: string): string {
  return (
    name
      .replace(/\.(glb|obj|stl|ply|usdz)$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "trellis-asset"
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function readBuffer(sourceUrl: string, buffer?: ArrayBuffer): Promise<ArrayBuffer> {
  if (buffer) return buffer;
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Could not read the mesh (HTTP ${response.status}).`);
  return response.arrayBuffer();
}

async function loadScene(sourceUrl: string, buffer?: ArrayBuffer) {
  const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const bytes = await readBuffer(sourceUrl, buffer);
  const gltf = await new GLTFLoader().parseAsync(bytes, "");
  return { scene: gltf.scene };
}

function countTriangles(object: { traverse: (cb: (child: unknown) => void) => void }): number {
  let triangles = 0;
  object.traverse((child) => {
    const mesh = child as { isMesh?: boolean; geometry?: { getAttribute?: (name: string) => { count: number } | undefined; getIndex?: () => { count: number } | null } };
    if (!mesh.isMesh || !mesh.geometry) return;
    const position = mesh.geometry.getAttribute?.("position");
    const index = mesh.geometry.getIndex?.();
    triangles += index ? index.count / 3 : position ? position.count / 3 : 0;
  });
  return Math.round(triangles);
}

/**
 * Simplify every mesh in place. `SimplifyModifier.modify()` is async in three
 * r186 (meshoptimizer WASM) and returns a *new* geometry, so meshes are
 * collected first and swapped afterwards. Failures are swallowed so a stubborn
 * mesh still exports at full detail, with a note.
 */
async function decimate(
  root: { traverse: (cb: (child: unknown) => void) => void; updateMatrixWorld: (force?: boolean) => void },
  detail: number,
) {
  const { SimplifyModifier } = await import("three/examples/jsm/modifiers/SimplifyModifier.js");
  const modifier = new SimplifyModifier();

  type Target = { mesh: { geometry: unknown }; geometry: { getAttribute: (name: string) => { count: number } | undefined } };
  const targets: Target[] = [];

  root.traverse((child) => {
    const mesh = child as { isMesh?: boolean; geometry?: Target["geometry"] };
    if (!mesh.isMesh || !mesh.geometry) return;
    targets.push({ mesh: mesh as Target["mesh"], geometry: mesh.geometry });
  });

  let changed = 0;
  let failed = 0;

  for (const target of targets) {
    try {
      const position = target.geometry.getAttribute("position");
      if (!position) continue;
      const remove = Math.floor(position.count * (1 - detail));
      if (remove < 24) continue;
      const next = await modifier.modify(target.geometry as never, remove);
      if (next && typeof (next as { getAttribute?: unknown }).getAttribute === "function") {
        target.mesh.geometry = next;
        changed += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }

  return { changed, failed };
}

export async function exportMesh(
  sourceUrl: string,
  name: string,
  format: ExportFormat,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const detail = Math.min(1, Math.max(0.05, options.detail ?? 1));
  const base = slugifyExportName(name);
  const suffix = detail < 0.999 ? `-lowpoly-${Math.round(detail * 100)}` : "";

  if (format === "glb") {
    const bytes = await readBuffer(sourceUrl, options.buffer);
    const blob = new Blob([bytes], { type: "model/gltf-binary" });
    return { blob, filename: `${base}${suffix}.glb`, format, bytes: blob.size, triangles: 0, note: "original TRELLIS output" };
  }

  const { scene } = await loadScene(sourceUrl, options.buffer);
  let note: string | undefined;
  let triangles = countTriangles(scene);

  if (detail < 0.999) {
    const { changed, failed } = await decimate(scene, detail);
    if (changed === 0) {
      note = `decimation unavailable for this mesh (${failed} part(s) untouched) — exported at full detail`;
    } else if (failed > 0) {
      note = `${changed} part(s) decimated, ${failed} kept full detail`;
    }
    triangles = countTriangles(scene);
  }

  scene.updateMatrixWorld(true);

  if (format === "obj") {
    const { OBJExporter } = await import("three/examples/jsm/exporters/OBJExporter.js");
    const text = new OBJExporter().parse(scene);
    const blob = new Blob([text], { type: EXPORT_FORMATS[1].mime });
    return { blob, filename: `${base}${suffix}.obj`, format, bytes: blob.size, triangles, note };
  }

  if (format === "stl") {
    const { STLExporter } = await import("three/examples/jsm/exporters/STLExporter.js");
    const text = new STLExporter().parse(scene, { binary: false }) as string;
    const blob = new Blob([text], { type: EXPORT_FORMATS[2].mime });
    return { blob, filename: `${base}${suffix}.stl`, format, bytes: blob.size, triangles, note };
  }

  if (format === "ply") {
    const { PLYExporter } = await import("three/examples/jsm/exporters/PLYExporter.js");
    const data = await new Promise<ArrayBuffer | string | null>((resolve) => {
      new PLYExporter().parse(scene, (result: ArrayBuffer | string | null) => resolve(result), { binary: true });
    });
    if (!data) throw new Error("PLY export produced no data.");
    const blob = new Blob([data], { type: EXPORT_FORMATS[3].mime });
    return { blob, filename: `${base}${suffix}.ply`, format, bytes: blob.size, triangles, note };
  }

  if (format === "usdz") {
    try {
      const { USDZExporter } = await import("three/examples/jsm/exporters/USDZExporter.js");
      const data = await new USDZExporter().parseAsync(scene as never);
      const blob = new Blob([data as unknown as BlobPart], { type: EXPORT_FORMATS[4].mime });
      return { blob, filename: `${base}${suffix}.usdz`, format, bytes: blob.size, triangles, note };
    } catch (error) {
      throw new Error(
        `USDZ export failed in this browser${error instanceof Error ? ` (${error.message})` : ""}. Try GLB or OBJ.`,
      );
    }
  }

  throw new Error(`Unsupported format: ${format as string}`);
}

export function saveExport(result: ExportResult): void {
  downloadBlob(result.blob, result.filename);
}

/** Save a PNG snapshot of the viewport (three.js canvas → blob). */
export async function saveSnapshot(dataUrl: string, name: string): Promise<void> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  downloadBlob(blob, `${slugifyExportName(name)}-turntable.png`);
}
