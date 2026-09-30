/**
 * UI management for SwiftSelect
 */

import {
  handleCaptureVisible,
  handleCaptureAndDownload,
} from "./capture/region.js";
import { handleCaptureFullPage } from "./capture/fullpage.js";
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
  if (freezeBg && freezeBg.style.opacity !== "0") {
    freezeBg.style.opacity = "0";
    freezeBg.style.pointerEvents = "none";
  }
  freezeFrameVersion++;
  freezeFrameDataUrl = null;
  freezeFramePromise = null;
}

// Track timers
export let hideStatusTimer = null;
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

export async function loadStyles() {
  if (stylePromise) return stylePromise;
  stylePromise = (async () => {
    try {
      const url = chrome.runtime.getURL("styles.css");
      const response = await fetch(url);
      const cssText = await response.text();
      qsSheet = new CSSStyleSheet();
      await qsSheet.replace(cssText);
    } catch (err) {
      console.error("SwiftSelect: Failed to load styles.css", err);
    }
  })();
  return stylePromise;
}

export function addSafetyListeners() {
  if (safetyListenersAdded) return;
  safetyListenersAdded = true;
  const cleanup = () => removeCrosshairCursor();
  window.addEventListener("beforeunload", cleanup);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") cleanup();
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
  host.style.display = "none"; // Start hidden to prevent flash
  document.body.appendChild(host);

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
  document.body.style.setProperty("cursor", "crosshair", "important");
  document.documentElement.style.setProperty(
    "cursor",
    "crosshair",
    "important",
  );
  if (!document.getElementById("qs-cursor-style")) {
    const style = document.createElement("style");
    style.id = "qs-cursor-style";
    style.textContent = "body *, html * { cursor: crosshair !important; }";
    document.head.appendChild(style);
  }
}

export function removeCrosshairCursor() {
  document.body.style.removeProperty("cursor");
  document.documentElement.style.removeProperty("cursor");
  const style = document.getElementById("qs-cursor-style");
  if (style) style.remove();
}

export async function ensureUi() {
  setCrosshairCursor();

  if (!overlayHost) {
    const frameVersion = ++freezeFrameVersion;
    freezeFrameDataUrl = null;
    freezeFramePromise = null;

    const { host, el, shadow } = makeShadowOverlay("div", "qs-ovl");
    overlayHost = host;
    overlay = el;
    overlayShadow = shadow;
    overlayHost.style.pointerEvents = "none";

    freezeBg = document.createElement("div");
    freezeBg.className = "qs-freeze-bg";
    freezeBg.style.position = "absolute";
    freezeBg.style.inset = "0";
    freezeBg.style.zIndex = "1";
    freezeBg.style.backgroundSize = `${window.innerWidth}px ${window.innerHeight}px`;
    freezeBg.style.backgroundPosition = "top left";
    freezeBg.style.backgroundRepeat = "no-repeat";
    freezeBg.style.pointerEvents = "none";
    freezeBg.style.opacity = "0";
    freezeBg.style.transition = "opacity 0.15s ease-out";
    overlay.appendChild(freezeBg);

    // clear any lingering artifacts entirely before snapshotting
    if (statusHost) {
      if (hideStatusTimer) clearTimeout(hideStatusTimer);
      if (statusHost.parentNode) statusHost.parentNode.removeChild(statusHost);
      statusHost = null;
      statusEl = null;
      currentStatus = null;
    }

    // Yield main thread twice to aggressively force the browser to visually
    // repaint the DOM, confirming the toast deletion is physically rendered
    // before the background camera snatches the freezeBg snapshot.
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));

    freezeFramePromise = new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "capture-visible-tab" }, (resp) => {
        if (resp && resp.success && frameVersion === freezeFrameVersion) {
          freezeFrameDataUrl = resp.dataUrl;
          if (freezeBg) {
            freezeBg.style.backgroundImage = `url(${resp.dataUrl})`;
            freezeBg.style.opacity = "1";
          }
          setTabScreenshot(resp.dataUrl);
          resolve(resp.dataUrl);
          return;
        }

        resolve(null);
      });
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

  if (!statusHost) {
    const { host, el } = makeShadowOverlay("div", "qs-status", "", false);
    statusHost = host;
    statusEl = el;
    statusHost.style.display = "none";
  }

  if (!highlighterHost) {
    const { host, el } = makeShadowOverlay("div", "qs-highlighter", "", false);
    highlighterHost = host;
    highlighterEl = el;
    highlighterHost.style.display = "none";
  }

  if (hudEl) {
    applyElementTheme(hudEl, currentUserTheme);
  }

  if (!guideHost) {
    const { host, el, shadow } = makeShadowOverlay("div", "qs-guide");
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
    visibleBtn.dataset.tooltip = "Copy Visible";

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

    // Download
    const downloadBtn = document.createElement("button");
    downloadBtn.className = "qs-guide-btn";
    downloadBtn.dataset.action = "capture-download";
    downloadBtn.dataset.tooltip = "Save & Copy";
    const dlSvg = createSvg("0 0 24 24", [
      { class: "dl-arrow", d: "M19 9h-4V3H9v6H5l7 7 7-7z" },
      { class: "dl-bar", d: "M5 18v2h14v-2H5z" },
    ]);
    downloadBtn.appendChild(dlSvg);
    segmented.appendChild(downloadBtn);

    // Full Page
    const fullBtn = document.createElement("button");
    fullBtn.className = "qs-guide-btn";
    fullBtn.dataset.action = "capture-full";
    fullBtn.dataset.tooltip = "Save Full Page";
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

    // Theme Toggle
    const themeBtn = document.createElement("button");
    themeBtn.className = "qs-guide-btn qs-theme-toggle";
    themeBtn.dataset.action = "toggle-theme";
    themeBtn.dataset.tooltip = "Toggle Theme";
    const moonSvg = createSvg(
      "0 0 24 24",
      {
        d: "M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-5.4-5.4 5.4 5.4 0 0 1 1.76-3.79A8.93 8.93 0 0 0 12 3Z",
      },
      "qs-icon-moon",
    );
    const sunSvg = createSvg(
      "-2 -2 24 24",
      {
        d: "M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-15a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0V1a1 1 0 0 1 1-1zm0 16a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1zM1 9h2a1 1 0 1 1 0 2H1a1 1 0 0 1 0-2zm16 0h2a1 1 0 0 1 0 2h-2a1 1 0 0 1 0-2zm.071-6.071a1 1 0 0 1 0 1.414l-1.414 1.414a1 1 0 1 1-1.414-1.414l1.414-1.414a1 1 0 0 1 1.414 0zM5.757 14.243a1 1 0 0 1 0 1.414L4.343 17.07a1 1 0 1 1-1.414-1.414l1.414-1.414a1 1 0 0 1 1.414 0zM4.343 2.929l1.414 1.414a1 1 0 0 1-1.414 1.414L2.93 4.343A1 1 0 0 1 4.343 2.93zm11.314 11.314l1.414 1.414a1 1 0 0 1-1.414 1.414l-1.414-1.414a1 1 0 1 1 1.414-1.414z",
      },
      "qs-icon-sun",
    );
    themeBtn.appendChild(moonSvg);
    themeBtn.appendChild(sunSvg);
    buttonsSet.appendChild(themeBtn);

    // Listeners
    visibleBtn.onclick = () => handleCaptureVisible();
    downloadBtn.onclick = () => handleCaptureAndDownload();
    fullBtn.onclick = () => handleCaptureFullPage();
    themeBtn.onclick = () => handleThemeToggle();
  }

  if (guideHost) {
    guideHost.style.display = "flex";
    guideEl.classList.remove("qs-hiding");
    void guideEl.offsetWidth;
    applyElementTheme(guideEl, currentUserTheme);
  }
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

export function setStatus(msg, timeout = 1500, type = "info", noAnim = false) {
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
    timeout = 2500;
  } else if (type === "error") {
    statusEl.classList.add("qs-error");
    timeout = 2500;
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
    const hudText = `${w} x ${h}`;
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
  if (guideHost) guideHost.style.display = "none";
  if (overlayHost) overlayHost.style.display = "none";
  if (highlighterHost) highlighterHost.style.display = "none";

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

export function cleanup() {
  removeCrosshairCursor();
  if (updateFrameId) {
    cancelAnimationFrame(updateFrameId);
    updateFrameId = null;
  }
  isUpdating = false;
  pendingRect = null;
  addSafetyListeners();

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

  if (guideEl && guideHost) {
    guideEl.classList.add("qs-hiding");
    setTimeout(() => {
      if (guideHost && guideHost.parentNode)
        guideHost.parentNode.removeChild(guideHost);
      guideHost = null;
      guideEl = null;
      guideShadow = null;
    }, 200);
  } else {
    if (guideHost && guideHost.parentNode)
      guideHost.parentNode.removeChild(guideHost);
    guideHost = null;
    guideEl = null;
  }

  // Forcefully remove statusHost immediately on cleanup to avoid freeze ghosting
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

export function updateBadge(text, color = "#ff6a61") {
  chrome.runtime.sendMessage({ type: "update-badge", text, color });
}
