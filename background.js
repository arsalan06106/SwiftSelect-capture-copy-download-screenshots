// background.js - Full page capture with tab capture stream + offscreen document

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  injectAndStart(tab, "start-selection");
});

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
    // Keep badge clean (no red sign), allow popup to inform user on click
    chrome.action.setBadgeText({ tabId, text: "" });
    chrome.action.setTitle({
      tabId,
      title: "SwiftSelect cannot run on Chrome system or Web Store pages.",
    });
    chrome.action.setPopup({ tabId, popup: "popup.html" });
    return;
  }

  if (url.startsWith("file://")) {
    chrome.extension.isAllowedFileSchemeAccess((isAllowed) => {
      if (chrome.runtime.lastError) return;
      if (!isAllowed) {
        chrome.action.setBadgeText({ tabId, text: "FILE" });
        chrome.action.setBadgeBackgroundColor({ tabId, color: "#FBBC04" });
        chrome.action.setTitle({
          tabId,
          title: "File URL access required. Click icon for settings.",
        });
        chrome.action.setPopup({ tabId, popup: "popup.html" });
      } else {
        chrome.action.setBadgeText({ tabId, text: "" });
        chrome.action.setTitle({ tabId, title: "SwiftSelect" });
        chrome.action.setPopup({ tabId, popup: "" });
      }
    });
    return;
  }

  chrome.action.setBadgeText({ tabId, text: "" });
  chrome.action.setTitle({ tabId, title: "SwiftSelect" });
  chrome.action.setPopup({ tabId, popup: "" });
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (!chrome.runtime.lastError && tab) {
      updateTabBadge(tab);
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    updateTabBadge(tab);
  }
});

// Initialize badge for current active tab on load
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) updateTabBadge(tabs[0]);
});

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

async function closeOffscreen() {
  try {
    const existing = await chrome.offscreen.hasDocument();
    if (existing) {
      await chrome.offscreen.closeDocument();
    }
  } catch (e) {
    // ignore
  }
}

// ─── Message Handler ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // --- Legacy: capture-visible-tab (used for region capture) ---
  if (message?.type === "capture-visible-tab") {
    const tab = sender.tab;
    if (!tab) {
      sendResponse({ success: false, error: "No tab info" });
      return true;
    }
    if (!tab.active) {
      sendResponse({ success: false, error: "Tab is no longer active" });
      return true;
    }

    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          success: false,
          error: chrome.runtime.lastError.message,
        });
      } else {
        sendResponse({ success: true, dataUrl });
      }
    });
    return true;
  }

  // --- Clipboard write fallback for content scripts that lose focus ---
  if (message?.type === "write-image-to-clipboard") {
    (async () => {
      try {
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
        await closeOffscreen();
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
          frameInterval: message.frameInterval || 150,
          format: message.format || "image/jpeg",
          quality: message.quality || 0.92,
        });

        sendResponse(result);
      } catch (err) {
        console.error("start-fullpage-capture error:", err);
        sendResponse({ success: false, error: err.message });
      } finally {
        // 4. Always close offscreen document
        await closeOffscreen();
      }
    })();

    return true; // async response
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
    chrome.tabs.sendMessage(tabId, {
      type: "fullpage-progress",
      progress,
      current,
      total,
    });
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
          chrome.action.setBadgeTextColor({ tabId, color: "#FFFFFF" });
        } else {
          chrome.action.setBadgeTextColor({ color: "#FFFFFF" });
        }
      }
    } catch (e) {
      // ignore
    }

    if (tabId) {
      chrome.action.setBadgeText({ tabId, text });
      if (color && text) {
        chrome.action.setBadgeBackgroundColor({ tabId, color });
      }
    } else {
      chrome.action.setBadgeText({ text });
      if (color && text) {
        chrome.action.setBadgeBackgroundColor({ color });
      }
    }
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

  chrome.storage.local.get(["userTheme"], (data) => {
    const currentTheme = data?.userTheme || "glass";

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

      safeCreateMenu({
        id: "ss-theme-parent",
        title: "Theme",
        contexts: ["action", "page"],
      });

      safeCreateMenu({
        id: "ss-theme-glass",
        parentId: "ss-theme-parent",
        title: "Liquid Glass (Modern)",
        type: "radio",
        checked: currentTheme === "glass",
        contexts: ["action", "page"],
      });

      safeCreateMenu({
        id: "ss-theme-standard",
        parentId: "ss-theme-parent",
        title: "Standard Minimal",
        type: "radio",
        checked: currentTheme === "standard",
        contexts: ["action", "page"],
      });

      safeCreateMenu({
        id: "ss-theme-light",
        parentId: "ss-theme-parent",
        title: "Always Light",
        type: "radio",
        checked: currentTheme === "light",
        contexts: ["action", "page"],
      });

      safeCreateMenu({
        id: "ss-theme-dark",
        parentId: "ss-theme-parent",
        title: "Always Dark",
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
        id: "ss-shortcuts",
        title: "Keyboard Shortcuts...",
        contexts: ["action", "page"],
      });

      isSettingUpMenus = false;
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.userTheme) {
    const newTheme = changes.userTheme.newValue;
    const itemIds = [
      "ss-theme-glass",
      "ss-theme-standard",
      "ss-theme-light",
      "ss-theme-dark",
    ];
    itemIds.forEach((id) => {
      const match = id === `ss-theme-${newTheme}`;
      chrome.contextMenus.update(id, { checked: match }).catch(() => {});
    });
  }
});

function handleContextMenuClick(info, tab) {
  const { menuItemId } = info;
  if (!tab) return;

  if (menuItemId === "ss-select-area") {
    injectAndStart(tab, "start-selection");
  } else if (menuItemId === "ss-capture-visible") {
    injectAndStart(tab, "capture-visible");
  } else if (menuItemId === "ss-capture-horizontal") {
    injectAndStart(tab, "capture-horizontal");
  } else if (menuItemId === "ss-capture-full") {
    injectAndStart(tab, "capture-full");
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
  } else if (menuItemId === "ss-shortcuts") {
    chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
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
