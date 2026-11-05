/**
 * Utility functions for capture operations
 */

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function getSmartFilename(type, ext = "jpg") {
  let title = document.title || "";
  title = title.replace(/[<>:"\/\\|?*\x00-\x1F]/g, " ");
  title = title.trim().replace(/\s+/g, " ");
  if (title.length > 100) title = title.substring(0, 100).trim();

  const cleanExt = (ext || "jpg").replace(/^\./, "");
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return title
    ? `${title} - ${type} - ${timestamp}.${cleanExt}`
    : `${type} - ${timestamp}.${cleanExt}`;
}

let _cursorStyleTag = null;

export function toggleCursor(hide) {
  if (hide) {
    if (!_cursorStyleTag) {
      _cursorStyleTag = document.createElement("style");
      _cursorStyleTag.id = "qs-cursor-hide";
      _cursorStyleTag.textContent = `
        * { cursor: none !important; }
        .qs-ovl, .qs-guide, .qs-status-host { cursor: none !important; }
      `;
      (document.head || document.documentElement).appendChild(_cursorStyleTag);
    }
  } else {
    if (_cursorStyleTag) {
      _cursorStyleTag.remove();
      _cursorStyleTag = null;
    }
  }
}

let _cachedSettings = null;

try {
  if (typeof chrome !== "undefined" && chrome?.storage?.local) {
    chrome.storage.local.get(["outputFormat", "outputDestination"], (data) => {
      _cachedSettings = {
        format: data?.outputFormat === "jpg" ? "jpg" : "png",
        destination: data?.outputDestination || "both",
      };
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local") {
        if (!_cachedSettings) _cachedSettings = { format: "png", destination: "both" };
        if (changes.outputFormat) {
          _cachedSettings.format = changes.outputFormat.newValue === "jpg" ? "jpg" : "png";
        }
        if (changes.outputDestination) {
          _cachedSettings.destination = changes.outputDestination.newValue || "both";
        }
      }
    });
  }
} catch {}

export function getOutputSettingsSync() {
  return _cachedSettings || { format: "png", destination: "both" };
}

export async function getOutputSettings() {
  if (_cachedSettings) return _cachedSettings;
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(["outputFormat", "outputDestination"], (data) => {
        _cachedSettings = {
          format: data?.outputFormat === "jpg" ? "jpg" : "png",
          destination: data?.outputDestination || "both",
        };
        resolve(_cachedSettings);
      });
    } catch {
      resolve({ format: "png", destination: "both" });
    }
  });
}

export async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

export async function writeImageBlobToClipboard(blob) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
    return true;
  } catch (clipErr) {
    console.debug("Clipboard write from content failed:", clipErr);
  }

  try {
    const dataUrl = await blobToDataUrl(blob);
    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "write-image-to-clipboard", dataUrl },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error: chrome.runtime.lastError.message,
            });
            return;
          }
          resolve(response);
        },
      );
    });
    return !!resp?.success;
  } catch (offscreenErr) {
    console.debug("Clipboard write from offscreen failed:", offscreenErr);
    return false;
  }
}

export function detectStandaloneMediaOrActiveBounds() {
  if (typeof document === "undefined" || !document.body) {
    return {
      isStandaloneMedia: false,
      mediaElement: null,
      activeRect: null,
      cropRect: null,
      hasMargins: false,
    };
  }

  const winW = window.innerWidth;
  const winH = window.innerHeight;

  const contentType = document.contentType || "";
  const isMediaContentType =
    contentType.startsWith("image/") || contentType.startsWith("video/");

  const bodyChildren = Array.from(document.body.children).filter((el) => {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") {
      return false;
    }
    if (
      el.hasAttribute("data-swiftselect-unroll") ||
      el.id === "swift-select-filters" ||
      el.id?.startsWith("qs-") ||
      el.classList?.contains("qs-shadow-host") ||
      el.dataset?.qsRole
    ) {
      return false;
    }
    try {
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
    } catch {}
    return true;
  });

  let standaloneMediaEl = null;

  if (bodyChildren.length === 1) {
    const child = bodyChildren[0];
    const tag = child.tagName;
    if (tag === "IMG" || tag === "SVG" || tag === "VIDEO" || tag === "CANVAS") {
      standaloneMediaEl = child;
    }
  }

  if (!standaloneMediaEl && isMediaContentType) {
    standaloneMediaEl =
      document.querySelector("body > img, body > video, body > svg, body > canvas") ||
      document.querySelector("img, video, svg, canvas");
  }

  if (standaloneMediaEl) {
    const rect = standaloneMediaEl.getBoundingClientRect();
    const activeLeft = Math.max(0, Math.round(rect.left));
    const activeTop = Math.max(0, Math.round(rect.top));
    const activeWidth = Math.round(rect.width);
    const activeHeight = Math.round(rect.height);

    const hasMargins =
      activeLeft > 1 ||
      activeTop > 1 ||
      activeWidth < winW - 2 ||
      activeHeight < winH - 2;

    const activeRect = {
      left: activeLeft,
      top: activeTop,
      width: activeWidth,
      height: activeHeight,
    };

    return {
      isStandaloneMedia: true,
      mediaElement: standaloneMediaEl,
      activeRect,
      cropRect: hasMargins
        ? {
            x: activeLeft,
            y: activeTop,
            width: activeWidth,
            height: activeHeight,
          }
        : null,
      hasMargins,
    };
  }

  return {
    isStandaloneMedia: false,
    mediaElement: null,
    activeRect: null,
    cropRect: null,
    hasMargins: false,
  };
}
