/**
 * Chrome Web Store v2 Asset Specification & Validator.
 *
 * Pure, dependency-free validation helpers for verifying that every generated
 * graphic asset matches Chrome Web Store Developer Dashboard requirements:
 * - Store Icon:         128 x 128 px, PNG (transparency allowed)
 * - Small Promo Tile:   440 x 280 px, 24-bit opaque PNG/JPG (no alpha channel)
 * - Marquee Promo Tile: 1400 x 560 px, 24-bit opaque PNG/JPG (no alpha channel)
 * - Screenshots (1..5): 1280 x 800 px, 24-bit opaque PNG/JPG (no alpha channel)
 * - Promo Video:        1920 x 1080 px (16:9), MP4 (H.264 + AAC)
 */
import fs from "node:fs";
import path from "node:path";

export const CWS_MAX_SCREENSHOTS = 5;
export const CWS_MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB safety ceiling

export const CWS_V2_ASSETS = [
  {
    id: "store-icon",
    category: "icon",
    title: "Store Icon",
    subtitle: "Chrome Web Store listing & extension badge",
    filename: "store-icon-128x128.png",
    v1Filename: null,
    required: true,
    width: 128,
    height: 128,
    allowAlpha: true,
    kind: "image",
    cwsRule: "Required · 128×128 PNG · 96×96 artwork with 16px safe padding",
  },
  {
    id: "promo-small",
    category: "promo",
    title: "Small Promo Tile",
    subtitle: "Category grids, search & featured collections",
    filename: "promo-tile-small-440x280.png",
    v1Filename: "promo-tile-small-440x280.png",
    required: true,
    width: 440,
    height: 280,
    allowAlpha: false,
    kind: "image",
    cwsRule: "Required for featuring · 440×280 · 24-bit opaque PNG (no alpha)",
  },
  {
    id: "promo-marquee",
    category: "promo",
    title: "Marquee Promo Tile",
    subtitle: "Chrome Web Store homepage hero carousel",
    filename: "promo-tile-marquee-1400x560.png",
    v1Filename: "promo-tile-marquee-1400x560.png",
    required: false,
    width: 1400,
    height: 560,
    allowAlpha: false,
    kind: "image",
    cwsRule: "Featured hero banner · 1400×560 · 24-bit opaque PNG (no alpha)",
  },
  {
    id: "shot-1-capture",
    category: "screenshot",
    slot: 1,
    title: "01 · Instant Region & Full-Page Capture",
    subtitle: "One shortcut (Alt+X), sweep any region, copied and saved in one motion",
    filename: "screenshot-1-capture-1280x800.png",
    v1Filename: "screenshot-1-toolbar-region-1280x800.png",
    required: true,
    width: 1280,
    height: 800,
    allowAlpha: false,
    kind: "image",
    cwsRule: "Screenshot 1 of 5 · 1280×800 · 24-bit opaque PNG (no alpha)",
  },
  {
    id: "shot-2-toolbar-dock",
    category: "screenshot",
    slot: 2,
    title: "02 · Smart Element Snap & Toolbar Dock",
    subtitle: "Hold Ctrl to snap to cards, expand the Liquid Glass panel for recents & quick settings",
    filename: "screenshot-2-toolbar-dock-1280x800.png",
    v1Filename: "screenshot-2-toolbar-gallery-1280x800.png",
    required: false,
    width: 1280,
    height: 800,
    allowAlpha: false,
    kind: "image",
    cwsRule: "Screenshot 2 of 5 · 1280×800 · 24-bit opaque PNG (no alpha)",
  },
  {
    id: "shot-3-annotate",
    category: "screenshot",
    slot: 3,
    title: "03 · Built-In Annotation Studio",
    subtitle: "10 markup tools, numbered steps, privacy blur, crop, zoom & full undo/redo",
    filename: "screenshot-3-annotate-studio-1280x800.png",
    v1Filename: "screenshot-4-annotate-1280x800.png",
    required: false,
    width: 1280,
    height: 800,
    allowAlpha: false,
    kind: "image",
    cwsRule: "Screenshot 3 of 5 · 1280×800 · 24-bit opaque PNG (no alpha)",
  },
  {
    id: "shot-4-gallery",
    category: "screenshot",
    slot: 4,
    title: "04 · Private Local Swift Gallery",
    subtitle: "Search, filter, star, and drag out — 100% local IndexedDB, zero cloud uploads",
    filename: "screenshot-4-swift-gallery-1280x800.png",
    v1Filename: "screenshot-5-gallery-1280x800.png",
    required: false,
    width: 1280,
    height: 800,
    allowAlpha: false,
    kind: "image",
    cwsRule: "Screenshot 4 of 5 · 1280×800 · 24-bit opaque PNG (no alpha)",
  },
  {
    id: "shot-5-converter",
    category: "screenshot",
    slot: 5,
    title: "05 · Offline Batch Image Converter",
    subtitle: "Convert to JPG, PNG, WebP or ICO, resize, strip EXIF & download ZIP on-device",
    filename: "screenshot-5-batch-converter-1280x800.png",
    v1Filename: "screenshot-6-quick-settings-1280x800.png",
    required: false,
    width: 1280,
    height: 800,
    allowAlpha: false,
    kind: "image",
    cwsRule: "Screenshot 5 of 5 · 1280×800 · 24-bit opaque PNG (no alpha)",
  },
  {
    id: "promo-video",
    category: "video",
    title: "Product Launch Promo Video",
    subtitle: "1080p Full HD Chrome Web Store YouTube showcase with motion & tactile audio",
    filename: "swiftselect-promo-v2-1920x1080.mp4",
    v1Filename: "Swift Select.mp4",
    required: false,
    width: 1920,
    height: 1080,
    allowAlpha: false,
    kind: "video",
    cwsRule: "YouTube promo reel · 1920×1080 16:9 · H.264 MP4 + AAC stereo audio",
  },
];

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Parse a PNG buffer's IHDR chunk (width, height, bitDepth, colorType, hasAlpha).
 */
export function inspectPngBuffer(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33) {
    throw new Error("Buffer is too small to be a valid PNG.");
  }
  if (!buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error("Invalid PNG signature.");
  }
  const chunkType = buf.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") {
    throw new Error(`Expected IHDR chunk, found ${chunkType}.`);
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  // PNG color types with alpha: 4 (grayscale+alpha), 6 (RGBA)
  const hasAlpha = colorType === 4 || colorType === 6;
  return { width, height, bitDepth, colorType, hasAlpha };
}

/**
 * Validate the manifest list itself against Chrome Web Store slot quotas.
 */
export function validateAssetManifest(assets = CWS_V2_ASSETS) {
  const errors = [];
  const screenshots = assets.filter((a) => a.category === "screenshot");
  const icons = assets.filter((a) => a.category === "icon");
  const promos = assets.filter((a) => a.category === "promo");
  const videos = assets.filter((a) => a.category === "video");

  if (icons.length !== 1) {
    errors.push(`Expected exactly 1 store icon, found ${icons.length}.`);
  }
  if (screenshots.length < 1 || screenshots.length > CWS_MAX_SCREENSHOTS) {
    errors.push(`Chrome Web Store allows 1..${CWS_MAX_SCREENSHOTS} screenshots; manifest has ${screenshots.length}.`);
  }
  const smallPromo = promos.find((p) => p.width === 440 && p.height === 280);
  const marqueePromo = promos.find((p) => p.width === 1400 && p.height === 560);
  if (!smallPromo) errors.push("Missing 440x280 Small Promo Tile.");
  if (!marqueePromo) errors.push("Missing 1400x560 Marquee Promo Tile.");
  if (videos.length < 1) errors.push("Missing promotional video entry.");

  const seenFilenames = new Set();
  for (const a of assets) {
    if (seenFilenames.has(a.filename)) {
      errors.push(`Duplicate filename in asset manifest: ${a.filename}`);
    }
    seenFilenames.add(a.filename);
  }

  return {
    ok: errors.length === 0,
    counts: {
      total: assets.length,
      icon: icons.length,
      promo: promos.length,
      screenshot: screenshots.length,
      video: videos.length,
    },
    errors,
  };
}

/**
 * Audit generated v2 files on disk against exact CWS pixel dimensions & alpha rules.
 */
export function auditGeneratedAssets(dir, assets = CWS_V2_ASSETS) {
  const results = [];
  const errors = [];

  for (const spec of assets) {
    const abs = path.join(dir, spec.filename);
    const exists = fs.existsSync(abs);
    if (!exists) {
      errors.push(`Missing asset file: ${spec.filename}`);
      results.push({ id: spec.id, filename: spec.filename, ok: false, exists: false, bytes: 0 });
      continue;
    }

    const stat = fs.statSync(abs);
    const itemErrors = [];
    let meta = { width: spec.width, height: spec.height, hasAlpha: null };

    if (stat.size === 0) {
      itemErrors.push("File is empty (0 bytes).");
    }

    if (spec.kind === "image") {
      if (stat.size > CWS_MAX_IMAGE_BYTES) {
        itemErrors.push(`File exceeds 5MB limit (${stat.size} bytes).`);
      }
      try {
        meta = inspectPngBuffer(fs.readFileSync(abs));
        if (meta.width !== spec.width || meta.height !== spec.height) {
          itemErrors.push(`Expected ${spec.width}x${spec.height}, got ${meta.width}x${meta.height}.`);
        }
        if (!spec.allowAlpha && meta.hasAlpha) {
          itemErrors.push(`Chrome Web Store requires opaque 24-bit PNG (no alpha), got colorType=${meta.colorType}.`);
        }
      } catch (err) {
        itemErrors.push(err.message);
      }
    } else if (spec.kind === "video") {
      const head = Buffer.alloc(16);
      const fd = fs.openSync(abs, "r");
      try {
        fs.readSync(fd, head, 0, 16, 0);
      } finally {
        fs.closeSync(fd);
      }
      const box = head.subarray(4, 8).toString("ascii");
      if (box !== "ftyp") {
        itemErrors.push(`Expected MP4 ftyp header, got "${box}".`);
      }
    }

    if (itemErrors.length) {
      errors.push(...itemErrors.map((e) => `${spec.filename}: ${e}`));
    }

    results.push({
      id: spec.id,
      filename: spec.filename,
      ok: itemErrors.length === 0,
      exists: true,
      bytes: stat.size,
      width: meta.width,
      height: meta.height,
      hasAlpha: meta.hasAlpha,
      errors: itemErrors,
    });
  }

  return {
    ok: errors.length === 0,
    results,
    errors,
  };
}
