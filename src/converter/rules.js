/**
 * Pure image conversion rules, format mapping, dimension math, target weight
 * validation, filename deduplication, and stored ZIP archive builder.
 *
 * Synthesized from MAZANOKE (https://github.com/civilblur/mazanoke, GPL-3.0)
 * and decoupled from DOM APIs so every rule is fast and unit-testable.
 */
import { buildFilename, DEFAULTS as SETTINGS_DEFAULTS } from "../settings.js";

export const FORMATS = Object.freeze({
  auto: { id: "auto", label: "Auto", ext: null, mime: null, lossy: true },
  jpg: { id: "jpg", label: "JPG", ext: "jpg", mime: "image/jpeg", lossy: true },
  png: { id: "png", label: "PNG", ext: "png", mime: "image/png", lossy: false },
  webp: { id: "webp", label: "WebP", ext: "webp", mime: "image/webp", lossy: true },
  ico: { id: "ico", label: "ICO", ext: "ico", mime: "image/vnd.microsoft.icon", lossy: false },
});

export const SUPPORTED_INPUT_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/svg+xml",
  "image/bmp",
  "image/vnd.microsoft.icon",
  "image/x-icon",
]);

const EXT_TO_MIME = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/vnd.microsoft.icon",
});

const MIME_TO_EXT = Object.freeze({
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/vnd.microsoft.icon": "ico",
  "image/x-icon": "ico",
});

// Formats browsers can natively encode via Canvas.
const NATIVE_OUTPUT_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Formats that cannot be re-encoded into their original container map cleanly to PNG when format=auto.
const AUTO_FALLBACK_MAP = Object.freeze({
  "image/avif": "image/png",
  "image/gif": "image/png",
  "image/svg+xml": "image/png",
  "image/bmp": "image/png",
  "image/vnd.microsoft.icon": "image/png",
  "image/x-icon": "image/png",
});

export const WEIGHT_LIMIT_MB = Object.freeze({ min: 0.01, max: 100 }); // 10 KB .. 100 MB
export const ICO_MAX_EDGE = 256;
export const PREFS_VERSION = 4;

export const DEFAULT_PREFS = Object.freeze({
  v: PREFS_VERSION,
  format: "jpg", // auto | jpg | png | webp | ico
  compressMethod: "quality", // quality | limitWeight
  quality: 85, // 10 .. 100
  targetWeight: 500, // numeric value in targetWeightUnit
  targetWeightUnit: "KB", // KB | MB
  resize: "none", // none | fit | scale
  maxW: "",
  maxH: "",
  scale: 50, // 10 .. 100
  namingMode: "template", // template (uses Settings Naming Engine) | original
  suffix: "",
  bgWhite: true,
});

export function getExtension(filename = "") {
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(filename || "").trim());
  return m ? m[1].toLowerCase() : "";
}

export function detectInputMime(file) {
  if (!file) return "";
  const ext = getExtension(file.name);
  const rawType = String(file.type || "").toLowerCase().trim();
  // On some OSes ICO / AVIF / WebP can report empty or generic octet-stream MIME types.
  if (ext && EXT_TO_MIME[ext]) {
    if (!rawType || rawType === "application/octet-stream" || ext === "ico") {
      return EXT_TO_MIME[ext];
    }
  }
  if (rawType === "image/jpg") return "image/jpeg";
  if (SUPPORTED_INPUT_MIMES.has(rawType)) return rawType;
  if (ext && EXT_TO_MIME[ext]) return EXT_TO_MIME[ext];
  return rawType;
}

export function isSupportedImageFile(file) {
  const mime = detectInputMime(file);
  return SUPPORTED_INPUT_MIMES.has(mime);
}

export function mimeToExtension(mime = "") {
  const clean = String(mime || "").toLowerCase().trim();
  return MIME_TO_EXT[clean] || clean.replace(/^image\//, "").split("+")[0] || "png";
}

export function isIcoMime(mime) {
  return mime === "image/vnd.microsoft.icon" || mime === "image/x-icon";
}

/**
 * Resolve final output format and intermediate encoding MIME type.
 * For ICO output, we first encode an intermediate lossless PNG and then run
 * icojs post-processing to produce a valid `.ico` container.
 */
export function resolveOutputSpec(inputMime, formatPref = "jpg") {
  const pref = FORMATS[formatPref] ? formatPref : "jpg";
  if (pref === "ico") {
    return {
      formatId: "ico",
      outputMime: "image/vnd.microsoft.icon",
      intermediateMime: "image/png",
      ext: "ico",
      needsIcoPostProcess: true,
      isLossy: false,
      needsOpaqueBg: false,
    };
  }
  if (pref === "auto") {
    const normalizedInput = inputMime === "image/jpg" ? "image/jpeg" : inputMime;
    const resolvedMime = NATIVE_OUTPUT_MIMES.has(normalizedInput)
      ? normalizedInput
      : AUTO_FALLBACK_MAP[normalizedInput] || "image/png";
    const ext = mimeToExtension(resolvedMime);
    return {
      formatId: ext === "jpg" ? "jpg" : ext === "webp" ? "webp" : "png",
      outputMime: resolvedMime,
      intermediateMime: resolvedMime,
      ext,
      needsIcoPostProcess: false,
      isLossy: resolvedMime === "image/jpeg" || resolvedMime === "image/webp",
      needsOpaqueBg: resolvedMime === "image/jpeg",
    };
  }
  const fmt = FORMATS[pref];
  return {
    formatId: fmt.id,
    outputMime: fmt.mime,
    intermediateMime: fmt.mime,
    ext: fmt.ext,
    needsIcoPostProcess: false,
    isLossy: fmt.lossy,
    needsOpaqueBg: fmt.mime === "image/jpeg",
  };
}

/**
 * Validate target file weight against Mazanoke's safe limits (10 KB .. 100 MB).
 */
export function validateTargetWeight(value, unit = "KB") {
  const upper = String(unit || "KB").toUpperCase() === "MB" ? "MB" : "KB";
  const num = Number(value);
  const min = upper === "KB" ? Math.round(WEIGHT_LIMIT_MB.min * 1024) : WEIGHT_LIMIT_MB.min;
  const max = upper === "KB" ? Math.round(WEIGHT_LIMIT_MB.max * 1024) : WEIGHT_LIMIT_MB.max;
  if (!Number.isFinite(num) || num <= 0) {
    return { value: upper === "KB" ? 500 : 1, unit: upper, clamped: true, message: "Enter a positive file size" };
  }
  if (num < min) {
    return { value: min, unit: upper, clamped: true, message: `Minimum target size is ${min} ${upper}` };
  }
  if (num > max) {
    return { value: max, unit: upper, clamped: true, message: `Maximum target size is ${max} ${upper}` };
  }
  return { value: upper === "KB" ? Math.round(num) : Math.round(num * 100) / 100, unit: upper, clamped: false, message: null };
}

export function computeTargetMaxSizeMB(prefs) {
  const unit = String(prefs?.targetWeightUnit || "KB").toUpperCase() === "MB" ? "MB" : "KB";
  const { value } = validateTargetWeight(prefs?.targetWeight, unit);
  return unit === "KB" ? value / 1024 : value;
}

/**
 * Map a 10..100 quality slider to a UPNG palette color count (`cnum`).
 * Returns `0` at 100% for true lossless PNG, and 16..256 indexed colors below 100%
 * for TinyPNG-style lossy PNG compression with full alpha preservation.
 */
export function pngColorCountFromQuality(quality = 85) {
  const q = Math.min(100, Math.max(10, Math.round(Number(quality) || 85)));
  if (q >= 100) return 0;
  if (q >= 90) return 256;
  if (q >= 75) return Math.round(128 + ((q - 75) / 15) * 128);
  if (q >= 50) return Math.round(64 + ((q - 50) / 25) * 64);
  return Math.max(16, Math.round(16 + ((q - 10) / 40) * 48));
}

export function describePngQuality(quality = 85) {
  const cnum = pngColorCountFromQuality(quality);
  return cnum === 0 ? "Lossless" : `${cnum} colors`;
}

/**
 * Guard against inflating already-compressed images when re-encoding into the
 * same lossy format without resizing at quality < 100.
 */
export function shouldGuardSameFormatBloat(inputMime, outputMime, resized = false, quality = 85) {
  if (resized) return false;
  if (Number(quality) >= 100) return false;
  const inNorm = inputMime === "image/jpg" ? "image/jpeg" : String(inputMime || "").toLowerCase();
  const outNorm = outputMime === "image/jpg" ? "image/jpeg" : String(outputMime || "").toLowerCase();
  if (!inNorm || inNorm !== outNorm) return false;
  return outNorm === "image/jpeg" || outNorm === "image/webp";
}

const COMPRESSED_PHOTO_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/avif",
]);

/**
 * Detect when converting a lossy/photo source into PNG produces a significantly
 * larger file so the UI can surface a one-click WebP suggestion.
 */
export function isPhotoToPngExpansion(inputMime, outputMime, beforeBytes, afterBytes) {
  if (String(outputMime || "").toLowerCase() !== "image/png") return false;
  if (!COMPRESSED_PHOTO_MIMES.has(String(inputMime || "").toLowerCase())) return false;
  const before = Number(beforeBytes) || 0;
  const after = Number(afterBytes) || 0;
  return before > 0 && after > before * 1.15;
}

/**
 * Mazanoke-inspired dimension calculation: preserves aspect ratio, never
 * enlarges images, prevents short edges from collapsing to 0 px, and caps
 * ICO exports to 256×256.
 */
export function computeTargetDimensions(width, height, prefs = {}, outputFormatId = "jpg") {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));

  let outW = w;
  let outH = h;

  if (prefs.resize === "scale") {
    const pct = Math.min(100, Math.max(10, Number(prefs.scale) || 50)) / 100;
    outW = Math.max(1, Math.round(w * pct));
    outH = Math.max(1, Math.round(h * pct));
  } else if (prefs.resize === "fit" && (prefs.maxW || prefs.maxH)) {
    const mw = Number(prefs.maxW) > 0 ? Number(prefs.maxW) : Infinity;
    const mh = Number(prefs.maxH) > 0 ? Number(prefs.maxH) : Infinity;
    const scale = Math.min(1, mw / w, mh / h);
    outW = Math.max(1, Math.round(w * scale));
    outH = Math.max(1, Math.round(h * scale));
  }

  // Standard Windows/browser ICO files support up to 256×256 pixels.
  if (outputFormatId === "ico" && (outW > ICO_MAX_EDGE || outH > ICO_MAX_EDGE)) {
    const k = Math.min(ICO_MAX_EDGE / outW, ICO_MAX_EDGE / outH);
    outW = Math.max(1, Math.round(outW * k));
    outH = Math.max(1, Math.round(outH * k));
  }

  return [outW, outH];
}

export function normalizePrefs(raw = {}) {
  const p = { ...DEFAULT_PREFS, ...raw };
  if (!FORMATS[p.format]) p.format = DEFAULT_PREFS.format;
  p.compressMethod = p.compressMethod === "limitWeight" ? "limitWeight" : "quality";
  p.quality = Math.min(100, Math.max(10, Math.round(Number(p.quality) || DEFAULT_PREFS.quality)));
  p.targetWeightUnit = String(p.targetWeightUnit || "KB").toUpperCase() === "MB" ? "MB" : "KB";
  p.targetWeight = validateTargetWeight(p.targetWeight, p.targetWeightUnit).value;
  if (!["none", "fit", "scale"].includes(p.resize)) p.resize = "none";
  p.scale = Math.min(100, Math.max(10, Math.round(Number(p.scale) || 50)));
  const dim = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(20000, n) : "";
  };
  p.maxW = dim(p.maxW);
  p.maxH = dim(p.maxH);
  p.namingMode = p.namingMode === "original" ? "original" : "template";
  p.suffix = String(p.suffix || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .slice(0, 40);
  p.bgWhite = p.bgWhite !== false;
  p.v = PREFS_VERSION;
  return p;
}

export function cleanBaseName(name) {
  return (
    String(name || "image")
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
      .trim() || "image"
  );
}

/**
 * Detect generic browser-assigned download/paste stems ("download", "download (1)",
 * "image", "image (2)", "untitled", "clipboard") so the Naming Engine doesn't
 * repeat meaningless labels like "download - converted - ...".
 */
export function isGenericImageName(name) {
  const stem = String(name || "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .trim();
  if (!stem) return true;
  return /^(download|image|untitled|clipboard|paste|img|photo)(?:[\s_-]*(?:\(\d+\)|\d+|[a-z0-9]{4}))?$/i.test(stem);
}

/**
 * Mazanoke clipboard-paste helper: when browsers paste an image as generic
 * `image.png` or `HEIF Image.heic`, append a short ID so multiple pasted
 * images do not look identical.
 */
export function renameBrowserDefaultFileName(fileName, idSuffix = "") {
  const str = String(fileName || "");
  const defaults = [/^image\.\w+$/i];
  if (!defaults.some((re) => re.test(str))) {
    return { renamedFileName: str, isBrowserDefault: false };
  }
  const base = cleanBaseName(str);
  const ext = getExtension(str);
  const token = idSuffix || Math.random().toString(36).slice(2, 6).toUpperCase();
  return {
    renamedFileName: ext ? `${base}-${token}.${ext}` : `${base}-${token}`,
    isBrowserDefault: true,
  };
}

export function formatOutputFilename(baseName, suffix = "", ext = "jpg") {
  return `${cleanBaseName(baseName)}${suffix || ""}.${String(ext || "jpg").replace(/^\./, "")}`;
}

/**
 * Compute a converted image's output filename using either:
 *   - "template": SwiftSelect's Settings Naming Engine (`buildFilename`)
 *   - "original": Original source filename + optional suffix
 */
export function formatConverterFilename(
  item,
  { namingMode = "template", template = SETTINGS_DEFAULTS.filenameTemplate, suffix = "", ext = "", date = null } = {},
) {
  const finalExt = String(ext || item?.outExt || "jpg").replace(/^\./, "").toLowerCase() || "jpg";
  const cleanSuffix = String(suffix || "").replace(/[<>:"/\\|?*\x00-\x1F]/g, "").slice(0, 40);

  if (namingMode === "original") {
    return formatOutputFilename(item?.name || "image", cleanSuffix, finalExt);
  }

  const rawStem = cleanBaseName(item?.name || "");
  const title = isGenericImageName(rawStem) ? "" : rawStem;
  const stampDate = date instanceof Date ? date : item?.addedAt ? new Date(item.addedAt) : new Date();
  const built = buildFilename(template || SETTINGS_DEFAULTS.filenameTemplate, {
    title,
    url: item?.sourceUrl || "",
    type: "converted",
    ext: finalExt,
    date: stampDate,
  });

  if (!cleanSuffix) return built;
  const stem = built.replace(new RegExp(`\\.${finalExt}$`, "i"), "");
  return `${stem}${cleanSuffix}.${finalExt}`;
}

/** Generate collision-free filenames for a batch download or ZIP archive. */
export function uniqueOutputNames(list, suffix = "", namingOpts = null) {
  const seen = new Map();
  const useTemplate = namingOpts && namingOpts.namingMode === "template";
  return list.map((item) => {
    const ext = String(item.outExt || "jpg").replace(/^\./, "").toLowerCase() || "jpg";
    const full = useTemplate
      ? formatConverterFilename(item, {
          namingMode: "template",
          template: namingOpts.template,
          suffix,
          ext,
          date: namingOpts.date,
        })
      : formatOutputFilename(item.name, suffix, ext);
    const base = full.replace(new RegExp(`\\.${ext}$`, "i"), "");
    const key = `${base.toLowerCase()}.${ext.toLowerCase()}`;
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    return count ? `${base} (${count + 1}).${ext}` : `${base}.${ext}`;
  });
}

export function computeSavings(beforeBytes, afterBytes) {
  const before = Math.max(0, Number(beforeBytes) || 0);
  const after = Math.max(0, Number(afterBytes) || 0);
  if (!before) return { pct: 0, direction: "same", label: "same size" };
  const pct = Math.round((1 - after / before) * 100);
  if (pct > 0) return { pct, direction: "smaller", label: `−${pct}%` };
  if (pct < 0) return { pct: -pct, direction: "larger", label: `+${-pct}%` };
  return { pct: 0, direction: "same", label: "same size" };
}

// ─── Stored ZIP builder (zero dependencies, fast for already-compressed images) ──

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build a standards-compliant stored (method 0) ZIP archive from
 * `{ name: string, bytes: Uint8Array }` or `{ name: string, blob: Blob }` entries.
 */
export async function buildZipBytes(entries, now = new Date()) {
  const enc = new TextEncoder();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const bytes = entry.bytes instanceof Uint8Array ? entry.bytes : new Uint8Array(await entry.blob.arrayBuffer());
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(bytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, bytes);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, bytes.length, true);
    cd.setUint32(24, bytes.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameBytes);

    offset += 30 + nameBytes.length + bytes.length;
  }

  const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);

  const totalLen = offset + cdSize + 22;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const chunk of [...parts, ...central, new Uint8Array(end.buffer)]) {
    out.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return out;
}

// ─── Pure PNG-in-ICO encoder (zero dependencies, standard Vista+ ICO) ────────

/**
 * Wrap a PNG payload (<= 256×256) in a standards-compliant single-image `.ico`
 * container (6-byte ICONDIR + 16-byte ICONDIRENTRY + PNG bytes).
 */
export function encodePngToIco(pngBytes, width, height) {
  const data = pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes);
  const w = Math.max(1, Math.min(ICO_MAX_EDGE, Math.round(Number(width) || 256)));
  const h = Math.max(1, Math.min(ICO_MAX_EDGE, Math.round(Number(height) || 256)));
  const out = new Uint8Array(22 + data.byteLength);
  const view = new DataView(out.buffer);

  // ICONDIR (6 bytes)
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: 1 = ICO
  view.setUint16(4, 1, true); // image count: 1

  // ICONDIRENTRY (16 bytes)
  view.setUint8(6, w >= 256 ? 0 : w); // 0 represents 256px in ICO spec
  view.setUint8(7, h >= 256 ? 0 : h);
  view.setUint8(8, 0); // palette color count (0 for PNG)
  view.setUint8(9, 0); // reserved
  view.setUint16(10, 1, true); // color planes
  view.setUint16(12, 32, true); // bits per pixel
  view.setUint32(14, data.byteLength, true); // image data size
  view.setUint32(18, 22, true); // offset from start of file (6 + 16)

  out.set(data, 22);
  return out;
}

// ─── Conversion signature for zero-friction manual reconvert ─────────────────

/**
 * Deterministic key representing only the settings that actually affect the
 * encoded output bytes for an item (ignores namingMode, suffix, and controls
 * that do not apply to the active format/resize mode).
 */
export function conversionSettingsKey(prefs = {}, inputMime = "") {
  const p = normalizePrefs(prefs);
  const spec = resolveOutputSpec(inputMime || "image/png", p.format);
  const sizePart =
    p.resize === "fit"
      ? `fit:${p.maxW || ""}x${p.maxH || ""}`
      : p.resize === "scale"
        ? `scale:${p.scale}`
        : "none";

  if (spec.formatId === "ico") {
    return `ico|${sizePart}`;
  }

  const compressPart =
    p.compressMethod === "limitWeight"
      ? `w:${p.targetWeight}${p.targetWeightUnit}`
      : `q:${p.quality}`;

  const bgPart = spec.needsOpaqueBg ? `|bg:${p.bgWhite ? "w" : "b"}` : "";
  return `${spec.formatId}|${compressPart}|${sizePart}${bgPart}`;
}

