/**
 * SwiftSelect service worker.
 *
 * Owns everything a content script cannot do for itself: privileged capture
 * calls, the offscreen document, native downloads, the gallery database and
 * the toolbar action. It keeps no long-lived state; anything that must
 * survive a worker restart lives in chrome.storage or IndexedDB.
 */
import { addCapture, applyRetention } from "./src/storage.js";
import { DEFAULTS, getSettings, normalizeTheme } from "./src/settings.js";

const QUICK_MENU = "popup.html";

// Toolbar click with no popup attached: go straight to region selection.
chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  const url = tab.url || "";
  if (isRestrictedUrl(url)) {
    openExtensionIconPopup("restricted");
    return;
  }
  injectAndStart(tab, "start-selection");
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "popup-lifecycle") {
    port.onDisconnect.addListener(() => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) updateTabBadge(tabs[0]);
      });
    });
  }
});

async function openExtensionIconPopup(view = "restricted") {
  try {
    await chrome.action.setPopup({ popup: `${QUICK_MENU}?view=${view}` });
    await chrome.action.openPopup();
  } catch (err) {
    console.warn("SwiftSelect: Could not open popup directly:", err);
    openExtensionPage("gallery.html", { hash: "#settings" });
  } finally {
    applyActionMode();
  }
}

/** Focus an already open extension page, or open it in a new tab. */
async function openExtensionPage(path, { hash = "", search = "" } = {}) {
  const base = chrome.runtime.getURL(path);
  const target = `${base}${search}${hash}`;
  try {
    const tabs = await chrome.tabs.query({ url: `${base}*` });
    const existing = tabs.find((t) => t.id);
    if (existing && !search) {
      await chrome.tabs.update(existing.id, { active: true, ...(hash ? { url: target } : {}) });
      if (typeof existing.windowId === "number") {
        chrome.windows?.update?.(existing.windowId, { focused: true }).catch?.(() => {});
      }
      return existing;
    }
  } catch {}
  return chrome.tabs.create({ url: target });
}

// ─── Toolbar action mode ─────────────────────────────────────────────
// "menu": the icon opens the quick-action popup.
// "region": the icon starts region selection in one click (no popup).

let _actionClick = DEFAULTS.actionClick;

function defaultPopup() {
  return _actionClick === "menu" ? QUICK_MENU : "";
}

async function applyActionMode() {
  const settings = await getSettings();
  _actionClick = settings.actionClick;
  await chrome.action.setPopup({ popup: defaultPopup() }).catch(() => {});
  initAllTabs();
}

// ─── Last capturable tab ─────────────────────────────────────────────
// The gallery and settings pages can start a capture, but they are not
// capturable themselves. Remember the last normal web tab per window so the
// capture has somewhere to go.

function rememberTab(tab) {
  if (!tab?.id || isRestrictedUrl(tab.url || "")) return;
  chrome.storage.session
    ?.set({ [`lastTab:${tab.windowId}`]: tab.id, lastTab: tab.id })
    .catch(() => {});
}

async function findCaptureTarget(sender, explicitTabId) {
  const usable = async (id) => {
    if (typeof id !== "number") return null;
    try {
      const tab = await chrome.tabs.get(id);
      return tab && !isRestrictedUrl(tab.url || "") ? tab : null;
    } catch {
      return null;
    }
  };

  let tab = await usable(explicitTabId);
  if (tab) return tab;

  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  tab = await usable(active?.id);
  if (tab) return tab;

  const windowId = sender?.tab?.windowId ?? active?.windowId;
  const stored = (await chrome.storage.session?.get([`lastTab:${windowId}`, "lastTab"])) || {};
  return (await usable(stored[`lastTab:${windowId}`])) || (await usable(stored.lastTab));
}

const CAPTURE_MODES = {
  region: "start-selection",
  visible: "capture-visible",
  full: "capture-full",
  horizontal: "capture-horizontal",
  timer: "capture-timer",
};

function handleCommand(command, tab) {
  if (!tab?.id) return;
  if (command === "activate-selection") {
    injectAndStart(tab, "start-selection");
  } else if (command === "capture-visible-download") {
    injectAndStart(tab, "capture-visible");
  } else if (command === "capture-horizontal") {
    injectAndStart(tab, "capture-horizontal");
  } else if (command === "capture-full-page") {
    injectAndStart(tab, "capture-full");
  } else if (command === "capture-timer") {
    injectAndStart(tab, "capture-timer");
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (tab?.id) {
    handleCommand(command, tab);
  } else {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) handleCommand(command, tabs[0]);
    });
  }
});

function isRestrictedUrl(url) {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("view-source:") ||
    url.startsWith("devtools://") ||
    url.startsWith("https://chrome.google.com/webstore") ||
    url.startsWith("https://chromewebstore.google.com")
  );
}

function updateTabBadge(tab) {
  if (!tab || !tab.id) return;
  const tabId = tab.id;
  const url = tab.url || "";

  if (isRestrictedUrl(url)) {
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
    chrome.action.setTitle({
      tabId,
      title: "SwiftSelect - Browser Protected Page (Click for Info & Settings)",
    }).catch(() => {});
    chrome.action.setPopup({ tabId, popup: `${QUICK_MENU}?view=restricted` }).catch(() => {});
    return;
  }

  if (url.startsWith("file://")) {
    chrome.extension.isAllowedFileSchemeAccess((isAllowed) => {
      if (chrome.runtime.lastError) return;
      if (!isAllowed) {
        chrome.action.setBadgeText({ tabId, text: "FILE" }).catch(() => {});
        chrome.action.setBadgeBackgroundColor({ tabId, color: "#FBBC04" }).catch(() => {});
        chrome.action.setTitle({
          tabId,
          title: "File URL access required. Enable in extension settings.",
        }).catch(() => {});
        chrome.action.setPopup({ tabId, popup: `${QUICK_MENU}?view=file-access` }).catch(() => {});
      } else {
        chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
        chrome.action.setTitle({ tabId, title: "SwiftSelect (Click to Capture)" }).catch(() => {});
        chrome.action.setPopup({ tabId, popup: defaultPopup() }).catch(() => {});
      }
    });
    return;
  }

  chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  chrome.action.setTitle({ tabId, title: "SwiftSelect (Click to Capture)" }).catch(() => {});
  chrome.action.setPopup({ tabId, popup: defaultPopup() }).catch(() => {});
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (!chrome.runtime.lastError && tab) {
      updateTabBadge(tab);
      rememberTab(tab);
    }
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab?.id) updateTabBadge(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab) {
    updateTabBadge(tab);
    if (tab.active && changeInfo.status === "complete") rememberTab(tab);
  }
});

function initAllTabs() {
  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime.lastError || !tabs) return;
    for (const tab of tabs) {
      if (tab?.id) updateTabBadge(tab);
    }
  });
}

// One-time settings migration from the 1.x schema.
async function migrateSettings() {
  const data = await chrome.storage.local.get(["userTheme", "settingsSchema", "retentionDays"]);
  const schema = data.settingsSchema || 1;
  if (schema >= 4) return;
  const patch = { settingsSchema: 4 };
  if (schema < 2) {
    const theme = normalizeTheme(data.userTheme);
    // "standard" was the flat legacy palette. 2.x is Liquid Glass throughout.
    patch.userTheme = theme === "standard" ? "system" : theme;
  }
  if (schema < 3) {
    // 2.1: one-click region capture is the default toolbar behaviour, and
    // single-key shortcuts are opt-in.
    patch.actionClick = "region";
    patch.toolbarShortcuts = false;
    patch.editorShortcuts = false;
  }
  // 2.2: captures older than three months move to Trash by default.
  if (!Number(data.retentionDays)) patch.retentionDays = 90;
  await chrome.storage.local.set(patch);
}

// Gallery retention: runs at start-up, after every capture and when the
// retention settings change. Cheap: a single cursor pass, no image decoding.
let _retentionTimer = null;
function scheduleRetention(delay = 1500) {
  clearTimeout(_retentionTimer);
  _retentionTimer = setTimeout(async () => {
    try {
      await applyRetention(await getSettings());
    } catch (err) {
      console.debug("SwiftSelect: retention skipped", err);
    }
  }, delay);
}

chrome.runtime.onStartup.addListener(() => {
  applyActionMode();
  scheduleRetention();
});
chrome.runtime.onInstalled.addListener(async () => {
  await migrateSettings().catch(() => {});
  applyActionMode();
  scheduleRetention();
});
applyActionMode();

async function injectAndStart(tab, messageType) {
  try {
    const url = tab.url || "";
    if (isRestrictedUrl(url)) {
      console.warn("SwiftSelect cannot run on this page:", url);
      return;
    }

    if (url.startsWith("file://")) {
      const isAllowed = await new Promise((resolve) =>
        chrome.extension.isAllowedFileSchemeAccess(resolve),
      );
      if (!isAllowed) {
        console.warn("SwiftSelect needs file URL access for:", url);
        chrome.action.setBadgeText({ tabId: tab.id, text: "FILE" });
        chrome.action.setBadgeBackgroundColor({
          tabId: tab.id,
          color: "#FBBC04",
        });
        return;
      }
    }

    const tabId = tab.id;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["contentScript.js"],
    });

    chrome.tabs.sendMessage(tabId, { type: messageType }, () => {
      if (chrome.runtime.lastError) {
        console.warn(
          `sendMessage (${messageType}) warning:`,
          chrome.runtime.lastError.message,
        );
      }
    });
  } catch (err) {
    if (err.message.includes("extensions gallery cannot be scripted")) {
      console.warn("Cannot run on extension gallery page.");
    } else {
      console.error("injectAndStart error:", err);
    }
  }
}

// ─── Offscreen Document Management ───────────────────────────────────

let offscreenCreating = null;

async function ensureOffscreen() {
  const existing = await chrome.offscreen.hasDocument();
  if (existing) return;

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA", "CLIPBOARD"],
    justification:
      "Tab capture for full page screenshot and clipboard write support",
  });

  await offscreenCreating;
  offscreenCreating = null;
}

let offscreenIdleTimer = null;

function scheduleCloseOffscreen(delayMs = 30000) {
  if (offscreenIdleTimer) clearTimeout(offscreenIdleTimer);
  offscreenIdleTimer = setTimeout(() => {
    closeOffscreen();
    offscreenIdleTimer = null;
  }, delayMs);
}

async function closeOffscreen() {
  if (offscreenIdleTimer) {
    clearTimeout(offscreenIdleTimer);
    offscreenIdleTimer = null;
  }
  try {
    const existing = await chrome.offscreen.hasDocument();
    if (existing) {
      await chrome.offscreen.closeDocument();
    }
  } catch (e) {
    // ignore
  }
}

// ─── Gallery ingest ──────────────────────────────────────────────────

const pendingChunks = new Map();

async function storeCapture(dataUrl, meta = {}, sender) {
  try {
    if (!dataUrl) throw new Error("No image data");
    const blob = await (await fetch(dataUrl)).blob();
    const record = await addCapture({
      blob,
      title: meta.title || sender?.tab?.title || "",
      url: meta.url || sender?.tab?.url || "",
      type: meta.type || "screenshot",
      width: meta.width || 0,
      height: meta.height || 0,
    });
    scheduleRetention(4000);
    return { success: true, id: record.id };
  } catch (err) {
    console.warn("SwiftSelect: gallery save failed:", err);
    return { success: false, error: err?.message || "Gallery save failed" };
  }
}

// ─── Message Handler ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // --- Gallery: store a capture handed over by a content script or page ---
  if (message?.type === "gallery-save") {
    storeCapture(message.dataUrl, message.meta, sender).then(sendResponse);
    return true;
  }

  // --- Gallery: large captures arrive in ordered chunks ---
  if (message?.type === "gallery-save-chunk") {
    const { key, index, total, chunk, meta } = message;
    let parts = pendingChunks.get(key);
    if (!parts) {
      parts = new Array(total);
      pendingChunks.set(key, parts);
      // Abandoned transfers must not pin memory.
      setTimeout(() => pendingChunks.delete(key), 120000);
    }
    parts[index] = chunk;
    if (index < total - 1) {
      sendResponse({ success: true });
      return false;
    }
    pendingChunks.delete(key);
    if (parts.includes(undefined)) {
      sendResponse({ success: false, error: "Incomplete transfer" });
      return false;
    }
    storeCapture(parts.join(""), meta, sender).then(sendResponse);
    return true;
  }

  // --- Navigation to the full-tab pages ---
  if (message?.type === "open-gallery") {
    openExtensionPage("gallery.html", { hash: "#all" });
    sendResponse?.({ success: true });
    return false;
  }
  if (message?.type === "open-settings") {
    openExtensionPage("gallery.html", { hash: `#settings${message.hash ? `/${message.hash.replace(/^#/, "")}` : ""}` });
    sendResponse?.({ success: true });
    return false;
  }
  if (message?.type === "open-annotate") {
    chrome.tabs.create({ url: chrome.runtime.getURL(`annotate.html?id=${encodeURIComponent(message.id)}`) });
    sendResponse?.({ success: true });
    return false;
  }

  // --- Capture requested by the popup, gallery or settings page ---
  if (message?.type === "run-capture") {
    (async () => {
      const messageType = CAPTURE_MODES[message.mode];
      if (!messageType) return sendResponse({ success: false, error: "Unknown capture mode" });
      const tab = await findCaptureTarget(sender, message.tabId);
      if (!tab) return sendResponse({ success: false, error: "no-target" });
      // Answer first: the popup closes on this reply, which hands focus back
      // to the page so the clipboard write succeeds there.
      sendResponse({ success: true, tabId: tab.id });
      if (!tab.active) {
        await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
      }
      // Let the popup close and the tab paint before it is captured.
      await new Promise((r) => setTimeout(r, 180));
      await injectAndStart(tab, messageType);
    })();
    return true;
  }

  // --- Legacy: capture-visible-tab (used for region capture) ---
  if (message?.type === "capture-visible-tab") {
    const tab = sender?.tab;
    const windowId = tab?.windowId;

    const cb = (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          success: false,
          error: chrome.runtime.lastError.message,
        });
      } else if (!dataUrl) {
        sendResponse({
          success: false,
          error: "No dataUrl returned from captureVisibleTab",
        });
      } else {
        sendResponse({ success: true, dataUrl });
      }
    };

    try {
      if (typeof windowId === "number") {
        chrome.tabs.captureVisibleTab(windowId, { format: "png" }, cb);
      } else {
        chrome.tabs.captureVisibleTab({ format: "png" }, cb);
      }
    } catch (err) {
      sendResponse({
        success: false,
        error: err?.message || "captureVisibleTab failed",
      });
    }
    return true;
  }

  // --- Clipboard write fallback for content scripts that lose focus ---
  if (message?.type === "write-image-to-clipboard") {
    (async () => {
      try {
        if (offscreenIdleTimer) clearTimeout(offscreenIdleTimer);
        await ensureOffscreen();
        const result = await chrome.runtime.sendMessage({
          type: "write-image-clipboard",
          dataUrl: message.dataUrl,
        });
        sendResponse(result);
      } catch (err) {
        console.error("write-image-to-clipboard error:", err);
        sendResponse({ success: false, error: err.message });
      } finally {
        scheduleCloseOffscreen(30000);
      }
    })();

    return true;
  }

  // --- New: Start full page capture via offscreen document ---
  if (message?.type === "start-fullpage-capture") {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: "No tab ID" });
      return true;
    }

    (async () => {
      try {
        // 1. Get a media stream ID for this tab
        const streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: tabId,
        });

        // 2. Ensure offscreen document is open
        await ensureOffscreen();

        // 3. Send capture request to offscreen document
        const result = await chrome.runtime.sendMessage({
          type: "start-offscreen-capture",
          streamId,
          tabId,
          mode: message.mode || "full",
          frameInterval: message.frameInterval || 60,
          format: message.format || "image/jpeg",
          quality: message.quality !== undefined ? message.quality : 0.98,
        });

        sendResponse(result);
      } catch (err) {
        console.error("start-fullpage-capture error:", err);
        sendResponse({ success: false, error: err.message });
      } finally {
        // 4. Close offscreen document cleanly after inactivity
        scheduleCloseOffscreen(30000);
      }
    })();

    return true; // async response
  }

  // --- Fetch blob URL fallback (handles CSP restrictions in web pages) ---
  if (message?.type === "fetch-blob-url") {
    fetch(message.blobUrl)
      .then((r) => r.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onload = () => sendResponse({ success: true, dataUrl: reader.result });
        reader.onerror = () => sendResponse({ success: false, error: "FileReader failed" });
        reader.readAsDataURL(blob);
      })
      .catch((err) => {
        sendResponse({ success: false, error: err?.message });
      });
    return true;
  }

  // --- Native download via chrome.downloads (bypasses file:// and CSP restrictions) ---
  if (message?.type === "download-file") {
    const { url, filename } = message;
    if (chrome.downloads?.download) {
      chrome.downloads.download(
        {
          url,
          filename,
          saveAs: false,
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            console.warn(
              "SwiftSelect: chrome.downloads error:",
              chrome.runtime.lastError.message,
            );
            sendResponse({
              success: false,
              error: chrome.runtime.lastError.message,
            });
          } else {
            sendResponse({ success: true, downloadId });
          }
        },
      );
      return true; // async response
    } else {
      sendResponse({ success: false, error: "chrome.downloads not available" });
      return false;
    }
  }

  // --- Relay: offscreen → content script ---
  if (message?.type === "offscreen-to-content") {
    const { tabId, action, data } = message;
    chrome.tabs.sendMessage(
      tabId,
      { type: "fullpage-action", action, data },
      (response) => {
        if (chrome.runtime.lastError) {
          sendResponse(null);
        } else {
          sendResponse(response);
        }
      },
    );
    return true;
  }

  // --- Relay: progress from offscreen → content script ---
  if (message?.type === "offscreen-progress") {
    const { tabId, progress, current, total } = message;
    if (tabId) {
      try {
        chrome.tabs.sendMessage(tabId, {
          type: "fullpage-progress",
          progress,
          current,
          total,
        }).catch(() => {});
      } catch (e) {}
    }
    // No response needed
    return false;
  }

  // --- Badge updates ---
  if (message?.type === "update-badge") {
    const tabId = sender.tab?.id;
    const text = message.text || "";
    const color =
      message.color ||
      (text === "✓" ? "#10B981" : text === "ERR" ? "#EF4444" : "#BA4B5C");

    try {
      if (chrome.action.setBadgeTextColor) {
        if (tabId) {
          chrome.action.setBadgeTextColor({ tabId, color: "#FFFFFF" }).catch(() => {});
        } else {
          chrome.action.setBadgeTextColor({ color: "#FFFFFF" }).catch(() => {});
        }
      }
    } catch (e) {
      // ignore
    }

    if (tabId) {
      chrome.action.setBadgeText({ tabId, text }).catch(() => {});
      if (color && text) {
        chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
      }
    } else {
      chrome.action.setBadgeText({ text }).catch(() => {});
      if (color && text) {
        chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
      }
    }
  }

  // --- Restore normal action state when popup closes ---
  if (message?.type === "restore-tab-action") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) updateTabBadge(tabs[0]);
    });
    return false;
  }
});

// --- Context Menus ---
let isSettingUpMenus = false;

function safeCreateMenu(properties) {
  try {
    chrome.contextMenus.create(properties, () => {
      if (chrome.runtime.lastError) {
        // Safely consume lastError to prevent uncaught runtime warnings
      }
    });
  } catch (e) {
    // ignore
  }
}

function setupContextMenus() {
  if (!chrome.contextMenus || isSettingUpMenus) return;
  isSettingUpMenus = true;

  chrome.storage.local.get(
    ["userTheme", "outputFormat", "outputDestination"],
    (data) => {
      const currentTheme = normalizeTheme(data?.userTheme);
      const currentFormat = ["png", "jpg", "webp"].includes(data?.outputFormat) ? data.outputFormat : "jpg";
      const currentDest = data?.outputDestination || "both";

      chrome.contextMenus.removeAll(() => {
        if (chrome.runtime.lastError) {
          // ignore
        }

        safeCreateMenu({
          id: "ss-select-area",
          title: "Select Area (Alt+X)",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-capture-visible",
          title: "Capture Visible Area (Alt+S)",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-capture-timer",
          title: "3-Second Delayed Capture (Alt+T)",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-capture-horizontal",
          title: "Capture Horizontal View (Alt+H)",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-capture-full",
          title: "Capture Full Page (Alt+F)",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-sep-1",
          type: "separator",
          contexts: ["action", "page"],
        });

        // Output Format Menu
        safeCreateMenu({
          id: "ss-format-parent",
          title: "Export Format",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-format-jpg",
          parentId: "ss-format-parent",
          title: "JPG (Small file size)",
          type: "radio",
          checked: currentFormat === "jpg",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-format-png",
          parentId: "ss-format-parent",
          title: "PNG (Lossless sharpness)",
          type: "radio",
          checked: currentFormat === "png",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-format-webp",
          parentId: "ss-format-parent",
          title: "WebP (Smallest)",
          type: "radio",
          checked: currentFormat === "webp",
          contexts: ["action", "page"],
        });

        // Capture Destination Menu
        safeCreateMenu({
          id: "ss-dest-parent",
          title: "Capture Destination",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-dest-both",
          parentId: "ss-dest-parent",
          title: "Copy & Save (Both)",
          type: "radio",
          checked: currentDest === "both",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-dest-clipboard",
          parentId: "ss-dest-parent",
          title: "Copy to Clipboard Only",
          type: "radio",
          checked: currentDest === "clipboard",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-dest-download",
          parentId: "ss-dest-parent",
          title: "Save / Download Only",
          type: "radio",
          checked: currentDest === "download",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-dest-none",
          parentId: "ss-dest-parent",
          title: "Gallery Only",
          type: "radio",
          checked: currentDest === "none",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-sep-theme",
          type: "separator",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-theme-parent",
          title: "Theme",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-theme-system",
          parentId: "ss-theme-parent",
          title: "System",
          type: "radio",
          checked: currentTheme === "system",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-theme-light",
          parentId: "ss-theme-parent",
          title: "Light",
          type: "radio",
          checked: currentTheme === "light",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-theme-dark",
          parentId: "ss-theme-parent",
          title: "Dark",
          type: "radio",
          checked: currentTheme === "dark",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-sep-2",
          type: "separator",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-gallery",
          title: "Open Gallery",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-help",
          title: "Keyboard Shortcuts & Guide...",
          contexts: ["action", "page"],
        });

        safeCreateMenu({
          id: "ss-options",
          title: "Settings",
          contexts: ["action", "page"],
        });

        isSettingUpMenus = false;
      });
    },
  );
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
});

// Run immediately on background service worker wake-up
setupContextMenus();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const check = (id, checked) => chrome.contextMenus.update(id, { checked }).catch(() => {});

  if (changes.userTheme) {
    const theme = normalizeTheme(changes.userTheme.newValue);
    ["system", "light", "dark"].forEach((t) => check(`ss-theme-${t}`, t === theme));
  }
  if (changes.outputFormat) {
    ["jpg", "png", "webp"].forEach((f) => check(`ss-format-${f}`, f === changes.outputFormat.newValue));
  }
  if (changes.outputDestination) {
    ["both", "clipboard", "download", "none"].forEach((d) =>
      check(`ss-dest-${d}`, d === changes.outputDestination.newValue),
    );
  }
  if (changes.actionClick) applyActionMode();
  if (changes.retentionDays || changes.trashDays) scheduleRetention(300);
});

function handleContextMenuClick(info, tab) {
  const { menuItemId } = info;
  if (!tab) return;

  if (menuItemId === "ss-select-area") {
    injectAndStart(tab, "start-selection");
  } else if (menuItemId === "ss-capture-visible") {
    injectAndStart(tab, "capture-visible");
  } else if (menuItemId === "ss-capture-timer") {
    injectAndStart(tab, "capture-timer");
  } else if (menuItemId === "ss-capture-horizontal") {
    injectAndStart(tab, "capture-horizontal");
  } else if (menuItemId === "ss-capture-full") {
    injectAndStart(tab, "capture-full");
  } else if (menuItemId === "ss-format-jpg") {
    chrome.storage.local.set({ outputFormat: "jpg" });
  } else if (menuItemId === "ss-format-png") {
    chrome.storage.local.set({ outputFormat: "png" });
  } else if (menuItemId === "ss-format-webp") {
    chrome.storage.local.set({ outputFormat: "webp" });
  } else if (menuItemId === "ss-dest-both") {
    chrome.storage.local.set({ outputDestination: "both" });
  } else if (menuItemId === "ss-dest-clipboard") {
    chrome.storage.local.set({ outputDestination: "clipboard" });
  } else if (menuItemId === "ss-dest-download") {
    chrome.storage.local.set({ outputDestination: "download" });
  } else if (menuItemId === "ss-dest-none") {
    chrome.storage.local.set({ outputDestination: "none" });
  } else if (menuItemId === "ss-gallery") {
    openExtensionPage("gallery.html");
  } else if (menuItemId.startsWith("ss-theme-")) {
    const themeName = menuItemId.replace("ss-theme-", "");
    chrome.storage.local.set({ userTheme: themeName }, () => {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((t) => {
          chrome.tabs
            .sendMessage(t.id, {
              type: "apply-theme",
              theme: themeName,
            })
            .catch(() => {});
        });
      });
    });
  } else if (menuItemId === "ss-options" || menuItemId === "ss-settings") {
    openExtensionPage("gallery.html", { hash: "#settings" });
  } else if (menuItemId === "ss-help" || menuItemId === "ss-shortcuts") {
    openExtensionPage("gallery.html", { hash: "#settings/shortcuts" });
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) handleContextMenuClick(info, tabs[0]);
    });
    return;
  }
  handleContextMenuClick(info, tab);
});
