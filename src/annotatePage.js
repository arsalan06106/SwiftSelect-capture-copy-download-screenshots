/**
 * Standalone annotation page (annotate.html?id=<capture id>).
 *
 * Reuses the exact editor that runs inside web pages. The editor expects the
 * `window.SwiftSelect` namespace the content script normally provides, so this
 * entry point builds a minimal one: real theme and UI modules, inert event
 * hooks (there is no selection overlay on this page).
 *
 * Built by `npm run build:annotate` into /annotatePage.js.
 */
import * as theme from "./theme.js";
import * as ui from "./ui.js";
import { openAnnotationEditor } from "./capture/annotate.js";
import { getCapture } from "./storage.js";

const noop = () => {};

window.SwiftSelect = {
  theme,
  ui,
  events: { cleanup: noop, removeListeners: noop, addListeners: noop },
};

function fail(message) {
  const el = document.getElementById("loading");
  if (el) el.textContent = message;
}

async function start() {
  theme.init();

  const id = Number(new URLSearchParams(location.search).get("id"));
  if (!id) return fail("No screenshot selected.");

  let record = null;
  try {
    record = await getCapture(id);
  } catch (err) {
    console.error("SwiftSelect: could not read capture", err);
  }
  if (!record?.blob) return fail("This screenshot is no longer in the gallery.");

  // The filename template reads document.title, so mirror the original page.
  if (record.title) document.title = record.title;
  document.getElementById("loading")?.remove();

  await openAnnotationEditor(record.blob, {
    standalone: true,
    title: record.title,
    url: record.url,
    onClose: () => {
      location.href = "gallery.html";
    },
  });
}

start();
