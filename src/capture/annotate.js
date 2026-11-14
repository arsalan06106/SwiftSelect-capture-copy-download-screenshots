/**
 * SwiftSelect annotation editor.
 *
 * A dependency-free HTML5 2D canvas editor that opens over the page (or in
 * its own tab when launched from the gallery).
 *
 * Tools      Select & Move, Pen, Highlighter, Arrow, Rectangle, Ellipse,
 *            Step Counter, Blur / Redact, Text, Crop.
 * Styling    Palette + custom colour, stroke width, opacity, fill toggle.
 * History    Undo / redo for add, delete, move, resize, restyle, text edits,
 *            clear and crop.
 * Output     Copy to clipboard, download, save to gallery.
 *
 * Scene model: `_shapes` is an ordered display list of plain objects. Every
 * frame redraws the base image and replays the list, so export is simply the
 * same replay onto a clean canvas without selection handles.
 */

import { getSmartFilename, getOutputSettings, getOutputSettingsSync, cropSnapshotToMedia, currentToolbarLook } from "./utils.js";
import { setLastBlob, downloadBlob } from "./download.js";
import { saveToGallery } from "./deliver.js";
import { loadStyles, getCachedCssText, attachTooltip, hideCustomTooltip, trackSheen, setTooltipGuard } from "../ui.js";

let _annotateHost = null;
let _toolbarEl = null;
let _annotateCanvas = null;
let _annotateCtx = null;
let _baseImage = null;
let _shapes = [];
let _undoStack = [];
let _redoStack = [];
let _scratchBlurCanvas = null;
let _scratchBlurCtx = null;
let _textInputOverlay = null;
let _currentTool = "pen"; // select | pen | highlighter | arrow | rect | ellipse | counter | blur | text | crop
let _currentColor = "#FF3333"; // Vivid High-Visibility Red
let _currentLineWidth = 7; // 3rd size is default
let _currentOpacity = 1.0;

/**
 * Pen-like tools and the highlighter keep separate styles. The highlighter
 * is a wide translucent marker by nature; sharing one size and opacity with
 * the pen meant the panel showed one thing and the stroke did another.
 */
const STYLE_DEFAULTS = {
  ink: { lineWidth: 7, opacity: 1 },
  marker: { lineWidth: 24, opacity: 0.45 },
};
let _styleByKind = { ink: { ...STYLE_DEFAULTS.ink }, marker: { ...STYLE_DEFAULTS.marker } };
const styleKind = (tool) => (tool === "highlighter" ? "marker" : "ink");
let _activeKind = "ink";

/** Stash the live style under its kind and load the other kind's style. */
function switchStyleKind(kind) {
  if (kind === _activeKind) return;
  _styleByKind[_activeKind] = { lineWidth: _currentLineWidth, opacity: _currentOpacity };
  _currentLineWidth = _styleByKind[kind].lineWidth;
  _currentOpacity = _styleByKind[kind].opacity;
  _activeKind = kind;
}
let _stepSize = () => {};

// Per-shape options beyond colour, size and opacity.
let _currentDash = "solid"; // solid | dashed | dotted   (pen, arrow, rect, ellipse)
const _dashByTool = { pen: "solid", arrow: "solid", rect: "solid", ellipse: "solid" };
let _currentHead = "end"; // end | both | none          (arrow)
let _textFont = "sans"; // sans | serif | mono | hand  (text)
let _textBold = true;
let _textItalic = false;

const TEXT_FONTS = {
  sans: "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  serif: "'Iowan Old Style', 'Palatino Linotype', Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace",
  hand: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', 'Chalkboard SE', cursive",
};

function textFont(s) {
  const size = s.fontSize || 28;
  const weight = s.bold === false ? 500 : 700;
  const style = s.italic ? "italic " : "";
  return `${style}${weight} ${size}px ${TEXT_FONTS[s.font] || TEXT_FONTS.sans}`;
}

/** Dash pattern scaled to the stroke so dashes stay legible at any width. */
function applyDash(ctx, s) {
  const lw = s.lineWidth || 4;
  if (s.dash === "dashed") {
    ctx.setLineDash([lw * 2.6, lw * 1.9]);
    ctx.lineCap = "round";
  } else if (s.dash === "dotted") {
    ctx.setLineDash([0.01, lw * 2]);
    ctx.lineCap = "round";
  } else {
    ctx.setLineDash([]);
  }
}
let _stepCounter = 1;
let _fillEnabled = false; // rect/ellipse: tinted fill · text: background pill · blur: solid redaction
let _fillBtn = null;
let _standalone = false; // true when the editor owns the whole tab (opened from the gallery)
let _onClose = null;
let _sourceMeta = {};
let _updateStrokeUI = () => {};
let _syncStyleUI = () => {};
let _strokePopoverEl = null;
let _closeStrokePopover = () => {};
let _hoverShapeIndex = -1;
let _tuneBtn = null;
let _closePopoverHandler = null;

let _isDrawing = false;
let _activeShape = null;

// Selection & Move State
let _selectedShapeIndex = -1;
let _dragAction = null; // 'move' | 'arrow-start' | 'arrow-end' | 'rect-tl' | ... | 'crop-...'
let _dragStartPos = { x: 0, y: 0 };
let _shapeStartSnapshot = null;

// Crop State
let _cropRect = null; // { x, y, width, height }
let _cropControlsEl = null;
let _cropAspectRatioKey = "free";
let _cropAspectRatio = null;

let _undoBtn = null;
let _redoBtn = null;
let _toolsGroup = null;
let _cropBtn = null;

const PALETTE = [
  "#FF3333", // Vivid Red
  "#FF9500", // Bright Orange
  "#FFCC00", // Vivid Amber Yellow
  "#10B981", // Emerald Green
  "#007AFF", // Vivid Electric Blue
  "#8B5CF6", // Purple
  "#FFFFFF", // Pure White
];

// High-DPI Custom Pen/Brush SVG Cursor (Tip at 2, 22)
const BRUSH_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M18 2.5l3.5 3.5-12 12H6v-3.5L18 2.5z' fill='%23ffffff' stroke='%23111111' stroke-width='1.5' stroke-linejoin='round'/%3E%3Ccircle cx='5.5' cy='18.5' r='1.5' fill='%23BA4B5C'/%3E%3Cpath d='M2 22l3.5-3.5' stroke='%23111111' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") 2 22, crosshair`;

/**
 * Freehand tools show the real brush footprint at screen scale, so you can
 * see exactly how thick the next stroke will be.
 */
function brushCursor(tool) {
  const canvas = _annotateCanvas;
  const scale = canvas && canvas.width ? canvas.getBoundingClientRect().width / canvas.width : 1;
  const lw = tool === "highlighter" ? Math.max(18, _currentLineWidth * 3.2) : _currentLineWidth;
  const d = Math.round(Math.max(6, Math.min(120, lw * scale)));
  const size = d + 4;
  const c = size / 2;
  const svg =
    tool === "highlighter"
      ? `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><rect x='${c - d / 2}' y='${c - d / 6}' width='${d}' height='${Math.max(4, d / 3)}' rx='2' fill='none' stroke='white' stroke-width='3' opacity='.9'/><rect x='${c - d / 2}' y='${c - d / 6}' width='${d}' height='${Math.max(4, d / 3)}' rx='2' fill='none' stroke='black' stroke-width='1'/></svg>`
      : `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${c}' cy='${c}' r='${d / 2}' fill='none' stroke='white' stroke-width='3' opacity='.9'/><circle cx='${c}' cy='${c}' r='${d / 2}' fill='none' stroke='black' stroke-width='1'/><circle cx='${c}' cy='${c}' r='1' fill='black'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(c)} ${Math.round(c)}, crosshair`;
}

function getToolCursor(tool = _currentTool) {
  if (tool === "select") return "default";
  if (tool === "pen" || tool === "highlighter") return brushCursor(tool);
  if (tool === "text") return "text";
  return "crosshair";
}

const COLOR_NAMES = {
  "#FF3333": "Vivid Red",
  "#FF9500": "Bright Orange",
  "#FFCC00": "Vivid Yellow",
  "#10B981": "Emerald Green",
  "#007AFF": "Electric Blue",
  "#8B5CF6": "Purple",
  "#FFFFFF": "Pure White",
};

const STROKE_WIDTHS = {
  ink: { min: 1, max: 60, presets: [2, 4, 7, 12] },
  marker: { min: 6, max: 80, presets: [12, 18, 24, 36] },
};

const TOOL_NAMES = {
  select: "Selection",
  pen: "Pen",
  highlighter: "Highlighter",
  arrow: "Arrow",
  rect: "Rectangle",
  ellipse: "Ellipse",
  counter: "Step counter",
  blur: "Redact",
  text: "Text",
  crop: "Crop",
};

/** Which style controls make sense for a tool (or the selected shape). */
function styleScope(tool, shape) {
  const t = shape ? (shape.type === "pen" && shape.blend ? "highlighter" : shape.type) : tool;
  return {
    tool: t,
    color: t !== "blur",
    size: t !== "blur" && t !== "crop",
    opacity: t !== "blur" && t !== "crop",
    fill: t === "rect" || t === "ellipse" || t === "blur" || t === "text" || t === "select",
    fillLabels: t === "blur" ? ["Mosaic", "Solid"] : t === "text" ? ["Plain", "Pill"] : ["Outline", "Filled"],
    sizeLabel: t === "text" ? "Text size" : t === "counter" ? "Badge size" : "Thickness",
    line: t === "pen" || t === "arrow" || t === "rect" || t === "ellipse",
    arrow: t === "arrow",
    text: t === "text",
  };
}


function isBoxShape(s) {
  return s.type === "rect" || s.type === "ellipse" || s.type === "blur";
}

// ─── Highlighter: straight strokes that fit the text ─────────────────
// Dragging the highlighter along a line of text locks the stroke level and
// sizes it to that line. Moving clearly off the line turns it back into a
// freehand stroke. A single click drops an anchor instead: the stroke then
// follows the pointer and the next click finishes it. Alt switches all of
// this off for one stroke.

let _hlPending = false; // anchor placed, waiting for the click that ends the stroke
let _fitCanvas = null;
let _fitCtx = null;
let _fitSrc = null;

/**
 * Find the line of text under (x, y) in the screenshot itself.
 * Returns its vertical centre and height, or null when there is no clear
 * line there (a photo, a solid block, empty space).
 */
function fitTextLine(x, y) {
  if (!_baseImage) return null;
  try {
    const iw = _baseImage.naturalWidth || _baseImage.width;
    const ih = _baseImage.naturalHeight || _baseImage.height;
    if (_fitSrc !== _baseImage || !_fitCanvas) {
      _fitCanvas = document.createElement("canvas");
      _fitCanvas.width = iw;
      _fitCanvas.height = ih;
      _fitCtx = _fitCanvas.getContext("2d", { willReadFrequently: true });
      _fitCtx.drawImage(_baseImage, 0, 0, iw, ih);
      _fitSrc = _baseImage;
    }
    const reach = Math.round(Math.max(90, Math.min(220, iw / 12)));
    const bw = Math.min(iw, reach * 2);
    const bx = Math.round(Math.max(0, Math.min(iw - bw, x - bw / 2)));
    const by = Math.round(Math.max(0, y - reach));
    const bh = Math.min(ih - by, Math.round(y + reach) - by);
    if (bw < 8 || bh < 8) return null;
    const data = _fitCtx.getImageData(bx, by, bw, bh).data;

    // Background = the most common brightness in the band.
    const luma = new Uint8Array(bw * bh);
    const hist = new Uint32Array(32);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      const l = (data[i] * 54 + data[i + 1] * 183 + data[i + 2] * 19) >> 8;
      luma[j] = l;
      hist[l >> 3]++;
    }
    let mode = 0;
    for (let i = 1; i < 32; i++) if (hist[i] > hist[mode]) mode = i;
    const bg = mode * 8 + 4;

    // A row has ink when a few of its pixels stand out from the background.
    const ink = new Uint8Array(bh);
    const need = Math.max(2, Math.round(bw * 0.012));
    for (let r = 0; r < bh; r++) {
      let n = 0;
      for (let c = 0, o = r * bw; c < bw; c++) if (Math.abs(luma[o + c] - bg) > 42) n++;
      ink[r] = n >= need ? 1 : 0;
    }

    // Start on the nearest inked row, then grow while rows keep having ink
    // (a gap of up to two rows is still the same line: think of "i" or "=").
    let row = Math.round(y - by);
    if (!ink[row]) {
      let found = -1;
      for (let d = 1; d <= 10 && found < 0; d++) {
        if (ink[row - d]) found = row - d;
        else if (ink[row + d]) found = row + d;
      }
      if (found < 0) return null;
      row = found;
    }
    const GAP = 2;
    let top = row;
    for (let r = row - 1, gap = 0; r >= 0; r--) {
      if (ink[r]) {
        top = r;
        gap = 0;
      } else if (++gap > GAP) break;
    }
    let bottom = row;
    for (let r = row + 1, gap = 0; r < bh; r++) {
      if (ink[r]) {
        bottom = r;
        gap = 0;
      } else if (++gap > GAP) break;
    }
    const h = bottom - top + 1;
    // Touching the band's edge means this is not a line of text.
    if (h < 6 || top <= 1 || bottom >= bh - 2 || h > reach * 1.2) return null;
    return { cy: by + (top + bottom) / 2, h };
  } catch {
    return null;
  }
}

/** Width that covers a fitted text line with a little breathing room. */
function fitWidth(h) {
  return Math.round(Math.max(10, Math.min(200, h * 1.34 + 4)));
}

function stripHighlighterState(shape) {
  delete shape._raw;
  delete shape._free;
  delete shape._userLw;
  delete shape._cy;
  delete shape._sy;
}

function commitActiveShape() {
  const shape = _activeShape;
  if (!shape) return;
  stripHighlighterState(shape);
  _shapes.push(shape);
  _undoStack.push({ type: "add", shape });
  _activeShape = null;
  _hlPending = false;
  _redoStack = [];
  updateHistoryUI();
}

function cancelPendingHighlight() {
  if (!_hlPending) return false;
  _hlPending = false;
  _activeShape = null;
  renderCanvas();
  return true;
}

function isFreehandTool(tool = _currentTool) {
  return tool === "pen" || tool === "highlighter";
}

function cloneShape(s) {
  return JSON.parse(JSON.stringify(s));
}

function restoreShape(shape, snapshot) {
  for (const key of Object.keys(shape)) delete shape[key];
  Object.assign(shape, cloneShape(snapshot));
}

/**
 * Record a change to an existing shape so it can be undone. Rapid changes of
 * the same kind (dragging a slider) collapse into one history entry.
 */
function recordEdit(shape, prev, key = "") {
  const next = cloneShape(shape);
  if (JSON.stringify(prev) === JSON.stringify(next)) return;
  const last = _undoStack[_undoStack.length - 1];
  const now = Date.now();
  if (key && last && last.type === "edit" && last.shape === shape && last.key === key && now - last.at < 900) {
    last.next = next;
    last.at = now;
  } else {
    _undoStack.push({ type: "edit", shape, prev, next, key, at: now });
  }
  _redoStack = [];
  updateHistoryUI();
}

/** Apply a style change to the selected shape, with undo support. */
function editSelected(key, mutate) {
  const shape = _shapes[_selectedShapeIndex];
  if (_selectedShapeIndex === -1 || !shape) return false;
  const prev = cloneShape(shape);
  mutate(shape);
  recordEdit(shape, prev, key);
  renderCanvas();
  return true;
}

function moveShapeBy(shape, dx, dy) {
  if (shape.points) shape.points.forEach((p) => ((p.x += dx), (p.y += dy)));
  if (typeof shape.x1 === "number") {
    shape.x1 += dx;
    shape.x2 += dx;
    shape.y1 += dy;
    shape.y2 += dy;
  }
  if (typeof shape.x === "number") {
    shape.x += dx;
    shape.y += dy;
  }
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Shift-constrain an end point: 45° steps and 10px lengths for lines, 1:1 for boxes. */
function constrainPoint(x1, y1, x2, y2, kind) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (kind === "line") {
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    const len = Math.max(10, Math.round(Math.hypot(dx, dy) / 10) * 10);
    return { x: Math.round(x1 + Math.cos(angle) * len), y: Math.round(y1 + Math.sin(angle) * len) };
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: x1 + (dx < 0 ? -side : side), y: y1 + (dy < 0 ? -side : side) };
}

/** Show a key hint only when editor shortcuts are switched on. */
function keyHint(key) {
  return getOutputSettingsSync().editorShortcuts ? key : "";
}

export function isAnnotationOpen() {
  return !!_annotateHost && !_annotateHost.classList.contains("qs-closing");
}

export function dismissLingeringMainMenu() {
  if (window.SwiftSelect?.ui?.hideGuide) {
    window.SwiftSelect.ui.hideGuide(true);
  }
  if (window.SwiftSelect?.ui?.removeCrosshairCursor) {
    window.SwiftSelect.ui.removeCrosshairCursor();
  }
  document.querySelectorAll("#qs-guide-host, .qs-guide-host, .qs-ovl, #qs-key-guide, .qs-key-guide, .qs-hud, .qs-box, .qs-curtain, .qs-snap-blur-panel").forEach((el) => {
    try {
      if (el !== _annotateHost && !el.closest?.("#swiftselect-annotate-root")) {
        const p = el.getRootNode()?.host || el.parentElement;
        if (p && p.parentNode && p !== _annotateHost && !p.closest?.("#swiftselect-annotate-root")) {
          p.parentNode.removeChild(p);
        }
        el.remove();
      }
    } catch {}
  });
}

/**
 * Open the editor.
 *   source   HTMLImageElement | Blob | data/blob URL | nothing (captures the visible tab)
 *   options  { standalone, onClose, title, url }
 */
export async function openAnnotationEditor(source, options = {}) {
  _standalone = !!options.standalone;
  _onClose = typeof options.onClose === "function" ? options.onClose : null;
  _sourceMeta = { title: options.title, url: options.url };

  // The editor takes the whole screen: put the recent-captures tray away.
  window.SwiftSelect?.peek?.closePeek?.({ immediate: true });

  // Immediately deactivate selection mode & drag listeners on the webpage
  window.SwiftSelect?.events?.cleanup?.();
  window.SwiftSelect?.ui?.setSelecting?.(false);
  window.SwiftSelect?.ui?.cleanup?.();
  window.SwiftSelect?.ui?.hideGuide?.(true);

  // Aggressively remove any lingering guideHost from document
  const lingeringGuide = document.getElementById("qs-guide-host");
  if (lingeringGuide && lingeringGuide.parentNode) {
    lingeringGuide.parentNode.removeChild(lingeringGuide);
  }

  dismissLingeringMainMenu();

  let img = null;
  if (source instanceof HTMLImageElement) {
    img = source;
  } else if (source instanceof Blob) {
    const url = URL.createObjectURL(source);
    img = new Image();
    await new Promise((res, rej) => {
      img.onload = () => {
        URL.revokeObjectURL(url);
        res();
      };
      img.onerror = rej;
      img.src = url;
    });
  } else if (typeof source === "string") {
    img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = source;
    });
  } else {
    const freezeData = window.SwiftSelect?.ui?.getFreezeFrameDataUrl?.();
    if (freezeData) {
      return openAnnotationEditor(await cropSnapshotToMedia(freezeData), options);
    }

    // First time opening annotate editor without prior capture: use visible area view as default source
    await window.SwiftSelect?.ui?.hideUiForCapture?.();
    const snap = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 4000);
      try {
        chrome.runtime.sendMessage({ type: "capture-visible-tab" }, (resp) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          if (resp && resp.success && resp.dataUrl) {
            resolve(resp.dataUrl);
          } else {
            resolve(null);
          }
        });
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });

    if (snap) {
      return openAnnotationEditor(await cropSnapshotToMedia(snap), options);
    }

    console.warn("SwiftSelect Annotate: Could not capture visible view as source.");
    return;
  }

  // Mathematically crop out native browser scrollbar if present in full-screen capture.
  // Only meaningful for a capture of this very tab, never for a gallery image.
  if (img && !_standalone && !options.fromGallery) {
    const dpr = window.devicePixelRatio || 1;
    const docW = Math.round(document.documentElement.clientWidth * dpr);
    const docH = Math.round(document.documentElement.clientHeight * dpr);

    if (docW > 100 && img.width > docW && (img.width - docW) <= Math.round(45 * dpr)) {
      const cropW = docW;
      const cropH = (docH > 100 && img.height > docH && (img.height - docH) <= Math.round(45 * dpr))
        ? docH
        : img.height;

      const c = document.createElement("canvas");
      c.width = cropW;
      c.height = cropH;
      const cctx = c.getContext("2d");
      cctx.drawImage(img, 0, 0, cropW, cropH, 0, 0, cropW, cropH);

      const croppedImg = new Image();
      await new Promise((res) => {
        croppedImg.onload = res;
        croppedImg.src = c.toDataURL("image/png");
      });
      img = croppedImg;
    }
  }

  _baseImage = img;
  _hlPending = false;
  _activeShape = null;
  _shapes = [];
  _undoStack = [];
  _redoStack = [];
  _stepCounter = 1;
  _selectedShapeIndex = -1;
  _cropRect = null;
  _currentTool = "pen";
  _styleByKind = { ink: { ...STYLE_DEFAULTS.ink }, marker: { ...STYLE_DEFAULTS.marker } };
  _activeKind = "ink";
  _currentLineWidth = STYLE_DEFAULTS.ink.lineWidth;
  _currentOpacity = STYLE_DEFAULTS.ink.opacity;
  _fillEnabled = false;
  if (_textInputOverlay) {
    try {
      if (_textInputOverlay.parentNode) {
        _textInputOverlay.parentNode.removeChild(_textInputOverlay);
      }
    } catch {}
    _textInputOverlay = null;
  }

  await loadStyles();
  buildAnnotationUI();
  renderCanvas();
  updateHistoryUI();
}

function selectTool(toolId) {
  if (_hlPending) {
    _hlPending = false;
    _activeShape = null;
  }
  switchStyleKind(styleKind(toolId));
  // Line style is remembered per tool: a dotted box should not make the next
  // pen stroke dotted.
  if (_currentTool in _dashByTool) _dashByTool[_currentTool] = _currentDash;
  if (toolId in _dashByTool) _currentDash = _dashByTool[toolId];
  // Picking a drawing tool puts the selection down, so the style panel talks
  // about the tool you are about to use rather than the last shape touched.
  if (toolId !== "select" && _selectedShapeIndex !== -1) {
    _selectedShapeIndex = -1;
    renderCanvas?.();
  }
  _currentTool = toolId;
  _hoverShapeIndex = -1;
  // Freehand tools never grab shapes, so a leftover selection would only
  // show handles that do nothing.
  if (toolId === "pen" || toolId === "highlighter") _selectedShapeIndex = -1;
  if (toolId !== "crop") {
    _cropRect = null;
    hideCropControls();
  } else {
    initCropRect();
  }

  if (_toolsGroup) {
    _toolsGroup.querySelectorAll("button").forEach((b) => {
      const active = b.dataset.tool === _currentTool;
      b.classList.toggle("active", active);
    });
  }
  if (_cropBtn) {
    _cropBtn.classList.toggle("active", _currentTool === "crop");
  }
  _annotateHost?.classList.toggle("qs-cropping", _currentTool === "crop");
  if (_annotateCanvas) {
    _annotateCanvas.style.cursor = getToolCursor(_currentTool);
  }
  _syncStyleUI();
  renderCanvas();
}

function toggleFill() {
  const shape = _shapes[_selectedShapeIndex];
  const fillable = shape && (isBoxShape(shape) || shape.type === "text");
  if (fillable) {
    editSelected("", (target) => {
      target.fill = !target.fill;
    });
    _fillEnabled = !!shape.fill;
  } else {
    _fillEnabled = !_fillEnabled;
  }
  _syncStyleUI();
}

/** Swap a button's icon for a tick (or leave it alone on failure). */
function flashDone(btn, ok) {
  if (!btn || !ok || btn.dataset.busy) return;
  const original = btn.innerHTML;
  btn.dataset.busy = "1";
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
  setTimeout(() => {
    btn.innerHTML = original;
    delete btn.dataset.busy;
  }, 1400);
}

// ─── Stage: the gallery-preview look ─────────────────────────────────

let _closeArmed = false;
let _closeArmTimer = 0;
let _savedLen = 0;
let _savedTop = null;
let _infoEl = null;

/** Frost and tint the page behind the editor, light or dark like the toolbar. */
function applyStageTone(dark) {
  if (!_annotateHost) return;
  _annotateHost.dataset.tone = dark ? "dark" : "light";
  const tint = dark ? "rgba(11, 12, 17, 0.82)" : "rgba(244, 245, 249, 0.8)";
  _annotateHost.style.setProperty("background", tint, "important");
  _annotateHost.style.setProperty("backdrop-filter", "blur(28px) saturate(140%)", "important");
  _annotateHost.style.setProperty("-webkit-backdrop-filter", "blur(28px) saturate(140%)", "important");
  _annotateHost.style.setProperty("color-scheme", dark ? "dark" : "light");
}

/** The current marks count as saved (just opened, copied, downloaded or stored). */
function _markSaved() {
  _savedLen = _undoStack.length;
  _savedTop = _undoStack[_undoStack.length - 1] || null;
}

function hasUnsavedMarks() {
  return _undoStack.length !== _savedLen || (_undoStack[_undoStack.length - 1] || null) !== _savedTop;
}

/**
 * Close on purpose, not by accident: with unsaved marks the first Esc,
 * backdrop click or close button only warns, the second one discards.
 */
function requestClose() {
  if (!hasUnsavedMarks() || _closeArmed) {
    clearTimeout(_closeArmTimer);
    _closeArmed = false;
    closeAnnotationEditor();
    return;
  }
  _closeArmed = true;
  clearTimeout(_closeArmTimer);
  _closeArmTimer = setTimeout(() => {
    _closeArmed = false;
  }, 2600);
  hideCustomTooltip();
  window.SwiftSelect?.ui?.setStatus?.("Unsaved marks", 2600, "info", false, {
    showAnnotate: false,
    detail: "Press again to close without saving",
  });
}

/** Caption under the image: where it came from and how big it is. */
function updateStageInfo() {
  if (!_infoEl || !_annotateCanvas) return;
  const dims = `${_annotateCanvas.width.toLocaleString()} × ${_annotateCanvas.height.toLocaleString()}`;
  const dimEl = _infoEl.querySelector(".qs-stage-dims");
  if (dimEl && dimEl.textContent !== dims) dimEl.textContent = dims;
}

function buildStageInfo() {
  const info = document.createElement("div");
  info.className = "qs-stage-info";
  const title = _sourceMeta.title || (_standalone ? "" : document.title) || "Screenshot";
  let host = "";
  try {
    host = new URL(_sourceMeta.url || (_standalone ? "" : location.href)).hostname;
  } catch {}
  const b = document.createElement("b");
  b.className = "qs-stage-title";
  b.textContent = title;
  const meta = document.createElement("span");
  meta.className = "qs-stage-meta";
  const dims = document.createElement("span");
  dims.className = "qs-stage-dims";
  meta.appendChild(dims);
  if (host) {
    const dot = document.createElement("i");
    const h = document.createElement("span");
    h.textContent = host;
    meta.append(dot, h);
  }
  info.append(b, meta);
  info.addEventListener("pointerdown", (e) => e.stopPropagation());
  return info;
}

function buildAnnotationUI() {
  if (_annotateHost) {
    _annotateHost.remove();
    _annotateHost = null;
  }

  _annotateHost = document.createElement("div");
  _annotateHost.id = "swiftselect-annotate-root";
  _annotateHost.className = "qs-annotate-root";
  // The stage is the gallery's preview: the page behind is frosted over and
  // tinted to the theme, so the capture is the only thing in focus. The tint
  // follows the toolbar (set once the toolbar's theme is known, below).
  _annotateHost.style.cssText = `
    all: initial;
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    user-select: none;
    font-family: 'SS Manrope', 'Manrope', 'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif;
    opacity: 0;
    transition: opacity 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  `;
  _closeArmed = false;
  _markSaved();
  // The editor wears the look the capture toolbar last wore.
  _annotateHost.dataset.look = currentToolbarLook();

  // Inject styles.css text directly into _annotateHost (bypasses CSP on sites like Google Gemini)
  const styleTag = document.createElement("style");
  styleTag.id = "qs-annotate-styles";
  const css = getCachedCssText();
  if (css) {
    styleTag.textContent = css;
  }
  _annotateHost.appendChild(styleTag);

  // Keyframes for liquid glass toolbar animations
  const animStyles = document.createElement("style");
  animStyles.textContent = `
    @keyframes qsAnnotateToolbarIn {
      0% {
        transform: translate3d(-50%, -24px, 0) scale(0.94);
        opacity: 0;
      }
      100% {
        transform: translate3d(-50%, 0, 0) scale(1);
        opacity: 1;
      }
    }
    @keyframes qsCropControlsIn {
      0% {
        transform: translate3d(-50%, 24px, 0) scale(0.94);
        opacity: 0;
      }
      100% {
        transform: translate3d(-50%, 0, 0) scale(1);
        opacity: 1;
      }
    }
    @keyframes qsCanvasIn {
      0% {
        transform: scale(0.96);
        opacity: 0;
      }
      100% {
        transform: scale(1);
        opacity: 1;
      }
    }
    @keyframes qsStageInfoIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: none; }
    }
    #swiftselect-annotate-root .qs-stage-frame {
      all: initial;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      max-width: 100%;
      margin: auto;
    }
    #swiftselect-annotate-root .qs-stage-info {
      all: initial;
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: min(760px, calc(100vw - 112px));
      min-width: 0;
      padding: 7px 16px;
      border-radius: 99em;
      box-sizing: border-box;
      font-family: 'SS Manrope', 'Manrope', 'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif;
      color: #1b1c2a;
      background:
        linear-gradient(110deg, var(--tb1), var(--tb2) 50%, var(--tb3)),
        rgba(255, 255, 255, 0.72);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8), inset 0 0 0 1px var(--tbe), 0 8px 20px -12px rgba(20, 24, 50, 0.3);
      backdrop-filter: blur(18px) saturate(160%);
      -webkit-backdrop-filter: blur(18px) saturate(160%);
      animation: qsStageInfoIn 260ms cubic-bezier(0.22, 1, 0.36, 1) 80ms both;
      transition: opacity 160ms ease, transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: auto;
      user-select: none;
    }
    #swiftselect-annotate-root[data-tone="dark"] .qs-stage-info {
      color: #f4f5fa;
      background:
        linear-gradient(110deg, var(--tb1), var(--tb2) 50%, var(--tb3)),
        rgba(24, 25, 33, 0.76);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 0 0 1px var(--tbe), 0 8px 20px -12px rgba(0, 0, 0, 0.7);
    }
    #swiftselect-annotate-root .qs-stage-title {
      all: unset;
      display: block;
      min-width: 0;
      flex: 0 1 auto;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.35;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #swiftselect-annotate-root .qs-stage-meta {
      all: unset;
      display: flex;
      align-items: center;
      gap: 7px;
      flex-shrink: 0;
      font-size: 12px;
      line-height: 1.35;
      opacity: 0.62;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    #swiftselect-annotate-root .qs-stage-meta span {
      all: unset;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #swiftselect-annotate-root .qs-stage-meta i {
      all: unset;
      flex-shrink: 0;
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: currentColor;
    }
    #swiftselect-annotate-root.qs-cropping .qs-stage-info,
    #swiftselect-annotate-root.qs-closing .qs-stage-info {
      opacity: 0;
      transform: translateY(8px);
      pointer-events: none;
    }
    @media (max-width: 640px) {
      #swiftselect-annotate-root .qs-stage-meta span:last-child,
      #swiftselect-annotate-root .qs-stage-meta i { display: none; }
    }
    @media (prefers-reduced-transparency: reduce) {
      #swiftselect-annotate-root .qs-stage-info { background: #fff; }
      #swiftselect-annotate-root[data-tone="dark"] .qs-stage-info { background: #1e2029; }
    }
  `;
  _annotateHost.appendChild(animStyles);

  // Top Liquid Glass Toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "qs-guide qs-annotate-toolbar qs-theme-glass";
  toolbar.addEventListener("pointerdown", (e) => e.stopPropagation());
  _toolbarEl = toolbar;

  // Apply active theme variables (Glass / Dark Glass)
  const uiTheme = window.SwiftSelect?.theme;
  const stageDark = uiTheme?.applyElementTheme
    ? !!uiTheme.applyElementTheme(toolbar, uiTheme.currentUserTheme || "glass")
    : true;
  applyStageTone(stageDark);

  // Tools configuration
  const tools = [
    {
      id: "select",
      name: "Select & Move",
      key: "V",
      svg: '<svg class="tool-icon-select" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="cursor-arrow" d="M4 4l7.07 17 2.51-7.39L21 11.1 4 4z"/></svg>',
    },
    {
      id: "pen",
      name: "Pen",
      key: "P",
      svg: '<svg class="tool-icon-brush" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>',
    },
    {
      id: "highlighter",
      name: "Highlighter",
      desc: "Drag along text: it stays level and fits the line. Or click, then click again. Alt draws freehand.",
      key: "H",
      svg: '<svg class="tool-icon-highlighter" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>',
    },
    {
      id: "arrow",
      name: "Arrow",
      key: "A",
      svg: '<svg class="tool-icon-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line class="arrow-shaft" x1="5" y1="19" x2="19" y2="5"/><polyline class="arrow-head" points="9 5 19 5 19 15"/></svg>',
    },
    {
      id: "rect",
      name: "Rectangle",
      key: "R",
      svg: '<svg class="tool-icon-rect" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect class="rect-box" x="3" y="4" width="18" height="16" rx="4"/></svg>',
    },
    {
      id: "ellipse",
      name: "Ellipse / Circle",
      key: "O",
      svg: '<svg class="tool-icon-ellipse" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse class="rect-box" cx="12" cy="12" rx="9" ry="8"/></svg>',
    },
    {
      id: "counter",
      name: "Step Counter",
      key: "S",
      svg: '<svg class="tool-icon-counter" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle class="counter-ring" cx="12" cy="12" r="9"/><text class="counter-num" x="12" y="16" text-anchor="middle" font-size="11" font-weight="800" font-family="-apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif" fill="currentColor" stroke="none">1</text></svg>',
    },
    {
      id: "blur",
      name: "Blur / Redact",
      key: "B",
      svg: '<svg class="tool-icon-blur" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect class="blur-b1" x="3" y="3" width="5.5" height="5.5" rx="1.5" fill="currentColor"/><rect x="9.25" y="3" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.4"/><rect class="blur-b2" x="15.5" y="3" width="5.5" height="5.5" rx="1.5" fill="currentColor"/><rect x="3" y="9.25" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.4"/><rect class="blur-b3" x="9.25" y="9.25" width="5.5" height="5.5" rx="1.5" fill="currentColor"/><rect x="15.5" y="9.25" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.4"/><rect class="blur-b4" x="3" y="15.5" width="5.5" height="5.5" rx="1.5" fill="currentColor"/><rect x="9.25" y="15.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.4"/><rect class="blur-b5" x="15.5" y="15.5" width="5.5" height="5.5" rx="1.5" fill="currentColor"/></svg>',
    },
    {
      id: "text",
      name: "Text",
      key: "T",
      svg: '<svg class="tool-icon-text" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="text-cap" d="M4 6V4h16v2"/><line class="text-stem" x1="12" y1="4" x2="12" y2="20"/><line class="text-base" x1="8" y1="20" x2="16" y2="20"/></svg>',
    },
  ];

  // Drag handle: move the bar anywhere, double-click to send it home.
  const grip = document.createElement("div");
  grip.className = "qs-annotate-grip";
  grip.innerHTML =
    '<svg viewBox="0 0 10 18" width="10" height="18" fill="currentColor"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="9" r="1.4"/><circle cx="7.5" cy="9" r="1.4"/><circle cx="2.5" cy="15" r="1.4"/><circle cx="7.5" cy="15" r="1.4"/></svg>';
  attachTooltip(grip, "Drag to Move", "", "Double-click resets", 500, _annotateHost);
  let gripDrag = null;
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    hideCustomTooltip();
    const r = toolbar.getBoundingClientRect();
    gripDrag = { dx: e.clientX - (r.left + r.width / 2), dy: e.clientY - r.top, w: r.width, h: r.height };
    _closeStrokePopover();
    grip.setPointerCapture(e.pointerId);
    toolbar.classList.add("qs-dragging");
  });
  grip.addEventListener("pointermove", (e) => {
    if (!gripDrag) return;
    e.stopPropagation();
    const half = gripDrag.w / 2;
    const cx = Math.max(half + 6, Math.min(window.innerWidth - half - 6, e.clientX - gripDrag.dx));
    const top = Math.max(6, Math.min(window.innerHeight - gripDrag.h - 6, e.clientY - gripDrag.dy));
    toolbar.style.setProperty("left", `${Math.round(cx)}px`, "important");
    toolbar.style.setProperty("top", `${Math.round(top)}px`, "important");
    // Popovers open away from the nearest screen edge.
    toolbar.classList.toggle("qs-popover-up", top > window.innerHeight / 2);
  });
  const endGripDrag = (e) => {
    if (!gripDrag) return;
    gripDrag = null;
    toolbar.classList.remove("qs-dragging");
    try {
      grip.releasePointerCapture(e.pointerId);
    } catch {}
  };
  grip.addEventListener("pointerup", endGripDrag);
  grip.addEventListener("pointercancel", endGripDrag);
  grip.addEventListener("dblclick", () => {
    toolbar.style.removeProperty("left");
    toolbar.style.removeProperty("top");
    toolbar.classList.remove("qs-popover-up");
  });
  toolbar.appendChild(grip);

  _toolsGroup = document.createElement("div");
  _toolsGroup.className = "qs-annotate-tools";

  tools.forEach((t) => {
    const btn = document.createElement("button");
    btn.dataset.tool = t.id;
    btn.innerHTML = t.svg;
    const isActive = t.id === _currentTool;
    btn.className = `qs-guide-btn circle ${isActive ? "active" : ""}`;
    attachTooltip(btn, t.name, t.desc || "", keyHint(t.key), 200, _annotateHost);
    btn.onclick = (e) => {
      e?.stopPropagation?.();
      hideCustomTooltip();
      selectTool(t.id);
    };
    _toolsGroup.appendChild(btn);
  });
  toolbar.appendChild(_toolsGroup);

  // Crop sits with the tools, after a hairline.
  const toolSep = document.createElement("span");
  toolSep.className = "qs-annotate-sep";
  toolbar.appendChild(toolSep);

  _cropBtn = document.createElement("button");
  _cropBtn.className = `qs-guide-btn circle ${_currentTool === "crop" ? "active" : ""}`;
  _cropBtn.dataset.tool = "crop";
  _cropBtn.innerHTML =
    '<svg class="tool-icon-crop" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="crop-bracket-1" d="M6.5 2v14a1.5 1.5 0 0 0 1.5 1.5H22"/><path class="crop-bracket-2" d="M17.5 22V8a1.5 1.5 0 0 0-1.5-1.5H2"/></svg>';
  attachTooltip(_cropBtn, "Crop Image", "", keyHint("C, X"), 200, _annotateHost);
  _cropBtn.onclick = (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    selectTool(_currentTool === "crop" ? "select" : "crop");
  };
  toolbar.appendChild(_cropBtn);

  // ── Style: one control in the bar, everything else in its panel ──────
  // The bar used to carry a fill toggle, four size dots, a tune button and
  // eight swatches. They now live together in one panel that only shows the
  // controls that apply to the current tool or selected shape. The chip in
  // the bar previews the result: colour, thickness, outline or filled.
  const styleSep = document.createElement("span");
  styleSep.className = "qs-annotate-sep";
  toolbar.appendChild(styleSep);

  const chip = document.createElement("button");
  chip.className = "qs-guide-btn circle qs-style-chip qs-stroke-tune-btn";
  chip.innerHTML =
    '<span class="qs-style-swatch"><i></i></span><span class="qs-style-lines" aria-hidden="true"><i></i><i></i><i></i></span><svg class="qs-style-caret" viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5l3 3 3-3"/></svg>';
  attachTooltip(chip, "Style", "Colour, thickness, line, fill, opacity and type", keyHint("[ ]"), 200, _annotateHost);
  _tuneBtn = chip;
  _fillBtn = null;
  toolbar.appendChild(chip);

  function getScaledFontSize(width) {
    return Math.round(14 + width * 3.5);
  }

  const popover = document.createElement("div");
  popover.className = "qs-stroke-popover";
  popover.style.display = "none";
  ["pointerdown", "pointermove", "pointerup", "mousedown", "mousemove", "mouseup", "touchstart", "touchmove", "touchend", "click"].forEach((evt) => {
    popover.addEventListener(evt, (e) => e.stopPropagation());
  });

  const swatchesHtml = PALETTE.map(
    (c) => `<button type="button" class="qs-pop-swatch" data-color="${c}" style="--sw:${c}" aria-label="${COLOR_NAMES[c] || c}" title="${COLOR_NAMES[c] || c}"></button>`,
  ).join("");

  popover.innerHTML = `
    <div class="qs-pop-head">
      <span class="qs-pop-title">Style</span>
      <span class="qs-pop-tool"></span>
    </div>
    <div class="qs-pop-preview">
      <svg viewBox="0 0 220 56" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs><pattern id="qs-pop-mosaic" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#9aa3b5"/><rect width="6" height="6" fill="#c9cfdb"/><rect x="6" y="6" width="6" height="6" fill="#7d879b"/></pattern></defs>
        <g class="qs-pop-preview-art"></g>
      </svg>
    </div>
    <div class="qs-pop-sec" data-sec="color">
      <div class="qs-pop-swatches">
        ${swatchesHtml}
        <label class="qs-pop-swatch qs-pop-custom" title="Custom colour" aria-label="Custom colour"><input type="color" value="${_currentColor}"></label>
      </div>
    </div>
    <div class="qs-pop-sec" data-sec="fill">
      <div class="qs-pop-seg" role="radiogroup">
        <button type="button" role="radio" data-fill="0"><span class="qs-pop-seg-ic is-outline"></span><b>Outline</b></button>
        <button type="button" role="radio" data-fill="1"><span class="qs-pop-seg-ic is-filled"></span><b>Filled</b></button>
      </div>
    </div>
    <div class="qs-pop-sec" data-sec="line">
      <div class="qs-pop-opts" data-opt="dash" style="--n:3">
        <button type="button" data-v="solid" title="Solid"><svg viewBox="0 0 28 8" width="28" height="8"><line x1="3" y1="4" x2="25" y2="4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" /></svg></button>
        <button type="button" data-v="dashed" title="Dashed"><svg viewBox="0 0 28 8" width="28" height="8"><line x1="3" y1="4" x2="25" y2="4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="6 5"/></svg></button>
        <button type="button" data-v="dotted" title="Dotted"><svg viewBox="0 0 28 8" width="28" height="8"><line x1="3" y1="4" x2="25" y2="4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.1 5"/></svg></button>
      </div>
    </div>
    <div class="qs-pop-sec" data-sec="arrow">
      <div class="qs-pop-opts" data-opt="head" style="--n:3">
        <button type="button" data-v="end" title="Arrow at the end"><svg viewBox="0 0 28 12" width="28" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h21M19 2l5 4-5 4"/></svg></button>
        <button type="button" data-v="both" title="Arrows at both ends"><svg viewBox="0 0 28 12" width="28" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h20M19 2l5 4-5 4M9 2L4 6l5 4"/></svg></button>
        <button type="button" data-v="none" title="Plain line"><svg viewBox="0 0 28 12" width="28" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 6h22"/></svg></button>
      </div>
    </div>
    <div class="qs-pop-sec" data-sec="text">
      <div class="qs-pop-opts qs-pop-fonts" data-opt="font" style="--n:4">
        <button type="button" data-v="sans" title="Sans" style="font-family:${TEXT_FONTS.sans}">Aa</button>
        <button type="button" data-v="serif" title="Serif" style="font-family:${TEXT_FONTS.serif}">Aa</button>
        <button type="button" data-v="mono" title="Mono" style="font-family:${TEXT_FONTS.mono}">Aa</button>
        <button type="button" data-v="hand" title="Handwriting" style="font-family:${TEXT_FONTS.hand}">Aa</button>
      </div>
      <div class="qs-pop-toggles">
        <button type="button" data-toggle="bold" title="Bold"><b>B</b></button>
        <button type="button" data-toggle="italic" title="Italic"><i>I</i></button>
      </div>
    </div>
    <div class="qs-pop-sec" data-sec="size">
      <div class="qs-pop-label"><span class="qs-pop-size-label">Thickness</span><span class="qs-pop-chip qs-popover-width-val"></span></div>
      <div class="qs-pop-presets"></div>
      <div class="qs-pop-slider">
        <div class="qs-pop-track qs-pop-track-width"></div>
        <input type="range" class="qs-popover-slider-width" step="1" aria-label="Thickness">
      </div>
    </div>
    <div class="qs-pop-sec" data-sec="opacity">
      <div class="qs-pop-label"><span>Opacity</span><span class="qs-pop-chip qs-popover-opacity-val"></span></div>
      <div class="qs-pop-slider">
        <div class="qs-pop-track qs-pop-track-opacity"><i></i></div>
        <input type="range" class="qs-popover-slider-opacity" min="10" max="100" step="5" aria-label="Opacity">
      </div>
    </div>
  `;
  // The popover lives outside the toolbar on purpose. The toolbar has its own
  // backdrop-filter, and Chrome gives a nested backdrop-filter an empty
  // backdrop, so a popover inside it could never blur the page behind.
  (_annotateHost || document.body).appendChild(popover);
  _strokePopoverEl = popover;

  const $p = (sel) => popover.querySelector(sel);
  const widthValEl = $p(".qs-popover-width-val");
  const widthSlider = $p(".qs-popover-slider-width");
  const previewArt = $p(".qs-pop-preview-art");
  const widthTrack = $p(".qs-pop-track-width");
  const opacityTrack = $p(".qs-pop-track-opacity");
  const opacityValEl = $p(".qs-popover-opacity-val");
  const opacitySlider = $p(".qs-popover-slider-opacity");
  const presetsEl = $p(".qs-pop-presets");
  const customInput = $p(".qs-pop-custom input");
  const swatchEl = chip.querySelector(".qs-style-swatch");

  const currentScope = () => styleScope(_currentTool, _selectedShapeIndex !== -1 ? _shapes[_selectedShapeIndex] : null);
  const range = () => STROKE_WIDTHS[_activeKind];
  let presetsFor = "";

  function syncPopoverControls() {
    const scope = currentScope();
    const r = range();
    const w = _currentLineWidth;
    const col = _currentColor;
    const isCustom = !PALETTE.some((c) => c.toLowerCase() === col.toLowerCase());

    // Chip in the bar: a ring for outlines, a disc when filled.
    chip.style.setProperty("--sw", col);
    chip.style.setProperty("--ring", `${Math.max(2, Math.min(7, 1.5 + w / 3))}px`);
    chip.classList.toggle("is-filled", scope.fill && _fillEnabled && scope.tool !== "select");
    chip.classList.toggle("is-disabled", _currentTool === "crop");
    if (swatchEl) swatchEl.style.opacity = String(Math.max(0.35, _currentOpacity));

    popover.style.setProperty("--sw", col);
    $p(".qs-pop-tool").textContent =
      _selectedShapeIndex !== -1 ? `Selected ${TOOL_NAMES[scope.tool] || "shape"}`.replace("Selected Selection", "Selection") : TOOL_NAMES[_currentTool] || "";
    popover.querySelectorAll(".qs-pop-sec").forEach((sec) => {
      sec.hidden = !scope[sec.dataset.sec];
    });

    popover.querySelectorAll(".qs-pop-swatch[data-color]").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.color.toLowerCase() === col.toLowerCase()));
    });
    const custom = $p(".qs-pop-custom");
    custom.setAttribute("aria-pressed", String(isCustom));
    custom.style.setProperty("--sw", isCustom ? col : "transparent");
    if (customInput && /^#[0-9a-f]{6}$/i.test(col)) customInput.value = col.toLowerCase();

    const [offLabel, onLabel] = scope.fillLabels;
    const segBtns = popover.querySelectorAll(".qs-pop-seg button");
    segBtns[0].querySelector("b").textContent = offLabel;
    segBtns[1].querySelector("b").textContent = onLabel;
    segBtns[0].setAttribute("aria-checked", String(!_fillEnabled));
    segBtns[1].setAttribute("aria-checked", String(_fillEnabled));
    $p(".qs-pop-seg").classList.toggle("is-on", _fillEnabled);

    const optValues = { dash: _currentDash, head: _currentHead, font: _textFont };
    popover.querySelectorAll(".qs-pop-opts").forEach((group) => {
      const btns = [...group.querySelectorAll("button")];
      const idx = Math.max(0, btns.findIndex((b) => b.dataset.v === optValues[group.dataset.opt]));
      group.style.setProperty("--i", String(idx));
      btns.forEach((b, i) => b.setAttribute("aria-pressed", String(i === idx)));
    });
    popover.querySelector('[data-toggle="bold"]').setAttribute("aria-pressed", String(_textBold));
    popover.querySelector('[data-toggle="italic"]').setAttribute("aria-pressed", String(_textItalic));

    $p(".qs-pop-size-label").textContent = scope.sizeLabel;
    if (presetsFor !== _activeKind) {
      presetsFor = _activeKind;
      presetsEl.innerHTML = r.presets
        .map((v, i) => `<button type="button" data-w="${v}" aria-label="${v}px"><i style="--d:${[4, 7, 10, 14][i]}px"></i></button>`)
        .join("");
      widthSlider.min = String(r.min);
      widthSlider.max = String(r.max);
    }
    presetsEl.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.w) === Math.round(w))));
    widthValEl.textContent = scope.tool === "text" ? `${Math.round(14 + w * 3.5)}px` : `${Math.round(w)}px`;
    widthSlider.value = String(w);
    widthTrack.style.setProperty("--pct", `${((Math.min(r.max, w) - r.min) / (r.max - r.min)) * 100}%`);

    const op = Math.round(_currentOpacity * 100);
    opacityTrack.style.setProperty("--swatch", col);
    opacityTrack.style.setProperty("--pct", `${((op - 10) / 90) * 100}%`);
    opacityValEl.textContent = `${op}%`;
    opacitySlider.value = String(op);

    // Preview: a miniature of exactly what the canvas will draw, so every
    // control (line style, heads, fill, typeface) shows its effect here.
    previewArt.innerHTML = previewMarkup(scope.tool, col, w);
  }

  function previewMarkup(tool, col, w) {
    const op = _currentOpacity;
    const esc = (v) => String(v).replace(/"/g, "&quot;");
    const sw = Math.max(1.5, Math.min(tool === "highlighter" ? 20 : 14, tool === "highlighter" ? w * 0.6 : w * 0.85));
    const dash = (width, kind) =>
      kind === "dashed" ? `stroke-dasharray="${width * 2.6} ${width * 1.9}"` : kind === "dotted" ? `stroke-dasharray="0.01 ${width * 2}"` : "";
    const squiggle = "M20 38 C 52 8, 88 8, 112 28 S 172 50, 200 18";

    if (tool === "pen" || tool === "select") {
      return `<path d="${squiggle}" fill="none" stroke="${esc(col)}" stroke-opacity="${op}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${dash(sw, _currentDash)}/>`;
    }
    if (tool === "highlighter") {
      return `<path d="${squiggle}" fill="none" stroke="${esc(col)}" stroke-opacity="${op}" stroke-width="${sw}" stroke-linecap="butt" stroke-linejoin="round"/>`;
    }
    if (tool === "arrow") {
      const lw = Math.max(1.5, Math.min(10, w * 0.75));
      const hl = Math.max(11, lw * 3.8);
      const head = (tx, dir) => {
        const a = Math.PI / 6.8;
        const p = (len, ang) => `${tx - dir * len * Math.cos(ang)},${28 - len * Math.sin(ang)}`;
        return `<polygon points="${tx},28 ${p(hl, a)} ${tx - dir * hl * 0.68},28 ${p(hl, -a)}" fill="${esc(col)}" fill-opacity="${op}"/>`;
      };
      const x1 = _currentHead === "both" ? 22 + hl * 0.42 : 22;
      const x2 = _currentHead === "none" ? 198 : 198 - hl * 0.42;
      return (
        `<line x1="${x1}" y1="28" x2="${x2}" y2="28" stroke="${esc(col)}" stroke-opacity="${op}" stroke-width="${lw}" stroke-linecap="round" ${dash(lw, _currentDash)}/>` +
        (_currentHead !== "none" ? head(198, 1) : "") +
        (_currentHead === "both" ? head(22, -1) : "")
      );
    }
    if (tool === "rect" || tool === "ellipse") {
      const lw = Math.max(1.5, Math.min(8, w * 0.6));
      const fill = _fillEnabled ? `fill="${esc(col)}" fill-opacity="${0.22 * op}"` : `fill="none"`;
      const shape =
        tool === "ellipse"
          ? `<ellipse cx="110" cy="28" rx="68" ry="18"`
          : `<rect x="42" y="10" width="136" height="36" rx="${Math.min(14, lw * 1.25 + 2)}"`;
      return `${shape} ${fill} stroke="${esc(col)}" stroke-opacity="${op}" stroke-width="${lw}" stroke-linecap="round" ${dash(lw, _currentDash)}/>`;
    }
    if (tool === "blur") {
      return _fillEnabled
        ? `<rect x="42" y="10" width="136" height="36" rx="6" fill="#0b0b0f"/>`
        : `<rect x="42" y="10" width="136" height="36" rx="6" fill="url(#qs-pop-mosaic)"/>`;
    }
    if (tool === "counter") {
      const r = 16;
      return `<circle cx="110" cy="28" r="${r}" fill="${esc(col)}" fill-opacity="${op}" stroke="#fff" stroke-width="2.5"/><text x="110" y="29" text-anchor="middle" dominant-baseline="middle" font-family="Google Sans, system-ui, sans-serif" font-weight="700" font-size="16" fill="${luminance(col) > 0.6 ? "#18181b" : "#fff"}">1</text>`;
    }
    if (tool === "text") {
      const family = esc(TEXT_FONTS[_textFont] || TEXT_FONTS.sans);
      const weight = _textBold ? 700 : 500;
      const style = _textItalic ? "italic" : "normal";
      const label = "Your text";
      const text = (fill) =>
        `<text x="110" y="29" text-anchor="middle" dominant-baseline="middle" font-family="${family}" font-weight="${weight}" font-style="${style}" font-size="22" fill="${fill}" fill-opacity="${op}">${label}</text>`;
      return _fillEnabled
        ? `<rect x="40" y="11" width="140" height="34" rx="17" fill="${esc(col)}" fill-opacity="${op}"/>` + text(luminance(col) > 0.6 ? "#111318" : "#ffffff")
        : text(esc(col));
    }
    return "";
  }

  function updateStrokeUI() {
    chip.classList.toggle("is-open", popover.style.display !== "none");
    syncPopoverControls();
  }
  _updateStrokeUI = updateStrokeUI;

  function applyLineWidth(width) {
    const r = range();
    width = Math.max(r.min, Math.min(r.max, width));
    _currentLineWidth = width;
    editSelected("width", (shape) => {
      shape.lineWidth = width;
      if (shape.type === "text") shape.fontSize = getScaledFontSize(width);
    });
    syncPopoverControls();
    if (_annotateCanvas && !_isDrawing) _annotateCanvas.style.cursor = getToolCursor(_currentTool);
  }

  function applyOpacity(opacity) {
    _currentOpacity = opacity;
    editSelected("opacity", (shape) => {
      shape.opacity = opacity;
    });
    syncPopoverControls();
  }

  function applyColor(color) {
    _currentColor = color;
    editSelected("color", (shape) => {
      shape.color = color;
    });
    syncPopoverControls();
    if (_annotateCanvas && !_isDrawing) _annotateCanvas.style.cursor = getToolCursor(_currentTool);
  }

  // [ and ] step through the presets, then by 15% beyond them.
  _stepSize = (dir) => {
    const r = range();
    const w = _currentLineWidth;
    const next =
      dir > 0
        ? r.presets.find((p) => p > w + 0.01) ?? Math.ceil(w * 1.15)
        : [...r.presets].reverse().find((p) => p < w - 0.01) ?? Math.floor(w / 1.15);
    applyLineWidth(next);
  };

  popover.addEventListener("click", (e) => {
    const sw = e.target.closest(".qs-pop-swatch[data-color]");
    if (sw) return applyColor(sw.dataset.color);
    const pre = e.target.closest(".qs-pop-presets button");
    if (pre) return applyLineWidth(Number(pre.dataset.w));
    const seg = e.target.closest(".qs-pop-seg button");
    if (seg && String(Number(_fillEnabled)) !== seg.dataset.fill) return toggleFill();
    const opt = e.target.closest(".qs-pop-opts button");
    if (opt) {
      const key = opt.parentElement.dataset.opt;
      const v = opt.dataset.v;
      if (key === "dash") {
        _currentDash = v;
        editSelected("dash", (shape) => {
          if (shape.type === "pen" && shape.blend) return;
          if (["pen", "arrow", "rect", "ellipse"].includes(shape.type)) {
            shape.dash = v;
            if (shape.type === "pen") shape.pressure = v === "solid";
          }
        });
      } else if (key === "head") {
        _currentHead = v;
        editSelected("head", (shape) => {
          if (shape.type === "arrow") shape.head = v;
        });
      } else if (key === "font") {
        _textFont = v;
        editSelected("font", (shape) => {
          if (shape.type === "text") shape.font = v;
        });
      }
      return syncPopoverControls();
    }
    const tog = e.target.closest(".qs-pop-toggles button");
    if (tog) {
      if (tog.dataset.toggle === "bold") _textBold = !_textBold;
      else _textItalic = !_textItalic;
      const prop = tog.dataset.toggle;
      const val = prop === "bold" ? _textBold : _textItalic;
      editSelected(prop, (shape) => {
        if (shape.type === "text") shape[prop] = val;
      });
      syncPopoverControls();
    }
  });
  customInput.addEventListener("input", (e) => applyColor(e.target.value));
  widthSlider.addEventListener("input", (e) => applyLineWidth(parseFloat(e.target.value)));
  opacitySlider.addEventListener("input", (e) => applyOpacity(parseInt(e.target.value, 10) / 100));

  function placePopover() {
    const r = chip.getBoundingClientRect();
    const bar = toolbar.getBoundingClientRect();
    const pw = popover.offsetWidth || 272;
    const ph = popover.offsetHeight || 320;
    const left = Math.max(12 + pw / 2, Math.min(window.innerWidth - 12 - pw / 2, r.left + r.width / 2));
    const below = bar.bottom + 10;
    const up = below + ph > window.innerHeight - 12;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(up ? bar.top - 10 - ph : below)}px`;
    popover.classList.toggle("qs-pop-up", up);
  }

  function setPopoverOpen(open) {
    if (open) {
      hideCustomTooltip();
      popover.className = "qs-stroke-popover";
      toolbar.classList.forEach((c) => {
        if (c.startsWith("qs-theme")) popover.classList.add(c);
      });
      syncPopoverControls();
      popover.style.display = "flex";
      placePopover();
    } else {
      popover.style.display = "none";
    }
    updateStrokeUI();
  }
  _closeStrokePopover = () => setPopoverOpen(false);

  chip.onclick = (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    if (_currentTool === "crop") return;
    setPopoverOpen(popover.style.display === "none");
  };
  window.addEventListener("resize", () => {
    if (popover.style.display !== "none") placePopover();
  });

  if (_closePopoverHandler) {
    window.removeEventListener("pointerdown", _closePopoverHandler, true);
  }
  _closePopoverHandler = (e) => {
    if (popover.style.display === "none") return;
    const path = e.composedPath ? e.composedPath() : [];
    // Switching tools keeps the panel open; it follows the new tool.
    if (!path.includes(popover) && !path.includes(toolbar)) setPopoverOpen(false);
  };
  window.addEventListener("pointerdown", _closePopoverHandler, true);

  // Toolbar tooltips open below the bar, which is exactly where the style
  // panel sits. While the panel is open, or a stroke is being drawn, they
  // stay hidden instead of stacking on top of it.
  setTooltipGuard((btn) => {
    if (_isDrawing) return false;
    if (popover.style.display !== "none" && (toolbar.contains(btn) || popover.contains(btn))) return false;
    return true;
  });

  // Reflect the selected shape's own style in the toolbar.
  _syncStyleUI = () => updateStrokeUI();
  syncPopoverControls();

  const historySep = document.createElement("span");
  historySep.className = "qs-annotate-sep";
  toolbar.appendChild(historySep);

  // History Group: Undo & Redo & Clear (No divider)
  const historyGroup = document.createElement("div");
  historyGroup.className = "qs-annotate-history";

  // Undo Button
  _undoBtn = document.createElement("button");
  _undoBtn.className = "qs-guide-btn circle";
  _undoBtn.innerHTML =
    '<svg class="tool-icon-undo" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>';
  attachTooltip(_undoBtn, "Undo", "", keyHint("Ctrl+Z"), 200, _annotateHost);
  _undoBtn.onclick = (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    handleUndo();
  };
  historyGroup.appendChild(_undoBtn);

  // Redo Button
  _redoBtn = document.createElement("button");
  _redoBtn.className = "qs-guide-btn circle";
  _redoBtn.innerHTML =
    '<svg class="tool-icon-redo" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>';
  attachTooltip(_redoBtn, "Redo", "", keyHint("Ctrl+Y"), 200, _annotateHost);
  _redoBtn.onclick = (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    handleRedo();
  };
  historyGroup.appendChild(_redoBtn);

  // Clear Canvas Button
  const clearBtn = document.createElement("button");
  clearBtn.className = "qs-guide-btn circle";
  clearBtn.innerHTML =
    '<svg class="tool-icon-clear" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="trash-lid" d="M3 6h18M8 6V4a1.5 1.5 0 0 1 1.5-1.5h5A1.5 1.5 0 0 1 16 4v2"/><path class="trash-body" d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
  // One click, never two. With a shape selected it deletes that shape;
  // otherwise it clears everything. Both are undoable, and the status says so.
  attachTooltip(clearBtn, "Delete", "Selected shape, or everything when nothing is selected", "Del", 200, _annotateHost);
  clearBtn.onclick = (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    if (_selectedShapeIndex !== -1 && _shapes[_selectedShapeIndex]) {
      deleteSelectedShape();
      return;
    }
    if (_shapes.length === 0) return;
    const n = _shapes.length;
    handleClearAll();
    window.SwiftSelect?.ui?.setStatus?.(
      `Cleared ${n} annotation${n === 1 ? "" : "s"} · Undo brings ${n === 1 ? "it" : "them"} back`,
      2600,
      "info",
      false,
      { showAnnotate: false },
    );
  };
  historyGroup.appendChild(clearBtn);

  toolbar.appendChild(historyGroup);

  // Action Buttons Group: Copy, Save, Close (No divider)
  const actionsGroup = document.createElement("div");
  actionsGroup.className = "qs-annotate-actions";

  // Copy Button (Circle, icon-only)
  const copyBtn = document.createElement("button");
  copyBtn.className = "qs-guide-btn circle";
  copyBtn.innerHTML =
    '<svg class="tool-icon-copy is-filled" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
  attachTooltip(copyBtn, "Copy Image", "", keyHint("Ctrl+C"), 200, _annotateHost);
  copyBtn.onclick = async (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    flashDone(copyBtn, await handleCopyAnnotated());
  };
  actionsGroup.appendChild(copyBtn);

  // Save/Download Button (Circle, icon-only, using existing dl-arrow & dl-bar)
  const saveBtn = document.createElement("button");
  saveBtn.className = "qs-guide-btn circle";
  saveBtn.innerHTML =
    '<svg class="tool-icon-save is-filled" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path class="dl-arrow" d="M19 9h-4V3H9v6H5l7 7 7-7z"/><path class="dl-bar" d="M5 18v2h14v-2H5z"/></svg>';
  attachTooltip(saveBtn, "Download Image", "", keyHint("Ctrl+S"), 200, _annotateHost);
  saveBtn.onclick = async (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    flashDone(saveBtn, await handleSaveAnnotated());
  };
  actionsGroup.appendChild(saveBtn);

  // Save to Gallery
  const galleryBtn = document.createElement("button");
  galleryBtn.className = "qs-guide-btn circle";
  galleryBtn.innerHTML =
    '<svg class="tool-icon-gallery" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 17 5-4.5 3.5 3L16 12l4.5 4.5"/></svg>';
  attachTooltip(galleryBtn, "Save to Gallery", "", keyHint("Ctrl+G"), 200, _annotateHost);
  galleryBtn.onclick = async (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    flashDone(galleryBtn, await handleSaveToGallery());
  };
  actionsGroup.appendChild(galleryBtn);

  // Close Button (No divider)
  const closeBtn = document.createElement("button");
  closeBtn.className = "qs-guide-btn circle";
  closeBtn.innerHTML =
    '<svg class="tool-icon-close" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  attachTooltip(closeBtn, "Close Editor", "", "Esc", 200, _annotateHost);
  closeBtn.onclick = (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    requestClose();
  };
  actionsGroup.appendChild(closeBtn);

  toolbar.appendChild(actionsGroup);

  _annotateHost.appendChild(toolbar);

  // Canvas Viewport Area
  const viewport = document.createElement("div");
  viewport.id = "qs-annotate-viewport";
  viewport.style.cssText = `
    position: relative;
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 84px 56px 28px;
    box-sizing: border-box;
  `;

  // Framed like the gallery preview: rounded, a hairline edge and one soft
  // shadow, sized to leave room for the toolbar above and the caption below.
  const stageDarkNow = _annotateHost.dataset.tone === "dark";
  _annotateCanvas = document.createElement("canvas");
  _annotateCanvas.style.cssText = `
    box-shadow:
      0 0 0 1px ${stageDarkNow ? "rgba(255, 255, 255, 0.1)" : "rgba(20, 24, 40, 0.1)"},
      0 24px 60px -20px rgba(0, 0, 0, ${stageDarkNow ? 0.7 : 0.38}),
      0 8px 20px -10px rgba(0, 0, 0, ${stageDarkNow ? 0.5 : 0.18});
    border-radius: 12px;
    overflow: hidden;
    cursor: ${getToolCursor(_currentTool)};
    max-width: calc(100vw - 112px);
    max-height: calc(100vh - 196px);
    object-fit: contain;
    animation: qsCanvasIn 220ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
  `;

  // Image and caption travel together: the caption sits under the frame in
  // the layout, so it can never cover the picture.
  const frame = document.createElement("div");
  frame.className = "qs-stage-frame";
  frame.appendChild(_annotateCanvas);
  _infoEl = buildStageInfo();
  frame.appendChild(_infoEl);
  viewport.appendChild(frame);
  _annotateHost.appendChild(viewport);

  // Close annotation editor when clicking outside the canvas on the backdrop
  const handleBackdropClick = (e) => {
    const isCanvas = e.target === _annotateCanvas || e.target.closest?.("canvas");
    const isToolbar = e.target.closest?.(".qs-annotate-toolbar");
    const isCropControls = e.target.closest?.(".qs-crop-controls");
    const isTextInput = e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA";

    if (!isCanvas && !isToolbar && !isCropControls && !isTextInput) {
      if (_strokePopoverEl && _strokePopoverEl.style.display !== "none") {
        _strokePopoverEl.style.display = "none";
        updateStrokeUI();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (_standalone || _selectedShapeIndex !== -1) {
        // The editor owns this tab, or a shape is in hand: an empty click
        // only puts the selection down.
        _selectedShapeIndex = -1;
        renderCanvas();
        _syncStyleUI();
        return;
      }
      requestClose();
    }
  };

  viewport.addEventListener("pointerdown", handleBackdropClick);
  _annotateHost.addEventListener("pointerdown", handleBackdropClick);

  // Attach Pointer Listeners to Canvas & Window
  _annotateCanvas.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    hideCustomTooltip();
    onCanvasPointerDown(e);
  });
  _annotateCanvas.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    const { x, y } = getCanvasCoords(e);
    const hitIdx = hitTestShape(x, y);
    if (hitIdx !== -1 && _shapes[hitIdx] && _shapes[hitIdx].type === "text") {
      _selectedShapeIndex = hitIdx;
      renderCanvas();
      spawnInlineTextInput(x, y, _shapes[hitIdx]);
    }
  });
  window.addEventListener("pointermove", onCanvasPointerMove);
  window.addEventListener("pointerup", onCanvasPointerUp);
  window.addEventListener("keydown", onAnnotateKeyDown, true);

  (document.body || document.documentElement).appendChild(_annotateHost);

  requestAnimationFrame(() => {
    if (_annotateHost) {
      _annotateHost.style.opacity = "1";
      if (uiTheme?.applyElementTheme && toolbar) {
        uiTheme.applyElementTheme(toolbar, uiTheme.currentUserTheme || "glass");
      }
    }
  });
}

// ─── Crop Functionality ──────────────────────────────────────────────

function initCropRect() {
  if (!_annotateCanvas) return;
  const margin = Math.min(40, _annotateCanvas.width * 0.1);
  _cropRect = {
    x: margin,
    y: margin,
    width: _annotateCanvas.width - margin * 2,
    height: _annotateCanvas.height - margin * 2,
  };
  _cropAspectRatioKey = "free";
  _cropAspectRatio = null;
  showCropControls();
}

function setCropRatio(ratioKey) {
  const ratioMap = {
    free: null,
    "16:9": 16 / 9,
    "4:3": 4 / 3,
    "1:1": 1 / 1,
    "3:2": 3 / 2,
    "9:16": 9 / 16,
  };
  _cropAspectRatioKey = ratioKey;
  _cropAspectRatio = ratioMap[ratioKey] ?? null;

  if (_cropAspectRatio && _annotateCanvas && _cropRect) {
    const cw = _annotateCanvas.width;
    const ch = _annotateCanvas.height;
    let targetW = Math.min(_cropRect.width, cw * 0.95);
    let targetH = targetW / _cropAspectRatio;
    if (targetH > ch * 0.95) {
      targetH = ch * 0.95;
      targetW = targetH * _cropAspectRatio;
    }
    const cx = _cropRect.x + _cropRect.width / 2;
    const cy = _cropRect.y + _cropRect.height / 2;
    let newX = Math.round(cx - targetW / 2);
    let newY = Math.round(cy - targetH / 2);
    newX = Math.max(0, Math.min(cw - targetW, newX));
    newY = Math.max(0, Math.min(ch - targetH, newY));
    _cropRect = {
      x: newX,
      y: newY,
      width: Math.round(targetW),
      height: Math.round(targetH),
    };
    renderCanvas();
  }

  if (_cropControlsEl) {
    _cropControlsEl.querySelectorAll(".qs-crop-ratio-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.ratio === ratioKey);
    });
    const dimValEl = _cropControlsEl.querySelector(".qs-crop-dim-val");
    if (dimValEl && _cropRect) {
      dimValEl.textContent = `${Math.round(_cropRect.width)} × ${Math.round(_cropRect.height)}`;
    }
  }
}

function showCropControls() {
  if (!_annotateHost || !_cropRect) return;
  if (!_cropControlsEl) {
    _cropControlsEl = document.createElement("div");
    _cropControlsEl.className = "qs-guide qs-annotate-toolbar qs-crop-controls qs-theme-glass";
    _cropControlsEl.addEventListener("pointerdown", (e) => e.stopPropagation());
    const uiTheme = window.SwiftSelect?.theme;
    if (uiTheme?.applyElementTheme) {
      uiTheme.applyElementTheme(_cropControlsEl, uiTheme.currentUserTheme || "glass");
    }
    _cropControlsEl.innerHTML = `
      <div class="qs-crop-meta">
        <span class="qs-crop-dim">
          <svg class="qs-crop-meta-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6.5 2v14a1.5 1.5 0 0 0 1.5 1.5H22"/>
            <path d="M17.5 22V8a1.5 1.5 0 0 0-1.5-1.5H2"/>
          </svg>
          <span class="qs-crop-dim-val">${Math.round(_cropRect.width)} × ${Math.round(_cropRect.height)}</span>
          <span class="qs-crop-unit">PX</span>
        </span>
      </div>
      <div class="qs-crop-ratios">
        <button class="qs-guide-btn pill qs-crop-ratio-btn ${_cropAspectRatioKey === 'free' ? 'active' : ''}" data-ratio="free">Free</button>
        <button class="qs-guide-btn pill qs-crop-ratio-btn ${_cropAspectRatioKey === '16:9' ? 'active' : ''}" data-ratio="16:9">16:9</button>
        <button class="qs-guide-btn pill qs-crop-ratio-btn ${_cropAspectRatioKey === '4:3' ? 'active' : ''}" data-ratio="4:3">4:3</button>
        <button class="qs-guide-btn pill qs-crop-ratio-btn ${_cropAspectRatioKey === '1:1' ? 'active' : ''}" data-ratio="1:1">1:1</button>
        <button class="qs-guide-btn pill qs-crop-ratio-btn ${_cropAspectRatioKey === '3:2' ? 'active' : ''}" data-ratio="3:2">3:2</button>
        <button class="qs-guide-btn pill qs-crop-ratio-btn ${_cropAspectRatioKey === '9:16' ? 'active' : ''}" data-ratio="9:16">9:16</button>
      </div>
      <div class="qs-crop-actions">
        <button class="qs-guide-btn pill qs-crop-apply-btn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span>Apply</span>
        </button>
        <button class="qs-guide-btn pill qs-crop-cancel-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          <span>Cancel</span>
        </button>
      </div>
    `;

    const applyBtn = _cropControlsEl.querySelector(".qs-crop-apply-btn");
    const cancelBtn = _cropControlsEl.querySelector(".qs-crop-cancel-btn");

    attachTooltip(applyBtn, "Apply Crop", "", "Enter", 200, _annotateHost);
    attachTooltip(cancelBtn, "Cancel Crop", "", "Esc", 200, _annotateHost);

    _cropControlsEl.querySelectorAll(".qs-crop-ratio-btn").forEach((btn) => {
      btn.onclick = (e) => {
        e?.stopPropagation?.();
        setCropRatio(btn.dataset.ratio);
      };
    });

    applyBtn.onclick = (e) => {
      e?.stopPropagation?.();
      hideCustomTooltip();
      applyCrop();
    };
    cancelBtn.onclick = (e) => {
      e?.stopPropagation?.();
      hideCustomTooltip();
      _cropRect = null;
      hideCropControls();
      selectTool("select");
    };
    _annotateHost.appendChild(_cropControlsEl);
    if (uiTheme?.applyElementTheme) {
      uiTheme.applyElementTheme(_cropControlsEl, uiTheme.currentUserTheme || "glass");
    }
  } else {
    const uiTheme = window.SwiftSelect?.theme;
    if (uiTheme?.applyElementTheme) {
      uiTheme.applyElementTheme(_cropControlsEl, uiTheme.currentUserTheme || "glass");
    }
    const dimValEl = _cropControlsEl.querySelector(".qs-crop-dim-val");
    if (dimValEl) {
      dimValEl.textContent = `${Math.round(_cropRect.width)} × ${Math.round(_cropRect.height)}`;
    }
    _cropControlsEl.querySelectorAll(".qs-crop-ratio-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.ratio === _cropAspectRatioKey);
    });
  }
}

function hideCropControls() {
  if (_cropControlsEl) {
    _cropControlsEl.remove();
    _cropControlsEl = null;
  }
  _cropAspectRatioKey = "free";
  _cropAspectRatio = null;
}

async function applyCrop() {
  if (!_cropRect || !_annotateCanvas || !_baseImage) return;

  const { x, y, width, height } = _cropRect;
  if (width < 20 || height < 20) return;

  const prevImage = _baseImage;
  const prevShapes = JSON.parse(JSON.stringify(_shapes));

  // Render crop onto offscreen canvas
  const offscreen = document.createElement("canvas");
  offscreen.width = Math.round(width);
  offscreen.height = Math.round(height);
  const oCtx = offscreen.getContext("2d");
  oCtx.drawImage(
    _baseImage,
    Math.round(x),
    Math.round(y),
    Math.round(width),
    Math.round(height),
    0,
    0,
    Math.round(width),
    Math.round(height),
  );

  const newImg = new Image();
  await new Promise((res) => {
    newImg.onload = res;
    newImg.src = offscreen.toDataURL("image/png");
  });

  _baseImage = newImg;

  // Adjust shapes offset
  _shapes.forEach((s) => {
    if (s.type === "arrow" || isBoxShape(s)) {
      s.x1 -= x;
      s.y1 -= y;
      s.x2 -= x;
      s.y2 -= y;
    } else if (s.type === "counter" || s.type === "text") {
      s.x -= x;
      s.y -= y;
    } else if (s.type === "pen" && s.points) {
      s.points.forEach((p) => {
        p.x -= x;
        p.y -= y;
      });
    }
  });

  _undoStack.push({
    type: "crop",
    prevImage,
    nextImage: newImg,
    prevShapes,
    nextShapes: JSON.parse(JSON.stringify(_shapes)),
  });
  _redoStack = [];

  _cropRect = null;
  hideCropControls();
  selectTool("select");
  updateHistoryUI();
  renderCanvas();
}

// ─── Geometric Hit Testing & Selection ───────────────────────────────

function distSq(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return dx * dx + dy * dy;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const l2 = distSq(x1, y1, x2, y2);
  if (l2 === 0) return Math.sqrt(distSq(px, py, x1, y1));
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt(distSq(px, py, x1 + t * (x2 - x1), y1 + t * (y2 - y1)));
}

function hitTestShape(x, y) {
  // Test in reverse order (topmost shape first)
  for (let i = _shapes.length - 1; i >= 0; i--) {
    const s = _shapes[i];
    if (s.type === "arrow") {
      if (distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) <= Math.max(14, (s.lineWidth || 4.5) * 2)) {
        return i;
      }
    } else if (isBoxShape(s)) {
      const minX = Math.min(s.x1, s.x2);
      const maxX = Math.max(s.x1, s.x2);
      const minY = Math.min(s.y1, s.y2);
      const maxY = Math.max(s.y1, s.y2);
      if (x >= minX - 8 && x <= maxX + 8 && y >= minY - 8 && y <= maxY + 8) {
        return i;
      }
    } else if (s.type === "counter") {
      if (Math.sqrt(distSq(x, y, s.x, s.y)) <= 24) {
        return i;
      }
    } else if (s.type === "text") {
      const fontSize = s.fontSize || 24;
      const textW = s.width || (s.text ? Math.max(40, s.text.length * (fontSize * 0.6)) : 140);
      const textH = s.height || Math.round(fontSize * 1.3);
      if (x >= s.x - 12 && x <= s.x + textW + 12 && y >= s.y - 8 && y <= s.y + textH + 8) {
        return i;
      }
    } else if (s.type === "pen" && s.points) {
      for (let p = 0; p < s.points.length - 1; p++) {
        if (distToSegment(x, y, s.points[p].x, s.points[p].y, s.points[p + 1].x, s.points[p + 1].y) <= Math.max(12, (s.lineWidth || 4.5) / 2 + 4)) {
          return i;
        }
      }
    }
  }
  return -1;
}

function getHandleHitRadius() {
  if (!_annotateCanvas) return 14;
  const rect = _annotateCanvas.getBoundingClientRect();
  const scale = _annotateCanvas.width / (rect.width || 1);
  return Math.max(14, Math.round(14 * scale));
}

function hitTestCrop(x, y) {
  if (!_cropRect || _currentTool !== "crop") return null;
  const { x: cx, y: cy, width: cw, height: ch } = _cropRect;
  const hitR = getHandleHitRadius();

  // 8 handles in order of precision: corners first, then edge midpoints
  if (Math.hypot(x - cx, y - cy) <= hitR) return "crop-tl";
  if (Math.hypot(x - (cx + cw), y - cy) <= hitR) return "crop-tr";
  if (Math.hypot(x - (cx + cw), y - (cy + ch)) <= hitR) return "crop-br";
  if (Math.hypot(x - cx, y - (cy + ch)) <= hitR) return "crop-bl";

  if (Math.hypot(x - (cx + cw / 2), y - cy) <= hitR) return "crop-t";
  if (Math.hypot(x - (cx + cw), y - (cy + ch / 2)) <= hitR) return "crop-r";
  if (Math.hypot(x - (cx + cw / 2), y - (cy + ch)) <= hitR) return "crop-b";
  if (Math.hypot(x - cx, y - (cy + ch / 2)) <= hitR) return "crop-l";

  // Inside crop rectangle: move action
  if (x >= cx && x <= cx + cw && y >= cy && y <= cy + ch) return "crop-move";

  return null;
}

function hitTestHandles(x, y) {
  if (_selectedShapeIndex === -1 || !_shapes[_selectedShapeIndex]) return null;
  const s = _shapes[_selectedShapeIndex];
  const hitR = getHandleHitRadius();

  if (s.type === "arrow") {
    if (Math.hypot(x - s.x1, y - s.y1) <= hitR) return "arrow-start";
    if (Math.hypot(x - s.x2, y - s.y2) <= hitR) return "arrow-end";
  } else if (isBoxShape(s)) {
    const minX = Math.min(s.x1, s.x2);
    const maxX = Math.max(s.x1, s.x2);
    const minY = Math.min(s.y1, s.y2);
    const maxY = Math.max(s.y1, s.y2);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    if (Math.hypot(x - minX, y - minY) <= hitR) return "rect-tl";
    if (Math.hypot(x - maxX, y - minY) <= hitR) return "rect-tr";
    if (Math.hypot(x - maxX, y - maxY) <= hitR) return "rect-br";
    if (Math.hypot(x - minX, y - maxY) <= hitR) return "rect-bl";

    if (Math.hypot(x - midX, y - minY) <= hitR) return "rect-t";
    if (Math.hypot(x - maxX, y - midY) <= hitR) return "rect-r";
    if (Math.hypot(x - midX, y - maxY) <= hitR) return "rect-b";
    if (Math.hypot(x - minX, y - midY) <= hitR) return "rect-l";
  } else if (s.type === "text") {
    const fontSize = s.fontSize || 24;
    const boxW = Math.max(30, s.width || 120) + 12;
    const boxH = (s.height || Math.round(fontSize * 1.25)) + 8;
    const tlX = s.x - 6;
    const tlY = s.y - 4;
    const brX = tlX + boxW;
    const brY = tlY + boxH;

    if (Math.hypot(x - brX, y - brY) <= hitR) return "text-br";
    if (Math.hypot(x - brX, y - tlY) <= hitR) return "text-tr";
    if (Math.hypot(x - tlX, y - brY) <= hitR) return "text-bl";
    if (Math.hypot(x - tlX, y - tlY) <= hitR) return "text-tl";
  }
  return null;
}

// ─── Canvas Rendering & Arrow Drawing ────────────────────────────────

function renderCanvas() {
  if (!_annotateCanvas || !_baseImage) return;

  const w = _baseImage.naturalWidth || _baseImage.width;
  const h = _baseImage.naturalHeight || _baseImage.height;

  if (_annotateCanvas.width !== w || _annotateCanvas.height !== h) {
    _annotateCanvas.width = w;
    _annotateCanvas.height = h;
    _annotateCtx = _annotateCanvas.getContext("2d", { willReadFrequently: true });
  }

  if (!_annotateCtx) {
    _annotateCtx = _annotateCanvas.getContext("2d", { willReadFrequently: true });
  }

  _annotateCtx.clearRect(0, 0, w, h);
  _annotateCtx.drawImage(_baseImage, 0, 0, w, h);

  // Render all committed shapes
  for (let i = 0; i < _shapes.length; i++) {
    const s = _shapes[i];
    if (s.type !== "clear-canvas") {
      drawShape(_annotateCtx, s, i === _selectedShapeIndex);
    }
  }

  // Render live preview shape
  if (_activeShape) {
    drawShape(_annotateCtx, _activeShape, false);
  }
  updateStageInfo();

  if (_hoverShapeIndex !== -1 && _shapes[_hoverShapeIndex] && !_isDrawing) {
    drawHoverOutline(_annotateCtx, _shapes[_hoverShapeIndex], w);
  }

  // Render Crop Overlay
  if (_currentTool === "crop" && _cropRect) {
    drawCropOverlay(_annotateCtx);
  }
}

/** Axis-aligned bounds of a shape, padded for its stroke. */
function shapeBounds(s) {
  const pad = (s.lineWidth || 4) / 2 + 4;
  if (s.type === "pen" && s.points?.length) {
    const xs = s.points.map((p) => p.x);
    const ys = s.points.map((p) => p.y);
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }
  if (s.type === "counter") return { x: s.x - 22, y: s.y - 22, w: 44, h: 44 };
  if (s.type === "text") return { x: s.x - 6, y: s.y - 6, w: (s.width || 40) + 12, h: (s.height || 30) + 12 };
  const x = Math.min(s.x1, s.x2) - pad;
  const y = Math.min(s.y1, s.y2) - pad;
  return { x, y, w: Math.abs(s.x2 - s.x1) + pad * 2, h: Math.abs(s.y2 - s.y1) + pad * 2 };
}

function drawHoverOutline(ctx, s, canvasWidth) {
  const b = shapeBounds(s);
  const unit = Math.max(1, canvasWidth / 1400);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.lineWidth = 1.5 * unit;
  ctx.setLineDash([5 * unit, 4 * unit]);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(b.x, b.y, b.w, b.h, 6 * unit);
  else ctx.rect(b.x, b.y, b.w, b.h);
  ctx.stroke();
  ctx.lineDashOffset = 5 * unit;
  ctx.strokeStyle = "rgba(37,99,235,0.95)";
  ctx.stroke();
  ctx.restore();
}

function drawShape(ctx, s, isSelected = false) {
  ctx.save();
  if (typeof s.opacity === "number") {
    ctx.globalAlpha = s.opacity;
  }

  if (s.type === "arrow") {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    const lw = s.lineWidth || 4.5;
    ctx.lineWidth = lw;

    const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    const headLen = Math.max(16, lw * 3.8);

    // Extend shaft line securely inside the arrowhead body so no hollow/gap appears at notch
    const shaftEndX = s.x2 - headLen * 0.42 * Math.cos(angle);
    const shaftEndY = s.y2 - headLen * 0.42 * Math.sin(angle);

    const head = s.head || "end";
    const tailHead = head === "both";
    const tipHead = head !== "none";
    const startX = tailHead ? s.x1 + headLen * 0.42 * Math.cos(angle) : s.x1;
    const startY = tailHead ? s.y1 + headLen * 0.42 * Math.sin(angle) : s.y1;
    const endX = tipHead ? shaftEndX : s.x2;
    const endY = tipHead ? shaftEndY : s.y2;

    // Shaft line
    ctx.beginPath();
    ctx.lineCap = s.dash && s.dash !== "solid" ? "round" : tipHead ? "butt" : "round";
    applyDash(ctx, s);
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Round cap at a bare tail
    if (!tailHead && (!s.dash || s.dash === "solid")) {
      ctx.beginPath();
      ctx.arc(s.x1, s.y1, lw / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Razor-sharp arrowhead polygon with zero protruding nub
    const drawHead = (tx, ty, a) => {
      ctx.beginPath();
      ctx.lineJoin = "miter";
      ctx.miterLimit = 4;
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - headLen * Math.cos(a - Math.PI / 6.8), ty - headLen * Math.sin(a - Math.PI / 6.8));
      ctx.lineTo(tx - headLen * 0.68 * Math.cos(a), ty - headLen * 0.68 * Math.sin(a));
      ctx.lineTo(tx - headLen * Math.cos(a + Math.PI / 6.8), ty - headLen * Math.sin(a + Math.PI / 6.8));
      ctx.closePath();
      ctx.fill();
    };
    if (tipHead) drawHead(s.x2, s.y2, angle);
    if (tailHead) drawHead(s.x1, s.y1, angle + Math.PI);

    // Render interactive control handles if selected
    if (isSelected) {
      drawHandleCircle(ctx, s.x1, s.y1);
      drawHandleCircle(ctx, s.x2, s.y2);
    }
  } else if (s.type === "rect" || s.type === "ellipse") {
    const lw = s.lineWidth || 4.5;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = lw;
    ctx.lineJoin = "round";

    const x = Math.min(s.x1, s.x2);
    const y = Math.min(s.y1, s.y2);
    const w = Math.abs(s.x2 - s.x1);
    const h = Math.abs(s.y2 - s.y1);

    ctx.beginPath();
    if (s.type === "ellipse") {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else if (typeof ctx.roundRect === "function") {
      // Corner radius follows the stroke so thin and heavy outlines both look intentional.
      ctx.roundRect(x, y, w, h, Math.max(0, Math.min(lw * 1.25 + 2, w / 2, h / 2)));
    } else {
      ctx.rect(x, y, w, h);
    }

    if (s.fill) {
      ctx.save();
      ctx.globalAlpha *= 0.22;
      ctx.fillStyle = s.color;
      ctx.fill();
      ctx.restore();
    }
    applyDash(ctx, s);
    ctx.stroke();
    ctx.setLineDash([]);

    if (isSelected) drawBoxHandles(ctx, x, y, w, h);
  } else if (s.type === "counter") {
    const radius = 18;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
    ctx.fill();

    // High-contrast border & text
    const isLight = s.color === "#FFFFFF" || s.color === "#F59E0B" || s.color?.toLowerCase() === "#ffffff";
    ctx.strokeStyle = isLight ? "#BA4B5C" : "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Text number
    ctx.fillStyle = isLight ? "#18181b" : "#ffffff";
    ctx.font = "bold 18px 'Google Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(s.number), s.x, s.y + 1);

    if (isSelected) {
      drawSelectionFrame(ctx, s.x - radius - 5, s.y - radius - 5, radius * 2 + 10, radius * 2 + 10, true);
    }
  } else if (s.type === "blur") {
    const x = Math.min(s.x1, s.x2);
    const y = Math.min(s.y1, s.y2);
    const w = Math.abs(s.x2 - s.x1);
    const h = Math.abs(s.y2 - s.y1);

    // A redaction must never be see-through, whatever the opacity slider says.
    ctx.globalAlpha = 1;

    if (w > 4 && h > 4) {
      if (s.fill) {
        // Solid bar: destroys the pixels outright. Use this for secrets.
        ctx.fillStyle = "#0b0b0f";
        ctx.fillRect(x, y, w, h);
      } else {
        try {
          if (!_scratchBlurCanvas) {
            _scratchBlurCanvas = document.createElement("canvas");
            _scratchBlurCtx = _scratchBlurCanvas.getContext("2d", { willReadFrequently: true });
          }
          // Mosaic cells scale with the region so that at most ~5 cells span
          // its short side: large type is destroyed as thoroughly as small type.
          const cell = Math.max(12, Math.min(64, Math.round(Math.min(w, h) / 5)));
          const sw = Math.max(1, Math.round(w / cell));
          const sh = Math.max(1, Math.round(h / cell));
          if (_scratchBlurCanvas.width !== sw || _scratchBlurCanvas.height !== sh) {
            _scratchBlurCanvas.width = sw;
            _scratchBlurCanvas.height = sh;
          }

          // Downscale (averaging) to the scratch canvas, then blit back without smoothing.
          _scratchBlurCtx.clearRect(0, 0, sw, sh);
          _scratchBlurCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, sw, sh);

          ctx.save();
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(_scratchBlurCanvas, 0, 0, sw, sh, x, y, w, h);
          ctx.restore();
        } catch {
          ctx.fillStyle = "rgb(100, 100, 110)";
          ctx.fillRect(x, y, w, h);
        }
      }
    }
    if (isSelected) drawBoxHandles(ctx, x, y, w, h);
  } else if (s.type === "pen") {
    if (s.points && s.points.length > 1) {
      const lw = s.lineWidth || 4.5;
      const pts = s.points;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = lw;
      ctx.lineJoin = "round";
      ctx.lineCap = s.blend ? "butt" : "round";
      if (s.blend) ctx.globalCompositeOperation = s.blend;

      const opaque = (typeof s.opacity !== "number" || s.opacity >= 1) && !s.blend;
      if (s.pressure && opaque && pts.length > 2) {
        // Simulated pressure: each smoothed segment carries its own width.
        // Only for opaque ink, where overlapping round caps are invisible.
        let px = pts[0].x;
        let py = pts[0].y;
        for (let i = 1; i < pts.length; i++) {
          const last = i === pts.length - 1;
          const ex = last ? pts[i].x : (pts[i].x + pts[i + 1].x) / 2;
          const ey = last ? pts[i].y : (pts[i].y + pts[i + 1].y) / 2;
          ctx.beginPath();
          ctx.lineWidth = lw * (pts[i].p || 1);
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, ex, ey);
          ctx.stroke();
          px = ex;
          py = ey;
        }
      } else {
        // One continuous path through segment midpoints (quadratic Bézier smoothing).
        if (!s.blend) applyDash(ctx, s);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (isSelected) {
        ctx.globalCompositeOperation = "source-over";
        const b = shapeBounds(s);
        if (b) drawSelectionFrame(ctx, b.x, b.y, b.w, b.h);
      }
    }
  } else if (s.type === "text") {
    const fontSize = s.fontSize || 28;
    ctx.font = textFont(s);
    ctx.textBaseline = "top";
    const metrics = ctx.measureText(s.text);
    s.width = metrics.width;
    s.height = Math.round(fontSize * 1.25);

    if (s.fill) {
      // Background pill in the chosen colour, text in whichever of black/white reads best.
      const padX = Math.round(fontSize * 0.42);
      const padY = Math.round(fontSize * 0.16);
      const bx = s.x - padX;
      const by = s.y - padY;
      const bw = s.width + padX * 2;
      const bh = s.height + padY * 2;
      ctx.fillStyle = s.color;
      ctx.shadowColor = "rgba(0,0,0,0.28)";
      ctx.shadowBlur = Math.max(4, fontSize * 0.22);
      ctx.shadowOffsetY = Math.max(1, fontSize * 0.06);
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") ctx.roundRect(bx, by, bw, bh, Math.min(bh / 2, fontSize * 0.5));
      else ctx.rect(bx, by, bw, bh);
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      ctx.fillStyle = luminance(s.color) > 0.6 ? "#111318" : "#ffffff";
      ctx.fillText(s.text, s.x, s.y + Math.round(fontSize * 0.06));
    } else {
      ctx.fillStyle = s.color;
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 3;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1.5;
      ctx.fillText(s.text, s.x, s.y);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }

    if (isSelected) {
      const boxW = Math.max(30, metrics.width) + 12;
      const boxH = s.height + 8;
      drawSelectionFrame(ctx, s.x - 6, s.y - 4, boxW, boxH);
      drawHandleCircle(ctx, s.x - 6, s.y - 4);
      drawHandleCircle(ctx, s.x - 6 + boxW, s.y - 4);
      drawHandleCircle(ctx, s.x - 6 + boxW, s.y - 4 + boxH);
      drawHandleCircle(ctx, s.x - 6, s.y - 4 + boxH);
    }
  }

  ctx.restore();
}

/** A crisp frame around the selection, constant on screen whatever the zoom. */
function drawSelectionFrame(ctx, x, y, w, h, round = false) {
  const rect = _annotateCanvas?.getBoundingClientRect();
  const scale = rect ? _annotateCanvas.width / (rect.width || 1) : 1;
  const pad = 4 * scale;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.setLineDash([]);
  ctx.beginPath();
  if (round) ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (typeof ctx.roundRect === "function") ctx.roundRect(x - pad, y - pad, w + pad * 2, h + pad * 2, 6 * scale);
  else ctx.rect(x - pad, y - pad, w + pad * 2, h + pad * 2);
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.stroke();
  ctx.lineWidth = 1.5 * scale;
  ctx.strokeStyle = "#2563EB";
  ctx.stroke();
  ctx.restore();
}

function drawBoxHandles(ctx, x, y, w, h) {
  drawSelectionFrame(ctx, x, y, w, h);
  drawHandleCircle(ctx, x, y);
  drawHandleCircle(ctx, x + w, y);
  drawHandleCircle(ctx, x + w, y + h);
  drawHandleCircle(ctx, x, y + h);
  if (w > 20) {
    drawHandleCircle(ctx, x + w / 2, y);
    drawHandleCircle(ctx, x + w / 2, y + h);
  }
  if (h > 20) {
    drawHandleCircle(ctx, x, y + h / 2);
    drawHandleCircle(ctx, x + w, y + h / 2);
  }
}

function drawHandleCircle(ctx, x, y) {
  const rect = _annotateCanvas?.getBoundingClientRect();
  const scale = rect ? _annotateCanvas.width / (rect.width || 1) : 1;
  // Rounded-square handles, the same size on screen at any zoom: white body,
  // blue rim, soft shadow, so they read on light and dark captures alike.
  const size = 10 * scale;
  const lw = 1.75 * scale;

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.setLineDash([]);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#2563EB";
  ctx.lineWidth = lw;
  ctx.shadowColor = "rgba(15,23,42,0.35)";
  ctx.shadowBlur = 5 * scale;
  ctx.shadowOffsetY = 1 * scale;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x - size / 2, y - size / 2, size, size, 3 * scale);
  else ctx.rect(x - size / 2, y - size / 2, size, size);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.stroke();
  ctx.restore();
}

function drawCropOverlay(ctx) {
  const { width, height } = _annotateCanvas;
  const { x, y, width: cw, height: ch } = _cropRect;
  const rect = _annotateCanvas.getBoundingClientRect();
  const scale = _annotateCanvas.width / (rect.width || 1);

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";

  // Dim 4 areas outside crop rectangle
  ctx.fillRect(0, 0, width, y);
  ctx.fillRect(0, y, x, ch);
  ctx.fillRect(x + cw, y, width - (x + cw), ch);
  ctx.fillRect(0, y + ch, width, height - (y + ch));

  // Subtle Rule-of-Thirds Grid inside crop
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = Math.max(1, Math.round(1 * scale));
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x + cw / 3, y);
  ctx.lineTo(x + cw / 3, y + ch);
  ctx.moveTo(x + (cw * 2) / 3, y);
  ctx.lineTo(x + (cw * 2) / 3, y + ch);
  ctx.moveTo(x, y + ch / 3);
  ctx.lineTo(x + cw, y + ch / 3);
  ctx.moveTo(x, y + (ch * 2) / 3);
  ctx.lineTo(x + cw, y + (ch * 2) / 3);
  ctx.stroke();

  // Crisp dashed crop boundary
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(1.8, Math.round(1.8 * scale));
  ctx.setLineDash([Math.round(6 * scale), Math.round(4 * scale)]);
  ctx.strokeRect(x, y, cw, ch);

  // 8 handles (corners + edge centers)
  const handles = [
    { hx: x, hy: y },
    { hx: x + cw / 2, hy: y },
    { hx: x + cw, hy: y },
    { hx: x + cw, hy: y + ch / 2 },
    { hx: x + cw, hy: y + ch },
    { hx: x + cw / 2, hy: y + ch },
    { hx: x, hy: y + ch },
    { hx: x, hy: y + ch / 2 },
  ];

  ctx.setLineDash([]);
  handles.forEach((h) => drawHandleCircle(ctx, h.hx, h.hy));

  ctx.restore();
}

// ─── Pointer Event Handlers ──────────────────────────────────────────

function getCanvasCoords(e) {
  if (!_annotateCanvas) return { x: 0, y: 0 };
  const rect = _annotateCanvas.getBoundingClientRect();
  const scaleX = _annotateCanvas.width / (rect.width || 1);
  const scaleY = _annotateCanvas.height / (rect.height || 1);

  return {
    x: Math.round((e.clientX - rect.left) * scaleX),
    y: Math.round((e.clientY - rect.top) * scaleY),
  };
}

function getScreenCoords(canvasX, canvasY) {
  const rect = _annotateCanvas.getBoundingClientRect();
  const scaleX = rect.width / _annotateCanvas.width;
  const scaleY = rect.height / _annotateCanvas.height;
  return {
    x: Math.round(rect.left + canvasX * scaleX),
    y: Math.round(rect.top + canvasY * scaleY),
  };
}

function spawnInlineTextInput(canvasX, canvasY, existingShape = null) {
  if (_textInputOverlay) {
    try {
      if (_textInputOverlay.parentNode) {
        _textInputOverlay.parentNode.removeChild(_textInputOverlay);
      }
    } catch {}
    _textInputOverlay = null;
  }
  const targetX = existingShape ? existingShape.x : canvasX;
  const targetY = existingShape ? existingShape.y : canvasY;
  const pos = getScreenCoords(targetX, targetY);

  const rect = _annotateCanvas?.getBoundingClientRect();
  const scale = rect ? rect.width / (_annotateCanvas.width || 1) : 1;
  // Same mapping as resizing a selected text (14 + width × 3.5).
  const baseFontSize = existingShape ? existingShape.fontSize || 28 : Math.round(14 + _currentLineWidth * 3.5);
  const fontSpec = existingShape || { font: _textFont, bold: _textBold, italic: _textItalic };
  const screenFontSize = Math.max(14, Math.round(baseFontSize * scale));

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type text...";
  if (existingShape) {
    input.value = existingShape.text;
  }
  input.style.cssText = `
    position: fixed;
    left: ${pos.x - 6}px;
    top: ${pos.y - 4}px;
    z-index: 2147483649;
    font-family: ${TEXT_FONTS[fontSpec.font] || TEXT_FONTS.sans};
    font-size: ${screenFontSize}px;
    font-weight: ${fontSpec.bold === false ? 500 : 700};
    font-style: ${fontSpec.italic ? "italic" : "normal"};
    line-height: 1.25;
    color: ${existingShape ? existingShape.color : _currentColor};
    background: rgba(18, 18, 24, 0.88);
    backdrop-filter: blur(14px) saturate(160%);
    -webkit-backdrop-filter: blur(14px) saturate(160%);
    border: 1.5px solid rgba(255, 255, 255, 0.45);
    border-radius: 8px;
    padding: 3px 8px;
    outline: none;
    box-shadow: 0 8px 24px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.25);
    min-width: 140px;
    max-width: 90vw;
  `;
  _annotateHost.appendChild(input);
  _textInputOverlay = input;

  function commitText() {
    if (!input || !input.parentNode) return;
    const val = input.value.trim();
    if (val) {
      if (existingShape) {
        const prevText = existingShape.text;
        existingShape.text = val;
        _undoStack.push({
          type: "edit-text",
          shape: existingShape,
          prevText,
          nextText: val,
        });
        _redoStack = [];
      } else {
        const s = {
          type: "text",
          x: targetX,
          y: targetY,
          text: val,
          color: _currentColor,
          fontSize: baseFontSize,
          opacity: _currentOpacity,
          fill: _fillEnabled,
          font: _textFont,
          bold: _textBold,
          italic: _textItalic,
        };
        _shapes.push(s);
        _undoStack.push({ type: "add", shape: s });
        _redoStack = [];
        _selectedShapeIndex = _shapes.length - 1;
      }
      updateHistoryUI();
      renderCanvas();
      selectTool("select");
    }
    try {
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    } catch {}
    if (_textInputOverlay === input) _textInputOverlay = null;
  }

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      commitText();
    } else if (e.key === "Escape") {
      try {
        if (input.parentNode) {
          input.parentNode.removeChild(input);
        }
      } catch {}
      if (_textInputOverlay === input) _textInputOverlay = null;
    }
  });

  input.addEventListener("blur", () => {
    commitText();
  });

  input.addEventListener("pointerdown", (e) => e.stopPropagation());

  setTimeout(() => {
    input.focus();
    if (existingShape) {
      input.select();
    }
  }, 20);
}

function onCanvasPointerDown(e) {
  if (e.button !== 0) return;
  dismissLingeringMainMenu();
  const { x, y } = getCanvasCoords(e);

  // Second click of a click-to-click highlight: finish it here.
  if (_hlPending && _activeShape) {
    const pts = _activeShape.points;
    const end = pts[pts.length - 1];
    if (Math.hypot(end.x - pts[0].x, end.y - pts[0].y) < 4) {
      cancelPendingHighlight();
    } else {
      commitActiveShape();
      _selectedShapeIndex = -1;
      renderCanvas();
    }
    return;
  }

  // 1. Crop Mode interactions
  if (_currentTool === "crop" && _cropRect) {
    const action = hitTestCrop(x, y);
    if (action) {
      _dragAction = action;
    } else {
      // Start new crop box
      _cropRect = { x, y, width: 0, height: 0 };
      _dragAction = "crop-new";
    }

    _dragStartPos = { x, y };
    _shapeStartSnapshot = { ..._cropRect };
    _isDrawing = true;
    return;
  }

  // 2. Select / Move Tool interactions or Handle manipulation
  const handleType = isFreehandTool() ? null : hitTestHandles(x, y);
  if (handleType) {
    _dragAction = handleType;
    _dragStartPos = { x, y };
    _shapeStartSnapshot = JSON.parse(JSON.stringify(_shapes[_selectedShapeIndex]));
    _isDrawing = true;
    return;
  }

  const hitIndex = hitTestShape(x, y);

  if (_currentTool === "select") {
    _selectedShapeIndex = hitIndex;
    adoptSelectedStyle();
    if (_selectedShapeIndex !== -1) {
      _dragAction = "move";
      _dragStartPos = { x, y };
      _shapeStartSnapshot = JSON.parse(JSON.stringify(_shapes[_selectedShapeIndex]));
      _isDrawing = true;
    }
    renderCanvas();
    return;
  }

  // With a drawing tool armed, only the shape that is already selected can be
  // grabbed. Anything else is drawn over, so a redaction or arrow can start on
  // top of earlier marks. Use Select (V) to pick up other shapes.
  if (hitIndex !== -1 && hitIndex === _selectedShapeIndex && !isFreehandTool()) {
    _dragAction = "move";
    _dragStartPos = { x, y };
    _shapeStartSnapshot = JSON.parse(JSON.stringify(_shapes[_selectedShapeIndex]));
    _isDrawing = true;
    renderCanvas();
    return;
  }

  _selectedShapeIndex = -1;

  // 3. Drawing new shape
  if (_currentTool === "counter") {
    const s = {
      type: "counter",
      x,
      y,
      number: _stepCounter++,
      color: _currentColor,
      opacity: _currentOpacity,
    };
    _shapes.push(s);
    _undoStack.push({ type: "add", shape: s });
    _selectedShapeIndex = _shapes.length - 1;
    _redoStack = [];
    updateHistoryUI();
    renderCanvas();
    // Keep counter tool active so user can stamp 1, 2, 3 consecutively
    return;
  }

  if (_currentTool === "text") {
    spawnInlineTextInput(x, y);
    return;
  }

  _isDrawing = true;
  _dragAction = "create";
  if (_currentTool === "pen") {
    _activeShape = {
      type: "pen",
      points: [{ x, y, p: 1 }],
      color: _currentColor,
      lineWidth: _currentLineWidth,
      opacity: _currentOpacity,
      pressure: _currentDash === "solid",
      dash: _currentDash,
    };
  } else if (_currentTool === "highlighter") {
    // Multiply tints light pages like a real marker. On dark pages multiply
    // would vanish, so the stroke lightens instead.
    let blend = "multiply";
    try {
      const px = _annotateCtx.getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data;
      if ((0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) / 255 < 0.35) blend = "screen";
    } catch {}
    // Fit the stroke to the line of text under the pointer (Alt: freehand).
    const fit = e.altKey ? null : fitTextLine(x, y);
    const cy = fit ? fit.cy : y;
    _activeShape = {
      type: "pen",
      points: [{ x, y: cy }],
      color: _currentColor,
      lineWidth: fit ? fitWidth(fit.h) : _currentLineWidth,
      opacity: _currentOpacity,
      blend,
      _raw: [{ x, y }],
      _free: !!e.altKey,
      _userLw: _currentLineWidth,
      _cy: cy,
      _sy: y,
    };
  } else {
    _activeShape = {
      type: _currentTool,
      x1: x,
      y1: y,
      x2: x,
      y2: y,
      color: _currentColor,
      lineWidth: _currentLineWidth,
      opacity: _currentOpacity,
    };
    if (_currentTool === "arrow" || _currentTool === "rect" || _currentTool === "ellipse") _activeShape.dash = _currentDash;
    if (_currentTool === "arrow") _activeShape.head = _currentHead;
    if (_fillEnabled && (_currentTool === "rect" || _currentTool === "ellipse" || _currentTool === "blur")) {
      _activeShape.fill = true;
    }
  }
}

/** Selecting a shape loads its style into the toolbar, so tweaks start from what you see. */
function adoptSelectedStyle() {
  const shape = _shapes[_selectedShapeIndex];
  if (!shape) return;
  if (shape.color) _currentColor = shape.color;
  if (isBoxShape(shape) || shape.type === "text") _fillEnabled = !!shape.fill;
  // A highlighter stroke loads the highlighter's style slot, so its wide,
  // translucent look never becomes the pen's next stroke.
  switchStyleKind(shape.blend ? "marker" : "ink");
  if (shape.dash) _currentDash = shape.dash;
  if (shape.head) _currentHead = shape.head;
  if (shape.type === "text") {
    _textFont = shape.font || "sans";
    _textBold = shape.bold !== false;
    _textItalic = !!shape.italic;
  }
  if (typeof shape.lineWidth === "number") _currentLineWidth = shape.lineWidth;
  if (typeof shape.opacity === "number" && shape.type !== "blur") _currentOpacity = shape.opacity;
  _syncStyleUI();
}

/** What a press at (x, y) would grab. Hover cursors use the same rule as clicks. */
function grabAt(x, y) {
  if (_currentTool === "crop" || isFreehandTool()) return null;
  const handle = hitTestHandles(x, y);
  if (handle) return { kind: "handle", handle };
  const hit = hitTestShape(x, y);
  if (hit === -1) return null;
  if (_currentTool === "select" || hit === _selectedShapeIndex) return { kind: "move", index: hit };
  return null;
}

function handleCursor(handle) {
  if (["rect-tl", "rect-br", "text-br", "text-tl"].includes(handle)) return "nwse-resize";
  if (["rect-tr", "rect-bl", "text-tr", "text-bl"].includes(handle)) return "nesw-resize";
  if (handle === "rect-t" || handle === "rect-b") return "ns-resize";
  if (handle === "rect-l" || handle === "rect-r") return "ew-resize";
  return "grab";
}

function setHoverShape(index) {
  if (_hoverShapeIndex === index) return;
  _hoverShapeIndex = index;
  renderCanvas();
}

function onCanvasPointerMove(e) {
  const { x, y } = getCanvasCoords(e);

  if (!_isDrawing) {
    // Click-to-click highlight: the stroke follows the pointer until the
    // second click. Level while the pointer stays near the line, any angle
    // once it leaves (Shift: 45° steps).
    if (_hlPending && _activeShape) {
      const a = _activeShape;
      const start = a.points[0];
      const tol = Math.max(12, a.lineWidth * 0.8);
      let end;
      if (e.shiftKey) end = constrainPoint(start.x, start.y, x, y, "line");
      else if (!e.altKey && Math.abs(y - a._sy) <= tol) end = { x, y: start.y };
      else end = { x, y };
      a.points = [start, { x: end.x, y: end.y }];
      renderCanvas();
      return;
    }
    // pointermove is on window: ignore hovers over the toolbar or popover.
    if (e.target !== _annotateCanvas) {
      setHoverShape(-1);
      return;
    }
    // Cursor hover update
    if (_currentTool === "crop") {
      const cropAction = hitTestCrop(x, y);
      if (cropAction === "crop-tl" || cropAction === "crop-br") {
        _annotateCanvas.style.cursor = "nwse-resize";
      } else if (cropAction === "crop-tr" || cropAction === "crop-bl") {
        _annotateCanvas.style.cursor = "nesw-resize";
      } else if (cropAction === "crop-t" || cropAction === "crop-b") {
        _annotateCanvas.style.cursor = "ns-resize";
      } else if (cropAction === "crop-l" || cropAction === "crop-r") {
        _annotateCanvas.style.cursor = "ew-resize";
      } else if (cropAction === "crop-move") {
        _annotateCanvas.style.cursor = "move";
      } else {
        _annotateCanvas.style.cursor = "crosshair";
      }
      return;
    }
    const grab = grabAt(x, y);
    if (!grab) {
      _annotateCanvas.style.cursor = getToolCursor(_currentTool);
      setHoverShape(-1);
    } else if (grab.kind === "handle") {
      _annotateCanvas.style.cursor = handleCursor(grab.handle);
      setHoverShape(-1);
    } else {
      _annotateCanvas.style.cursor = "move";
      // Outline what a click would pick up (only in Select; a selected shape
      // already shows its handles).
      setHoverShape(grab.index === _selectedShapeIndex ? -1 : grab.index);
    }
    return;
  }

  const dx = x - _dragStartPos.x;
  const dy = y - _dragStartPos.y;

  // Dragging crop with all 8 handles supported
  if (_currentTool === "crop" && _cropRect && _shapeStartSnapshot) {
    const s = _shapeStartSnapshot;
    const minSize = 20;
    const maxW = _annotateCanvas.width;
    const maxH = _annotateCanvas.height;

    if (_dragAction === "crop-move") {
      _cropRect.x = Math.max(0, Math.min(maxW - s.width, s.x + dx));
      _cropRect.y = Math.max(0, Math.min(maxH - s.height, s.y + dy));
    } else if (_dragAction === "crop-new") {
      if (_cropAspectRatio) {
        const dragW = x - _dragStartPos.x;
        const dragH = y - _dragStartPos.y;
        const dirX = dragW >= 0 ? 1 : -1;
        const dirY = dragH >= 0 ? 1 : -1;
        let w = Math.abs(dragW);
        let h = w / _cropAspectRatio;
        if (Math.abs(dragH) > Math.abs(dragW)) {
          h = Math.abs(dragH);
          w = h * _cropAspectRatio;
        }
        if (dirX > 0) {
          w = Math.min(w, maxW - _dragStartPos.x);
        } else {
          w = Math.min(w, _dragStartPos.x);
        }
        if (dirY > 0) {
          h = Math.min(h, maxH - _dragStartPos.y);
        } else {
          h = Math.min(h, _dragStartPos.y);
        }
        if (w / h > _cropAspectRatio) {
          w = h * _cropAspectRatio;
        } else {
          h = w / _cropAspectRatio;
        }
        const minW = _cropAspectRatio >= 1 ? minSize * _cropAspectRatio : minSize;
        const minH = _cropAspectRatio >= 1 ? minSize : minSize / _cropAspectRatio;
        _cropRect.width = Math.max(minW, Math.round(w));
        _cropRect.height = Math.max(minH, Math.round(h));
        _cropRect.x = dirX > 0 ? _dragStartPos.x : Math.round(_dragStartPos.x - _cropRect.width);
        _cropRect.y = dirY > 0 ? _dragStartPos.y : Math.round(_dragStartPos.y - _cropRect.height);
      } else {
        _cropRect.x = Math.max(0, Math.min(x, _dragStartPos.x));
        _cropRect.y = Math.max(0, Math.min(y, _dragStartPos.y));
        _cropRect.width = Math.min(maxW - _cropRect.x, Math.abs(x - _dragStartPos.x));
        _cropRect.height = Math.min(maxH - _cropRect.y, Math.abs(y - _dragStartPos.y));
      }
    } else if (_dragAction === "crop-tl") {
      if (_cropAspectRatio) {
        const anchorX = s.x + s.width;
        const anchorY = s.y + s.height;
        const availW = anchorX;
        const availH = anchorY;
        const minW = _cropAspectRatio >= 1 ? minSize * _cropAspectRatio : minSize;
        const minH = _cropAspectRatio >= 1 ? minSize : minSize / _cropAspectRatio;
        let w = Math.max(minW, Math.min(availW, s.width - dx));
        let h = w / _cropAspectRatio;
        if (h > availH) {
          h = availH;
          w = h * _cropAspectRatio;
        }
        if (Math.abs(dy) > Math.abs(dx)) {
          h = Math.max(minH, Math.min(availH, s.height - dy));
          w = h * _cropAspectRatio;
          if (w > availW) {
            w = availW;
            h = w / _cropAspectRatio;
          }
        }
        _cropRect.width = Math.round(w);
        _cropRect.height = Math.round(h);
        _cropRect.x = Math.round(anchorX - _cropRect.width);
        _cropRect.y = Math.round(anchorY - _cropRect.height);
      } else {
        const newX = Math.max(0, Math.min(s.x + s.width - minSize, s.x + dx));
        const newY = Math.max(0, Math.min(s.y + s.height - minSize, s.y + dy));
        _cropRect.width = s.width + (s.x - newX);
        _cropRect.height = s.height + (s.y - newY);
        _cropRect.x = newX;
        _cropRect.y = newY;
      }
    } else if (_dragAction === "crop-tr") {
      if (_cropAspectRatio) {
        const anchorX = s.x;
        const anchorY = s.y + s.height;
        const availW = maxW - anchorX;
        const availH = anchorY;
        const minW = _cropAspectRatio >= 1 ? minSize * _cropAspectRatio : minSize;
        const minH = _cropAspectRatio >= 1 ? minSize : minSize / _cropAspectRatio;
        let w = Math.max(minW, Math.min(availW, s.width + dx));
        let h = w / _cropAspectRatio;
        if (h > availH) {
          h = availH;
          w = h * _cropAspectRatio;
        }
        if (Math.abs(dy) > Math.abs(dx)) {
          h = Math.max(minH, Math.min(availH, s.height - dy));
          w = h * _cropAspectRatio;
          if (w > availW) {
            w = availW;
            h = w / _cropAspectRatio;
          }
        }
        _cropRect.width = Math.round(w);
        _cropRect.height = Math.round(h);
        _cropRect.x = anchorX;
        _cropRect.y = Math.round(anchorY - _cropRect.height);
      } else {
        const newY = Math.max(0, Math.min(s.y + s.height - minSize, s.y + dy));
        _cropRect.y = newY;
        _cropRect.height = s.height + (s.y - newY);
        _cropRect.width = Math.max(minSize, Math.min(maxW - s.x, s.width + dx));
      }
    } else if (_dragAction === "crop-br") {
      if (_cropAspectRatio) {
        const availW = maxW - s.x;
        const availH = maxH - s.y;
        const minW = _cropAspectRatio >= 1 ? minSize * _cropAspectRatio : minSize;
        const minH = _cropAspectRatio >= 1 ? minSize : minSize / _cropAspectRatio;
        let w = Math.max(minW, Math.min(availW, s.width + dx));
        let h = w / _cropAspectRatio;
        if (h > availH) {
          h = availH;
          w = h * _cropAspectRatio;
        }
        if (Math.abs(dy) > Math.abs(dx)) {
          h = Math.max(minH, Math.min(availH, s.height + dy));
          w = h * _cropAspectRatio;
          if (w > availW) {
            w = availW;
            h = w / _cropAspectRatio;
          }
        }
        _cropRect.width = Math.round(w);
        _cropRect.height = Math.round(h);
      } else {
        _cropRect.width = Math.max(minSize, Math.min(maxW - s.x, s.width + dx));
        _cropRect.height = Math.max(minSize, Math.min(maxH - s.y, s.height + dy));
      }
    } else if (_dragAction === "crop-bl") {
      if (_cropAspectRatio) {
        const anchorX = s.x + s.width;
        const anchorY = s.y;
        const availW = anchorX;
        const availH = maxH - anchorY;
        const minW = _cropAspectRatio >= 1 ? minSize * _cropAspectRatio : minSize;
        const minH = _cropAspectRatio >= 1 ? minSize : minSize / _cropAspectRatio;
        let w = Math.max(minW, Math.min(availW, s.width - dx));
        let h = w / _cropAspectRatio;
        if (h > availH) {
          h = availH;
          w = h * _cropAspectRatio;
        }
        if (Math.abs(dy) > Math.abs(dx)) {
          h = Math.max(minH, Math.min(availH, s.height + dy));
          w = h * _cropAspectRatio;
          if (w > availW) {
            w = availW;
            h = w / _cropAspectRatio;
          }
        }
        _cropRect.width = Math.round(w);
        _cropRect.height = Math.round(h);
        _cropRect.x = Math.round(anchorX - _cropRect.width);
        _cropRect.y = anchorY;
      } else {
        const newX = Math.max(0, Math.min(s.x + s.width - minSize, s.x + dx));
        _cropRect.x = newX;
        _cropRect.width = s.width + (s.x - newX);
        _cropRect.height = Math.max(minSize, Math.min(maxH - s.y, s.height + dy));
      }
    } else if (_dragAction === "crop-t" || _dragAction === "crop-b" || _dragAction === "crop-l" || _dragAction === "crop-r") {
      if (_cropAspectRatioKey !== "free") {
        _cropAspectRatioKey = "free";
        _cropAspectRatio = null;
        if (_cropControlsEl) {
          _cropControlsEl.querySelectorAll(".qs-crop-ratio-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.ratio === "free");
          });
        }
      }
      if (_dragAction === "crop-t") {
        const newY = Math.max(0, Math.min(s.y + s.height - minSize, s.y + dy));
        _cropRect.y = newY;
        _cropRect.height = s.height + (s.y - newY);
      } else if (_dragAction === "crop-b") {
        _cropRect.height = Math.max(minSize, Math.min(maxH - s.y, s.height + dy));
      } else if (_dragAction === "crop-l") {
        const newX = Math.max(0, Math.min(s.x + s.width - minSize, s.x + dx));
        _cropRect.x = newX;
        _cropRect.width = s.width + (s.x - newX);
      } else if (_dragAction === "crop-r") {
        _cropRect.width = Math.max(minSize, Math.min(maxW - s.x, s.width + dx));
      }
    }
    showCropControls();
    renderCanvas();
    return;
  }

  // Dragging handle or moving selected shape
  if (_selectedShapeIndex !== -1 && _shapes[_selectedShapeIndex] && _shapeStartSnapshot) {
    const s = _shapes[_selectedShapeIndex];
    if (_dragAction === "arrow-start") {
      const pt = e.shiftKey ? constrainPoint(s.x2, s.y2, x, y, "line") : { x, y };
      s.x1 = pt.x;
      s.y1 = pt.y;
    } else if (_dragAction === "arrow-end") {
      const pt = e.shiftKey ? constrainPoint(s.x1, s.y1, x, y, "line") : { x, y };
      s.x2 = pt.x;
      s.y2 = pt.y;
    } else if (_dragAction === "rect-tl") {
      const minX = Math.min(_shapeStartSnapshot.x1, _shapeStartSnapshot.x2);
      const maxX = Math.max(_shapeStartSnapshot.x1, _shapeStartSnapshot.x2);
      const minY = Math.min(_shapeStartSnapshot.y1, _shapeStartSnapshot.y2);
      const maxY = Math.max(_shapeStartSnapshot.y1, _shapeStartSnapshot.y2);
      s.x1 = minX + dx;
      s.y1 = minY + dy;
      s.x2 = maxX;
      s.y2 = maxY;
    } else if (_dragAction === "rect-tr") {
      const minX = Math.min(_shapeStartSnapshot.x1, _shapeStartSnapshot.x2);
      const maxX = Math.max(_shapeStartSnapshot.x1, _shapeStartSnapshot.x2);
      const minY = Math.min(_shapeStartSnapshot.y1, _shapeStartSnapshot.y2);
      const maxY = Math.max(_shapeStartSnapshot.y1, _shapeStartSnapshot.y2);
      s.x1 = minX;
      s.y1 = minY + dy;
      s.x2 = maxX + dx;
      s.y2 = maxY;
    } else if (_dragAction === "rect-br") {
      const minX = Math.min(_shapeStartSnapshot.x1, _shapeStartSnapshot.x2);
      const maxX = Math.max(_shapeStartSnapshot.x1, _shapeStartSnapshot.x2);
      const minY = Math.min(_shapeStartSnapshot.y1, _shapeStartSnapshot.y2);
      const maxY = Math.max(_shapeStartSnapshot.y1, _shapeStartSnapshot.y2);
      s.x1 = minX;
      s.y1 = minY;
      s.x2 = maxX + dx;
      s.y2 = maxY + dy;
    } else if (_dragAction === "rect-bl") {
      const minX = Math.min(_shapeStartSnapshot.x1, _shapeStartSnapshot.x2);
      const maxX = Math.max(_shapeStartSnapshot.x1, _shapeStartSnapshot.x2);
      const minY = Math.min(_shapeStartSnapshot.y1, _shapeStartSnapshot.y2);
      const maxY = Math.max(_shapeStartSnapshot.y1, _shapeStartSnapshot.y2);
      s.x1 = minX + dx;
      s.y1 = minY;
      s.x2 = maxX;
      s.y2 = maxY + dy;
    } else if (_dragAction === "rect-t") {
      const minY = Math.min(_shapeStartSnapshot.y1, _shapeStartSnapshot.y2);
      const maxY = Math.max(_shapeStartSnapshot.y1, _shapeStartSnapshot.y2);
      s.y1 = minY + dy;
      s.y2 = maxY;
    } else if (_dragAction === "rect-b") {
      const minY = Math.min(_shapeStartSnapshot.y1, _shapeStartSnapshot.y2);
      const maxY = Math.max(_shapeStartSnapshot.y1, _shapeStartSnapshot.y2);
      s.y1 = minY;
      s.y2 = maxY + dy;
    } else if (_dragAction === "rect-l") {
      const minX = Math.min(_shapeStartSnapshot.x1, _shapeStartSnapshot.x2);
      const maxX = Math.max(_shapeStartSnapshot.x1, _shapeStartSnapshot.x2);
      s.x1 = minX + dx;
      s.x2 = maxX;
    } else if (_dragAction === "rect-r") {
      const minX = Math.min(_shapeStartSnapshot.x1, _shapeStartSnapshot.x2);
      const maxX = Math.max(_shapeStartSnapshot.x1, _shapeStartSnapshot.x2);
      s.x1 = minX;
      s.x2 = maxX + dx;
    } else if ((_dragAction === "text-br" || _dragAction === "text-tr") && _shapeStartSnapshot) {
      const origFontSize = _shapeStartSnapshot.fontSize || 24;
      const origBoxW = Math.max(30, _shapeStartSnapshot.width || 120);
      const scale = Math.max(0.3, Math.min(5, (origBoxW + dx) / origBoxW));
      s.fontSize = Math.max(12, Math.min(120, Math.round(origFontSize * scale)));
    } else if ((_dragAction === "text-bl" || _dragAction === "text-tl") && _shapeStartSnapshot) {
      const origFontSize = _shapeStartSnapshot.fontSize || 24;
      const origBoxW = Math.max(30, _shapeStartSnapshot.width || 120);
      const scale = Math.max(0.3, Math.min(5, (origBoxW - dx) / origBoxW));
      s.fontSize = Math.max(12, Math.min(120, Math.round(origFontSize * scale)));
    } else if (_dragAction === "move") {
      if (s.type === "arrow" || isBoxShape(s)) {
        s.x1 = _shapeStartSnapshot.x1 + dx;
        s.y1 = _shapeStartSnapshot.y1 + dy;
        s.x2 = _shapeStartSnapshot.x2 + dx;
        s.y2 = _shapeStartSnapshot.y2 + dy;
      } else if (s.type === "counter" || s.type === "text") {
        s.x = _shapeStartSnapshot.x + dx;
        s.y = _shapeStartSnapshot.y + dy;
      } else if (s.type === "pen" && s.points && _shapeStartSnapshot.points) {
        for (let p = 0; p < s.points.length; p++) {
          s.points[p].x = _shapeStartSnapshot.points[p].x + dx;
          s.points[p].y = _shapeStartSnapshot.points[p].y + dy;
        }
      }
    }
    renderCanvas();
    return;
  }

  // Active shape drawing
  if (_activeShape) {
    if (_activeShape.type === "pen") {
      const pts = _activeShape.points;
      const hl = _activeShape._raw ? _activeShape : null;
      if (hl) {
        const last = hl._raw[hl._raw.length - 1];
        if (Math.hypot(x - last.x, y - last.y) >= 1.5) hl._raw.push({ x, y });
        // Leaving the line (or holding Alt) turns the stroke freehand for good.
        const tol = Math.max(9, hl.lineWidth * 0.62);
        if (!hl._free && !e.shiftKey && (e.altKey || Math.abs(y - hl._sy) > tol)) {
          hl._free = true;
          hl.lineWidth = hl._userLw;
          hl.points = hl._raw.map((p) => ({ x: p.x, y: p.y }));
        }
      }
      if (hl && !hl._free && !e.shiftKey) {
        hl.points = [
          { x: hl._raw[0].x, y: hl._cy },
          { x, y: hl._cy },
        ];
      } else if (hl && hl._free && !e.shiftKey) {
        const prev = pts[pts.length - 1];
        if (Math.hypot(x - prev.x, y - prev.y) >= 1.5) pts.push({ x, y });
      } else if (e.shiftKey) {
        // Shift draws a ruler-straight stroke from the starting point.
        const end = constrainPoint(pts[0].x, pts[0].y, x, y, "line");
        _activeShape.points = [pts[0], { x: end.x, y: end.y, p: 1 }];
      } else {
        const prev = pts[pts.length - 1];
        const dist = Math.hypot(x - prev.x, y - prev.y);
        // Drop sub-pixel jitter: fewer, cleaner control points.
        if (dist >= 1.5) {
          // Pressure: real stylus pressure when available, otherwise simulated
          // from speed (fast strokes thin out, slow strokes swell), eased so
          // the width never jumps.
          const lw = _activeShape.lineWidth || 4.5;
          const target =
            e.pointerType === "pen" && e.pressure > 0
              ? 0.5 + e.pressure
              : Math.max(0.55, Math.min(1.2, 1.25 - dist / (lw * 7)));
          const p = (prev.p || 1) * 0.72 + target * 0.28;
          pts.push({ x, y, p: Math.round(p * 100) / 100 });
        }
      }
    } else {
      let pt = { x, y };
      if (e.shiftKey) {
        pt = constrainPoint(_activeShape.x1, _activeShape.y1, x, y, _activeShape.type === "arrow" ? "line" : "box");
      }
      _activeShape.x2 = pt.x;
      _activeShape.y2 = pt.y;
    }
    renderCanvas();
  }
}

function onCanvasPointerUp(e) {
  if (!_isDrawing) return;
  _isDrawing = false;

  // A finished move / resize of an existing shape becomes one undo step.
  if (!_activeShape && _currentTool !== "crop" && _shapeStartSnapshot && _shapes[_selectedShapeIndex]) {
    recordEdit(_shapes[_selectedShapeIndex], _shapeStartSnapshot);
  }

  _dragAction = null;
  _shapeStartSnapshot = null;

  if (_activeShape) {
    // A click without a drag is not a shape.
    const a = _activeShape;
    const first = a.points?.[0];
    const lastPt = a.points?.[a.points.length - 1];
    const degenerate =
      a.type === "pen"
        ? a.points.length < 2 || (a._raw && Math.hypot(lastPt.x - first.x, lastPt.y - first.y) < 4)
        : Math.abs(a.x2 - a.x1) < 3 && Math.abs(a.y2 - a.y1) < 3;
    if (degenerate) {
      // A click with the highlighter drops an anchor: the stroke now follows
      // the pointer and the next click finishes it.
      if (a._raw && !a._free) {
        a.points = [first, { x: first.x, y: first.y }];
        _hlPending = true;
        renderCanvas();
        return;
      }
      _activeShape = null;
      renderCanvas();
      return;
    }
    commitActiveShape();
    _selectedShapeIndex = _shapes.length - 1;
    renderCanvas();

    // Revert tool to select after drawing one shape (except brush and step badge)
    if (
      _currentTool !== "select" &&
      _currentTool !== "crop" &&
      !isFreehandTool() &&
      _currentTool !== "counter"
    ) {
      selectTool("select");
    } else if (isFreehandTool()) {
      // Keep drawing: do not leave the fresh stroke selected.
      _selectedShapeIndex = -1;
      renderCanvas();
    }
  }
}

// ─── Undo, Redo & Clear History ──────────────────────────────────────

function updateHistoryUI() {
  const canUndo = _undoStack.length > 0;
  const canRedo = _redoStack.length > 0;
  if (_undoBtn) {
    _undoBtn.disabled = !canUndo;
    _undoBtn.classList.toggle("is-disabled", !canUndo);
    _undoBtn.style.pointerEvents = canUndo ? "auto" : "none";
  }
  if (_redoBtn) {
    _redoBtn.disabled = !canRedo;
    _redoBtn.classList.toggle("is-disabled", !canRedo);
    _redoBtn.style.pointerEvents = canRedo ? "auto" : "none";
  }
}

function deleteSelectedShape() {
  if (_selectedShapeIndex === -1) return;
  const removed = _shapes.splice(_selectedShapeIndex, 1)[0];
  if (removed) {
    _undoStack.push({ type: "delete", shape: removed, index: _selectedShapeIndex });
    _redoStack = [];
  }
  _selectedShapeIndex = -1;
  _hoverShapeIndex = -1;
  updateHistoryUI();
  renderCanvas();
}

function handleClearAll() {
  if (_shapes.length === 0) return;
  _undoStack.push({
    type: "clear",
    shapes: [..._shapes],
    counter: _stepCounter,
  });
  _shapes = [];
  _selectedShapeIndex = -1;
  _stepCounter = 1;
  _redoStack = [];
  updateHistoryUI();
  renderCanvas();
}

function handleUndo() {
  if (_undoStack.length === 0) return;
  const op = _undoStack.pop();

  if (op.type === "add") {
    const idx = _shapes.indexOf(op.shape);
    if (idx !== -1) {
      _shapes.splice(idx, 1);
    } else {
      _shapes.pop();
    }
    if (op.shape && op.shape.type === "counter" && _stepCounter > 1) {
      _stepCounter--;
    }
    _redoStack.push(op);
  } else if (op.type === "edit") {
    restoreShape(op.shape, op.prev);
    _redoStack.push(op);
  } else if (op.type === "edit-text") {
    op.shape.text = op.prevText;
    _redoStack.push(op);
  } else if (op.type === "delete") {
    _shapes.splice(op.index, 0, op.shape);
    _redoStack.push(op);
  } else if (op.type === "clear") {
    _shapes = [...op.shapes];
    _stepCounter = op.counter;
    _redoStack.push(op);
  } else if (op.type === "crop") {
    _baseImage = op.prevImage;
    _shapes = JSON.parse(JSON.stringify(op.prevShapes));
    _redoStack.push(op);
  }

  _selectedShapeIndex = -1;
  updateHistoryUI();
  renderCanvas();
}

function handleRedo() {
  if (_redoStack.length === 0) return;
  const op = _redoStack.pop();

  if (op.type === "add") {
    _shapes.push(op.shape);
    if (op.shape && op.shape.type === "counter") {
      _stepCounter++;
    }
    _undoStack.push(op);
  } else if (op.type === "edit") {
    restoreShape(op.shape, op.next);
    _undoStack.push(op);
  } else if (op.type === "edit-text") {
    op.shape.text = op.nextText;
    _undoStack.push(op);
  } else if (op.type === "delete") {
    const idx = _shapes.indexOf(op.shape);
    if (idx !== -1) _shapes.splice(idx, 1);
    _undoStack.push(op);
  } else if (op.type === "clear") {
    _shapes = [];
    _undoStack.push(op);
  } else if (op.type === "crop") {
    _baseImage = op.nextImage;
    _shapes = JSON.parse(JSON.stringify(op.nextShapes));
    _undoStack.push(op);
  }

  _selectedShapeIndex = op.type === "edit" ? _shapes.indexOf(op.shape) : _shapes.length - 1;
  updateHistoryUI();
  renderCanvas();
}

// ─── Export Actions ──────────────────────────────────────────────────

function getCleanExportCanvas(isJpg = false) {
  if (!_annotateCanvas || !_baseImage) return null;
  const w = _annotateCanvas.width;
  const h = _annotateCanvas.height;

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = w;
  exportCanvas.height = h;
  const ctx = exportCanvas.getContext("2d", { willReadFrequently: true });

  if (isJpg) {
    // Fill white background for JPEG exports so transparent background doesn't render black
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  }

  // 1. Draw base image
  ctx.drawImage(_baseImage, 0, 0, w, h);

  // 2. Draw all shapes cleanly without any selection handles (isSelected = false)
  for (let i = 0; i < _shapes.length; i++) {
    const s = _shapes[i];
    if (s.type !== "clear-canvas") {
      drawShape(ctx, s, false);
    }
  }

  return exportCanvas;
}

function notify(message, type = "success") {
  window.SwiftSelect?.ui?.setStatus?.(message, 2200, type, false, { showAnnotate: false });
}

async function exportBlob(mime = "image/png", quality = 1) {
  _selectedShapeIndex = -1;
  renderCanvas();
  const exportCanvas = getCleanExportCanvas(mime === "image/jpeg");
  if (!exportCanvas) return null;
  const blob = await new Promise((res) => exportCanvas.toBlob(res, mime, quality));
  return blob ? { blob, width: exportCanvas.width, height: exportCanvas.height } : null;
}

async function handleCopyAnnotated() {
  const out = await exportBlob("image/png");
  if (!out) return false;

  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": out.blob })]);
    _markSaved();
    notify("Copied to clipboard");
    return true;
  } catch {
    // The page may have lost focus or forbid clipboard access: use the offscreen document.
    const ok = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(false);
      reader.onload = () => {
        try {
          chrome.runtime.sendMessage({ type: "write-image-to-clipboard", dataUrl: reader.result }, (resp) => {
            resolve(!chrome.runtime.lastError && !!resp?.success);
          });
        } catch {
          resolve(false);
        }
      };
      reader.readAsDataURL(out.blob);
    });
    if (ok) _markSaved();
    notify(ok ? "Copied to clipboard" : "Clipboard blocked", ok ? "success" : "error");
    return ok;
  }
}

async function handleSaveAnnotated() {
  const { mime, quality, ext } = await getOutputSettings();
  const out = await exportBlob(mime, quality);
  if (!out) return false;

  setLastBlob(out.blob, ext);
  const ok = await downloadBlob(out.blob, getSmartFilename("annotated", ext));
  if (ok) _markSaved();
  notify(ok ? "Saved to downloads" : "Download failed", ok ? "saved" : "error");
  return ok;
}

async function handleSaveToGallery() {
  const { mime, quality } = await getOutputSettings();
  const out = await exportBlob(mime, quality);
  if (!out) return false;

  // An explicit request always saves, even when automatic gallery capture is off.
  const ok = await saveToGallery(
    out.blob,
    { type: "annotated", width: out.width, height: out.height, title: _sourceMeta.title, url: _sourceMeta.url },
    { force: true },
  );
  if (ok) _markSaved();
  notify(ok ? "Saved to Gallery" : "Gallery save failed", ok ? "saved" : "error");
  return ok;
}

function onAnnotateKeyDown(e) {
  if (e.key === "Escape") {
    if (cancelPendingHighlight()) return;
    if (_strokePopoverEl && _strokePopoverEl.style.display !== "none") {
      _strokePopoverEl.style.display = "none";
      _updateStrokeUI();
      return;
    }
    if (_currentTool === "crop") {
      _cropRect = null;
      hideCropControls();
      selectTool("select");
      return;
    }
    if (_selectedShapeIndex !== -1) {
      // First Esc puts the shape down, the next one leaves.
      _selectedShapeIndex = -1;
      renderCanvas();
      _syncStyleUI();
      return;
    }
    requestClose();
    return;
  }

  if (e.key === "Enter" && _currentTool === "crop") {
    applyCrop();
    return;
  }

  // Delete selected shape
  if ((e.key === "Delete" || e.key === "Backspace") && _selectedShapeIndex !== -1) {
    if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
      deleteSelectedShape();
      return;
    }
  }

  // Arrow keys nudge the selected shape: 1px, or 10px with Shift. Editing
  // the shape in hand, like Delete, so it is always on.
  if (e.key.startsWith("Arrow") && _selectedShapeIndex !== -1 && _shapes[_selectedShapeIndex] && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
    e.preventDefault();
    const step = (e.shiftKey ? 10 : 1) * Math.max(1, (_annotateCanvas?.width || 1400) / 1400);
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    editSelected("nudge", (shape) => moveShapeBy(shape, dx, dy));
    return;
  }

  // Everything below is opt-in (Settings > Shortcuts > Editor shortcuts).
  // Escape, Enter and Delete above always work: they finish or undo the
  // action in hand rather than start a new one.
  if (!getOutputSettingsSync().editorShortcuts) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) {
      handleRedo();
    } else {
      handleUndo();
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    handleRedo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
    e.preventDefault();
    handleCopyAnnotated();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    handleSaveAnnotated();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && _selectedShapeIndex !== -1) {
    e.preventDefault();
    const copy = cloneShape(_shapes[_selectedShapeIndex]);
    const off = Math.max(12, (_annotateCanvas?.width || 1400) / 80);
    moveShapeBy(copy, off, off);
    if (copy.type === "counter") copy.number = _stepCounter++;
    _shapes.push(copy);
    _undoStack.push({ type: "add", shape: copy });
    _redoStack = [];
    _selectedShapeIndex = _shapes.length - 1;
    updateHistoryUI();
    renderCanvas();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
    e.preventDefault();
    handleSaveToGallery();
    return;
  }

  // Single-key tools. Never fire while typing or with a modifier held.
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
    const TOOL_KEYS = {
      v: "select",
      p: "pen",
      h: "highlighter",
      a: "arrow",
      r: "rect",
      o: "ellipse",
      s: "counter",
      b: "blur",
      t: "text",
      c: "crop",
      x: "crop",
    };
    const k = e.key.toLowerCase();
    if (TOOL_KEYS[k]) {
      e.preventDefault();
      selectTool(TOOL_KEYS[k]);
    } else if (k === "f") {
      e.preventDefault();
      toggleFill();
    } else if (e.key === "[" || e.key === "]") {
      e.preventDefault();
      _stepSize(e.key === "]" ? 1 : -1);
    }
  }
}

export function closeAnnotationEditor() {
  if (!_annotateHost || _annotateHost.classList.contains("qs-closing")) return;
  _annotateHost.classList.add("qs-closing");
  hideCustomTooltip();

  if (_textInputOverlay) {
    _textInputOverlay.remove();
    _textInputOverlay = null;
  }

  window.removeEventListener("pointermove", onCanvasPointerMove);
  window.removeEventListener("pointerup", onCanvasPointerUp);
  window.removeEventListener("keydown", onAnnotateKeyDown, true);
  if (_closePopoverHandler) {
    window.removeEventListener("pointerdown", _closePopoverHandler, true);
    window.removeEventListener("click", _closePopoverHandler, true);
    _closePopoverHandler = null;
  }

  hideCropControls();

  if (_toolbarEl) {
    _toolbarEl.style.transform = "translate3d(0, -18px, 0) scale(0.93)";
    _toolbarEl.style.opacity = "0";
    _toolbarEl.style.transition = "transform 0.18s ease, opacity 0.18s ease";
  }
  if (_annotateCanvas) {
    _annotateCanvas.style.transform = "scale(0.96)";
    _annotateCanvas.style.opacity = "0";
    _annotateCanvas.style.transition =
      "transform 0.18s ease, opacity 0.18s ease";
  }
  if (_annotateHost) {
    _annotateHost.style.opacity = "0";
    _annotateHost.style.transition =
      "opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1)";
  }

  setTimeout(() => {
    if (_annotateHost && _annotateHost.parentNode) {
      _annotateHost.parentNode.removeChild(_annotateHost);
    }
    _annotateHost = null;
    setTooltipGuard(null);
    _infoEl = null;
    _closeArmed = false;
    clearTimeout(_closeArmTimer);
    _toolbarEl = null;
    _annotateCanvas = null;
    _annotateCtx = null;
    _baseImage = null;
    _undoBtn = null;
    _redoBtn = null;
    _toolsGroup = null;
    _cropControlsEl = null;
    _strokePopoverEl = null;
    _tuneBtn = null;
    _currentOpacity = STYLE_DEFAULTS.ink.opacity;
    _currentLineWidth = STYLE_DEFAULTS.ink.lineWidth;
    _styleByKind = { ink: { ...STYLE_DEFAULTS.ink }, marker: { ...STYLE_DEFAULTS.marker } };
    _activeKind = "ink";
    _stepSize = () => {};
    _selectedShapeIndex = -1;
    _scratchBlurCanvas = null;
    _scratchBlurCtx = null;
    _shapes = [];
    _undoStack = [];
    _redoStack = [];
    _stepCounter = 1;
    _cropRect = null;
    _cropAspectRatioKey = "free";
    _cropAspectRatio = null;
    _activeShape = null;
    _isDrawing = false;
    _fillBtn = null;
    _strokePopoverEl?.remove();
    _strokePopoverEl = null;
    _closeStrokePopover = () => {};
    _hoverShapeIndex = -1;
    _updateStrokeUI = () => {};
    _syncStyleUI = () => {};

    const done = _onClose;
    _onClose = null;
    _standalone = false;
    _sourceMeta = {};
    done?.();
  }, 200);
}
