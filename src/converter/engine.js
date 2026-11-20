/**
 * Browser image conversion & optimization engine synthesized from MAZANOKE
 * (https://github.com/civilblur/mazanoke, GPL-3.0).
 *
 * Pipeline:
 *   1. Lazy-load Mazanoke's vendor codecs on demand (Chrome MV3 CSP-safe: no eval, no blob workers).
 *   2. Pre-process exotic formats: HEIC/HEIF (libheif-js), TIFF/DNG (UTIF.js), ICO (icojs),
 *      SVG without explicit width/height attributes, AVIF/GIF/BMP.
 *   3. Composite transparency onto white/black when targeting JPG, and apply exact aspect-preserving
 *      resizing (Original / Fit within / Scale / ICO 256px max).
 *   4. Optimize via browser-image-compression (Quality mode or iterative Target File Size mode,
 *      always stripping EXIF metadata).
 *   5. Post-process to `.ico` via icojs when ICO output is selected.
 */

import {
  detectInputMime,
  isHeicMime,
  isTiffMime,
  isIcoMime,
  resolveOutputSpec,
  computeTargetDimensions,
  computeTargetMaxSizeMB,
  pngColorCountFromQuality,
  shouldGuardSameFormatBloat,
} from "./rules.js";

const VENDOR_PATHS = Object.freeze({
  imageCompression: "vendor/mazanoke/browser-image-compression.js",
  ico: "vendor/mazanoke/ico.js",
  utif: "vendor/mazanoke/utif.js",
  libheif: "vendor/mazanoke/libheif.js",
  upng: "vendor/mazanoke/upng.js",
});

const loadedScripts = new Map();
let libheifInstance = null;

function resolveVendorUrl(relPath) {
  try {
    if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
      return chrome.runtime.getURL(relPath);
    }
  } catch {}
  return new URL(relPath, location.href).href;
}

/** Load a UMD vendor script once via a regular <script> tag (MV3 CSP compliant). */
function loadScript(key) {
  if (loadedScripts.has(key)) return loadedScripts.get(key);
  const src = resolveVendorUrl(VENDOR_PATHS[key]);
  const p = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-mazanoke-vendor="${key}"]`);
    if (existing && existing.dataset.loaded === "true") return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.mazanokeVendor = key;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => {
      loadedScripts.delete(key);
      reject(new Error(`Could not load codec: ${key}`));
    };
    document.head.appendChild(script);
  });
  loadedScripts.set(key, p);
  return p;
}

async function getImageCompression() {
  if (typeof globalThis.imageCompression === "function") return globalThis.imageCompression;
  await loadScript("imageCompression");
  if (typeof globalThis.imageCompression !== "function") {
    throw new Error("Compression engine failed to initialize");
  }
  return globalThis.imageCompression;
}

async function getIcoLib() {
  if (globalThis.ICO) return globalThis.ICO;
  await loadScript("ico");
  if (!globalThis.ICO) throw new Error("ICO codec failed to initialize");
  return globalThis.ICO;
}

async function getUtifLib() {
  if (globalThis.UTIF) return globalThis.UTIF;
  await loadScript("utif");
  if (!globalThis.UTIF) throw new Error("TIFF codec failed to initialize");
  return globalThis.UTIF;
}

async function getLibheif() {
  if (libheifInstance) return libheifInstance;
  if (typeof globalThis.libheif !== "function") {
    await loadScript("libheif");
  }
  if (typeof globalThis.libheif !== "function") {
    throw new Error("HEIC codec failed to initialize");
  }
  libheifInstance = globalThis.libheif();
  return libheifInstance;
}

async function getUpngLib() {
  if (globalThis.UPNG) return globalThis.UPNG;
  await loadScript("upng");
  if (!globalThis.UPNG) throw new Error("PNG optimizer failed to initialize");
  return globalThis.UPNG;
}

// ─── Canvas helpers ──────────────────────────────────────────────────

function canvasToBlob(canvas, mime = "image/png", quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas encoding failed"))),
      mime,
      quality,
    );
  });
}

function rgbaToPngBlob(rgba, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas, "image/png", 1);
}

function loadHtmlImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image could not be decoded"));
    };
    img.src = url;
  });
}

/**
 * Draw any browser-decodable blob onto a clean canvas at (w, h), stripping EXIF
 * and optionally compositing alpha onto a solid background (white or black).
 */
async function renderToCanvas(blob, targetW, targetH, { opaqueBg = false, bgWhite = true } = {}) {
  let drawable = null;
  let closeable = false;
  try {
    drawable = await createImageBitmap(blob);
    closeable = true;
  } catch {
    drawable = await loadHtmlImage(blob);
  }
  try {
    const w = Math.max(1, Math.round(targetW || drawable.width || drawable.naturalWidth || 1));
    const h = Math.max(1, Math.round(targetH || drawable.height || drawable.naturalHeight || 1));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: !opaqueBg, willReadFrequently: true });
    if (opaqueBg) {
      ctx.fillStyle = bgWhite ? "#ffffff" : "#000000";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(drawable, 0, 0, w, h);
    return { canvas, width: w, height: h };
  } finally {
    if (closeable) drawable.close?.();
  }
}

async function renderToCanvasBlob(blob, targetW, targetH, { mime = "image/png", quality, opaqueBg = false, bgWhite = true } = {}) {
  const { canvas } = await renderToCanvas(blob, targetW, targetH, { opaqueBg, bgWhite });
  return canvasToBlob(canvas, mime, quality);
}

/**
 * Encode a canvas as an optimized PNG via UPNG.js:
 * - cnum = 0: lossless PNG (with optimal filter & bit depth)
 * - cnum = 16..256: indexed palette PNG-8 with full alpha (TinyPNG-style 65-80% savings)
 */
async function encodeCanvasToPng(canvas, cnum) {
  const UPNG = await getUpngLib();
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const rgba = ctx.getImageData(0, 0, width, height).data.buffer;
  const encoded = UPNG.encode([rgba], width, height, cnum);
  return new Blob([encoded], { type: "image/png" });
}

/**
 * Compress a PNG using Quality mode (palette quantization) or Target Size mode
 * (palette reduction first to preserve full resolution, then smooth downscaling).
 */
async function compressPng(sourceBlob, targetW, targetH, item, prefs, resized, { signal, report }) {
  const isLimitWeight = prefs.compressMethod === "limitWeight";
  const { canvas } = await renderToCanvas(sourceBlob, targetW, targetH, { opaqueBg: false });
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  report(45);

  if (!isLimitWeight) {
    const cnum = pngColorCountFromQuality(prefs.quality);
    let bestBlob = await encodeCanvasToPng(canvas, cnum);
    report(78);

    // For tiny/simple graphics or lossless mode, also compare native canvas PNG and keep whichever is smaller.
    if (cnum === 0 || bestBlob.size < 64 * 1024) {
      const nativePng = await canvasToBlob(canvas, "image/png");
      if (nativePng.size < bestBlob.size) bestBlob = nativePng;
    }

    // If re-encoding an existing PNG at quality < 100 without resizing still expanded, try one tighter palette step.
    if (item.inputMime === "image/png" && !resized && cnum > 16 && bestBlob.size > item.blob.size) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const tighter = await encodeCanvasToPng(canvas, Math.max(16, Math.round(cnum * 0.6)));
      if (tighter.size < bestBlob.size) bestBlob = tighter;
    }

    report(100);
    return { blob: bestBlob, width: targetW, height: targetH };
  }

  // Target File Size mode for PNG:
  const targetBytes = Math.round(computeTargetMaxSizeMB(prefs) * 1024 * 1024);

  // Pass 1: Try adaptive palette quantization at full target resolution first.
  const palettes = [256, 160, 96, 48, 24];
  let bestBlob = null;
  let bestW = targetW;
  let bestH = targetH;

  for (let i = 0; i < palettes.length; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const candidate = await encodeCanvasToPng(canvas, palettes[i]);
    if (!bestBlob || candidate.size < bestBlob.size) {
      bestBlob = candidate;
    }
    report(48 + i * 7);
    if (candidate.size <= targetBytes) {
      report(100);
      return { blob: candidate, width: targetW, height: targetH };
    }
  }

  // Pass 2: Still above target size — smoothly step down dimensions while quantizing.
  let curW = targetW;
  let curH = targetH;
  let curSize = bestBlob.size;

  for (let step = 0; step < 6; step++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (Math.max(curW, curH) <= 64) break;
    const ratio = Math.min(0.84, Math.max(0.45, Math.sqrt(targetBytes / Math.max(1, curSize)) * 0.94));
    const nextW = Math.max(1, Math.round(curW * ratio));
    const nextH = Math.max(1, Math.round(curH * ratio));
    if (nextW === curW && nextH === curH) break;
    curW = nextW;
    curH = nextH;

    const scaled = await renderToCanvas(sourceBlob, curW, curH, { opaqueBg: false });
    const cnum = step < 2 ? 128 : step < 4 ? 64 : 32;
    const candidate = await encodeCanvasToPng(scaled.canvas, cnum);
    curSize = candidate.size;
    if (candidate.size < bestBlob.size) {
      bestBlob = candidate;
      bestW = curW;
      bestH = curH;
    }
    report(82 + step * 3);
    if (candidate.size <= targetBytes) break;
  }

  report(100);
  return { blob: bestBlob, width: bestW, height: bestH };
}

// ─── Mazanoke Pre-processors ─────────────────────────────────────────

/** Decode HEIC/HEIF directly via Mazanoke's libheif-js (pure JS, MV3 CSP-safe). */
async function decodeHeicToPng(file) {
  const heif = await getLibheif();
  const buffer = new Uint8Array(await file.arrayBuffer());
  const decoder = new heif.HeifDecoder();
  const images = decoder.decode(buffer);
  if (!images || !images.length) {
    throw new Error("Could not decode HEIC image");
  }
  const image = images.find((img) => img.is_primary?.()) || images[0];
  const width = image.get_width();
  const height = image.get_height();
  if (!width || !height) throw new Error("Empty HEIC image");

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);

  await new Promise((resolve, reject) => {
    image.display(imageData, (displayData) => {
      if (!displayData) return reject(new Error("HEIC pixel decode failed"));
      resolve(displayData);
    });
  });

  ctx.putImageData(imageData, 0, 0);
  const blob = await canvasToBlob(canvas, "image/png", 1);
  return { blob, width, height };
}

/** Decode TIFF / DNG via Mazanoke's UTIF.js. */
async function decodeTiffToPng(file) {
  const UTIF = await getUtifLib();
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  if (!ifds || !ifds.length) throw new Error("Could not decode TIFF image");
  UTIF.decodeImage(buffer, ifds[0]);
  const rgba = UTIF.toRGBA8(ifds[0]);
  const width = ifds[0].width;
  const height = ifds[0].height;
  const blob = await rgbaToPngBlob(rgba, width, height);
  return { blob, width, height };
}

/** Decode ICO via Mazanoke's icojs, selecting the highest-resolution frame. */
async function decodeIcoToPng(file) {
  const ICO = await getIcoLib();
  const buffer = await file.arrayBuffer();
  if (!ICO.isIco(buffer)) {
    throw new Error("File is not a valid ICO image");
  }
  const frames = await ICO.decodeIco(buffer, "image/png");
  if (!frames || !frames.length) throw new Error("ICO contains no images");
  frames.sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
  const best = frames[0];
  const rawBlob = new Blob([best.buffer], { type: "image/png" });
  const img = await loadHtmlImage(rawBlob);
  return { blob: rawBlob, width: img.naturalWidth || best.width, height: img.naturalHeight || best.height };
}

/**
 * Mazanoke SVG pre-processor: ensures explicit width & height attributes exist
 * (derived from viewBox when omitted) so canvas rasterization works reliably.
 */
async function normalizeSvgToPng(file) {
  const text = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("Invalid SVG markup");

  let w = parseFloat(svg.getAttribute("width"));
  let h = parseFloat(svg.getAttribute("height"));

  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) {
    const vb = (svg.getAttribute("viewBox") || "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      w = Math.round(vb[2]);
      h = Math.round(vb[3]);
    } else {
      w = 1024;
      h = 1024;
    }
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
  }

  const serialized = new XMLSerializer().serializeToString(doc);
  const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const pngBlob = await renderToCanvasBlob(svgBlob, w, h, { mime: "image/png" });
  return { blob: pngBlob, width: Math.round(w), height: Math.round(h) };
}

/**
 * Probe and decode any supported image (including HEIC, TIFF, ICO, SVG, AVIF)
 * into a browser-safe raster source + real dimensions + preview URL.
 */
export async function ingestImageFile(file) {
  const inputMime = detectInputMime(file);

  if (isHeicMime(inputMime)) {
    const decoded = await decodeHeicToPng(file);
    return { inputMime, width: decoded.width, height: decoded.height, rasterBlob: decoded.blob, previewBlob: decoded.blob };
  }

  if (isTiffMime(inputMime)) {
    const decoded = await decodeTiffToPng(file);
    return { inputMime, width: decoded.width, height: decoded.height, rasterBlob: decoded.blob, previewBlob: decoded.blob };
  }

  if (isIcoMime(inputMime)) {
    const decoded = await decodeIcoToPng(file);
    return { inputMime, width: decoded.width, height: decoded.height, rasterBlob: decoded.blob, previewBlob: decoded.blob };
  }

  if (inputMime === "image/svg+xml") {
    const decoded = await normalizeSvgToPng(file);
    return { inputMime, width: decoded.width, height: decoded.height, rasterBlob: decoded.blob, previewBlob: decoded.blob };
  }

  // Standard browser-decodable image (JPG, PNG, WebP, AVIF, GIF, BMP).
  let width = 0;
  let height = 0;
  try {
    const bmp = await createImageBitmap(file);
    width = bmp.width;
    height = bmp.height;
    bmp.close();
  } catch {
    const img = await loadHtmlImage(file);
    width = img.naturalWidth || img.width;
    height = img.naturalHeight || img.height;
  }

  if (!width || !height) throw new Error("Empty or unreadable image");

  // AVIF / GIF / BMP are pre-rasterized to PNG when needed by browser-image-compression.
  const needsPreRaster = inputMime === "image/avif" || inputMime === "image/gif" || inputMime === "image/bmp";
  const rasterBlob = needsPreRaster ? await renderToCanvasBlob(file, width, height, { mime: "image/png" }) : null;

  return {
    inputMime,
    width,
    height,
    rasterBlob,
    previewBlob: rasterBlob || file,
  };
}

// ─── Main Conversion Pipeline ────────────────────────────────────────

/**
 * Convert & optimize one ingested item according to `prefs`.
 * Returns `{ blob, width, height, ext, mime }`.
 */
export async function convertImageItem(item, prefs, { signal, onProgress } = {}) {
  const report = (pct) => {
    try {
      onProgress?.(Math.max(0, Math.min(100, Math.round(pct))));
    } catch {}
  };

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  report(5);

  const spec = resolveOutputSpec(item.inputMime, prefs.format);
  const [targetW, targetH] = computeTargetDimensions(item.width, item.height, prefs, spec.formatId);
  const resized = targetW !== item.width || targetH !== item.height;

  // Step 1: Prepare clean raster input (handles HEIC/TIFF/ICO/SVG pre-decoded
  // blobs, exact W×H resizing, and white/black background compositing for JPG).
  let workingBlob = item.rasterBlob || item.blob;

  // Dedicated ICO pipeline (<= 256×256 lossless PNG wrapped via Mazanoke's icojs).
  if (spec.needsIcoPostProcess) {
    const icoPng = await renderToCanvasBlob(workingBlob, targetW, targetH, { mime: "image/png" });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    report(75);
    const ICO = await getIcoLib();
    const arrayBuffer = await icoPng.arrayBuffer();
    const icoBuffer = await ICO.encodeIco([{ buffer: arrayBuffer }]);
    const outputBlob = new Blob([icoBuffer], { type: "image/vnd.microsoft.icon" });
    report(100);
    return {
      blob: outputBlob,
      width: targetW,
      height: targetH,
      ext: spec.ext,
      mime: spec.outputMime,
    };
  }

  // Dedicated PNG pipeline via UPNG.js (adaptive palette quantization in Quality mode,
  // lossless optimization at 100%, and resolution-preserving Target Size compression).
  if (spec.intermediateMime === "image/png") {
    report(25);
    const pngResult = await compressPng(workingBlob, targetW, targetH, item, prefs, resized, { signal, report });
    return {
      blob: pngResult.blob,
      width: pngResult.width,
      height: pngResult.height,
      ext: spec.ext,
      mime: spec.outputMime,
    };
  }

  const needsCanvasPrep = resized || spec.needsOpaqueBg;
  if (needsCanvasPrep) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const prepMime = spec.needsOpaqueBg ? "image/jpeg" : "image/png";
    const prepQuality = spec.needsOpaqueBg ? 0.98 : undefined;
    workingBlob = await renderToCanvasBlob(workingBlob, targetW, targetH, {
      mime: prepMime,
      quality: prepQuality,
      opaqueBg: spec.needsOpaqueBg,
      bgWhite: prefs.bgWhite,
    });
  }
  report(30);

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Step 2: Lossy compression (JPG / WebP) via Mazanoke's browser-image-compression engine.
  const imageCompression = await getImageCompression();
  const isLimitWeight = prefs.compressMethod === "limitWeight";
  const maxSizeMB = isLimitWeight ? computeTargetMaxSizeMB(prefs) : Number.POSITIVE_INFINITY;
  const initialQuality = isLimitWeight ? 0.92 : Math.min(1, Math.max(0.1, prefs.quality / 100));

  // browser-image-compression expects a File or Blob; wrap as File for consistent metadata.
  const inputFile =
    workingBlob instanceof File
      ? workingBlob
      : new File([workingBlob], `${item.name || "image"}.png`, { type: workingBlob.type || "image/png" });

  let compressed = await imageCompression(inputFile, {
    maxSizeMB,
    initialQuality,
    maxWidthOrHeight: Math.max(targetW, targetH),
    useWebWorker: false, // MV3 CSP-safe; runs cleanly without blob workers
    preserveExif: false, // Privacy: always strip EXIF metadata
    fileType: spec.intermediateMime,
    alwaysKeepResolution: !isLimitWeight,
    maxIteration: isLimitWeight ? 14 : 1,
    signal,
    onProgress: (p) => report(30 + p * 0.6),
  });

  // Smart bloat guard: when re-encoding the same lossy format without resizing at quality < 100,
  // avoid inflating already-optimized web images while still keeping EXIF stripped.
  if (
    !isLimitWeight &&
    shouldGuardSameFormatBloat(item.inputMime, spec.intermediateMime, resized, prefs.quality) &&
    compressed.size > item.blob.size
  ) {
    const probes = [Math.max(0.55, initialQuality - 0.14), Math.max(0.45, initialQuality - 0.24)];
    for (const q of probes) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (q >= initialQuality - 0.02) continue;
      const candidate = await imageCompression(inputFile, {
        maxSizeMB: Number.POSITIVE_INFINITY,
        initialQuality: q,
        maxWidthOrHeight: Math.max(targetW, targetH),
        useWebWorker: false,
        preserveExif: false,
        fileType: spec.intermediateMime,
        alwaysKeepResolution: true,
        maxIteration: 1,
        signal,
      });
      if (candidate.size < compressed.size) compressed = candidate;
      if (compressed.size <= item.blob.size) break;
    }
  }

  // Measure actual output dimensions (limitWeight mode may downscale if needed to hit tight KB targets).
  let finalW = targetW;
  let finalH = targetH;
  try {
    const bmp = await createImageBitmap(compressed);
    finalW = bmp.width;
    finalH = bmp.height;
    bmp.close();
  } catch {
    try {
      const img = await loadHtmlImage(compressed);
      finalW = img.naturalWidth || targetW;
      finalH = img.naturalHeight || targetH;
    } catch {}
  }

  report(100);
  return {
    blob: compressed,
    width: finalW,
    height: finalH,
    ext: spec.ext,
    mime: compressed.type || spec.outputMime,
  };
}
