/**
 * SwiftSelect Annotate Studio — Pure Editor State, Presets, Geometry & History.
 *
 * Zero DOM dependencies so every layout calculation, filter formula, template
 * preset, layer stack operation, hit-test, and undo/redo transition can be
 * verified deterministically via `node:test`.
 */

export const BACKGROUNDS = [
  { id: "solid-white", name: "Pure White", kind: "solid", color: "#ffffff", preview: "#ffffff" },
  { id: "transparent", name: "Transparent", kind: "transparent", preview: "transparent" },
  { id: "solid-mist", name: "Soft Mist", kind: "solid", color: "#f1f5f9", preview: "#f1f5f9" },
  { id: "solid-paper", name: "Warm Paper", kind: "solid", color: "#f7f3ec", preview: "#f7f3ec" },
  { id: "solid-slate", name: "Slate Ink", kind: "solid", color: "#1e293b", preview: "#1e293b" },
  { id: "solid-carbon", name: "Dark Carbon", kind: "solid", color: "#121318", preview: "#121318" },
  { id: "grad-lavender", name: "Lavender Sky", kind: "linear", angle: 135, stops: ["#e0c3fc", "#8ec5fc"], preview: "linear-gradient(135deg, #e0c3fc, #8ec5fc)" },
  { id: "grad-peach", name: "Warm Peach", kind: "linear", angle: 135, stops: ["#ffecd2", "#fcb69f"], preview: "linear-gradient(135deg, #ffecd2, #fcb69f)" },
  { id: "grad-breeze", name: "Cool Breeze", kind: "linear", angle: 135, stops: ["#a1c4fd", "#c2e9fb"], preview: "linear-gradient(135deg, #a1c4fd, #c2e9fb)" },
  { id: "grad-mint", name: "Mint Aqua", kind: "linear", angle: 135, stops: ["#84fab0", "#8fd3f4"], preview: "linear-gradient(135deg, #84fab0, #8fd3f4)" },
  { id: "grad-sunset", name: "Sunset Glow", kind: "linear", angle: 135, stops: ["#fa709a", "#fee140"], preview: "linear-gradient(135deg, #fa709a, #fee140)" },
  { id: "grad-plum", name: "Deep Plum", kind: "linear", angle: 135, stops: ["#667eea", "#764ba2"], preview: "linear-gradient(135deg, #667eea, #764ba2)" },
  { id: "grad-obsidian", name: "Obsidian Indigo", kind: "linear", angle: 140, stops: ["#0f172a", "#1e1b4b", "#312e81"], preview: "linear-gradient(140deg, #0f172a, #1e1b4b, #312e81)" },
  { id: "grad-aurora", name: "Northern Aurora", kind: "mesh", base: "#0b1120", orbs: [["#38bdf8", 0.15, 0.2, 0.7], ["#818cf8", 0.85, 0.25, 0.72], ["#34d399", 0.75, 0.88, 0.65]], preview: "radial-gradient(circle at 18% 22%, #38bdf8, transparent 58%), radial-gradient(circle at 84% 26%, #818cf8, transparent 62%), radial-gradient(circle at 74% 88%, #34d399, transparent 58%), #0b1120" },
  { id: "grad-rose", name: "Rose Quartz", kind: "mesh", base: "#fdf2f8", orbs: [["#fbcfe8", 0.18, 0.18, 0.72], ["#ddd6fe", 0.84, 0.24, 0.72], ["#fed7aa", 0.55, 0.88, 0.68]], preview: "radial-gradient(circle at 18% 20%, #fbcfe8, transparent 60%), radial-gradient(circle at 84% 25%, #ddd6fe, transparent 60%), radial-gradient(circle at 55% 88%, #fed7aa, transparent 60%), #fdf2f8" },
  { id: "grad-ember", name: "Citrus Ember", kind: "linear", angle: 135, stops: ["#f97316", "#ec4899", "#6366f1"], preview: "linear-gradient(135deg, #f97316, #ec4899, #6366f1)" },
  { id: "grad-ocean", name: "Ocean Dusk", kind: "linear", angle: 135, stops: ["#0f2027", "#203a43", "#2c5364"], preview: "linear-gradient(135deg, #0f2027, #203a43, #2c5364)" },
  { id: "grad-sand", name: "Studio Sand", kind: "linear", angle: 135, stops: ["#e6e9f0", "#eef1f5"], preview: "linear-gradient(135deg, #e6e9f0, #eef1f5)" },
];

export const WINDOW_FRAMES = [
  { id: "none", label: "Clean" },
  { id: "macos-light", label: "macOS Light" },
  { id: "macos-dark", label: "macOS Dark" },
  { id: "browser", label: "Browser" },
  { id: "glass", label: "Glass Bezel" },
  { id: "polaroid", label: "Print Card" },
];

export const ASPECT_RATIOS = [
  { id: "auto", label: "Auto", ratio: null },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "16:10", label: "16:10", ratio: 16 / 10 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "4:5", label: "4:5", ratio: 4 / 5 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
];

export const STITCH_LAYOUTS = [
  { id: "side-by-side", label: "Side by Side" },
  { id: "stacked", label: "Stacked" },
  { id: "grid", label: "Grid" },
];

export const PATTERN_OVERLAYS = [
  { id: "none", label: "None" },
  { id: "dots", label: "Dots" },
  { id: "grid", label: "Grid" },
];

export const DEFAULT_FILTERS = Object.freeze({
  preset: "original",
  brightness: 100, // 50..150
  contrast: 100, // 50..150
  saturation: 100, // 0..200
  warmth: 0, // 0..100 (sepia-like warm shift)
  hue: 0, // -180..180
  blur: 0, // 0..12 px
  grayscale: 0, // 0..100
  vignette: 0, // 0..100
  grain: 0, // 0..50
});

export const FILTER_PRESETS = [
  { id: "original", name: "Original", values: { ...DEFAULT_FILTERS, preset: "original" }, swatch: "linear-gradient(135deg, #e2e8f0, #94a3b8)" },
  { id: "vivid", name: "Vivid", values: { brightness: 104, contrast: 112, saturation: 132, warmth: 6, hue: 0, blur: 0, grayscale: 0, vignette: 8, grain: 0 }, swatch: "linear-gradient(135deg, #38bdf8, #f43f5e)" },
  { id: "crisp", name: "Studio Crisp", values: { brightness: 103, contrast: 116, saturation: 106, warmth: 0, hue: 0, blur: 0, grayscale: 0, vignette: 0, grain: 0 }, swatch: "linear-gradient(135deg, #ffffff, #cbd5e1)" },
  { id: "warm-film", name: "Warm Film", values: { brightness: 104, contrast: 106, saturation: 110, warmth: 28, hue: -4, blur: 0, grayscale: 0, vignette: 24, grain: 14 }, swatch: "linear-gradient(135deg, #fde68a, #d97706)" },
  { id: "nordic", name: "Nordic Cool", values: { brightness: 102, contrast: 108, saturation: 88, warmth: 0, hue: 12, blur: 0, grayscale: 12, vignette: 16, grain: 6 }, swatch: "linear-gradient(135deg, #bae6fd, #475569)" },
  { id: "noir", name: "Mono Noir", values: { brightness: 98, contrast: 134, saturation: 0, warmth: 0, hue: 0, blur: 0, grayscale: 100, vignette: 35, grain: 16 }, swatch: "linear-gradient(135deg, #f8fafc, #0f172a)" },
  { id: "matte", name: "Matte Fade", values: { brightness: 108, contrast: 88, saturation: 90, warmth: 14, hue: 0, blur: 0, grayscale: 6, vignette: 14, grain: 10 }, swatch: "linear-gradient(135deg, #e7e5e4, #a8a29e)" },
  { id: "golden", name: "Golden Hour", values: { brightness: 106, contrast: 110, saturation: 124, warmth: 36, hue: -8, blur: 0, grayscale: 0, vignette: 20, grain: 6 }, swatch: "linear-gradient(135deg, #fed7aa, #ea580c)" },
  { id: "punch", name: "High Contrast", values: { brightness: 100, contrast: 132, saturation: 118, warmth: 0, hue: 0, blur: 0, grayscale: 0, vignette: 12, grain: 0 }, swatch: "linear-gradient(135deg, #1e293b, #3b82f6)" },
  { id: "blueprint", name: "Blueprint", values: { brightness: 100, contrast: 118, saturation: 145, warmth: 0, hue: 185, blur: 0, grayscale: 0, vignette: 18, grain: 0 }, swatch: "linear-gradient(135deg, #1d4ed8, #60a5fa)" },
];

export const DEFAULT_FRAME = Object.freeze({
  bgId: "solid-white",
  customColor: "#3b82f6",
  customColor2: "#8b5cf6",
  customMode: "preset", // preset | solid | linear
  customAngle: 135,
  pattern: "none", // none | dots | grid
  aspectRatio: "auto",
  padding: 4.5, // percent of base dim (0..24)
  radius: 4.2, // percent of base dim (0..14)
  shadow: 35, // 0..100
  border: 1, // 0..3
  windowStyle: "none", // none | macos-light | macos-dark | browser | glass | polaroid
  windowTitle: "swiftselect.app",
  stitchLayout: "side-by-side", // side-by-side | stacked | grid
  stitchGap: 0.4, // percent of base dim (0..6)
  stitchDivider: true,
});

export const DEFAULT_TRANSFORM = Object.freeze({
  rotation: 0, // 0 | 90 | 180 | 270
  flipH: false,
  flipV: false,
});

export const TEMPLATES = [
  {
    id: "clean-studio",
    name: "Clean Studio",
    subtitle: "Pure white card, soft shadow",
    previewBg: "#ffffff",
    previewCard: "#f8fafc",
    chrome: "none",
    frame: {
      bgId: "solid-white",
      customMode: "preset",
      pattern: "none",
      aspectRatio: "auto",
      padding: 4.5,
      radius: 4.2,
      shadow: 35,
      border: 1,
      windowStyle: "none",
    },
    filters: { ...DEFAULT_FILTERS },
    layers: [],
  },
  {
    id: "macos-spotlight",
    name: "macOS Spotlight",
    subtitle: "Obsidian backdrop & dark window",
    previewBg: "linear-gradient(140deg, #0f172a, #1e1b4b, #312e81)",
    previewCard: "#111827",
    chrome: "macos-dark",
    frame: {
      bgId: "grad-obsidian",
      customMode: "preset",
      pattern: "dots",
      aspectRatio: "16:10",
      padding: 9,
      radius: 3.2,
      shadow: 72,
      border: 1,
      windowStyle: "macos-dark",
      windowTitle: "SwiftSelect Studio",
    },
    filters: { preset: "crisp", brightness: 103, contrast: 112, saturation: 106, warmth: 0, hue: 0, blur: 0, grayscale: 0, vignette: 0, grain: 0 },
    layers: [],
  },
  {
    id: "glass-showcase",
    name: "Glass Showcase",
    subtitle: "Lavender sky & frosted bezel",
    previewBg: "linear-gradient(135deg, #e0c3fc, #8ec5fc)",
    previewCard: "rgba(255,255,255,0.68)",
    chrome: "glass",
    frame: {
      bgId: "grad-lavender",
      customMode: "preset",
      pattern: "none",
      aspectRatio: "16:9",
      padding: 10,
      radius: 4.5,
      shadow: 54,
      border: 1,
      windowStyle: "glass",
    },
    filters: { ...DEFAULT_FILTERS },
    layers: [],
  },
  {
    id: "changelog-card",
    name: "Product Launch",
    subtitle: "16:9 hero with editable headline",
    previewBg: "linear-gradient(135deg, #ffecd2, #fcb69f)",
    previewCard: "#ffffff",
    chrome: "browser",
    frame: {
      bgId: "grad-peach",
      customMode: "preset",
      pattern: "grid",
      aspectRatio: "16:9",
      padding: 13,
      radius: 3.4,
      shadow: 48,
      border: 1,
      windowStyle: "browser",
      windowTitle: "release-notes.app",
    },
    filters: { ...DEFAULT_FILTERS },
    templateLayers: [
      {
        type: "text",
        name: "Release Badge",
        relX: 0.5,
        relY: 0.055,
        text: "NEW RELEASE · WHAT'S NEW",
        color: "#1e1b4b",
        font: "sans",
        fontSizeScale: 0.019,
        bold: true,
        italic: false,
        fill: true,
        opacity: 0.96,
      },
    ],
  },
  {
    id: "social-square",
    name: "Social Square",
    subtitle: "1:1 Sunset card for feeds",
    previewBg: "linear-gradient(135deg, #fa709a, #fee140)",
    previewCard: "#ffffff",
    chrome: "macos-light",
    frame: {
      bgId: "grad-sunset",
      customMode: "preset",
      pattern: "none",
      aspectRatio: "1:1",
      padding: 10,
      radius: 4.0,
      shadow: 56,
      border: 1,
      windowStyle: "macos-light",
      windowTitle: "preview.app",
    },
    filters: { preset: "vivid", brightness: 104, contrast: 110, saturation: 122, warmth: 6, hue: 0, blur: 0, grayscale: 0, vignette: 6, grain: 0 },
    layers: [],
  },
  {
    id: "before-after",
    name: "Before / After",
    subtitle: "Comparison slate with callout tags",
    previewBg: "linear-gradient(135deg, #0f2027, #203a43, #2c5364)",
    previewCard: "#1e293b",
    chrome: "none",
    frame: {
      bgId: "grad-ocean",
      customMode: "preset",
      pattern: "dots",
      aspectRatio: "auto",
      padding: 8,
      radius: 3.2,
      shadow: 60,
      border: 1,
      windowStyle: "none",
      stitchLayout: "side-by-side",
      stitchGap: 1.4,
      stitchDivider: true,
    },
    filters: { ...DEFAULT_FILTERS },
    templateLayers: [
      {
        type: "text",
        name: "Before Tag",
        relX: 0.27,
        relY: 0.045,
        text: "BEFORE",
        color: "#475569",
        font: "sans",
        fontSizeScale: 0.02,
        bold: true,
        italic: false,
        fill: true,
        opacity: 0.95,
      },
      {
        type: "text",
        name: "After Tag",
        relX: 0.73,
        relY: 0.045,
        text: "AFTER",
        color: "#10b981",
        font: "sans",
        fontSizeScale: 0.02,
        bold: true,
        italic: false,
        fill: true,
        opacity: 0.96,
      },
    ],
  },
  {
    id: "editorial-print",
    name: "Editorial Print",
    subtitle: "Warm paper & matte film look",
    previewBg: "#f7f3ec",
    previewCard: "#ffffff",
    chrome: "polaroid",
    frame: {
      bgId: "solid-paper",
      customMode: "preset",
      pattern: "none",
      aspectRatio: "4:3",
      padding: 10,
      radius: 1.6,
      shadow: 30,
      border: 1,
      windowStyle: "polaroid",
      windowTitle: "Captured with SwiftSelect",
    },
    filters: { preset: "warm-film", brightness: 104, contrast: 104, saturation: 106, warmth: 24, hue: -3, blur: 0, grayscale: 0, vignette: 18, grain: 10 },
    layers: [],
  },
  {
    id: "transparent-float",
    name: "Transparent Float",
    subtitle: "Alpha PNG ready for decks & docs",
    previewBg: "transparent",
    previewCard: "#ffffff",
    chrome: "none",
    frame: {
      bgId: "transparent",
      customMode: "preset",
      pattern: "none",
      aspectRatio: "auto",
      padding: 5.5,
      radius: 4.5,
      shadow: 42,
      border: 1,
      windowStyle: "none",
    },
    filters: { ...DEFAULT_FILTERS },
    layers: [],
  },
];

export const TOOL_PALETTE = [
  "#FF3333",
  "#FF9500",
  "#FFCC00",
  "#10B981",
  "#007AFF",
  "#8B5CF6",
  "#FFFFFF",
  "#16171D",
];

export const TEXT_FONTS = {
  sans: "'SS Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif",
  serif: "'Iowan Old Style', 'Palatino Linotype', Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
  hand: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive",
};

let _uidSeq = 1;
export function nextLayerId(prefix = "layer") {
  _uidSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${_uidSeq}`;
}

export function clamp(val, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Create a clean, serializable studio document state.
 * Note: actual HTMLImageElement instances live in a separate runtime Map keyed by
 * `assetId` so snapshots for undo/redo remain lightweight pure JSON objects!
 */
export function createDocument({ title = "Untitled Studio", url = "" } = {}) {
  return {
    title,
    url,
    baseImages: [], // [{ assetId, name, width, height, crop?: { x, y, width, height } }]
    blankSize: null, // { width, height } when starting from a blank canvas
    frame: { ...DEFAULT_FRAME },
    filters: { ...DEFAULT_FILTERS },
    transform: { ...DEFAULT_TRANSFORM },
    layers: [], // Ordered bottom-to-top: [{ id, type, name, visible, locked, opacity, blendMode, ... }]
    selectedLayerId: null,
    stepCounter: 1,
  };
}

/**
 * Build a standard CSS / Canvas2D filter string from a filter settings object.
 */
export function buildFilterString(f = DEFAULT_FILTERS) {
  const parts = [];
  const brightness = clamp(f.brightness ?? 100, 50, 150);
  const contrast = clamp(f.contrast ?? 100, 50, 150);
  const saturation = clamp(f.saturation ?? 100, 0, 200);
  const warmth = clamp(f.warmth ?? 0, 0, 100);
  const hue = clamp(f.hue ?? 0, -180, 180);
  const blur = clamp(f.blur ?? 0, 0, 12);
  const grayscale = clamp(f.grayscale ?? 0, 0, 100);

  if (brightness !== 100) parts.push(`brightness(${brightness}%)`);
  if (contrast !== 100) parts.push(`contrast(${contrast}%)`);
  if (saturation !== 100) parts.push(`saturate(${saturation}%)`);
  if (warmth > 0) parts.push(`sepia(${warmth}%)`);
  if (hue !== 0) parts.push(`hue-rotate(${hue}deg)`);
  if (grayscale > 0) parts.push(`grayscale(${grayscale}%)`);
  if (blur > 0) parts.push(`blur(${blur.toFixed(1)}px)`);

  return parts.length ? parts.join(" ") : "none";
}

export function isDefaultFilters(f = DEFAULT_FILTERS) {
  return (
    (f.brightness ?? 100) === 100 &&
    (f.contrast ?? 100) === 100 &&
    (f.saturation ?? 100) === 100 &&
    (f.warmth ?? 0) === 0 &&
    (f.hue ?? 0) === 0 &&
    (f.blur ?? 0) === 0 &&
    (f.grayscale ?? 0) === 0 &&
    (f.vignette ?? 0) === 0 &&
    (f.grain ?? 0) === 0
  );
}

/**
 * Effective source dimensions of a base image after crop & 90/270 rotation.
 */
export function effectiveBaseImageSize(img, transform = DEFAULT_TRANSFORM) {
  const rawW = img.crop ? img.crop.width : img.width;
  const rawH = img.crop ? img.crop.height : img.height;
  const rotated = Math.abs(transform.rotation || 0) % 180 === 90;
  return {
    width: Math.max(1, Math.round(rotated ? rawH : rawW)),
    height: Math.max(1, Math.round(rotated ? rawW : rawH)),
  };
}

/**
 * Compute exact layout geometry for the entire output canvas:
 * - Multi-image stitch slots (side-by-side, stacked, grid)
 * - Window chrome header/footer/bezel offsets
 * - Outer padding & target aspect ratio expansion
 */
export function computeCanvasLayout(doc) {
  const frame = doc.frame || DEFAULT_FRAME;
  const transform = doc.transform || DEFAULT_TRANSFORM;
  const images = doc.baseImages || [];

  let innerW = 0;
  let innerH = 0;
  const slots = [];
  const dividers = [];

  if (images.length === 0) {
    innerW = doc.blankSize?.width || 1440;
    innerH = doc.blankSize?.height || 900;
  } else if (images.length === 1) {
    const sz = effectiveBaseImageSize(images[0], transform);
    innerW = sz.width;
    innerH = sz.height;
    slots.push({ index: 0, assetId: images[0].assetId, x: 0, y: 0, width: innerW, height: innerH });
  } else {
    const sizes = images.map((im) => effectiveBaseImageSize(im, transform));
    const layout = frame.stitchLayout || "side-by-side";
    const refDim = Math.min(sizes[0].width, sizes[0].height);
    const gapPx = Math.max(0, Math.round(refDim * ((frame.stitchGap ?? 0.4) / 100)));
    const divPx = frame.stitchDivider ? Math.max(2, Math.round(refDim * 0.003)) : 0;
    const sep = Math.max(gapPx, divPx);

    if (layout === "stacked") {
      const targetW = sizes[0].width;
      let curY = 0;
      sizes.forEach((sz, i) => {
        const scale = targetW / sz.width;
        const h = Math.max(1, Math.round(sz.height * scale));
        slots.push({ index: i, assetId: images[i].assetId, x: 0, y: curY, width: targetW, height: h });
        curY += h;
        if (i < sizes.length - 1) {
          if (frame.stitchDivider && gapPx <= divPx) {
            dividers.push({ x: 0, y: curY, width: targetW, height: sep });
          }
          curY += sep;
        }
      });
      innerW = targetW;
      innerH = curY;
    } else if (layout === "grid") {
      const cols = Math.ceil(Math.sqrt(images.length));
      const rows = Math.ceil(images.length / cols);
      const cellW = sizes[0].width;
      const cellH = sizes[0].height;
      images.forEach((im, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        slots.push({
          index: i,
          assetId: im.assetId,
          x: col * (cellW + sep),
          y: row * (cellH + sep),
          width: cellW,
          height: cellH,
          cover: true,
        });
      });
      innerW = cols * cellW + Math.max(0, cols - 1) * sep;
      innerH = rows * cellH + Math.max(0, rows - 1) * sep;
    } else {
      // Side-by-side (Gradia Web signature stitch!)
      const targetH = sizes[0].height;
      let curX = 0;
      sizes.forEach((sz, i) => {
        const scale = targetH / sz.height;
        const w = Math.max(1, Math.round(sz.width * scale));
        slots.push({ index: i, assetId: images[i].assetId, x: curX, y: 0, width: w, height: targetH });
        curX += w;
        if (i < sizes.length - 1) {
          if (frame.stitchDivider && gapPx <= divPx) {
            dividers.push({ x: curX, y: 0, width: sep, height: targetH });
          }
          curX += sep;
        }
      });
      innerW = curX;
      innerH = targetH;
    }
  }

  const baseDim = Math.max(200, Math.min(innerW, innerH));
  const winStyle = frame.windowStyle || "none";

  let chromeTop = 0;
  let chromeBottom = 0;
  let bezel = 0;
  if (winStyle === "macos-light" || winStyle === "macos-dark") {
    chromeTop = Math.max(28, Math.round(baseDim * 0.044));
  } else if (winStyle === "browser") {
    chromeTop = Math.max(36, Math.round(baseDim * 0.056));
  } else if (winStyle === "glass") {
    bezel = Math.max(12, Math.round(baseDim * 0.024));
  } else if (winStyle === "polaroid") {
    bezel = Math.max(14, Math.round(baseDim * 0.026));
    chromeBottom = Math.max(44, Math.round(baseDim * 0.088));
  }

  const cardW = innerW + bezel * 2;
  const cardH = innerH + chromeTop + chromeBottom + bezel * 2;

  const padPct = clamp(frame.padding ?? 4.5, 0, 24) / 100;
  const padPx = Math.round(baseDim * padPct);
  const radiusPx = Math.round(baseDim * (clamp(frame.radius ?? 4.2, 0, 14) / 100));

  let totalW = cardW + padPx * 2;
  let totalH = cardH + padPx * 2;

  const ratioDef = ASPECT_RATIOS.find((a) => a.id === frame.aspectRatio);
  if (ratioDef && ratioDef.ratio) {
    const target = ratioDef.ratio;
    const current = totalW / totalH;
    if (current < target) {
      totalW = Math.round(totalH * target);
    } else if (current > target) {
      totalH = Math.round(totalW / target);
    }
  }

  // Cap extreme canvas dimensions gently while preserving ratio
  const cardX = Math.round((totalW - cardW) / 2);
  const cardY = Math.round((totalH - cardH) / 2);
  const contentX = cardX + bezel;
  const contentY = cardY + bezel + chromeTop;

  return {
    totalWidth: Math.max(1, totalW),
    totalHeight: Math.max(1, totalH),
    baseDim,
    padPx,
    radiusPx,
    bezel,
    chromeTop,
    chromeBottom,
    cardRect: { x: cardX, y: cardY, width: cardW, height: cardH },
    contentRect: { x: contentX, y: contentY, width: innerW, height: innerH },
    slots: slots.map((s) => ({ ...s, x: s.x + contentX, y: s.y + contentY })),
    dividers: dividers.map((d) => ({ ...d, x: d.x + contentX, y: d.y + contentY })),
  };
}

/** Default human-readable name for a new layer. */
export function defaultLayerName(type, existingCount = 0) {
  const labels = {
    image: "Image Layer",
    pen: "Freehand Ink",
    highlighter: "Highlighter",
    arrow: "Arrow",
    rect: "Rectangle",
    ellipse: "Ellipse",
    spotlight: "Spotlight",
    counter: "Step Badge",
    blur: "Redact",
    text: "Text",
    callout: "Callout",
  };
  const base = labels[type] || "Layer";
  return existingCount > 0 ? `${base} ${existingCount + 1}` : base;
}

/** Add a layer onto the top of the stack and select it. */
export function addLayer(doc, layerProps) {
  const sameType = doc.layers.filter((l) => l.type === layerProps.type).length;
  const layer = {
    id: layerProps.id || nextLayerId(layerProps.type || "layer"),
    type: layerProps.type || "rect",
    name: layerProps.name || defaultLayerName(layerProps.type, sameType),
    visible: layerProps.visible !== false,
    locked: !!layerProps.locked,
    opacity: clamp(layerProps.opacity ?? 1, 0.05, 1),
    blendMode: layerProps.blendMode || (layerProps.type === "highlighter" ? "multiply" : "source-over"),
    rotation: Number(layerProps.rotation) || 0,
    ...layerProps,
  };
  doc.layers.push(layer);
  doc.selectedLayerId = layer.id;
  if (layer.type === "counter") {
    doc.stepCounter = Math.max(doc.stepCounter + 1, (layer.number || 1) + 1);
  }
  return layer;
}

export function findLayer(doc, id) {
  return doc.layers.find((l) => l.id === id) || null;
}

export function findLayerIndex(doc, id) {
  return doc.layers.findIndex((l) => l.id === id);
}

export function removeLayer(doc, id) {
  const idx = findLayerIndex(doc, id);
  if (idx === -1) return false;
  doc.layers.splice(idx, 1);
  if (doc.selectedLayerId === id) {
    doc.selectedLayerId = doc.layers[Math.min(idx, doc.layers.length - 1)]?.id || null;
  }
  return true;
}

export function toggleLayerVisibility(doc, id) {
  const layer = findLayer(doc, id);
  if (!layer) return false;
  layer.visible = !layer.visible;
  if (!layer.visible && doc.selectedLayerId === id) {
    doc.selectedLayerId = null;
  }
  return true;
}

export function toggleLayerLock(doc, id) {
  const layer = findLayer(doc, id);
  if (!layer) return false;
  layer.locked = !layer.locked;
  return true;
}

/**
 * Move a layer in z-order.
 * Remember `doc.layers` is bottom-to-top (index 0 = bottom, length-1 = top).
 * direction: 'up' (+1) | 'down' (-1) | 'front' | 'back'
 */
export function reorderLayer(doc, id, direction) {
  const idx = findLayerIndex(doc, id);
  if (idx === -1) return false;
  const len = doc.layers.length;
  let target = idx;
  if (direction === "up") target = Math.min(len - 1, idx + 1);
  else if (direction === "down") target = Math.max(0, idx - 1);
  else if (direction === "front") target = len - 1;
  else if (direction === "back") target = 0;
  else if (typeof direction === "number") target = clamp(direction, 0, len - 1);
  if (target === idx) return false;
  const [item] = doc.layers.splice(idx, 1);
  doc.layers.splice(target, 0, item);
  return true;
}

export function duplicateLayer(doc, id, offset = 24) {
  const layer = findLayer(doc, id);
  if (!layer) return null;
  const copy = deepClone(layer);
  copy.id = nextLayerId(copy.type);
  copy.name = `${copy.name} Copy`;
  copy.locked = false;
  moveLayerBy(copy, offset, offset);
  if (copy.type === "counter") {
    copy.number = doc.stepCounter++;
  }
  const idx = findLayerIndex(doc, id);
  doc.layers.splice(idx + 1, 0, copy);
  doc.selectedLayerId = copy.id;
  return copy;
}

export function moveLayerBy(layer, dx, dy) {
  if (!layer || layer.locked) return;
  if (Array.isArray(layer.points)) {
    layer.points.forEach((p) => {
      p.x += dx;
      p.y += dy;
    });
  }
  if (typeof layer.x1 === "number") {
    layer.x1 += dx;
    layer.x2 += dx;
    layer.y1 += dy;
    layer.y2 += dy;
  }
  if (typeof layer.x === "number") {
    layer.x += dx;
    layer.y += dy;
  }
}

/**
 * Compute axis-aligned bounding box `{ x, y, width, height }` for any layer
 * in canvas coordinates.
 */
export function getLayerBounds(layer) {
  if (!layer) return null;
  if (layer.type === "rect" || layer.type === "ellipse" || layer.type === "blur" || layer.type === "spotlight" || layer.type === "image") {
    const x = layer.width < 0 ? layer.x + layer.width : layer.x;
    const y = layer.height < 0 ? layer.y + layer.height : layer.y;
    return { x, y, width: Math.abs(layer.width || 0), height: Math.abs(layer.height || 0) };
  }
  if (layer.type === "arrow") {
    const minX = Math.min(layer.x1, layer.x2);
    const minY = Math.min(layer.y1, layer.y2);
    const maxX = Math.max(layer.x1, layer.x2);
    const maxY = Math.max(layer.y1, layer.y2);
    const pad = Math.max(12, (layer.lineWidth || 5) * 2.5);
    return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
  }
  if (layer.type === "pen" || layer.type === "highlighter") {
    const pts = layer.points || [];
    if (!pts.length) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = Math.max(8, (layer.lineWidth || 6) * 0.8);
    return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
  }
  if (layer.type === "counter") {
    const r = layer.radius || Math.max(16, (layer.lineWidth || 6) * 3.2);
    return { x: layer.x - r, y: layer.y - r, width: r * 2, height: r * 2 };
  }
  if (layer.type === "text" || layer.type === "callout") {
    const fontSize = layer.fontSize || 28;
    const lines = String(layer.text || "Text").split("\n");
    const longest = Math.max(...lines.map((l) => l.length), 1);
    const w = layer.measuredWidth || Math.max(fontSize * 2, longest * fontSize * 0.62);
    const lineH = fontSize * 1.3;
    const h = layer.measuredHeight || lines.length * lineH;
    const padX = layer.fill || layer.type === "callout" ? fontSize * 0.65 : 8;
    const padY = layer.fill || layer.type === "callout" ? fontSize * 0.35 : 6;
    const bx = layer.align === "center" ? layer.x - w / 2 - padX : layer.x - padX;
    return { x: bx, y: layer.y - padY, width: w + padX * 2, height: h + padY * 2 };
  }
  return null;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * Hit-test layers from topmost to bottommost. Skips hidden or locked layers.
 */
export function hitTestLayers(doc, px, py, tolerance = 10) {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const layer = doc.layers[i];
    if (!layer.visible || layer.locked) continue;

    if (layer.type === "arrow") {
      const hitDist = Math.max(tolerance, (layer.lineWidth || 6) * 2.2);
      if (distToSegment(px, py, layer.x1, layer.y1, layer.x2, layer.y2) <= hitDist) {
        return layer;
      }
      continue;
    }

    if (layer.type === "pen" || layer.type === "highlighter") {
      const pts = layer.points || [];
      const hitDist = Math.max(tolerance, (layer.lineWidth || 6) * 1.4);
      for (let j = 1; j < pts.length; j++) {
        if (distToSegment(px, py, pts[j - 1].x, pts[j - 1].y, pts[j].x, pts[j].y) <= hitDist) {
          return layer;
        }
      }
      continue;
    }

    const b = getLayerBounds(layer);
    if (!b) continue;
    if (px >= b.x - tolerance && px <= b.x + b.width + tolerance && py >= b.y - tolerance && py <= b.y + b.height + tolerance) {
      return layer;
    }
  }
  return null;
}

/**
 * Resize handles for a selected layer (8 corners/edges for boxes & images, 2 endpoints for arrows).
 */
export function getResizeHandles(layer) {
  if (!layer || layer.locked || !layer.visible) return [];
  if (layer.type === "arrow") {
    return [
      { id: "start", x: layer.x1, y: layer.y1, cursor: "grab" },
      { id: "end", x: layer.x2, y: layer.y2, cursor: "grab" },
    ];
  }
  if (layer.type === "rect" || layer.type === "ellipse" || layer.type === "blur" || layer.type === "spotlight" || layer.type === "image") {
    const b = getLayerBounds(layer);
    if (!b) return [];
    const mx = b.x + b.width / 2;
    const my = b.y + b.height / 2;
    return [
      { id: "tl", x: b.x, y: b.y, cursor: "nwse-resize" },
      { id: "tm", x: mx, y: b.y, cursor: "ns-resize" },
      { id: "tr", x: b.x + b.width, y: b.y, cursor: "nesw-resize" },
      { id: "rm", x: b.x + b.width, y: my, cursor: "ew-resize" },
      { id: "br", x: b.x + b.width, y: b.y + b.height, cursor: "nwse-resize" },
      { id: "bm", x: mx, y: b.y + b.height, cursor: "ns-resize" },
      { id: "bl", x: b.x, y: b.y + b.height, cursor: "nesw-resize" },
      { id: "lm", x: b.x, y: my, cursor: "ew-resize" },
    ];
  }
  return [];
}

export function hitTestHandle(layer, px, py, radius = 12) {
  const handles = getResizeHandles(layer);
  for (const h of handles) {
    if (Math.hypot(px - h.x, py - h.y) <= radius) return h;
  }
  return null;
}

/**
 * Apply a one-click Creative Template cleanly onto a document.
 * Replaces previous template-tagged text layers while keeping user annotations intact.
 */
export function applyTemplateToDoc(doc, templateId) {
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  if (!tpl) return false;
  doc.frame = { ...doc.frame, ...tpl.frame };
  if (tpl.filters) {
    doc.filters = { ...DEFAULT_FILTERS, ...tpl.filters };
  }
  // Remove only layers created by a previous template switch
  doc.layers = doc.layers.filter((l) => !l.fromTemplate);

  if (Array.isArray(tpl.templateLayers) && tpl.templateLayers.length) {
    const layout = computeCanvasLayout(doc);
    for (const spec of tpl.templateLayers) {
      const fontSize = Math.max(16, Math.round(layout.totalHeight * (spec.fontSizeScale || 0.024)));
      addLayer(doc, {
        type: spec.type,
        name: spec.name,
        fromTemplate: true,
        x: Math.round(layout.totalWidth * spec.relX),
        y: Math.round(layout.totalHeight * spec.relY),
        text: spec.text,
        color: spec.color,
        font: spec.font || "sans",
        fontSize,
        bold: spec.bold !== false,
        italic: !!spec.italic,
        fill: !!spec.fill,
        align: "center",
        opacity: spec.opacity ?? 1,
      });
    }
    doc.selectedLayerId = null;
  }
  return true;
}

/**
 * Undo/Redo snapshot history manager with coalescing for rapid slider drags.
 */
export function createHistory(initialDoc, maxEntries = 60) {
  let past = [];
  let present = deepClone(initialDoc);
  let future = [];
  let lastKey = "";
  let lastAt = 0;

  return {
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    get depth() {
      return past.length;
    },
    reset(doc) {
      past = [];
      present = deepClone(doc);
      future = [];
      lastKey = "";
      lastAt = 0;
    },
    push(doc, coalesceKey = "", now = Date.now()) {
      const next = deepClone(doc);
      if (JSON.stringify(next) === JSON.stringify(present)) return false;
      if (coalesceKey && coalesceKey === lastKey && now - lastAt < 600 && past.length > 0) {
        present = next;
        lastAt = now;
      } else {
        past.push(present);
        if (past.length > maxEntries) past.shift();
        present = next;
        lastKey = coalesceKey;
        lastAt = now;
      }
      future = [];
      return true;
    },
    undo() {
      if (!past.length) return null;
      future.push(present);
      present = past.pop();
      lastKey = "";
      return deepClone(present);
    },
    redo() {
      if (!future.length) return null;
      past.push(present);
      present = future.pop();
      lastKey = "";
      return deepClone(present);
    },
  };
}
