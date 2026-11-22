/**
 * Lean, zero-bloat local browser image conversion & optimization engine.
 *
 * Pipeline (100% on-device, MV3 CSP-safe, zero external requests):
 *   1. Native browser decoding for PNG, JPG, WebP, AVIF, GIF, BMP, ICO + SVG viewBox normalization.
 *   2. Exact aspect-preserving canvas rendering (Original / Fit within / Scale / ICO <= 256px)
 *      with automatic EXIF stripping and optional white/black background compositing for JPG.
 *   3. Lossy JPG / WebP optimization using native Canvas encoding (Quality mode with smart bloat
 *      guard, plus iterative binary-search Quality + smooth downscale Target File Size mode).
 *   4. PNG optimization via lazy-loaded UPNG.js (adaptive palette quantization in Quality mode,
 *      lossless at 100%, and resolution-preserving Target File Size compression).
 *   5. Zero-dependency PNG-in-ICO encoding via `encodePngToIco`.
 */

import {
  detectInputMime,
  resolveOutputSpec,
  computeTargetDimensions,
  computeTargetMaxSizeMB,
  pngColorCountFromQuality,
  shouldGuardSameFormatBloat,
  encodePngToIco,
} from "./rules.js";

const VENDOR_PATHS = Object.freeze({
  upng: "vendor/mazanoke/upng.js",
});

const loadedScripts = new Map();

function resolveVendorUrl(relPath) {
  try {
    if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
      return chrome.runtime.getURL(relPath);
    }
  } catch {}
  return new URL(relPath, location.href).href;
}

/** Load a local UMD vendor script once via a regular <script> tag (MV3 CSP compliant). */
function loadScript(key) {
  if (loadedScripts.has(key)) return loadedScripts.get(key);
  const src = resolveVendorUrl(VENDOR_PATHS[key]);
  const p = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-swift-vendor="${key}"]`);
    if (existing && existing.dataset.loaded === "true") return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.swiftVendor = key;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => {
      loadedScripts.delete(key);
      reject(new Error(`Could not load optimizer: ${key}`));
    };
    document.head.appendChild(script);
  });
  loadedScripts.set(key, p);
  return p;
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

// ─── PNG Compression (UPNG.js) ───────────────────────────────────────

async function encodeCanvasToPng(canvas, cnum) {
  const UPNG = await getUpngLib();
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const rgba = ctx.getImageData(0, 0, width, height).data.buffer;
  const encoded = UPNG.encode([rgba], width, height, cnum);
  return new Blob([encoded], { type: "image/png" });
}

async function compressPng(sourceBlob, targetW, targetH, item, prefs, resized, { signal, report }) {
  const isLimitWeight = prefs.compressMethod === "limitWeight";
  const { canvas } = await renderToCanvas(sourceBlob, targetW, targetH, { opaqueBg: false });
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  report(45);

  if (!isLimitWeight) {
    const cnum = pngColorCountFromQuality(prefs.quality);
    let bestBlob = await encodeCanvasToPng(canvas, cnum);
    report(78);

    if (cnum === 0 || bestBlob.size < 64 * 1024) {
      const nativePng = await canvasToBlob(canvas, "image/png");
      if (nativePng.size < bestBlob.size) bestBlob = nativePng;
    }

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

  // Pass 1: Adaptive palette quantization at full resolution first.
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

  // Pass 2: Smoothly step down dimensions if still above target bytes.
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

// ─── Native Canvas Lossy Compression (JPG / WebP) ────────────────────

async function compressLossy(sourceBlob, targetW, targetH, spec, item, prefs, resized, { signal, report }) {
  const mime = spec.intermediateMime;
  const opaqueBg = spec.needsOpaqueBg;
  const bgWhite = prefs.bgWhite;
  const isLimitWeight = prefs.compressMethod === "limitWeight";

  const { canvas } = await renderToCanvas(sourceBlob, targetW, targetH, { opaqueBg, bgWhite });
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  report(35);

  if (!isLimitWeight) {
    const q = Math.min(1, Math.max(0.1, prefs.quality / 100));
    let compressed = await canvasToBlob(canvas, mime, q);
    report(75);

    // Smart bloat guard: avoid inflating already-optimized JPG/WebP images when not resizing at quality < 100.
    if (shouldGuardSameFormatBloat(item.inputMime, mime, resized, prefs.quality) && compressed.size > item.blob.size) {
      const probes = [Math.max(0.55, q - 0.14), Math.max(0.45, q - 0.24)];
      for (const probeQ of probes) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (probeQ >= q - 0.02) continue;
        const candidate = await canvasToBlob(canvas, mime, probeQ);
        if (candidate.size < compressed.size) compressed = candidate;
        if (compressed.size <= item.blob.size) break;
      }
    }

    report(100);
    return { blob: compressed, width: targetW, height: targetH };
  }

  // Target File Size mode: binary search quality at full target resolution first.
  const targetBytes = Math.round(computeTargetMaxSizeMB(prefs) * 1024 * 1024);

  let bestUnder = null;
  let smallest = null;

  const highCandidate = await canvasToBlob(canvas, mime, 0.92);
  smallest = highCandidate;
  if (highCandidate.size <= targetBytes) {
    report(100);
    return { blob: highCandidate, width: targetW, height: targetH };
  }

  let lo = 0.14;
  let hi = 0.92;
  for (let i = 0; i < 6; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const mid = (lo + hi) / 2;
    const candidate = await canvasToBlob(canvas, mime, mid);
    if (candidate.size < smallest.size) smallest = candidate;
    if (candidate.size <= targetBytes) {
      bestUnder = candidate;
      lo = mid;
    } else {
      hi = mid;
    }
    report(42 + i * 7);
  }

  if (bestUnder) {
    report(100);
    return { blob: bestUnder, width: targetW, height: targetH };
  }

  // Still above target bytes at lowest quality: smoothly downscale dimensions.
  let bestBlob = smallest;
  let bestW = targetW;
  let bestH = targetH;
  let curW = targetW;
  let curH = targetH;
  let curSize = smallest.size;

  for (let step = 0; step < 6; step++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (Math.max(curW, curH) <= 64) break;
    const ratio = Math.min(0.84, Math.max(0.45, Math.sqrt(targetBytes / Math.max(1, curSize)) * 0.94));
    const nextW = Math.max(1, Math.round(curW * ratio));
    const nextH = Math.max(1, Math.round(curH * ratio));
    if (nextW === curW && nextH === curH) break;
    curW = nextW;
    curH = nextH;

    const scaled = await renderToCanvas(sourceBlob, curW, curH, { opaqueBg, bgWhite });
    const candidate = await canvasToBlob(scaled.canvas, mime, 0.72);
    curSize = candidate.size;
    if (candidate.size < bestBlob.size) {
      bestBlob = candidate;
      bestW = curW;
      bestH = curH;
    }
    report(84 + step * 2.5);
    if (candidate.size <= targetBytes) break;
  }

  report(100);
  return { blob: bestBlob, width: bestW, height: bestH };
}

// ─── SVG normalizer & Ingestion ──────────────────────────────────────

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
 * Probe and decode any browser-supported image (PNG, JPG, WebP, AVIF, GIF, SVG, BMP, ICO)
 * into a raster source + dimensions + preview blob.
 */
export async function ingestImageFile(file) {
  const inputMime = detectInputMime(file);

  if (inputMime === "image/svg+xml") {
    const decoded = await normalizeSvgToPng(file);
    return { inputMime, width: decoded.width, height: decoded.height, rasterBlob: decoded.blob, previewBlob: decoded.blob };
  }

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

  // Pre-rasterize ICO / AVIF / GIF / BMP so preview & canvas operations stay fast and reliable.
  const needsPreRaster =
    inputMime === "image/avif" ||
    inputMime === "image/gif" ||
    inputMime === "image/bmp" ||
    inputMime === "image/vnd.microsoft.icon" ||
    inputMime === "image/x-icon";
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
  report(8);

  const spec = resolveOutputSpec(item.inputMime, prefs.format);
  const [targetW, targetH] = computeTargetDimensions(item.width, item.height, prefs, spec.formatId);
  const resized = targetW !== item.width || targetH !== item.height;
  const workingBlob = item.rasterBlob || item.blob;

  // Dedicated zero-dependency ICO pipeline (<= 256×256 PNG wrapped in standard ICO container).
  if (spec.needsIcoPostProcess) {
    const icoPng = await renderToCanvasBlob(workingBlob, targetW, targetH, { mime: "image/png" });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    report(75);
    const pngBytes = new Uint8Array(await icoPng.arrayBuffer());
    const icoBytes = encodePngToIco(pngBytes, targetW, targetH);
    const outputBlob = new Blob([icoBytes], { type: "image/vnd.microsoft.icon" });
    report(100);
    return {
      blob: outputBlob,
      width: targetW,
      height: targetH,
      ext: spec.ext,
      mime: spec.outputMime,
    };
  }

  // Dedicated PNG pipeline via UPNG.js.
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

  // Native Canvas JPG / WebP compression (zero dependencies, EXIF always stripped).
  const lossyResult = await compressLossy(workingBlob, targetW, targetH, spec, item, prefs, resized, { signal, report });
  return {
    blob: lossyResult.blob,
    width: lossyResult.width,
    height: lossyResult.height,
    ext: spec.ext,
    mime: lossyResult.blob.type || spec.outputMime,
  };
}
