import { toggleCursor, getSmartFilename, getOutputSettings } from "./utils.js";
import { setLastBlob } from "./download.js";
import { handleCaptureVisible } from "./region.js";

let _unrollStyle = null;
let _unrollScrollStyle = null;
let _originalScrollTop = 0;
let _originalScrollLeft = 0;
let _hiddenStickyElements = [];
let _innerScrollContainer = null;
let _innerScrollOriginalStyles = null;
let _abortCapture = false;

export function neutralizeStickyElements() {
  _hiddenStickyElements = [];
  const candidates = [];
  const scrollY = window.scrollY || document.documentElement.scrollTop;
  const scrollX = window.scrollX || document.documentElement.scrollLeft;

  // Faster scan using TreeWalker
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        const tag = node.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT")
          return NodeFilter.FILTER_REJECT;
        if (node.hasAttribute("data-swiftselect-unroll"))
          return NodeFilter.FILTER_REJECT;
        if (node.id === "swift-select-filters") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  // Phase 1: Batch READS
  let el;
  while ((el = walker.nextNode())) {
    const style = window.getComputedStyle(el);
    const pos = style.position;

    if (pos === "fixed" || pos === "sticky") {
      candidates.push({
        el,
        style,
        pos,
        rect: el.getBoundingClientRect(),
      });
    }
  }

  // Phase 2: Batch WRITES
  for (const cand of candidates) {
    const { el, style, pos, rect } = cand;

    _hiddenStickyElements.push({
      element: el,
      originalPosition: el.style.position,
      originalTop: el.style.top,
      originalLeft: el.style.left,
      originalRight: el.style.right,
      originalBottom: el.style.bottom,
      originalWidth: el.style.width,
      originalHeight: el.style.height,
      originalZIndex: el.style.zIndex,
      originalVisibility: el.style.visibility,
      originalMargin: el.style.margin,
      computedPosition: pos,
    });

    el.style.setProperty("position", "absolute", "important");
    el.style.setProperty("margin", "0", "important");
    el.style.setProperty("right", "auto", "important");
    el.style.setProperty("bottom", "auto", "important");
    el.style.setProperty("width", `${rect.width}px`, "important");
    el.style.setProperty("height", `${rect.height}px`, "important");

    // Calculate document-relative coordinates
    const docTop = rect.top + scrollY;
    const docLeft = rect.left + scrollX;

    // Use a secondary pass for top/left if we wanted to be perfectly thrash-free,
    // but computing top/left relative to offsetParent usually needs offsetParent.docTop.
    // We can approximate or accept one layout break here if candidates are few.
    let offParent = el.offsetParent || document.body;
    let parentRect = offParent.getBoundingClientRect();
    let parentDocTop = parentRect.top + scrollY;
    let parentDocLeft = parentRect.left + scrollX;

    el.style.setProperty("top", `${docTop - parentDocTop}px`, "important");
    el.style.setProperty("left", `${docLeft - parentDocLeft}px`, "important");
  }
}

export function restoreStickyElements() {
  for (const entry of _hiddenStickyElements) {
    const el = entry.element;
    if (!el.isConnected) continue;
    el.style.position = entry.originalPosition;
    el.style.top = entry.originalTop;
    el.style.left = entry.originalLeft;
    el.style.right = entry.originalRight;
    el.style.bottom = entry.originalBottom;
    el.style.width = entry.originalWidth;
    el.style.height = entry.originalHeight;
    el.style.zIndex = entry.originalZIndex;
    el.style.visibility = entry.originalVisibility;
    el.style.margin = entry.originalMargin || "";
  }
  _hiddenStickyElements = [];
}

export function findInnerScrollContainer() {
  const winH = window.innerHeight;
  const winW = window.innerWidth;

  // Deep scan all potential scrolling containers to catch Gemini's custom elements
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode: (node) => {
        const tag = node.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT")
          return NodeFilter.FILTER_REJECT;
        if (node.id === "swift-select-filters") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let bestElement = null;
  let bestArea = 0;

  let el = document.body;
  const candidates = [document.body];

  while ((el = walker.nextNode())) {
    candidates.push(el);
  }

  for (const cand of candidates) {
    if (
      !cand ||
      cand.clientWidth < winW * 0.3 ||
      cand.clientHeight < winH * 0.3
    )
      continue;

    const style = window.getComputedStyle(cand);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;
    const overflow = style.overflow;

    const hasScrollY =
      (overflowY === "auto" ||
        overflowY === "scroll" ||
        overflow === "auto" ||
        overflow === "scroll") &&
      cand.scrollHeight > cand.clientHeight + 50;

    const hasScrollX =
      (overflowX === "auto" ||
        overflowX === "scroll" ||
        overflow === "auto" ||
        overflow === "scroll") &&
      cand.scrollWidth > cand.clientWidth + 50;

    if (hasScrollY || hasScrollX) {
      const r = cand.getBoundingClientRect();
      const area = r.width * r.height;

      // Weight the container by how much screen space it takes up.
      // E.g., a main chat wrapper will be huge.
      if (area > bestArea && area > winH * winW * 0.2) {
        bestArea = area;
        bestElement = cand;
      }
    }
  }

  return bestElement;
}

export function measureFullContentHeight() {
  const docSH = document.documentElement?.scrollHeight || 0;
  const bodySH = document.body?.scrollHeight || 0;
  const winH = window.innerHeight;

  const innerScroller = findInnerScrollContainer();
  if (innerScroller && innerScroller !== document.body) {
    _innerScrollContainer = innerScroller;
    innerScroller.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const nonScrollerHeight = winH - innerScroller.clientHeight;
    return innerScroller.scrollHeight + Math.max(0, nonScrollerHeight);
  }

  _innerScrollContainer = null;
  if (docSH > winH + 50 || bodySH > winH + 50) {
    return Math.max(docSH, bodySH);
  }
  return Math.max(docSH, bodySH, winH);
}

export function measureFullContentWidth() {
  const winW = window.innerWidth;
  const doc = document.documentElement;
  const body = document.body;

  const docSW = doc?.scrollWidth || 0;
  const bodySW = body?.scrollWidth || 0;

  // Real horizontal overflow exists only if scrollWidth exceeds innerWidth
  let width = winW;
  if (docSW > winW + 5) width = Math.max(width, docSW);
  if (bodySW > winW + 5) width = Math.max(width, bodySW);

  // Check if an actual horizontal inner scroll container exists
  if (_innerScrollContainer) {
    const isHorizontalScroller =
      _innerScrollContainer.scrollWidth >
        _innerScrollContainer.clientWidth + 20 &&
      (() => {
        const style = window.getComputedStyle(_innerScrollContainer);
        return style.overflowX === "auto" || style.overflowX === "scroll";
      })();
    if (isHorizontalScroller) {
      const nonScrollerWidth = Math.max(
        0,
        winW - _innerScrollContainer.clientWidth,
      );
      width = Math.max(
        width,
        _innerScrollContainer.scrollWidth + nonScrollerWidth,
      );
    }
  }

  return Math.round(width);
}

export function applyUnrollCSS(
  contentHeight,
  contentWidth,
  initialScrollTop = 0,
  mode = "full",
) {
  _originalScrollTop = window.scrollY || document.documentElement.scrollTop;
  _originalScrollLeft = window.scrollX || document.documentElement.scrollLeft;

  const isHorizontal = mode === "horizontal";

  // If in horizontal mode and content width does not overflow, bypass unrolling completely!
  if (isHorizontal && (!contentWidth || contentWidth <= window.innerWidth + 5)) {
    _unrollStyle = document.createElement("style");
    _unrollStyle.setAttribute("data-swiftselect-unroll", "true");
    _unrollStyle.textContent = `
      html, body {
        cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=), auto !important;
      }
      * {
        cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=), auto !important;
        pointer-events: none !important;
      }
      html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar {
        display: none !important; 
        width: 0 !important; 
        height: 0 !important;
        opacity: 0 !important;
      }
      html, body, * { 
        scrollbar-width: none !important; 
        -ms-overflow-style: none !important; 
      }
    `;
    document.head.appendChild(_unrollStyle);
    return;
  }

  // When unrolling horizontally with actual overflow:
  if (isHorizontal) {
    document.scrollingElement?.scrollTo({ left: 0, behavior: "instant" });
    neutralizeStickyElements();

    _unrollStyle = document.createElement("style");
    _unrollStyle.setAttribute("data-swiftselect-unroll", "true");
    _unrollStyle.textContent = `
      html, body {
        cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=), auto !important;
      }
      * {
        transition: none !important;
        animation-play-state: paused !important;
        box-shadow: none !important;
        cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=), auto !important;
        pointer-events: none !important;
      }
      html {
        transform: translate3d(var(--scroll-left, 0px), 0px, 0px) !important;
        overflow: hidden !important;
        min-width: 100vw !important;
        max-width: none !important;
        width: ${contentWidth}px !important;
      }
      body {
        overflow: visible !important;
      }
      html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar {
        display: none !important; 
        width: 0 !important; 
        height: 0 !important;
        opacity: 0 !important;
      }
      html, body, * { 
        scrollbar-width: none !important; 
        -ms-overflow-style: none !important; 
      }
    `;
    document.head.appendChild(_unrollStyle);
    setUnrollPosition(0, 0);
    return;
  }

  // Full page mode:
  document.scrollingElement?.scrollTo({ top: 0, left: 0, behavior: "instant" });

  _unrollStyle = document.createElement("style");
  _unrollStyle.setAttribute("data-swiftselect-unroll", "true");

  const heightCSS = contentHeight ? `height: ${contentHeight}px !important;` : "";
  const widthCSS =
    contentWidth && contentWidth > window.innerWidth + 5
      ? `width: ${contentWidth}px !important;`
      : "";
  const innerScroller = _innerScrollContainer;

  if (innerScroller) {
    _innerScrollOriginalStyles = {
      overflow: innerScroller.style.overflow,
      overflowY: innerScroller.style.overflowY,
      overflowX: innerScroller.style.overflowX,
      maxHeight: innerScroller.style.maxHeight,
      maxWidth: innerScroller.style.maxWidth,
      height: innerScroller.style.height,
      width: innerScroller.style.width,
    };

    innerScroller.style.setProperty("overflow", "visible", "important");
    innerScroller.style.setProperty("overflow-y", "visible", "important");
    innerScroller.style.setProperty("overflow-x", "visible", "important");
    innerScroller.style.setProperty("max-height", "none", "important");
    innerScroller.style.setProperty("max-width", "none", "important");
    innerScroller.style.setProperty(
      "height",
      innerScroller.scrollHeight + "px",
      "important",
    );
    if (innerScroller.scrollWidth > innerScroller.clientWidth) {
      innerScroller.style.setProperty(
        "width",
        innerScroller.scrollWidth + "px",
        "important",
      );
    }
    if (initialScrollTop === 0) {
      innerScroller.scrollTo({ top: 0, left: 0, behavior: "instant" });
    } else {
      innerScroller.scrollTo({ left: 0, behavior: "instant" });
    }
  }

  _unrollStyle.textContent = `
    html, body {
      cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=), auto !important;
    }
    * {
      transition: none !important;
      animation-play-state: paused !important;
      box-shadow: none !important;
      cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=), auto !important;
      pointer-events: none !important;
    }
    html {
      transform: translate3d(var(--scroll-left, 0px), var(--scroll-top, 0px), 0px) !important;
      overflow: hidden !important;
      min-height: 100vh !important;
      max-height: none !important;
      min-width: 100vw !important;
      max-width: none !important;
      ${heightCSS}
      ${widthCSS}
    }
    body {
      max-width: none !important;
      overflow: visible !important;
    }
    html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar {
      display: none !important; 
      width: 0 !important; 
      height: 0 !important;
      opacity: 0 !important;
    }
    html, body, * { 
      scrollbar-width: none !important; 
      -ms-overflow-style: none !important; 
    }
  `;
  document.head.appendChild(_unrollStyle);
  setUnrollPosition(initialScrollTop, 0);
  neutralizeStickyElements();
}

export function removeUnrollCSS() {
  restoreStickyElements();
  if (_innerScrollContainer && _innerScrollOriginalStyles) {
    const el = _innerScrollContainer;
    const orig = _innerScrollOriginalStyles;
    el.style.overflow = orig.overflow;
    el.style.overflowY = orig.overflowY;
    el.style.overflowX = orig.overflowX || "";
    el.style.maxHeight = orig.maxHeight;
    el.style.maxWidth = orig.maxWidth || "";
    el.style.height = orig.height;
    el.style.width = orig.width || "";
    _innerScrollContainer = null;
    _innerScrollOriginalStyles = null;
  }
  if (_unrollStyle) {
    _unrollStyle.remove();
    _unrollStyle = null;
  }
  if (_unrollScrollStyle) {
    _unrollScrollStyle.remove();
    _unrollScrollStyle = null;
  }
  requestAnimationFrame(() => {
    window.scrollTo(_originalScrollLeft, _originalScrollTop);
  });
}

export function setUnrollPosition(scrollTop, scrollLeft = 0) {
  if (_unrollScrollStyle) _unrollScrollStyle.remove();
  _unrollScrollStyle = document.createElement("style");
  _unrollScrollStyle.setAttribute("data-swiftselect-unroll-scroll", "true");
  _unrollScrollStyle.textContent = `html { --scroll-top: ${-scrollTop}px !important; --scroll-left: ${-scrollLeft}px !important; }`;
  document.head.appendChild(_unrollScrollStyle);
}

export function handleUnrollPage(data = {}) {
  const mode = data?.mode || "full";
  toggleCursor(true);
  document.activeElement?.blur();
  const hovered = document.querySelectorAll(":hover");
  hovered.forEach((el) => {
    el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
  });
  document.documentElement.dispatchEvent(
    new MouseEvent("mouseleave", { bubbles: true, clientX: -1, clientY: -1 }),
  );

  const initialScrollTop =
    window.scrollY || document.documentElement.scrollTop || 0;
  const contentHeight =
    mode === "horizontal" ? window.innerHeight : measureFullContentHeight();
  const contentWidth = measureFullContentWidth();
  applyUnrollCSS(
    contentHeight,
    contentWidth,
    mode === "horizontal" ? initialScrollTop : 0,
    mode,
  );

  const rect = document.documentElement.getBoundingClientRect();
  const bodyBg = window.getComputedStyle(document.body).backgroundColor;
  const htmlBg = window.getComputedStyle(
    document.documentElement,
  ).backgroundColor;
  const bgColor =
    bodyBg && bodyBg !== "rgba(0, 0, 0, 0)" && bodyBg !== "transparent"
      ? bodyBg
      : htmlBg && htmlBg !== "rgba(0, 0, 0, 0)" && htmlBg !== "transparent"
        ? htmlBg
        : null;

  const actualWidth =
    mode === "horizontal" && contentWidth <= window.innerWidth + 5
      ? window.innerWidth
      : Math.max(contentWidth, rect.width);

  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    scrollHeight: Math.max(contentHeight, rect.height),
    scrollWidth: actualWidth,
    initialScrollTop: mode === "horizontal" ? initialScrollTop : 0,
    rect: {
      height: rect.height,
      bottom: rect.bottom,
      width: actualWidth,
      right: rect.right,
    },
    rectBottom: rect.bottom,
    rectRight: rect.right,
    bgColor,
    abort: _abortCapture,
  };
}

export function handleUpdateUnroll(scrollTop, scrollLeft = 0) {
  if (_abortCapture) return { abort: true };
  setUnrollPosition(scrollTop, scrollLeft);
  void document.documentElement.offsetHeight;
  const rect = document.documentElement.getBoundingClientRect();
  return {
    rectBottom: rect.bottom,
    rectRight: rect.right,
    rect: {
      height: rect.height,
      bottom: rect.bottom,
      width: rect.width,
      right: rect.right,
    },
  };
}

export function handleRestoreUnroll() {
  toggleCursor(false);
  removeUnrollCSS();
}

export async function captureStream({
  mode = "full",
  actionName = "capture-full",
  label = "Full Page",
  filenameType = "fullpage",
} = {}) {
  let originalIcon = null;
  _abortCapture = false;

  const onAbortKey = (e) => {
    if (e.key === "Escape") {
      _abortCapture = true;
      window.SwiftSelect.ui.setStatus("Aborting...", 1500);
    }
  };

  const btn = window.SwiftSelect.ui.guideShadow?.querySelector(
    `[data-action="${actionName}"]`,
  );

  try {
    window.addEventListener("keydown", onAbortKey, true);
    window.SwiftSelect.ui.ensureUi();
    window.SwiftSelect.ui.removeCrosshairCursor();
    window.SwiftSelect.events.removeListeners();
    window.SwiftSelect.ui.updateBadge("0%", "#BA4B5C");

    originalIcon = btn?.cloneNode(true);

    if (window.SwiftSelect.ui.guideHost) {
      window.SwiftSelect.ui.guideHost.style.display = "none";
    }
    if (window.SwiftSelect.ui.overlayHost) {
      window.SwiftSelect.ui.overlayHost.style.display = "none";
    }
    if (typeof window.SwiftSelect.ui.releaseFreeze === "function") {
      window.SwiftSelect.ui.releaseFreeze();
    }
    if (typeof window.SwiftSelect.ui.removeFlash === "function") {
      window.SwiftSelect.ui.removeFlash();
    }

    const tCursor =
      "url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=), auto";
    document.documentElement.style.setProperty("cursor", tCursor, "important");
    document.body.style.setProperty("cursor", tCursor, "important");

    await new Promise((r) => requestAnimationFrame(r));
    document.activeElement?.blur();

    const { format, destination } = await getOutputSettings();
    const captureFormat = format === "png" ? "image/png" : "image/jpeg";
    const captureQuality = 0.98;
    const fileExt = format;

    // Notify background
    const result = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "start-fullpage-capture",
          mode,
          frameInterval: 60,
          format: captureFormat,
          quality: captureQuality,
        },
        resolve,
      );
    });

    if (_abortCapture || result?.abort) throw new Error("Capture Aborted");
    if (!result || !result.success) {
      throw new Error(result?.error || `${label} capture failed`);
    }

    function dataUrlToBlob(dataUrl) {
      try {
        const parts = dataUrl.split(",");
        const mime = parts[0].match(/:(.*?);/)?.[1] || "image/jpeg";
        const bstr = atob(parts[1]);
        let n = bstr.length;
        const u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
      } catch (e) {
        console.warn("dataUrlToBlob failed:", e);
        return null;
      }
    }

    let blob = null;
    if (result.dataUrl) {
      blob = dataUrlToBlob(result.dataUrl);
    }
    if (!blob && result.blobUrl) {
      try {
        const response = await fetch(result.blobUrl);
        blob = await response.blob();
      } catch (err) {
        console.warn("fetch blobUrl failed:", err);
      }
    }

    if (!blob) throw new Error("Could not process captured full-page image");
    setLastBlob(blob, fileExt);

    if (result.blobUrl) {
      try {
        URL.revokeObjectURL(result.blobUrl);
      } catch {}
    }

    window.SwiftSelect.ui.updateBadge("✓", "#10B981");
    if (btn) {
      btn.classList.remove("qs-loading");
      btn.querySelector(".qs-progress-text")?.remove();
      btn.classList.add("qs-success");
      const tick = window.SwiftSelect.ui.createSvg("0 -960 960 960", {
        d: "M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z",
      });
      while (btn.firstChild) btn.removeChild(btn.firstChild);
      btn.appendChild(tick);
      if (label && originalIcon?.querySelector("span")) {
        const span = document.createElement("span");
        span.textContent = label;
        btn.appendChild(span);
      }

      setTimeout(() => {
        btn.classList.remove("qs-success");
        if (originalIcon) {
          while (btn.firstChild) btn.removeChild(btn.firstChild);
          originalIcon.childNodes.forEach((n) =>
            btn.appendChild(n.cloneNode(true)),
          );
        }
      }, 2000);
    }

    if (destination === "both" || destination === "download") {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = getSmartFilename(filenameType, fileExt);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    const clipOk = result.clipboardSuccess;
    let statusMsg = "Page Captured";
    let statusType = "saved";
    if (destination === "both") {
      statusMsg = clipOk ? "Copied & Saved" : "Page Saved";
      statusType = "saved";
    } else if (destination === "clipboard") {
      statusMsg = clipOk ? "Copied to Clipboard" : "Page Captured";
      statusType = clipOk ? "success" : "saved";
    } else if (destination === "download") {
      statusMsg = "Page Saved";
      statusType = "saved";
    }

    document.documentElement.style.cursor = "";
    document.body.style.cursor = "";
    window.SwiftSelect.ui.cleanup();
    window.SwiftSelect.events.removeListeners();
    window.removeEventListener("keydown", onAbortKey, true);

    window.SwiftSelect.ui.setStatus(statusMsg, 5000, statusType);

    window.SwiftSelect.ui.updateBadge("✓", "#10B981");
    setTimeout(() => window.SwiftSelect.ui.updateBadge(""), 1500);
  } catch (err) {
    console.error(`${label} capture error:`, err);
    handleRestoreUnroll();
    window.SwiftSelect.ui.updateBadge("ERR", "#EF4444");
    setTimeout(() => window.SwiftSelect.ui.updateBadge(""), 2000);
    if (btn) {
      btn.classList.remove("qs-loading");
      btn.classList.remove("qs-success");
      btn.querySelector(".qs-progress-text")?.remove();
      if (originalIcon) {
        while (btn.firstChild) btn.removeChild(btn.firstChild);
        originalIcon.childNodes.forEach((n) =>
          btn.appendChild(n.cloneNode(true)),
        );
      }
    }
    document.documentElement.style.cursor = "";
    document.body.style.cursor = "";
    window.SwiftSelect.ui.setStatus("Capture Failed", 3000, "error");
    if (window.SwiftSelect.ui.guideHost)
      window.SwiftSelect.ui.guideHost.style.display = "flex";
    window.removeEventListener("keydown", onAbortKey, true);
  }
}

export async function handleCaptureFullPage() {
  const contentHeight = measureFullContentHeight();
  const contentWidth = measureFullContentWidth();
  if (
    contentHeight <= window.innerHeight + 5 &&
    contentWidth <= window.innerWidth + 5
  ) {
    return handleCaptureVisible();
  }
  return captureStream({
    mode: "full",
    actionName: "capture-full",
    label: "Full Page",
    filenameType: "fullpage",
  });
}

export async function handleCaptureHorizontal() {
  if (measureFullContentWidth() <= window.innerWidth + 5) {
    return handleCaptureVisible();
  }
  return captureStream({
    mode: "horizontal",
    actionName: "capture-horizontal",
    label: "Horizontal View",
    filenameType: "horizontal",
  });
}
