/**
 * Event handling for SwiftSelect
 */

import { captureAndCrop, handleCaptureVisible } from "./capture/region.js";
import {
  handleCaptureFullPage,
  handleCaptureHorizontal,
} from "./capture/fullpage.js";

export let dragging = false;
export let isMoving = false;
export let isSpacePressed = false;
export let isShiftPressed = false;
export let startX = 0;
export let startY = 0;
export let lastMouseX = 0;
export let lastMouseY = 0;
export let rect = { left: 0, top: 0, width: 0, height: 0 };
export let snapFrameId = null;
export let highlightedRect = null;
export let snapPointer = { x: 0, y: 0 };
export let initialized = false;

function clearSnapState({ clearSelection = true } = {}) {
  if (snapFrameId) {
    cancelAnimationFrame(snapFrameId);
    snapFrameId = null;
  }
  if (window.SwiftSelect.ui.highlighterEl)
    window.SwiftSelect.ui.highlighterEl.style.display = "none";
  if (window.SwiftSelect.ui.highlighterHost)
    window.SwiftSelect.ui.highlighterHost.style.display = "none";
  window.SwiftSelect.ui.snapBlurPanels?.forEach(
    (panel) => (panel.style.display = "none"),
  );
  highlightedRect = null;

  if (window.SwiftSelect.ui.overlay)
    window.SwiftSelect.ui.overlay.classList.remove("qs-snapping");

  if (clearSelection) {
    if (window.SwiftSelect.ui.box)
      window.SwiftSelect.ui.box.style.display = "none";
    if (window.SwiftSelect.ui.hudEl)
      window.SwiftSelect.ui.hudEl.style.display = "none";
    window.SwiftSelect.ui.curtains?.forEach((c) => (c.style.display = "none"));
  }
}

export function isEventOnUi(e) {
  if (!e) return false;
  const path = typeof e.composedPath === "function" ? e.composedPath() : [];
  for (const el of path) {
    if (!el) continue;
    if (
      el === window.SwiftSelect?.ui?.guideHost ||
      el === window.SwiftSelect?.ui?.statusHost ||
      el === window.SwiftSelect?.ui?.keyGuideHost ||
      el === window.SwiftSelect?.ui?.countdownHost ||
      el === window.SwiftSelect?.ui?.shortcutsModalHost ||
      el === window.SwiftSelect?.ui?.settingsModalHost
    ) {
      return true;
    }
    if (
      el.id === "qs-guide-host" ||
      el.id === "qs-status-host" ||
      el.id === "swiftselect-annotate-root" ||
      el.id === "qs-shortcuts-modal-root" ||
      el.id === "qs-settings-modal-root"
    ) {
      return true;
    }
    if (typeof el.className === "string") {
      if (
        el.className.includes("qs-guide") ||
        el.className.includes("qs-status") ||
        el.className.includes("qs-modal") ||
        el.className.includes("qs-tooltip") ||
        el.className.includes("qs-key") ||
        el.className.includes("qs-countdown") ||
        el.className.includes("qs-save-btn") ||
        el.className.includes("qs-theme-toggle") ||
        el.className.includes("qs-annotate")
      ) {
        return true;
      }
    } else if (el.classList) {
      if (
        el.classList.contains("qs-guide") ||
        el.classList.contains("qs-guide-btn") ||
        el.classList.contains("qs-guide-host") ||
        el.classList.contains("qs-status") ||
        el.classList.contains("qs-modal") ||
        el.classList.contains("qs-key-pill") ||
        el.classList.contains("qs-save-btn") ||
        el.classList.contains("qs-annotate-root")
      ) {
        return true;
      }
    }
  }
  return false;
}

function isExtensionUi(candidate) {
  if (!candidate) return false;
  return (
    candidate === window.SwiftSelect?.ui?.guideHost ||
    candidate === window.SwiftSelect?.ui?.statusHost ||
    candidate === window.SwiftSelect?.ui?.overlayHost ||
    candidate === window.SwiftSelect?.ui?.highlighterHost ||
    candidate === window.SwiftSelect?.ui?.keyGuideHost ||
    candidate === window.SwiftSelect?.ui?.countdownHost ||
    candidate === window.SwiftSelect?.ui?.flashHost ||
    candidate.id === "qs-guide-host" ||
    candidate.id === "qs-status-host" ||
    candidate.id === "swiftselect-annotate-root" ||
    candidate.closest?.(".qs-guide") ||
    candidate.closest?.(".qs-status") ||
    candidate.closest?.("#swiftselect-annotate-root") ||
    candidate.closest?.(".qs-annotate-root") ||
    candidate.closest?.("#qs-shortcuts-modal-root") ||
    candidate.closest?.("#qs-settings-modal-root") ||
    candidate.classList?.contains("qs-ovl") ||
    candidate.classList?.contains("qs-highlighter") ||
    candidate.classList?.contains("qs-flash") ||
    candidate.classList?.contains("qs-flash-host") ||
    candidate.dataset?.qsRole === "qs-flash" ||
    candidate.classList?.contains("qs-guide-host")
  );
}

function isSignificantSnapCandidate(el) {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (r.width < 36 || r.height < 36) return false;
  if (r.top < -1 || r.left < -1 || r.bottom > vh + 1 || r.right > vw + 1)
    return false;

  const tagName = el.tagName.toUpperCase();
  if (tagName === "BODY" || tagName === "HTML") return false;

  const isMedia = [
    "IMG",
    "VIDEO",
    "SVG",
    "CANVAS",
    "IFRAME",
    "EMBED",
    "OBJECT",
  ].includes(tagName);
  const isInteractive = ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(
    tagName,
  );

  if (!isMedia && (r.width > vw * 0.96 || r.height > vh * 0.96)) return false;

  const style = window.getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    Number(style.opacity) === 0
  )
    return false;

  if (isMedia || isInteractive) return true;

  const hasBgImage = style.backgroundImage !== "none";
  const hasBgColor =
    style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
    style.backgroundColor !== "transparent";
  const hasBorder =
    style.borderWidth !== "0px" &&
    style.borderStyle !== "none" &&
    style.borderColor !== "transparent";
  const hasBoxShadow = style.boxShadow !== "none";
  const text = el.innerText ? el.innerText.trim() : "";

  if (
    r.width > 300 &&
    r.height > 300 &&
    !hasBorder &&
    !hasBgImage &&
    !hasBoxShadow
  )
    return text.length >= 10;

  return (
    hasBgImage || hasBgColor || hasBorder || hasBoxShadow || text.length > 0
  );
}

function findSnapRect(x, y) {
  let elements = [];
  try {
    elements = document.elementsFromPoint(x, y);
  } catch (e) {
    console.warn("SwiftSelect: elementsFromPoint failed", e);
    return null;
  }

  for (const candidate of elements) {
    if (!isExtensionUi(candidate) && isSignificantSnapCandidate(candidate)) {
      return candidate.getBoundingClientRect();
    }
  }

  return null;
}

function rectContainsPoint(r, x, y) {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function isNearlySameRect(a, b) {
  return (
    Math.abs(a.left - b.left) < 2 &&
    Math.abs(a.top - b.top) < 2 &&
    Math.abs(a.width - b.width) < 2 &&
    Math.abs(a.height - b.height) < 2
  );
}

function stabilizeSnapRect(nextRect, x, y) {
  if (!highlightedRect || !nextRect) return nextRect;
  if (isNearlySameRect(highlightedRect, nextRect)) return highlightedRect;

  const currentArea = highlightedRect.width * highlightedRect.height;
  const nextArea = nextRect.width * nextRect.height;

  if (
    rectContainsPoint(highlightedRect, x, y) &&
    currentArea > nextArea * 1.7
  )
    return highlightedRect;

  return nextRect;
}

function updateSnapAt(x, y) {
  snapPointer = { x, y };

  if (snapFrameId) return;
  snapFrameId = requestAnimationFrame(() => {
    snapFrameId = null;
    const r = stabilizeSnapRect(
      findSnapRect(snapPointer.x, snapPointer.y),
      snapPointer.x,
      snapPointer.y,
    );

    if (r) {
      if (window.SwiftSelect.ui.overlay)
        window.SwiftSelect.ui.overlay.classList.add("qs-snapping");
      highlightedRect = r;
      window.SwiftSelect.ui.updateSelection(r);
      return;
    }

    clearSnapState();
  });
}

export function init() {
  if (initialized) return;
  initialized = true;
  // Listeners are added via addListeners
}

export function onPointerDown(e) {
  if (e.button !== 0) return;

  if (
    document.getElementById("swiftselect-annotate-root") ||
    document.getElementById("qs-shortcuts-modal-root") ||
    document.getElementById("qs-settings-modal-root")
  ) {
    return;
  }

  if (isEventOnUi(e)) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  window.SwiftSelect.ui.ensureUi();

  dragging = true;
  isMoving = false;
  startX = e.clientX;
  startY = e.clientY;
  lastMouseX = startX;
  lastMouseY = startY;
  rect.left = startX;
  rect.top = startY;
  rect.width = 0;
  rect.height = 0;

  window.SwiftSelect.ui.updateSelection(rect);
  window.SwiftSelect.ui.setSelecting(true);
}

export function onPointerMove(e) {
  if (
    document.getElementById("swiftselect-annotate-root") ||
    document.getElementById("qs-shortcuts-modal-root") ||
    document.getElementById("qs-settings-modal-root")
  ) {
    dragging = false;
    return;
  }

  if (!dragging && isEventOnUi(e)) {
    clearSnapState();
    return;
  }

  const x = e.clientX;
  const y = e.clientY;
  snapPointer = { x, y };

  if (dragging && isSpacePressed) {
    if (!isMoving) isMoving = true;
    const dx = x - lastMouseX;
    const dy = y - lastMouseY;

    rect.left += dx;
    rect.top += dy;
    startX += dx;
    startY += dy;

    lastMouseX = x;
    lastMouseY = y;

    window.SwiftSelect.ui.updateSelection(rect);
    return;
  } else {
    isMoving = false;
    lastMouseX = x;
    lastMouseY = y;
  }

  if (!dragging) {
    const isSnapping = e.ctrlKey || e.metaKey;
    if (!isSnapping) {
      clearSnapState();
      return;
    }

    updateSnapAt(x, y);
    return;
  }

  clearSnapState({ clearSelection: false });
  if (window.SwiftSelect.ui.box)
    window.SwiftSelect.ui.box.style.display = "block";

  let width, height;

  if (e.shiftKey) {
    const rawW = Math.abs(x - startX);
    const rawH = Math.abs(y - startY);
    const size = Math.max(rawW, rawH);
    width = size;
    height = size;
    rect.left = x < startX ? startX - size : startX;
    rect.top = y < startY ? startY - size : startY;
  } else {
    const left = Math.min(startX, x);
    const top = Math.min(startY, y);
    width = Math.abs(x - startX);
    height = Math.abs(y - startY);
    rect.left = left;
    rect.top = top;
  }

  rect.width = width;
  rect.height = height;
  window.SwiftSelect.ui.updateSelection(rect);
}

export function onPointerUp(e) {
  if (e.button !== 0) return;
  if (
    document.getElementById("swiftselect-annotate-root") ||
    document.getElementById("qs-shortcuts-modal-root") ||
    document.getElementById("qs-settings-modal-root")
  ) {
    dragging = false;
    return;
  }
  if (!dragging) return;

  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  dragging = false;
  window.SwiftSelect.ui.updateSelection(rect);
  window.SwiftSelect.ui.setSelecting(false);

  if (rect.width < 5 || rect.height < 5) {
    if (highlightedRect) {
      const snapRect = highlightedRect;
      cleanup();
      window.SwiftSelect.ui.cleanup(true, true);
      captureAndCrop(snapRect, true).catch((err) => {
        console.warn("captureAndCrop snap failed:", err);
        window.SwiftSelect.ui.setStatus("Capture failed", 3000, "error");
      });
      return;
    }

    // Force clear any pending artifacts before spawning a new status
    if (window.SwiftSelect.ui.statusHost) {
      if (window.SwiftSelect.ui.statusHost.parentNode) {
        window.SwiftSelect.ui.statusHost.parentNode.removeChild(
          window.SwiftSelect.ui.statusHost,
        );
      }
    }

    cleanup();
    window.SwiftSelect.ui.cleanup();
    window.SwiftSelect.ui.setStatus("Canceled", 1500);
    return;
  }

  const finalRect = { ...rect };
  cleanup();
  window.SwiftSelect.ui.cleanup(true, true);
  captureAndCrop(finalRect, false).catch((err) => {
    console.warn("captureAndCrop failed:", err);
    window.SwiftSelect.ui.setStatus("Capture failed", 3000, "error");
  });
}

export function onKeyDown(e) {
  if (e.key === "Escape") {
    e.preventDefault();
    window.SwiftSelect.ui.setStatus("Canceled", 900);
    cleanup();
    window.SwiftSelect.ui.cleanup();
    return;
  }
  if (e.code === "Space") {
    isSpacePressed = true;
    if (dragging) e.preventDefault();
  }
  if (e.key === "Shift") {
    isShiftPressed = true;
  }
  if (!dragging && (e.key === "Control" || e.key === "Meta")) {
    updateSnapAt(snapPointer.x, snapPointer.y);
  }

  // Update on-screen key guide highlight
  const guideKey = e.code === "Space" ? "space" : e.key;
  window.SwiftSelect?.ui?.updateKeyGuideKey?.(guideKey, true);

  // Quick in-session hotkeys (Standard 2-button: Alt+S, Alt+H, Alt+F, Alt+X or single keys)
  const activeEl = document.activeElement;
  const isInput =
    activeEl &&
    (activeEl.tagName === "INPUT" ||
      activeEl.tagName === "TEXTAREA" ||
      activeEl.isContentEditable);

  if (!dragging && !isInput) {
    const key = e.key.toLowerCase();
    const isAlt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    const isPlain = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;

    if ((isAlt && key === "s") || (isPlain && (key === "s" || key === "v"))) {
      e.preventDefault();
      handleCaptureVisible();
      return;
    }
    if ((isAlt && key === "t") || (isPlain && (key === "t" || key === "3"))) {
      e.preventDefault();
      import("./capture/region.js").then((m) => m.handleTimedCapture(3));
      return;
    }
    if (isPlain && key === "a") {
      e.preventDefault();
      import("./capture/annotate.js").then((m) => m.openAnnotationEditor());
      return;
    }
    if (isPlain && (key === "," || key === "o")) {
      e.preventDefault();
      window.SwiftSelect?.ui?.showSettingsModal?.();
      return;
    }
    if (isPlain && key === "c") {
      e.preventDefault();
      copyColorAtCursor();
      return;
    }
    if ((isAlt && key === "h") || (isPlain && key === "h")) {
      e.preventDefault();
      handleCaptureHorizontal();
      return;
    }
    if ((isAlt && key === "f") || (isPlain && key === "f")) {
      e.preventDefault();
      handleCaptureFullPage();
      return;
    }
    if (isAlt && key === "x") {
      e.preventDefault();
      cleanup();
      window.SwiftSelect.ui.cleanup();
      return;
    }
  }
}

export function onKeyUp(e) {
  if (e.code === "Space") {
    isSpacePressed = false;
    isMoving = false;
  }
  if (e.key === "Shift") {
    isShiftPressed = false;
  }
  if (e.key === "Control" || e.key === "Meta") {
    clearSnapState({ clearSelection: !dragging });
  }

  // Release on-screen key guide highlight
  const guideKey = e.code === "Space" ? "space" : e.key;
  window.SwiftSelect?.ui?.updateKeyGuideKey?.(guideKey, false);
}

async function copyColorAtCursor() {
  try {
    const x = lastMouseX || snapPointer.x;
    const y = lastMouseY || snapPointer.y;
    const dpr = window.devicePixelRatio || 1;

    let dataUrl = window.SwiftSelect?.ui?.getFreezeFrameDataUrl?.();
    if (!dataUrl) {
      dataUrl = await window.SwiftSelect?.ui?.getFreezeFramePromise?.();
    }
    if (!dataUrl) return;

    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = dataUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    const sx = Math.round(x * dpr);
    const sy = Math.round(y * dpr);
    ctx.drawImage(img, sx, sy, 1, 1, 0, 0, 1, 1);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    const r = pixel[0];
    const g = pixel[1];
    const b = pixel[2];
    const hex =
      "#" +
      ((1 << 24) + (r << 16) + (g << 8) + b)
        .toString(16)
        .slice(1)
        .toUpperCase();

    await navigator.clipboard.writeText(hex);
    window.SwiftSelect?.ui?.showColorPickerLoupe?.(x, y, hex);
    window.SwiftSelect?.ui?.setStatus?.(`Copied Color ${hex}`, 2500, "saved");
  } catch (err) {
    console.debug("copyColorAtCursor error:", err);
  }
}

export function preventAll(e) {
  if (isEventOnUi(e)) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}

export function onScroll(e) {
  if (
    window.SwiftSelect &&
    window.SwiftSelect.ui &&
    window.SwiftSelect.ui.releaseFreeze
  ) {
    window.SwiftSelect.ui.releaseFreeze();
  }
}

const boundPointerDown = onPointerDown;
const boundPointerMove = onPointerMove;
const boundPointerUp = onPointerUp;
const boundKeyDown = onKeyDown;
const boundKeyUp = onKeyUp;
const boundPreventAll = preventAll;
const boundScroll = onScroll;

let listenersActive = false;

export function addListeners() {
  if (listenersActive) {
    removeListeners();
  }
  listenersActive = true;
  init();
  document.addEventListener("pointerdown", boundPointerDown, true);
  document.addEventListener("pointermove", boundPointerMove, true);
  document.addEventListener("pointerup", boundPointerUp, true);
  document.addEventListener("keydown", boundKeyDown, true);
  window.addEventListener("keydown", boundKeyDown, true);
  document.addEventListener("keyup", boundKeyUp, true);
  window.addEventListener("keyup", boundKeyUp, true);

  document.addEventListener("click", boundPreventAll, true);
  document.addEventListener("dblclick", boundPreventAll, true);
  document.addEventListener("contextmenu", boundPreventAll, true);
  document.addEventListener("scroll", boundScroll, true);
  document.addEventListener("wheel", boundScroll, true);
  window.addEventListener("resize", boundScroll, true);
}

export function removeListeners() {
  listenersActive = false;
  document.removeEventListener("pointerdown", boundPointerDown, true);
  document.removeEventListener("pointermove", boundPointerMove, true);
  document.removeEventListener("pointerup", boundPointerUp, true);
  document.removeEventListener("keydown", boundKeyDown, true);
  window.removeEventListener("keydown", boundKeyDown, true);
  document.removeEventListener("keyup", boundKeyUp, true);
  window.removeEventListener("keyup", boundKeyUp, true);

  document.removeEventListener("click", boundPreventAll, true);
  document.removeEventListener("dblclick", boundPreventAll, true);
  document.removeEventListener("contextmenu", boundPreventAll, true);
  document.removeEventListener("scroll", boundScroll, true);
  document.removeEventListener("wheel", boundScroll, true);
  window.removeEventListener("resize", boundScroll, true);
}

export function cleanup() {
  dragging = false;
  isMoving = false;
  clearSnapState();
  window.SwiftSelect.ui.setSelecting(false);
  removeListeners();
}
