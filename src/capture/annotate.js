/**
 * SwiftSelect - Lightweight In-Browser Canvas Annotation Bar
 * Fast, dependency-free HTML5 2D Canvas editor for screenshots.
 * Tools: Select & Move, Arrow, Rectangle, Crop Photo, Step Counter (1, 2, 3), Blur/Redact, Pen, Text.
 * Palette, Stroke Width, Undo, Redo, Clear, Copy, Save.
 * Authentic Liquid Glass aesthetic with SVG turbulence refraction and spring in/out animations.
 */

import { getSmartFilename, getOutputSettings } from "./utils.js";
import { setLastBlob } from "./download.js";
import { loadStyles, getCachedCssText, attachTooltip, hideCustomTooltip } from "../ui.js";

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
let _currentTool = "pen"; // 'pen' (Brush) is default active tool | 'select' | 'arrow' | 'rect' | 'counter' | 'blur' | 'text' | 'crop'
let _currentColor = "#FF3333"; // Vivid High-Visibility Red
let _currentLineWidth = 7.5; // 3rd size is default
let _currentOpacity = 1.0;
let _stepCounter = 1;
let _strokePopoverEl = null;
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

function getToolCursor(tool = _currentTool) {
  if (tool === "select") return "default";
  if (tool === "pen") return BRUSH_CURSOR;
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

const STROKE_WIDTHS = [
  { label: "Fine", width: 2, dotSize: 3.5 },
  { label: "Medium", width: 4.5, dotSize: 6 },
  { label: "Thick", width: 7.5, dotSize: 8.5 },
  { label: "Heavy", width: 12, dotSize: 11 },
];

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

export async function openAnnotationEditor(source) {
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
      return openAnnotationEditor(freezeData);
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
      return openAnnotationEditor(snap);
    }

    console.warn("SwiftSelect Annotate: Could not capture visible view as source.");
    return;
  }

  // Mathematically crop out native browser scrollbar if present in full-screen capture
  if (img) {
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
  _shapes = [];
  _undoStack = [];
  _redoStack = [];
  _stepCounter = 1;
  _selectedShapeIndex = -1;
  _cropRect = null;
  _currentTool = "pen";
  _currentLineWidth = 7.5;
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
  _currentTool = toolId;
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
  if (_annotateCanvas) {
    _annotateCanvas.style.cursor = getToolCursor(_currentTool);
  }
  renderCanvas();
}

function buildAnnotationUI() {
  if (_annotateHost) {
    _annotateHost.remove();
    _annotateHost = null;
  }

  _annotateHost = document.createElement("div");
  _annotateHost.id = "swiftselect-annotate-root";
  _annotateHost.className = "qs-annotate-root";
  _annotateHost.style.cssText = `
    all: initial;
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.14);
    user-select: none;
    font-family: 'Google Sans', 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    opacity: 0;
    transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  // Inject styles.css text directly into _annotateHost (bypasses CSP on sites like Google Gemini)
  const styleTag = document.createElement("style");
  styleTag.id = "qs-annotate-styles";
  const css = getCachedCssText();
  if (css) {
    styleTag.textContent = css;
  } else {
    fetch(chrome.runtime.getURL("styles.css"))
      .then((r) => r.text())
      .then((t) => (styleTag.textContent = t))
      .catch(() => {});
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
        transform: scale(0.97);
        opacity: 0;
      }
      100% {
        transform: scale(1);
        opacity: 1;
      }
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
  if (uiTheme?.applyElementTheme) {
    uiTheme.applyElementTheme(toolbar, "glass");
  }

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
      name: "Brush",
      key: "P",
      svg: '<svg class="tool-icon-brush" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>',
    },
    {
      id: "arrow",
      name: "Arrow",
      key: "A",
      svg: '<svg class="tool-icon-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line class="arrow-shaft" x1="5" y1="19" x2="19" y2="5"/><polyline class="arrow-head" points="9 5 19 5 19 15"/></svg>',
    },
    {
      id: "rect",
      name: "Rectangle Box",
      key: "R",
      svg: '<svg class="tool-icon-rect" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect class="rect-box" x="3" y="4" width="18" height="16" rx="4"/></svg>',
    },
    {
      id: "counter",
      name: "Step Badge",
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
      name: "Text Caption",
      key: "T",
      svg: '<svg class="tool-icon-text" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="text-cap" d="M4 6V4h16v2"/><line class="text-stem" x1="12" y1="4" x2="12" y2="20"/><line class="text-base" x1="8" y1="20" x2="16" y2="20"/></svg>',
    },
  ];

  _toolsGroup = document.createElement("div");
  _toolsGroup.className = "qs-annotate-tools";

  tools.forEach((t) => {
    const btn = document.createElement("button");
    btn.dataset.tool = t.id;
    btn.innerHTML = t.svg;
    const isActive = t.id === _currentTool;
    btn.className = `qs-guide-btn circle ${isActive ? "active" : ""}`;
    attachTooltip(btn, t.name, "", t.key, 200, _annotateHost);
    btn.onclick = (e) => {
      e?.stopPropagation?.();
      hideCustomTooltip();
      selectTool(t.id);
    };
    _toolsGroup.appendChild(btn);
  });
  toolbar.appendChild(_toolsGroup);

  // Dedicated Separate Crop Button (No divider)
  _cropBtn = document.createElement("button");
  _cropBtn.className = `qs-guide-btn circle ${_currentTool === "crop" ? "active" : ""}`;
  _cropBtn.dataset.tool = "crop";
  _cropBtn.innerHTML =
    '<svg class="tool-icon-crop" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="crop-bracket-1" d="M6.5 2v14a1.5 1.5 0 0 0 1.5 1.5H22"/><path class="crop-bracket-2" d="M17.5 22V8a1.5 1.5 0 0 0-1.5-1.5H2"/></svg>';
  attachTooltip(_cropBtn, "Crop Image", "", "C, X", 200, _annotateHost);
  _cropBtn.onclick = (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    selectTool(_currentTool === "crop" ? "select" : "crop");
  };
  toolbar.appendChild(_cropBtn);

  // Stroke Width Selector Capsule (4 sizes, 3rd default + custom tune button)
  const strokeGroup = document.createElement("div");
  strokeGroup.className = "qs-stroke-capsule";

  function getScaledFontSize(width) {
    return Math.round(14 + width * 3.5);
  }

  function updateStrokeUI() {
    strokeGroup.querySelectorAll("button[data-stroke]").forEach((b) => {
      const act = Number(b.dataset.stroke) === _currentLineWidth;
      b.style.background = act ? "color-mix(in srgb, var(--c-glass) 58%, transparent)" : "transparent";
      b.style.borderColor = "transparent";
      b.style.boxShadow = act ? "inset 0 0 0 1px color-mix(in srgb, var(--c-light) calc(var(--glass-reflex-light) * 15%), transparent), inset 1px 1px 1px -1px color-mix(in srgb, var(--c-light) calc(var(--glass-reflex-light) * 70%), transparent), 0 1px 3px rgba(0, 0, 0, 0.15)" : "none";
      const d = b.querySelector("div");
      if (d) {
        d.style.opacity = act ? "1" : "0.55";
        d.style.background = "currentColor";
      }
    });
    const isPreset = STROKE_WIDTHS.some((sw) => sw.width === _currentLineWidth);
    const isPopoverOpen = _strokePopoverEl && _strokePopoverEl.style.display !== "none";
    if (_tuneBtn) {
      const tuneAct = isPopoverOpen || !isPreset;
      _tuneBtn.style.color = "var(--c-content)";
      _tuneBtn.style.background = tuneAct ? "color-mix(in srgb, var(--c-glass) 58%, transparent)" : "transparent";
      _tuneBtn.style.borderColor = "transparent";
      _tuneBtn.style.boxShadow = tuneAct ? "inset 0 0 0 1px color-mix(in srgb, var(--c-light) calc(var(--glass-reflex-light) * 15%), transparent), inset 1px 1px 1px -1px color-mix(in srgb, var(--c-light) calc(var(--glass-reflex-light) * 70%), transparent), 0 1px 3px rgba(0, 0, 0, 0.15)" : "none";
    }
  }

  function applyLineWidth(width) {
    _currentLineWidth = width;
    if (_selectedShapeIndex !== -1 && _shapes[_selectedShapeIndex]) {
      _shapes[_selectedShapeIndex].lineWidth = width;
      if (_shapes[_selectedShapeIndex].type === "text") {
        _shapes[_selectedShapeIndex].fontSize = getScaledFontSize(width);
      }
      renderCanvas();
    }
    syncPopoverControls();
    updateStrokeUI();
  }

  function applyOpacity(opacity) {
    _currentOpacity = opacity;
    if (_selectedShapeIndex !== -1 && _shapes[_selectedShapeIndex]) {
      _shapes[_selectedShapeIndex].opacity = opacity;
      renderCanvas();
    }
    syncPopoverControls();
  }

  STROKE_WIDTHS.forEach((sw) => {
    const sBtn = document.createElement("button");
    sBtn.dataset.stroke = sw.width;
    const isAct = sw.width === _currentLineWidth;
    sBtn.style.cssText = `
      all: initial;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      background: ${isAct ? "color-mix(in srgb, var(--c-glass) 58%, transparent)" : "transparent"};
      border: transparent;
      box-shadow: ${isAct ? "inset 0 0 0 1px color-mix(in srgb, var(--c-light) calc(var(--glass-reflex-light) * 15%), transparent), inset 1px 1px 1px -1px color-mix(in srgb, var(--c-light) calc(var(--glass-reflex-light) * 70%), transparent), 0 1px 3px rgba(0, 0, 0, 0.15)" : "none"};
      box-sizing: border-box;
      transition: all 0.15s ease;
      flex-shrink: 0;
      color: var(--c-content);
    `;
    const dot = document.createElement("div");
    dot.style.cssText = `
      width: ${sw.dotSize}px;
      height: ${sw.dotSize}px;
      border-radius: 50%;
      background: currentColor;
      opacity: ${isAct ? "1" : "0.55"};
      transition: opacity 0.15s ease, transform 0.15s ease;
    `;
    sBtn.appendChild(dot);
    attachTooltip(sBtn, `Stroke: ${sw.label}`, "", `${sw.width}px`, 200, _annotateHost);
    sBtn.onclick = (e) => {
      e?.stopPropagation?.();
      hideCustomTooltip();
      applyLineWidth(sw.width);
    };
    strokeGroup.appendChild(sBtn);
  });

  // 5th Button: Custom Stroke Slider & Popover Trigger
  const tuneBtn = document.createElement("button");
  tuneBtn.className = "qs-stroke-tune-btn";
  tuneBtn.style.cssText = `
    all: initial;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    background: transparent;
    border: 1px solid transparent;
    box-sizing: border-box;
    transition: all 0.15s ease;
    flex-shrink: 0;
    color: var(--c-content);
  `;
  tuneBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">
      <line x1="4" y1="21" x2="4" y2="14"/>
      <line x1="4" y1="10" x2="4" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12" y2="3"/>
      <line x1="20" y1="21" x2="20" y2="16"/>
      <line x1="20" y1="12" x2="20" y2="3"/>
      <line x1="1" y1="14" x2="7" y2="14"/>
      <line x1="9" y1="8" x2="15" y2="8"/>
      <line x1="17" y1="16" x2="23" y2="16"/>
    </svg>
  `;
  attachTooltip(tuneBtn, "Stroke & Style Options", "", "Slider", 200, _annotateHost);
  _tuneBtn = tuneBtn;
  strokeGroup.appendChild(tuneBtn);

  // Floating Popover Card
  const popover = document.createElement("div");
  popover.className = "qs-stroke-popover";
  popover.style.display = "none";

  // Completely isolate popover from canvas and host drag/pointer listeners
  ["pointerdown", "pointermove", "pointerup", "mousedown", "mousemove", "mouseup", "touchstart", "touchmove", "touchend", "click"].forEach((evt) => {
    popover.addEventListener(evt, (e) => e.stopPropagation());
  });

  popover.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 3px;">
      <span style="font-size: 12px; font-weight: 700; color: var(--c-content); letter-spacing: -0.2px;">Stroke &amp; Style</span>
      <span class="qs-popover-width-val" style="font-size: 11px; font-weight: 700; color: var(--c-action); background: color-mix(in srgb, var(--c-action) 12%, transparent); border: 1px solid color-mix(in srgb, var(--c-action) 25%, transparent); padding: 2px 8px; border-radius: 999px;">${_currentLineWidth}px</span>
    </div>

    <div class="qs-slider-group">
      <div class="qs-slider-header">
        <span>Thickness</span>
        <span style="font-size: 10px; opacity: 0.65;">1px – 72px</span>
      </div>
      <input type="range" class="qs-popover-slider-width" min="1" max="72" step="0.5" value="${_currentLineWidth}">
    </div>

    <div style="background: color-mix(in srgb, var(--c-content) 6%, transparent); border: 1px solid color-mix(in srgb, var(--c-content) 12%, transparent); border-radius: 10px; height: 30px; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 0 14px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.08);">
      <div class="qs-popover-preview-line" style="height: ${Math.min(20, Math.max(1, _currentLineWidth))}px; width: 100%; border-radius: 999px; background: ${_currentColor}; opacity: ${_currentOpacity}; transition: height 0.08s ease, opacity 0.08s ease, background-color 0.1s ease;"></div>
    </div>

    <div class="qs-slider-group">
      <div class="qs-slider-header">
        <span>Opacity</span>
        <span class="qs-popover-opacity-val" style="font-weight: 700; color: var(--c-action);">${Math.round(_currentOpacity * 100)}%</span>
      </div>
      <input type="range" class="qs-popover-slider-opacity" min="10" max="100" step="5" value="${Math.round(_currentOpacity * 100)}">
    </div>
  `;

  strokeGroup.appendChild(popover);
  _strokePopoverEl = popover;

  const widthValEl = popover.querySelector(".qs-popover-width-val");
  const widthSlider = popover.querySelector(".qs-popover-slider-width");
  const previewLine = popover.querySelector(".qs-popover-preview-line");
  const opacityValEl = popover.querySelector(".qs-popover-opacity-val");
  const opacitySlider = popover.querySelector(".qs-popover-slider-opacity");

  function syncPopoverControls() {
    if (previewLine) {
      previewLine.style.height = `${Math.min(20, Math.max(1, _currentLineWidth))}px`;
      previewLine.style.background = _currentColor;
      previewLine.style.opacity = String(_currentOpacity);
    }
    if (widthValEl) widthValEl.textContent = `${_currentLineWidth}px`;
    if (widthSlider) widthSlider.value = String(_currentLineWidth);
    if (opacityValEl) opacityValEl.textContent = `${Math.round(_currentOpacity * 100)}%`;
    if (opacitySlider) opacitySlider.value = String(Math.round(_currentOpacity * 100));
  }

  widthSlider.addEventListener("input", (e) => {
    applyLineWidth(parseFloat(e.target.value));
  });

  opacitySlider.addEventListener("input", (e) => {
    applyOpacity(parseInt(e.target.value, 10) / 100);
  });

  tuneBtn.onclick = (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    const isVisible = popover.style.display !== "none";
    if (isVisible) {
      popover.style.display = "none";
    } else {
      syncPopoverControls();
      popover.style.display = "flex";
    }
    updateStrokeUI();
  };

  if (_closePopoverHandler) {
    window.removeEventListener("pointerdown", _closePopoverHandler, true);
    window.removeEventListener("click", _closePopoverHandler, true);
  }
  _closePopoverHandler = (e) => {
    if (_strokePopoverEl && _strokePopoverEl.style.display !== "none") {
      const path = e.composedPath ? e.composedPath() : [];
      const clickedInside = path.includes(popover) || path.includes(tuneBtn) || popover.contains(e.target) || tuneBtn.contains(e.target);
      if (!clickedInside) {
        _strokePopoverEl.style.display = "none";
        updateStrokeUI();
      }
    }
  };
  window.addEventListener("pointerdown", _closePopoverHandler, true);
  window.addEventListener("click", _closePopoverHandler, true);

  toolbar.appendChild(strokeGroup);

  // Palette Swatches & Custom Color Picker (No divider)
  const paletteGroup = document.createElement("div");
  paletteGroup.className = "qs-palette-row";

  function getActiveSwatchStyle(color, isActive, isWhite) {
    if (isActive) {
      return `0 0 0 2.5px #ffffff, 0 2px 6px rgba(0,0,0,0.35)`;
    }
    return isWhite
      ? `inset 0 0 0 1px rgba(0,0,0,0.25), 0 1px 3px rgba(0,0,0,0.25)`
      : `inset 0 0 0 1px rgba(255,255,255,0.25), 0 1px 3px rgba(0,0,0,0.25)`;
  }

  function updatePaletteUI() {
    const isCustom = !PALETTE.some((c) => c.toLowerCase() === _currentColor.toLowerCase());
    paletteGroup.querySelectorAll("button[data-color]").forEach((s) => {
      const col = s.dataset.color;
      const act = col.toLowerCase() === _currentColor.toLowerCase();
      const isWhite = col.toLowerCase() === "#ffffff";
      s.style.boxShadow = getActiveSwatchStyle(col, act, isWhite);
      s.style.transform = act ? "scale(1.12)" : "scale(1)";
    });
    const pickerBtn = paletteGroup.querySelector(".qs-palette-color-picker");
    if (pickerBtn) {
      pickerBtn.style.boxShadow = isCustom
        ? `0 0 0 2.5px #ffffff, 0 2px 6px rgba(0,0,0,0.35)`
        : `inset 0 0 0 1px rgba(255,255,255,0.35), 0 1px 3px rgba(0,0,0,0.2)`;
      pickerBtn.style.transform = isCustom ? "scale(1.12)" : "scale(1)";
    }
  }

  PALETTE.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.dataset.color = color;
    const isActive = color.toLowerCase() === _currentColor.toLowerCase();
    const isWhite = color.toLowerCase() === "#ffffff";
    swatch.style.cssText = `
      all: initial;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: ${color};
      cursor: pointer;
      box-sizing: border-box;
      box-shadow: ${getActiveSwatchStyle(color, isActive, isWhite)};
      transform: ${isActive ? "scale(1.12)" : "scale(1)"};
      transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.16s ease;
      flex-shrink: 0;
    `;
    attachTooltip(swatch, COLOR_NAMES[color] || "Color", "", "", 200, _annotateHost);
    swatch.onclick = (e) => {
      e?.stopPropagation?.();
      hideCustomTooltip();
      _currentColor = color;
      if (_selectedShapeIndex !== -1 && _shapes[_selectedShapeIndex]) {
        _shapes[_selectedShapeIndex].color = color;
        renderCanvas();
      }
      updatePaletteUI();
    };
    paletteGroup.appendChild(swatch);
  });

  // Color Picker Button (Conic Rainbow Swatch)
  const pickerBtn = document.createElement("button");
  pickerBtn.className = "qs-palette-color-picker";
  const isCustomColor = !PALETTE.some((c) => c.toLowerCase() === _currentColor.toLowerCase());
  pickerBtn.style.cssText = `
    all: initial;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: conic-gradient(from 180deg at 50% 50%, #ff0000, #ff8000, #ffff00, #00ff00, #00ffff, #007aff, #8000ff, #ff0080, #ff0000);
    cursor: pointer;
    box-sizing: border-box;
    box-shadow: ${
      isCustomColor
        ? "0 0 0 2.5px #ffffff, 0 2px 6px rgba(0,0,0,0.35)"
        : "inset 0 0 0 1px rgba(255,255,255,0.35), 0 1px 3px rgba(0,0,0,0.2)"
    };
    transform: ${isCustomColor ? "scale(1.12)" : "scale(1)"};
    transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.16s ease;
    flex-shrink: 0;
    position: relative;
    overflow: hidden;
  `;
  attachTooltip(pickerBtn, "Color Picker", "", "Custom Hex", 200, _annotateHost);

  const nativeColorInput = document.createElement("input");
  nativeColorInput.type = "color";
  nativeColorInput.value = _currentColor;
  nativeColorInput.style.cssText = `
    position: absolute;
    top: -6px;
    left: -6px;
    width: 32px;
    height: 32px;
    opacity: 0;
    cursor: pointer;
    padding: 0;
    margin: 0;
    border: none;
  `;
  const handleColorChange = (newColor) => {
    _currentColor = newColor;
    if (_selectedShapeIndex !== -1 && _shapes[_selectedShapeIndex]) {
      _shapes[_selectedShapeIndex].color = newColor;
      renderCanvas();
    }
    updatePaletteUI();
  };
  nativeColorInput.addEventListener("input", (e) => handleColorChange(e.target.value));
  nativeColorInput.addEventListener("change", (e) => handleColorChange(e.target.value));
  pickerBtn.appendChild(nativeColorInput);
  paletteGroup.appendChild(pickerBtn);

  toolbar.appendChild(paletteGroup);

  // History Group: Undo & Redo & Clear (No divider)
  const historyGroup = document.createElement("div");
  historyGroup.className = "qs-annotate-history";

  // Undo Button
  _undoBtn = document.createElement("button");
  _undoBtn.className = "qs-guide-btn circle";
  _undoBtn.innerHTML =
    '<svg class="tool-icon-undo" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>';
  attachTooltip(_undoBtn, "Undo", "", "Ctrl+Z", 200, _annotateHost);
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
  attachTooltip(_redoBtn, "Redo", "", "Ctrl+Y", 200, _annotateHost);
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
  attachTooltip(clearBtn, "Clear All Annotations", "", "", 200, _annotateHost);
  clearBtn.onclick = (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    handleClearAll();
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
  attachTooltip(copyBtn, "Copy Image", "", "Ctrl+C", 200, _annotateHost);
  copyBtn.onclick = async (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    await handleCopyAnnotated();
    copyBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    setTimeout(() => {
      copyBtn.innerHTML =
        '<svg class="tool-icon-copy is-filled" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
    }, 1400);
  };
  actionsGroup.appendChild(copyBtn);

  // Save/Download Button (Circle, icon-only, using existing dl-arrow & dl-bar)
  const saveBtn = document.createElement("button");
  saveBtn.className = "qs-guide-btn circle";
  saveBtn.innerHTML =
    '<svg class="tool-icon-save is-filled" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path class="dl-arrow" d="M19 9h-4V3H9v6H5l7 7 7-7z"/><path class="dl-bar" d="M5 18v2h14v-2H5z"/></svg>';
  attachTooltip(saveBtn, "Download Image", "", "Ctrl+S", 200, _annotateHost);
  saveBtn.onclick = (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    handleSaveAnnotated();
  };
  actionsGroup.appendChild(saveBtn);

  // Close Button (No divider)
  const closeBtn = document.createElement("button");
  closeBtn.className = "qs-guide-btn circle";
  closeBtn.innerHTML =
    '<svg class="tool-icon-close" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  attachTooltip(closeBtn, "Close Editor", "", "Esc", 200, _annotateHost);
  closeBtn.onclick = (e) => {
    e?.stopPropagation?.();
    hideCustomTooltip();
    closeAnnotationEditor();
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
    padding: 70px 20px 24px 20px;
    box-sizing: border-box;
  `;

  _annotateCanvas = document.createElement("canvas");
  _annotateCanvas.style.cssText = `
    box-shadow:
      0 0 0 1px rgba(0, 0, 0, 0.28),
      0 0 0 3.5px #ffffff,
      0 0 0 4.5px rgba(0, 0, 0, 0.35),
      0 16px 48px -6px rgba(0, 0, 0, 0.75),
      0 32px 80px -10px rgba(0, 0, 0, 0.85);
    border-radius: 12px;
    overflow: hidden;
    cursor: ${getToolCursor(_currentTool)};
    max-width: 95vw;
    max-height: 85vh;
    object-fit: contain;
    animation: qsCanvasIn 320ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
  `;

  viewport.appendChild(_annotateCanvas);
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
      closeAnnotationEditor();
    }
  };

  viewport.addEventListener("pointerdown", handleBackdropClick);
  _annotateHost.addEventListener("pointerdown", handleBackdropClick);

  // Attach Pointer Listeners to Canvas & Window
  _annotateCanvas.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
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

  document.body.appendChild(_annotateHost);

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
    if (s.type === "arrow" || s.type === "rect" || s.type === "blur") {
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
    } else if (s.type === "rect" || s.type === "blur") {
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
        if (distToSegment(x, y, s.points[p].x, s.points[p].y, s.points[p + 1].x, s.points[p + 1].y) <= 12) {
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
  } else if (s.type === "rect" || s.type === "blur") {
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

  // Render Crop Overlay
  if (_currentTool === "crop" && _cropRect) {
    drawCropOverlay(_annotateCtx);
  }
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

    // Shaft line
    ctx.beginPath();
    ctx.lineCap = "butt";
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(shaftEndX, shaftEndY);
    ctx.stroke();

    // Round cap only at tail
    ctx.beginPath();
    ctx.arc(s.x1, s.y1, lw / 2, 0, Math.PI * 2);
    ctx.fill();

    // Razor-sharp arrowhead polygon with zero protruding nub
    ctx.beginPath();
    ctx.lineJoin = "miter";
    ctx.miterLimit = 4;
    ctx.moveTo(s.x2, s.y2); // Tip
    ctx.lineTo(
      s.x2 - headLen * Math.cos(angle - Math.PI / 6.8),
      s.y2 - headLen * Math.sin(angle - Math.PI / 6.8),
    );
    ctx.lineTo(
      s.x2 - headLen * 0.68 * Math.cos(angle),
      s.y2 - headLen * 0.68 * Math.sin(angle),
    );
    ctx.lineTo(
      s.x2 - headLen * Math.cos(angle + Math.PI / 6.8),
      s.y2 - headLen * Math.sin(angle + Math.PI / 6.8),
    );
    ctx.closePath();
    ctx.fill();

    // Render interactive control handles if selected
    if (isSelected) {
      drawHandleCircle(ctx, s.x1, s.y1);
      drawHandleCircle(ctx, s.x2, s.y2);
    }
  } else if (s.type === "rect") {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.lineWidth || 4.5;
    ctx.lineJoin = "round";

    const x = Math.min(s.x1, s.x2);
    const y = Math.min(s.y1, s.y2);
    const w = Math.abs(s.x2 - s.x1);
    const h = Math.abs(s.y2 - s.y1);

    ctx.strokeRect(x, y, w, h);

    if (isSelected) {
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
      drawHandleCircle(ctx, s.x, s.y);
    }
  } else if (s.type === "blur") {
    const x = Math.min(s.x1, s.x2);
    const y = Math.min(s.y1, s.y2);
    const w = Math.abs(s.x2 - s.x1);
    const h = Math.abs(s.y2 - s.y1);

    if (w > 4 && h > 4) {
      try {
        if (!_scratchBlurCanvas) {
          _scratchBlurCanvas = document.createElement("canvas");
          _scratchBlurCtx = _scratchBlurCanvas.getContext("2d", { willReadFrequently: true });
        }
        const sw = Math.max(1, Math.round(w / 10));
        const sh = Math.max(1, Math.round(h / 10));
        if (_scratchBlurCanvas.width !== sw || _scratchBlurCanvas.height !== sh) {
          _scratchBlurCanvas.width = sw;
          _scratchBlurCanvas.height = sh;
        }

        // Fast GPU blit: downscale to scratch canvas then blit back without smoothing
        _scratchBlurCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, sw, sh);

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(_scratchBlurCanvas, 0, 0, sw, sh, x, y, w, h);
        ctx.restore();
      } catch {
        ctx.fillStyle = "rgba(100, 100, 110, 0.95)";
        ctx.fillRect(x, y, w, h);
      }
    }
    if (isSelected) {
      ctx.strokeStyle = "#3B82F6";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
      ctx.setLineDash([]);
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
  } else if (s.type === "pen") {
    if (s.points && s.points.length > 1) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.lineWidth || 4.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineTo(s.points[i].x, s.points[i].y);
      }
      ctx.stroke();
    }
  } else if (s.type === "text") {
    const fontSize = s.fontSize || 28;
    ctx.font = `bold ${fontSize}px 'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
    ctx.fillStyle = s.color;
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1.5;
    ctx.fillText(s.text, s.x, s.y);

    const metrics = ctx.measureText(s.text);
    s.width = metrics.width;
    s.height = Math.round(fontSize * 1.25);

    if (isSelected) {
      ctx.strokeStyle = "#2563EB";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      const boxW = Math.max(30, metrics.width) + 12;
      const boxH = s.height + 8;
      ctx.strokeRect(s.x - 6, s.y - 4, boxW, boxH);
      ctx.setLineDash([]);
      drawHandleCircle(ctx, s.x - 6, s.y - 4);
      drawHandleCircle(ctx, s.x - 6 + boxW, s.y - 4);
      drawHandleCircle(ctx, s.x - 6 + boxW, s.y - 4 + boxH);
      drawHandleCircle(ctx, s.x - 6, s.y - 4 + boxH);
    }
  }

  ctx.restore();
}

function drawHandleCircle(ctx, x, y) {
  const rect = _annotateCanvas?.getBoundingClientRect();
  const scale = rect ? _annotateCanvas.width / (rect.width || 1) : 1;
  const radius = Math.max(5, Math.round(5.5 * scale));
  const lw = Math.max(2, Math.round(2 * scale));
  const blur = Math.max(4, Math.round(4 * scale));

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#2563EB";
  ctx.lineWidth = lw;
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = blur;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
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
  const fontMap = { 2: 18, 4.5: 28, 7.5: 40, 12: 56 };
  const baseFontSize = existingShape ? (existingShape.fontSize || 28) : (fontMap[_currentLineWidth] || 28);
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
    font-family: 'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: ${screenFontSize}px;
    font-weight: 700;
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
  const handleType = hitTestHandles(x, y);
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
    if (_selectedShapeIndex !== -1) {
      _dragAction = "move";
      _dragStartPos = { x, y };
      _shapeStartSnapshot = JSON.parse(JSON.stringify(_shapes[_selectedShapeIndex]));
      _isDrawing = true;
    }
    renderCanvas();
    return;
  }

  // If user clicks directly on an existing shape, select and move it
  if (hitIndex !== -1 && _currentTool !== "pen") {
    _selectedShapeIndex = hitIndex;
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
      points: [{ x, y }],
      color: _currentColor,
      lineWidth: _currentLineWidth,
      opacity: _currentOpacity,
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
  }
}

function onCanvasPointerMove(e) {
  const { x, y } = getCanvasCoords(e);

  if (!_isDrawing) {
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
    } else {
      const handle = hitTestHandles(x, y);
      if (handle) {
        if (handle === "rect-tl" || handle === "rect-br" || handle === "text-br" || handle === "text-tl") {
          _annotateCanvas.style.cursor = "nwse-resize";
        } else if (handle === "rect-tr" || handle === "rect-bl" || handle === "text-tr" || handle === "text-bl") {
          _annotateCanvas.style.cursor = "nesw-resize";
        } else if (handle === "rect-t" || handle === "rect-b") {
          _annotateCanvas.style.cursor = "ns-resize";
        } else if (handle === "rect-l" || handle === "rect-r") {
          _annotateCanvas.style.cursor = "ew-resize";
        } else {
          _annotateCanvas.style.cursor = "pointer";
        }
      } else if (hitTestShape(x, y) !== -1) {
        _annotateCanvas.style.cursor = "move";
      } else {
        _annotateCanvas.style.cursor = getToolCursor(_currentTool);
      }
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
      s.x1 = x;
      s.y1 = y;
    } else if (_dragAction === "arrow-end") {
      s.x2 = x;
      s.y2 = y;
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
      if (s.type === "arrow" || s.type === "rect" || s.type === "blur") {
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
      _activeShape.points.push({ x, y });
    } else {
      _activeShape.x2 = x;
      _activeShape.y2 = y;
    }
    renderCanvas();
  }
}

function onCanvasPointerUp(e) {
  if (!_isDrawing) return;
  _isDrawing = false;
  _dragAction = null;
  _shapeStartSnapshot = null;

  if (_activeShape) {
    _shapes.push(_activeShape);
    _undoStack.push({ type: "add", shape: _activeShape });
    _selectedShapeIndex = _shapes.length - 1;
    _activeShape = null;
    _redoStack = [];
    updateHistoryUI();
    renderCanvas();

    // Revert tool to select after drawing one shape (except brush and step badge)
    if (
      _currentTool !== "select" &&
      _currentTool !== "crop" &&
      _currentTool !== "pen" &&
      _currentTool !== "counter"
    ) {
      selectTool("select");
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

  _selectedShapeIndex = _shapes.length - 1;
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

async function handleCopyAnnotated() {
  _selectedShapeIndex = -1;
  renderCanvas();
  const exportCanvas = getCleanExportCanvas(false);
  if (!exportCanvas) return;

  const blob = await new Promise((res) =>
    exportCanvas.toBlob(res, "image/png"),
  );
  if (blob) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      window.SwiftSelect?.ui?.setStatus?.(
        "Copied to clipboard",
        2200,
        "success",
        false,
        { showAnnotate: false },
      );
    } catch {
      const reader = new FileReader();
      reader.onload = () => {
        chrome.runtime.sendMessage({
          type: "write-image-to-clipboard",
          dataUrl: reader.result,
        });
        window.SwiftSelect?.ui?.setStatus?.(
          "Copied to clipboard",
          2200,
          "success",
          false,
          { showAnnotate: false },
        );
      };
      reader.readAsDataURL(blob);
    }
  }
}

async function handleSaveAnnotated() {
  _selectedShapeIndex = -1;
  renderCanvas();

  const { format } = await getOutputSettings();
  const ext = format === "png" ? "png" : "jpg";
  const mime = format === "png" ? "image/png" : "image/jpeg";

  const exportCanvas = getCleanExportCanvas(ext === "jpg");
  if (!exportCanvas) return;

  const blob = await new Promise((res) =>
    exportCanvas.toBlob(res, mime, 0.92),
  );
  if (!blob) return;

  setLastBlob(blob, ext);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = getSmartFilename("annotated", ext);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  window.SwiftSelect?.ui?.setStatus?.(
    "Saved to downloads",
    2200,
    "saved",
    false,
    { showAnnotate: false },
  );
}

function onAnnotateKeyDown(e) {
  if (e.key === "Escape") {
    if (_strokePopoverEl && _strokePopoverEl.style.display !== "none") {
      _strokePopoverEl.style.display = "none";
      updateStrokeUI();
      return;
    }
    if (_currentTool === "crop") {
      _cropRect = null;
      hideCropControls();
      selectTool("select");
      return;
    }
    closeAnnotationEditor();
    return;
  }

  if (e.key === "Enter" && _currentTool === "crop") {
    applyCrop();
    return;
  }

  // Delete selected shape
  if ((e.key === "Delete" || e.key === "Backspace") && _selectedShapeIndex !== -1) {
    if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
      const removed = _shapes.splice(_selectedShapeIndex, 1)[0];
      if (removed) {
        _undoStack.push({ type: "delete", shape: removed, index: _selectedShapeIndex });
        _redoStack = [];
      }
      _selectedShapeIndex = -1;
      updateHistoryUI();
      renderCanvas();
      return;
    }
  }

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

  // Quick tool keys
  if (e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
    const k = e.key.toLowerCase();
    if (k === "v") selectTool("select");
    if (k === "a") selectTool("arrow");
    if (k === "r") selectTool("rect");
    if (k === "x" || k === "c") selectTool("crop");
    if (k === "s") selectTool("counter");
    if (k === "b") selectTool("blur");
    if (k === "p") selectTool("pen");
    if (k === "t") selectTool("text");
  }
}

export function closeAnnotationEditor() {
  if (!_annotateHost || _annotateHost.classList.contains("qs-closing")) return;
  _annotateHost.classList.add("qs-closing");

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
  _annotateHost.style.opacity = "0";
  _annotateHost.style.transition =
    "opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1)";

  setTimeout(() => {
    if (_annotateHost && _annotateHost.parentNode) {
      _annotateHost.parentNode.removeChild(_annotateHost);
    }
    _annotateHost = null;
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
    _currentOpacity = 1.0;
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
  }, 200);
}
