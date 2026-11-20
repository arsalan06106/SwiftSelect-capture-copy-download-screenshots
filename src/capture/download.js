import { getSmartFilename, blobToDataUrl } from "./utils.js";
import { sanitizeDownloadFilename, extFromBlob } from "../downloadFile.js";

let lastBlob = null;
let lastExt = "jpg";
let lastType = "screenshot";

export function setLastBlob(blob, ext = "jpg", type = "screenshot") {
  lastBlob = blob;
  lastExt = ext || "jpg";
  if (type) lastType = type;
}

export function getLastBlob() {
  return lastBlob;
}

export function getLastExt() {
  return lastExt;
}

export async function downloadBlob(blob, filename, options = {}) {
  if (!blob) return false;
  const safeFilename = sanitizeDownloadFilename(filename, extFromBlob(blob, "png"));

  const isFileProtocol =
    typeof window !== "undefined" && window.location?.protocol === "file:";
  const extBlobUrl = options?.blobUrl;

  // 1. If we have an extension blobUrl from offscreen, use chrome.downloads directly (0ms, zero IPC overhead)
  if (extBlobUrl) {
    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: "download-file", url: extBlobUrl, filename: safeFilename },
          (res) => {
            if (chrome.runtime.lastError || !res?.success) {
              resolve({ success: false });
            } else {
              resolve(res);
            }
          },
        );
      });
      if (resp?.success) return true;
    } catch (e) {
      console.debug("Extension blobUrl download failed, trying fallback:", e);
    }
  }

  // 1b. Inside an extension page (gallery, standalone editor) the downloads API
  // is available directly and takes a blob URL without any copying.
  if (typeof location !== "undefined" && location.protocol === "chrome-extension:" && chrome.downloads?.download) {
    const url = URL.createObjectURL(blob);
    try {
      chrome.runtime?.sendMessage?.({ type: "register-download-name", url, filename: safeFilename }, () => {
        void chrome.runtime?.lastError;
      });
    } catch {}
    const ok = await new Promise((resolve) => {
      chrome.downloads.download({ url, filename: safeFilename, conflictAction: "uniquify", saveAs: false }, (downloadId) => {
        resolve(!chrome.runtime.lastError && downloadId !== undefined);
      });
    });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (ok) return true;
  }

  // 2. On standard web pages (https://, http://), native DOM <a> click is instantaneous (0ms, zero IPC overhead)
  if (!isFileProtocol) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = safeFilename;
      a.setAttribute("download", safeFilename);
      a.rel = "noopener";
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 30000);
      return true;
    } catch (domErr) {
      console.debug("DOM download failed, trying background fallback:", domErr);
    }
  }

  // 3. On file:/// pages or if DOM click failed, use background chrome.downloads
  try {
    const dataUrl = await blobToDataUrl(blob);
    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "download-file", url: dataUrl, filename: safeFilename },
        (res) => {
          if (chrome.runtime.lastError || !res?.success) {
            resolve({
              success: false,
              error: chrome.runtime.lastError?.message || res?.error,
            });
          } else {
            resolve(res);
          }
        },
      );
    });
    if (resp?.success) return true;
  } catch (err) {
    console.debug("Background download failed, trying DOM click:", err);
  }

  // 4. Final fallback to DOM click if background somehow failed
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = safeFilename;
    a.setAttribute("download", safeFilename);
    a.rel = "noopener";
    (document.body || document.documentElement).appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 30000);
    return true;
  } catch (domErr) {
    return false;
  }
}

export async function handleSaveAction(customExt = null, customType = null) {
  if (!lastBlob) return;

  const ext = customExt || lastExt || "jpg";
  const type = customType || lastType || "screenshot";
  const filename = getSmartFilename(type, ext);
  await downloadBlob(lastBlob, filename);

  // Swap the status to "saved" through setStatus itself, so the new state
  // gets the right tile, glyph and tint, and keeps the capture details line.
  const statusEl = window.SwiftSelect?.ui?.statusEl;
  if (statusEl?.querySelector(".qs-save-btn")) {
    const detail = statusEl.querySelector(".qs-status-text small")?.textContent || "";
    window.SwiftSelect.ui.setStatus("Image Saved", 3500, "saved", false, {
      downloaded: true,
      detail,
      sourceBlob: lastBlob,
    });
  }
}
