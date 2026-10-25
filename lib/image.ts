"use client";

/**
 * Browser-side image preparation for TRELLIS.
 *
 * TRELLIS expects "around 1 MP" with a single centred object on a plain
 * background — but a real upload is often a 597×335 screenshot of a starship
 * with a planet, starfield and warp glows in frame. So before a single API
 * call we:
 *   1. fit the upload into a ~1 MP working canvas (upscaling is fine),
 *   2. optionally matte the background out (border flood-fill + keep the
 *      object's connected components, which also drops stars/specks),
 *   3. run the user's filter stack (auto-levels, exposure, contrast,
 *      saturation, unsharp mask, plate colour),
 *   4. re-frame the object to fill a square 1024² canvas.
 *
 * The result is exactly what the API receives, and the panel shows it.
 */

export type PlateColor = "paper" | "white" | "grey" | "dark";

export type FilterSettings = {
  /** keep only the centred object, drop background/scenery */
  matte: boolean;
  /** backdrop colour behind the object */
  plate: PlateColor;
  /** percentile stretch — rescues dark space screenshots */
  autoLevels: boolean;
  /** -50 … 50 */
  brightness: number;
  /** -50 … 50 */
  contrast: number;
  /** -50 … 50 (negative desaturates) */
  saturation: number;
  /** 0 … 100 unsharp mask */
  sharpen: number;
};

export const PLATE_COLORS: Record<PlateColor, string> = {
  paper: "#f1f2f4",
  white: "#ffffff",
  grey: "#b9bec7",
  dark: "#1b1f26",
};

export const DEFAULT_FILTERS: FilterSettings = {
  matte: true,
  plate: "paper",
  autoLevels: true,
  brightness: 6,
  contrast: 12,
  saturation: 0,
  sharpen: 35,
};

export const RAW_FILTERS: FilterSettings = {
  matte: false,
  plate: "paper",
  autoLevels: false,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  sharpen: 0,
};

export type FilterPreset = {
  id: string;
  label: string;
  detail: string;
  filters: FilterSettings;
};

export const FILTER_PRESETS: FilterPreset[] = [
  {
    id: "studio",
    label: "Studio",
    detail: "Cut out the object, brighten, sharpen — best default for spaceship renders",
    filters: DEFAULT_FILTERS,
  },
  {
    id: "clean",
    label: "Clean cut",
    detail: "Object on flat paper, no tone changes",
    filters: { ...DEFAULT_FILTERS, autoLevels: false, brightness: 0, contrast: 0, sharpen: 0 },
  },
  {
    id: "rescue",
    label: "Rescue dark",
    detail: "Hard level stretch for very dark screenshots",
    filters: { ...DEFAULT_FILTERS, contrast: 26, brightness: 16, sharpen: 55 },
  },
  {
    id: "silhouette",
    label: "Silhouette",
    detail: "High contrast on white — helps thin pylons read",
    filters: { ...DEFAULT_FILTERS, plate: "white", contrast: 34, brightness: 20, saturation: -30, sharpen: 70 },
  },
  {
    id: "raw",
    label: "Raw",
    detail: "Exactly the uploaded frame, untouched",
    filters: RAW_FILTERS,
  },
];

export type MatteInfo = {
  applied: boolean;
  /** disconnected islands discarded (stars, lens flares, planet slivers) */
  removed: number;
  /** fraction of the frame the kept object covers */
  coverage: number;
};

export type PreparedImage = {
  /** the 1 MP square JPEG that is actually sent to the API */
  dataUrl: string;
  /** small preview of the untouched upload, for before/after */
  originalDataUrl: string;
  name: string;
  width: number;
  height: number;
  bytes: number;
  matte: MatteInfo | null;
  filters: FilterSettings;
};

export type PrepareOptions = {
  filters?: Partial<FilterSettings>;
  size?: number;
};

const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
/** max RGB euclidean distance from the sampled background colour */
const BG_TOLERANCE = 46;
/** components smaller than this share of the frame are noise */
const MIN_COMPONENT_RATIO = 0.0015;

function estimateDataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return dataUrl.length;
  return Math.round((dataUrl.slice(comma + 1).length * 3) / 4);
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not decode that image."));
      image.src = url;
    });
    return image;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function closeBitmap(bitmap: ImageBitmap | HTMLImageElement) {
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
}

function bitmapSize(bitmap: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  if ("naturalWidth" in bitmap) return { width: bitmap.naturalWidth, height: bitmap.naturalHeight };
  return { width: bitmap.width, height: bitmap.height };
}

async function renderPreview(bitmap: ImageBitmap | HTMLImageElement, maxSide: number): Promise<string> {
  const { width, height } = bitmapSize(bitmap);
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = makeCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

type MaskResult = {
  mask: Uint8Array;
  box: { x: number; y: number; width: number; height: number };
  removed: number;
  coverage: number;
};

function medianBorderColor(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  const push = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    reds.push(data[i]);
    greens.push(data[i + 1]);
    blues.push(data[i + 2]);
  };
  const step = Math.max(1, Math.floor(Math.min(width, height) / 96));
  for (let x = 0; x < width; x += step) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    push(0, y);
    push(width - 1, y);
  }
  const median = (values: number[]) => {
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  return [median(reds), median(greens), median(blues)];
}

function distanceSquared(data: Uint8ClampedArray, index: number, rgb: [number, number, number]): number {
  const dr = data[index] - rgb[0];
  const dg = data[index + 1] - rgb[1];
  const db = data[index + 2] - rgb[2];
  return dr * dr + dg * dg + db * db;
}

export function buildForegroundMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = BG_TOLERANCE,
): MaskResult | null {
  const total = width * height;
  if (total === 0) return null;

  const background = medianBorderColor(data, width, height);
  const toleranceSquared = tolerance * tolerance;

  // 1. flood fill from the border through pixels that match the background colour
  const isBackground = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const seed = (index: number) => {
    if (isBackground[index]) return;
    if (distanceSquared(data, index * 4, background) > toleranceSquared) return;
    isBackground[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < width; x += 1) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    seed(y * width);
    seed(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) seed(index - 1);
    if (x < width - 1) seed(index + 1);
    if (y > 0) seed(index - width);
    if (y < height - 1) seed(index + width);
  }

  // 2. connected components over the foreground
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  const componentOf = new Int32Array(total).fill(-1);
  const components: Array<{ area: number; touchesBorder: boolean; cx: number; cy: number }> = [];

  for (let start = 0; start < total; start += 1) {
    if (isBackground[start] || visited[start]) continue;
    const id = components.length;
    let area = 0;
    let touchesBorder = false;
    let sumX = 0;
    let sumY = 0;
    let top = 0;
    stack[top++] = start;
    visited[start] = 1;
    componentOf[start] = id;

    while (top > 0) {
      const index = stack[--top];
      area += 1;
      const x = index % width;
      const y = (index - x) / width;
      sumX += x;
      sumY += y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;

      const push = (next: number) => {
        if (visited[next] || isBackground[next]) return;
        visited[next] = 1;
        componentOf[next] = id;
        stack[top++] = next;
      };
      if (x > 0) push(index - 1);
      if (x < width - 1) push(index + 1);
      if (y > 0) push(index - width);
      if (y < height - 1) push(index + width);
    }

    components.push({ area, touchesBorder, cx: sumX / area, cy: sumY / area });
  }

  if (components.length === 0) return null;

  const minArea = Math.max(24, Math.floor(total * MIN_COMPONENT_RATIO));
  const diagonal = Math.hypot(width, height) / 2;
  const centreX = width / 2;
  const centreY = height / 2;

  const scored = components
    .map((component, id) => {
      const distance = Math.hypot(component.cx - centreX, component.cy - centreY) / diagonal;
      return { ...component, id, centrality: Math.max(0, 1 - Math.min(1, distance)) };
    })
    .filter((component) => component.area >= minArea);
  if (scored.length === 0) return null;

  // The subject is the biggest blob near the middle of the frame. A planet,
  // ground plane or scenery corner sits at the edge with much lower centrality.
  const centralPool = scored.filter((component) => component.centrality >= 0.45);
  const anchorPool = centralPool.length > 0 ? centralPool : scored;
  const anchor = anchorPool.reduce((best, component) => (component.area > best.area ? component : best), anchorPool[0]);

  const keepFloor = Math.max(minArea, anchor.area * 0.08);
  const kept = scored.filter((component) => {
    if (component.id === anchor.id) return true;
    if (component.area < keepFloor) return false;
    // Detached parts of the subject (nacelles, wings, antennae) never run off
    // the frame edge — scenery and backdrops do, so they are dropped here.
    if (component.touchesBorder) return false;
    if (component.centrality < 0.25) return false;
    return true;
  });
  if (kept.length === 0) return null;

  const keptIds = new Set(kept.map((component) => component.id));
  const mask = new Uint8Array(total);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let covered = 0;

  for (let index = 0; index < total; index += 1) {
    const id = componentOf[index];
    if (id < 0 || !keptIds.has(id)) continue;
    mask[index] = 255;
    covered += 1;
    const x = index % width;
    const y = (index - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const coverage = covered / total;
  if (maxX < minX || maxY < minY) return null;
  // If the "object" is basically the whole frame the separation failed.
  if (coverage > 0.94) return null;

  return {
    mask,
    box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    removed: Math.max(0, components.length - kept.length),
    coverage,
  };
}

/* ------------------------------------------------------------------------- *
 * Filter maths — pure functions over RGBA pixel buffers, so they can be
 * unit-tested without a DOM. Pixels with alpha 0 are never touched.
 * ------------------------------------------------------------------------- */

type Pixels = Uint8ClampedArray;

function clampChannel(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** 2 % / 98 % luminance percentiles of the visible pixels. */
export function luminancePercentiles(pixels: Pixels, lowPercent = 0.02, highPercent = 0.98): { low: number; high: number } {
  const histogram = new Uint32Array(256);
  let visible = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    histogram[Math.round(luma(pixels[index], pixels[index + 1], pixels[index + 2]))] += 1;
    visible += 1;
  }
  if (visible === 0) return { low: 0, high: 255 };

  const targetLow = visible * lowPercent;
  const targetHigh = visible * highPercent;
  let low = 0;
  let high = 255;
  let cumulative = 0;
  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= targetLow) {
      low = value;
      break;
    }
  }
  cumulative = 0;
  for (let value = 255; value >= 0; value -= 1) {
    cumulative += histogram[value];
    if (cumulative >= visible - targetHigh) {
      high = value;
      break;
    }
  }
  if (high - low < 12) {
    // Almost flat image: don't amplify noise.
    return { low: 0, high: 255 };
  }
  return { low, high };
}

/** Percentile stretch, applied to the visible pixels only. */
export function applyAutoLevels(pixels: Pixels): void {
  const { low, high } = luminancePercentiles(pixels);
  if (low <= 0 && high >= 255) return;
  const span = Math.max(1, high - low);
  const scale = 255 / span;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    pixels[index] = clampChannel((pixels[index] - low) * scale);
    pixels[index + 1] = clampChannel((pixels[index + 1] - low) * scale);
    pixels[index + 2] = clampChannel((pixels[index + 2] - low) * scale);
  }
}

export function applyTone(
  pixels: Pixels,
  options: { brightness?: number; contrast?: number; saturation?: number },
): void {
  const brightness = (options.brightness ?? 0) * 2.55;
  const contrast = options.contrast ?? 0;
  const contrastFactor = (100 + contrast) / 100;
  const saturation = options.saturation ?? 0;
  const saturationFactor = 1 + saturation / 100;

  if (brightness === 0 && contrastFactor === 1 && saturationFactor === 1) return;

  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] === 0) continue;
    let r = pixels[index] + brightness;
    let g = pixels[index + 1] + brightness;
    let b = pixels[index + 2] + brightness;

    if (contrastFactor !== 1) {
      r = (r - 128) * contrastFactor + 128;
      g = (g - 128) * contrastFactor + 128;
      b = (b - 128) * contrastFactor + 128;
    }

    if (saturationFactor !== 1) {
      const grey = luma(r, g, b);
      r = grey + (r - grey) * saturationFactor;
      g = grey + (g - grey) * saturationFactor;
      b = grey + (b - grey) * saturationFactor;
    }

    pixels[index] = clampChannel(r);
    pixels[index + 1] = clampChannel(g);
    pixels[index + 2] = clampChannel(b);
  }
}

/** 3×3 unsharp mask; `amount` is 0…100. */
export function applySharpen(pixels: Pixels, width: number, height: number, amount: number): void {
  if (amount <= 0 || width < 3 || height < 3) return;
  const strength = (amount / 100) * 1.6;
  const source = new Uint8ClampedArray(pixels);

  const at = (x: number, y: number, channel: number) =>
    source[((y * width + x) << 2) + channel];

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = (y * width + x) << 2;
      if (source[index + 3] === 0) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        const centre = source[index + channel];
        const neighbours =
          at(x - 1, y - 1, channel) + at(x, y - 1, channel) + at(x + 1, y - 1, channel) +
          at(x - 1, y, channel) + at(x + 1, y, channel) +
          at(x - 1, y + 1, channel) + at(x, y + 1, channel) + at(x + 1, y + 1, channel);
        const blurred = neighbours / 8;
        pixels[index + channel] = clampChannel(centre + (centre - blurred) * strength);
      }
    }
  }
}

/** Run the whole stack over one image buffer, in a stable order. */
export function applyFilterStack(
  pixels: Pixels,
  width: number,
  height: number,
  filters: Pick<FilterSettings, "autoLevels" | "brightness" | "contrast" | "saturation" | "sharpen">,
): void {
  if (filters.autoLevels) applyAutoLevels(pixels);
  applyTone(pixels, { brightness: filters.brightness, contrast: filters.contrast, saturation: filters.saturation });
  applySharpen(pixels, width, height, filters.sharpen);
}


function matteCanvas(source: HTMLCanvasElement): { canvas: HTMLCanvasElement; box: MaskResult["box"]; removed: number; coverage: number } | null {
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = source;
  const { data } = ctx.getImageData(0, 0, width, height);
  const result = buildForegroundMask(data, width, height);
  if (!result) return null;

  const maskCanvas = makeCanvas(width, height);
  const maskCtx = maskCanvas.getContext("2d");
  const cutout = makeCanvas(width, height);
  const cutoutCtx = cutout.getContext("2d");
  if (!maskCtx || !cutoutCtx) return null;

  const maskImage = maskCtx.createImageData(width, height);
  for (let index = 0; index < result.mask.length; index += 1) {
    const value = result.mask[index];
    const offset = index * 4;
    maskImage.data[offset] = value;
    maskImage.data[offset + 1] = value;
    maskImage.data[offset + 2] = value;
    maskImage.data[offset + 3] = 255;
  }
  maskCtx.putImageData(maskImage, 0, 0);

  cutoutCtx.drawImage(source, 0, 0);
  cutoutCtx.globalCompositeOperation = "destination-in";
  cutoutCtx.drawImage(maskCanvas, 0, 0);
  cutoutCtx.globalCompositeOperation = "source-over";

  return { canvas: cutout, box: result.box, removed: result.removed, coverage: result.coverage };
}

/** Apply the filter stack in place on a canvas (alpha 0 pixels are skipped). */
function filterCanvas(canvas: HTMLCanvasElement, filters: FilterSettings): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyFilterStack(image.data, canvas.width, canvas.height, filters);
  ctx.putImageData(image, 0, 0);
}

export async function prepareImageFile(file: File, options: PrepareOptions = {}): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("That file is not an image. Use PNG, JPG or WEBP.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Image is larger than 24 MB. Try a smaller file.");
  }

  const target = Math.min(Math.max(Math.round(options.size ?? 1024), 512), 1536);
  const filters: FilterSettings = { ...DEFAULT_FILTERS, ...(options.filters ?? {}) };
  const plate = PLATE_COLORS[filters.plate] ?? PLATE_COLORS.paper;

  const bitmap = await loadBitmap(file);
  const originalDataUrl = await renderPreview(bitmap, 480);
  const { width: sourceWidth, height: sourceHeight } = bitmapSize(bitmap);

  // Work at ~1 MP: fit inside 90% of the target square, upscaling small uploads.
  const inner = Math.round(target * 0.9);
  const scale = Math.min(inner / sourceWidth, inner / sourceHeight);
  const workWidth = Math.max(1, Math.round(sourceWidth * scale));
  const workHeight = Math.max(1, Math.round(sourceHeight * scale));

  const work = makeCanvas(workWidth, workHeight);
  const workCtx = work.getContext("2d", { willReadFrequently: true });
  if (!workCtx) throw new Error("This browser cannot process images.");
  workCtx.fillStyle = plate;
  workCtx.fillRect(0, 0, workWidth, workHeight);
  workCtx.imageSmoothingQuality = "high";
  workCtx.drawImage(bitmap as CanvasImageSource, 0, 0, workWidth, workHeight);
  closeBitmap(bitmap);

  const output = makeCanvas(target, target);
  const outputCtx = output.getContext("2d");
  if (!outputCtx) throw new Error("This browser cannot process images.");
  outputCtx.fillStyle = plate;
  outputCtx.fillRect(0, 0, target, target);
  outputCtx.imageSmoothingQuality = "high";

  let matte: MatteInfo | null = null;

  if (filters.matte) {
    const result = matteCanvas(work);
    if (result) {
      // Tone-map the cut-out (background pixels are transparent, so untouched)
      // before it is scaled into the square.
      filterCanvas(result.canvas, filters);
      const { box } = result;
      const fit = Math.round(target * 0.86);
      const ratio = Math.min(fit / box.width, fit / box.height);
      const drawWidth = Math.max(1, Math.round(box.width * ratio));
      const drawHeight = Math.max(1, Math.round(box.height * ratio));
      const dx = Math.round((target - drawWidth) / 2);
      const dy = Math.round((target - drawHeight) / 2);
      outputCtx.drawImage(result.canvas, box.x, box.y, box.width, box.height, dx, dy, drawWidth, drawHeight);
      matte = { applied: true, removed: result.removed, coverage: result.coverage };
    }
  }

  if (!matte) {
    // No usable cut-out (or matte disabled): tone-map the whole frame.
    filterCanvas(work, filters);
    const dx = Math.round((target - workWidth) / 2);
    const dy = Math.round((target - workHeight) / 2);
    outputCtx.drawImage(work, dx, dy);
  }

  const dataUrl = output.toDataURL("image/jpeg", 0.92);

  return {
    dataUrl,
    originalDataUrl,
    name: file.name || "upload",
    width: target,
    height: target,
    bytes: estimateDataUrlBytes(dataUrl),
    matte,
    filters,
  };
}
