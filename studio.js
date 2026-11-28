/**
 * SwiftSelect Annotate — Authentic Liquid Glass Floating Annotate Bar
 * with collapsible Left/Right Liquid Glass Editor Wings.
 *
 * Opens directly as a full-screen frosted Liquid Glass overlay inside Swift
 * Gallery (`#annotate-view`) without redirecting away from Gallery, while
 * supporting images from both the user's device and Swift Gallery (open,
 * multi-image stitch, or movable/resizable image layers), full layer stack,
 * beautifier frames, image filters, and one-click creative templates.
 */

import {
  ASPECT_RATIOS,
  BACKGROUNDS,
  DEFAULT_FILTERS,
  DEFAULT_FRAME,
  DEFAULT_TRANSFORM,
  FILTER_PRESETS,
  PATTERN_OVERLAYS,
  STITCH_LAYOUTS,
  TEMPLATES,
  TOOL_PALETTE,
  WINDOW_FRAMES,
  addLayer,
  applyTemplateToDoc,
  clamp,
  computeCanvasLayout,
  createDocument,
  createHistory,
  deepClone,
  duplicateLayer,
  findLayer,
  getLayerBounds,
  hitTestHandle,
  hitTestLayers,
  isDefaultFilters,
  moveLayerBy,
  nextLayerId,
  removeLayer,
  reorderLayer,
  toggleLayerLock,
  toggleLayerVisibility,
} from "./src/editor/model.js";
import { renderStudioCanvas } from "./src/editor/renderer.js";
import { addCapture, formatBytes, getCapture, isRecent, listCaptures } from "./src/storage.js";
import { buildFilename, getSettings } from "./src/settings.js";
import { downloadBlobFile } from "./src/downloadFile.js";
import { imageToPdf } from "./src/pdf.js";
import { encodePngToIco } from "./src/converter/rules.js";
import { confirmButton, formatNumber, hydrateIcons, icon, toast } from "./src/pageKit.js";

const IMAGE_TYPES = /^image\/(png|jpe?g|webp|gif|bmp|avif|svg\+xml)$/i;

const TOOLS = [
  { id: "select", label: "Select & Move", key: "V", icon: "cursor" },
  { id: "pen", label: "Freehand Pen", key: "P", icon: "pen" },
  { id: "highlighter", label: "Highlighter", key: "H", icon: "highlighter" },
  { id: "arrow", label: "Arrow", key: "A", icon: "arrow" },
  { id: "rect", label: "Rectangle", key: "R", icon: "rect" },
  { id: "ellipse", label: "Ellipse", key: "O", icon: "ellipse" },
  { id: "spotlight", label: "Spotlight Focus", key: "L", icon: "spotlight" },
  { id: "counter", label: "Step Counter", key: "S", icon: "counter" },
  { id: "blur", label: "Redact / Mosaic", key: "B", icon: "blur" },
  { id: "text", label: "Text Label", key: "T", icon: "text" },
  { id: "callout", label: "Callout Bubble", key: "Q", icon: "callout" },
  { id: "crop", label: "Crop Canvas", key: "C", icon: "crop" },
];

const CROP_PRESETS = [
  { id: "free", label: "Free", ratio: null },
  { id: "16:9", label: "16:9", ratio: 16 / 9 },
  { id: "4:3", label: "4:3", ratio: 4 / 3 },
  { id: "1:1", label: "1:1", ratio: 1 },
  { id: "9:16", label: "9:16", ratio: 9 / 16 },
];

const EXPORT_FORMATS = [
  { id: "png", label: "PNG", desc: "Lossless · Transparency" },
  { id: "jpg", label: "JPG", desc: "Compact · Photos" },
  { id: "webp", label: "WebP", desc: "Modern · Smallest" },
  { id: "ico", label: "ICO", desc: "App / Favicon (256px)" },
  { id: "pdf", label: "PDF", desc: "Paged A4 Document" },
];

const RIGHT_DRAWER_TITLES = {
  frame: "Frame & Beautify",
  filters: "Filters & Adjust",
  templates: "Templates",
};

let mounted = false;
let rootEl = null;
let canvasEl = null;
let stageWrapEl = null;
let canvasFrameEl = null;
let fileInputEl = null;
let pendingFileMode = "open"; // open | stitch | layer
let resizeObserver = null;
let onCloseCallback = null;
let onSavedCallback = null;

// Runtime image assets map: assetId -> HTMLImageElement
const assets = new Map();
const assetThumbs = new Map(); // assetId -> objectURL for layer & stitch previews

let doc = createDocument();
const history = createHistory(doc);

const ui = {
  tool: "pen",
  color: "#FF3333",
  lineWidth: 5,
  opacity: 1,
  fill: false,
  dash: "solid",
  arrowHead: "end",
  font: "sans",
  fontSize: 28,
  bold: true,
  italic: false,
  align: "left",
  leftDrawer: null, // null | "layers"
  rightDrawer: null, // null | "frame" | "filters" | "templates"
  zoomMode: "fit", // fit | manual
  zoomScale: 1,
  exportFormat: "png",
  exportQuality: 0.92,
  cropRect: null,
  cropAspect: "free",
  activePopover: null, // "style" | "add-image" | "wing-device" | "export" | null
};

// Pointer interaction state
let pointerState = null;
let draftLayer = null;
let lastLayout = null;
let activeTextEditor = null;

// Gallery Picker modal state
let pickerModalEl = null;
let pickerState = {
  open: false,
  mode: "open", // open | stitch | layer
  filter: "all",
  query: "",
  records: [],
  selected: new Set(),
  urls: new Map(),
};

const qs = (sel) => rootEl?.querySelector(sel) || null;
const qsa = (sel) => [...(rootEl?.querySelectorAll(sel) || [])];

export function isStudioActive() {
  const el = document.getElementById("annotate-view");
  return !!el && !el.hidden;
}

function hasWorkspaceContent() {
  return doc.baseImages.length > 0 || !!doc.blankSize;
}

function requestCloseStudio() {
  closeTextEditor(true);
  closeAllPopovers();
  if (pickerState.open) closeGalleryPicker();
  onCloseCallback?.();
}

// ─── Asset Loading ────────────────────────────────────────────────────

function loadBlobAsImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve({ img, url, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode image"));
    };
    img.src = url;
  });
}

async function registerAsset(blob, name = "Image") {
  const { img, url, width, height } = await loadBlobAsImage(blob);
  const assetId = nextLayerId("asset");
  assets.set(assetId, img);
  assetThumbs.set(assetId, url);
  return { assetId, name: name.replace(/\.[a-z0-9]{2,5}$/i, "") || "Image", width, height };
}

function canvasToBlob(canvas, mime = "image/png", quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas encoding failed"))),
      mime,
      mime === "image/png" ? undefined : quality,
    );
  });
}

// ─── Document Operations ──────────────────────────────────────────────

function commit(coalesceKey = "") {
  history.push(doc, coalesceKey);
  syncHistoryButtons();
  renderAll();
}

function restoreDoc(nextDoc) {
  if (!nextDoc) return;
  doc = nextDoc;
  if (ui.tool === "crop") {
    ui.tool = "select";
    ui.cropRect = null;
  }
  syncHistoryButtons();
  renderAll();
  syncInspector();
}

function undo() {
  const prev = history.undo();
  if (prev) restoreDoc(prev);
}

function redo() {
  const next = history.redo();
  if (next) restoreDoc(next);
}

function placeImageLayer(asset) {
  const layout = computeCanvasLayout(doc);
  const maxW = Math.max(120, Math.round(layout.totalWidth * 0.42));
  const maxH = Math.max(120, Math.round(layout.totalHeight * 0.42));
  const scale = Math.min(1, maxW / asset.width, maxH / asset.height);
  const w = Math.max(48, Math.round(asset.width * scale));
  const h = Math.max(48, Math.round(asset.height * scale));
  const offset = (doc.layers.filter((l) => l.type === "image").length % 5) * 28;
  const x = Math.round((layout.totalWidth - w) / 2 + offset);
  const y = Math.round((layout.totalHeight - h) / 2 + offset);

  addLayer(doc, {
    type: "image",
    name: asset.name || "Image Layer",
    assetId: asset.assetId,
    x,
    y,
    width: w,
    height: h,
    radius: 12,
    shadow: 30,
    rotation: 0,
    opacity: 1,
    blendMode: "source-over",
    filters: { ...DEFAULT_FILTERS },
  });
}

async function ingestItems(items, mode = "open") {
  if (!items?.length) return;
  const loaded = [];
  for (const item of items) {
    try {
      const asset = await registerAsset(item.blob, item.name || "Image");
      loaded.push({ asset, url: item.url || "" });
    } catch (err) {
      console.warn("SwiftSelect Annotate: skipping unreadable image", err);
    }
  }
  if (!loaded.length) {
    toast("Could not load the selected image", { error: true });
    return;
  }

  const effectiveMode = mode === "layer" && !hasWorkspaceContent() ? "open" : mode;

  if (effectiveMode === "open") {
    const first = loaded[0];
    doc = createDocument({
      title: loaded.length === 1 ? first.asset.name : `${first.asset.name} + ${loaded.length - 1} more`,
      url: first.url || "",
    });
    doc.baseImages = loaded.map((x) => ({
      assetId: x.asset.assetId,
      name: x.asset.name,
      width: x.asset.width,
      height: x.asset.height,
    }));
    if (loaded.length > 1) {
      doc.frame.stitchLayout = "side-by-side";
      doc.frame.padding = 6;
    }
    history.reset(doc);
    ui.tool = "pen";
    ui.cropRect = null;
    ui.zoomMode = "fit";
    ui.leftDrawer = null;
    ui.rightDrawer = null;
    syncHistoryButtons();
    renderAll();
    syncInspector();
    if (loaded.length > 1) {
      toast(`Stitched ${formatNumber(loaded.length)} images side by side`);
    }
  } else if (effectiveMode === "stitch") {
    doc.blankSize = null;
    for (const x of loaded) {
      doc.baseImages.push({
        assetId: x.asset.assetId,
        name: x.asset.name,
        width: x.asset.width,
        height: x.asset.height,
      });
    }
    ui.zoomMode = "fit";
    commit();
    syncInspector();
    toast(loaded.length === 1 ? "Image stitched onto canvas" : `${formatNumber(loaded.length)} images stitched`);
  } else if (effectiveMode === "layer") {
    for (const x of loaded) {
      placeImageLayer(x.asset);
    }
    ui.tool = "select";
    ui.leftDrawer = "layers";
    commit();
    syncInspector();
    toast(loaded.length === 1 ? "Added image as layer" : `Added ${formatNumber(loaded.length)} image layers`);
  }
}

export async function openStudioWithFiles(files, mode = "open") {
  if (!mounted) await mountStudio();
  const valid = [...(files || [])].filter((f) => f && (IMAGE_TYPES.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(f.name || "")));
  if (!valid.length) {
    toast("Please choose PNG, JPG, WebP, GIF, SVG, BMP, or AVIF images", { error: true });
    return;
  }
  await ingestItems(
    valid.map((f) => ({ blob: f, name: f.name || "Local image", url: "" })),
    mode,
  );
}

export async function openStudioWithCaptures(ids, mode = "open") {
  if (!mounted) await mountStudio();
  const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter((n) => n > 0);
  if (!list.length) return;
  const items = [];
  for (const id of list) {
    try {
      const rec = await getCapture(id);
      if (rec?.blob) {
        items.push({ blob: rec.blob, name: rec.title || `Capture ${rec.id}`, url: rec.url || "" });
      }
    } catch {}
  }
  if (!items.length) {
    toast("Capture is no longer in the gallery", { error: true });
    return;
  }
  await ingestItems(items, mode);
}

function startBlankCanvas(width, height, title) {
  doc = createDocument({ title });
  doc.blankSize = { width, height };
  doc.frame = { ...DEFAULT_FRAME, bgId: "grad-lavender", padding: 7, radius: 4, shadow: 45 };
  history.reset(doc);
  ui.tool = "pen";
  ui.cropRect = null;
  ui.zoomMode = "fit";
  syncHistoryButtons();
  renderAll();
  syncInspector();
}

// ─── Canvas Sizing & Rendering ────────────────────────────────────────

function computeFitScale(canvasW, canvasH) {
  if (!stageWrapEl) return 1;
  const rect = stageWrapEl.getBoundingClientRect();
  const padX = rect.width < 760 ? 36 : 176;
  const padY = rect.height < 640 ? 148 : 178;
  const availW = Math.max(180, rect.width - padX);
  const availH = Math.max(180, rect.height - padY);
  return Math.min(1, availW / Math.max(1, canvasW), availH / Math.max(1, canvasH));
}

function applyCanvasDisplayScale(layout) {
  if (!canvasEl || !canvasFrameEl) return;
  const scale = ui.zoomMode === "fit" ? computeFitScale(layout.totalWidth, layout.totalHeight) : ui.zoomScale;
  ui.zoomScale = clamp(scale, 0.1, 4);
  const dispW = Math.max(1, Math.round(layout.totalWidth * ui.zoomScale));
  const dispH = Math.max(1, Math.round(layout.totalHeight * ui.zoomScale));
  canvasEl.style.width = `${dispW}px`;
  canvasEl.style.height = `${dispH}px`;

  const isTransparent = doc.frame.customMode === "preset" && doc.frame.bgId === "transparent";
  canvasFrameEl.classList.toggle("is-checker", isTransparent);

  const zoomLabel = qs("#st-zoom-val");
  if (zoomLabel) zoomLabel.textContent = `${Math.round(ui.zoomScale * 100)}%`;

  const dimsEl = qs("#st-dims");
  if (dimsEl) {
    let sourceLabel = "";
    if (doc.baseImages.length > 1) {
      sourceLabel = ` · ${doc.baseImages.length} images`;
    } else if (doc.url) {
      try {
        sourceLabel = ` · ${new URL(doc.url).hostname.replace(/^www\./, "")}`;
      } catch {}
    } else if (doc.blankSize) {
      sourceLabel = " · canvas";
    }
    dimsEl.textContent = `${formatNumber(layout.totalWidth)} × ${formatNumber(layout.totalHeight)}${sourceLabel}`;
  }
}

function renderCanvas() {
  if (!canvasEl || !hasWorkspaceContent()) return;
  const layout = computeCanvasLayout(doc);
  applyCanvasDisplayScale(layout);
  lastLayout = renderStudioCanvas(canvasEl, doc, assets, {
    showSelection: ui.tool === "select",
    draftLayer,
    cropRect: ui.tool === "crop" ? ui.cropRect : null,
    zoomScale: ui.zoomScale,
  });
}

function renderAll() {
  if (!mounted) return;
  const active = hasWorkspaceContent();
  const emptyEl = qs("#st-empty");
  const stageEl = qs("#st-stage");
  const captionEl = qs("#st-caption-pill");
  const zoomEl = qs("#st-zoom-pill");
  if (emptyEl) emptyEl.hidden = active;
  if (stageEl) stageEl.hidden = !active;
  if (captionEl) captionEl.hidden = !active || ui.tool === "crop";
  if (zoomEl) zoomEl.hidden = !active;

  const titleInput = qs("#st-title");
  if (titleInput && document.activeElement !== titleInput) {
    titleInput.value = doc.title || "Untitled";
    titleInput.size = clamp((titleInput.value || "Untitled").length + 1, 8, 28);
  }

  qsa("[data-need-doc]").forEach((el) => {
    el.disabled = !active;
  });

  if (active) {
    renderCanvas();
  }

  syncToolDock();
  syncStyleBar();
  syncCropBar();
  syncClearButton();
}

function syncHistoryButtons() {
  const u = qs("#st-undo");
  const r = qs("#st-redo");
  if (u) u.disabled = !history.canUndo;
  if (r) r.disabled = !history.canRedo;
  syncClearButton();
}

function syncClearButton() {
  const btn = qs("#st-clear-btn");
  if (!btn) return;
  const hasLayers = doc.layers.length > 0;
  btn.disabled = !hasWorkspaceContent() || !hasLayers;
  const sel = doc.selectedLayerId ? findLayer(doc, doc.selectedLayerId) : null;
  btn.setAttribute("data-tip", sel ? "Delete selected layer · Del" : "Clear all annotations");
  btn.setAttribute("aria-label", sel ? "Delete selected layer" : "Clear all annotations");
}

// ─── Coordinate Helpers ───────────────────────────────────────────────

function clientToCanvas(clientX, clientY) {
  const rect = canvasEl.getBoundingClientRect();
  const sx = canvasEl.width / Math.max(1, rect.width);
  const sy = canvasEl.height / Math.max(1, rect.height);
  return {
    x: (clientX - rect.left) * sx,
    y: (clientY - rect.top) * sy,
  };
}

// ─── Tool Orbs & Liquid Glass Tune Popover Sync ───────────────────────

function syncToolDock() {
  qsa(".lg-orb[data-tool]").forEach((btn) => {
    const on = btn.dataset.tool === ui.tool;
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("is-active", on);
  });
  if (canvasEl) {
    canvasEl.dataset.tool = ui.tool;
  }
}

function getActiveStyleTarget() {
  if (ui.tool === "select" && doc.selectedLayerId) {
    const sel = findLayer(doc, doc.selectedLayerId);
    if (sel && sel.type !== "image") return sel;
  }
  return null;
}

function syncStyleBar() {
  const sel = getActiveStyleTarget();
  const activeType = sel ? sel.type : ui.tool;
  const color = sel?.color || ui.color;
  const lw = sel?.lineWidth ?? ui.lineWidth;
  const op = Math.round(((sel?.opacity ?? ui.opacity) || 1) * 100);
  const fill = sel ? !!sel.fill : ui.fill;
  const dash = sel?.dash || ui.dash;
  const head = sel?.head || ui.arrowHead;
  const font = sel?.font || ui.font;
  const bold = sel ? sel.bold !== false : ui.bold;
  const italic = sel ? !!sel.italic : ui.italic;
  const fontSize = sel?.fontSize || ui.fontSize;

  // Live colored ring in the signature Tune Pill
  const tuneRing = qs("#st-tune-ring");
  if (tuneRing) tuneRing.style.setProperty("--tune-color", color);

  qsa(".st-swatch").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.color.toLowerCase() === color.toLowerCase());
  });
  const colorPicker = qs("#st-style-color");
  if (colorPicker && /^#[0-9a-f]{6}$/i.test(color)) colorPicker.value = color;

  const isText = activeType === "text" || activeType === "callout";
  const isBlur = activeType === "blur";
  const isShape = activeType === "rect" || activeType === "ellipse";
  const isArrow = activeType === "arrow";

  const grpColor = qs("#st-grp-color");
  const grpFill = qs("#st-grp-fill");
  const grpDash = qs("#st-grp-dash");
  const grpArrow = qs("#st-grp-arrow");
  const grpText = qs("#st-grp-text");

  if (grpColor) grpColor.hidden = isBlur;
  if (grpFill) grpFill.hidden = !(isShape || activeType === "text" || isBlur);
  if (grpDash) grpDash.hidden = !(isShape || isArrow || activeType === "pen" || activeType === "select");
  if (grpArrow) grpArrow.hidden = !isArrow;
  if (grpText) grpText.hidden = !isText;

  const strokeSlider = qs("#st-style-width");
  const strokeOut = qs("#st-style-width-out");
  if (strokeSlider) strokeSlider.value = String(lw);
  if (strokeOut) strokeOut.textContent = `${lw}px`;

  const opSlider = qs("#st-style-opacity");
  const opOut = qs("#st-style-opacity-out");
  if (opSlider) opSlider.value = String(op);
  if (opOut) opOut.textContent = `${op}%`;

  const fillBtn = qs("#st-style-fill");
  if (fillBtn) {
    fillBtn.classList.toggle("is-active", fill);
    fillBtn.setAttribute("aria-pressed", String(fill));
    fillBtn.textContent = isBlur ? (fill ? "Solid Bar" : "Mosaic") : activeType === "text" ? (fill ? "Badge" : "Plain") : fill ? "Filled" : "Outline";
  }

  qsa("[data-dash]").forEach((b) => b.classList.toggle("is-active", b.dataset.dash === dash));
  qsa("[data-arrow-head]").forEach((b) => b.classList.toggle("is-active", b.dataset.arrowHead === head));

  const fontSel = qs("#st-style-font");
  if (fontSel) fontSel.value = font;
  const sizeSlider = qs("#st-style-fontsize");
  const sizeOut = qs("#st-style-fontsize-out");
  if (sizeSlider) sizeSlider.value = String(fontSize);
  if (sizeOut) sizeOut.textContent = `${fontSize}px`;
  qs("#st-style-bold")?.classList.toggle("is-active", bold);
  qs("#st-style-italic")?.classList.toggle("is-active", italic);
}

function updateActiveStyle(patch, coalesceKey = "") {
  Object.assign(ui, patch);
  const sel = getActiveStyleTarget();
  if (sel && !sel.locked) {
    if ("color" in patch) sel.color = patch.color;
    if ("lineWidth" in patch) {
      sel.lineWidth = patch.lineWidth;
      if (sel.type === "counter") sel.radius = Math.max(16, patch.lineWidth * 3.1);
    }
    if ("opacity" in patch) sel.opacity = patch.opacity;
    if ("fill" in patch) sel.fill = patch.fill;
    if ("dash" in patch) sel.dash = patch.dash;
    if ("arrowHead" in patch) sel.head = patch.arrowHead;
    if ("font" in patch) sel.font = patch.font;
    if ("fontSize" in patch) sel.fontSize = patch.fontSize;
    if ("bold" in patch) sel.bold = patch.bold;
    if ("italic" in patch) sel.italic = patch.italic;
    commit(coalesceKey);
  } else {
    syncStyleBar();
  }
}

// ─── Crop Workflow ────────────────────────────────────────────────────

function enterCropMode() {
  if (!hasWorkspaceContent()) return;
  closeAllPopovers();
  ui.tool = "crop";
  ui.cropAspect = "free";
  const layout = computeCanvasLayout(doc);
  const m = Math.round(Math.min(layout.totalWidth, layout.totalHeight) * 0.06);
  ui.cropRect = {
    x: m,
    y: m,
    width: Math.max(40, layout.totalWidth - m * 2),
    height: Math.max(40, layout.totalHeight - m * 2),
  };
  renderAll();
}

function applyCropAspect(aspectId) {
  ui.cropAspect = aspectId;
  const preset = CROP_PRESETS.find((p) => p.id === aspectId);
  const layout = computeCanvasLayout(doc);
  if (preset?.ratio) {
    const cx = layout.totalWidth / 2;
    const cy = layout.totalHeight / 2;
    let w = layout.totalWidth * 0.86;
    let h = w / preset.ratio;
    if (h > layout.totalHeight * 0.86) {
      h = layout.totalHeight * 0.86;
      w = h * preset.ratio;
    }
    ui.cropRect = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: Math.round(w), height: Math.round(h) };
  }
  renderAll();
}

async function commitCrop() {
  if (!ui.cropRect || ui.cropRect.width < 12 || ui.cropRect.height < 12) {
    ui.tool = "select";
    ui.cropRect = null;
    renderAll();
    return;
  }
  const full = document.createElement("canvas");
  renderStudioCanvas(full, doc, assets, { showSelection: false });
  const r = ui.cropRect;
  const sx = clamp(Math.round(r.x), 0, full.width - 1);
  const sy = clamp(Math.round(r.y), 0, full.height - 1);
  const sw = clamp(Math.round(r.width), 1, full.width - sx);
  const sh = clamp(Math.round(r.height), 1, full.height - sy);

  const cropped = document.createElement("canvas");
  cropped.width = sw;
  cropped.height = sh;
  cropped.getContext("2d").drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);

  const blob = await canvasToBlob(cropped, "image/png");
  const asset = await registerAsset(blob, doc.title || "Cropped");
  doc.baseImages = [{ assetId: asset.assetId, name: asset.name, width: asset.width, height: asset.height }];
  doc.blankSize = null;
  doc.layers = [];
  doc.selectedLayerId = null;
  doc.transform = { ...DEFAULT_TRANSFORM };
  doc.filters = { ...DEFAULT_FILTERS };
  doc.frame = { ...doc.frame, padding: 0, radius: 0, shadow: 0, border: 0, windowStyle: "none", aspectRatio: "auto" };

  ui.tool = "select";
  ui.cropRect = null;
  ui.zoomMode = "fit";
  commit();
  syncInspector();
  toast(`Cropped to ${formatNumber(sw)} × ${formatNumber(sh)}`);
}

function syncCropBar() {
  const bar = qs("#st-crop-bar");
  if (!bar) return;
  const on = hasWorkspaceContent() && ui.tool === "crop";
  bar.hidden = !on;
  if (!on) return;
  qsa("[data-crop-aspect]").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.cropAspect === ui.cropAspect);
  });
}

// ─── Inline Text / Callout Editor ─────────────────────────────────────

function closeTextEditor(commitText = true) {
  if (!activeTextEditor) return;
  const { el, layerId, isNew, prevText } = activeTextEditor;
  activeTextEditor = null;
  const val = el.value.trim();
  el.remove();

  const layer = findLayer(doc, layerId);
  if (!layer) return;
  if (!commitText) {
    if (isNew) removeLayer(doc, layerId);
    else layer.text = prevText;
    renderAll();
    syncInspector();
    return;
  }
  if (!val) {
    removeLayer(doc, layerId);
  } else {
    layer.text = val;
    layer.name = val.split("\n")[0].slice(0, 24) || layer.name;
  }
  commit();
  syncInspector();
}

function openTextEditor(layer, isNew = false) {
  closeTextEditor(true);
  if (!canvasEl || !canvasFrameEl) return;
  const scale = ui.zoomScale || 1;
  const el = document.createElement("textarea");
  el.className = "st-text-editor";
  el.value = isNew ? "" : layer.text || "";
  el.placeholder = layer.type === "callout" ? "Type callout…" : "Type text…";
  el.style.left = `${Math.round(layer.x * scale)}px`;
  el.style.top = `${Math.round(layer.y * scale)}px`;
  el.style.fontSize = `${Math.max(13, Math.round((layer.fontSize || 28) * scale))}px`;
  el.style.color = layer.fill || layer.type === "callout" ? "#ffffff" : layer.color || "#FF3333";
  if (layer.fill || layer.type === "callout") {
    el.style.background = layer.color || "#FF3333";
  }

  activeTextEditor = { el, layerId: layer.id, isNew, prevText: layer.text || "" };
  canvasFrameEl.appendChild(el);
  el.focus();
  el.select();

  el.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      closeTextEditor(false);
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
      e.preventDefault();
      closeTextEditor(true);
    }
  });
  el.addEventListener("blur", () => closeTextEditor(true));
}

// ─── Canvas Pointer Interactions ──────────────────────────────────────

function onCanvasPointerDown(e) {
  if (e.button !== 0 || !hasWorkspaceContent()) return;
  closeAllPopovers();
  if (activeTextEditor) {
    closeTextEditor(true);
    return;
  }

  const pt = clientToCanvas(e.clientX, e.clientY);
  const inv = 1 / Math.max(0.2, ui.zoomScale);

  // Crop mode drag
  if (ui.tool === "crop") {
    const r = ui.cropRect;
    const hitTol = 18 * inv;
    let mode = "new";
    if (r) {
      const nearL = Math.abs(pt.x - r.x) < hitTol;
      const nearR = Math.abs(pt.x - (r.x + r.width)) < hitTol;
      const nearT = Math.abs(pt.y - r.y) < hitTol;
      const nearB = Math.abs(pt.y - (r.y + r.height)) < hitTol;
      if (nearL && nearT) mode = "tl";
      else if (nearR && nearT) mode = "tr";
      else if (nearR && nearB) mode = "br";
      else if (nearL && nearB) mode = "bl";
      else if (pt.x > r.x && pt.x < r.x + r.width && pt.y > r.y && pt.y < r.y + r.height) mode = "move";
    }
    pointerState = { kind: "crop", mode, start: pt, orig: r ? { ...r } : null };
    canvasEl.setPointerCapture(e.pointerId);
    return;
  }

  // Select / Move / Resize mode
  if (ui.tool === "select") {
    const selected = findLayer(doc, doc.selectedLayerId);
    if (selected && !selected.locked) {
      const handle = hitTestHandle(selected, pt.x, pt.y, 13 * inv);
      if (handle) {
        pointerState = {
          kind: "resize",
          layerId: selected.id,
          handleId: handle.id,
          start: pt,
          orig: deepClone(selected),
        };
        canvasEl.setPointerCapture(e.pointerId);
        return;
      }
    }
    const hit = hitTestLayers(doc, pt.x, pt.y, 12 * inv);
    doc.selectedLayerId = hit ? hit.id : null;
    renderCanvas();
    syncStyleBar();
    syncInspector();
    syncClearButton();
    if (hit && !hit.locked) {
      pointerState = {
        kind: "move",
        layerId: hit.id,
        last: pt,
        moved: false,
      };
      canvasEl.setPointerCapture(e.pointerId);
    }
    return;
  }

  // Click-place tools: Step Counter, Text, Callout
  if (ui.tool === "counter") {
    const baseDim = lastLayout?.baseDim || 1000;
    const radius = Math.max(16, Math.round(ui.lineWidth * 3.1 * Math.max(1, baseDim / 900)));
    addLayer(doc, {
      type: "counter",
      x: pt.x,
      y: pt.y,
      radius,
      lineWidth: ui.lineWidth,
      color: ui.color,
      number: doc.stepCounter,
      opacity: ui.opacity,
    });
    commit();
    syncInspector();
    return;
  }

  if (ui.tool === "text" || ui.tool === "callout") {
    const baseDim = lastLayout?.baseDim || 1000;
    const fontSize = Math.max(18, Math.round(ui.fontSize * Math.max(1, baseDim / 950)));
    const layer = addLayer(doc, {
      type: ui.tool,
      x: pt.x,
      y: pt.y,
      text: "",
      color: ui.color,
      font: ui.font,
      fontSize,
      bold: ui.bold,
      italic: ui.italic,
      fill: ui.tool === "callout" ? true : ui.fill,
      align: "left",
      opacity: ui.opacity,
    });
    ui.tool = "select";
    renderAll();
    openTextEditor(layer, true);
    return;
  }

  // Drag-draw tools: Pen, Highlighter, Arrow, Rect, Ellipse, Spotlight, Blur
  const baseDim = lastLayout?.baseDim || 1000;
  const scaledWidth = Math.max(2, Math.round(ui.lineWidth * Math.max(1, baseDim / 950)));

  if (ui.tool === "pen" || ui.tool === "highlighter") {
    draftLayer = {
      id: nextLayerId(ui.tool),
      type: ui.tool,
      visible: true,
      locked: false,
      color: ui.color,
      lineWidth: ui.tool === "highlighter" ? Math.max(18, scaledWidth * 4.5) : scaledWidth,
      opacity: ui.tool === "highlighter" ? 0.42 : ui.opacity,
      blendMode: ui.tool === "highlighter" ? "multiply" : "source-over",
      dash: ui.tool === "pen" ? ui.dash : "solid",
      points: [{ x: pt.x, y: pt.y }],
    };
  } else if (ui.tool === "arrow") {
    draftLayer = {
      id: nextLayerId("arrow"),
      type: "arrow",
      visible: true,
      locked: false,
      color: ui.color,
      lineWidth: scaledWidth,
      opacity: ui.opacity,
      dash: ui.dash,
      head: ui.arrowHead,
      x1: pt.x,
      y1: pt.y,
      x2: pt.x,
      y2: pt.y,
    };
  } else {
    draftLayer = {
      id: nextLayerId(ui.tool),
      type: ui.tool,
      visible: true,
      locked: false,
      color: ui.tool === "spotlight" ? "#ffffff" : ui.color,
      lineWidth: scaledWidth,
      opacity: ui.opacity,
      fill: ui.fill,
      dash: ui.dash,
      x: pt.x,
      y: pt.y,
      width: 0,
      height: 0,
    };
  }
  pointerState = { kind: "draw", start: pt };
  canvasEl.setPointerCapture(e.pointerId);
  renderCanvas();
}

function onCanvasPointerMove(e) {
  if (!hasWorkspaceContent()) return;
  const pt = clientToCanvas(e.clientX, e.clientY);

  if (!pointerState) {
    if (ui.tool === "select") {
      const inv = 1 / Math.max(0.2, ui.zoomScale);
      const selected = findLayer(doc, doc.selectedLayerId);
      const h = selected && !selected.locked ? hitTestHandle(selected, pt.x, pt.y, 13 * inv) : null;
      if (h) {
        canvasEl.style.cursor = h.cursor;
      } else {
        const hit = hitTestLayers(doc, pt.x, pt.y, 12 * inv);
        canvasEl.style.cursor = hit ? "move" : "default";
      }
    } else {
      canvasEl.style.cursor = "crosshair";
    }
    return;
  }

  if (pointerState.kind === "crop") {
    const cw = canvasEl.width;
    const ch = canvasEl.height;
    const dx = pt.x - pointerState.start.x;
    const dy = pt.y - pointerState.start.y;
    const o = pointerState.orig;
    if (pointerState.mode === "move" && o) {
      ui.cropRect = {
        x: clamp(o.x + dx, 0, cw - o.width),
        y: clamp(o.y + dy, 0, ch - o.height),
        width: o.width,
        height: o.height,
      };
    } else if (pointerState.mode === "new") {
      const x = clamp(Math.min(pointerState.start.x, pt.x), 0, cw);
      const y = clamp(Math.min(pointerState.start.y, pt.y), 0, ch);
      const w = Math.max(20, clamp(Math.abs(dx), 20, cw - x));
      const h = Math.max(20, clamp(Math.abs(dy), 20, ch - y));
      ui.cropRect = { x, y, width: w, height: h };
    } else if (o) {
      let l = o.x;
      let t = o.y;
      let r = o.x + o.width;
      let b = o.y + o.height;
      if (pointerState.mode.includes("l")) l = clamp(o.x + dx, 0, r - 24);
      if (pointerState.mode.includes("r")) r = clamp(o.x + o.width + dx, l + 24, cw);
      if (pointerState.mode.includes("t")) t = clamp(o.y + dy, 0, b - 24);
      if (pointerState.mode.includes("b")) b = clamp(o.y + o.height + dy, t + 24, ch);
      ui.cropRect = { x: l, y: t, width: r - l, height: b - t };
    }
    renderCanvas();
    return;
  }

  if (pointerState.kind === "move") {
    const layer = findLayer(doc, pointerState.layerId);
    if (!layer) return;
    const dx = pt.x - pointerState.last.x;
    const dy = pt.y - pointerState.last.y;
    if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2) {
      moveLayerBy(layer, dx, dy);
      pointerState.last = pt;
      pointerState.moved = true;
      renderCanvas();
    }
    return;
  }

  if (pointerState.kind === "resize") {
    const layer = findLayer(doc, pointerState.layerId);
    if (!layer) return;
    const o = pointerState.orig;
    const h = pointerState.handleId;
    if (layer.type === "arrow") {
      if (h === "start") {
        layer.x1 = pt.x;
        layer.y1 = pt.y;
      } else {
        layer.x2 = pt.x;
        layer.y2 = pt.y;
      }
    } else {
      const ob = getLayerBounds(o);
      let l = ob.x;
      let t = ob.y;
      let r = ob.x + ob.width;
      let b = ob.y + ob.height;
      if (h.includes("l")) l = pt.x;
      if (h.includes("r")) r = pt.x;
      if (h.includes("t")) t = pt.y;
      if (h.includes("b")) b = pt.y;

      let nw = Math.max(16, r - l);
      let nh = Math.max(16, b - t);
      const keepAspect = (layer.type === "image" && !e.shiftKey) || (layer.type !== "image" && e.shiftKey);
      if (keepAspect && ["tl", "tr", "bl", "br"].includes(h) && ob.width > 0 && ob.height > 0) {
        const aspect = ob.width / ob.height;
        if (nw / nh > aspect) nw = nh * aspect;
        else nh = nw / aspect;
        if (h.includes("l")) l = r - nw;
        if (h.includes("t")) t = b - nh;
      }
      layer.x = Math.min(l, r - 16);
      layer.y = Math.min(t, b - 16);
      layer.width = nw;
      layer.height = nh;
    }
    pointerState.moved = true;
    renderCanvas();
    return;
  }

  if (pointerState.kind === "draw" && draftLayer) {
    if (draftLayer.type === "pen" || draftLayer.type === "highlighter") {
      const pts = draftLayer.points;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) >= 2.5) {
        pts.push({ x: pt.x, y: pt.y });
      }
    } else if (draftLayer.type === "arrow") {
      let ex = pt.x;
      let ey = pt.y;
      if (e.shiftKey) {
        const angle = Math.atan2(ey - draftLayer.y1, ex - draftLayer.x1);
        const snap = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        const dist = Math.hypot(ex - draftLayer.x1, ey - draftLayer.y1);
        ex = draftLayer.x1 + Math.cos(snap) * dist;
        ey = draftLayer.y1 + Math.sin(snap) * dist;
      }
      draftLayer.x2 = ex;
      draftLayer.y2 = ey;
    } else {
      let w = pt.x - pointerState.start.x;
      let h = pt.y - pointerState.start.y;
      if (e.shiftKey) {
        const s = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * s;
        h = Math.sign(h || 1) * s;
      }
      draftLayer.x = w < 0 ? pointerState.start.x + w : pointerState.start.x;
      draftLayer.y = h < 0 ? pointerState.start.y + h : pointerState.start.y;
      draftLayer.width = Math.abs(w);
      draftLayer.height = Math.abs(h);
    }
    renderCanvas();
  }
}

function onCanvasPointerUp(e) {
  if (!pointerState) return;
  try {
    canvasEl.releasePointerCapture(e.pointerId);
  } catch {}
  const st = pointerState;
  pointerState = null;

  if (st.kind === "move" || st.kind === "resize") {
    if (st.moved) commit();
    return;
  }

  if (st.kind === "draw" && draftLayer) {
    const finished = draftLayer;
    draftLayer = null;
    const valid =
      finished.type === "pen" || finished.type === "highlighter"
        ? finished.points.length >= 2
        : finished.type === "arrow"
          ? Math.hypot(finished.x2 - finished.x1, finished.y2 - finished.y1) >= 8
          : Math.abs(finished.width) >= 6 && Math.abs(finished.height) >= 6;
    if (valid) {
      addLayer(doc, finished);
      commit();
      syncInspector();
    } else {
      renderCanvas();
    }
  }
}

function onCanvasDoubleClick(e) {
  if (!hasWorkspaceContent() || ui.tool !== "select") return;
  const pt = clientToCanvas(e.clientX, e.clientY);
  const inv = 1 / Math.max(0.2, ui.zoomScale);
  const hit = hitTestLayers(doc, pt.x, pt.y, 12 * inv);
  if (hit && (hit.type === "text" || hit.type === "callout") && !hit.locked) {
    doc.selectedLayerId = hit.id;
    openTextEditor(hit, false);
  }
}

// ─── Export, Copy, Share & Save to Gallery ────────────────────────────

async function renderCleanExportCanvas(forceOpaqueWhite = false) {
  const out = document.createElement("canvas");
  renderStudioCanvas(out, doc, assets, { showSelection: false, forceOpaqueWhite });
  return out;
}

async function copyStudioToClipboard() {
  if (!hasWorkspaceContent()) return;
  try {
    const out = await renderCleanExportCanvas(false);
    const blob = await canvasToBlob(out, "image/png");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    confirmButton(qs("#st-copy"), "");
    toast("Copied image to clipboard");
  } catch (err) {
    console.warn("SwiftSelect Annotate: clipboard copy failed", err);
    toast("Clipboard refused the image", { error: true });
  }
}

async function saveStudioToGallery() {
  if (!hasWorkspaceContent()) return;
  try {
    const settings = await getSettings();
    const fmt = settings.outputFormat || "png";
    const mime = fmt === "jpg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png";
    const out = await renderCleanExportCanvas(fmt === "jpg");
    const blob = await canvasToBlob(out, mime, settings.jpgQuality ?? 0.92);
    await addCapture({
      blob,
      title: (doc.title || "Annotated Capture").trim(),
      url: doc.url || "",
      type: "annotated",
      width: out.width,
      height: out.height,
    });
    onSavedCallback?.();
    confirmButton(qs("#st-save"), "");
    toast("Saved to Swift Gallery (Annotated)");
  } catch (err) {
    console.warn("SwiftSelect Annotate: save to gallery failed", err);
    toast("Could not save to gallery", { error: true });
  }
}

async function exportStudio(format = ui.exportFormat) {
  if (!hasWorkspaceContent()) return;
  try {
    const settings = await getSettings();
    const stem = buildFilename(settings.filenameTemplate, {
      title: doc.title || "annotated",
      url: doc.url || "",
      type: "annotated",
      ext: format,
    }).replace(/\.[a-z0-9]{2,5}$/i, "");

    if (format === "pdf") {
      const out = await renderCleanExportCanvas(true);
      const pngBlob = await canvasToBlob(out, "image/png");
      const pdfBlob = await imageToPdf(pngBlob, { title: doc.title || "SwiftSelect Annotate" });
      await downloadBlobFile(pdfBlob, `${stem}.pdf`);
      confirmButton(qs("#st-export-btn"), "");
      toast(`Exported PDF (${formatBytes(pdfBlob.size)})`);
      return;
    }

    if (format === "ico") {
      const out = await renderCleanExportCanvas(false);
      const size = Math.min(256, Math.max(out.width, out.height));
      const sq = document.createElement("canvas");
      sq.width = size;
      sq.height = size;
      const sctx = sq.getContext("2d");
      const scale = Math.min(size / out.width, size / out.height);
      const dw = out.width * scale;
      const dh = out.height * scale;
      sctx.drawImage(out, (size - dw) / 2, (size - dh) / 2, dw, dh);
      const pngBlob = await canvasToBlob(sq, "image/png");
      const icoBytes = encodePngToIco(new Uint8Array(await pngBlob.arrayBuffer()), size, size);
      const icoBlob = new Blob([icoBytes], { type: "image/x-icon" });
      await downloadBlobFile(icoBlob, `${stem}.ico`);
      confirmButton(qs("#st-export-btn"), "");
      toast(`Exported ICO (${formatBytes(icoBlob.size)})`);
      return;
    }

    const mime = format === "jpg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
    const out = await renderCleanExportCanvas(format === "jpg");
    const blob = await canvasToBlob(out, mime, ui.exportQuality);
    await downloadBlobFile(blob, `${stem}.${format}`);
    confirmButton(qs("#st-export-btn"), "");
    toast(`Exported ${format.toUpperCase()} (${formatBytes(blob.size)})`);
  } catch (err) {
    console.warn("SwiftSelect Annotate: export failed", err);
    toast("Export failed", { error: true });
  }
}

async function shareStudio() {
  if (!hasWorkspaceContent()) return;
  try {
    const out = await renderCleanExportCanvas(false);
    const blob = await canvasToBlob(out, "image/png");
    const safeName = `${(doc.title || "swiftselect-annotated").replace(/[^a-z0-9-_]+/gi, "-").toLowerCase()}.png`;
    const file = new File([blob], safeName, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: doc.title || "SwiftSelect Annotate" });
      return;
    }
    await exportStudio("png");
  } catch (err) {
    if (err?.name !== "AbortError") {
      toast("Sharing is unavailable here — downloading PNG instead");
      await exportStudio("png");
    }
  }
}

// ─── Left & Right Floating Liquid Glass Drawers Sync ──────────────────

function getFilterTarget() {
  const sel = doc.selectedLayerId ? findLayer(doc, doc.selectedLayerId) : null;
  if (sel && sel.type === "image") {
    if (!sel.filters) sel.filters = { ...DEFAULT_FILTERS };
    return { kind: "layer", layer: sel, filters: sel.filters, label: sel.name || "Image Layer" };
  }
  return { kind: "base", layer: null, filters: doc.filters, label: "Base Canvas" };
}

function syncDrawers() {
  const leftDrawer = qs("#st-drawer-left");
  const rightDrawer = qs("#st-drawer-right");
  const leftOpen = ui.leftDrawer === "layers";
  const rightOpen = !!ui.rightDrawer;

  if (leftDrawer) {
    leftDrawer.hidden = !leftOpen;
    leftDrawer.classList.toggle("is-open", leftOpen);
  }
  if (rightDrawer) {
    rightDrawer.hidden = !rightOpen;
    rightDrawer.classList.toggle("is-open", rightOpen);
  }

  qsa("[data-left-drawer]").forEach((btn) => {
    const on = btn.dataset.leftDrawer === ui.leftDrawer;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  });

  qsa("[data-right-drawer]").forEach((btn) => {
    const on = btn.dataset.rightDrawer === ui.rightDrawer;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  });

  const rightTitle = qs("#st-right-drawer-title");
  if (rightTitle && ui.rightDrawer) {
    rightTitle.textContent = RIGHT_DRAWER_TITLES[ui.rightDrawer] || "Inspector";
  }

  qsa("#st-drawer-right .st-pane").forEach((p) => {
    p.hidden = p.dataset.pane !== ui.rightDrawer;
  });
}

function toggleLeftDrawer(name) {
  closeAllPopovers();
  ui.leftDrawer = ui.leftDrawer === name ? null : name;
  syncDrawers();
}

function toggleRightDrawer(name) {
  closeAllPopovers();
  ui.rightDrawer = ui.rightDrawer === name ? null : name;
  syncDrawers();
}

function syncFramePane() {
  const f = doc.frame;

  const listEl = qs("#st-base-list");
  if (listEl) {
    if (doc.baseImages.length === 0) {
      listEl.innerHTML = `<div class="st-empty-mini">${doc.blankSize ? `Blank canvas · ${doc.blankSize.width} × ${doc.blankSize.height}` : "No base images yet"}</div>`;
    } else {
      listEl.replaceChildren(
        ...doc.baseImages.map((img, i) => {
          const item = document.createElement("div");
          item.className = "st-base-chip";
          const thumb = assetThumbs.get(img.assetId) || "";
          item.innerHTML = `
            <img src="${thumb}" alt="" />
            <span class="st-base-info">
              <b></b>
              <small>${formatNumber(img.width)} × ${formatNumber(img.height)}</small>
            </span>
            <div class="st-base-acts">
              ${i > 0 ? `<button type="button" class="st-mini-btn" data-base-move="left" data-idx="${i}" aria-label="Move left">${icon("prev")}</button>` : ""}
              ${i < doc.baseImages.length - 1 ? `<button type="button" class="st-mini-btn" data-base-move="right" data-idx="${i}" aria-label="Move right">${icon("next")}</button>` : ""}
              <button type="button" class="st-mini-btn is-danger" data-base-remove="${i}" aria-label="Remove image">${icon("close")}</button>
            </div>`;
          item.querySelector("b").textContent = img.name || `Image ${i + 1}`;
          return item;
        }),
      );
    }
  }

  const stitchCtrl = qs("#st-stitch-controls");
  if (stitchCtrl) stitchCtrl.hidden = doc.baseImages.length < 2;
  qsa("[data-stitch-layout]").forEach((b) => b.classList.toggle("is-active", b.dataset.stitchLayout === f.stitchLayout));
  const gapSlider = qs("#st-stitch-gap");
  if (gapSlider) {
    gapSlider.value = String(f.stitchGap ?? 0.4);
    qs("#st-stitch-gap-out").textContent = `${Number(f.stitchGap ?? 0.4).toFixed(1)}%`;
  }
  const divSwitch = qs("#st-stitch-divider");
  if (divSwitch) divSwitch.setAttribute("aria-checked", String(!!f.stitchDivider));

  qsa("[data-win-style]").forEach((b) => {
    const on = b.dataset.winStyle === f.windowStyle;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  const winTitleWrap = qs("#st-win-title-wrap");
  const supportsTitle = ["macos-light", "macos-dark", "browser", "polaroid"].includes(f.windowStyle);
  if (winTitleWrap) winTitleWrap.hidden = !supportsTitle;
  const winTitleInput = qs("#st-win-title");
  if (winTitleInput && document.activeElement !== winTitleInput) {
    winTitleInput.value = f.windowTitle || "";
    winTitleInput.placeholder = f.windowStyle === "polaroid" ? "Print caption…" : "Window title or URL…";
  }

  qsa("[data-bg-mode]").forEach((b) => b.classList.toggle("is-active", b.dataset.bgMode === (f.customMode || "preset")));
  qsa("[data-bg-id]").forEach((b) => {
    const on = (f.customMode || "preset") === "preset" && b.dataset.bgId === f.bgId;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  const customWrap = qs("#st-bg-custom");
  if (customWrap) customWrap.hidden = (f.customMode || "preset") === "preset";
  const gradOnly = qs("#st-bg-grad-only");
  if (gradOnly) gradOnly.hidden = f.customMode !== "linear";
  if (qs("#st-bg-c1")) qs("#st-bg-c1").value = f.customColor || "#3b82f6";
  if (qs("#st-bg-c2")) qs("#st-bg-c2").value = f.customColor2 || "#8b5cf6";
  if (qs("#st-bg-angle")) {
    qs("#st-bg-angle").value = String(f.customAngle ?? 135);
    qs("#st-bg-angle-out").textContent = `${f.customAngle ?? 135}°`;
  }
  qsa("[data-pattern]").forEach((b) => b.classList.toggle("is-active", b.dataset.pattern === (f.pattern || "none")));

  qsa("[data-aspect]").forEach((b) => {
    const on = b.dataset.aspect === f.aspectRatio;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });

  const setSlider = (id, val, suffix) => {
    const el = qs(`#${id}`);
    const out = qs(`#${id}-out`);
    if (el) el.value = String(val);
    if (out) out.textContent = `${val}${suffix}`;
  };
  setSlider("st-padding", Number(f.padding ?? 4.5).toFixed(1), "%");
  setSlider("st-radius", Number(f.radius ?? 4.2).toFixed(1), "%");
  setSlider("st-shadow", Math.round(f.shadow ?? 35), "%");
  setSlider("st-border", Number(f.border ?? 1), "px");
}

function syncFiltersPane() {
  const target = getFilterTarget();
  const f = target.filters;
  const targetBadge = qs("#st-filter-target");
  if (targetBadge) {
    targetBadge.innerHTML =
      target.kind === "layer"
        ? `<span>Adjusting layer: <b></b></span><button type="button" class="st-link-btn" id="st-target-base">Switch to Base</button>`
        : `<span>Adjusting: <b>Base Canvas</b></span>`;
    if (target.kind === "layer") {
      targetBadge.querySelector("b").textContent = target.label;
      targetBadge.querySelector("#st-target-base")?.addEventListener("click", () => {
        doc.selectedLayerId = null;
        renderCanvas();
        syncInspector();
      });
    }
  }

  const transformCard = qs("#st-transform-card");
  if (transformCard) transformCard.hidden = target.kind === "layer";

  qsa("[data-filter-preset]").forEach((b) => {
    const on = b.dataset.filterPreset === (f.preset || "original");
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });

  const bindVal = (key, suffix = "%") => {
    const el = qs(`#st-f-${key}`);
    const out = qs(`#st-f-${key}-out`);
    const v = f[key] ?? DEFAULT_FILTERS[key];
    if (el) el.value = String(v);
    if (out) out.textContent = `${v}${suffix}`;
  };
  bindVal("brightness", "%");
  bindVal("contrast", "%");
  bindVal("saturation", "%");
  bindVal("warmth", "%");
  bindVal("hue", "°");
  bindVal("blur", "px");
  bindVal("grayscale", "%");
  bindVal("vignette", "%");
  bindVal("grain", "%");

  const resetBtn = qs("#st-filter-reset");
  if (resetBtn) resetBtn.disabled = isDefaultFilters(f);
}

function layerIconName(type) {
  const map = {
    image: "image",
    pen: "pen",
    highlighter: "highlighter",
    arrow: "arrow",
    rect: "rect",
    ellipse: "ellipse",
    spotlight: "spotlight",
    counter: "counter",
    blur: "blur",
    text: "text",
    callout: "callout",
  };
  return map[type] || "layers";
}

function syncLayersPane() {
  const n = doc.layers.length;
  const countEl = qs("#st-layer-count");
  if (countEl) countEl.textContent = `${formatNumber(n)} layer${n === 1 ? "" : "s"}`;

  const badgeEl = qs("#st-layer-badge");
  if (badgeEl) {
    badgeEl.hidden = n === 0;
    badgeEl.textContent = n > 99 ? "99+" : String(n);
  }

  const list = qs("#st-layer-list");
  if (!list) return;

  const frag = document.createDocumentFragment();
  if (n === 0) {
    const empty = document.createElement("div");
    empty.className = "st-empty-mini";
    empty.textContent = "Draw on the canvas or add an image/text layer above.";
    frag.appendChild(empty);
  } else {
    for (let i = n - 1; i >= 0; i--) {
      const l = doc.layers[i];
      const row = document.createElement("div");
      row.className = `st-layer-row${l.id === doc.selectedLayerId ? " is-selected" : ""}${!l.visible ? " is-hidden" : ""}${l.locked ? " is-locked" : ""}`;
      row.dataset.layerId = l.id;

      const thumbUrl = l.type === "image" ? assetThumbs.get(l.assetId) : "";
      const lead = thumbUrl
        ? `<span class="st-layer-thumb"><img src="${thumbUrl}" alt="" /></span>`
        : `<span class="st-layer-glyph" style="${l.color ? `--lc:${l.color}` : ""}">${icon(layerIconName(l.type))}</span>`;

      row.innerHTML = `
        <button type="button" class="st-layer-pick" data-layer-act="select">
          ${lead}
          <span class="st-layer-name"></span>
        </button>
        <div class="st-layer-acts">
          <button type="button" class="st-mini-btn" data-layer-act="up" ${i === n - 1 ? "disabled" : ""} aria-label="Move layer up" data-tip="Bring forward">${icon("moveUp")}</button>
          <button type="button" class="st-mini-btn" data-layer-act="down" ${i === 0 ? "disabled" : ""} aria-label="Move layer down" data-tip="Send backward">${icon("moveDown")}</button>
          <button type="button" class="st-mini-btn" data-layer-act="dup" aria-label="Duplicate layer" data-tip="Duplicate">${icon("duplicate")}</button>
          <button type="button" class="st-mini-btn${l.locked ? " is-on" : ""}" data-layer-act="lock" aria-label="${l.locked ? "Unlock" : "Lock"} layer" data-tip="${l.locked ? "Unlock" : "Lock"}">${icon(l.locked ? "lock" : "unlock")}</button>
          <button type="button" class="st-mini-btn${!l.visible ? " is-off" : ""}" data-layer-act="vis" aria-label="${l.visible ? "Hide" : "Show"} layer" data-tip="${l.visible ? "Hide" : "Show"}">${icon(l.visible ? "eye" : "eyeOff")}</button>
          <button type="button" class="st-mini-btn is-danger" data-layer-act="del" aria-label="Delete layer" data-tip="Delete">${icon("trash")}</button>
        </div>`;
      row.querySelector(".st-layer-name").textContent = l.name || l.type;
      frag.appendChild(row);
    }
  }

  const baseRow = document.createElement("div");
  baseRow.className = "st-layer-row is-base";
  baseRow.innerHTML = `
    <div class="st-layer-pick">
      <span class="st-layer-glyph">${icon("frame")}</span>
      <span class="st-layer-name">Base Canvas (${doc.baseImages.length ? `${doc.baseImages.length} image${doc.baseImages.length === 1 ? "" : "s"}` : doc.blankSize ? "Blank" : "Empty"})</span>
    </div>`;
  frag.appendChild(baseRow);
  list.replaceChildren(frag);

  const propsEl = qs("#st-layer-props");
  const sel = doc.selectedLayerId ? findLayer(doc, doc.selectedLayerId) : null;
  if (propsEl) {
    propsEl.hidden = !sel;
    if (sel) {
      qs("#st-lp-name").value = sel.name || "";
      const opPct = Math.round((sel.opacity ?? 1) * 100);
      qs("#st-lp-opacity").value = String(opPct);
      qs("#st-lp-opacity-out").textContent = `${opPct}%`;
      qs("#st-lp-blend").value = sel.blendMode || "source-over";

      const isImg = sel.type === "image";
      qs("#st-lp-image-only").hidden = !isImg;
      if (isImg) {
        qs("#st-lp-rot").value = String(sel.rotation || 0);
        qs("#st-lp-rot-out").textContent = `${sel.rotation || 0}°`;
        qs("#st-lp-radius").value = String(sel.radius || 0);
        qs("#st-lp-radius-out").textContent = `${sel.radius || 0}px`;
        qs("#st-lp-shadow").value = String(sel.shadow || 0);
        qs("#st-lp-shadow-out").textContent = `${sel.shadow || 0}%`;
      }
    }
  }
}

function syncInspector() {
  if (!mounted) return;
  syncDrawers();
  syncFramePane();
  syncFiltersPane();
  syncLayersPane();
  syncStyleBar();
  syncClearButton();
}

// ─── Popovers (Style / Add Image / Wing Device / Export) ─────────────

function closeAllPopovers() {
  ui.activePopover = null;
  qsa(".lg-pop").forEach((p) => {
    p.hidden = true;
  });
  qsa("[data-pop-trigger]").forEach((b) => {
    b.setAttribute("aria-expanded", "false");
    b.classList.remove("is-pop-open");
  });
}

function togglePopover(name, triggerBtn) {
  const wasOpen = ui.activePopover === name;
  closeAllPopovers();
  if (wasOpen) return;
  const pop = qs(`.lg-pop[data-pop="${name}"]`);
  if (!pop) return;
  ui.activePopover = name;
  pop.hidden = false;
  triggerBtn?.setAttribute("aria-expanded", "true");
  triggerBtn?.classList.add("is-pop-open");
  if (name === "style") syncStyleBar();
}

function triggerFilePicker(mode = "open") {
  pendingFileMode = mode;
  if (fileInputEl) {
    fileInputEl.value = "";
    fileInputEl.click();
  }
}

// ─── In-Overlay Liquid Glass Gallery Picker Modal ─────────────────────

function cleanupPickerUrls() {
  for (const url of pickerState.urls.values()) URL.revokeObjectURL(url);
  pickerState.urls.clear();
}

function closeGalleryPicker() {
  if (!pickerModalEl) return;
  pickerState.open = false;
  pickerModalEl.classList.remove("is-open");
  pickerModalEl.setAttribute("aria-hidden", "true");
  setTimeout(() => {
    if (!pickerState.open) {
      pickerModalEl.hidden = true;
      cleanupPickerUrls();
    }
  }, 220);
}

function syncPickerModeUI() {
  if (!pickerModalEl) return;
  const hasDoc = hasWorkspaceContent();
  pickerModalEl.querySelectorAll("[data-gp-mode]").forEach((b) => {
    const mode = b.dataset.gpMode;
    b.disabled = !hasDoc && mode !== "open";
    b.classList.toggle("is-active", mode === pickerState.mode);
    b.setAttribute("aria-pressed", String(mode === pickerState.mode));
  });
  const titles = {
    open: ["Choose from Swift Gallery", "Pick a capture to annotate, or select multiple to stitch side by side."],
    stitch: ["Stitch from Swift Gallery", "Combine captures alongside your current canvas."],
    layer: ["Add Image Layer from Gallery", "Place captures on top as movable, resizable layers."],
  };
  const [title, sub] = titles[pickerState.mode] || titles.open;
  pickerModalEl.querySelector("#st-gp-title").textContent = title;
  pickerModalEl.querySelector("#st-gp-sub").textContent = sub;
}

function renderPickerGrid() {
  if (!pickerModalEl) return;
  const grid = pickerModalEl.querySelector("#st-gp-grid");
  const empty = pickerModalEl.querySelector("#st-gp-empty");
  const q = pickerState.query.trim().toLowerCase();

  const filtered = pickerState.records.filter((r) => {
    if (r.deletedAt) return false;
    if (pickerState.filter === "favorites" && !r.favorite) return false;
    if (pickerState.filter === "recent" && !isRecent(r)) return false;
    if (q) {
      const hay = `${r.title || ""} ${r.url || ""} ${r.type || ""}`.toLowerCase();
      if (!q.split(/\s+/).every((t) => hay.includes(t))) return false;
    }
    return true;
  });

  grid.hidden = filtered.length === 0;
  empty.hidden = filtered.length !== 0;

  const frag = document.createDocumentFragment();
  for (const r of filtered) {
    let url = pickerState.urls.get(r.id);
    if (!url) {
      url = URL.createObjectURL(r.thumb || r.blob);
      pickerState.urls.set(r.id, url);
    }
    const card = document.createElement("button");
    card.type = "button";
    card.className = `st-gp-card${pickerState.selected.has(r.id) ? " is-selected" : ""}`;
    card.dataset.id = String(r.id);
    card.setAttribute("aria-pressed", String(pickerState.selected.has(r.id)));
    card.innerHTML = `
      <span class="st-gp-thumb">
        <img src="${url}" alt="" loading="lazy" />
        <span class="st-gp-check">${icon("check")}</span>
      </span>
      <span class="st-gp-meta">
        <b></b>
        <small>${r.width && r.height ? `${formatNumber(r.width)} × ${formatNumber(r.height)}` : (r.format || "IMG").toUpperCase()}</small>
      </span>`;
    card.querySelector("b").textContent = r.title || "Capture";
    frag.appendChild(card);
  }
  grid.replaceChildren(frag);

  const count = pickerState.selected.size;
  const confirmBtn = pickerModalEl.querySelector("#st-gp-confirm");
  const countTxt = pickerModalEl.querySelector("#st-gp-count");
  confirmBtn.disabled = count === 0;
  const verb =
    pickerState.mode === "stitch"
      ? count > 1
        ? `Stitch ${count} Images`
        : "Stitch Image"
      : pickerState.mode === "layer"
        ? count > 1
          ? `Add ${count} Layers`
          : "Add as Layer"
        : count > 1
          ? `Open & Stitch (${count})`
          : "Open in Annotate";
  confirmBtn.textContent = verb;
  countTxt.textContent = count ? `${count} selected` : "Select one or more captures";
}

async function openGalleryPicker(mode = "open") {
  closeAllPopovers();
  if (!pickerModalEl) buildGalleryPickerModal();
  pickerState.mode = !hasWorkspaceContent() ? "open" : mode;
  pickerState.filter = "all";
  pickerState.query = "";
  pickerState.selected.clear();
  cleanupPickerUrls();

  syncPickerModeUI();
  pickerModalEl.querySelector("#st-gp-search").value = "";
  pickerModalEl.querySelectorAll("[data-gp-filter]").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.gpFilter === "all");
  });

  try {
    pickerState.records = await listCaptures();
  } catch {
    pickerState.records = [];
  }

  pickerModalEl.hidden = false;
  pickerState.open = true;
  renderPickerGrid();
  requestAnimationFrame(() => {
    pickerModalEl.classList.add("is-open");
    pickerModalEl.setAttribute("aria-hidden", "false");
    pickerModalEl.querySelector("#st-gp-search").focus();
  });
}

function buildGalleryPickerModal() {
  pickerModalEl = document.createElement("div");
  pickerModalEl.className = "st-gp-backdrop";
  pickerModalEl.id = "st-gallery-picker";
  pickerModalEl.hidden = true;
  pickerModalEl.setAttribute("aria-hidden", "true");
  pickerModalEl.innerHTML = `
    <div class="st-gp-dialog lg-glass-surface" role="dialog" aria-modal="true" aria-labelledby="st-gp-title">
      <div class="st-gp-head">
        <div>
          <h2 id="st-gp-title">Choose from Swift Gallery</h2>
          <p id="st-gp-sub"></p>
        </div>
        <button type="button" class="lg-orb lg-orb-sm" id="st-gp-close" aria-label="Close gallery picker">${icon("close")}</button>
      </div>
      <div class="st-gp-toolbar">
        <label class="st-gp-search-wrap">
          ${icon("search")}
          <input type="search" class="input" id="st-gp-search" placeholder="Search captures…" autocomplete="off" />
        </label>
        <div class="st-gp-filters" role="group" aria-label="Filter captures">
          <button type="button" class="chip is-active" data-gp-filter="all">All</button>
          <button type="button" class="chip" data-gp-filter="favorites">Favorites</button>
          <button type="button" class="chip" data-gp-filter="recent">Recent</button>
        </div>
      </div>
      <div class="st-gp-body">
        <div class="st-gp-grid" id="st-gp-grid"></div>
        <div class="st-gp-empty" id="st-gp-empty" hidden>
          ${icon("gallery")}
          <b>No matching captures in Gallery</b>
          <span>Take a screenshot or add an image from your device instead.</span>
          <button type="button" class="btn btn-primary" id="st-gp-fallback-device">${icon("upload")}<span>Add from Device</span></button>
        </div>
      </div>
      <div class="st-gp-foot">
        <div class="st-gp-mode-seg" role="group" aria-label="Import mode">
          <button type="button" class="st-chip-btn is-active" data-gp-mode="open" aria-pressed="true">Open</button>
          <button type="button" class="st-chip-btn" data-gp-mode="stitch" aria-pressed="false">Stitch</button>
          <button type="button" class="st-chip-btn" data-gp-mode="layer" aria-pressed="false">Add Layer</button>
        </div>
        <div class="st-gp-foot-right">
          <span class="st-gp-count" id="st-gp-count"></span>
          <div class="st-gp-foot-acts">
            <button type="button" class="btn" id="st-gp-cancel">Cancel</button>
            <button type="button" class="btn btn-primary" id="st-gp-confirm" disabled>Open in Annotate</button>
          </div>
        </div>
      </div>
    </div>`;

  pickerModalEl.addEventListener("pointerdown", (e) => {
    if (e.target === pickerModalEl) closeGalleryPicker();
  });
  pickerModalEl.querySelector("#st-gp-close").addEventListener("click", closeGalleryPicker);
  pickerModalEl.querySelector("#st-gp-cancel").addEventListener("click", closeGalleryPicker);
  pickerModalEl.querySelector("#st-gp-search").addEventListener("input", (e) => {
    pickerState.query = e.target.value;
    renderPickerGrid();
  });
  pickerModalEl.querySelectorAll("[data-gp-filter]").forEach((b) => {
    b.addEventListener("click", () => {
      pickerState.filter = b.dataset.gpFilter;
      pickerModalEl.querySelectorAll("[data-gp-filter]").forEach((x) => x.classList.toggle("is-active", x === b));
      renderPickerGrid();
    });
  });
  pickerModalEl.querySelectorAll("[data-gp-mode]").forEach((b) => {
    b.addEventListener("click", () => {
      if (b.disabled) return;
      pickerState.mode = b.dataset.gpMode;
      syncPickerModeUI();
      renderPickerGrid();
    });
  });
  pickerModalEl.querySelector("#st-gp-grid").addEventListener("click", (e) => {
    const card = e.target.closest(".st-gp-card");
    if (!card) return;
    const id = Number(card.dataset.id);
    if (pickerState.selected.has(id)) pickerState.selected.delete(id);
    else pickerState.selected.add(id);
    renderPickerGrid();
  });
  pickerModalEl.querySelector("#st-gp-grid").addEventListener("dblclick", async (e) => {
    const card = e.target.closest(".st-gp-card");
    if (!card) return;
    const id = Number(card.dataset.id);
    const mode = pickerState.mode;
    closeGalleryPicker();
    await openStudioWithCaptures([id], mode);
  });
  pickerModalEl.querySelector("#st-gp-confirm").addEventListener("click", async () => {
    const ids = [...pickerState.selected];
    const mode = pickerState.mode;
    closeGalleryPicker();
    if (ids.length) await openStudioWithCaptures(ids, mode);
  });
  pickerModalEl.querySelector("#st-gp-fallback-device").addEventListener("click", () => {
    const mode = pickerState.mode;
    closeGalleryPicker();
    triggerFilePicker(mode);
  });

  document.body.appendChild(pickerModalEl);
}

// ─── DOM Scaffolding (Authentic Liquid Glass Floating Bar + Wings) ────

function buildStudioMarkup() {
  const toolOrbsHtml = TOOLS.map(
    (t) => `
      <button type="button" class="lg-orb${t.id === ui.tool ? " is-active" : ""}" data-tool="${t.id}" aria-label="${t.label}" aria-pressed="${t.id === ui.tool}" data-tip="${t.label} · ${t.key}" data-tip-pos="bottom">
        <i data-icon="${t.icon}"></i>
      </button>`,
  ).join("");

  const paletteHtml = TOOL_PALETTE.map(
    (hex) => `<button type="button" class="st-swatch" data-color="${hex}" style="--sw:${hex}" aria-label="Color ${hex}"></button>`,
  ).join("");

  const bgSwatchesHtml = BACKGROUNDS.map(
    (b) => `
      <button type="button" class="st-bg-swatch${b.kind === "transparent" ? " is-transparent" : ""}" data-bg-id="${b.id}" title="${b.name}" aria-label="${b.name}" style="${b.kind !== "transparent" ? `background:${b.preview}` : ""}"></button>`,
  ).join("");

  const winFrameHtml = WINDOW_FRAMES.map(
    (w) => `
      <button type="button" class="st-win-card" data-win-style="${w.id}" aria-pressed="false">
        <span class="st-win-prev is-${w.id}" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>${w.label}</span>
      </button>`,
  ).join("");

  const aspectHtml = ASPECT_RATIOS.map(
    (a) => `<button type="button" class="st-chip-btn" data-aspect="${a.id}" aria-pressed="false">${a.label}</button>`,
  ).join("");

  const filterPresetHtml = FILTER_PRESETS.map(
    (p) => `
      <button type="button" class="st-filter-card" data-filter-preset="${p.id}" aria-pressed="false">
        <span class="st-filter-swatch" style="background:${p.swatch}" aria-hidden="true"></span>
        <span>${p.name}</span>
      </button>`,
  ).join("");

  const templateCardsHtml = TEMPLATES.map(
    (t) => `
      <button type="button" class="st-tpl-card" data-template-id="${t.id}">
        <span class="st-tpl-prev${t.previewBg === "transparent" ? " is-checker" : ""}" style="${t.previewBg !== "transparent" ? `background:${t.previewBg}` : ""}" aria-hidden="true">
          <span class="st-tpl-card-inner is-${t.chrome}" style="background:${t.previewCard}">
            ${t.chrome === "macos-dark" || t.chrome === "macos-light" || t.chrome === "browser" ? `<span class="st-tpl-dots"><i></i><i></i><i></i></span>` : ""}
          </span>
        </span>
        <span class="st-tpl-meta">
          <b>${t.name}</b>
          <small>${t.subtitle}</small>
        </span>
      </button>`,
  ).join("");

  const exportListHtml = EXPORT_FORMATS.map(
    (f) => `
      <button type="button" class="lg-pop-item" data-export-fmt="${f.id}">
        <b>${f.label}</b>
        <small>${f.desc}</small>
      </button>`,
  ).join("");

  return `
    <input type="file" id="st-file-input" accept="image/png,image/jpeg,image/webp,image/avif,image/gif,image/svg+xml,image/bmp,.png,.jpg,.jpeg,.webp,.gif,.svg,.bmp,.avif" multiple hidden />

    <div class="lg-workspace" id="st-shell">
      <!-- 1. TOP FLOATING LIQUID GLASS ANNOTATE BAR (Authentic SwiftSelect Capsule) -->
      <header class="lg-bar lg-glass-capsule" role="toolbar" aria-label="Annotate toolbar">
        <span class="lg-grip" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>

        <div class="lg-group" role="group" aria-label="Drawing tools">
          ${toolOrbsHtml}
        </div>

        <span class="lg-sep" aria-hidden="true"></span>

        <!-- Signature Compact Color+Stroke Tune Pill + Liquid Glass Style Popover -->
        <div class="st-pop-wrap">
          <button type="button" class="lg-tune-pill" id="st-tune-btn" data-pop-trigger="style" aria-expanded="false" aria-label="Color, stroke & text options" data-tip="Color &amp; Stroke" data-tip-pos="bottom">
            <span class="lg-tune-ring" id="st-tune-ring" style="--tune-color:${ui.color}"></span>
            <span class="lg-tune-lines" aria-hidden="true"><i></i><i></i><i></i></span>
            <i data-icon="chevron" class="lg-tune-caret"></i>
          </button>

          <div class="lg-pop lg-style-pop lg-glass-surface" id="st-style-pop" data-pop="style" hidden>
            <div class="lg-pop-sec" id="st-grp-color">
              <span class="lg-pop-lbl">Color</span>
              <div class="lg-swatch-row">
                ${paletteHtml}
                <label class="st-color-wheel" title="Custom color">
                  <input type="color" id="st-style-color" value="#FF3333" aria-label="Custom color" />
                </label>
              </div>
            </div>

            <div class="lg-pop-sec">
              <div class="st-slider-row">
                <span>Stroke</span>
                <input type="range" class="range" id="st-style-width" min="2" max="24" step="1" value="5" aria-label="Stroke width" />
                <output class="st-num" id="st-style-width-out">5px</output>
              </div>
              <div class="st-slider-row">
                <span>Opacity</span>
                <input type="range" class="range" id="st-style-opacity" min="15" max="100" step="5" value="100" aria-label="Stroke opacity" />
                <output class="st-num" id="st-style-opacity-out">100%</output>
              </div>
            </div>

            <div class="lg-pop-sec lg-pop-row" id="st-grp-fill" hidden>
              <span class="lg-pop-lbl">Style</span>
              <button type="button" class="st-chip-btn" id="st-style-fill" aria-pressed="false">Outline</button>
            </div>

            <div class="lg-pop-sec lg-pop-row" id="st-grp-dash">
              <span class="lg-pop-lbl">Line</span>
              <div class="st-seg-row">
                <button type="button" class="st-chip-btn is-active" data-dash="solid">Solid</button>
                <button type="button" class="st-chip-btn" data-dash="dashed">Dash</button>
                <button type="button" class="st-chip-btn" data-dash="dotted">Dot</button>
              </div>
            </div>

            <div class="lg-pop-sec lg-pop-row" id="st-grp-arrow" hidden>
              <span class="lg-pop-lbl">Heads</span>
              <div class="st-seg-row">
                <button type="button" class="st-chip-btn is-active" data-arrow-head="end">→</button>
                <button type="button" class="st-chip-btn" data-arrow-head="both">↔</button>
                <button type="button" class="st-chip-btn" data-arrow-head="none">—</button>
              </div>
            </div>

            <div class="lg-pop-sec" id="st-grp-text" hidden>
              <div class="lg-pop-row">
                <select class="st-select" id="st-style-font" aria-label="Font family">
                  <option value="sans">Sans</option>
                  <option value="serif">Serif</option>
                  <option value="mono">Mono</option>
                  <option value="hand">Script</option>
                </select>
                <div class="st-seg-row">
                  <button type="button" class="st-chip-btn is-active" id="st-style-bold" aria-label="Bold"><b>B</b></button>
                  <button type="button" class="st-chip-btn" id="st-style-italic" aria-label="Italic"><i>I</i></button>
                </div>
              </div>
              <div class="st-slider-row">
                <span>Font Size</span>
                <input type="range" class="range" id="st-style-fontsize" min="14" max="72" step="2" value="28" aria-label="Font size" />
                <output class="st-num" id="st-style-fontsize-out">28px</output>
              </div>
            </div>
          </div>
        </div>

        <span class="lg-sep" aria-hidden="true"></span>

        <!-- History & Delete -->
        <div class="lg-group" role="group" aria-label="History">
          <button type="button" class="lg-orb" id="st-undo" disabled aria-label="Undo" data-tip="Undo · Ctrl Z" data-tip-pos="bottom"><i data-icon="undo"></i></button>
          <button type="button" class="lg-orb" id="st-redo" disabled aria-label="Redo" data-tip="Redo · Ctrl Y" data-tip-pos="bottom"><i data-icon="redo"></i></button>
          <button type="button" class="lg-orb" id="st-clear-btn" disabled aria-label="Clear annotations" data-tip="Clear all annotations" data-tip-pos="bottom"><i data-icon="trash"></i></button>
        </div>

        <span class="lg-sep" aria-hidden="true"></span>

        <!-- Output & Close Orbs -->
        <div class="lg-group" role="group" aria-label="Actions">
          <div class="st-pop-wrap">
            <button type="button" class="lg-orb" id="st-add-image-btn" data-pop-trigger="add-image" aria-expanded="false" aria-label="Add image from device or gallery" data-tip="Add Image (Device / Gallery)" data-tip-pos="bottom">
              <i data-icon="image"></i>
            </button>
            <div class="lg-pop lg-pop-right lg-glass-surface" data-pop="add-image" hidden>
              <div class="lg-pop-head">From Device</div>
              <button type="button" class="lg-pop-item" data-source="device" data-mode="open"><b>Open Local File(s)</b><small>Replace canvas (2+ auto-stitch)</small></button>
              <button type="button" class="lg-pop-item" data-source="device" data-mode="stitch" data-need-doc><b>Stitch Local Image</b><small>Place side-by-side or grid</small></button>
              <button type="button" class="lg-pop-item" data-source="device" data-mode="layer" data-need-doc><b>Add Local Layer</b><small>Movable &amp; resizable overlay</small></button>
              <div class="lg-pop-sep"></div>
              <div class="lg-pop-head">From Swift Gallery</div>
              <button type="button" class="lg-pop-item" data-source="gallery" data-mode="open"><b>Open from Gallery</b><small>Edit 1 or stitch multiple</small></button>
              <button type="button" class="lg-pop-item" data-source="gallery" data-mode="layer" data-need-doc><b>Add Gallery Layer</b><small>Overlay a saved capture</small></button>
            </div>
          </div>

          <button type="button" class="lg-orb" id="st-copy" data-need-doc aria-label="Copy to clipboard" data-tip="Copy PNG · Ctrl C" data-tip-pos="bottom"><i data-icon="copy"></i></button>

          <div class="st-pop-wrap lg-export-split">
            <button type="button" class="lg-orb" id="st-export-btn" data-need-doc aria-label="Download image" data-tip="Download PNG · Ctrl S" data-tip-pos="bottom"><i data-icon="download"></i></button>
            <button type="button" class="lg-orb-caret" id="st-export-menu-btn" data-need-doc data-pop-trigger="export" aria-expanded="false" aria-label="Export format"><i data-icon="chevron"></i></button>
            <div class="lg-pop lg-pop-right lg-glass-surface" data-pop="export" hidden>
              <div class="lg-pop-head">Download Format</div>
              ${exportListHtml}
              <div class="lg-pop-sep"></div>
              <button type="button" class="lg-pop-item" id="st-share-btn"><b>Share…</b><small>System share sheet</small></button>
            </div>
          </div>

          <button type="button" class="lg-orb" id="st-save" data-need-doc aria-label="Save to Swift Gallery" data-tip="Save to Gallery · Ctrl G" data-tip-pos="bottom"><i data-icon="gallery"></i></button>
          <button type="button" class="lg-orb lg-orb-close" id="st-close" aria-label="Close Annotate" data-tip="Close · Esc" data-tip-pos="bottom"><i data-icon="close"></i></button>
        </div>
      </header>

      <!-- 2. LEFT FLOATING LIQUID GLASS WING (Layers · Add from Device · Add from Gallery) -->
      <aside class="lg-wing lg-wing-left lg-glass-capsule" aria-label="Layers and image sources">
        <button type="button" class="lg-orb" data-left-drawer="layers" aria-label="Layers" aria-pressed="false" data-tip="Layers" data-tip-pos="right">
          <i data-icon="layers"></i>
          <span class="lg-orb-badge" id="st-layer-badge" hidden>0</span>
        </button>

        <span class="lg-wing-sep" aria-hidden="true"></span>

        <div class="st-pop-wrap">
          <button type="button" class="lg-orb" id="st-wing-device" data-pop-trigger="wing-device" aria-expanded="false" aria-label="Add image from device" data-tip="Add from Device" data-tip-pos="right">
            <i data-icon="upload"></i>
          </button>
          <div class="lg-pop lg-pop-wing-left lg-glass-surface" data-pop="wing-device" hidden>
            <div class="lg-pop-head">Add from Device</div>
            <button type="button" class="lg-pop-item" data-source="device" data-mode="open"><b>Open Image(s)</b><small>Replace canvas (2+ auto-stitch)</small></button>
            <button type="button" class="lg-pop-item" data-source="device" data-mode="stitch" data-need-doc><b>Stitch Alongside</b><small>Join next to current image</small></button>
            <button type="button" class="lg-pop-item" data-source="device" data-mode="layer" data-need-doc><b>Add as Layer</b><small>Movable &amp; resizable overlay</small></button>
          </div>
        </div>

        <button type="button" class="lg-orb" id="st-wing-gallery" aria-label="Add image from Swift Gallery" data-tip="Add from Gallery" data-tip-pos="right">
          <i data-icon="gallery"></i>
        </button>
      </aside>

      <!-- Floating Collapsible Left Liquid Glass Drawer (Layers) -->
      <aside class="lg-drawer lg-drawer-left lg-glass-surface" id="st-drawer-left" aria-label="Layers drawer" hidden>
        <div class="lg-drawer-head">
          <div class="lg-drawer-title">
            <i data-icon="layers"></i>
            <b>Layers</b>
            <span class="lg-drawer-sub" id="st-layer-count">0 layers</span>
          </div>
          <button type="button" class="lg-orb lg-orb-sm" id="st-close-left-drawer" aria-label="Close Layers"><i data-icon="close"></i></button>
        </div>

        <div class="lg-drawer-scroll">
          <div class="st-sec">
            <div class="st-layer-add-row">
              <button type="button" class="st-xs-btn" id="st-add-layer-device" data-need-doc>+ Device</button>
              <button type="button" class="st-xs-btn" id="st-add-layer-gallery" data-need-doc>+ Gallery</button>
              <button type="button" class="st-xs-btn" id="st-add-layer-text" data-need-doc>+ Text</button>
            </div>
            <div class="st-layer-list" id="st-layer-list"></div>
          </div>

          <div class="st-sec st-layer-props" id="st-layer-props" hidden>
            <div class="st-sec-head"><b>Selected Layer</b></div>
            <input type="text" class="input st-sm-input" id="st-lp-name" placeholder="Layer name" aria-label="Layer name" />
            <div class="st-slider-row">
              <span>Opacity</span>
              <input type="range" class="range" id="st-lp-opacity" min="5" max="100" step="1" value="100" aria-label="Layer opacity" />
              <output class="st-num" id="st-lp-opacity-out">100%</output>
            </div>
            <div class="st-inline-opts">
              <span>Blend</span>
              <select class="st-select" id="st-lp-blend" aria-label="Blend mode">
                <option value="source-over">Normal</option>
                <option value="multiply">Multiply</option>
                <option value="screen">Screen</option>
                <option value="overlay">Overlay</option>
              </select>
            </div>
            <div id="st-lp-image-only" hidden>
              <div class="st-slider-row">
                <span>Rotate</span>
                <input type="range" class="range" id="st-lp-rot" min="-180" max="180" step="1" value="0" aria-label="Layer rotation" />
                <output class="st-num" id="st-lp-rot-out">0°</output>
              </div>
              <div class="st-slider-row">
                <span>Corners</span>
                <input type="range" class="range" id="st-lp-radius" min="0" max="80" step="1" value="12" aria-label="Layer corner radius" />
                <output class="st-num" id="st-lp-radius-out">12px</output>
              </div>
              <div class="st-slider-row">
                <span>Shadow</span>
                <input type="range" class="range" id="st-lp-shadow" min="0" max="100" step="1" value="30" aria-label="Layer shadow" />
                <output class="st-num" id="st-lp-shadow-out">30%</output>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- 3. RIGHT FLOATING LIQUID GLASS WING (Frame & Beautify · Filters · Templates) -->
      <aside class="lg-wing lg-wing-right lg-glass-capsule" aria-label="Creative studio tools">
        <button type="button" class="lg-orb" data-right-drawer="frame" aria-label="Frame & Beautify" aria-pressed="false" data-tip="Frame &amp; Beautify" data-tip-pos="left">
          <i data-icon="frame"></i>
        </button>
        <button type="button" class="lg-orb" data-right-drawer="filters" aria-label="Filters & Adjust" aria-pressed="false" data-tip="Filters &amp; Adjust" data-tip-pos="left">
          <i data-icon="sliders"></i>
        </button>
        <button type="button" class="lg-orb" data-right-drawer="templates" aria-label="Templates" aria-pressed="false" data-tip="Templates" data-tip-pos="left">
          <i data-icon="template"></i>
        </button>
      </aside>

      <!-- Floating Collapsible Right Liquid Glass Drawer (Frame / Filters / Templates) -->
      <aside class="lg-drawer lg-drawer-right lg-glass-surface" id="st-drawer-right" aria-label="Creative properties" hidden>
        <div class="lg-drawer-head">
          <div class="lg-drawer-title">
            <b id="st-right-drawer-title">Frame &amp; Beautify</b>
          </div>
          <button type="button" class="lg-orb lg-orb-sm" id="st-close-right-drawer" aria-label="Close panel"><i data-icon="close"></i></button>
        </div>

        <div class="lg-drawer-scroll">
          <!-- PANE 1: FRAME & BEAUTIFY -->
          <div class="st-pane" data-pane="frame">
            <div class="st-sec">
              <div class="st-sec-head">
                <b>Canvas Images</b>
                <div class="st-sec-acts">
                  <button type="button" class="st-xs-btn" id="st-stitch-device" title="Stitch image from device">+ Device</button>
                  <button type="button" class="st-xs-btn" id="st-stitch-gallery" title="Stitch image from gallery">+ Gallery</button>
                </div>
              </div>
              <div class="st-base-list" id="st-base-list"></div>
              <div class="st-stitch-controls" id="st-stitch-controls" hidden>
                <div class="st-seg-row">
                  ${STITCH_LAYOUTS.map((l) => `<button type="button" class="st-chip-btn" data-stitch-layout="${l.id}">${l.label}</button>`).join("")}
                </div>
                <div class="st-slider-row">
                  <span>Gap</span>
                  <input type="range" class="range" id="st-stitch-gap" min="0" max="6" step="0.2" value="0.4" aria-label="Stitch gap" />
                  <output class="st-num" id="st-stitch-gap-out">0.4%</output>
                </div>
                <div class="st-switch-row">
                  <span>Hairline divider</span>
                  <button type="button" class="switch" role="switch" id="st-stitch-divider" aria-checked="true" aria-label="Show hairline divider between stitched images"></button>
                </div>
              </div>
            </div>

            <div class="st-sec">
              <div class="st-sec-head"><b>Window &amp; Device Chrome</b></div>
              <div class="st-win-grid">${winFrameHtml}</div>
              <div class="st-win-title-wrap" id="st-win-title-wrap" hidden>
                <input type="text" class="input st-sm-input" id="st-win-title" placeholder="Window title or URL…" spellcheck="false" aria-label="Window bar title" />
              </div>
            </div>

            <div class="st-sec">
              <div class="st-sec-head">
                <b>Backdrop</b>
                <div class="st-mini-seg">
                  <button type="button" class="st-xs-btn is-active" data-bg-mode="preset">Presets</button>
                  <button type="button" class="st-xs-btn" data-bg-mode="solid">Solid</button>
                  <button type="button" class="st-xs-btn" data-bg-mode="linear">Gradient</button>
                </div>
              </div>
              <div class="st-bg-grid" id="st-bg-grid">${bgSwatchesHtml}</div>
              <div class="st-bg-custom" id="st-bg-custom" hidden>
                <div class="st-custom-colors">
                  <label><span>Color 1</span><input type="color" id="st-bg-c1" value="#3b82f6" /></label>
                  <label id="st-bg-grad-only"><span>Color 2</span><input type="color" id="st-bg-c2" value="#8b5cf6" /></label>
                </div>
                <div class="st-slider-row" id="st-bg-angle-row">
                  <span>Angle</span>
                  <input type="range" class="range" id="st-bg-angle" min="0" max="360" step="5" value="135" aria-label="Gradient angle" />
                  <output class="st-num" id="st-bg-angle-out">135°</output>
                </div>
              </div>
              <div class="st-inline-opts">
                <span>Pattern</span>
                <div class="st-seg-row">
                  ${PATTERN_OVERLAYS.map((p) => `<button type="button" class="st-chip-btn" data-pattern="${p.id}">${p.label}</button>`).join("")}
                </div>
              </div>
            </div>

            <div class="st-sec">
              <div class="st-sec-head"><b>Aspect Ratio</b></div>
              <div class="st-ratio-grid">${aspectHtml}</div>
            </div>

            <div class="st-sec">
              <div class="st-sec-head"><b>Geometry &amp; Depth</b></div>
              <div class="st-slider-row">
                <span>Padding</span>
                <input type="range" class="range" id="st-padding" min="0" max="24" step="0.5" value="4.5" aria-label="Frame padding" />
                <output class="st-num" id="st-padding-out">4.5%</output>
              </div>
              <div class="st-slider-row">
                <span>Corners</span>
                <input type="range" class="range" id="st-radius" min="0" max="14" step="0.5" value="4.2" aria-label="Corner radius" />
                <output class="st-num" id="st-radius-out">4.2%</output>
              </div>
              <div class="st-slider-row">
                <span>Shadow</span>
                <input type="range" class="range" id="st-shadow" min="0" max="100" step="1" value="35" aria-label="Drop shadow" />
                <output class="st-num" id="st-shadow-out">35%</output>
              </div>
              <div class="st-slider-row">
                <span>Border</span>
                <input type="range" class="range" id="st-border" min="0" max="3" step="1" value="1" aria-label="Border width" />
                <output class="st-num" id="st-border-out">1px</output>
              </div>
            </div>
          </div>

          <!-- PANE 2: FILTERS & ADJUST -->
          <div class="st-pane" data-pane="filters" hidden>
            <div class="st-filter-target" id="st-filter-target"></div>

            <div class="st-sec" id="st-transform-card">
              <div class="st-sec-head"><b>Transform</b></div>
              <div class="st-transform-row">
                <button type="button" class="btn" id="st-rot-ccw" data-need-doc title="Rotate 90° counter-clockwise"><i data-icon="rotateCcw"></i><span>-90°</span></button>
                <button type="button" class="btn" id="st-rot-cw" data-need-doc title="Rotate 90° clockwise"><i data-icon="rotateCw"></i><span>+90°</span></button>
                <button type="button" class="btn btn-icon" id="st-flip-h" data-need-doc aria-label="Flip horizontal" data-tip="Flip horizontal"><i data-icon="flipH"></i></button>
                <button type="button" class="btn btn-icon" id="st-flip-v" data-need-doc aria-label="Flip vertical" data-tip="Flip vertical"><i data-icon="flipV"></i></button>
              </div>
            </div>

            <div class="st-sec">
              <div class="st-sec-head">
                <b>Filter Presets</b>
                <button type="button" class="st-xs-btn" id="st-filter-reset">Reset</button>
              </div>
              <div class="st-filter-grid">${filterPresetHtml}</div>
            </div>

            <div class="st-sec">
              <div class="st-sec-head"><b>Fine-Tune</b></div>
              <div class="st-slider-row"><span>Brightness</span><input type="range" class="range" id="st-f-brightness" data-fkey="brightness" min="50" max="150" step="1" value="100" /><output class="st-num" id="st-f-brightness-out">100%</output></div>
              <div class="st-slider-row"><span>Contrast</span><input type="range" class="range" id="st-f-contrast" data-fkey="contrast" min="50" max="150" step="1" value="100" /><output class="st-num" id="st-f-contrast-out">100%</output></div>
              <div class="st-slider-row"><span>Saturation</span><input type="range" class="range" id="st-f-saturation" data-fkey="saturation" min="0" max="200" step="1" value="100" /><output class="st-num" id="st-f-saturation-out">100%</output></div>
              <div class="st-slider-row"><span>Warmth</span><input type="range" class="range" id="st-f-warmth" data-fkey="warmth" min="0" max="100" step="1" value="0" /><output class="st-num" id="st-f-warmth-out">0%</output></div>
              <div class="st-slider-row"><span>Hue</span><input type="range" class="range" id="st-f-hue" data-fkey="hue" min="-180" max="180" step="2" value="0" /><output class="st-num" id="st-f-hue-out">0°</output></div>
              <div class="st-slider-row"><span>Grayscale</span><input type="range" class="range" id="st-f-grayscale" data-fkey="grayscale" min="0" max="100" step="1" value="0" /><output class="st-num" id="st-f-grayscale-out">0%</output></div>
              <div class="st-slider-row"><span>Soft Blur</span><input type="range" class="range" id="st-f-blur" data-fkey="blur" min="0" max="12" step="0.5" value="0" /><output class="st-num" id="st-f-blur-out">0px</output></div>
              <div class="st-slider-row"><span>Vignette</span><input type="range" class="range" id="st-f-vignette" data-fkey="vignette" min="0" max="100" step="1" value="0" /><output class="st-num" id="st-f-vignette-out">0%</output></div>
              <div class="st-slider-row"><span>Film Grain</span><input type="range" class="range" id="st-f-grain" data-fkey="grain" min="0" max="50" step="1" value="0" /><output class="st-num" id="st-f-grain-out">0%</output></div>
            </div>
          </div>

          <!-- PANE 3: CREATIVE TEMPLATES -->
          <div class="st-pane" data-pane="templates" hidden>
            <div class="st-sec">
              <div class="st-sec-head"><b>Studio Templates</b></div>
              <p class="st-pane-note">Applies backdrop, device chrome, aspect ratio, and color grade in one click while keeping all your annotations.</p>
              <div class="st-tpl-grid">${templateCardsHtml}</div>
            </div>
          </div>
        </div>
      </aside>

      <!-- 4. OPEN FULL-VIEWPORT CANVAS STAGE -->
      <section class="lg-stage-wrap" id="st-stage-wrap" aria-label="Annotation canvas">
        <div class="st-drop-veil" id="st-drop-veil" aria-hidden="true">
          <i data-icon="upload"></i>
          <b>Drop images to annotate or stitch</b>
          <span>Hold Shift while dropping to add as an overlay layer</span>
        </div>

        <!-- Centered Liquid Glass Empty Welcome Card -->
        <div class="lg-empty-card lg-glass-surface" id="st-empty">
          <div class="lg-empty-glyph" aria-hidden="true"><i data-icon="annotated"></i></div>
          <h2>Annotate Anything</h2>
          <p>Open any local image from your device or pick from Swift Gallery — add layers, frames, filters, templates, and annotations right here.</p>
          <div class="lg-empty-actions">
            <button type="button" class="btn btn-primary btn-lg" id="st-empty-device">
              <i data-icon="upload"></i><span>Add from Device</span>
            </button>
            <button type="button" class="btn btn-lg" id="st-empty-gallery">
              <i data-icon="gallery"></i><span>Choose from Gallery</span>
            </button>
          </div>
          <div class="lg-empty-blank">
            <span>Or start blank:</span>
            <button type="button" class="chip" data-blank="1600x900">16:9 Slide</button>
            <button type="button" class="chip" data-blank="1080x1080">1:1 Square</button>
            <button type="button" class="chip" data-blank="1200x900">4:3 Canvas</button>
          </div>
          <p class="lg-empty-hint">Drop files anywhere or paste with <kbd class="kbd">Ctrl</kbd><kbd class="kbd">V</kbd> · Select 2+ images to auto-stitch</p>
        </div>

        <!-- Active Open Canvas -->
        <div class="lg-stage" id="st-stage" hidden>
          <div class="lg-canvas-scroll" id="st-canvas-scroll">
            <div class="st-canvas-frame" id="st-canvas-frame">
              <canvas id="st-canvas"></canvas>
            </div>
          </div>
        </div>
      </section>

      <!-- 5. BOTTOM CENTER IRIDESCENT LIQUID GLASS CAPTION PILL -->
      <div class="lg-caption-pill lg-iridescent-pill" id="st-caption-pill" hidden>
        <input type="text" class="lg-title-input" id="st-title" value="Untitled" aria-label="Document title" spellcheck="false" size="12" />
        <span class="lg-dims" id="st-dims"></span>
      </div>

      <!-- Bottom Center Crop Pill (replaces Caption Pill in Crop Mode) -->
      <div class="lg-crop-pill lg-glass-capsule" id="st-crop-bar" hidden>
        <div class="st-crop-ratios">
          ${CROP_PRESETS.map((p) => `<button type="button" class="st-chip-btn" data-crop-aspect="${p.id}">${p.label}</button>`).join("")}
        </div>
        <span class="lg-sep" aria-hidden="true"></span>
        <button type="button" class="btn btn-sm" id="st-crop-cancel">Cancel</button>
        <button type="button" class="btn btn-primary btn-sm" id="st-crop-apply"><i data-icon="check"></i><span>Apply</span></button>
      </div>

      <!-- 6. BOTTOM RIGHT IRIDESCENT LIQUID GLASS ZOOM PILL -->
      <div class="lg-zoom-pill lg-iridescent-pill" id="st-zoom-pill" role="group" aria-label="Canvas zoom" hidden>
        <button type="button" class="lg-zoom-btn" id="st-zoom-out" data-need-doc aria-label="Zoom out">−</button>
        <button type="button" class="lg-zoom-val" id="st-zoom-val" data-need-doc title="Reset zoom to 100%">100%</button>
        <button type="button" class="lg-zoom-btn" id="st-zoom-in" data-need-doc aria-label="Zoom in">+</button>
        <span class="lg-zoom-sep" aria-hidden="true"></span>
        <button type="button" class="lg-zoom-fit" id="st-zoom-fit" data-need-doc aria-label="Fit to screen" data-tip="Fit to screen · 0" data-tip-pos="top"><i data-icon="focus"></i></button>
      </div>
    </div>`;
}

// ─── Event Wiring ─────────────────────────────────────────────────────

function wireStudioEvents() {
  // File input
  fileInputEl.addEventListener("change", async (e) => {
    const files = e.target.files;
    if (files?.length) await openStudioWithFiles(files, pendingFileMode);
  });

  // Popover triggers
  qsa("[data-pop-trigger]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const name = btn.dataset.popTrigger;
      if (!hasWorkspaceContent() && name === "wing-device") {
        triggerFilePicker("open");
        return;
      }
      togglePopover(name, btn);
    });
  });

  document.addEventListener("click", (e) => {
    if (ui.activePopover && !e.target.closest(".st-pop-wrap")) closeAllPopovers();
  });

  // Popover source choices
  qsa("[data-source]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const src = btn.dataset.source;
      const mode = btn.dataset.mode || "open";
      closeAllPopovers();
      if (src === "device") triggerFilePicker(mode);
      else openGalleryPicker(mode);
    });
  });

  // Left & Right Floating Liquid Glass Wing Triggers
  qsa("[data-left-drawer]").forEach((btn) => {
    btn.addEventListener("click", () => toggleLeftDrawer(btn.dataset.leftDrawer));
  });
  qsa("[data-right-drawer]").forEach((btn) => {
    btn.addEventListener("click", () => toggleRightDrawer(btn.dataset.rightDrawer));
  });
  qs("#st-close-left-drawer").addEventListener("click", () => {
    ui.leftDrawer = null;
    syncDrawers();
  });
  qs("#st-close-right-drawer").addEventListener("click", () => {
    ui.rightDrawer = null;
    syncDrawers();
  });
  qs("#st-wing-gallery").addEventListener("click", () => {
    openGalleryPicker(hasWorkspaceContent() ? "layer" : "open");
  });

  // Empty stage buttons
  qs("#st-empty-device").addEventListener("click", () => triggerFilePicker("open"));
  qs("#st-empty-gallery").addEventListener("click", () => openGalleryPicker("open"));
  qsa("[data-blank]").forEach((b) => {
    b.addEventListener("click", () => {
      const [w, h] = b.dataset.blank.split("x").map(Number);
      startBlankCanvas(w, h, `${b.textContent} Canvas`);
    });
  });

  // Topbar actions
  qs("#st-undo").addEventListener("click", undo);
  qs("#st-redo").addEventListener("click", redo);
  qs("#st-clear-btn").addEventListener("click", () => {
    if (!hasWorkspaceContent() || doc.layers.length === 0) return;
    if (doc.selectedLayerId) {
      const sel = findLayer(doc, doc.selectedLayerId);
      if (sel && !sel.locked && removeLayer(doc, sel.id)) {
        commit();
        syncInspector();
        toast("Removed selected layer");
      }
      return;
    }
    doc.layers = [];
    doc.selectedLayerId = null;
    doc.stepCounter = 1;
    commit();
    syncInspector();
    toast("Cleared annotations (Ctrl+Z to undo)");
  });
  qs("#st-close").addEventListener("click", requestCloseStudio);

  // Caption title inline edit
  const titleEl = qs("#st-title");
  titleEl.addEventListener("input", (e) => {
    doc.title = e.target.value;
    e.target.size = clamp((e.target.value || "Untitled").length + 1, 8, 28);
  });

  // Bottom-right zoom pill
  qs("#st-zoom-out").addEventListener("click", () => {
    ui.zoomMode = "manual";
    ui.zoomScale = clamp(ui.zoomScale - 0.15, 0.15, 4);
    renderCanvas();
  });
  qs("#st-zoom-in").addEventListener("click", () => {
    ui.zoomMode = "manual";
    ui.zoomScale = clamp(ui.zoomScale + 0.15, 0.15, 4);
    renderCanvas();
  });
  qs("#st-zoom-val").addEventListener("click", () => {
    ui.zoomMode = "manual";
    ui.zoomScale = 1;
    renderCanvas();
  });
  qs("#st-zoom-fit").addEventListener("click", () => {
    ui.zoomMode = "fit";
    renderCanvas();
  });

  // Copy / Save / Download / Share
  qs("#st-copy").addEventListener("click", copyStudioToClipboard);
  qs("#st-save").addEventListener("click", saveStudioToGallery);
  qs("#st-export-btn").addEventListener("click", () => exportStudio(ui.exportFormat));
  qsa("[data-export-fmt]").forEach((b) => {
    b.addEventListener("click", () => {
      ui.exportFormat = b.dataset.exportFmt;
      qs("#st-export-btn").setAttribute("data-tip", `Download ${ui.exportFormat.toUpperCase()} · Ctrl S`);
      closeAllPopovers();
      exportStudio(ui.exportFormat);
    });
  });
  qs("#st-share-btn").addEventListener("click", () => {
    closeAllPopovers();
    shareStudio();
  });

  // Top bar tool orbs
  qsa(".lg-orb[data-tool]").forEach((b) => {
    b.addEventListener("click", () => {
      const next = b.dataset.tool;
      if (next === "crop") {
        enterCropMode();
        return;
      }
      ui.tool = next;
      ui.cropRect = null;
      if (next !== "select") doc.selectedLayerId = null;
      renderAll();
      syncInspector();
    });
  });

  // Style Popover controls
  qsa(".st-swatch").forEach((b) => {
    b.addEventListener("click", () => updateActiveStyle({ color: b.dataset.color }));
  });
  qs("#st-style-color").addEventListener("input", (e) => updateActiveStyle({ color: e.target.value }, "style-color"));
  qs("#st-style-width").addEventListener("input", (e) => updateActiveStyle({ lineWidth: Number(e.target.value) }, "style-width"));
  qs("#st-style-opacity").addEventListener("input", (e) =>
    updateActiveStyle({ opacity: clamp(Number(e.target.value) / 100, 0.15, 1) }, "style-opacity"),
  );
  qs("#st-style-fill").addEventListener("click", () => {
    const sel = getActiveStyleTarget();
    const cur = sel ? !!sel.fill : ui.fill;
    updateActiveStyle({ fill: !cur });
  });
  qsa("[data-dash]").forEach((b) => b.addEventListener("click", () => updateActiveStyle({ dash: b.dataset.dash })));
  qsa("[data-arrow-head]").forEach((b) => b.addEventListener("click", () => updateActiveStyle({ arrowHead: b.dataset.arrowHead })));
  qs("#st-style-font").addEventListener("change", (e) => updateActiveStyle({ font: e.target.value }));
  qs("#st-style-fontsize").addEventListener("input", (e) => updateActiveStyle({ fontSize: Number(e.target.value) }, "style-fontsize"));
  qs("#st-style-bold").addEventListener("click", () => {
    const sel = getActiveStyleTarget();
    updateActiveStyle({ bold: !(sel ? sel.bold !== false : ui.bold) });
  });
  qs("#st-style-italic").addEventListener("click", () => {
    const sel = getActiveStyleTarget();
    updateActiveStyle({ italic: !(sel ? !!sel.italic : ui.italic) });
  });

  // Crop Pill
  qsa("[data-crop-aspect]").forEach((b) => b.addEventListener("click", () => applyCropAspect(b.dataset.cropAspect)));
  qs("#st-crop-cancel").addEventListener("click", () => {
    ui.tool = "select";
    ui.cropRect = null;
    renderAll();
  });
  qs("#st-crop-apply").addEventListener("click", commitCrop);

  // Frame Drawer Controls
  qs("#st-stitch-device").addEventListener("click", () => triggerFilePicker(hasWorkspaceContent() ? "stitch" : "open"));
  qs("#st-stitch-gallery").addEventListener("click", () => openGalleryPicker(hasWorkspaceContent() ? "stitch" : "open"));
  qs("#st-base-list").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-base-remove]");
    if (rm) {
      const idx = Number(rm.dataset.baseRemove);
      doc.baseImages.splice(idx, 1);
      commit();
      syncInspector();
      return;
    }
    const mv = e.target.closest("[data-base-move]");
    if (mv) {
      const idx = Number(mv.dataset.idx);
      const next = mv.dataset.baseMove === "left" ? idx - 1 : idx + 1;
      if (next >= 0 && next < doc.baseImages.length) {
        const [item] = doc.baseImages.splice(idx, 1);
        doc.baseImages.splice(next, 0, item);
        commit();
        syncInspector();
      }
    }
  });
  qsa("[data-stitch-layout]").forEach((b) => {
    b.addEventListener("click", () => {
      doc.frame.stitchLayout = b.dataset.stitchLayout;
      commit("stitch-layout");
      syncFramePane();
    });
  });
  qs("#st-stitch-gap").addEventListener("input", (e) => {
    doc.frame.stitchGap = Number(e.target.value);
    commit("stitch-gap");
    syncFramePane();
  });
  qs("#st-stitch-divider").addEventListener("click", () => {
    doc.frame.stitchDivider = !doc.frame.stitchDivider;
    commit();
    syncFramePane();
  });

  qsa("[data-win-style]").forEach((b) => {
    b.addEventListener("click", () => {
      doc.frame.windowStyle = b.dataset.winStyle;
      commit();
      syncFramePane();
    });
  });
  qs("#st-win-title").addEventListener("input", (e) => {
    doc.frame.windowTitle = e.target.value;
    commit("win-title");
  });

  qsa("[data-bg-mode]").forEach((b) => {
    b.addEventListener("click", () => {
      doc.frame.customMode = b.dataset.bgMode;
      commit();
      syncFramePane();
    });
  });
  qsa("[data-bg-id]").forEach((b) => {
    b.addEventListener("click", () => {
      doc.frame.customMode = "preset";
      doc.frame.bgId = b.dataset.bgId;
      commit();
      syncFramePane();
    });
  });
  qs("#st-bg-c1").addEventListener("input", (e) => {
    doc.frame.customColor = e.target.value;
    commit("bg-c1");
  });
  qs("#st-bg-c2").addEventListener("input", (e) => {
    doc.frame.customColor2 = e.target.value;
    commit("bg-c2");
  });
  qs("#st-bg-angle").addEventListener("input", (e) => {
    doc.frame.customAngle = Number(e.target.value);
    qs("#st-bg-angle-out").textContent = `${doc.frame.customAngle}°`;
    commit("bg-angle");
  });
  qsa("[data-pattern]").forEach((b) => {
    b.addEventListener("click", () => {
      doc.frame.pattern = b.dataset.pattern;
      commit();
      syncFramePane();
    });
  });
  qsa("[data-aspect]").forEach((b) => {
    b.addEventListener("click", () => {
      doc.frame.aspectRatio = b.dataset.aspect;
      ui.zoomMode = "fit";
      commit();
      syncFramePane();
    });
  });

  const bindFrameSlider = (id, key, suffix, fixed = 1) => {
    qs(`#${id}`).addEventListener("input", (e) => {
      doc.frame[key] = Number(e.target.value);
      qs(`#${id}-out`).textContent = `${fixed ? Number(e.target.value).toFixed(fixed) : Math.round(Number(e.target.value))}${suffix}`;
      commit(`frame-${key}`);
    });
  };
  bindFrameSlider("st-padding", "padding", "%", 1);
  bindFrameSlider("st-radius", "radius", "%", 1);
  bindFrameSlider("st-shadow", "shadow", "%", 0);
  bindFrameSlider("st-border", "border", "px", 0);

  // Filters & Transform Drawer Controls
  qs("#st-rot-ccw").addEventListener("click", () => {
    doc.transform.rotation = (doc.transform.rotation + 270) % 360;
    ui.zoomMode = "fit";
    commit();
  });
  qs("#st-rot-cw").addEventListener("click", () => {
    doc.transform.rotation = (doc.transform.rotation + 90) % 360;
    ui.zoomMode = "fit";
    commit();
  });
  qs("#st-flip-h").addEventListener("click", () => {
    doc.transform.flipH = !doc.transform.flipH;
    commit();
  });
  qs("#st-flip-v").addEventListener("click", () => {
    doc.transform.flipV = !doc.transform.flipV;
    commit();
  });
  qs("#st-filter-reset").addEventListener("click", () => {
    const t = getFilterTarget();
    Object.assign(t.filters, DEFAULT_FILTERS);
    commit();
    syncFiltersPane();
  });
  qsa("[data-filter-preset]").forEach((b) => {
    b.addEventListener("click", () => {
      const preset = FILTER_PRESETS.find((p) => p.id === b.dataset.filterPreset);
      if (!preset) return;
      const t = getFilterTarget();
      Object.assign(t.filters, DEFAULT_FILTERS, preset.values, { preset: preset.id });
      commit();
      syncFiltersPane();
    });
  });
  qsa("[data-fkey]").forEach((slider) => {
    slider.addEventListener("input", () => {
      const key = slider.dataset.fkey;
      const t = getFilterTarget();
      t.filters[key] = Number(slider.value);
      t.filters.preset = "custom";
      commit(`filter-${key}`);
      syncFiltersPane();
    });
  });

  // Templates Drawer Controls
  qsa("[data-template-id]").forEach((b) => {
    b.addEventListener("click", () => {
      if (!hasWorkspaceContent()) {
        startBlankCanvas(1440, 900, "Template Canvas");
      }
      if (applyTemplateToDoc(doc, b.dataset.templateId)) {
        ui.zoomMode = "fit";
        commit();
        syncInspector();
        const tpl = TEMPLATES.find((t) => t.id === b.dataset.templateId);
        toast(`Applied “${tpl?.name || "Template"}”`);
      }
    });
  });

  // Layers Drawer Controls
  qs("#st-add-layer-device").addEventListener("click", () => triggerFilePicker("layer"));
  qs("#st-add-layer-gallery").addEventListener("click", () => openGalleryPicker("layer"));
  qs("#st-add-layer-text").addEventListener("click", () => {
    if (!hasWorkspaceContent()) return;
    const layout = computeCanvasLayout(doc);
    const layer = addLayer(doc, {
      type: "text",
      name: "Heading",
      x: Math.round(layout.totalWidth * 0.5),
      y: Math.round(layout.totalHeight * 0.12),
      text: "Double-click to edit",
      color: ui.color,
      font: ui.font,
      fontSize: Math.max(24, Math.round(layout.baseDim * 0.04)),
      bold: true,
      italic: false,
      fill: true,
      align: "center",
      opacity: 1,
    });
    ui.tool = "select";
    commit();
    syncInspector();
    openTextEditor(layer, false);
  });

  qs("#st-layer-list").addEventListener("click", (e) => {
    const row = e.target.closest(".st-layer-row[data-layer-id]");
    if (!row) return;
    const id = row.dataset.layerId;
    const act = e.target.closest("[data-layer-act]")?.dataset.layerAct;
    if (act === "select") {
      doc.selectedLayerId = id;
      ui.tool = "select";
      renderCanvas();
      syncInspector();
    } else if (act === "up") {
      if (reorderLayer(doc, id, "up")) {
        commit();
        syncLayersPane();
      }
    } else if (act === "down") {
      if (reorderLayer(doc, id, "down")) {
        commit();
        syncLayersPane();
      }
    } else if (act === "dup") {
      if (duplicateLayer(doc, id)) {
        commit();
        syncLayersPane();
      }
    } else if (act === "lock") {
      if (toggleLayerLock(doc, id)) {
        commit();
        syncLayersPane();
      }
    } else if (act === "vis") {
      if (toggleLayerVisibility(doc, id)) {
        commit();
        syncLayersPane();
      }
    } else if (act === "del") {
      if (removeLayer(doc, id)) {
        commit();
        syncInspector();
      }
    }
  });

  // Selected Layer Properties
  qs("#st-lp-name").addEventListener("input", (e) => {
    const sel = findLayer(doc, doc.selectedLayerId);
    if (!sel) return;
    sel.name = e.target.value;
    commit("layer-name");
    const rowName = qs(`.st-layer-row[data-layer-id="${sel.id}"] .st-layer-name`);
    if (rowName) rowName.textContent = sel.name || sel.type;
  });
  qs("#st-lp-opacity").addEventListener("input", (e) => {
    const sel = findLayer(doc, doc.selectedLayerId);
    if (!sel) return;
    const pct = Number(e.target.value);
    sel.opacity = clamp(pct / 100, 0.05, 1);
    qs("#st-lp-opacity-out").textContent = `${pct}%`;
    commit("layer-opacity");
  });
  qs("#st-lp-blend").addEventListener("change", (e) => {
    const sel = findLayer(doc, doc.selectedLayerId);
    if (!sel) return;
    sel.blendMode = e.target.value;
    commit();
  });
  qs("#st-lp-rot").addEventListener("input", (e) => {
    const sel = findLayer(doc, doc.selectedLayerId);
    if (!sel) return;
    sel.rotation = Number(e.target.value);
    qs("#st-lp-rot-out").textContent = `${sel.rotation}°`;
    commit("layer-rot");
  });
  qs("#st-lp-radius").addEventListener("input", (e) => {
    const sel = findLayer(doc, doc.selectedLayerId);
    if (!sel) return;
    sel.radius = Number(e.target.value);
    qs("#st-lp-radius-out").textContent = `${sel.radius}px`;
    commit("layer-radius");
  });
  qs("#st-lp-shadow").addEventListener("input", (e) => {
    const sel = findLayer(doc, doc.selectedLayerId);
    if (!sel) return;
    sel.shadow = Number(e.target.value);
    qs("#st-lp-shadow-out").textContent = `${sel.shadow}%`;
    commit("layer-shadow");
  });

  // Canvas pointer & wheel interactions
  canvasEl.addEventListener("pointerdown", onCanvasPointerDown);
  canvasEl.addEventListener("pointermove", onCanvasPointerMove);
  canvasEl.addEventListener("pointerup", onCanvasPointerUp);
  canvasEl.addEventListener("pointercancel", onCanvasPointerUp);
  canvasEl.addEventListener("dblclick", onCanvasDoubleClick);

  stageWrapEl.addEventListener(
    "wheel",
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || !hasWorkspaceContent()) return;
      e.preventDefault();
      ui.zoomMode = "manual";
      ui.zoomScale = clamp(ui.zoomScale * (e.deltaY < 0 ? 1.12 : 0.89), 0.15, 4);
      renderCanvas();
    },
    { passive: false },
  );

  // Drag & Drop files directly onto Annotate stage
  let dragDepth = 0;
  const dropVeil = qs("#st-drop-veil");
  const endDrag = () => {
    dragDepth = 0;
    dropVeil?.classList.remove("is-open");
  };
  rootEl.addEventListener("dragenter", (e) => {
    if (!isStudioActive() || ![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    dragDepth++;
    dropVeil?.classList.add("is-open");
  });
  rootEl.addEventListener("dragleave", () => {
    if (--dragDepth <= 0) endDrag();
  });
  rootEl.addEventListener("dragover", (e) => {
    if (!isStudioActive() || ![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  rootEl.addEventListener("drop", async (e) => {
    if (!isStudioActive() || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    endDrag();
    const mode = hasWorkspaceContent() ? (e.shiftKey ? "layer" : "stitch") : "open";
    await openStudioWithFiles(e.dataTransfer.files, mode);
  });

  // Clipboard paste inside Annotate
  document.addEventListener("paste", async (e) => {
    if (!isStudioActive() || pickerState.open) return;
    if (e.target.closest?.("input, textarea, [contenteditable]")) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => IMAGE_TYPES.test(f.type));
    if (!files.length) return;
    e.preventDefault();
    await openStudioWithFiles(files, hasWorkspaceContent() ? "layer" : "open");
  });

  // Keyboard shortcuts while Annotate overlay is active
  document.addEventListener("keydown", (e) => {
    if (!isStudioActive()) return;
    if (pickerState.open) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeGalleryPicker();
      }
      return;
    }
    if (document.querySelector(".modal-root.is-open")) return;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (typing) return;

    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (e.key === "Escape") {
      e.preventDefault();
      if (ui.activePopover) {
        closeAllPopovers();
      } else if (ui.tool === "crop") {
        ui.tool = "select";
        ui.cropRect = null;
        renderAll();
      } else if (doc.selectedLayerId) {
        doc.selectedLayerId = null;
        renderCanvas();
        syncInspector();
      } else if (ui.leftDrawer || ui.rightDrawer) {
        ui.leftDrawer = null;
        ui.rightDrawer = null;
        syncDrawers();
      } else {
        requestCloseStudio();
      }
      return;
    }

    if (mod && k === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && k === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && k === "d" && doc.selectedLayerId) {
      e.preventDefault();
      if (duplicateLayer(doc, doc.selectedLayerId)) {
        commit();
        syncInspector();
      }
      return;
    }
    if (mod && k === "c" && !getSelection()?.toString() && hasWorkspaceContent()) {
      e.preventDefault();
      copyStudioToClipboard();
      return;
    }
    if (mod && k === "s" && hasWorkspaceContent()) {
      e.preventDefault();
      exportStudio(ui.exportFormat);
      return;
    }
    if (mod && k === "g" && hasWorkspaceContent()) {
      e.preventDefault();
      saveStudioToGallery();
      return;
    }

    if ((e.key === "Delete" || e.key === "Backspace") && doc.selectedLayerId) {
      e.preventDefault();
      const sel = findLayer(doc, doc.selectedLayerId);
      if (sel && !sel.locked && removeLayer(doc, sel.id)) {
        commit();
        syncInspector();
      }
      return;
    }

    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && doc.selectedLayerId) {
      const sel = findLayer(doc, doc.selectedLayerId);
      if (sel && !sel.locked) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 2;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        moveLayerBy(sel, dx, dy);
        commit("nudge");
      }
      return;
    }

    if (mod || e.altKey) return;

    const matchTool = TOOLS.find((t) => t.key.toLowerCase() === k);
    if (matchTool) {
      e.preventDefault();
      if (matchTool.id === "crop") enterCropMode();
      else {
        ui.tool = matchTool.id;
        ui.cropRect = null;
        renderAll();
      }
      return;
    }
    if (k === "i") {
      e.preventDefault();
      triggerFilePicker(hasWorkspaceContent() ? "layer" : "open");
    } else if (k === "[") {
      updateActiveStyle({ lineWidth: clamp(ui.lineWidth - 1, 2, 24) });
    } else if (k === "]") {
      updateActiveStyle({ lineWidth: clamp(ui.lineWidth + 1, 2, 24) });
    } else if (k === "0") {
      ui.zoomMode = "fit";
      renderCanvas();
    }
  });

  resizeObserver = new ResizeObserver(() => {
    if (isStudioActive() && hasWorkspaceContent() && ui.zoomMode === "fit") {
      renderCanvas();
    }
  });
  resizeObserver.observe(stageWrapEl);
}

// ─── Mount Entry Point ────────────────────────────────────────────────

export async function mountStudio(opts = {}) {
  if (typeof opts?.onClose === "function") {
    onCloseCallback = opts.onClose;
  }
  if (typeof opts?.onSaved === "function") {
    onSavedCallback = opts.onSaved;
  }
  rootEl = document.getElementById("annotate-view");
  if (!rootEl) return;
  if (mounted) {
    renderAll();
    syncInspector();
    return;
  }

  rootEl.innerHTML = buildStudioMarkup();
  hydrateIcons(rootEl);

  canvasEl = qs("#st-canvas");
  stageWrapEl = qs("#st-stage-wrap");
  canvasFrameEl = qs("#st-canvas-frame");
  fileInputEl = qs("#st-file-input");

  wireStudioEvents();
  mounted = true;
  syncHistoryButtons();
  renderAll();
  syncInspector();
}
