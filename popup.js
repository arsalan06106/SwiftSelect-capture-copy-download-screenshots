document.addEventListener("DOMContentLoaded", () => {
  const btnVisible = document.getElementById("btn-visible");
  const btnHorizontal =
    document.getElementById("btn-horizontal") ||
    document.getElementById("btn-download");
  const btnFull = document.getElementById("btn-full");
  const toolbarView = document.getElementById("toolbar-view");
  const noticeView = document.getElementById("notice-view");
  const noticeIcon = document.getElementById("notice-icon");
  const noticeTitle = document.getElementById("notice-title");
  const noticeDesc = document.getElementById("notice-desc");
  const noticeBadge = document.getElementById("notice-badge");
  const noticeTip = document.getElementById("notice-tip");
  const noticeActionBtn = document.getElementById("notice-action-btn");
  const noticeActionText = document.getElementById("notice-action-text");

  function showNotice({
    badge = "System Notice",
    iconType,
    iconSvg,
    title,
    desc,
    tip,
    actionText,
    onAction,
  }) {
    if (toolbarView) toolbarView.style.display = "none";
    if (noticeView) noticeView.style.display = "flex";
    if (noticeBadge) noticeBadge.textContent = badge;
    if (noticeIcon) {
      noticeIcon.className = `qs-notice-icon ${iconType}`;
      noticeIcon.innerHTML = iconSvg;
    }
    if (noticeTitle) noticeTitle.textContent = title;
    if (noticeDesc) noticeDesc.textContent = desc;
    if (noticeTip) {
      if (tip) {
        noticeTip.textContent = tip;
        noticeTip.style.display = "block";
      } else {
        noticeTip.style.display = "none";
      }
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

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url) return;

    if (isRestrictedUrl(tab.url)) {
      showNotice({
        badge: "Chrome Policy",
        iconType: "warning",
        iconSvg:
          '<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 6c1.4 0 2.5 1.1 2.5 2.5V11h.5c.55 0 1 .45 1 1v5c0 .55-.45 1-1 1H9c-.55 0-1-.45-1-1v-5c0-.55.45-1 1-1h.5V9.5C9.5 8.1 10.6 7 12 7zm0 1.5c-.55 0-1 .45-1 1V11h2V9.5c0-.55-.45-1-1-1z"/></svg>',
        title: "Protected Page",
        desc: "Chrome prevents extensions from running on system pages (chrome://) and the Web Store.",
        tip: "💡 SwiftSelect is fully ready on any normal website or web app.",
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
              '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm4 18H6V4h7v5h5v11zm-8-6h4v2h-4v-2zm0-4h8v2h-8v-2z"/></svg>',
            title: "Local File Access",
            desc: "To capture locally opened HTML files, Chrome requires explicit permission.",
            tip: "Enable 'Allow access to file URLs' in extension settings.",
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
    if (toolbarView) toolbarView.style.display = "flex";
    if (noticeView) noticeView.style.display = "none";

    // Auto-activate selection mode on popup open
    sendMessageToTab(tabId, "start-selection", false);

    if (btnVisible)
      btnVisible.addEventListener("click", () =>
        sendMessageToTab(tabId, "capture-visible"),
      );
    if (btnHorizontal)
      btnHorizontal.addEventListener("click", () =>
        sendMessageToTab(tabId, "capture-horizontal"),
      );
    if (btnFull)
      btnFull.addEventListener("click", () =>
        sendMessageToTab(tabId, "capture-full"),
      );
  }
});
