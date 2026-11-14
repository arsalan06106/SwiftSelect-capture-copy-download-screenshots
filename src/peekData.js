/**
 * Gallery peek: the data side of the tray that slides up when the pointer
 * rests on the Gallery button of the capture toolbar.
 *
 * Content scripts cannot open the extension's IndexedDB (it is partitioned
 * by origin), so the service worker answers for them:
 *
 *   gallery-peek        { limit }      → { success, enabled, more, items[] }
 *   gallery-peek-chunk  { id, index }  → { success, mime, size, total, index, data }
 *
 * Items carry a small preview as a data URL. The full image travels on
 * demand, in base64 slices, because a full-page capture can be larger than a
 * single runtime message may be.
 */
import { listRecentCaptures, getCapture } from "./storage.js";
import { getSettings, buildFilename } from "./settings.js";

// 6 MiB of bytes per slice: a multiple of 3, so slices encode to base64
// independently and decode back to the exact original bytes.
export const PEEK_CHUNK_BYTES = 6 * 1024 * 1024;

function bytesToBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${blob.type || "image/png"};base64,${bytesToBase64(bytes)}`;
}

export async function peekList(limit = 12) {
  const settings = await getSettings();
  const { records, more } = await listRecentCaptures(Math.max(1, Math.min(30, limit)));
  const items = [];
  for (const r of records) {
    let thumb = "";
    try {
      // The stored preview is a small WebP; fall back to the image itself
      // only when it is small enough not to bloat the message.
      if (r.thumb) thumb = await blobToDataUrl(r.thumb);
      else if (r.blob && r.blob.size < 1.5 * 1024 * 1024) thumb = await blobToDataUrl(r.blob);
    } catch {}
    const ext = r.format || "png";
    items.push({
      id: r.id,
      title: r.title || "",
      url: r.url || "",
      type: r.type || "screenshot",
      width: r.width || 0,
      height: r.height || 0,
      size: r.blob?.size || r.size || 0,
      mime: r.blob?.type || `image/${ext === "jpg" ? "jpeg" : ext}`,
      favorite: !!r.favorite,
      createdAt: r.createdAt || 0,
      name: buildFilename(settings.filenameTemplate, {
        title: r.title,
        url: r.url,
        type: r.type,
        ext,
        date: new Date(r.createdAt || Date.now()),
      }),
      thumb,
    });
  }
  return { success: true, enabled: settings.saveToGallery !== false, more, items };
}

export async function peekChunk(id, index = 0) {
  const r = await getCapture(id);
  if (!r?.blob) return { success: false, error: "missing" };
  const size = r.blob.size;
  const total = Math.max(1, Math.ceil(size / PEEK_CHUNK_BYTES));
  const i = Math.max(0, Math.min(total - 1, Number(index) || 0));
  const slice = r.blob.slice(i * PEEK_CHUNK_BYTES, Math.min(size, (i + 1) * PEEK_CHUNK_BYTES));
  const data = bytesToBase64(new Uint8Array(await slice.arrayBuffer()));
  return { success: true, mime: r.blob.type || "image/png", size, total, index: i, data };
}

/** Wire both messages into a runtime.onMessage listener. Returns true when handled. */
export function handlePeekMessage(message, sendResponse) {
  if (message?.type === "gallery-peek") {
    peekList(message.limit).then(sendResponse, (err) =>
      sendResponse({ success: false, error: err?.message || "Gallery unavailable" }),
    );
    return true;
  }
  if (message?.type === "gallery-peek-chunk") {
    peekChunk(message.id, message.index).then(sendResponse, (err) =>
      sendResponse({ success: false, error: err?.message || "Read failed" }),
    );
    return true;
  }
  return false;
}
