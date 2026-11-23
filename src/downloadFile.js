/**
 * Bulletproof cross-context file download helper & filename sanitizer.
 *
 * Prevents Chrome MV3 `chrome.downloads.download` blob-URL filename resets
 * (where Chrome or another download manager falls back to literally "download")
 * by sanitizing filenames, registering them with the background service worker's
 * `onDeterminingFilename` listener, and falling back cleanly to an attached
 * DOM `<a download>` click when running outside an extension context.
 */

const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

const MIME_EXT_MAP = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/vnd.microsoft.icon": "ico",
  "image/x-icon": "ico",
  "application/zip": "zip",
  "application/pdf": "pdf",
};

/** Infer a clean file extension from a Blob's MIME type. */
export function extFromBlob(blob, fallback = "png") {
  const mime = String(blob?.type || "").toLowerCase().split(";")[0].trim();
  if (MIME_EXT_MAP[mime]) return MIME_EXT_MAP[mime];
  return String(fallback || "png").replace(/^\./, "").toLowerCase() || "png";
}

/**
 * Guarantee a valid, Chrome-safe download filename with a clean stem and
 * extension. Never returns empty, path-traversal segments, illegal characters,
 * or a bare extensionless "download".
 */
export function sanitizeDownloadFilename(filename, fallbackExt = "png", fallbackStem = "SwiftSelect-image") {
  const cleanFallbackExt = String(fallbackExt || "png")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase() || "png";

  let raw = String(filename || "").trim();
  // Keep only the basename if any path separator slipped in.
  raw = raw.replace(/\\/g, "/").split("/").pop() || "";
  raw = raw.replace(ILLEGAL_FILENAME_CHARS, " ").replace(/\s+/g, " ").trim();

  // Split extension if present (2..5 alnum chars after final dot).
  let stem = raw;
  let ext = "";
  const extMatch = raw.match(/^(.*)\.([a-z0-9]{2,5})$/i);
  if (extMatch) {
    stem = extMatch[1];
    ext = extMatch[2].toLowerCase();
  }

  stem = stem
    .replace(/^[\s._-]+|[\s._-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!stem || WINDOWS_RESERVED.test(stem)) {
    stem = String(fallbackStem || "SwiftSelect-image").replace(ILLEGAL_FILENAME_CHARS, " ").trim() || "SwiftSelect-image";
  }

  if (stem.length > 180) {
    stem = stem.slice(0, 180).trim();
  }

  const finalExt = ext || cleanFallbackExt;
  return `${stem}.${finalExt}`;
}

function triggerAnchorDownload(url, safeFilename) {
  try {
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = safeFilename;
    a.setAttribute("download", safeFilename);
    a.rel = "noopener";
    (document.body || document.documentElement).appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 2000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Download a Blob with an enforced, sanitized filename.
 * Works both inside a Chrome MV3 extension page and in the standalone preview.
 */
export function downloadBlobFile(blob, filename) {
  if (!blob) return false;
  const fallbackExt = extFromBlob(blob, "png");
  const safeName = sanitizeDownloadFilename(filename, fallbackExt);
  const url = URL.createObjectURL(blob);

  const isRealExtension =
    typeof location !== "undefined" &&
    location.protocol === "chrome-extension:" &&
    typeof chrome !== "undefined" &&
    !!chrome.downloads?.download;

  if (isRealExtension) {
    // Register the authoritative filename with background.js so
    // chrome.downloads.onDeterminingFilename enforces it even if Chrome's
    // blob download pipeline or another extension tries to rename it to "download".
    try {
      chrome.runtime?.sendMessage?.({ type: "register-download-name", url, filename: safeName }, () => {
        void chrome.runtime?.lastError;
      });
    } catch {}

    try {
      chrome.downloads.download(
        { url, filename: safeName, conflictAction: "uniquify", saveAs: false },
        (downloadId) => {
          if (chrome.runtime?.lastError || downloadId === undefined) {
            triggerAnchorDownload(url, safeName);
          }
        },
      );
    } catch {
      triggerAnchorDownload(url, safeName);
    }
  } else {
    triggerAnchorDownload(url, safeName);
  }

  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}
