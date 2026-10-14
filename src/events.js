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

function isExtensionUi(candidate) {
  return (
    candidate === window.SwiftSelect.ui.guideHost ||
    candidate === window.SwiftSelect.ui.statusHost ||
    candidate === window.SwiftSelect.ui.overlayHost ||
    candidate === window.SwiftSelect.ui.highlighterHost ||
    candidate.closest?.(".qs-guide") ||
    candidate.closest?.(".qs-status") ||
    candidate.classList?.contains("qs-ovl") ||
    candidate.classList?.contains("qs-highlighter")
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

  const path = e.composedPath();
  const isOnGuide = path.some(
    (el) =>
      el === window.SwiftSelect.ui.guideHost ||
      (el.classList && el.classList.contains("qs-guide-btn")),
  );

  if (isOnGuide) return;

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
      captureAndCrop(snapRect).finally(() => {
        cleanup();
        window.SwiftSelect.ui.cleanup();
        window.SwiftSelect.ui.triggerFlash(snapRect);
        window.SwiftSelect.ui.setStatus("Copied to clipboard", 5000, "success");
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

  captureAndCrop(rect).finally(() => {
    cleanup();
    window.SwiftSelect.ui.cleanup();
    window.SwiftSelect.ui.setStatus("Copied to clipboard", 5000, "success");
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
  if (!dragging && (e.key === "Control" || e.key === "Meta")) {
    updateSnapAt(snapPointer.x, snapPointer.y);
  }

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
  if (e.key === "Control" || e.key === "Meta") {
    clearSnapState({ clearSelection: !dragging });
  }
}

export function preventAll(e) {
  const path = e.composedPath();
  if (
    window.SwiftSelect.ui.guideHost &&
    path.includes(window.SwiftSelect.ui.guideHost)
  )
    return;
  if (
    window.SwiftSelect.ui.statusHost &&
    path.includes(window.SwiftSelect.ui.statusHost)
  )
    return;
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

export function addListeners() {
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
