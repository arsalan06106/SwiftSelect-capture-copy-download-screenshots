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

async function launchEditor(blob, meta = {}) {
  document.getElementById("loading")?.remove();
  document.getElementById("annotate-empty")?.remove();
  if (meta.title) document.title = meta.title;
  await openAnnotationEditor(blob, {
    standalone: true,
    title: meta.title || "Annotated Image",
    url: meta.url || "",
    onClose: () => {
      location.href = "gallery.html";
    },
  });
}

function showEmptyState(title, message) {
  const loading = document.getElementById("loading");
  if (loading) loading.remove();

  const card = document.createElement("section");
  card.id = "annotate-empty";
  card.className = "annotate-empty glass";
  card.setAttribute("role", "region");
  card.setAttribute("aria-label", "Annotation Editor");
  card.innerHTML = `
    <div class="annotate-empty-glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    </div>
    <h1></h1>
    <p></p>
    <div class="annotate-empty-actions">
      <label class="btn btn-primary">
        <input type="file" id="annotate-pick" accept="image/*" hidden />
        <span>Open Image…</span>
      </label>
      <a class="btn" href="gallery.html">Open Swift Gallery</a>
    </div>
  `;
  card.querySelector("h1").textContent = title;
  card.querySelector("p").textContent = message;
  card.querySelector("#annotate-pick").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    launchEditor(file, { title: file.name.replace(/\.[^.]+$/, "") });
  });
  document.body.appendChild(card);
}

async function start() {
  theme.init();

  const id = Number(new URLSearchParams(location.search).get("id"));
  if (!id) {
    return showEmptyState(
      "Ready to annotate",
      "Choose a capture from Swift Gallery or open any image file from your device.",
    );
  }

  let record = null;
  try {
    record = await getCapture(id);
  } catch (err) {
    console.error("SwiftSelect: could not read capture", err);
  }
  if (!record?.blob) {
    return showEmptyState(
      "Screenshot unavailable",
      "This capture is no longer in the gallery. Open another image or return to Swift Gallery.",
    );
  }

  await launchEditor(record.blob, { title: record.title, url: record.url });
}

start();
