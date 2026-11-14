/**
 * UI management for SwiftSelect
 */

import {
  handleCaptureVisible,
  handleCaptureAndDownload,
  handleTimedCapture,
} from "./capture/region.js";
import {
  handleCaptureFullPage,
  handleCaptureHorizontal,
} from "./capture/fullpage.js";
import {
  handleThemeToggle,
  applyTheme,
  applyElementTheme,
  setTabScreenshot,
  shouldUseDarkMode,
  currentUserTheme,
  isPageDark,
} from "./theme.js";
import { removeListeners } from "./events.js";
import { getOutputSettingsSync, pickToolbarLook, currentToolbarLook } from "./capture/utils.js";
import { openAnnotationEditor } from "./capture/annotate.js";
import { handleSaveAction, getLastBlob } from "./capture/download.js";
import { openPeek, closePeek, isPeekOpen } from "./peek.js";
import stylesCss from "./styles.min.css";

export let overlayHost = null;
export let statusHost = null;
export let guideHost = null;
export let highlighterHost = null;
export let keyGuideHost = null;
export let keyGuideEl = null;
export let countdownHost = null;
export let countdownEl = null;
let countdownInterval = null;
export let overlay = null;
export let box = null;
export let statusEl = null;
export let guideEl = null;
export let highlighterEl = null;
export let hudEl = null;
export let curtains = [];
export let snapBlurPanels = [];
export let overlayShadow = null;
export let guideShadow = null;
export let freezeBg = null;
export let freezeFrameDataUrl = null;
export let freezeFramePromise = null;
export let freezeFrameVersion = 0;

export function releaseFreeze() {
  freezeFrameVersion++;
  freezeFrameDataUrl = null;
  freezeFramePromise = null;
}

// Track timers
export let hideStatusTimer = null;
export let hideGuideTimer = null;
export let currentStatus = null;

export function setHideStatusTimer(timer) {
  hideStatusTimer = timer;
}

export function setCurrentStatus(status) {
  currentStatus = status;
}

export function getFreezeFrameDataUrl() {
  return freezeFrameDataUrl;
}

export function getFreezeFramePromise() {
  return freezeFramePromise;
}

// Shared CSS Sheet
export let qsSheet = null;
export let stylePromise = null;
export let safetyListenersAdded = false;
export let cachedCssText = stylesCss;

/**
 * Manrope ships with the extension. @font-face inside a shadow root
 * is ignored, so the faces are registered on the document under a private
 * family name ("SS Manrope") that no page stylesheet will ever ask for.
 * They are read as bytes, so a strict page CSP (font-src) cannot block them.
 * Until they arrive (or if they cannot), the stack falls back to Segoe UI /
 * the system font, so nothing waits on this.
 */
let fontsRequested = false;
export function loadFonts() {
  if (fontsRequested) return;
  fontsRequested = true;
  const faces = [
    ["manrope-latin.woff2", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"],
    ["manrope-latin-ext.woff2", "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1E9F, U+1EF2-1EFF, U+20A0-20AB, U+20AD-20C0, U+2C60-2C7F, U+A720-A7FF"],
  ];
  for (const [file, unicodeRange] of faces) {
    (async () => {
      try {
        const res = await fetch(chrome.runtime.getURL(`fonts/${file}`));
        if (!res.ok) return;
        const face = new FontFace("SS Manrope", await res.arrayBuffer(), { weight: "200 800", display: "swap", unicodeRange });
        await face.load();
        document.fonts.add(face);
      } catch {}
    })();
  }
}

export async function loadStyles() {
  loadFonts();
  if (stylePromise) return stylePromise;
  stylePromise = (async () => {
    try {
      if (!cachedCssText) {
        cachedCssText = stylesCss;
      }
      qsSheet = new CSSStyleSheet();
      await qsSheet.replace(cachedCssText);
    } catch (err) {
      console.error("SwiftSelect: Failed to load styles.css", err);
    }
  })();
  return stylePromise;
}

export function getCachedCssText() {
  return cachedCssText;
}

export function addSafetyListeners() {
  if (safetyListenersAdded) return;
  safetyListenersAdded = true;
  const cleanup = () => {
    try {
      removeCrosshairCursor();
    } catch {}
  };
  window.addEventListener("beforeunload", cleanup);
  window.addEventListener("visibilitychange", () => {
    try {
      if (document.visibilityState === "hidden") cleanup();
    } catch {}
  });
}

// Animation frames
export let updateFrameId = null;
export let isUpdating = false;
export let lastHudText = "";
export let pendingRect = null;

export function makeShadowOverlay(
  tag,
  className,
  innerHTML = "",
  autoShow = true,
) {
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";
  host.style.inset = "0";
  host.style.setProperty("background", "transparent", "important");
  host.style.setProperty("background-color", "transparent", "important");
  host.style.setProperty("border", "none", "important");
  host.style.setProperty("box-shadow", "none", "important");
  host.style.display = "none"; // Start hidden to prevent flash
  host.dataset.qsRole = className;
  host.classList.add("qs-shadow-host", `${className}-host`);
  const targetParent = document.body || document.documentElement;
  if (targetParent) {
    targetParent.appendChild(host);
  }

  const shadow = host.attachShadow({ mode: "open" });
  if (qsSheet) {
    shadow.adoptedStyleSheets = [qsSheet];
  }
  const el = document.createElement(tag);
  el.className = className;
  if (innerHTML) el.innerHTML = innerHTML;
  if (!qsSheet) {
    el.style.opacity = "0"; // Second layer of flash protection
  }
  shadow.appendChild(el);

  (async () => {
    if (!qsSheet) {
      await loadStyles();
      if (qsSheet) {
        shadow.adoptedStyleSheets = [qsSheet];
      }
      setTimeout(() => {
        if (el) el.style.opacity = "";
      }, 0);
    }
    // Restore layout only if autoShow is requested
    if (autoShow) {
      host.style.display = "block";
    }
  })();

  return { host, el, shadow };
}

export function createSvg(viewBox, pathData, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", viewBox);
  if (className) svg.setAttribute("class", className);

  const parts = Array.isArray(pathData) ? pathData : [pathData];
  parts.forEach((p) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    for (const [attr, val] of Object.entries(p)) {
      path.setAttribute(attr, val);
    }
    svg.appendChild(path);
  });
  return svg;
}

export function setCrosshairCursor() {
  try {
    if (document?.body?.style) {
      document.body.style.setProperty("cursor", "crosshair", "important");
    }
    if (document?.documentElement?.style) {
      document.documentElement.style.setProperty(
        "cursor",
        "crosshair",
        "important",
      );
    }
    const parent = document?.head || document?.documentElement;
    if (document && parent && !document.getElementById("qs-cursor-style")) {
      const style = document.createElement("style");
      style.id = "qs-cursor-style";
      style.textContent = "body *, html * { cursor: crosshair !important; }";
      parent.appendChild(style);
    }
  } catch {}
}

export function removeCrosshairCursor() {
  try {
    if (document?.body?.style) {
      document.body.style.removeProperty("cursor");
    }
    if (document?.documentElement?.style) {
      document.documentElement.style.removeProperty("cursor");
    }
    const style = document?.getElementById("qs-cursor-style");
    if (style && style.parentNode) {
      style.parentNode.removeChild(style);
    }
  } catch {}
}

// ─── Movable capture toolbar ─────────────────────────────────────────
// Press anywhere on the toolbar and move more than a few pixels to drag it;
// a press that does not move is still a click. No grip needed. The spot is
// remembered as a fraction of the window, so it survives reloads and window
// resizes. Double-click the empty glass to send it home.

let _guidePos = null;
try {
  chrome.storage?.local?.get?.(["toolbarPosition"], (d) => {
    if (d?.toolbarPosition && typeof d.toolbarPosition.x === "number") {
      _guidePos = d.toolbarPosition;
      if (guideEl?.isConnected) applyGuidePos(guideEl);
    }
  });
} catch {}

function applyGuidePos(el) {
  if (!_guidePos) {
    el.style.removeProperty("left");
    el.style.removeProperty("top");
    el.style.removeProperty("right");
    return;
  }
  const r = el.getBoundingClientRect();
  const w = r.width || 400;
  const h = r.height || 64;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, _guidePos.x * window.innerWidth));
  const top = Math.max(8, Math.min(window.innerHeight - h - 8, _guidePos.y * window.innerHeight));
  el.style.setProperty("left", `${Math.round(left)}px`, "important");
  el.style.setProperty("top", `${Math.round(top)}px`, "important");
  el.style.setProperty("right", "auto", "important");
}

function makeGuideDraggable(el) {
  let drag = null;
  let suppressClick = false;
  const stop = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // Captures in the open drawer are dragged into the page, not the bar.
    if (e.target.closest?.(".qs-peek-drawer")) return;
    suppressClick = false;
    const r = el.getBoundingClientRect();
    drag = { sx: e.clientX, sy: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, h: r.height, id: e.pointerId, active: false };
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
      drag.active = true;
      try {
        el.setPointerCapture(drag.id);
      } catch {}
      el.classList.add("qs-dragging");
      hideCustomTooltip();
    }
    stop(e);
    const left = Math.max(8, Math.min(window.innerWidth - drag.w - 8, e.clientX - drag.ox));
    const top = Math.max(8, Math.min(window.innerHeight - drag.h - 8, e.clientY - drag.oy));
    _guidePos = { x: left / window.innerWidth, y: top / window.innerHeight };
    applyGuidePos(el);
  });
  const end = (e) => {
    if (!drag) return;
    const wasDragging = drag.active;
    drag = null;
    el.classList.remove("qs-dragging");
    if (!wasDragging) return;
    suppressClick = true;
    stop(e);
    try {
      chrome.storage.local.set({ toolbarPosition: _guidePos });
    } catch {}
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  // The click that ends a drag is not a button press.
  el.addEventListener(
    "click",
    (e) => {
      if (!suppressClick) return;
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true,
  );
  el.addEventListener("dblclick", (e) => {
    if (e.target.closest?.("button, .qs-peek-drawer")) return;
    _guidePos = null;
    applyGuidePos(el);
    try {
      chrome.storage.local.remove("toolbarPosition");
    } catch {}
  });
  requestAnimationFrame(() => applyGuidePos(el));
}

export async function ensureUi() {
  if (document.getElementById("swiftselect-annotate-root")) {
    return;
  }
  setCrosshairCursor();
  removeFlash();

  if (hideGuideTimer) {
    clearTimeout(hideGuideTimer);
    hideGuideTimer = null;
  }

  if (!overlayHost || !overlayHost.isConnected) {
    if (overlayHost && overlayHost.parentNode) {
      overlayHost.parentNode.removeChild(overlayHost);
    }
    const frameVersion = ++freezeFrameVersion;
    freezeFrameDataUrl = null;
    freezeFramePromise = null;

    const { host, el, shadow } = makeShadowOverlay("div", "qs-ovl");
    overlayHost = host;
    overlay = el;
    overlayShadow = shadow;
    overlayHost.style.pointerEvents = "none";

    // Start background frame capture into memory for region crops (never overlaying on DOM)
    freezeFramePromise = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 3500);
      try {
        chrome.runtime.sendMessage({ type: "capture-visible-tab" }, (resp) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          if (resp && resp.success && frameVersion === freezeFrameVersion) {
            freezeFrameDataUrl = resp.dataUrl;
            setTabScreenshot(resp.dataUrl);
            resolve(resp.dataUrl);
            return;
          }
          resolve(null);
        });
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });

    curtains = [];
    const c = document.createElement("div");
    c.className = "qs-curtain";
    c.style.zIndex = "2";
    overlay.appendChild(c);
    curtains.push(c);

    snapBlurPanels = [];
    for (let i = 0; i < 4; i++) {
      const panel = document.createElement("div");
      panel.className = "qs-snap-blur-panel";
      panel.style.zIndex = "2";
      overlay.appendChild(panel);
      snapBlurPanels.push(panel);
    }

    box = document.createElement("div");
    box.className = "qs-box";
    overlay.appendChild(box);

    hudEl = document.createElement("div");
    hudEl.className = "qs-hud";
    box.style.display = "none";
    if (hudEl) hudEl.style.display = "none";
    overlay.appendChild(hudEl);
  }

  if (!statusHost || !statusHost.isConnected) {
    if (statusHost && statusHost.parentNode) {
      statusHost.parentNode.removeChild(statusHost);
    }
    const { host, el } = makeShadowOverlay("div", "qs-status", "", false);
    statusHost = host;
    statusEl = el;
    statusHost.style.display = "none";
    statusEl.style.display = "none";
  }

  if (!highlighterHost || !highlighterHost.isConnected) {
    if (highlighterHost && highlighterHost.parentNode) {
      highlighterHost.parentNode.removeChild(highlighterHost);
    }
    const { host, el } = makeShadowOverlay("div", "qs-highlighter", "", false);
    highlighterHost = host;
    highlighterEl = el;
    highlighterHost.style.display = "none";
  }

  if (hudEl) {
    applyElementTheme(hudEl, currentUserTheme);
  }

  if (!guideHost || !guideHost.isConnected) {
    if (guideHost && guideHost.parentNode) {
      guideHost.parentNode.removeChild(guideHost);
    }
    const { host, el, shadow } = makeShadowOverlay("div", "qs-guide");
    host.id = "qs-guide-host";
    host.className = "qs-guide-host";
    guideHost = host;
    guideEl = el;
    guideShadow = shadow;
    // A fresh look each time the toolbar opens (or the one chosen in Settings).
    guideEl.dataset.look = pickToolbarLook();

    const surface = document.createElement("div");
    surface.className = "qs-glass-surface";
    guideEl.appendChild(surface);

    const buttonsSet = document.createElement("div");
    buttonsSet.className = "qs-guide-buttons";
    guideEl.appendChild(buttonsSet);
    makeGuideDraggable(guideEl);


    // Visible Area
    const visibleBtn = document.createElement("button");
    visibleBtn.className = "qs-guide-btn";
    visibleBtn.dataset.action = "capture-visible";
    visibleBtn.dataset.tooltip = "Save & Copy Visible (V)";

    const eyeSvg = createSvg("0 0 24 24", [
      {
        class: "eye-lid",
        d: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z",
      },
    ]);
    const eyePupil = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "circle",
    );
    eyePupil.setAttribute("class", "eye-pupil");
    eyePupil.setAttribute("cx", "12");
    eyePupil.setAttribute("cy", "12");
    eyePupil.setAttribute("r", "3");
    eyeSvg.appendChild(eyePupil);

    const visibleSpan = document.createElement("span");
    visibleSpan.textContent = "Visible Area";
    visibleBtn.appendChild(eyeSvg);
    visibleBtn.appendChild(visibleSpan);
    buttonsSet.appendChild(visibleBtn);

    // Horizontal capture left the toolbar (rarely used): it stays on Alt+H,
    // the H key, the quick menu and the context menu.

    // Full Page
    const fullBtn = document.createElement("button");
    fullBtn.className = "qs-guide-btn";
    fullBtn.dataset.action = "capture-full";
    fullBtn.dataset.tooltip = "Save Full Page (F)";
    const fpSvg = createSvg("0 -960 960 960", [
      {
        class: "fp-corner fp-tl",
        d: "M67-743.87V-933h189.13v73H140v116.13H67Z",
      },
      {
        class: "fp-corner fp-tr",
        d: "M893-743.87V-933H703.87v73H820v116.13h73Z",
      },
      {
        class: "fp-corner fp-br",
        d: "M893-216.13V-27H703.87v-73H820v-116.13h73Z",
      },
      {
        class: "fp-corner fp-bl",
        d: "M67-216.13V-27H256.13v-73H140v-116.13H67Z",
      },
      {
        class: "fp-box",
        d: "M273-233h414v-494H273v494Zm0 79.22q-31.38 0-55.3-23.92-23.92-23.92-23.92-55.3v-494q0-31.38 23.92-55.3 23.92-23.92 55.3-23.92h414q31.38 0 55.3 23.92 23.92 23.92 23.92 55.3v494q0 31.38-23.92 55.3-23.92 23.92-55.3 23.92H273Z",
      },
      {
        class: "fp-inner-lines",
        d: "M367.74-567.74h225.09v-65.09H367.74v65.09Zm0 120h225.09v-65.09H367.74v65.09Zm0 120h225.09v-65.09H367.74v65.09Z",
      },
    ]);
    fullBtn.appendChild(fpSvg);
    fullBtn.classList.add("qs-icon-btn");
    fullBtn.setAttribute("aria-label", "Full Page");
    buttonsSet.appendChild(fullBtn);

    // Annotate Button
    const annotateBtn = document.createElement("button");
    annotateBtn.className = "qs-guide-btn";
    annotateBtn.dataset.action = "annotate";
    annotateBtn.dataset.tooltip = "Annotate (A)";
    const annSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    annSvg.setAttribute("viewBox", "-4 -4 32 32");
    annSvg.setAttribute("class", "ann-icon-svg");
    annSvg.setAttribute("fill", "none");
    annSvg.setAttribute("stroke", "currentColor");
    annSvg.setAttribute("stroke-width", "2");
    annSvg.setAttribute("stroke-linecap", "round");
    annSvg.setAttribute("stroke-linejoin", "round");
    annSvg.innerHTML = `
      <path class="ann-line" d="M12 20h9"/>
      <path class="ann-pen" d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    `;
    const annSpan = document.createElement("span");
    annSpan.textContent = "Annotate";
    annotateBtn.appendChild(annSvg);
    annotateBtn.appendChild(annSpan);
    buttonsSet.appendChild(annotateBtn);

    // Listeners
    visibleBtn.onclick = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      handleCaptureVisible();
    };
    fullBtn.onclick = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      handleCaptureFullPage();
    };
    // Gallery, Convert and Settings: three tiles that open the toolbar's own
    // panel on that tab. While the panel is open they fuse into its tabs, and
    // the chevron at the end folds it away again.
    const TILE_ICONS = {
      gallery:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect class="gal-frame" x="3" y="4" width="18" height="16" rx="3"/><circle class="gal-sun" cx="8.5" cy="9.5" r="1.6"/><path class="gal-hills" d="m4 17 5-4.5 3.5 3L16 12l4.5 4.5"/></svg>',
      convert:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="cv-r" d="M4 8h13M13.5 4.5 17 8l-3.5 3.5"/><path class="cv-l" d="M20 16H7M10.5 12.5 7 16l3.5 3.5"/></svg>',
      settings:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path class="st-a" d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle class="st-b" cx="15" cy="7" r="2"/><circle class="st-c" cx="9" cy="17" r="2"/></svg>',
    };
    const TILE_LABEL = { gallery: "Gallery", convert: "Convert", settings: "Settings" };
    const tiles = {};
    for (const tab of ["convert", "gallery", "settings"]) {
      const b = document.createElement("button");
      // Convert opens the full Batch Converter; Gallery and Settings open
      // the panel and fuse into its tabs while it is open.
      b.className = `qs-guide-btn qs-gallery-btn qs-tile-${tab}${tab === "convert" ? "" : " qs-fuse"}`;
      b.dataset.action = tab;
      b.setAttribute("aria-label", TILE_LABEL[tab]);
      b.innerHTML = TILE_ICONS[tab];
      b.onclick = (e) => {
        e?.preventDefault?.();
        e?.stopPropagation?.();
        hideCustomTooltip();
        if (tab === "convert") {
          closePeek({ immediate: true });
          window.SwiftSelect?.events?.cleanup?.();
          cleanup();
          try {
            chrome.runtime.sendMessage({ type: "open-convert" }, () => void chrome.runtime.lastError);
          } catch {}
          return;
        }
        openPeek(b, tab);
      };
      buttonsSet.appendChild(b);
      tiles[tab] = b;
    }
    const galleryBtn = tiles.gallery;

    const expandBtn = document.createElement("button");
    expandBtn.className = "qs-guide-btn qs-expand-btn";
    expandBtn.dataset.action = "expand";
    expandBtn.setAttribute("aria-label", "Show more");
    expandBtn.setAttribute("aria-expanded", "false");
    expandBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
    expandBtn.onclick = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      hideCustomTooltip();
      if (isPeekOpen()) closePeek();
      else openPeek(expandBtn);
    };
    buttonsSet.appendChild(expandBtn);

    annotateBtn.onclick = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      window.SwiftSelect?.events?.cleanup?.();
      hideGuide(true);
      openAnnotationEditor();
    };

    const isMac =
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPod|iPad/.test(navigator.platform || navigator.userAgent);
    const keyS = isMac ? "Ctrl+S" : "Alt+S";
    const keyF = isMac ? "Ctrl+F" : "Alt+F";
    const keyA = getOutputSettingsSync().toolbarShortcuts ? "A" : "";

    attachTooltip(
      visibleBtn,
      "Visible Area",
      "Saves and copies what is currently displayed on your screen.",
      keyS,
    );
    attachTooltip(
      fullBtn,
      "Full Page",
      "Scrolls and stitches the entire webpage into one complete high-resolution image.",
      keyF,
    );
    // These four are explored rather than known: their tooltips come quickly.
    attachTooltip(tiles.convert, "Batch Converter", "Opens in a new tab: drop images, convert, resize, compress.", "", 350);
    attachTooltip(galleryBtn, "Gallery", "Recent captures, ready to drag into the page or copy.", "", 350);
    attachTooltip(tiles.settings, "Settings", "The settings you change most, without leaving the page.", "", 350);
    attachTooltip(expandBtn, "More", "Gallery and Settings in one panel.", "", 350);
    attachTooltip(
      annotateBtn,
      "Annotate Editor",
      "Draw arrows, boxes, step counters, and blur sensitive text.",
      keyA,
    );
  }

  if (guideHost) {
    if (document.getElementById("swiftselect-annotate-root")) {
      guideHost.style.display = "none";
      hideCustomTooltip();
      return;
    }
    // Theme first, then reflow: if the reflow came first the browser would
    // compute the unthemed colours and animate from them (a visible flash).
    applyElementTheme(guideEl, currentUserTheme);
    guideHost.style.display = "flex";
    guideEl.classList.remove("qs-hiding");
    void guideEl.offsetWidth;
  }
}

/**
 * Pointer-tracked specular highlight for glass buttons: the light sits where
 * the pointer is, the way a real glass surface catches it. Writes two CSS
 * variables per move, nothing else.
 */
export function trackSheen(root, selector = ".qs-guide-btn, .qs-save-btn, .qs-stroke-tune-btn") {
  if (!root || root._qsSheen) return;
  root._qsSheen = true;
  root.addEventListener(
    "pointermove",
    (e) => {
      const btn = e.target?.closest?.(selector);
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      btn.style.setProperty("--qs-mx", `${Math.round(e.clientX - r.left)}px`);
      btn.style.setProperty("--qs-my", `${Math.round(e.clientY - r.top)}px`);
    },
    { passive: true },
  );
}

export let menuTooltipEl = null;
let tooltipTimer = null;
let tooltipGuard = null;

/**
 * Let the surface that owns the buttons veto a tooltip, e.g. while a panel
 * opens where the tooltip would land, or while another preview is showing.
 * The guard gets the button and returns false to keep the tooltip hidden.
 */
export function setTooltipGuard(fn) {
  tooltipGuard = typeof fn === "function" ? fn : null;
  if (tooltipGuard) hideCustomTooltip();
}

export function hideCustomTooltip() {
  if (tooltipTimer) {
    clearTimeout(tooltipTimer);
    tooltipTimer = null;
  }
  if (menuTooltipEl) {
    menuTooltipEl.classList.remove("qs-tooltip-visible");
    menuTooltipEl.style.display = "none";
  }
}

export function showCustomTooltip(btn, title, desc = "", key = "", host = null) {
  if (!btn || !btn.isConnected) return;
  try {
    if (tooltipGuard && tooltipGuard(btn) === false) return;
  } catch {}
  const parent = host || guideShadow || document.getElementById("swiftselect-annotate-root") || document.body;
  if (!parent) return;

  if (!menuTooltipEl || !menuTooltipEl.isConnected || menuTooltipEl.parentNode !== parent) {
    if (menuTooltipEl && menuTooltipEl.parentNode) {
      menuTooltipEl.parentNode.removeChild(menuTooltipEl);
    }
    menuTooltipEl = document.createElement("div");
    menuTooltipEl.className = "qs-custom-tooltip";
    parent.appendChild(menuTooltipEl);
  }

  const isCompact = !desc;
  menuTooltipEl.classList.toggle("qs-tooltip-compact", isCompact);

  menuTooltipEl.innerHTML = `
    <div class="qs-tooltip-header">
      <span class="qs-tooltip-title">${title}</span>
      ${key ? `<span class="qs-tooltip-key">${key}</span>` : ""}
    </div>
    ${desc ? `<div class="qs-tooltip-desc">${desc}</div>` : ""}
  `;

  // A tooltip wears the tone of the bar it belongs to. Sampling the page
  // under it instead gave light glass with dark text over dark pages.
  const surface = btn.closest?.(".qs-theme-glass, .qs-theme-dark");
  menuTooltipEl.classList.remove("qs-theme-dark", "qs-theme-glass", "qs-theme-glass-dark");
  menuTooltipEl.dataset.look = btn.closest?.("[data-look]")?.dataset.look || currentToolbarLook();
  if (surface) {
    const dark = surface.classList.contains("qs-theme-glass-dark") || surface.classList.contains("qs-theme-dark");
    menuTooltipEl.classList.add("qs-theme-glass");
    if (dark) menuTooltipEl.classList.add("qs-theme-glass-dark");
  } else {
    applyElementTheme(menuTooltipEl, currentUserTheme);
  }
  menuTooltipEl.style.display = "flex";

  const btnRect = btn.getBoundingClientRect();
  const actualRect = menuTooltipEl.getBoundingClientRect();
  const tipWidth = actualRect.width || (isCompact ? 140 : 250);

  let left = btnRect.left + btnRect.width / 2;
  let top = btnRect.bottom + 10;

  // Flip above button if near the bottom of viewport
  if (top + (actualRect.height || 40) > window.innerHeight - 10) {
    top = Math.max(10, btnRect.top - (actualRect.height || 40) - 10);
  }

  const minLeft = tipWidth / 2 + 12;
  const maxLeft = window.innerWidth - tipWidth / 2 - 12;
  left = Math.max(minLeft, Math.min(maxLeft, left));

  menuTooltipEl.style.left = `${Math.round(left)}px`;
  menuTooltipEl.style.top = `${Math.round(top)}px`;

  requestAnimationFrame(() => {
    if (menuTooltipEl) menuTooltipEl.classList.add("qs-tooltip-visible");
  });
}

export function attachTooltip(btn, title, desc, key, delayMs = 1600, host = null) {
  if (!btn) return;
  btn.addEventListener("pointerenter", () => {
    hideCustomTooltip();
    tooltipTimer = setTimeout(() => {
      showCustomTooltip(btn, title, desc, key, host);
    }, delayMs);
  });
  btn.addEventListener("pointerleave", hideCustomTooltip);
  btn.addEventListener("pointerdown", hideCustomTooltip);
  btn.addEventListener("click", hideCustomTooltip);
}

export function ensureKeyGuide() {
  if (keyGuideHost && keyGuideEl) {
    keyGuideHost.style.display = "flex";
    return;
  }

  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPod|iPad/.test(navigator.platform || navigator.userAgent);
  const snapKey = isMac ? "⌘" : "Ctrl";

  const { host, el } = makeShadowOverlay("div", "qs-key-guide");
  keyGuideHost = host;
  keyGuideEl = el;

  keyGuideEl.innerHTML = `
    <div class="qs-key-pill" data-key="control"><kbd>${snapKey}</kbd><span>Snap</span></div>
    <div class="qs-key-pill" data-key="space"><kbd>Space</kbd><span>Pan</span></div>
    <div class="qs-key-pill" data-key="shift"><kbd>Shift</kbd><span>1:1</span></div>
    <div class="qs-key-pill" data-key="t"><kbd>T</kbd><span>Timer</span></div>
    <div class="qs-key-pill" data-key="c"><kbd>C</kbd><span>Color</span></div>
    <div class="qs-key-pill" data-key="a"><kbd>A</kbd><span>Annotate</span></div>
    <div class="qs-key-pill" data-key="escape"><kbd>Esc</kbd><span>Cancel</span></div>
  `;

  keyGuideEl.querySelectorAll(".qs-key-pill").forEach((pill) => {
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      const k = pill.dataset.key;
      if (k === "t") {
        handleTimedCapture(3);
      } else if (k === "a") {
        openAnnotationEditor();
      } else if (k === "escape") {
        cleanup();
        setStatus("Canceled", 1200);
      }
    });
  });

  applyElementTheme(keyGuideEl, currentUserTheme);
}

export function updateKeyGuideKey(key, isPressed) {
  if (!keyGuideEl) return;
  const k = key.toLowerCase();
  let selector = `[data-key="${k}"]`;
  if (k === "meta" || k === "control") selector = '[data-key="control"]';
  const pill = keyGuideEl.querySelector(selector);
  if (pill) {
    pill.classList.toggle("active", isPressed);
  }
}

export function hideKeyGuide() {
  if (keyGuideHost) keyGuideHost.style.display = "none";
}

export function startTimedCountdown(seconds = 3, onComplete) {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  hideKeyGuide();
  if (guideHost) guideHost.style.display = "none";
  if (overlayHost) overlayHost.style.display = "none";

  if (!countdownHost) {
    const { host, el } = makeShadowOverlay("div", "qs-countdown-card");
    countdownHost = host;
    countdownEl = el;
  }
  countdownHost.style.display = "flex";

  let remaining = seconds;

  function updateDisplay() {
    if (!countdownEl) return;
    countdownEl.innerHTML = `
      <div class="qs-countdown-ring-box">
        <svg class="qs-countdown-svg" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r="30" class="qs-ring-bg"/>
          <circle cx="36" cy="36" r="30" class="qs-ring-prog" style="stroke-dashoffset: ${(1 - remaining / seconds) * 188.5};"/>
        </svg>
        <span class="qs-countdown-num">${remaining}</span>
      </div>
      <div class="qs-countdown-text">
        <span class="qs-countdown-title">Timed Capture</span>
        <span class="qs-countdown-subtitle">Hover menus or tooltips now...</span>
      </div>
      <button class="qs-countdown-cancel" title="Cancel (Esc)">✕</button>
    `;

    applyElementTheme(countdownEl, currentUserTheme);

    const cancelBtn = countdownEl.querySelector(".qs-countdown-cancel");
    if (cancelBtn) {
      cancelBtn.onclick = () => cancelTimedCountdown();
    }
  }

  updateDisplay();

  const onKey = (e) => {
    if (e.key === "Escape") {
      cancelTimedCountdown();
      window.removeEventListener("keydown", onKey, true);
    }
  };
  window.addEventListener("keydown", onKey, true);

  countdownInterval = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      updateDisplay();
    } else {
      clearInterval(countdownInterval);
      countdownInterval = null;
      if (countdownHost) countdownHost.style.display = "none";
      window.removeEventListener("keydown", onKey, true);
      if (onComplete) onComplete();
    }
  }, 1000);
}

export function cancelTimedCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (countdownHost) countdownHost.style.display = "none";
  setStatus("Timer Canceled", 1200);
}

export function setSelecting(isSelecting) {
  if (!overlay) return;
  if (isSelecting) {
    overlay.classList.add("qs-selecting");
  } else {
    // Cancel any pending animation frames FIRST to prevent stale callbacks
    // from re-showing the HUD after we hide it
    if (updateFrameId) {
      cancelAnimationFrame(updateFrameId);
      updateFrameId = null;
    }
    isUpdating = false;
    pendingRect = null;
    lastHudText = "";
    overlay.classList.remove("qs-selecting");
    curtains.forEach((c) => (c.style.display = "none"));
    snapBlurPanels.forEach((panel) => (panel.style.display = "none"));
    if (box) box.style.display = "none";
    if (hudEl) {
      hudEl.style.display = "none";
      // Remove the animation so it won't replay on accidental re-show
      hudEl.style.animation = "none";
    }
  }
}

export function setStatus(msg, timeout = 1500, type = "info", noAnim = false, options = {}) {
  if (!msg || !msg.trim()) return;

  if (!statusHost || !statusEl) {
    const { host, el } = makeShadowOverlay("div", "qs-status");
    statusHost = host;
    statusEl = el;
  }

  if (hideStatusTimer) clearTimeout(hideStatusTimer);

  const isUpdating = !!(
    currentStatus &&
    statusEl &&
    statusHost &&
    statusHost.style.display !== "none" &&
    !statusEl.classList.contains("qs-hiding")
  );

  statusEl.className = "qs-status";
  statusEl.classList.remove("qs-hiding");
  if (noAnim) statusEl.classList.add("no-anim");

  while (statusEl.firstChild) statusEl.removeChild(statusEl.firstChild);
  const iconEl = document.createElement("div");
  iconEl.className = "qs-status-icon";

  // One stroke glyph per outcome, drawn white on a tile in the outcome's
  // colour. The kind also tints the pill's glass (see data-kind in CSS).
  const GLYPHS = {
    success: "M5.5 12.5l4.2 4.2L18.5 7.5",
    saved: "M12 4.5v10M7.8 10.6L12 14.8l4.2-4.2M5.5 19h13",
    error: "M12 6v8M12 18.4v.01",
    cancel: "M7.5 7.5l9 9M16.5 7.5l-9 9",
    color: "M5.5 12.5l4.2 4.2L18.5 7.5",
    timer: "M12 8v4.5l3 1.8M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z",
    info: "M12 11v6M12 7.4v.01",
  };
  const colorMatch = /#[0-9a-f]{6}\b/i.exec(msg);
  const kind =
    type === "error"
      ? "error"
      : /cancel|abort/i.test(msg)
        ? "cancel"
        : colorMatch && /colou?r/i.test(msg)
          ? "color"
          : type === "success" || type === "saved"
            ? type
            : /timer|second/i.test(msg)
              ? "timer"
              : "info";
  statusEl.dataset.kind = kind;
  if (kind === "color") iconEl.style.setProperty("--qs-swatch", colorMatch[0]);
  else iconEl.style.removeProperty("--qs-swatch");
  const iconSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  iconSvg.setAttribute("viewBox", "0 0 24 24");
  iconSvg.setAttribute("class", `qs-status-glyph is-${kind}`);
  iconSvg.setAttribute("fill", "none");
  iconSvg.setAttribute("stroke", "currentColor");
  iconSvg.setAttribute("stroke-width", "2.6");
  iconSvg.setAttribute("stroke-linecap", "round");
  iconSvg.setAttribute("stroke-linejoin", "round");
  const glyphPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  glyphPath.setAttribute("d", GLYPHS[kind]);
  iconSvg.appendChild(glyphPath);
  iconEl.appendChild(iconSvg);

  statusEl.appendChild(iconEl);
  const textSpan = document.createElement("span");
  textSpan.className = "qs-status-text";
  const title = document.createElement("b");
  title.textContent = msg;
  textSpan.appendChild(title);
  if (options?.detail) {
    const detail = document.createElement("small");
    detail.textContent = options.detail;
    textSpan.appendChild(detail);
  }
  statusEl.appendChild(textSpan);

  // Offer Download only when the capture has not already been saved as a file.
  if (type === "success" && (options?.downloaded || kind === "color")) {
    statusEl.classList.add("qs-success");
    timeout = 5000;
  } else if (type === "success") {
    statusEl.classList.add("qs-success");
    const saveBtn = document.createElement("button");
    saveBtn.className = "qs-save-btn";
    // A custom tooltip, not a native title: a title tooltip appears late and
    // lingers over whatever opens next (the editor, the gallery tray).
    saveBtn.setAttribute("aria-label", "Download");
    attachTooltip(saveBtn, "Download", "", "", 450, statusEl.getRootNode());
    // Stroke icon, same weight as the annotate pen beside it.
    const dlIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    dlIcon.setAttribute("viewBox", "0 0 24 24");
    dlIcon.setAttribute("fill", "none");
    dlIcon.setAttribute("stroke", "currentColor");
    dlIcon.setAttribute("stroke-width", "2");
    dlIcon.setAttribute("stroke-linecap", "round");
    dlIcon.setAttribute("stroke-linejoin", "round");
    dlIcon.innerHTML = '<path class="dl-arrow" d="M12 4v10.5M7.5 10L12 14.5 16.5 10"/><path class="dl-bar" d="M5 19.5h14"/>';
    saveBtn.appendChild(dlIcon);

    saveBtn.onclick = () => {
      handleSaveAction();
    };
    statusEl.appendChild(saveBtn);
    timeout = 5000;
  } else if (type === "saved") {
    statusEl.classList.add("qs-saved");
    timeout = 3500;
  } else if (type === "error") {
    statusEl.classList.add("qs-error");
    timeout = 2500;
  }

  // Annotate Icon Button (Only for normal page captures, not when already inside annotate)
  const isAnnotateActive =
    options?.showAnnotate === false ||
    (typeof document !== "undefined" &&
      !!document.getElementById("swiftselect-annotate-root"));

  if ((type === "success" || type === "saved") && !isAnnotateActive && kind !== "color") {
    const annotateBtn = document.createElement("button");
    annotateBtn.className = "qs-save-btn qs-status-annotate-btn";
    annotateBtn.setAttribute("aria-label", "Annotate");
    attachTooltip(annotateBtn, "Annotate", "", "", 450, statusEl.getRootNode());
    const annSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    annSvg.setAttribute("viewBox", "0 0 24 24");
    annSvg.setAttribute("class", "ann-icon-svg");
    annSvg.setAttribute("fill", "none");
    annSvg.setAttribute("stroke", "currentColor");
    annSvg.setAttribute("stroke-width", "2");
    annSvg.setAttribute("stroke-linecap", "round");
    annSvg.setAttribute("stroke-linejoin", "round");
    annSvg.style.width = "18px";
    annSvg.style.height = "18px";
    annSvg.innerHTML = `
      <path class="ann-line" d="M12 20h9"/>
      <path class="ann-pen" d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    `;
    annotateBtn.appendChild(annSvg);

    annotateBtn.onclick = () => {
      hideCustomTooltip();
      const source = options?.sourceBlob || getLastBlob?.();
      if (source) {
        openAnnotationEditor(source);
      } else {
        openAnnotationEditor();
      }
    };
    statusEl.appendChild(annotateBtn);
  }


  applyElementTheme(statusEl, currentUserTheme);
  statusHost.style.display = "";
  statusEl.style.display = "flex";
  currentStatus = type;

  if (!isUpdating && !noAnim) {
    statusEl.style.animation = "none";
    void statusEl.offsetWidth;
    statusEl.style.animation = "";
  }

  if (isUpdating) {
    statusEl.getAnimations().forEach(anim => { if (!anim.animationName) anim.cancel(); });
    const textSpan = statusEl.querySelector('span');
    if (textSpan) {
      textSpan.animate([
        { opacity: 0, transform: "scale(0.94)" },
        { opacity: 1, transform: "scale(1)" }
      ], {
        duration: 180,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      });
    }

    const icon = statusEl.querySelector('.qs-status-icon');
    if (icon) {
      icon.animate([
        { opacity: 0, transform: "scale(0.88)" },
        { opacity: 1, transform: "scale(1)" }
      ], {
        duration: 180,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      });
    }
  }

  if (timeout > 0) {
    hideStatusTimer = setTimeout(() => {
      if (!statusEl) return;
      if (menuTooltipEl && menuTooltipEl.getRootNode() === statusEl.getRootNode()) hideCustomTooltip();
      statusEl.classList.add("qs-hiding");
      setTimeout(() => {
        if (statusEl?.classList?.contains("qs-hiding")) {
          statusEl.style.display = "none";
          if (statusHost) statusHost.style.display = "none";
          statusEl.classList.remove("qs-hiding");
          currentStatus = null;
        }
      }, 180);
    }, timeout);
  }
}

export function updateSelection(rect) {
  if (!overlay || !box || !hudEl) return;
  pendingRect = {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };

  if (isUpdating) return;
  isUpdating = true;

  updateFrameId = requestAnimationFrame(() => {
    isUpdating = false;
    const r = pendingRect;
    if (!r || !box || !hudEl) return;
    const canRenderSelection =
      overlay.classList.contains("qs-selecting") ||
      overlay.classList.contains("qs-snapping");
    if (!canRenderSelection) {
      if (box) box.style.display = "none";
      if (hudEl) hudEl.style.display = "none";
      curtains.forEach((c) => {
        if (c) c.style.display = "none";
      });
      snapBlurPanels.forEach((panel) => {
        if (panel) panel.style.display = "none";
      });
      return;
    }

    const x1 = r.left;
    const y1 = r.top;
    const x2 = r.left + r.width;
    const y2 = r.top + r.height;

    const isVisible = r.width > 2 || r.height > 2;
    if (!isVisible) {
      if (box) box.style.display = "none";
      if (hudEl) hudEl.style.display = "none";
      curtains.forEach((c) => {
        if (c) c.style.display = "none";
      });
      snapBlurPanels.forEach((panel) => {
        if (panel) panel.style.display = "none";
      });
      return;
    }

    if (box) {
      box.style.display = "block";
      box.style.width = r.width + "px";
      box.style.height = r.height + "px";
      box.style.transform = `translate3d(${x1}px, ${y1}px, 0)`;
    }

    const gap = 10;
    const hudHeight = 24;
    let hudTop = y1 - hudHeight - gap;
    let hudLeft = x1;
    if (hudTop < 10) hudTop = y2 + gap;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    let hudText = `${w} × ${h}`;
    if (window.SwiftSelect?.events?.isShiftPressed || (w === h && w > 0)) {
      hudText += " · 1:1";
    }
    if (window.SwiftSelect?.events?.isSpacePressed) {
      hudText += " · Move";
    }
    if (lastHudText !== hudText) {
      if (hudEl) hudEl.textContent = hudText;
      lastHudText = hudText;
    }
    if (hudEl) {
      hudEl.style.display = "block";
      // Restore animation for fresh appearances (e.g. new drag)
      hudEl.style.animation = "";
      hudEl.style.transform = `translate3d(${hudLeft}px, ${hudTop}px, 0)`;
    }

    const hudRect = {
      left: hudLeft,
      top: hudTop,
      width: hudEl.offsetWidth || 90,
      height: hudHeight,
    };
    applyElementTheme(hudEl, currentUserTheme, hudRect);

    if (curtains && curtains.length === 1) {
      const curtain = curtains[0];
      curtain.style.display = "block";
      curtain.style.width = r.width + "px";
      curtain.style.height = r.height + "px";
      curtain.style.transform = `translate3d(${x1 - 4000}px, ${y1 - 4000}px, 0)`;
    }

    if (snapBlurPanels && snapBlurPanels.length === 4) {
      const [topPanel, rightPanel, bottomPanel, leftPanel] = snapBlurPanels;

      topPanel.style.display = "block";
      topPanel.style.transform = "translate3d(0, 0, 0)";
      topPanel.style.width = window.innerWidth + "px";
      topPanel.style.height = Math.max(0, y1) + "px";

      rightPanel.style.display = "block";
      rightPanel.style.transform = `translate3d(${x2}px, ${y1}px, 0)`;
      rightPanel.style.width = Math.max(0, window.innerWidth - x2) + "px";
      rightPanel.style.height = Math.max(0, r.height) + "px";

      bottomPanel.style.display = "block";
      bottomPanel.style.transform = `translate3d(0, ${y2}px, 0)`;
      bottomPanel.style.width = window.innerWidth + "px";
      bottomPanel.style.height = Math.max(0, window.innerHeight - y2) + "px";

      leftPanel.style.display = "block";
      leftPanel.style.transform = `translate3d(0, ${y1}px, 0)`;
      leftPanel.style.width = Math.max(0, x1) + "px";
      leftPanel.style.height = Math.max(0, r.height) + "px";
    }
  });
}

export let flashHost = null;

export function removeFlash() {
  if (flashHost && flashHost.parentNode) {
    flashHost.parentNode.removeChild(flashHost);
  }
  flashHost = null;
  const orphanFlashes = document.querySelectorAll(
    "[data-qs-role='qs-flash'], .qs-flash-host",
  );
  orphanFlashes.forEach((node) => {
    if (node.parentNode) node.parentNode.removeChild(node);
  });
}

export function triggerFlash(targetRect = null) {
  removeFlash();

  const { host, el, shadow } = makeShadowOverlay("div", "qs-flash");
  host.dataset.qsRole = "qs-flash";
  host.classList.add("qs-flash-host");
  flashHost = host;

  if (qsSheet && shadow) {
    shadow.adoptedStyleSheets = [qsSheet];
  }
  host.style.display = "block";
  el.style.opacity = "";

  if (!isPageDark()) el.classList.add("qs-flash-inverse");

  if (targetRect) {
    el.style.left = targetRect.left + "px";
    el.style.top = targetRect.top + "px";
    el.style.width = targetRect.width + "px";
    el.style.height = targetRect.height + "px";
    el.style.position = "fixed";
    el.style.setProperty("border-radius", "8px", "important");
    el.style.overflow = "hidden";
  } else {
    el.classList.add("qs-flash-fullscreen");
    el.style.inset = "0";
    el.style.position = "fixed";
    el.style.setProperty("border-radius", "0", "important");
  }

  setTimeout(() => {
    if (host && host.parentNode) host.parentNode.removeChild(host);
    if (flashHost === host) flashHost = null;
  }, 380);
}

export function setButtonLoading(action, loading) {
  if (!guideShadow) return;
  const btn = guideShadow.querySelector(`[data-action="${action}"]`);
  if (btn) {
    if (loading) {
      btn.classList.add("qs-loading");
      btn.disabled = true;
    } else {
      btn.classList.remove("qs-loading");
      btn.disabled = false;
    }
  }
}

export async function hideUiForCapture() {
  removeFlash();
  hideCustomTooltip();
  hideKeyGuide();
  if (guideHost) guideHost.style.display = "none";
  if (overlayHost) overlayHost.style.display = "none";
  if (highlighterHost) highlighterHost.style.display = "none";
  if (countdownHost) countdownHost.style.display = "none";

  if (statusHost && statusHost.style.display !== "none") {
    if (hideStatusTimer) clearTimeout(hideStatusTimer);
    if (statusEl) {
      statusEl.classList.add("qs-hiding");
      statusEl.style.display = "none";
      statusEl.classList.remove("qs-hiding");
    }
    if (statusHost) {
      statusHost.style.display = "none";
    }
    currentStatus = null;
  }

  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
}

export function cleanup(preserveStatus = false, preserveFreeze = false) {
  removeFlash();
  // The recent-captures drawer lives inside the toolbar: it goes with it.
  closePeek({ immediate: true });
  hideCustomTooltip();
  menuTooltipEl = null;
  removeCrosshairCursor();
  if (updateFrameId) {
    cancelAnimationFrame(updateFrameId);
    updateFrameId = null;
  }
  isUpdating = false;
  pendingRect = null;
  addSafetyListeners();

  if (keyGuideHost && keyGuideHost.parentNode) {
    keyGuideHost.parentNode.removeChild(keyGuideHost);
  }
  keyGuideHost = null;
  keyGuideEl = null;

  if (countdownHost && countdownHost.parentNode) {
    countdownHost.parentNode.removeChild(countdownHost);
  }
  countdownHost = null;
  countdownEl = null;
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  if (overlay) {
    overlay.classList.remove("qs-selecting");
    overlay.style.clipPath = "";
  }

  if (overlayHost && overlayHost.parentNode)
    overlayHost.parentNode.removeChild(overlayHost);
  overlayHost = null;
  overlay = null;
  box = null;
  hudEl = null;
  freezeBg = null;
  if (!preserveFreeze) {
    freezeFrameVersion++;
    freezeFrameDataUrl = null;
    freezeFramePromise = null;
  }
  curtains = [];
  snapBlurPanels = [];

  if (highlighterHost && highlighterHost.parentNode)
    highlighterHost.parentNode.removeChild(highlighterHost);
  highlighterHost = null;
  highlighterEl = null;

  hideGuide(true);

  if (!preserveStatus) {
    if (hideStatusTimer) {
      clearTimeout(hideStatusTimer);
      hideStatusTimer = null;
    }
    if (statusHost && statusHost.parentNode) {
      statusHost.parentNode.removeChild(statusHost);
    }
    statusHost = null;
    statusEl = null;
    currentStatus = null;
  }
}

export function hideGuide(immediately = false) {
  hideCustomTooltip();
  closePeek({ immediate: true });
  if (hideGuideTimer) {
    clearTimeout(hideGuideTimer);
    hideGuideTimer = null;
  }
  if (guideEl) {
    guideEl.classList.add("qs-hiding");
  }
  const remove = () => {
    hideCustomTooltip();
    hideGuideTimer = null;
    if (guideHost && guideHost.parentNode) {
      guideHost.parentNode.removeChild(guideHost);
    }
    guideHost = null;
    guideEl = null;
    guideShadow = null;
  };
  if (immediately) {
    remove();
  } else {
    hideGuideTimer = setTimeout(remove, 180);
  }
}

export function updateBadge(text, color = "#BA4B5C") {
  chrome.runtime.sendMessage({ type: "update-badge", text, color });
}

export let shortcutsModalHost = null;

export function showShortcutsHelpModal() {
  if (shortcutsModalHost) {
    shortcutsModalHost.remove();
    shortcutsModalHost = null;
  }

  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPod|iPad/.test(navigator.platform || navigator.userAgent);
  const metaKey = isMac ? "⌘" : "Ctrl";
  const altKey = isMac ? "Ctrl" : "Alt";

  const host = document.createElement("div");
  host.id = "qs-shortcuts-modal-root";
  host.style.cssText = `
    all: initial;
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 10, 14, 0.65);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    user-select: none;
    font-family: 'SS Selawik', 'Selawik', 'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif;
    color: #f4f4f5;
    opacity: 0;
    transition: opacity 0.14s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  const card = document.createElement("div");
  card.style.cssText = `
    width: 460px;
    max-width: 92vw;
    background-color: color-mix(in srgb, var(--c-glass, #bbbbbc) 12%, rgba(27, 27, 29, 0.94));
    border: none;
    border-radius: 20px;
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, #fff calc(0.3 * 10%), transparent),
      inset 1.8px 3px 0px -2px color-mix(in srgb, #fff calc(0.3 * 90%), transparent),
      inset -2px -2px 0px -2px color-mix(in srgb, #fff calc(0.3 * 80%), transparent),
      inset -3px -8px 1px -6px color-mix(in srgb, #fff calc(0.3 * 60%), transparent),
      inset -0.3px -1px 4px 0px color-mix(in srgb, #000 calc(2 * 12%), transparent),
      inset -1.5px 2.5px 0px -2px color-mix(in srgb, #000 calc(2 * 20%), transparent),
      inset 0px 3px 4px -2px color-mix(in srgb, #000 calc(2 * 20%), transparent),
      inset 2px -6.5px 1px -4px color-mix(in srgb, #000 calc(2 * 10%), transparent),
      0px 1px 5px 0px color-mix(in srgb, #000 calc(2 * 10%), transparent),
      0px 20px 48px 0px rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(16px) url(#glass-blur) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
    padding: 24px 26px;
    box-sizing: border-box;
    transform: translate3d(0, 16px, 0) scale(0.92);
    transition: transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.12s ease;
  `;

  card.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.1);">
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="width: 34px; height: 34px; border-radius: 10px; background: #BA4B5C; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(186,75,92,0.45);">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </div>
        <div>
          <div style="font-size: 16px; font-weight: 700; color: #ffffff; letter-spacing: -0.2px;">SwiftSelect Shortcuts</div>
          <div style="font-size: 12px; color: rgba(255,255,255,0.55);">Quick reference guide</div>
        </div>
      </div>
      <button class="qs-modal-close" style="all: initial; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: rgba(255,255,255,0.6); background: rgba(255,255,255,0.06); transition: all 0.15s ease;" title="Close (Esc)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>

    <div style="display: flex; flex-direction: column; gap: 18px; font-size: 13px;">
      <div>
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: rgba(255,255,255,0.42); letter-spacing: 0.8px; margin-bottom: 9px;">Capture Commands</div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: rgba(255,255,255,0.85);">Area Selection</span>
            <kbd style="background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 6px; font-family: monospace; font-size: 11.5px; border: 1px solid rgba(255,255,255,0.15); color: #ffffff;">${altKey}+X</kbd>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: rgba(255,255,255,0.85);">Capture Visible Screen</span>
            <kbd style="background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 6px; font-family: monospace; font-size: 11.5px; border: 1px solid rgba(255,255,255,0.15); color: #ffffff;">${altKey}+S</kbd>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: rgba(255,255,255,0.85);">Horizontal Scroll View</span>
            <kbd style="background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 6px; font-family: monospace; font-size: 11.5px; border: 1px solid rgba(255,255,255,0.15); color: #ffffff;">${altKey}+H</kbd>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: rgba(255,255,255,0.85);">Full Webpage Stitching</span>
            <kbd style="background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 6px; font-family: monospace; font-size: 11.5px; border: 1px solid rgba(255,255,255,0.15); color: #ffffff;">${altKey}+F</kbd>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: rgba(255,255,255,0.85);">3-Second Delayed Capture</span>
            <kbd style="background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 6px; font-family: monospace; font-size: 11.5px; border: 1px solid rgba(255,255,255,0.15); color: #ffffff;">${altKey}+T</kbd>
          </div>
        </div>
      </div>

      <div>
        <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: rgba(255,255,255,0.42); letter-spacing: 0.8px; margin-bottom: 9px;">Selection Helpers & Canvas</div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: rgba(255,255,255,0.85);">Smart Element Snapping</span>
            <div style="display: flex; align-items: center; gap: 6px;"><kbd style="background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 6px; font-family: monospace; font-size: 11.5px; border: 1px solid rgba(255,255,255,0.15); color: #ffffff;">${metaKey}</kbd><span style="font-size: 11px; color: rgba(255,255,255,0.5);">Hold</span></div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: rgba(255,255,255,0.85);">Pan / Move Selection Box</span>
            <div style="display: flex; align-items: center; gap: 6px;"><kbd style="background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 6px; font-family: monospace; font-size: 11.5px; border: 1px solid rgba(255,255,255,0.15); color: #ffffff;">Space</kbd><span style="font-size: 11px; color: rgba(255,255,255,0.5);">Hold</span></div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: rgba(255,255,255,0.85);">1:1 Square Aspect Ratio</span>
            <div style="display: flex; align-items: center; gap: 6px;"><kbd style="background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 6px; font-family: monospace; font-size: 11.5px; border: 1px solid rgba(255,255,255,0.15); color: #ffffff;">Shift</kbd><span style="font-size: 11px; color: rgba(255,255,255,0.5);">Hold</span></div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: rgba(255,255,255,0.85);">Eyedropper Color Picker</span>
            <kbd style="background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 6px; font-family: monospace; font-size: 11.5px; border: 1px solid rgba(255,255,255,0.15); color: #ffffff;">C</kbd>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: rgba(255,255,255,0.85);">Open Annotation Editor</span>
            <kbd style="background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 6px; font-family: monospace; font-size: 11.5px; border: 1px solid rgba(255,255,255,0.15); color: #ffffff;">A</kbd>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: rgba(255,255,255,0.85);">Dismiss / Cancel</span>
            <kbd style="background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 6px; font-family: monospace; font-size: 11.5px; border: 1px solid rgba(255,255,255,0.15); color: #ffffff;">Esc</kbd>
          </div>
        </div>
      </div>
    </div>
  `;

  host.appendChild(card);
  (document.body || document.documentElement).appendChild(host);
  shortcutsModalHost = host;

  requestAnimationFrame(() => {
    host.style.opacity = "1";
    card.style.transform = "translate3d(0, 0, 0) scale(1)";
  });

  const closeBtn = card.querySelector(".qs-modal-close");
  if (closeBtn) {
    closeBtn.onmouseenter = () => {
      closeBtn.style.color = "#ffffff";
      closeBtn.style.background = "rgba(255,255,255,0.15)";
    };
    closeBtn.onmouseleave = () => {
      closeBtn.style.color = "rgba(255,255,255,0.6)";
      closeBtn.style.background = "rgba(255,255,255,0.06)";
    };
  }

  function closeModal() {
    card.style.transform = "translate3d(0, -12px, 0) scale(0.94)";
    card.style.opacity = "0";
    host.style.opacity = "0";
    window.removeEventListener("keydown", onModalKey, true);
    setTimeout(() => {
      if (host.parentNode) host.parentNode.removeChild(host);
      if (shortcutsModalHost === host) shortcutsModalHost = null;
    }, 220);
  }

  function onModalKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
    }
  }

  window.addEventListener("keydown", onModalKey, true);
  if (closeBtn) closeBtn.onclick = closeModal;
  host.onclick = (e) => {
    if (e.target === host) closeModal();
  };
}

export function showColorPickerLoupe(x, y, hex) {
  const prev = document.getElementById("qs-color-loupe-root");
  if (prev) prev.remove();

  const host = document.createElement("div");
  host.id = "qs-color-loupe-root";
  host.style.cssText = `
    all: initial;
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    z-index: 2147483648;
    pointer-events: none;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    font-family: 'SS Selawik', 'Selawik', 'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif;
  `;

  host.innerHTML = `
    <style>
      @keyframes qsLoupeSpringIn {
        0% { transform: translate(-50%, -50%) scale(0.2); opacity: 0; }
        18% { transform: translate(-50%, -50%) scale(1.18); opacity: 1; }
        32% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        78% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(0.85); opacity: 0; }
      }
      @keyframes qsLoupeRipple {
        0% { transform: scale(0.85); opacity: 0.9; }
        100% { transform: scale(1.6); opacity: 0; }
      }
    </style>
    <div style="position: relative; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center;">
      <div style="position: absolute; inset: -6px; border-radius: 50%; border: 2px solid ${hex}; animation: qsLoupeRipple 1.2s ease-out infinite;"></div>
      <div style="width: 44px; height: 44px; border-radius: 50%; background: ${hex}; border: 3px solid #ffffff; box-shadow: 0 8px 24px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.25); display: flex; align-items: center; justify-content: center;">
        <div style="width: 4px; height: 4px; border-radius: 50%; background: #ffffff; box-shadow: 0 0 2px rgba(0,0,0,0.8);"></div>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px; background: rgba(22,22,28,0.88); border: 1px solid rgba(255,255,255,0.2); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: 0 8px 20px rgba(0,0,0,0.45); color: #ffffff; font-size: 11.5px; font-weight: 700; letter-spacing: 0.4px;">
      <span style="font-family: monospace; font-size: 12px;">${hex}</span>
      <span style="font-size: 10px; opacity: 0.8; font-weight: 600; color: #10B981;">Copied!</span>
    </div>
  `;

  host.style.animation = "qsLoupeSpringIn 1900ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards";
  (document.body || document.documentElement).appendChild(host);

  setTimeout(() => {
    if (host && host.parentNode) host.parentNode.removeChild(host);
  }, 1950);
}

export let settingsModalHost = null;

/**
 * Settings live on a dedicated full-tab page. The in-page entry points
 * (gear button, "," and "O" hotkeys, context menu) all land here.
 */
export async function showSettingsModal() {
  try {
    chrome.runtime.sendMessage({ type: "open-settings" }, () => void chrome.runtime.lastError);
  } catch {}
}

export function openGallery() {
  try {
    chrome.runtime.sendMessage({ type: "open-gallery" }, () => void chrome.runtime.lastError);
  } catch {}
}
