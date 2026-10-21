/**
 * SwiftSelect - Lightweight In-Browser Canvas Annotation Bar
 * Fast, dependency-free HTML5 2D Canvas editor for screenshots.
 * Tools: Select & Move, Arrow, Rectangle, Crop Photo, Step Counter (1, 2, 3), Blur/Redact, Pen, Text.
 * Palette, Stroke Width, Undo, Redo, Clear, Copy, Save.
 * Authentic Liquid Glass aesthetic with SVG turbulence refraction and spring in/out animations.
 */

import { getSmartFilename, getOutputSettings } from "./utils.js";
import { setLastBlob } from "./download.js";
import { loadStyles, getCachedCssText } from "../ui.js";

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
let _currentTool = "select"; // 'select' | 'arrow' | 'rect' | 'counter' | 'blur' | 'pen' | 'text' | 'crop'
let _currentColor = "#BA4B5C"; // SwiftSelect Coral
let _currentLineWidth = 4.5;
let _stepCounter = 1;

let _isDrawing = false;
let _activeShape = null;

// Selection & Move State
let _selectedShapeIndex = -1;
let _dragAction = null; // 'move' | 'arrow-start' | 'arrow-end' | 'rect-tl' | 'rect-tr' | 'rect-br' | 'rect-bl' | 'crop-handle' | 'crop-move'
let _dragStartPos = { x: 0, y: 0 };
let _shapeStartSnapshot = null;

// Crop State
let _cropRect = null; // { x, y, width, height }
let _cropControlsEl = null;

let _undoBtn = null;
let _redoBtn = null;
let _toolsGroup = null;
let _cropBtn = null;

const PALETTE = [
  "#BA4B5C", // Swift Coral
  "#EF4444", // Flame Red
  "#F59E0B", // Amber Gold
  "#10B981", // Emerald Green
  "#3B82F6", // Royal Blue
  "#8B5CF6", // Purple
  "#FFFFFF", // Pure White
];

const STROKE_WIDTHS = [
  { label: "Fine", width: 2.5, dotSize: 4 },
  { label: "Medium", width: 4.5, dotSize: 7 },
  { label: "Bold", width: 7.5, dotSize: 10 },
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

  _baseImage = img;
  _shapes = [];
  _undoStack = [];
  _redoStack = [];
  _stepCounter = 1;
  _selectedShapeIndex = -1;
  _cropRect = null;
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
    background: rgba(10, 10, 14, 0.55);
    user-select: none;
    font-family: 'Google Sans', 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #e1e1e1;
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
      title: "Select & Move (V)",
      svg: '<svg class="tool-icon-select" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="cursor-arrow" d="M3.5 3.5l7 17 2.8-7.2L20.5 10.5z"/><path class="cursor-cross" d="M13.3 13.3l6.2 6.2"/></svg>',
    },
    {
      id: "arrow",
      title: "Arrow (A)",
      svg: '<svg class="tool-icon-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line class="arrow-shaft" x1="5" y1="19" x2="19" y2="5"/><polyline class="arrow-head" points="11 5 19 5 19 13"/></svg>',
    },
    {
      id: "rect",
      title: "Rectangle Box (R)",
      svg: '<svg class="tool-icon-rect" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect class="rect-box" x="3.5" y="3.5" width="17" height="17" rx="3.5"/></svg>',
    },
    {
      id: "counter",
      title: "Step Badge 1,2,3 (S)",
      svg: '<svg class="tool-icon-counter" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle class="counter-ring" cx="12" cy="12" r="8.5"/><text class="counter-num" x="12" y="15.5" text-anchor="middle" font-size="10" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui, -apple-system, sans-serif">1</text></svg>',
    },
    {
      id: "blur",
      title: "Blur / Redact (B)",
      svg: '<svg class="tool-icon-blur" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect class="blur-b1" x="3" y="3" width="8" height="8" rx="1.5"/><rect class="blur-b2" x="13" y="3" width="8" height="8" rx="1.5"/><rect class="blur-b3" x="3" y="13" width="8" height="8" rx="1.5"/><rect class="blur-b4" x="13" y="13" width="8" height="8" rx="1.5"/></svg>',
    },
    {
      id: "pen",
      title: "Freehand Pen (P)",
      svg: '<svg class="tool-icon-pen" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="pen-body" d="M12 20h9"/><path class="pen-tip" d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    },
    {
      id: "text",
      title: "Text Caption (T)",
      svg: '<svg class="tool-icon-text" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline class="text-cap" points="4 7 4 4 20 4 20 7"/><line class="text-stem" x1="12" y1="4" x2="12" y2="20"/><line class="text-caret" x1="9" y1="20" x2="15" y2="20"/></svg>',
    },
  ];

  _toolsGroup = document.createElement("div");
  _toolsGroup.className = "qs-annotate-tools";
  _toolsGroup.style.cssText = "display: flex; gap: 4px; align-items: center;";

  tools.forEach((t) => {
    const btn = document.createElement("button");
    btn.dataset.tool = t.id;
    btn.title = t.title;
    btn.innerHTML = t.svg;
    const isActive = t.id === _currentTool;
    btn.className = `qs-guide-btn circle ${isActive ? "active" : ""}`;
    btn.onclick = (e) => {
      e?.stopPropagation?.();
      selectTool(t.id);
    };
    _toolsGroup.appendChild(btn);
  });
  toolbar.appendChild(_toolsGroup);

  // Dedicated Separate Crop Button
  const cropSep = document.createElement("div");
  cropSep.className = "qs-tool-sep";
  toolbar.appendChild(cropSep);

  _cropBtn = document.createElement("button");
  _cropBtn.className = `qs-guide-btn circle ${_currentTool === "crop" ? "active" : ""}`;
  _cropBtn.dataset.tool = "crop";
  _cropBtn.title = "Crop Image (X)";
  _cropBtn.innerHTML =
    '<svg class="tool-icon-crop" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="crop-bracket-1" d="M6 2v14a2 2 0 0 0 2 2h14"/><path class="crop-bracket-2" d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>';
  _cropBtn.onclick = (e) => {
    e?.stopPropagation?.();
    selectTool(_currentTool === "crop" ? "select" : "crop");
  };
  toolbar.appendChild(_cropBtn);

  // Separator
  const sep1 = document.createElement("div");
  sep1.className = "qs-tool-sep";
  toolbar.appendChild(sep1);

  // Stroke Width Selector Capsule
  const strokeGroup = document.createElement("div");
  strokeGroup.className = "qs-stroke-capsule";
  strokeGroup.title = "Stroke Thickness";

  STROKE_WIDTHS.forEach((sw) => {
    const sBtn = document.createElement("button");
    sBtn.title = `${sw.label} (${sw.width}px)`;
    sBtn.dataset.stroke = sw.width;
    const isAct = sw.width === _currentLineWidth;
    sBtn.style.cssText = `
      all: initial;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      background: ${isAct ? "rgba(255,255,255,0.35)" : "transparent"};
      transition: all 0.15s ease;
    `;
    const dot = document.createElement("div");
    dot.style.cssText = `
      width: ${sw.dotSize}px;
      height: ${sw.dotSize}px;
      border-radius: 50%;
      background: currentColor;
      opacity: ${isAct ? "1" : "0.55"};
    `;
    sBtn.appendChild(dot);
    sBtn.onclick = (e) => {
      e?.stopPropagation?.();
      _currentLineWidth = sw.width;
      if (_selectedShapeIndex !== -1 && _shapes[_selectedShapeIndex]) {
        _shapes[_selectedShapeIndex].lineWidth = sw.width;
        if (_shapes[_selectedShapeIndex].type === "text") {
          const fontMap = { 2.5: 18, 4.5: 28, 7.5: 42 };
          _shapes[_selectedShapeIndex].fontSize = fontMap[sw.width] || 28;
        }
        renderCanvas();
      }
      strokeGroup.querySelectorAll("button").forEach((b) => {
        const act = Number(b.dataset.stroke) === _currentLineWidth;
        b.style.background = act ? "rgba(255,255,255,0.35)" : "transparent";
        b.querySelector("div").style.opacity = act ? "1" : "0.55";
      });
    };
    strokeGroup.appendChild(sBtn);
  });
  toolbar.appendChild(strokeGroup);

  // Separator
  const sep2 = document.createElement("div");
  sep2.className = "qs-tool-sep";
  toolbar.appendChild(sep2);

  // Palette Swatches
  const paletteGroup = document.createElement("div");
  paletteGroup.className = "qs-palette-row";
  PALETTE.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.dataset.color = color;
    swatch.title = `Color ${color}`;
    const isActive = color === _currentColor;
    swatch.style.cssText = `
      all: initial;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: ${color};
      cursor: pointer;
      box-shadow: ${
        isActive
          ? `0 0 0 2px #ffffff, 0 0 0 4.5px ${color}, 0 4px 10px rgba(0,0,0,0.45)`
          : "0 0 0 1px rgba(255,255,255,0.25), 0 2px 4px rgba(0,0,0,0.3)"
      };
      transform: ${isActive ? "scale(1.15)" : "scale(1)"};
      transition: transform 0.16s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.16s ease;
      flex-shrink: 0;
    `;
    swatch.onclick = (e) => {
      e?.stopPropagation?.();
      _currentColor = color;
      if (_selectedShapeIndex !== -1 && _shapes[_selectedShapeIndex]) {
        _shapes[_selectedShapeIndex].color = color;
        renderCanvas();
      }
      paletteGroup.querySelectorAll("button").forEach((s) => {
        const act = s.dataset.color === _currentColor;
        s.style.boxShadow = act
          ? `0 0 0 2px #ffffff, 0 0 0 4.5px ${s.dataset.color}, 0 4px 10px rgba(0,0,0,0.45)`
          : "0 0 0 1px rgba(255,255,255,0.25), 0 2px 4px rgba(0,0,0,0.3)";
        s.style.transform = act ? "scale(1.15)" : "scale(1)";
      });
    };
    paletteGroup.appendChild(swatch);
  });
  toolbar.appendChild(paletteGroup);

  // Separator
  const sep3 = document.createElement("div");
  sep3.className = "qs-tool-sep";
  toolbar.appendChild(sep3);

  // History Group: Undo & Redo & Clear
  const historyGroup = document.createElement("div");
  historyGroup.className = "qs-annotate-history";
  historyGroup.style.cssText = "display: flex; gap: 4px; align-items: center;";

  // Undo Button
  _undoBtn = document.createElement("button");
  _undoBtn.className = "qs-guide-btn circle";
  _undoBtn.title = "Undo (Ctrl+Z)";
  _undoBtn.innerHTML =
    '<svg class="tool-icon-undo" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="undo-arrow" d="M3 7v6h6"/><path class="undo-arc" d="M3 13a9 9 0 1 0 2.5-6.3L3 9"/></svg>';
  _undoBtn.onclick = (e) => {
    e?.stopPropagation?.();
    handleUndo();
  };
  historyGroup.appendChild(_undoBtn);

  // Redo Button
  _redoBtn = document.createElement("button");
  _redoBtn.className = "qs-guide-btn circle";
  _redoBtn.title = "Redo (Ctrl+Y / Ctrl+Shift+Z)";
  _redoBtn.innerHTML =
    '<svg class="tool-icon-redo" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="redo-arrow" d="M21 7v6h-6"/><path class="redo-arc" d="M21 13a9 9 0 1 1-2.5-6.3L21 9"/></svg>';
  _redoBtn.onclick = (e) => {
    e?.stopPropagation?.();
    handleRedo();
  };
  historyGroup.appendChild(_redoBtn);

  // Clear Canvas Button
  const clearBtn = document.createElement("button");
  clearBtn.className = "qs-guide-btn circle";
  clearBtn.title = "Clear All Annotations";
  clearBtn.innerHTML =
    '<svg class="tool-icon-clear" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="trash-lid" d="M3 6h18M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path class="trash-body" d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
  clearBtn.onclick = (e) => {
    e?.stopPropagation?.();
    handleClearAll();
  };
  historyGroup.appendChild(clearBtn);

  toolbar.appendChild(historyGroup);

  // Separator
  const sep4 = document.createElement("div");
  sep4.className = "qs-tool-sep";
  toolbar.appendChild(sep4);

  // Copy Button
  const copyBtn = document.createElement("button");
  copyBtn.className = "qs-guide-btn pill";
  copyBtn.title = "Copy Annotated Image (Ctrl+C)";
  copyBtn.innerHTML =
    '<svg class="tool-icon-copy" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect class="copy-card-1" x="9" y="9" width="13" height="13" rx="2.5"/><path class="copy-card-2" d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>Copy</span>';
  copyBtn.onclick = async (e) => {
    e?.stopPropagation?.();
    await handleCopyAnnotated();
    const sp = copyBtn.querySelector("span");
    if (sp) sp.textContent = "Copied!";
    setTimeout(() => {
      if (sp) sp.textContent = "Copy";
    }, 1400);
  };
  toolbar.appendChild(copyBtn);

  // Save/Download Button
  const saveBtn = document.createElement("button");
  saveBtn.className = "qs-guide-btn pill";
  saveBtn.title = "Download Annotated Image (Ctrl+S)";
  saveBtn.innerHTML =
    '<svg class="tool-icon-save" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="dl-tray" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><g class="dl-arrow"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></g></svg><span>Save</span>';
  saveBtn.onclick = (e) => {
    e?.stopPropagation?.();
    handleSaveAnnotated();
  };
  toolbar.appendChild(saveBtn);

  // Close Button
  const closeBtn = document.createElement("button");
  closeBtn.className = "qs-guide-btn circle";
  closeBtn.title = "Close (Esc)";
  closeBtn.innerHTML =
    '<svg class="tool-icon-close" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line class="close-x1" x1="18" y1="6" x2="6" y2="18"/><line class="close-x2" x1="6" y1="6" x2="18" y2="18"/></svg>';
  closeBtn.onclick = (e) => {
    e?.stopPropagation?.();
    closeAnnotationEditor();
  };
  toolbar.appendChild(closeBtn);

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
    box-shadow: 0 25px 60px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.14);
    border-radius: 12px;
    cursor: crosshair;
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
  window.addEventListener("pointermove", onCanvasPointerMove);
  window.addEventListener("pointerup", onCanvasPointerUp);
  window.addEventListener("keydown", onAnnotateKeyDown, true);

  document.body.appendChild(_annotateHost);

  requestAnimationFrame(() => {
    if (_annotateHost) _annotateHost.style.opacity = "1";
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
  showCropControls();
}

function showCropControls() {
  if (!_annotateHost || !_cropRect) return;
  if (!_cropControlsEl) {
    _cropControlsEl = document.createElement("div");
    _cropControlsEl.className = "qs-crop-controls qs-theme-glass";
    _cropControlsEl.addEventListener("pointerdown", (e) => e.stopPropagation());
    const uiTheme = window.SwiftSelect?.theme;
    if (uiTheme?.applyElementTheme) {
      uiTheme.applyElementTheme(_cropControlsEl, "glass");
    }
    _cropControlsEl.innerHTML = `
      <div class="qs-crop-meta">
        <svg class="qs-crop-meta-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>
        <span class="qs-crop-dim">${Math.round(_cropRect.width)} × ${Math.round(_cropRect.height)} <small>px</small></span>
      </div>
      <div class="qs-tool-sep"></div>
      <button class="qs-guide-btn pill qs-crop-apply-btn active" title="Apply Crop (Enter)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span>Apply</span>
      </button>
      <button class="qs-guide-btn pill qs-crop-cancel-btn" title="Cancel Crop (Esc)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        <span>Cancel</span>
      </button>
    `;
    _cropControlsEl.querySelector(".qs-crop-apply-btn").onclick = (e) => {
      e?.stopPropagation?.();
      applyCrop();
    };
    _cropControlsEl.querySelector(".qs-crop-cancel-btn").onclick = (e) => {
      e?.stopPropagation?.();
      _cropRect = null;
      hideCropControls();
      selectTool("select");
    };
    _annotateHost.appendChild(_cropControlsEl);
  } else {
    const dimEl = _cropControlsEl.querySelector(".qs-crop-dim");
    if (dimEl) {
      dimEl.innerHTML = `${Math.round(_cropRect.width)} × ${Math.round(_cropRect.height)} <small>px</small>`;
    }
  }
}

function hideCropControls() {
  if (_cropControlsEl) {
    _cropControlsEl.remove();
    _cropControlsEl = null;
  }
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

function hitTestHandles(x, y) {
  if (_selectedShapeIndex === -1 || !_shapes[_selectedShapeIndex]) return null;
  const s = _shapes[_selectedShapeIndex];

  if (s.type === "arrow") {
    if (Math.sqrt(distSq(x, y, s.x1, s.y1)) <= 14) return "arrow-start";
    if (Math.sqrt(distSq(x, y, s.x2, s.y2)) <= 14) return "arrow-end";
  } else if (s.type === "rect" || s.type === "blur") {
    const minX = Math.min(s.x1, s.x2);
    const maxX = Math.max(s.x1, s.x2);
    const minY = Math.min(s.y1, s.y2);
    const maxY = Math.max(s.y1, s.y2);
    if (Math.sqrt(distSq(x, y, minX, minY)) <= 14) return "rect-tl";
    if (Math.sqrt(distSq(x, y, maxX, minY)) <= 14) return "rect-tr";
    if (Math.sqrt(distSq(x, y, maxX, maxY)) <= 14) return "rect-br";
    if (Math.sqrt(distSq(x, y, minX, maxY)) <= 14) return "rect-bl";
  } else if (s.type === "text") {
    const fontSize = s.fontSize || 24;
    const boxW = Math.max(30, s.width || 120) + 12;
    const boxH = (s.height || Math.round(fontSize * 1.25)) + 8;
    const tlX = s.x - 6;
    const tlY = s.y - 4;
    const brX = tlX + boxW;
    const brY = tlY + boxH;

    if (Math.sqrt(distSq(x, y, brX, brY)) <= 14) return "text-br";
    if (Math.sqrt(distSq(x, y, brX, tlY)) <= 14) return "text-tr";
    if (Math.sqrt(distSq(x, y, tlX, brY)) <= 14) return "text-bl";
    if (Math.sqrt(distSq(x, y, tlX, tlY)) <= 14) return "text-tl";
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

  if (s.type === "arrow") {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    const lw = s.lineWidth || 4.5;
    ctx.lineWidth = lw;

    const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    const headLen = Math.max(16, lw * 3.8);

    // Stop line before the tip under the arrowhead so NO circular cap pokes through
    const shaftEndX = s.x2 - headLen * 0.72 * Math.cos(angle);
    const shaftEndY = s.y2 - headLen * 0.72 * Math.sin(angle);

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
    const fontSize = s.fontSize || 24;
    ctx.font = `bold ${fontSize}px 'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
    ctx.fillStyle = s.color;
    ctx.textBaseline = "top";
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = 6;
    ctx.fillText(s.text, s.x, s.y);

    const metrics = ctx.measureText(s.text);
    s.width = metrics.width;
    s.height = Math.round(fontSize * 1.25);

    if (isSelected) {
      ctx.strokeStyle = "#03d5ff";
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
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#3B82F6";
  ctx.lineWidth = 2.5;
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawCropOverlay(ctx) {
  const { width, height } = _annotateCanvas;
  const { x, y, width: cw, height: ch } = _cropRect;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";

  // Dim 4 areas outside crop rectangle
  ctx.fillRect(0, 0, width, y);
  ctx.fillRect(0, y, x, ch);
  ctx.fillRect(x + cw, y, width - (x + cw), ch);
  ctx.fillRect(0, y + ch, width, height - (y + ch));

  // Crop border
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.8;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, cw, ch);

  // 8 handles
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
  const rect = _annotateCanvas.getBoundingClientRect();
  const scaleX = _annotateCanvas.width / rect.width;
  const scaleY = _annotateCanvas.height / rect.height;

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

function spawnInlineTextInput(canvasX, canvasY) {
  if (_textInputOverlay) {
    try {
      if (_textInputOverlay.parentNode) {
        _textInputOverlay.parentNode.removeChild(_textInputOverlay);
      }
    } catch {}
    _textInputOverlay = null;
  }
  const pos = getScreenCoords(canvasX, canvasY);
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type text...";
  input.style.cssText = `
    position: fixed;
    left: ${pos.x}px;
    top: ${pos.y}px;
    z-index: 2147483649;
    font-family: 'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 18px;
    font-weight: 700;
    color: ${_currentColor};
    background: rgba(18, 18, 24, 0.92);
    border: 1.5px solid #3B82F6;
    border-radius: 6px;
    padding: 4px 8px;
    outline: none;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    min-width: 140px;
  `;
  _annotateHost.appendChild(input);
  _textInputOverlay = input;

  function commitText() {
    if (!input || !input.parentNode) return;
    const val = input.value.trim();
    if (val) {
      const s = {
        type: "text",
        x: canvasX,
        y: canvasY,
        text: val,
        color: _currentColor,
        fontSize: 24,
      };
      _shapes.push(s);
      _undoStack.push({ type: "add", shape: s });
      _redoStack = [];
      _selectedShapeIndex = _shapes.length - 1;
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

  setTimeout(() => input.focus(), 20);
}

function isNearCanvasEdge(x, y) {
  if (!_annotateCanvas) return false;
  const w = _annotateCanvas.width;
  const h = _annotateCanvas.height;
  const edgeDist = 18;
  return (
    x >= 0 && x <= w && y >= 0 && y <= h &&
    (x <= edgeDist || x >= w - edgeDist || y <= edgeDist || y >= h - edgeDist)
  );
}

function onCanvasPointerDown(e) {
  if (e.button !== 0) return;
  dismissLingeringMainMenu();
  const { x, y } = getCanvasCoords(e);

  // 1. Crop Mode interactions
  if (_currentTool === "crop" && _cropRect) {
    const minX = _cropRect.x;
    const maxX = _cropRect.x + _cropRect.width;
    const minY = _cropRect.y;
    const maxY = _cropRect.y + _cropRect.height;

    // Check corner handles
    if (Math.sqrt(distSq(x, y, minX, minY)) <= 16) _dragAction = "crop-tl";
    else if (Math.sqrt(distSq(x, y, maxX, minY)) <= 16) _dragAction = "crop-tr";
    else if (Math.sqrt(distSq(x, y, maxX, maxY)) <= 16) _dragAction = "crop-br";
    else if (Math.sqrt(distSq(x, y, minX, maxY)) <= 16) _dragAction = "crop-bl";
    else if (x >= minX && x <= maxX && y >= minY && y <= maxY) _dragAction = "crop-move";
    else {
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
    } else if (isNearCanvasEdge(x, y)) {
      // Near edge hover/click in select mode triggers crop mode
      selectTool("crop");
      _cropRect = {
        x: Math.min(x, _annotateCanvas.width - 20),
        y: Math.min(y, _annotateCanvas.height - 20),
        width: 0,
        height: 0,
      };
      _dragAction = "crop-new";
      _dragStartPos = { x, y };
      _shapeStartSnapshot = { ..._cropRect };
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
    };
    _shapes.push(s);
    _undoStack.push({ type: "add", shape: s });
    _selectedShapeIndex = _shapes.length - 1;
    _redoStack = [];
    updateHistoryUI();
    renderCanvas();
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
    };
  }
}

function onCanvasPointerMove(e) {
  if (!_isDrawing) {
    // Cursor hover update
    if (_currentTool === "crop") {
      _annotateCanvas.style.cursor = "crosshair";
    } else {
      const { x, y } = getCanvasCoords(e);
      const handle = hitTestHandles(x, y);
      if (handle) {
        if (handle === "rect-tl" || handle === "rect-br" || handle === "text-br" || handle === "text-tl") {
          _annotateCanvas.style.cursor = "nwse-resize";
        } else if (handle === "rect-tr" || handle === "rect-bl" || handle === "text-tr" || handle === "text-bl") {
          _annotateCanvas.style.cursor = "nesw-resize";
        } else {
          _annotateCanvas.style.cursor = "pointer";
        }
      } else if (hitTestShape(x, y) !== -1) {
        _annotateCanvas.style.cursor = "move";
      } else if (_currentTool === "select" && isNearCanvasEdge(x, y)) {
        _annotateCanvas.style.cursor = "crosshair";
      } else {
        _annotateCanvas.style.cursor = _currentTool === "select" ? "default" : "crosshair";
      }
    }
    return;
  }

  const { x, y } = getCanvasCoords(e);
  const dx = x - _dragStartPos.x;
  const dy = y - _dragStartPos.y;

  // Dragging crop
  if (_currentTool === "crop" && _cropRect) {
    if (_dragAction === "crop-move" && _shapeStartSnapshot) {
      _cropRect.x = Math.max(0, Math.min(_annotateCanvas.width - _cropRect.width, _shapeStartSnapshot.x + dx));
      _cropRect.y = Math.max(0, Math.min(_annotateCanvas.height - _cropRect.height, _shapeStartSnapshot.y + dy));
    } else if (_dragAction === "crop-new") {
      _cropRect.width = Math.abs(x - _dragStartPos.x);
      _cropRect.height = Math.abs(y - _dragStartPos.y);
      _cropRect.x = Math.min(x, _dragStartPos.x);
      _cropRect.y = Math.min(y, _dragStartPos.y);
    } else if (_dragAction === "crop-br" && _shapeStartSnapshot) {
      _cropRect.width = Math.max(20, _shapeStartSnapshot.width + dx);
      _cropRect.height = Math.max(20, _shapeStartSnapshot.height + dy);
    } else if (_dragAction === "crop-tl" && _shapeStartSnapshot) {
      _cropRect.x = _shapeStartSnapshot.x + dx;
      _cropRect.y = _shapeStartSnapshot.y + dy;
      _cropRect.width = Math.max(20, _shapeStartSnapshot.width - dx);
      _cropRect.height = Math.max(20, _shapeStartSnapshot.height - dy);
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

    // After drawing one shape, revert tool to select & move (except counter and crop)
    if (_currentTool !== "select" && _currentTool !== "counter" && _currentTool !== "crop") {
      selectTool("select");
    }
  }
}

// ─── Undo, Redo & Clear History ──────────────────────────────────────

function updateHistoryUI() {
  const canUndo = _undoStack.length > 0;
  const canRedo = _redoStack.length > 0;
  if (_undoBtn) {
    _undoBtn.style.opacity = canUndo ? "1" : "0.35";
    _undoBtn.style.pointerEvents = canUndo ? "auto" : "none";
  }
  if (_redoBtn) {
    _redoBtn.style.opacity = canRedo ? "1" : "0.35";
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
    exportCanvas.toBlob(res, mime, 0.98),
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
    if (k === "x") selectTool("crop");
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
    _selectedShapeIndex = -1;
    _scratchBlurCanvas = null;
    _scratchBlurCtx = null;
    _shapes = [];
    _undoStack = [];
    _redoStack = [];
    _stepCounter = 1;
    _cropRect = null;
    _activeShape = null;
    _isDrawing = false;
  }, 200);
}
