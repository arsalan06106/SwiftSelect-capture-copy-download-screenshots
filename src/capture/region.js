import {
  loadImage,
  toggleCursor,
  getOutputSettings,
  detectStandaloneMediaOrActiveBounds,
  writeImageBlobToClipboard,
} from "./utils.js";
import { setLastBlob, handleSaveAction } from "./download.js";

export { writeImageBlobToClipboard };

export async function captureFrame(retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "capture-visible-tab" }, resolve);
      });
      if (resp?.success) {
        window.SwiftSelect?.theme?.setTabScreenshot?.(resp.dataUrl);
        return resp.dataUrl;
      }
      const errMsg = resp?.error || "capture-visible-tab failed";
      if (errMsg.includes("MAX_CAPTURE") && attempt < retries) {
        const delay = 600 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error(errMsg);
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 600 * Math.pow(2, attempt)));
    }
  }
}

export async function handleTimedCapture(seconds = 3) {
  if (window.SwiftSelect?.ui?.startTimedCountdown) {
    window.SwiftSelect.ui.startTimedCountdown(seconds, () => {
      handleCaptureVisible();
    });
  } else {
    setTimeout(() => {
      handleCaptureVisible();
    }, seconds * 1000);
  }
}

export async function handleCaptureVisible(options = {}) {
  try {
    await window.SwiftSelect.ui.hideUiForCapture();
    window.SwiftSelect.ui.cleanup();
    window.SwiftSelect.events.removeListeners();

    const resp = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ success: false, error: "Capture timed out" }), 4000);
      try {
        chrome.runtime.sendMessage({ type: "capture-visible-tab" }, (r) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(r || { success: false, error: "No response from background" });
        });
      } catch (err) {
        clearTimeout(timer);
        resolve({ success: false, error: err?.message || "Failed to send message" });
      }
    });
    if (!resp?.success) throw new Error(resp?.error || "Capture failed");
    window.SwiftSelect?.theme?.setTabScreenshot?.(resp.dataUrl);

    const img = await loadImage(resp.dataUrl);
    const dpr = window.devicePixelRatio || 1;

    // Detect standalone media or active bounded area
    const mediaInfo = detectStandaloneMediaOrActiveBounds();
    let cropX = 0;
    let cropY = 0;
    let cropW = Math.min(
      img.width,
      Math.round(document.documentElement.clientWidth * dpr),
    );
    let cropH = Math.min(
      img.height,
      Math.round(document.documentElement.clientHeight * dpr),
    );

    if (mediaInfo.cropRect) {
      const clampedX = Math.max(0, Math.min(mediaInfo.cropRect.x, window.innerWidth));
      const clampedY = Math.max(0, Math.min(mediaInfo.cropRect.y, window.innerHeight));
      const clampedW = Math.max(1, Math.min(mediaInfo.cropRect.width, window.innerWidth - clampedX));
      const clampedH = Math.max(1, Math.min(mediaInfo.cropRect.height, window.innerHeight - clampedY));

      cropX = Math.round(clampedX * dpr);
      cropY = Math.round(clampedY * dpr);
      cropW = Math.min(img.width - cropX, Math.round(clampedW * dpr));
      cropH = Math.min(img.height - cropY, Math.round(clampedH * dpr));
    }

    const safeCropW = Math.max(1, cropW);
    const safeCropH = Math.max(1, cropH);

    const canvas = document.createElement("canvas");
    canvas.width = safeCropW;
    canvas.height = safeCropH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, safeCropW, safeCropH);
    ctx.drawImage(img, cropX, cropY, safeCropW, safeCropH, 0, 0, safeCropW, safeCropH);

    const { format, destination } = await getOutputSettings();
    const ext = format === "png" ? "png" : "jpg";
    const forceDownload = !!options?.forceDownload;

    let exportBlob = null;
    let clipboardSuccess = false;

    if (destination === "clipboard" && !forceDownload) {
      exportBlob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
      );
      setLastBlob(exportBlob, "png");
      clipboardSuccess = await writeImageBlobToClipboard(exportBlob);

      if (!clipboardSuccess) {
        // Fallback: download if copy fails
        handleSaveAction("png");
        window.SwiftSelect.ui.setStatus(
          "Saved (Clipboard Blocked)",
          5000,
          "saved",
          false,
          { sourceBlob: exportBlob },
        );
        return;
      }

      window.SwiftSelect.ui.triggerFlash();
      window.SwiftSelect.ui.setStatus("Copied to Clipboard", 5000, "success", false, {
        sourceBlob: exportBlob,
      });
      return;
    }

    if (destination === "download" || (destination === "clipboard" && forceDownload)) {
      exportBlob = await new Promise((res, rej) =>
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
          format === "png" ? "image/png" : "image/jpeg",
          format === "png" ? 1.0 : 0.98,
        ),
      );
      setLastBlob(exportBlob, ext);
      handleSaveAction(ext);

      if (destination === "clipboard" && forceDownload) {
        let clipBlob = exportBlob;
        if (format !== "png") {
          clipBlob = await new Promise((res, rej) =>
            canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
          );
        }
        if (clipBlob) {
          clipboardSuccess = await writeImageBlobToClipboard(clipBlob);
        }
      }

      window.SwiftSelect.ui.triggerFlash();
      const statusMsg =
        destination === "clipboard" && forceDownload
          ? clipboardSuccess
            ? "Copied & Saved"
            : "Image Saved"
          : "Image Saved";

      window.SwiftSelect.ui.setStatus(statusMsg, 5000, "saved", false, {
        sourceBlob: exportBlob,
      });
      return;
    }

    // destination === "both"
    if (format === "png") {
      exportBlob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
      );
      setLastBlob(exportBlob, "png");
      clipboardSuccess = await writeImageBlobToClipboard(exportBlob);
      handleSaveAction("png");
    } else {
      const pngBlob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
      );
      clipboardSuccess = await writeImageBlobToClipboard(pngBlob);

      exportBlob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", 0.92),
      );
      setLastBlob(exportBlob, "jpg");
      handleSaveAction("jpg");
    }

    window.SwiftSelect.ui.triggerFlash();
    const statusMsg = clipboardSuccess ? "Copied & Saved" : "Image Saved";
    window.SwiftSelect.ui.setStatus(statusMsg, 5000, "saved", false, {
      sourceBlob: exportBlob,
    });
  } catch (err) {
    console.error("handleCaptureVisible error:", err);
    window.SwiftSelect.ui.setStatus("Capture failed", 3000, "error");
  } finally {
    toggleCursor(false);
  }
}

export async function handleCaptureAndDownload() {
  return handleCaptureVisible({ forceDownload: true });
}

export async function captureAndCrop(viewRect, shouldFlash = false) {
  try {
    toggleCursor(true);

    let dataUrl = window.SwiftSelect.ui.getFreezeFrameDataUrl?.();
    if (!dataUrl) {
      dataUrl = await window.SwiftSelect.ui.getFreezeFramePromise?.();
    }

    if (!dataUrl) {
      await window.SwiftSelect.ui.hideUiForCapture();
      await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));

      const resp = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ success: false, error: "Capture timed out" }), 4000);
        try {
          chrome.runtime.sendMessage({ type: "capture-visible-tab" }, (r) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(r || { success: false, error: "No response from background" });
          });
        } catch (err) {
          clearTimeout(timer);
          resolve({ success: false, error: err?.message || "Failed to send message" });
        }
      });
      if (!resp?.success) throw new Error(resp?.error || "Capture failed");
      dataUrl = resp.dataUrl;
      window.SwiftSelect?.theme?.setTabScreenshot?.(dataUrl);
    }

    const img = await loadImage(dataUrl);
    const dpr = window.devicePixelRatio || 1;
    const sx = Math.round(viewRect.left * dpr);
    const sy = Math.round(viewRect.top * dpr);
    const sw = Math.round(viewRect.width * dpr);
    const sh = Math.round(viewRect.height * dpr);

    const safeSw = Math.max(1, sw);
    const safeSh = Math.max(1, sh);

    const canvas = document.createElement("canvas");
    canvas.width = safeSw;
    canvas.height = safeSh;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, safeSw, safeSh);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, safeSw, safeSh);

    const { format, destination } = await getOutputSettings();
    const ext = format === "png" ? "png" : "jpg";

    let exportBlob = null;
    let clipboardSuccess = false;

    if (destination === "clipboard") {
      exportBlob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
      );
      setLastBlob(exportBlob, "png");
      clipboardSuccess = await writeImageBlobToClipboard(exportBlob);

      if (!clipboardSuccess) {
        // Fallback: download if copy fails during selection
        handleSaveAction("png");
        window.SwiftSelect.ui.setStatus(
          "Saved (Clipboard Blocked)",
          5000,
          "saved",
          false,
          { sourceBlob: exportBlob },
        );
        return;
      }

      if (shouldFlash) {
        window.SwiftSelect.ui.triggerFlash?.(viewRect);
      }

      window.SwiftSelect.ui.setStatus("Copied to Clipboard", 5000, "success", false, {
        sourceBlob: exportBlob,
      });
      return;
    }

    if (destination === "download") {
      exportBlob = await new Promise((res, rej) =>
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
          format === "png" ? "image/png" : "image/jpeg",
          format === "png" ? 1.0 : 0.98,
        ),
      );
      setLastBlob(exportBlob, ext);
      handleSaveAction(ext);
    } else {
      // destination === "both"
      if (format === "png") {
        exportBlob = await new Promise((res, rej) =>
          canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
        );
        setLastBlob(exportBlob, "png");
        clipboardSuccess = await writeImageBlobToClipboard(exportBlob);
        handleSaveAction("png");
      } else {
        const pngBlob = await new Promise((res, rej) =>
          canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
        );
        clipboardSuccess = await writeImageBlobToClipboard(pngBlob);

        exportBlob = await new Promise((res, rej) =>
          canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", 0.98),
        );
        setLastBlob(exportBlob, "jpg");
        handleSaveAction("jpg");
      }
    }

    if (shouldFlash) {
      window.SwiftSelect.ui.triggerFlash?.(viewRect);
    }

    let statusMsg = "Selection Captured";
    let statusType = "saved";
    if (destination === "both") {
      statusMsg = clipboardSuccess ? "Copied & Saved" : "Image Saved";
      statusType = "saved";
    } else if (destination === "download") {
      statusMsg = "Image Saved";
      statusType = "saved";
    }

    window.SwiftSelect.ui.setStatus(statusMsg, 5000, statusType, false, {
      sourceBlob: exportBlob,
    });
  } catch (err) {
    console.error("captureAndCrop error:", err);
    window.SwiftSelect.ui.setStatus("Capture failed", 3000, "error");
    throw err;
  } finally {
    toggleCursor(false);
    window.SwiftSelect.ui.releaseFreeze?.();
  }
}
