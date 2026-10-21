/**
 * UI management for SwiftSelect
 */

import {
  handleCaptureVisible,
  handleCaptureAndDownload,
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
export let cachedCssText = "";

export async function loadStyles() {
  if (stylePromise) return stylePromise;
  stylePromise = (async () => {
    try {
      const url = chrome.runtime.getURL("styles.css");
      const response = await fetch(url);
      cachedCssText = await response.text();
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
  const targetParent = document.body || document.documentElement;
  if (targetParent) {
    targetParent.appendChild(host);
  }

  const shadow = host.attachShadow({ mode: "open" });
  const el = document.createElement(tag);
  el.className = className;
  if (innerHTML) el.innerHTML = innerHTML;
  el.style.opacity = "0"; // Second layer of flash protection
  shadow.appendChild(el);

  (async () => {
    await loadStyles();
    if (qsSheet) {
      shadow.adoptedStyleSheets = [qsSheet];
    }
    // Restore layout only if autoShow is requested
    if (autoShow) {
      host.style.display = "block";
    }
    // Allow CSS to take over
    setTimeout(() => {
      if (el) el.style.opacity = "";
    }, 0);
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

export async function ensureUi() {
  if (document.getElementById("swiftselect-annotate-root")) {
    return;
  }
  setCrosshairCursor();

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
      const timer = setTimeout(() => resolve(null), 1500);
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

    const surface = document.createElement("div");
    surface.className = "qs-glass-surface";
    guideEl.appendChild(surface);

    const buttonsSet = document.createElement("div");
    buttonsSet.className = "qs-guide-buttons";
    guideEl.appendChild(buttonsSet);

    const segmented = document.createElement("div");
    segmented.className = "qs-segmented";
    buttonsSet.appendChild(segmented);

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
    segmented.appendChild(visibleBtn);

    // Horizontal Wide View
    const horizontalBtn = document.createElement("button");
    horizontalBtn.className = "qs-guide-btn";
    horizontalBtn.dataset.action = "capture-horizontal";
    horizontalBtn.dataset.tooltip = "Save Horizontal View (H)";
    const hzSvg = createSvg("0 0 24 24", [
      {
        class: "hz-screen",
        d: "M2 6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6zm2 0v12h16V6H4z",
      },
      {
        class: "hz-arrows",
        d: "M7 12l2.5-2.5v1.5h5V9.5l2.5 2.5-2.5 2.5v-1.5h-5v1.5L7 12z",
      },
    ]);
    horizontalBtn.appendChild(hzSvg);
    segmented.appendChild(horizontalBtn);

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
    const fpSpan = document.createElement("span");
    fpSpan.textContent = "Full Page";
    fullBtn.appendChild(fpSvg);
    fullBtn.appendChild(fpSpan);
    buttonsSet.appendChild(fullBtn);

    // Annotate Button
    const annotateBtn = document.createElement("button");
    annotateBtn.className = "qs-guide-btn";
    annotateBtn.dataset.action = "annotate";
    annotateBtn.dataset.tooltip = "Annotate (A)";
    const annSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    annSvg.setAttribute("viewBox", "0 0 24 24");
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
    horizontalBtn.onclick = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      handleCaptureHorizontal();
    };
    fullBtn.onclick = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      handleCaptureFullPage();
    };
    annotateBtn.onclick = async (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      window.SwiftSelect?.events?.cleanup?.();
      hideGuide(true);
      const { openAnnotationEditor } = await import("./capture/annotate.js");
      openAnnotationEditor();
    };

    const isMac =
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPod|iPad/.test(navigator.platform || navigator.userAgent);
    const keyS = isMac ? "Ctrl+S" : "Alt+S";
    const keyH = isMac ? "Ctrl+H" : "Alt+H";
    const keyF = isMac ? "Ctrl+F" : "Alt+F";
    const keyA = isMac ? "Ctrl+A" : "Alt+A";

    attachTooltip(
      visibleBtn,
      "Visible Area",
      "Saves and copies what is currently displayed on your screen.",
      keyS,
    );
    attachTooltip(
      horizontalBtn,
      "Horizontal View",
      "Captures the full horizontal scrollable width at your current view.",
      keyH,
    );
    attachTooltip(
      fullBtn,
      "Full Page",
      "Scrolls and stitches the entire webpage into one complete high-resolution image.",
      keyF,
    );
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
    guideHost.style.display = "flex";
    guideEl.classList.remove("qs-hiding");
    void guideEl.offsetWidth;
    applyElementTheme(guideEl, currentUserTheme);
  }
}

export let menuTooltipEl = null;
let tooltipTimer = null;

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

export function showCustomTooltip(btn, title, desc, key) {
  if (!guideShadow || !btn) return;
  if (!menuTooltipEl) {
    menuTooltipEl = document.createElement("div");
    menuTooltipEl.className = "qs-custom-tooltip";
    guideShadow.appendChild(menuTooltipEl);
  }

  menuTooltipEl.innerHTML = `
    <div class="qs-tooltip-header">
      <span class="qs-tooltip-title">${title}</span>
      ${key ? `<span class="qs-tooltip-key">${key}</span>` : ""}
    </div>
    <div class="qs-tooltip-desc">${desc}</div>
  `;

  applyElementTheme(menuTooltipEl, currentUserTheme);
  menuTooltipEl.style.display = "flex";

  const btnRect = btn.getBoundingClientRect();
  const actualRect = menuTooltipEl.getBoundingClientRect();
  const tipWidth = actualRect.width || 250;

  let left = btnRect.left + btnRect.width / 2;
  const top = btnRect.bottom + 12;

  const minLeft = tipWidth / 2 + 16;
  const maxLeft = window.innerWidth - tipWidth / 2 - 16;
  left = Math.max(minLeft, Math.min(maxLeft, left));

  menuTooltipEl.style.left = `${Math.round(left)}px`;
  menuTooltipEl.style.top = `${Math.round(top)}px`;

  requestAnimationFrame(() => {
    if (menuTooltipEl) menuTooltipEl.classList.add("qs-tooltip-visible");
  });
}

function attachTooltip(btn, title, desc, key) {
  btn.addEventListener("pointerenter", () => {
    hideCustomTooltip();
    tooltipTimer = setTimeout(() => {
      showCustomTooltip(btn, title, desc, key);
    }, 1600);
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
    pill.addEventListener("click", async (e) => {
      e.stopPropagation();
      const k = pill.dataset.key;
      if (k === "t") {
        const { handleTimedCapture } = await import("./capture/region.js");
        handleTimedCapture(3);
      } else if (k === "a") {
        const { openAnnotationEditor } = await import("./capture/annotate.js");
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

  const isUpdating = statusEl && statusHost && statusHost.style.display !== "none" && !statusEl.classList.contains("qs-hiding");
  let oldWidth = 0;
  if (isUpdating) {
    oldWidth = statusEl.getBoundingClientRect().width;
  }

  statusEl.className = "qs-status";
  statusEl.classList.remove("qs-hiding");
  if (noAnim) statusEl.classList.add("no-anim");

  while (statusEl.firstChild) statusEl.removeChild(statusEl.firstChild);
  const iconEl = document.createElement("div");
  iconEl.className = "qs-status-icon";

  let iconSvg = null;
  let hasCustomStroke = false;
  if (type === "info" || (!type && !msg.includes("Copied"))) {
    iconSvg = createSvg("0 0 24 24", {
      d: "M21.17,15.4l-5.91-9.85C14.48,4.25,13.3,3.51,12,3.51S9.52,4.25,8.74,5.54L2.83,15.4c-0.44,0.73-0.66,1.49-0.66,2.21c0,0.57,0.14,1.13,0.42,1.62C3.23,20.35,4.47,21,6,21h12c1.53,0,2.77-0.65,3.41-1.77c0.28-0.49,0.42-1.02,0.42-1.58C21.84,16.91,21.62,16.14,21.17,15.4z M12,8.45c0.85,0,1.55,0.7,1.55,1.55c0,0.85-0.69,1.55-1.55,1.55c-0.85,0-1.55-0.7-1.55-1.55C10.45,9.14,11.14,8.45,12,8.45z M13.69,16.91c-0.03,0.04-0.8,0.92-2.07,0.92l-0.15,0c-0.51-0.03-0.93-0.25-1.18-0.63c-0.31-0.47-0.36-1.11-0.12-1.82l0.41-1.22c0.23-0.68,0.01-0.79-0.11-0.85l-0.14-0.02c-0.25,0-0.6,0.15-0.71,0.21c-0.1,0.05-0.23,0.03-0.31-0.07c-0.07-0.1-0.07-0.23,0.01-0.32c0.03-0.04,0.87-0.99,2.22-0.91c0.51,0.03,0.93,0.25,1.18,0.63c0.32,0.47,0.36,1.11,0.12,1.83l-0.41,1.22c-0.23,0.68-0.01-0.79,0.11,0.85l0.14,0.02c0.25,0,0.6-0.15,0.71-0.2c0.11-0.06,0.23-0.03,0.31,0.07C13.77,16.69,13.77,16.82,13.69,16.91z",
    });
  }

  if (type === "error") {
    iconSvg = createSvg("0 0 51.976 51.976", {
      d: "M44.373,7.603c-10.137-10.137-26.632-10.138-36.77,0c-10.138,10.138-10.137,26.632,0,36.77s26.632,10.138,36.77,0C54.51,34.235,54.51,17.74,44.373,7.603z M36.241,36.241c-0.781,0.781-2.047,0.781-2.828,0l-7.425-7.425l-7.778,7.778c-0.781,0.781-2.047,0.781-2.828,0c-0.781-0.781-0.781-2.047,0-2.828l7.778-7.778l-7.425-7.425c-0.781-0.781-0.781-2.048,0-2.828c0.781-0.781,2.047-0.781,2.828,0l7.425,7.425l7.071-7.071c0.781-0.781,2.047-0.781,2.828,0c0.781,0.781,0.781,2.047,0,2.828l-7.071,7.071l7.425,7.425C37.022,34.194,37.022,35.46,36.241,36.241z",
    });
  } else if (type === "success" || type === "saved") {
    iconSvg = createSvg("0 0 16 16", {
      d: "m1.75 9.75 2.5 2.5m3.5-4 2.5-2.5m-4.5 4 2.5 2.5 6-6.5",
    });
    iconSvg.setAttribute("fill", "none");
    iconSvg.setAttribute("stroke", "var(--qs-icon-fill)");
    iconSvg.setAttribute("stroke-linecap", "round");
    iconSvg.setAttribute("stroke-linejoin", "round");
    iconSvg.setAttribute("stroke-width", "1.5");
    hasCustomStroke = true;
  }

  if (iconSvg) {
    if (hasCustomStroke) {
      iconSvg.style.width = "28px";
      iconSvg.style.height = "28px";
      iconSvg.style.paddingBottom = "2px";
    } else {
      iconSvg.style.width = "100%";
      iconSvg.style.height = "100%";
      if (iconSvg.getAttribute("stroke") && !iconSvg.getAttribute("fill")) {
        iconSvg.style.fill = "none";
        iconSvg.style.stroke = "currentColor";
      } else {
        iconSvg.style.fill = "currentColor";
      }
    }
    iconEl.appendChild(iconSvg);
  }

  statusEl.appendChild(iconEl);
  const textSpan = document.createElement("span");
  textSpan.textContent = msg;
  statusEl.appendChild(textSpan);

  if (type === "success") {
    statusEl.classList.add("qs-success");
    const saveBtn = document.createElement("button");
    saveBtn.className = "qs-save-btn";
    saveBtn.title = "Save Screenshot";
    saveBtn.style.marginLeft = "8px";
    const dlIcon = createSvg("0 0 24 24", [
      { class: "dl-arrow", d: "M19 9h-4V3H9v6H5l7 7 7-7z" },
      { class: "dl-bar", d: "M5 18v2h14v-2H5z" },
    ]);
    saveBtn.appendChild(dlIcon);
    dlIcon.style.width = "20px";
    dlIcon.style.height = "20px";
    dlIcon.style.fill = "currentColor";

    saveBtn.onclick = async () => {
      const { handleSaveAction } = await import("./capture/download.js");
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

  if ((type === "success" || type === "saved") && !isAnnotateActive) {
    const annotateBtn = document.createElement("button");
    annotateBtn.className = "qs-save-btn qs-status-annotate-btn";
    annotateBtn.title = "Annotate Screenshot (A)";
    annotateBtn.style.marginLeft = "6px";
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

    annotateBtn.onclick = async () => {
      const { openAnnotationEditor } = await import("./capture/annotate.js");
      const { getLastBlob } = await import("./capture/download.js");
      const source = options?.sourceBlob || getLastBlob?.();
      if (source) {
        openAnnotationEditor(source);
      } else {
        openAnnotationEditor();
      }
    };
    statusEl.appendChild(annotateBtn);
  }


  statusHost.style.display = "";
  statusEl.style.display = "flex";
  currentStatus = type;
  void statusEl.offsetWidth;
  applyElementTheme(statusEl, currentUserTheme);

  if (isUpdating) {
    statusEl.getAnimations().forEach(anim => { if (!anim.animationName) anim.cancel(); });
    const newWidth = statusEl.getBoundingClientRect().width;
    statusEl.animate([
      { width: `${oldWidth}px` },
      { width: `${newWidth}px` }
    ], {
      duration: 350,
      easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    });

    const textSpan = statusEl.querySelector('span');
    if (textSpan) {
      textSpan.animate([
        { opacity: 0, transform: "translateY(6px) scale(0.6)" },
        { opacity: 1, transform: "translateY(0) scale(1)" }
      ], {
        duration: 350,
        easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      });
    }

    const icon = statusEl.querySelector('.qs-status-icon');
    if (icon) {
      icon.animate([
        { opacity: 0, transform: "translateY(6px) scale(0.6)" },
        { opacity: 1, transform: "translateY(0) scale(1)" }
      ], {
        duration: 350,
        easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      });
    }
  }

  if (timeout > 0) {
    hideStatusTimer = setTimeout(() => {
      statusEl.classList.add("qs-hiding");
      setTimeout(() => {
        if (statusEl.classList.contains("qs-hiding")) {
          statusEl.style.display = "none";
          statusHost.style.display = "none";
          statusEl.classList.remove("qs-hiding");
          currentStatus = null;
        }
      }, 200);
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
      box.style.display = "none";
      hudEl.style.display = "none";
      curtains.forEach((c) => (c.style.display = "none"));
      snapBlurPanels.forEach((panel) => (panel.style.display = "none"));
      return;
    }

    const x1 = r.left;
    const y1 = r.top;
    const x2 = r.left + r.width;
    const y2 = r.top + r.height;

    const isVisible = r.width > 2 || r.height > 2;
    if (!isVisible) {
      box.style.display = "none";
      hudEl.style.display = "none";
      curtains.forEach((c) => (c.style.display = "none"));
      snapBlurPanels.forEach((panel) => (panel.style.display = "none"));
      return;
    }

    box.style.display = "block";
    box.style.width = r.width + "px";
    box.style.height = r.height + "px";
    box.style.transform = `translate3d(${x1}px, ${y1}px, 0)`;

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
      hudText += " • 1:1";
    }
    if (window.SwiftSelect?.events?.isSpacePressed) {
      hudText += " • Move";
    }
    if (lastHudText !== hudText) {
      hudEl.textContent = hudText;
      lastHudText = hudText;
    }
    hudEl.style.display = "block";
    // Restore animation for fresh appearances (e.g. new drag)
    hudEl.style.animation = "";
    hudEl.style.transform = `translate3d(${hudLeft}px, ${hudTop}px, 0)`;

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

export function triggerFlash(targetRect = null) {
  const { host, el } = makeShadowOverlay("div", "qs-flash");
  if (!isPageDark()) el.classList.add("qs-flash-inverse");

  if (targetRect) {
    el.style.left = targetRect.left + "px";
    el.style.top = targetRect.top + "px";
    el.style.width = targetRect.width + "px";
    el.style.height = targetRect.height + "px";
    el.style.position = "absolute";
    el.style.borderRadius = "6px";
  } else {
    el.style.inset = "0";
    el.style.borderRadius = "0";
  }

  setTimeout(() => {
    if (host && host.parentNode) host.parentNode.removeChild(host);
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
  hideCustomTooltip();
  hideKeyGuide();
  if (guideHost) guideHost.style.display = "none";
  if (overlayHost) overlayHost.style.display = "none";
  if (highlighterHost) highlighterHost.style.display = "none";
  if (countdownHost) countdownHost.style.display = "none";

  if (statusHost && statusHost.style.display !== "none") {
    if (hideStatusTimer) clearTimeout(hideStatusTimer);
    statusEl.classList.add("qs-hiding");
    statusEl.style.display = "none";
    statusHost.style.display = "none";
    statusEl.classList.remove("qs-hiding");
    currentStatus = null;
  }

  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => setTimeout(r, 100));
}

export function cleanup(preserveStatus = false) {
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
  freezeFrameVersion++;
  freezeFrameDataUrl = null;
  freezeFramePromise = null;
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
    font-family: 'Google Sans', 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #f4f4f5;
    opacity: 0;
    transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1);
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
    transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease;
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
  document.body.appendChild(host);
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
    font-family: 'Google Sans', 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
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
  document.body.appendChild(host);

  setTimeout(() => {
    if (host && host.parentNode) host.parentNode.removeChild(host);
  }, 1950);
}

export let settingsModalHost = null;

export async function showSettingsModal() {
  if (settingsModalHost) {
    settingsModalHost.remove();
    settingsModalHost = null;
  }

  const { outputFormat = "jpg", outputDestination = "both", userTheme = "glass" } =
    await new Promise((res) => {
      chrome.storage.local.get(
        ["outputFormat", "outputDestination", "userTheme"],
        res,
      );
    });

  const host = document.createElement("div");
  host.id = "qs-settings-modal-root";
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
    font-family: 'Google Sans', 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
    color: #f4f4f5;
    opacity: 0;
    transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  const card = document.createElement("div");
  card.style.cssText = `
    width: 440px;
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
    backdrop-filter: blur(16px) saturate(160%);
    -webkit-backdrop-filter: blur(16px) saturate(160%);
    padding: 24px 26px;
    box-sizing: border-box;
    transform: translate3d(0, 16px, 0) scale(0.92);
    transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease;
  `;

  card.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid rgba(255,255,255,0.14);">
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="width: 36px; height: 36px; border-radius: 12px; background: #BA4B5C; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px rgba(186,75,92,0.45);">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </div>
        <div>
          <div style="font-size: 16px; font-weight: 700; color: #ffffff; letter-spacing: -0.2px;">SwiftSelect Settings</div>
          <div style="font-size: 12px; color: rgba(255,255,255,0.65);">Capture format, destination & appearance</div>
        </div>
      </div>
      <button class="qs-modal-close" style="all: initial; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; color: rgba(255,255,255,0.7); background: color-mix(in srgb, var(--c-glass, #bbbbbc) 28%, transparent); transition: all 0.15s ease;" title="Close (Esc)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>

    <div style="display: flex; flex-direction: column; gap: 18px;">
      <!-- Export Format -->
      <div>
        <div style="font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.85); margin-bottom: 8px;">Export Format</div>
        <div class="qs-settings-segmented" data-key="outputFormat" style="display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(0,0,0,0.38); border: 1px solid rgba(255,255,255,0.08);">
          <button data-val="jpg" style="all: initial; flex: 1; text-align: center; font-size: 12px; font-weight: ${outputFormat === "jpg" ? "700" : "600"}; padding: 7px 12px; border-radius: 999px; cursor: pointer; font-family: inherit; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); ${outputFormat === "jpg" ? "background: #ffffff; color: #18181b; box-shadow: 0 3px 10px rgba(0,0,0,0.3);" : "color: rgba(255,255,255,0.75);"}">JPG (Small)</button>
          <button data-val="png" style="all: initial; flex: 1; text-align: center; font-size: 12px; font-weight: ${outputFormat === "png" ? "700" : "600"}; padding: 7px 12px; border-radius: 999px; cursor: pointer; font-family: inherit; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); ${outputFormat === "png" ? "background: #ffffff; color: #18181b; box-shadow: 0 3px 10px rgba(0,0,0,0.3);" : "color: rgba(255,255,255,0.75);"}">PNG (Lossless)</button>
        </div>
      </div>

      <!-- Destination -->
      <div>
        <div style="font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.85); margin-bottom: 8px;">Capture Destination</div>
        <div class="qs-settings-segmented" data-key="outputDestination" style="display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(0,0,0,0.38); border: 1px solid rgba(255,255,255,0.08);">
          <button data-val="both" style="all: initial; flex: 1; text-align: center; font-size: 12px; font-weight: ${outputDestination === "both" ? "700" : "600"}; padding: 7px 10px; border-radius: 999px; cursor: pointer; font-family: inherit; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); ${outputDestination === "both" ? "background: #ffffff; color: #18181b; box-shadow: 0 3px 10px rgba(0,0,0,0.3);" : "color: rgba(255,255,255,0.75);"}">Both</button>
          <button data-val="clipboard" style="all: initial; flex: 1; text-align: center; font-size: 12px; font-weight: ${outputDestination === "clipboard" ? "700" : "600"}; padding: 7px 10px; border-radius: 999px; cursor: pointer; font-family: inherit; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); ${outputDestination === "clipboard" ? "background: #ffffff; color: #18181b; box-shadow: 0 3px 10px rgba(0,0,0,0.3);" : "color: rgba(255,255,255,0.75);"}">Copy Only</button>
          <button data-val="download" style="all: initial; flex: 1; text-align: center; font-size: 12px; font-weight: ${outputDestination === "download" ? "700" : "600"}; padding: 7px 10px; border-radius: 999px; cursor: pointer; font-family: inherit; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); ${outputDestination === "download" ? "background: #ffffff; color: #18181b; box-shadow: 0 3px 10px rgba(0,0,0,0.3);" : "color: rgba(255,255,255,0.75);"}">Save Only</button>
        </div>
      </div>

      <!-- Theme -->
      <div>
        <div style="font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.85); margin-bottom: 8px;">Appearance Theme</div>
        <div class="qs-settings-segmented" data-key="userTheme" style="display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: rgba(0,0,0,0.38); border: 1px solid rgba(255,255,255,0.08);">
          <button data-val="glass" style="all: initial; flex: 1; text-align: center; font-size: 11.5px; font-weight: ${userTheme === "glass" ? "700" : "600"}; padding: 7px 8px; border-radius: 999px; cursor: pointer; font-family: inherit; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); ${userTheme === "glass" ? "background: #ffffff; color: #18181b; box-shadow: 0 3px 10px rgba(0,0,0,0.3);" : "color: rgba(255,255,255,0.75);"}">Liquid Glass</button>
          <button data-val="standard" style="all: initial; flex: 1; text-align: center; font-size: 11.5px; font-weight: ${userTheme === "standard" ? "700" : "600"}; padding: 7px 8px; border-radius: 999px; cursor: pointer; font-family: inherit; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); ${userTheme === "standard" ? "background: #ffffff; color: #18181b; box-shadow: 0 3px 10px rgba(0,0,0,0.3);" : "color: rgba(255,255,255,0.75);"}">Standard</button>
          <button data-val="dark" style="all: initial; flex: 1; text-align: center; font-size: 11.5px; font-weight: ${userTheme === "dark" ? "700" : "600"}; padding: 7px 8px; border-radius: 999px; cursor: pointer; font-family: inherit; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); ${userTheme === "dark" ? "background: #ffffff; color: #18181b; box-shadow: 0 3px 10px rgba(0,0,0,0.3);" : "color: rgba(255,255,255,0.75);"}">Dark</button>
          <button data-val="light" style="all: initial; flex: 1; text-align: center; font-size: 11.5px; font-weight: ${userTheme === "light" ? "700" : "600"}; padding: 7px 8px; border-radius: 999px; cursor: pointer; font-family: inherit; transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1); ${userTheme === "light" ? "background: #ffffff; color: #18181b; box-shadow: 0 3px 10px rgba(0,0,0,0.3);" : "color: rgba(255,255,255,0.75);"}">Light</button>
        </div>
      </div>
    </div>
  `;

  card.querySelectorAll(".qs-settings-segmented").forEach((group) => {
    const key = group.dataset.key;
    group.querySelectorAll("button").forEach((btn) => {
      btn.onclick = () => {
        const val = btn.dataset.val;
        group.querySelectorAll("button").forEach((b) => {
          const act = b === btn;
          b.style.background = act ? "#ffffff" : "transparent";
          b.style.color = act ? "#18181b" : "rgba(255,255,255,0.75)";
          b.style.boxShadow = act ? "0 3px 10px rgba(0,0,0,0.3)" : "none";
          b.style.fontWeight = act ? "700" : "600";
        });
        chrome.storage.local.set({ [key]: val });
        if (key === "userTheme") {
          const themeModule = window.SwiftSelect?.theme;
          if (themeModule?.applyTheme) {
            themeModule.applyTheme(val);
          }
        }
      };
    });
  });

  host.appendChild(card);
  document.body.appendChild(host);
  settingsModalHost = host;

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
    window.removeEventListener("keydown", onSettingsModalKey, true);
    setTimeout(() => {
      if (host.parentNode) host.parentNode.removeChild(host);
      if (settingsModalHost === host) settingsModalHost = null;
    }, 220);
  }

  function onSettingsModalKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
    }
  }

  window.addEventListener("keydown", onSettingsModalKey, true);
  if (closeBtn) closeBtn.onclick = closeModal;
  host.onclick = (e) => {
    if (e.target === host) closeModal();
  };
}
