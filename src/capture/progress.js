/**
 * Full-page capture progress.
 *
 * Progress is shown in the status pill itself (ui.showProgressStatus), at
 * its usual size and place, so when the capture finishes the very same pill
 * turns into the result: it springs to its new width, the ring becomes the
 * outcome tile, and the result buttons pop in. No second element appears.
 *
 * The capture photographs the whole viewport, so the pill must never be in
 * a frame. The capture steps down the page in strides that skip a strip at
 * the bottom of the viewport, PROGRESS_BAND pixels tall, and only the part
 * above it is stitched. The status pill (76 px tall, 40 px from the bottom,
 * plus its shadow) sits entirely inside that strip. Its host is pinned with
 * the unroll's own --scroll-top / --scroll-left, so it stays on screen while
 * <html> is shifted (see pinStatusHost in ui.js).
 */

export const PROGRESS_BAND = 132;

const ui = () => window.SwiftSelect?.ui;

/** Show the pill at 0 %. `total` is the number of frames, when known. */
export function showCaptureProgress({ title = "Capturing page", total = 0 } = {}) {
  ui()?.showProgressStatus?.({ title, total });
}

/** Advance the pill. Safe to call when it is not showing. */
export function setCaptureProgress(done, total) {
  ui()?.updateProgressStatus?.(done, total);
}

/** Frames are in; the image is being put together. */
export function setCaptureStitching() {
  ui()?.stitchingProgressStatus?.();
}

/**
 * Kept for the capture flow's shape: the result (or the cancel / error
 * message) is set on the same pill right after, and that update is the
 * transition, so there is nothing to tear down here.
 */
export function hideCaptureProgress() {
  return Promise.resolve();
}
