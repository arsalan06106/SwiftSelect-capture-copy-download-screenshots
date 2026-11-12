/**
 * Capture delivery: the single place where a finished capture is fanned out
 * to the clipboard, the downloads folder and the gallery, according to the
 * user's settings.
 */

import { getOutputSettings, writeImageBlobToClipboard, blobToDataUrl } from "./utils.js";
import { setLastBlob, handleSaveAction } from "./download.js";
import { wantsCopy, wantsDownload } from "../settings.js";

const CHUNK_CHARS = 8 * 1024 * 1024;

function canvasToBlob(canvas, mime, quality) {
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), mime, quality),
  );
}

function send(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(resp || { success: false, error: "No response" });
      });
    } catch (err) {
      resolve({ success: false, error: err?.message });
    }
  });
}

/**
 * Hand a capture to the service worker, which owns the gallery database.
 * Runtime messages are JSON, so the image travels as a data URL, split into
 * chunks when it is large enough to threaten the message size ceiling.
 * Never throws: the gallery is a convenience, not part of the capture path.
 */
export async function saveToGallery(blob, meta = {}, { force = false } = {}) {
  try {
    if (!blob) return false;
    if (!force) {
      const { saveToGallery: enabled } = await getOutputSettings();
      if (!enabled) return false;
    }

    const payload = {
      title: meta.title ?? document.title ?? "",
      url: meta.url ?? location.href,
      type: meta.type || "screenshot",
      width: meta.width || 0,
      height: meta.height || 0,
    };

    const dataUrl = await blobToDataUrl(blob);
    if (dataUrl.length <= CHUNK_CHARS) {
      const resp = await send({ type: "gallery-save", dataUrl, meta: payload });
      return !!resp?.success;
    }

    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const total = Math.ceil(dataUrl.length / CHUNK_CHARS);
    for (let i = 0; i < total; i++) {
      const resp = await send({
        type: "gallery-save-chunk",
        key,
        index: i,
        total,
        chunk: dataUrl.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS),
        meta: i === total - 1 ? payload : undefined,
      });
      if (!resp?.success) return false;
    }
    return true;
  } catch (err) {
    console.debug("SwiftSelect: gallery save skipped", err);
    return false;
  }
}

/**
 * Encode a finished canvas and deliver it.
 *   type      gallery label: region | visible | fullpage | horizontal
 *   flashRect optional rect for the shutter flash (region capture)
 *   flash     set false to skip the flash entirely
 */
export async function deliverCanvas(canvas, { type = "visible", flashRect = null, flash = true } = {}) {
  const ui = window.SwiftSelect.ui;
  const settings = await getOutputSettings();
  const { destination, mime, quality, ext } = settings;
  const copy = wantsCopy(destination);
  // Long captures are always kept as files: they are the ones people lose.
  const alwaysFile = type === "fullpage" || type === "horizontal";
  const download = alwaysFile || wantsDownload(destination);

  const exportBlob = await canvasToBlob(canvas, mime, quality);
  setLastBlob(exportBlob, ext);

  // A quiet second line on the status: what was captured, so a wrong-sized
  // or wrong-format capture is noticed at a glance.
  const fmt = (ext || "png").toUpperCase();
  const kb = exportBlob?.size ? exportBlob.size / 1024 : 0;
  const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
  const detail = `${canvas.width.toLocaleString()} × ${canvas.height.toLocaleString()} · ${fmt} · ${size}`;
  const statusOpts = { sourceBlob: exportBlob, downloaded: download, detail };
  const fireFlash = () => {
    if (flash && settings.flash) ui.triggerFlash?.(flashRect || undefined);
  };

  // Gallery write runs alongside delivery and never delays the status pill.
  saveToGallery(exportBlob, { type, width: canvas.width, height: canvas.height });

  let clipboardOk = false;
  if (copy) {
    // The async clipboard only accepts PNG.
    const pngBlob = mime === "image/png" ? exportBlob : await canvasToBlob(canvas, "image/png");
    clipboardOk = await writeImageBlobToClipboard(pngBlob);
  }

  if (destination === "clipboard" && !alwaysFile) {
    if (!clipboardOk) {
      // Nothing must be lost: fall back to a file when the clipboard refuses.
      handleSaveAction(ext);
      ui.setStatus("Saved (Clipboard Blocked)", 5000, "saved", false, { ...statusOpts, downloaded: true });
      return exportBlob;
    }
    fireFlash();
    ui.setStatus("Copied to Clipboard", 5000, "success", false, statusOpts);
    return exportBlob;
  }

  if (download) handleSaveAction(ext);
  fireFlash();

  if (!copy && !download) {
    ui.setStatus(settings.saveToGallery ? "Saved to Gallery" : "Captured", 5000, "success", false, statusOpts);
  } else if (copy && download) {
    ui.setStatus(clipboardOk ? "Copied & Saved" : "Image Saved", 5000, "saved", false, statusOpts);
  } else {
    ui.setStatus("Image Saved", 5000, "saved", false, statusOpts);
  }
  return exportBlob;
}
