import { getSmartFilename, blobToDataUrl } from "./utils.js";

let lastBlob = null;
let lastExt = "jpg";

export function setLastBlob(blob, ext = "jpg") {
  lastBlob = blob;
  lastExt = ext || "jpg";
}

export function getLastBlob() {
  return lastBlob;
}

export function getLastExt() {
  return lastExt;
}

export async function downloadBlob(blob, filename, options = {}) {
  if (!blob) return false;

  const isFileProtocol =
    typeof window !== "undefined" && window.location?.protocol === "file:";
  const extBlobUrl = options?.blobUrl;

  // 1. If we have an extension blobUrl from offscreen, use chrome.downloads directly (0ms, zero IPC overhead)
  if (extBlobUrl) {
    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: "download-file", url: extBlobUrl, filename },
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

  // 2. On standard web pages (https://, http://), native DOM <a> click is instantaneous (0ms, zero IPC overhead)
  if (!isFileProtocol) {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = filename;
      (document.body || document.documentElement).appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 10000);
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
        { type: "download-file", url: dataUrl, filename },
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
    a.download = filename;
    (document.body || document.documentElement).appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 10000);
    return true;
  } catch (domErr) {
    return false;
  }
}

export async function handleSaveAction(customExt = null) {
  if (!lastBlob) return;

  const ext = customExt || lastExt || "jpg";
  const filename = getSmartFilename("screenshot", ext);
  await downloadBlob(lastBlob, filename);

  // Transition Logic via UI
  const statusEl = window.SwiftSelect.ui.statusEl;
  if (statusEl) {
    const textSpan = statusEl.querySelector("span");
    const saveBtn = statusEl.querySelector(".qs-save-btn");

    if (textSpan && saveBtn) {
      statusEl.getAnimations().forEach((anim) => {
        if (!anim.animationName) anim.cancel();
      });
      textSpan.getAnimations().forEach((anim) => {
        if (!anim.animationName) anim.cancel();
      });

      statusEl.classList.remove("qs-success");
      statusEl.classList.add("qs-saved");
      saveBtn.remove();
      textSpan.textContent = "Image Saved";

      textSpan.animate(
        [
          { opacity: 0, transform: "scale(0.94)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        {
          duration: 180,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        },
      );

      const icon = statusEl.querySelector(".qs-status-icon");
      if (icon) {
        icon.getAnimations().forEach((anim) => {
          if (!anim.animationName) anim.cancel();
        });
        icon.animate(
          [
            { opacity: 0, transform: "scale(0.88)" },
            { opacity: 1, transform: "scale(1)" },
          ],
          {
            duration: 180,
            easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          },
        );
      }
    }

    if (window.SwiftSelect.ui.hideStatusTimer)
      clearTimeout(window.SwiftSelect.ui.hideStatusTimer);

    window.SwiftSelect.ui.setHideStatusTimer(
      setTimeout(() => {
        if (statusEl) {
          statusEl.classList.add("qs-hiding");
          setTimeout(() => {
            statusEl.style.display = "none";
            window.SwiftSelect.ui.statusHost.style.display = "none";
            statusEl.classList.remove("qs-hiding");
            window.SwiftSelect.ui.setCurrentStatus(null);
          }, 180);
        }
      }, 2500),
    );
  }
}
