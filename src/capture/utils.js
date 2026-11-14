/**
 * Utility functions for capture operations
 */

import { SETTING_KEYS, normalizeSettings, formatInfo, buildFilename } from "../settings.js";

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function getSmartFilename(type, ext = "jpg") {
  return buildFilename(_cachedSettings?.template, {
    title: typeof document !== "undefined" ? document.title : "",
    url: typeof location !== "undefined" ? location.href : "",
    type,
    ext,
  });
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

function toOutputSettings(raw) {
  const n = normalizeSettings(raw);
  const info = formatInfo(n.outputFormat);
  return {
    format: n.outputFormat, // png | jpg | webp
    ext: info.ext,
    mime: info.mime,
    quality: n.outputFormat === "png" ? 1 : n.outputQuality,
    destination: n.outputDestination, // both | clipboard | download | none
    saveToGallery: n.saveToGallery,
    delay: n.captureDelay,
    template: n.filenameTemplate,
    flash: n.captureFlash,
    toolbarShortcuts: n.toolbarShortcuts,
    editorShortcuts: n.editorShortcuts,
    colour: n.uiColour,
    raw: n,
  };
}

/** The full normalized settings (for the in-page settings tab). */
export function getAllSettingsSync() {
  return getOutputSettingsSync().raw || {};
}

// ─── Toolbar look ────────────────────────────────────────────────────
// The in-page surfaces (capture toolbar, its panel, the editor, tooltips)
// wear one of five glass looks. With Colour on Dynamic a different one is
// picked each time the toolbar opens; Calm and Plain keep the quiet "clear"
// look. The editor keeps whichever the toolbar last wore.
export const TOOLBAR_LOOKS = ["clear", "sunset", "ocean", "aurora", "mint"];
let _look = null;

export function pickToolbarLook() {
  if ((getOutputSettingsSync().colour || "dynamic") !== "dynamic") {
    _look = "clear";
    return _look;
  }
  const choices = TOOLBAR_LOOKS.filter((l) => l !== _look);
  _look = choices[Math.floor(Math.random() * choices.length)];
  return _look;
}

export function currentToolbarLook() {
  if ((getOutputSettingsSync().colour || "dynamic") !== "dynamic") return "clear";
  return _look || pickToolbarLook();
}

let _rawSettings = {};

try {
  if (typeof chrome !== "undefined" && chrome?.storage?.local) {
    chrome.storage.local.get(SETTING_KEYS, (data) => {
      _rawSettings = data || {};
      _cachedSettings = toOutputSettings(_rawSettings);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      let touched = false;
      for (const key of SETTING_KEYS) {
        if (changes[key]) {
          _rawSettings[key] = changes[key].newValue;
          touched = true;
        }
      }
      if (touched) _cachedSettings = toOutputSettings(_rawSettings);
    });
  }
} catch {}

export function getOutputSettingsSync() {
  return _cachedSettings || toOutputSettings({});
}

export async function getOutputSettings() {
  if (_cachedSettings) return _cachedSettings;
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(SETTING_KEYS, (data) => {
        _rawSettings = data || {};
        _cachedSettings = toOutputSettings(_rawSettings);
        resolve(_cachedSettings);
      });
    } catch {
      resolve(toOutputSettings({}));
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

/**
 * Crop a snapshot of the visible tab to the standalone media on it (an image
 * or video opened on its own), so the grey margins Chrome draws around it
 * never end up in the capture. Returns the input when there is nothing to trim.
 */
export async function cropSnapshotToMedia(dataUrl) {
  try {
    const info = detectStandaloneMediaOrActiveBounds();
    if (!info.cropRect) return dataUrl;
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = dataUrl;
    });
    const scale = img.width / window.innerWidth;
    const x = Math.max(0, Math.round(info.cropRect.x * scale));
    const y = Math.max(0, Math.round(info.cropRect.y * scale));
    const w = Math.min(img.width - x, Math.round(Math.min(info.cropRect.width, window.innerWidth - info.cropRect.x) * scale));
    const h = Math.min(img.height - y, Math.round(Math.min(info.cropRect.height, window.innerHeight - info.cropRect.y) * scale));
    if (w < 2 || h < 2) return dataUrl;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(img, x, y, w, h, 0, 0, w, h);
    return c.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}

/** Keep a capture failure for the Gallery's notices (never throws). */
const FRIENDLY = [
  [/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i, "Chrome allows only a couple of captures per second. Wait a moment and try again."],
  [/timed out/i, "The browser took too long to hand over the picture. Try again; if it keeps happening, reload the page."],
  [/cannot access|cannot be scripted|chrome:\/\/|webstore/i, "Chrome does not let extensions capture this kind of page."],
  [/Extension context invalidated/i, "SwiftSelect was updated or reloaded. Reload the page, then capture again."],
];

/** Plain words for the errors people actually meet. */
export function friendlyError(err) {
  const raw = err ? err.message || String(err) : "";
  const hit = FRIENDLY.find(([re]) => re.test(raw));
  return hit ? hit[1] : raw;
}

export function reportIssue(title, err, kind = "error") {
  try {
    const detail = err ? friendlyError(err) : "";
    chrome.runtime.sendMessage({ type: "record-issue", issue: { kind, title, detail, source: location.href } }, () => void chrome.runtime.lastError);
  } catch {}
}
