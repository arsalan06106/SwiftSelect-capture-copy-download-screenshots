import { loadImage, toggleCursor, getOutputSettings } from "./utils.js";
import { setLastBlob, handleSaveAction } from "./download.js";

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () =>
      reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

async function writeImageBlobToClipboard(blob) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
    return true;
  } catch (clipErr) {
    console.debug("Clipboard write from content failed:", clipErr);
  }

  try {
    const dataUrl = await blobToDataUrl(blob);
    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "write-image-to-clipboard", dataUrl },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error: chrome.runtime.lastError.message,
            });
            return;
          }
          resolve(response);
        },
      );
    });
    return !!resp?.success;
  } catch (offscreenErr) {
    console.debug("Clipboard write from offscreen failed:", offscreenErr);
    return false;
  }
}

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

export async function handleCaptureVisible() {
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

    // Mathematically crop out the native browser scrollbars
    const dpr = window.devicePixelRatio || 1;
    const cropW = Math.min(
      img.width,
      Math.round(document.documentElement.clientWidth * dpr),
    );
    const cropH = Math.min(
      img.height,
      Math.round(document.documentElement.clientHeight * dpr),
    );

    const canvas = document.createElement("canvas");
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cropW, cropH);
    ctx.drawImage(img, 0, 0, cropW, cropH, 0, 0, cropW, cropH);

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
    } else if (destination === "download") {
      exportBlob = await new Promise((res, rej) =>
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
          format === "png" ? "image/png" : "image/jpeg",
          0.92,
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
          canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", 0.92),
        );
        setLastBlob(exportBlob, "jpg");
        handleSaveAction("jpg");
      }
    }

    window.SwiftSelect.ui.triggerFlash();

    let statusMsg = "Page Captured";
    let statusType = "saved";
    if (destination === "both") {
      statusMsg = clipboardSuccess ? "Copied & Saved" : "Image Saved";
      statusType = "saved";
    } else if (destination === "clipboard") {
      statusMsg = clipboardSuccess ? "Copied to Clipboard" : "Copy Failed";
      statusType = clipboardSuccess ? "success" : "error";
    } else if (destination === "download") {
      statusMsg = "Image Saved";
      statusType = "saved";
    }

    window.SwiftSelect.ui.setStatus(statusMsg, 5000, statusType, false, {
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
  return handleCaptureVisible();
}

export async function captureAndCrop(viewRect) {
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

    const canvas = document.createElement("canvas");
    const safeSw = Math.max(1, sw);
    const safeSh = Math.max(1, sh);

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
    } else if (destination === "download") {
      exportBlob = await new Promise((res, rej) =>
        canvas.toBlob(
          (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
          format === "png" ? "image/png" : "image/jpeg",
          0.92,
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
          canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", 0.92),
        );
        setLastBlob(exportBlob, "jpg");
        handleSaveAction("jpg");
      }
    }

    let statusMsg = "Selection Captured";
    let statusType = "saved";
    if (destination === "both") {
      statusMsg = clipboardSuccess ? "Copied & Saved" : "Image Saved";
      statusType = "saved";
    } else if (destination === "clipboard") {
      statusMsg = clipboardSuccess ? "Copied to Clipboard" : "Copy Failed";
      statusType = clipboardSuccess ? "success" : "error";
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
  }
}

