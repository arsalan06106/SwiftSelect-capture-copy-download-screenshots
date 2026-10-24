/**
 * main content script entry point
 */

if (!window.__swiftSelectInjected_v2) {
  window.SwiftSelect = window.SwiftSelect || {};
  window.__swiftSelectInjected_v2 = true;

  let modulesPromise = null;

  function getModules() {
    if (!modulesPromise) {
      modulesPromise = Promise.all([
        import(chrome.runtime.getURL("src/theme.js")),
        import(chrome.runtime.getURL("src/ui.js")),
        import(chrome.runtime.getURL("src/events.js")),
        import(chrome.runtime.getURL("src/capture/region.js")),
        import(chrome.runtime.getURL("src/capture/fullpage.js")),
      ]).then(([theme, ui, events, region, fullpage]) => {
        window.SwiftSelect.theme = theme;
        window.SwiftSelect.ui = ui;
        window.SwiftSelect.events = events;
        window.SwiftSelect.capture = { ...region, ...fullpage };
        theme.init();
        return { theme, ui, events, region, fullpage };
      }).catch((err) => {
        modulesPromise = null;
        throw err;
      });
    }
    return modulesPromise;
  }

  // Pre-load modules immediately
  getModules().catch((err) =>
    console.error("SwiftSelect module load error:", err),
  );

  // Synchronous listener registration so zero messages are dropped
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    getModules().then(({ theme, ui, events, region, fullpage }) => {
      if (message.type === "start-selection") {
        if (document.getElementById("swiftselect-annotate-root")) {
          sendResponse({ success: true });
          return;
        }
        ui.ensureUi();
        events.addListeners();
        sendResponse({ success: true });
      } else if (
        message.type === "capture-visible" ||
        message.type === "capture-download"
      ) {
        region.handleCaptureVisible();
        sendResponse({ success: true });
      } else if (message.type === "capture-timer") {
        region.handleTimedCapture(3);
        sendResponse({ success: true });
      } else if (message.type === "capture-horizontal") {
        fullpage.handleCaptureHorizontal();
        sendResponse({ success: true });
      } else if (message.type === "capture-full") {
        fullpage.handleCaptureFullPage();
        sendResponse({ success: true });
      } else if (message.type === "show-help-modal") {
        ui.showShortcutsHelpModal();
        sendResponse({ success: true });
      } else if (message.type === "show-settings-modal") {
        ui.showSettingsModal();
        sendResponse({ success: true });
      } else if (message.type === "fullpage-progress") {
        const ps = ui.guideShadow?.querySelector(".qs-progress-text");
        const isDone = message.progress >= 100;
        chrome.runtime.sendMessage({
          type: "update-badge",
          text: isDone ? "✓" : `${message.progress}%`,
          color: isDone ? "#10B981" : "#BA4B5C",
        });
        sendResponse({ success: true });
      } else if (message.type === "fullpage-action") {
        const { action, data } = message;
        if (action === "unroll-page") {
          sendResponse(fullpage.handleUnrollPage(data));
        } else if (action === "update-unroll") {
          sendResponse(
            fullpage.handleUpdateUnroll(data.scrollTop, data.scrollLeft),
          );
        } else if (action === "restore-unroll") {
          fullpage.handleRestoreUnroll();
          sendResponse({ success: true });
        }
      }
    }).catch((err) => {
      sendResponse({ success: false, error: err?.message });
    });

    return true; // Keep channel open for async response
  });
}
