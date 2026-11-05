// offscreen.js — Full page capture engine
// Runs in an offscreen document context where getUserMedia + ImageCapture are available.

// ─── Frame Detection ─────────────────────────────────────────────────
// Downsamples each frame to 10x10 and compares pixel data to detect
// whether the tab has actually repainted after a CSS scroll-top change.
class FrameDetector {
  constructor(w = 10, h = 10) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    this.ctx = c.getContext("2d", { alpha: false, willReadFrequently: true });
    this.w = w;
    this.h = h;
    this.prev = null;
  }

  /** Returns true if frame is IDENTICAL to previous (no change yet). */
  detect(imageBitmap) {
    this.ctx.drawImage(
      imageBitmap,
      0,
      0,
      imageBitmap.width,
      imageBitmap.height,
      0,
      0,
      this.w,
      this.h,
    );
    const cur = this.ctx.getImageData(0, 0, this.w, this.h);
    const prev = this.prev;
    this.prev = cur;
    if (!prev) return false; // first frame always "changed"
    const a = prev.data,
      b = cur.data;
    for (let i = a.length - 1; i >= 0; i--) {
      if (a[i] !== b[i]) return false;
    }
    return true; // identical
  }
}

// ─── Frame Grabber ───────────────────────────────────────────────────
// Wraps ImageCapture with frame detection for zero-overhead direct ImageBitmap extraction.
class FrameGrabber {
  constructor(videoTrack) {
    this.ic = new ImageCapture(videoTrack);
    this.detector = new FrameDetector(10, 10);
  }

  /** Grab a frame, checking if tab repainted after scroll. */
  async grabFrame() {
    let attempts = 0;
    let frame;
    do {
      attempts++;
      frame = await this.ic.grabFrame();
      if (!this.detector.detect(frame) || attempts >= 10) break;
      await new Promise((r) => setTimeout(r, 16));
    } while (true);
    return frame;
  }
}

// ─── Clipboard Helper ────────────────────────────────────────────────

/**
 * Silently attempt to write to the clipboard.
 * No logging or focus-stealing; just a best-effort attempt.
 */
async function writeToClipboardSilent(blob) {
  try {
    let clipBlob = blob;
    if (blob.type !== "image/png") {
      const bitmap = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const cx = c.getContext("2d");
      cx.fillStyle = "#ffffff";
      cx.fillRect(0, 0, c.width, c.height);
      cx.drawImage(bitmap, 0, 0);
      bitmap.close();
      clipBlob = await new Promise((r) => c.toBlob(r, "image/png"));
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": clipBlob })]);
    return true;
  } catch (e) {
    console.debug("offscreen: Silent clipboard write failed:", e);
    return false;
  }
}

async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

// ─── Main Capture Logic ──────────────────────────────────────────────

/**
 * Send a message to the content script (via background relay) and wait for response.
 */
function sendToContent(tabId, action, data = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for content script (${action})`));
    }, 10000);

    chrome.runtime.sendMessage(
      { type: "offscreen-to-content", tabId, action, data },
      (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      },
    );
  });
}

/**
 * Get a tab capture MediaStream using getUserMedia.
 */
async function getTabStream(streamId, width, height) {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        minWidth: width,
        maxWidth: width,
        minHeight: height,
        maxHeight: height,
        minFrameRate: 30,
        maxFrameRate: 60,
        chromeMediaSourceCursor: "never",
      },
      cursor: "never",
    },
  });
}

/**
 * Compute sequence of scroll offsets to cover totalSize with viewportSize.
 * Uses overlap to prevent black seams and ensures the final offset aligns with the edge.
 */
function computeGridPoints(totalSize, viewportSize, overlap = 2) {
  if (totalSize <= viewportSize + 5) {
    return [0];
  }
  const points = [];
  const step = Math.max(1, viewportSize - overlap);
  let current = 0;
  const maxPos = Math.max(0, Math.round(totalSize - viewportSize));

  while (current < maxPos) {
    points.push(current);
    current += step;
  }

  if (points.length === 0 || points[points.length - 1] < maxPos) {
    points.push(maxPos);
  }

  return points;
}

/**
 * Perform the full page capture using 2D CSS unrolling (horizontal + vertical).
 *
 * Flow:
 * 1. Tell content script to "unroll" the page (CSS transform instead of scroll)
 * 2. Open getUserMedia stream for the tab
 * 3. Loop: update --scroll-top & --scroll-left across 2D grid → wait → grab frame → store
 * 4. Tell content script to restore
 * 5. Stitch frames onto 2D canvas → return Blob as data URL
 */
async function captureFullPage(
  streamId,
  tabId,
  mode = "full",
  frameInterval = 50,
  format = "image/jpeg",
  quality = 0.98,
) {
  // 1. Unroll the page — CSS is applied first, then rect is measured
  const meta = await sendToContent(tabId, "unroll-page", { mode });
  if (!meta)
    throw new Error("unroll-page failed — no response from content script");

  const { innerWidth, innerHeight, devicePixelRatio: dpr, cropRect } = meta;

  // Use rect (measured AFTER CSS injection) for true content dimensions.
  const rectHeight = meta.rect?.height || meta.scrollHeight || innerHeight;
  const rectWidth = meta.rect?.width || meta.scrollWidth || innerWidth;

  const hasCrop = !!cropRect;
  const cropX = hasCrop ? Math.max(0, Math.round(cropRect.x * dpr)) : 0;
  const cropY = hasCrop ? Math.max(0, Math.round(cropRect.y * dpr)) : 0;

  console.log("[offscreen] meta:", {
    mode,
    innerWidth,
    innerHeight,
    dpr,
    rectHeight,
    rectWidth,
    cropRect,
    scrollHeight: meta.scrollHeight,
    scrollWidth: meta.scrollWidth,
    rectBottom: meta.rectBottom,
    rectRight: meta.rectRight,
    initialScrollTop: meta.initialScrollTop,
  });

  // Calculate stream dimensions (must be even for video codec)
  const rawW = Math.ceil(innerWidth * dpr);
  const rawH = Math.ceil(innerHeight * dpr);
  const streamW = rawW % 2 === 0 ? rawW : rawW + 1;
  const streamH = rawH % 2 === 0 ? rawH : rawH + 1;

  const contentW = rawW;
  const contentH = rawH;

  // 2. Get tab capture stream
  let stream;
  try {
    stream = await getTabStream(streamId, streamW, streamH);
  } catch (err) {
    await sendToContent(tabId, "restore-unroll");
    throw new Error("getUserMedia failed: " + err.message);
  }

  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    if ("contentHint" in videoTrack) {
      videoTrack.contentHint = "detail";
    }
    try {
      await videoTrack.applyConstraints({
        advanced: [{ degradationPreference: "maintain-resolution" }],
      });
    } catch (e) {
      // ignore
    }
  }

  const grabber = new FrameGrabber(videoTrack);

  // Wait a moment for the stream to start producing frames
  await new Promise((r) => setTimeout(r, 20));

  // Overlap consecutive frames by 2px to prevent black seam lines.
  const OVERLAP = 2;

  const isHorizontalOnly = mode === "horizontal";

  // Generate 2D grid coordinates for full width & height coverage
  const yPoints = hasCrop
    ? ((isHorizontalOnly || Math.round(cropRect.height * dpr) <= rawH)
        ? [0]
        : computeGridPoints(cropRect.height, innerHeight, OVERLAP))
    : (isHorizontalOnly
        ? [0]
        : computeGridPoints(rectHeight, innerHeight, OVERLAP));

  const xPoints = hasCrop
    ? (Math.round(cropRect.width * dpr) <= rawW
        ? [0]
        : computeGridPoints(cropRect.width, innerWidth, OVERLAP))
    : computeGridPoints(rectWidth, innerWidth, OVERLAP);

  const totalFrames = xPoints.length * yPoints.length;

  const rawCanvasWidth = hasCrop
    ? Math.max(1, Math.round(cropRect.width * dpr))
    : (xPoints.length === 1 ? contentW : Math.ceil(rectWidth * dpr));
  const rawCanvasHeight = hasCrop
    ? Math.max(
        1,
        isHorizontalOnly
          ? Math.min(Math.round(cropRect.height * dpr), Math.ceil(innerHeight * dpr))
          : Math.round(cropRect.height * dpr),
      )
    : (isHorizontalOnly ? Math.ceil(innerHeight * dpr) : Math.ceil(rectHeight * dpr));

  // 3. Capture loop (2D Matrix: rows x columns)
  const frames = [];
  let isDone = false;
  let frameCount = 0;

  try {
    for (let yi = 0; yi < yPoints.length && !isDone; yi++) {
      const logicalY = yPoints[yi];

      for (let xi = 0; xi < xPoints.length && !isDone; xi++) {
        const logicalX = xPoints[xi];

        // Update CSS scroll translation (--scroll-top and --scroll-left)
        const updateResult = await sendToContent(tabId, "update-unroll", {
          scrollTop: logicalY,
          scrollLeft: logicalX,
        });

        if (!updateResult || updateResult.abort) {
          isDone = true;
          break;
        }

        // Wait for repaint
        await new Promise((r) => setTimeout(r, frameInterval));

        // Grab frame directly as ImageBitmap (zero encoding overhead)
        const frame = await grabber.grabFrame();

        let frameSx = 0;
        let frameSy = 0;
        let frameSw = contentW;
        let frameSh = contentH;

        if (hasCrop) {
          if (xPoints.length === 1) {
            frameSx = cropX;
            frameSw = Math.min(rawCanvasWidth, contentW - cropX);
          } else if (xi === 0 && cropX > 0) {
            frameSx = cropX;
            frameSw = contentW - cropX;
          }
          if (yPoints.length === 1) {
            frameSy = cropY;
            frameSh = Math.min(rawCanvasHeight, contentH - cropY);
          } else if (yi === 0 && cropY > 0) {
            frameSy = cropY;
            frameSh = contentH - cropY;
          }
        }

        frames.push({
          bitmap: frame,
          sx: frameSx,
          sy: frameSy,
          sw: frameSw,
          sh: frameSh,
          dx: Math.floor(logicalX * dpr),
          dy: isHorizontalOnly ? 0 : Math.floor(logicalY * dpr),
        });

        frameCount++;
        const progress = Math.min(
          100,
          Math.round((frameCount / totalFrames) * 100),
        );
        chrome.runtime.sendMessage({
          type: "offscreen-progress",
          tabId,
          progress,
          current: frameCount,
          total: totalFrames,
        });
      }
    }
  } catch (err) {
    console.error("[offscreen] Capture loop error:", err);
    frames.forEach((f) => {
      try {
        f.bitmap?.close?.();
      } catch {}
    });
    if (frames.length === 0) {
      stream.getTracks().forEach((t) => t.stop());
      await sendToContent(tabId, "restore-unroll");
      throw err;
    }
  }

  // 4. Stitch frames onto 2D canvas
  if (frames.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    await sendToContent(tabId, "restore-unroll");
    throw new Error("No frames captured");
  }

  // Chromium canvas dimension safety limit clamping
  const MAX_CANVAS_DIM = 16384;
  const MAX_CANVAS_AREA = 268435456; // 16384 * 16384

  let scaleRatio = 1;
  if (rawCanvasWidth > MAX_CANVAS_DIM) {
    scaleRatio = Math.min(scaleRatio, MAX_CANVAS_DIM / rawCanvasWidth);
  }
  if (rawCanvasHeight > MAX_CANVAS_DIM) {
    scaleRatio = Math.min(scaleRatio, MAX_CANVAS_DIM / rawCanvasHeight);
  }
  if (
    rawCanvasWidth * rawCanvasHeight * scaleRatio * scaleRatio >
    MAX_CANVAS_AREA
  ) {
    scaleRatio = Math.min(
      scaleRatio,
      Math.sqrt(MAX_CANVAS_AREA / (rawCanvasWidth * rawCanvasHeight)),
    );
  }

  const canvasWidth = Math.max(1, Math.floor(rawCanvasWidth * scaleRatio));
  const canvasHeight = Math.max(1, Math.floor(rawCanvasHeight * scaleRatio));

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext("2d", { alpha: true });

  if (scaleRatio === 1) {
    ctx.imageSmoothingEnabled = false;
  } else {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.scale(scaleRatio, scaleRatio);
  }

  // Pre-fill background so any unpainted borders match page bg or pure white (never black)
  const safeBg =
    meta.bgColor &&
    meta.bgColor !== "transparent" &&
    meta.bgColor !== "rgba(0, 0, 0, 0)"
      ? meta.bgColor
      : "#ffffff";
  ctx.fillStyle = safeBg;
  ctx.fillRect(0, 0, rawCanvasWidth, rawCanvasHeight);

  for (let yi = 0; yi < yPoints.length; yi++) {
    const isLastRow = yi === yPoints.length - 1;
    for (let xi = 0; xi < xPoints.length; xi++) {
      const isLastCol = xi === xPoints.length - 1;
      const idx = yi * xPoints.length + xi;
      const f = frames[idx];
      if (!f || !f.bitmap) continue;

      // On the final row / col, snap exactly to the canvas outer boundary to eliminate 1px gaps
      const dx = isLastCol ? Math.max(0, rawCanvasWidth - f.sw) : f.dx;
      const dy = isLastRow ? Math.max(0, rawCanvasHeight - f.sh) : f.dy;
      const drawW = Math.min(f.sw, rawCanvasWidth - dx);
      const drawH = Math.min(f.sh, rawCanvasHeight - dy);

      if (drawW > 0 && drawH > 0) {
        ctx.drawImage(f.bitmap, f.sx, f.sy, drawW, drawH, dx, dy, drawW, drawH);
      }
      f.bitmap.close();
    }
  }

  // 5. Cleanup stream and page immediately so browser can release video hardware
  stream.getTracks().forEach((t) => t.stop());
  await sendToContent(tabId, "restore-unroll");

  // Single-pass canvas Blob encoding
  const blob = await new Promise((r) => canvas.toBlob(r, format, quality));
  const blobUrl = blob ? URL.createObjectURL(blob) : "";

  // Internal Clipboard Write (Silent Attempt)
  let clipboardSuccess = false;
  try {
    if (format === "image/png" && blob) {
      clipboardSuccess = await writeToClipboardSilent(blob);
    } else {
      const pngBlob = await new Promise((r) => canvas.toBlob(r, "image/png"));
      if (pngBlob) {
        clipboardSuccess = await writeToClipboardSilent(pngBlob);
      }
    }
  } catch (err) {
    // Silently fail
  }

  // Final image as dataUrl (only for moderate canvases to avoid IPC lag)
  let dataUrl = "";
  if (rawCanvasWidth * rawCanvasHeight <= 3000 * 3000) {
    try {
      dataUrl = canvas.toDataURL(format, quality);
      if (dataUrl && dataUrl.length > 20 * 1024 * 1024) {
        dataUrl = "";
      }
    } catch (err) {
      console.warn("offscreen toDataURL error:", err);
    }
  }

  return { dataUrl, blobUrl, clipboardSuccess };
}

// ─── Message Listener ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "write-image-clipboard") {
    (async () => {
      try {
        const blob = await dataUrlToBlob(msg.dataUrl);
        const success = await writeToClipboardSilent(blob);
        sendResponse({ success });
      } catch (err) {
        console.error("Offscreen clipboard write error:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }

  if (msg.type === "start-offscreen-capture") {
    const { streamId, tabId, mode, frameInterval, format, quality } = msg;
    captureFullPage(
      streamId,
      tabId,
      mode || "full",
      frameInterval || 50,
      format || "image/jpeg",
      quality || 0.98,
    )
      .then((result) => {
        sendResponse({ success: true, ...result });
      })
      .catch((err) => {
        console.error("Offscreen capture error:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // async response
  }
});
