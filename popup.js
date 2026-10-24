document.addEventListener("DOMContentLoaded", () => {
  const noticeView = document.getElementById("notice-view");
  const noticeGlow = document.getElementById("notice-glow");
  const noticeIcon = document.getElementById("notice-icon");
  const noticeTitle = document.getElementById("notice-title");
  const noticeDesc = document.getElementById("notice-desc");
  const noticeBadge = document.getElementById("notice-badge");
  const noticeTip = document.getElementById("notice-tip");
  const noticeTipText = document.getElementById("notice-tip-text");
  const noticeActionBtn = document.getElementById("notice-action-btn");
  const noticeActionText = document.getElementById("notice-action-text");
  const noticeCloseBtn = document.getElementById("notice-close-btn");
  const noticeFooterText = document.getElementById("notice-footer-text");
  const noticePrefs = document.getElementById("notice-prefs");
  const noticeShortcuts = document.getElementById("notice-shortcuts");
  const noticeQuickActions = document.getElementById("notice-quick-actions");
  const btnQuickVisible = document.getElementById("btn-quick-visible");
  const btnQuickFull = document.getElementById("btn-quick-full");

  function applyThemeMode(theme) {
    const activeTheme = theme || "light";
    document.documentElement.setAttribute("data-theme", activeTheme);
    // Light is default for menus; dark is active only when explicitly selected
    const isDark = activeTheme === "dark";
    document.body.classList.add("qs-theme-glass");
    if (isDark) {
      document.body.classList.add("dark-theme", "qs-theme-glass-dark");
      document.body.classList.remove("light-theme");
    } else {
      document.body.classList.add("light-theme");
      document.body.classList.remove("dark-theme", "qs-theme-glass-dark");
    }
  }

  // Pre-seed theme: default to light liquid glass for these menus
  document.body.classList.add("qs-theme-glass", "light-theme");
  document.body.classList.remove("dark-theme", "qs-theme-glass-dark");

  // Sync theme preference from storage (defaults to light for these menus)
  chrome.storage.local.get(["userTheme", "outputFormat", "outputDestination"], (data) => {
    const theme = data?.userTheme || "light";
    applyThemeMode(theme);

    // Set active states on preference toggles
    const activeFormat = data?.outputFormat || "jpg";
    const activeDest = data?.outputDestination || "both";
    const activeTheme = theme;

    document.querySelectorAll("#pref-format-toggle .qs-toggle-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.format === activeFormat);
    });

    document.querySelectorAll("#pref-dest-toggle .qs-toggle-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.dest === activeDest);
    });

    document.querySelectorAll("#pref-theme-toggle .qs-toggle-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.theme === activeTheme);
    });
  });

  // Keep in real-time sync with storage changes across tabs/windows
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.userTheme) {
        const newTheme = changes.userTheme.newValue || "glass";
        applyThemeMode(newTheme);
        document.querySelectorAll("#pref-theme-toggle .qs-toggle-btn").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.theme === newTheme);
        });
      }
      if (changes.outputFormat) {
        const newFormat = changes.outputFormat.newValue || "jpg";
        document.querySelectorAll("#pref-format-toggle .qs-toggle-btn").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.format === newFormat);
        });
      }
      if (changes.outputDestination) {
        const newDest = changes.outputDestination.newValue || "both";
        document.querySelectorAll("#pref-dest-toggle .qs-toggle-btn").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.dest === newDest);
        });
      }
    });
  }

  function flashSavedBadge() {
    const textEl = document.getElementById("sync-pill-text");
    const dotEl = document.querySelector(".qs-sync-dot");
    if (!textEl) return;
    textEl.textContent = "Saved ✓";
    textEl.style.color = "#10B981";
    if (dotEl) {
      dotEl.style.background = "#10B981";
      dotEl.style.transform = "scale(1.35)";
    }
    setTimeout(() => {
      textEl.textContent = "Auto-saved";
      textEl.style.color = "";
      if (dotEl) {
        dotEl.style.transform = "";
      }
    }, 1200);
  }

  // Preference Toggle Handlers
  const formatToggle = document.getElementById("pref-format-toggle");
  if (formatToggle) {
    formatToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".qs-toggle-btn");
      if (!btn) return;
      const format = btn.dataset.format;
      formatToggle.querySelectorAll(".qs-toggle-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      chrome.storage.local.set({ outputFormat: format }, () => flashSavedBadge());
    });
  }

  const destToggle = document.getElementById("pref-dest-toggle");
  if (destToggle) {
    destToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".qs-toggle-btn");
      if (!btn) return;
      const dest = btn.dataset.dest;
      destToggle.querySelectorAll(".qs-toggle-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      chrome.storage.local.set({ outputDestination: dest }, () => flashSavedBadge());
    });
  }

  const themeToggle = document.getElementById("pref-theme-toggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", (e) => {
      const btn = e.target.closest(".qs-toggle-btn");
      if (!btn) return;
      const theme = btn.dataset.theme;
      themeToggle.querySelectorAll(".qs-toggle-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      applyThemeMode(theme);

      chrome.storage.local.set({ userTheme: theme }, () => {
        flashSavedBadge();
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach((t) => {
            if (t.id) chrome.tabs.sendMessage(t.id, { type: "apply-theme", theme }).catch(() => {});
          });
        });
      });
    });
  }

  // OS detection for keyboard shortcuts hint
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPod|iPad/.test(navigator.platform || navigator.userAgent);
  const modKey = isMac ? "Ctrl" : "Alt";

  if (noticeFooterText) {
    noticeFooterText.innerHTML = `Press <kbd>${modKey}</kbd>+<kbd>X</kbd> on any webpage`;
  }

  // Set shortcuts table text if element exists
  const scSelect = document.getElementById("sc-select");
  const scVisible = document.getElementById("sc-visible");
  const scTimer = document.getElementById("sc-timer");
  const scHorizontal = document.getElementById("sc-horizontal");
  const scFull = document.getElementById("sc-full");
  if (scSelect) scSelect.textContent = `${modKey} + X`;
  if (scVisible) scVisible.textContent = `${modKey} + S`;
  if (scTimer) scTimer.textContent = `${modKey} + T`;
  if (scHorizontal) scHorizontal.textContent = `${modKey} + H`;
  if (scFull) scFull.textContent = `${modKey} + F`;

  // Dismiss listeners
  if (noticeCloseBtn) {
    noticeCloseBtn.onclick = () => window.close();
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.close();
  });

  // Restore normal popup action on close/hide
  try {
    chrome.runtime.connect({ name: "popup-lifecycle" });
  } catch {}

  window.addEventListener("pagehide", () => {
    chrome.runtime.sendMessage({ type: "restore-tab-action" }).catch(() => {});
  });

  function showNotice({
    badge = "Preferences",
    iconType = "settings",
    iconSvg,
    title,
    desc,
    tip,
    showPrefs = false,
    showShortcuts = false,
    showQuickActions = false,
    actionText,
    onAction,
  }) {
    if (noticeView) noticeView.style.display = "flex";
    if (noticeBadge) noticeBadge.textContent = badge;

    if (noticeGlow) {
      noticeGlow.className = `qs-notice-glow ${iconType}`;
    }

    if (noticeIcon) {
      noticeIcon.className = `qs-notice-icon-wrapper ${iconType}`;
      noticeIcon.innerHTML = iconSvg;
    }

    if (noticeTitle) noticeTitle.textContent = title;
    if (noticeDesc) noticeDesc.textContent = desc;

    if (noticeTip) {
      if (tip) {
        if (noticeTipText) {
          noticeTipText.textContent = tip.replace(/^✦\s*/, "");
        } else {
          noticeTip.textContent = tip;
        }
        noticeTip.style.display = "flex";
      } else {
        noticeTip.style.display = "none";
      }
    }

    if (noticePrefs) {
      noticePrefs.style.display = showPrefs ? "flex" : "none";
    }

    if (noticeShortcuts) {
      noticeShortcuts.style.display = showShortcuts ? "flex" : "none";
    }

    if (noticeQuickActions) {
      noticeQuickActions.style.display = showQuickActions ? "flex" : "none";
    }

    if (noticeActionBtn) {
      if (actionText && onAction) {
        if (noticeActionText) noticeActionText.textContent = actionText;
        noticeActionBtn.style.display = "inline-flex";
        noticeActionBtn.onclick = onAction;
      } else {
        noticeActionBtn.style.display = "none";
      }
    }
  }

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

  function sendMessageToTab(tabId, type, closeWindow = true) {
    chrome.tabs.sendMessage(tabId, { type }, (response) => {
      if (chrome.runtime.lastError) {
        if (
          chrome.runtime.lastError.message.includes(
            "Receiving end does not exist",
          )
        ) {
          chrome.scripting.executeScript(
            {
              target: { tabId },
              files: ["contentScript.js"],
            },
            () => {
              if (chrome.runtime.lastError) {
                console.error("Injection failed:", chrome.runtime.lastError);
                return;
              }
              setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { type });
                if (closeWindow) window.close();
              }, 150);
            },
          );
        } else {
          console.error("Message failed:", chrome.runtime.lastError);
        }
      } else {
        if (closeWindow) window.close();
      }
    });
  }

  const urlParams = new URLSearchParams(window.location.search);
  const viewParam = urlParams.get("view");

  if (viewParam === "settings" || viewParam === "options" || window.location.pathname.endsWith("options.html")) {
    document.body.classList.add("options-mode");
    showNotice({
      badge: "Preferences",
      iconType: "settings",
      iconSvg:
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
      title: "SwiftSelect Settings",
      desc: "Customize default export format, destination and appearance.",
      tip: "Changes save automatically and sync across your browser sessions.",
      showPrefs: true,
      showShortcuts: false,
      actionText: "Configure Chrome Shortcuts",
      onAction: () => {
        chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
        window.close();
      },
    });
    return;
  }

  if (viewParam === "help") {
    showNotice({
      badge: "Shortcuts",
      iconType: "help",
      iconSvg:
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      title: "Keyboard Shortcuts & Guide",
      desc: "Use quick hotkeys on any webpage to snap and save instantly.",
      tip: null,
      showPrefs: false,
      showShortcuts: true,
      actionText: "Customize Shortcuts in Chrome",
      onAction: () => {
        chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
        window.close();
      },
    });
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url) return;

    if (isRestrictedUrl(tab.url)) {
      showNotice({
        badge: "Chrome Policy",
        iconType: "warning",
        iconSvg:
          '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><rect x="9" y="10" width="6" height="5" rx="1"/><path d="M10 10V8a2 2 0 1 1 4 0v2"/></svg>',
        title: "Browser Protected Page",
        desc: "Chrome security policies prevent extensions from running on system pages, internal settings, and the Web Store.",
        tip: "SwiftSelect is fully available on all regular websites and web applications.",
        showPrefs: true,
        showShortcuts: false,
        actionText: "Configure Shortcuts",
        onAction: () => {
          chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
          window.close();
        },
      });
      return;
    }

    if (tab.url.startsWith("file://")) {
      chrome.extension.isAllowedFileSchemeAccess((isAllowed) => {
        if (!isAllowed) {
          showNotice({
            badge: "File Permission",
            iconType: "file",
            iconSvg:
              '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><rect x="9" y="13" width="6" height="5" rx="1"/><path d="M10 13v-1.5a2 2 0 1 1 4 0V13"/></svg>',
            title: "Local File Access",
            desc: "To capture locally opened HTML or PDF files, Chrome requires explicit permission enabled in extension settings.",
            tip: "Turn on \"Allow access to file URLs\" in the extension settings tab.",
            showPrefs: true,
            showShortcuts: false,
            actionText: "Open Extension Settings",
            onAction: () => {
              chrome.tabs.create({
                url: `chrome://extensions/?id=${chrome.runtime.id}`,
              });
              window.close();
            },
          });
          return;
        }

        initSupportedTab(tab.id);
      });
      return;
    }

    initSupportedTab(tab.id);
  });

  function initSupportedTab(tabId) {
    const isMacPlatform =
      typeof navigator !== "undefined" &&
      /Mac|iPhone|iPod|iPad/.test(navigator.platform || navigator.userAgent);
    const shortcut = isMacPlatform ? "Ctrl+X" : "Alt+X";

    const brandIconSvg =
      '<img src="icons/icon48.png" width="22" height="22" alt="SwiftSelect" style="display:block;border-radius:5px;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.18));" />';

    showNotice({
      badge: "SwiftSelect",
      iconType: "brand",
      iconSvg: brandIconSvg,
      title: "SwiftSelect",
      desc: "Instant area capture, copy & full page screenshot.",
      tip: `Ready to snap: Press ${shortcut} on any webpage to select area.`,
      showPrefs: true,
      showShortcuts: false,
      showQuickActions: true,
      actionText: `Start Area Capture (${shortcut})`,
      onAction: () => {
        sendMessageToTab(tabId, "start-selection", true);
      },
    });

    if (btnQuickVisible) {
      btnQuickVisible.onclick = () => {
        sendMessageToTab(tabId, "capture-visible", true);
      };
    }
    if (btnQuickFull) {
      btnQuickFull.onclick = () => {
        sendMessageToTab(tabId, "capture-full", true);
      };
    }
  }
});
