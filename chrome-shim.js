/**
 * Lightweight chrome.* API shim for running SwiftSelect extension pages in a
 * standard browser preview (port 3000).
 *
 * When SwiftSelect is loaded as an unpacked Chrome extension, `chrome.runtime.id`
 * is already defined and this file is never injected or executed.
 */
(function () {
  if (globalThis.chrome && globalThis.chrome.runtime && globalThis.chrome.runtime.id) {
    return;
  }

  const MANIFEST =
    globalThis.__SWIFTSELECT_MANIFEST__ || {
      manifest_version: 3,
      name: "SwiftSelect - Capture, Copy & Download Screenshots",
      version: "2.2.0",
      commands: {},
    };

  const storageListeners = new Set();
  const messageListeners = new Set();
  const storageChannel =
    typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("swiftselect-chrome-storage") : null;

  function emitStorageChanges(changes, areaName, broadcast = true) {
    if (!changes || !Object.keys(changes).length) return;
    storageListeners.forEach((fn) => {
      try {
        fn(changes, areaName);
      } catch (err) {
        console.debug("SwiftSelect shim: storage listener error", err);
      }
    });
    if (broadcast && storageChannel) {
      try {
        storageChannel.postMessage({ areaName, changes });
      } catch {}
    }
  }

  if (storageChannel) {
    storageChannel.onmessage = (e) => {
      if (e?.data?.changes && e?.data?.areaName) {
        emitStorageChanges(e.data.changes, e.data.areaName, false);
      }
    };
  }

  function createStorageArea(areaName, backingStore) {
    const prefix = `ss_ext_${areaName}:`;

    function readAll() {
      const out = {};
      try {
        for (let i = 0; i < backingStore.length; i++) {
          const fullKey = backingStore.key(i);
          if (!fullKey || !fullKey.startsWith(prefix)) continue;
          const k = fullKey.slice(prefix.length);
          try {
            out[k] = JSON.parse(backingStore.getItem(fullKey));
          } catch {
            out[k] = backingStore.getItem(fullKey);
          }
        }
      } catch {}
      return out;
    }

    function readKey(k) {
      try {
        const raw = backingStore.getItem(prefix + k);
        if (raw === null) return undefined;
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    }

    return {
      get(keys, cb) {
        if (typeof keys === "function") {
          cb = keys;
          keys = null;
        }
        let result = {};
        if (keys === null || keys === undefined) {
          result = readAll();
        } else if (typeof keys === "string") {
          const val = readKey(keys);
          if (val !== undefined) result[keys] = val;
        } else if (Array.isArray(keys)) {
          for (const k of keys) {
            const val = readKey(k);
            if (val !== undefined) result[k] = val;
          }
        } else if (typeof keys === "object") {
          for (const [k, fallback] of Object.entries(keys)) {
            const val = readKey(k);
            result[k] = val !== undefined ? val : fallback;
          }
        }
        const p = Promise.resolve(result);
        if (typeof cb === "function") p.then((r) => cb(r));
        return p;
      },

      set(items, cb) {
        const changes = {};
        if (items && typeof items === "object") {
          for (const [k, newValue] of Object.entries(items)) {
            const oldValue = readKey(k);
            try {
              backingStore.setItem(prefix + k, JSON.stringify(newValue));
            } catch {}
            changes[k] = { oldValue, newValue };
          }
        }
        emitStorageChanges(changes, areaName, true);
        const p = Promise.resolve();
        if (typeof cb === "function") p.then(() => cb());
        return p;
      },

      remove(keys, cb) {
        const list = Array.isArray(keys) ? keys : [keys];
        const changes = {};
        for (const k of list) {
          const oldValue = readKey(k);
          if (oldValue !== undefined) {
            try {
              backingStore.removeItem(prefix + k);
            } catch {}
            changes[k] = { oldValue, newValue: undefined };
          }
        }
        emitStorageChanges(changes, areaName, true);
        const p = Promise.resolve();
        if (typeof cb === "function") p.then(() => cb());
        return p;
      },

      clear(cb) {
        const all = readAll();
        const changes = {};
        for (const [k, oldValue] of Object.entries(all)) {
          try {
            backingStore.removeItem(prefix + k);
          } catch {}
          changes[k] = { oldValue, newValue: undefined };
        }
        emitStorageChanges(changes, areaName, true);
        const p = Promise.resolve();
        if (typeof cb === "function") p.then(() => cb());
        return p;
      },
    };
  }

  function sanitizeShimFilename(filename, fallbackExt = "png") {
    const raw = String(filename || "")
      .replace(/\\/g, "/")
      .split("/")
      .pop()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const m = raw.match(/^(.*)\.([a-z0-9]{2,5})$/i);
    let stem = (m ? m[1] : raw).replace(/^[\s._-]+|[\s._-]+$/g, "").trim();
    const ext = (m ? m[2] : fallbackExt).toLowerCase() || "png";
    if (!stem) stem = "SwiftSelect-image";
    return `${stem.slice(0, 180)}.${ext}`;
  }

  function clickDownloadAnchor(href, safeFilename) {
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = href;
    a.download = safeFilename;
    a.setAttribute("download", safeFilename);
    a.rel = "noopener";
    (document.body || document.documentElement).appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 2000);
    return true;
  }

  function triggerBrowserDownload(url, filename) {
    try {
      const safeName = sanitizeShimFilename(filename, "png");
      if (typeof url === "string" && url.startsWith("data:")) {
        // Large data: URLs can lose their filename or fail in Chrome; convert to a same-origin blob: URL.
        fetch(url)
          .then((r) => r.blob())
          .then((blob) => {
            const blobUrl = URL.createObjectURL(blob);
            clickDownloadAnchor(blobUrl, safeName);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
          })
          .catch(() => clickDownloadAnchor(url, safeName));
        return true;
      }
      return clickDownloadAnchor(url, safeName);
    } catch {
      return false;
    }
  }

  async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return res.blob();
  }

  const chunkBuffers = new Map();

  async function saveDataUrlToGallery(dataUrl, meta = {}) {
    const blob = await dataUrlToBlob(dataUrl);
    const { addCapture } = await import("/src/storage.js");
    const rec = await addCapture({
      blob,
      title: meta.title || "",
      url: meta.url || location.href,
      type: meta.type || "screenshot",
      width: meta.width || 0,
      height: meta.height || 0,
    });
    return { success: true, id: rec.id };
  }

  async function handleMessage(message) {
    if (!message || typeof message !== "object") return { success: false, error: "Invalid message" };

    switch (message.type) {
      case "open-gallery":
        location.href = "gallery.html";
        return { success: true };

      case "open-settings":
        location.href = "gallery.html#settings";
        return { success: true };

      case "open-convert": {
        const ids = Array.isArray(message.ids) && message.ids.length ? `/${message.ids.join(",")}` : "";
        location.href = `gallery.html#convert${ids}`;
        return { success: true };
      }

      case "gallery-save":
        try {
          return await saveDataUrlToGallery(message.dataUrl, message.meta);
        } catch (err) {
          return { success: false, error: err?.message || "Gallery save failed" };
        }

      case "gallery-save-chunk": {
        const { key, index, total, chunk, meta } = message;
        if (!chunkBuffers.has(key)) chunkBuffers.set(key, new Array(total));
        const parts = chunkBuffers.get(key);
        parts[index] = chunk;
        if (index === total - 1) {
          chunkBuffers.delete(key);
          try {
            return await saveDataUrlToGallery(parts.join(""), meta);
          } catch (err) {
            return { success: false, error: err?.message || "Chunked gallery save failed" };
          }
        }
        return { success: true };
      }

      case "register-download-name":
        return { success: true, filename: sanitizeShimFilename(message.filename, "png") };

      case "download-file": {
        const ok = triggerBrowserDownload(message.url, message.filename || "SwiftSelect-screenshot.png");
        return { success: ok };
      }

      case "write-image-to-clipboard":
        try {
          const blob = await dataUrlToBlob(message.dataUrl);
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          return { success: true };
        } catch (err) {
          return { success: false, error: err?.message || "Clipboard unavailable" };
        }

      case "record-issue":
        try {
          const { recordIssue } = await import("/src/issues.js");
          await recordIssue(message.issue || {});
          return { success: true };
        } catch {
          return { success: false };
        }

      case "update-badge":
        return { success: true };

      case "run-capture":
        return {
          success: false,
          error: "no-target",
        };

      default:
        return { success: false, error: `Unsupported in web preview: ${message.type}` };
    }
  }

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");

  const chromeShim = {
    runtime: {
      id: "swiftselect-web-preview",
      lastError: null,
      getManifest() {
        return MANIFEST;
      },
      getURL(resourcePath) {
        const clean = String(resourcePath || "").replace(/^\/+/, "");
        return `${location.origin}/${clean}`;
      },
      connect({ name = "" } = {}) {
        return {
          name,
          postMessage() {},
          disconnect() {},
          onMessage: { addListener() {}, removeListener() {} },
          onDisconnect: { addListener() {}, removeListener() {} },
        };
      },
      onMessage: {
        addListener(fn) {
          if (typeof fn === "function") messageListeners.add(fn);
        },
        removeListener(fn) {
          messageListeners.delete(fn);
        },
      },
      sendMessage(message, cb) {
        const p = handleMessage(message).catch((err) => ({
          success: false,
          error: err?.message || "Message failed",
        }));
        if (typeof cb === "function") p.then((resp) => cb(resp));
        return p;
      },
    },

    storage: {
      local: createStorageArea("local", globalThis.localStorage),
      session: createStorageArea("session", globalThis.sessionStorage),
      onChanged: {
        addListener(fn) {
          if (typeof fn === "function") storageListeners.add(fn);
        },
        removeListener(fn) {
          storageListeners.delete(fn);
        },
      },
    },

    downloads: {
      download({ url, filename } = {}, cb) {
        const ok = triggerBrowserDownload(url, filename);
        const id = ok ? Date.now() : undefined;
        const p = Promise.resolve(id);
        if (typeof cb === "function") p.then((res) => cb(res));
        return p;
      },
    },

    commands: {
      getAll(cb) {
        const raw = MANIFEST.commands || {};
        const list = Object.entries(raw).map(([name, info]) => {
          const suggested = info?.suggested_key || {};
          let shortcut = isMac ? suggested.mac || suggested.default || "" : suggested.default || "";
          shortcut = shortcut.replace(/^MacCtrl\+/i, "Ctrl+");
          return {
            name,
            description: info?.description || "",
            shortcut,
          };
        });
        const p = Promise.resolve(list);
        if (typeof cb === "function") p.then((res) => cb(res));
        return p;
      },
    },

    tabs: {
      query(_queryInfo, cb) {
        const tabs = [
          {
            id: 1,
            windowId: 1,
            active: true,
            url: location.href,
            title: document.title || "SwiftSelect",
          },
        ];
        const p = Promise.resolve(tabs);
        if (typeof cb === "function") p.then((res) => cb(res));
        return p;
      },
      get(tabId, cb) {
        const tab = {
          id: tabId,
          windowId: 1,
          active: true,
          url: location.href,
          title: document.title || "SwiftSelect",
        };
        const p = Promise.resolve(tab);
        if (typeof cb === "function") p.then((res) => cb(res));
        return p;
      },
      create({ url = "" } = {}, cb) {
        if (url && !/^chrome:/i.test(url)) {
          location.href = url;
        }
        const tab = { id: 2, url };
        const p = Promise.resolve(tab);
        if (typeof cb === "function") p.then((res) => cb(res));
        return p;
      },
      sendMessage(_tabId, msg) {
        messageListeners.forEach((fn) => {
          try {
            fn(msg, { id: "swiftselect-web-preview" }, () => {});
          } catch {}
        });
        return Promise.resolve({ success: true });
      },
    },

    extension: {
      isAllowedFileSchemeAccess(cb) {
        const p = Promise.resolve(true);
        if (typeof cb === "function") p.then((res) => cb(res));
        return p;
      },
    },
  };

  globalThis.chrome = chromeShim;
})();
