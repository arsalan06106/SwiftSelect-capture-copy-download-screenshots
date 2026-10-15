import { getSmartFilename } from "./utils.js";

let lastBlob = null;

export function setLastBlob(blob) {
  lastBlob = blob;
}

export function getLastBlob() {
  return lastBlob;
}

export function handleSaveAction() {
  if (!lastBlob) return;

  const url = URL.createObjectURL(lastBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = getSmartFilename("screenshot", "jpg");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);

  // Transition Logic via UI
  const statusEl = window.SwiftSelect.ui.statusEl;
  if (statusEl) {
    const textSpan = statusEl.querySelector("span");
    const saveBtn = statusEl.querySelector(".qs-save-btn");

    if (textSpan && saveBtn) {
      // True Fluid Morph using Web Animations API
      statusEl.getAnimations().forEach(anim => { if (!anim.animationName) anim.cancel(); });
      textSpan.getAnimations().forEach(anim => { if (!anim.animationName) anim.cancel(); });
      
      const oldWidth = statusEl.getBoundingClientRect().width;

      statusEl.classList.remove("qs-success");
      statusEl.classList.add("qs-saved");
      saveBtn.remove();
      textSpan.textContent = "Image Saved";

      const newWidth = statusEl.getBoundingClientRect().width;

      statusEl.animate([
        { width: `${oldWidth}px` },
        { width: `${newWidth}px` }
      ], {
        duration: 350,
        easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      });

      textSpan.animate([
        { opacity: 0, transform: "translateY(6px) scale(0.6)" },
        { opacity: 1, transform: "translateY(0) scale(1)" }
      ], {
        duration: 350,
        easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      });

      const icon = statusEl.querySelector('.qs-status-icon');
      if (icon) {
        icon.getAnimations().forEach(anim => { if (!anim.animationName) anim.cancel(); });
        icon.animate([
          { opacity: 0, transform: "translateY(6px) scale(0.6)" },
          { opacity: 1, transform: "translateY(0) scale(1)" }
        ], {
          duration: 350,
          easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
        });
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
          }, 300);
        }
      }, 2500),
    );
  }
}
