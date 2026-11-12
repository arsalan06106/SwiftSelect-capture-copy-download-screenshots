/**
 * SwiftSelect gallery storage engine.
 *
 * IndexedDB database `swiftselect_db`, object store `screenshots`.
 * Every call is promise based and runs on IndexedDB's own task queue, so the
 * calling thread never blocks. Image payloads are stored as Blobs: Chrome
 * keeps them on disk and hands back lazy references, so listing a few hundred
 * captures does not pull their pixels into memory.
 *
 * IndexedDB is partitioned by origin. This module therefore only works in
 * extension contexts (service worker, gallery, settings, popup, annotate
 * page). Content scripts hand captures to the service worker instead.
 */

export const DB_NAME = "swiftselect_db";
export const DB_VERSION = 1;
export const STORE = "screenshots";
export const CHANNEL = "swiftselect-gallery";

const DAY_MS = 24 * 60 * 60 * 1000;

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("createdAt", "createdAt");
        store.createIndex("type", "type");
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another context upgraded or deleted the database: drop the handle.
      db.onversionchange = () => {
        db.close();
        _dbPromise = null;
      };
      db.onclose = () => {
        _dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      _dbPromise = null;
      reject(req.error || new Error("IndexedDB open failed"));
    };
    req.onblocked = () => {
      _dbPromise = null;
      reject(new Error("IndexedDB open blocked"));
    };
  });
  return _dbPromise;
}

function run(mode, work) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        let result;
        const tx = db.transaction(STORE, mode);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
        tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
        work(tx.objectStore(STORE), (value) => {
          result = value;
        });
      }),
  );
}

let _channel = null;

function announce(change) {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    if (!_channel) _channel = new BroadcastChannel(CHANNEL);
    _channel.postMessage(change);
  } catch {}
}

/** Subscribe to writes made by any extension context. Returns an unsubscribe function. */
export function onGalleryChange(listener) {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e) => listener(e.data);
  return () => ch.close();
}

function recordSize(record) {
  return (record.blob?.size || 0) + (record.thumb?.size || 0);
}

function extFromMime(mime = "") {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  return "jpg";
}

/**
 * Build a small WebP preview of the top-left of an image.
 * Works in documents and in the service worker (OffscreenCanvas).
 * Returns { thumb, width, height } where width/height describe the source.
 */
export async function makeThumbnail(blob, knownWidth = 0, knownHeight = 0) {
  const MAX_W = 640;
  let width = knownWidth;
  let height = knownHeight;

  try {
    if (!width || !height) {
      const probe = await createImageBitmap(blob);
      width = probe.width;
      height = probe.height;
      probe.close();
    }

    // Tall pages keep their top, wide panoramas keep their left edge.
    const sw = Math.max(1, Math.min(width, Math.round(height * 2.4)));
    const sh = Math.max(1, Math.min(height, Math.round(sw * 0.8)));
    const tw = Math.max(1, Math.min(MAX_W, sw));
    const th = Math.max(1, Math.round((sh / sw) * tw));

    const bitmap = await createImageBitmap(blob, 0, 0, sw, sh, {
      resizeWidth: tw,
      resizeHeight: th,
      resizeQuality: "high",
    });

    let thumb = null;
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(tw, th);
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      thumb = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = tw;
      canvas.height = th;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      thumb = await new Promise((res) => canvas.toBlob(res, "image/webp", 0.82));
    }
    bitmap.close();
    return { thumb, width, height };
  } catch (err) {
    console.debug("SwiftSelect: thumbnail failed", err);
    return { thumb: null, width, height };
  }
}

/**
 * Store a capture. `blob` is required, everything else is optional metadata.
 * Resolves with the stored record (including its new id).
 */
export async function addCapture({ blob, title = "", url = "", type = "screenshot", width = 0, height = 0, createdAt } = {}) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error("addCapture needs a non-empty Blob");

  const preview = await makeThumbnail(blob, width, height);
  const record = {
    blob,
    thumb: preview.thumb,
    title: String(title || "").slice(0, 300),
    url: String(url || "").slice(0, 2000),
    type,
    format: extFromMime(blob.type),
    width: preview.width || width || 0,
    height: preview.height || height || 0,
    createdAt: createdAt || Date.now(),
  };
  record.favorite = false;
  record.deletedAt = 0;
  record.size = recordSize(record);

  const id = await run("readwrite", (store, done) => {
    const req = store.add(record);
    req.onsuccess = () => done(req.result);
  });
  record.id = id;
  announce({ kind: "add", id });
  return record;
}

/** Put a full record back (used by undo-delete). */
export async function restoreCapture(record) {
  await run("readwrite", (store) => {
    store.put(record);
  });
  announce({ kind: "add", id: record.id });
  return record;
}

/** All captures, newest first. */
export function listCaptures() {
  return run("readonly", (store, done) => {
    const out = [];
    const req = store.index("createdAt").openCursor(null, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        out.push(cursor.value);
        cursor.continue();
      } else {
        done(out);
      }
    };
  });
}

export function getCapture(id) {
  return run("readonly", (store, done) => {
    const req = store.get(Number(id));
    req.onsuccess = () => done(req.result || null);
  });
}

/** Merge fields into one record (rename, favorite, trash state). */
export async function updateCapture(id, patch) {
  const key = Number(id);
  const updated = await run("readwrite", (store, done) => {
    const req = store.get(key);
    req.onsuccess = () => {
      if (!req.result) return done(null);
      const next = { ...req.result, ...patch, id: key };
      store.put(next);
      done(next);
    };
  });
  if (updated) announce({ kind: "update", id: key });
  return updated;
}

function updateMany(ids, mutate) {
  const keys = ids.map(Number);
  return run("readwrite", (store, done) => {
    let n = 0;
    keys.forEach((key) => {
      const req = store.get(key);
      req.onsuccess = () => {
        if (req.result) {
          store.put(mutate(req.result));
          n += 1;
        }
      };
    });
    // Resolves on transaction complete, after every put.
    done(keys);
  }).then((result) => {
    announce({ kind: "update", ids: keys });
    return result;
  });
}

/** Soft delete: the capture moves to Trash and can be restored. */
export function trashCaptures(ids, now = Date.now()) {
  return updateMany(ids, (r) => ({ ...r, deletedAt: now }));
}

export function restoreCaptures(ids) {
  return updateMany(ids, (r) => ({ ...r, deletedAt: 0 }));
}

export function setFavorite(ids, favorite) {
  return updateMany(ids, (r) => ({ ...r, favorite: !!favorite }));
}

/** Permanent delete. */
export async function deleteCaptures(ids) {
  const keys = ids.map(Number);
  await run("readwrite", (store) => {
    keys.forEach((key) => store.delete(key));
  });
  announce({ kind: "delete", ids: keys });
}

export function deleteCapture(id) {
  return deleteCaptures([id]);
}

export async function clearCaptures() {
  await run("readwrite", (store) => {
    store.clear();
  });
  announce({ kind: "clear" });
}

/** Permanently remove everything in Trash. Resolves with the count. */
export async function emptyTrash() {
  const n = await run("readwrite", (store, done) => {
    let count = 0;
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return done(count);
      if (cursor.value.deletedAt) {
        cursor.delete();
        count += 1;
      }
      cursor.continue();
    };
  });
  if (n) announce({ kind: "delete" });
  return n;
}

export function isTrashed(record) {
  return !!record?.deletedAt;
}

/**
 * Apply the retention rules. Captures older than `retentionDays` move to
 * Trash (favorites are exempt), and Trash older than `trashDays` is removed
 * for good. Runs entirely on a cursor, so image data is never decoded.
 * Returns { trashed, purged }.
 */
export async function applyRetention({ retentionDays = 0, trashDays = 30 } = {}, now = Date.now()) {
  const DAY = 24 * 60 * 60 * 1000;
  const result = await run("readwrite", (store, done) => {
    let trashed = 0;
    let purged = 0;
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return done({ trashed, purged });
      const r = cursor.value;
      if (r.deletedAt) {
        if (trashDays > 0 && now - r.deletedAt > trashDays * DAY) {
          cursor.delete();
          purged += 1;
        }
      } else if (retentionDays > 0 && !r.favorite && now - (r.createdAt || 0) > retentionDays * DAY) {
        cursor.update({ ...r, deletedAt: now });
        trashed += 1;
      }
      cursor.continue();
    };
  });
  if (result.trashed || result.purged) announce({ kind: "retention", ...result });
  return result;
}

/** { count, bytes, trashCount, trashBytes } without touching image data. */
export function getStats() {
  return run("readonly", (store, done) => {
    const stats = { count: 0, bytes: 0, trashCount: 0, trashBytes: 0 };
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return done(stats);
      const r = cursor.value;
      const size = r.size || recordSize(r);
      if (r.deletedAt) {
        stats.trashCount += 1;
        stats.trashBytes += size;
      } else {
        stats.count += 1;
        stats.bytes += size;
      }
      cursor.continue();
    };
  });
}

export function isRecent(record, now = Date.now()) {
  return now - (record.createdAt || 0) < DAY_MS;
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 100 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
