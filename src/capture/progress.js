/**
 * Full-page capture progress pill.
 *
 * The capture photographs the whole viewport, so anything drawn on the page
 * would end up in the screenshot. Instead of hiding and re-showing the pill
 * for every frame (which flickers), the capture steps down the page in
 * strides that skip a strip at the bottom of the viewport, PROGRESS_BAND
 * pixels tall, and only the part above it is stitched. The pill lives in
 * that strip, so it can stay on screen and animate for the whole capture
 * without ever being in the image.
 *
 * While the page is unrolled, <html> is moved with a CSS transform, which
 * would drag a fixed element along with it. The host is moved back by the
 * same amount through the very variables the unroll writes (--scroll-top,
 * --scroll-left), so it stays pinned to the viewport with no per-frame JS.
 */
import { applyElementTheme, currentUserTheme } from "../theme.js";

export const PROGRESS_BAND = 64;

let host = null;
let pill = null;
let barFill = null;
let titleEl = null;
let detailEl = null;
let pctEl = null;
let hideTimer = 0;
let shownAt = 0;

function build() {
  const ui = window.SwiftSelect?.ui;
  if (!ui?.makeShadowOverlay) return false;
  if (host?.isConnected) return true;

  const made = ui.makeShadowOverlay("div", "qs-progress", "", false);
  host = made.host;
  pill = made.el;
  Object.assign(host.style, {
    inset: "auto",
    left: "0px",
    top: `calc(100vh - ${PROGRESS_BAND}px)`,
    width: "100vw",
    height: `${PROGRESS_BAND}px`,
    transform: "translate3d(calc(-1 * var(--scroll-left, 0px)), calc(-1 * var(--scroll-top, 0px)), 0)",
    display: "none",
  });
  host.style.setProperty("transition", "none", "important");

  pill.setAttribute("role", "progressbar");
  pill.setAttribute("aria-valuemin", "0");
  pill.setAttribute("aria-valuemax", "100");
  pill.innerHTML = `
    <span class="qs-progress-ring" aria-hidden="true">
      <svg viewBox="0 0 24 24"><circle class="qs-progress-track" cx="12" cy="12" r="9"/><circle class="qs-progress-arc" cx="12" cy="12" r="9"/></svg>
      <svg class="qs-progress-done" viewBox="0 0 24 24"><path d="M6.5 12.5l3.7 3.7 7.3-8"/></svg>
    </span>
    <span class="qs-prog-text"><b></b><small></small></span>
    <span class="qs-progress-pct"></span>
    <span class="qs-progress-bar" aria-hidden="true"><i></i></span>`;
  barFill = pill.querySelector(".qs-progress-bar > i");
  titleEl = pill.querySelector(".qs-prog-text b");
  detailEl = pill.querySelector(".qs-prog-text small");
  pctEl = pill.querySelector(".qs-progress-pct");
  return true;
}

/** Show the pill at 0 %. `total` is the number of frames, when known. */
export function showCaptureProgress({ title = "Capturing page", total = 0 } = {}) {
  if (!build()) return;
  clearTimeout(hideTimer);
  pill.className = "qs-progress";
  titleEl.textContent = title;
  detailEl.textContent = total > 1 ? `Part 1 of ${total} · Esc to stop` : "Esc to stop";
  pctEl.textContent = "0%";
  barFill.style.transform = "scaleX(0)";
  pill.setAttribute("aria-valuenow", "0");
  host.style.display = "";
  applyElementTheme(pill, currentUserTheme);
  shownAt = performance.now();
  // Restart the entrance even if the pill was mid-exit.
  pill.classList.remove("is-in");
  void pill.offsetWidth;
  pill.classList.add("is-in");
}

/** Advance the pill. Safe to call when it is not showing. */
export function setCaptureProgress(done, total) {
  if (!pill || !host || host.style.display === "none") return;
  const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
  barFill.style.transform = `scaleX(${pct / 100})`;
  pctEl.textContent = `${pct}%`;
  pill.setAttribute("aria-valuenow", String(pct));
  if (total > 1) detailEl.textContent = `Part ${Math.min(done + 1, total)} of ${total} · Esc to stop`;
  if (done >= total) setCaptureStitching();
}

/** Frames are in; the image is being put together. */
export function setCaptureStitching() {
  if (!pill || !host || host.style.display === "none") return;
  pill.classList.add("is-stitching");
  titleEl.textContent = "Putting it together";
  detailEl.textContent = "Almost done";
  pctEl.textContent = "";
  barFill.style.transform = "scaleX(1)";
}

/**
 * Leave. "done" shows a check for a beat first; anything else goes at once.
 * The check holds for at least 0.28 s, and a capture that finished very
 * fast still keeps the pill up about 0.45 s in all, so it reads rather
 * than flashes, then hands over to the result pill.
 */
export function hideCaptureProgress(outcome = "done") {
  if (!pill || !host || host.style.display === "none") return Promise.resolve();
  clearTimeout(hideTimer);
  return new Promise((resolve) => {
    const leave = () => {
      pill.classList.add("is-out");
      hideTimer = setTimeout(() => {
        host.style.display = "none";
        pill.className = "qs-progress";
        resolve();
      }, 220);
    };
    if (outcome === "done") {
      pill.classList.remove("is-stitching");
      pill.classList.add("is-done");
      titleEl.textContent = "Captured";
      detailEl.textContent = "Saving the whole page";
      pctEl.textContent = "";
      barFill.style.transform = "scaleX(1)";
      const hold = Math.max(280, 450 - (performance.now() - shownAt));
      hideTimer = setTimeout(leave, hold);
    } else {
      leave();
    }
  });
}

/** Remove immediately, no animation (page teardown, aborts during setup). */
export function removeCaptureProgress() {
  clearTimeout(hideTimer);
  if (host) host.style.display = "none";
}
