/**
 * Settings tab of the capture toolbar's panel: the settings people change
 * most, applied the moment they change, laid out to fit without scrolling.
 * Shortcuts, retention and the file name template stay on the full
 * Settings page ("All settings").
 */
import { getSettings, setSettings, wantsCopy, wantsDownload, destinationFromToggles } from "./settings.js";
import { pickToolbarLook } from "./capture/utils.js";

const CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

function field(label, key, options) {
  return `<div class="qs-ps-field"><span class="qs-ps-label">${label}</span>
    <div class="qs-ps-seg" role="radiogroup" aria-label="${label}" data-key="${key}">${options
      .map(([v, text]) => `<button type="button" role="radio" data-value="${v}">${text}</button>`)
      .join("")}</div></div>`;
}

function chip(key, label) {
  return `<button type="button" class="qs-ps-chip" role="switch" data-toggle="${key}"><i>${CHECK}</i>${label}</button>`;
}

export function mountSettingsTab(root) {
  root.innerHTML = `
    <div class="qs-ps">
      <div class="qs-ps-grid">
        ${field("Theme", "userTheme", [["light", "Light"], ["dark", "Dark"], ["system", "Auto"]])}
        ${field("Colour", "uiColour", [["dynamic", "Dynamic"], ["calm", "Calm"], ["plain", "Plain"]])}
        ${field("Format", "outputFormat", [["png", "PNG"], ["jpg", "JPG"], ["webp", "WebP"]])}
        ${field("Delay", "captureDelay", [["0", "Off"], ["3", "3 s"], ["5", "5 s"]])}
      </div>
      <div class="qs-ps-field qs-ps-quality">
        <span class="qs-ps-label">Quality <b class="qs-ps-q"></b></span>
        <input type="range" min="50" max="100" step="1" data-range="outputQuality" aria-label="Quality">
      </div>
      <div class="qs-ps-field">
        <span class="qs-ps-label">After a capture</span>
        <div class="qs-ps-chips">
          ${chip("copy", "Copy")}
          ${chip("download", "Save file")}
          ${chip("saveToGallery", "Gallery")}
          ${chip("captureFlash", "Flash")}
        </div>
      </div>
    </div>`;

  let settings = null;

  const render = () => {
    if (!settings) return;
    root.querySelectorAll(".qs-ps-seg").forEach((group) => {
      const value = String(settings[group.dataset.key]);
      group.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.value === value)));
    });
    const lossless = settings.outputFormat === "png";
    const q = root.querySelector('[data-range="outputQuality"]');
    q.value = String(Math.round(settings.outputQuality * 100));
    q.disabled = lossless;
    q.style.setProperty("--fill", `${((q.value - 50) / 50) * 100}%`);
    root.querySelector(".qs-ps-quality").classList.toggle("is-off", lossless);
    root.querySelector(".qs-ps-q").textContent = lossless ? "PNG is lossless" : q.value;
    const on = {
      copy: wantsCopy(settings.outputDestination),
      download: wantsDownload(settings.outputDestination),
      saveToGallery: settings.saveToGallery,
      captureFlash: settings.captureFlash,
    };
    root.querySelectorAll("[data-toggle]").forEach((b) => b.setAttribute("aria-checked", String(!!on[b.dataset.toggle])));
  };

  const save = (patch) => {
    settings = { ...settings, ...patch };
    render();
    setSettings(patch);
  };

  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || !settings) return;
    const group = b.closest("[data-key]");
    if (group) {
      const key = group.dataset.key;
      const value = key === "captureDelay" ? Number(b.dataset.value) : b.dataset.value;
      save({ [key]: value });
      if (key === "uiColour") {
        // Show the change on this toolbar straight away.
        const guide = root.closest(".qs-guide");
        setTimeout(() => guide && (guide.dataset.look = pickToolbarLook()), 120);
      }
      return;
    }
    const t = b.dataset.toggle;
    if (!t) return;
    if (t === "copy" || t === "download") {
      const copy = t === "copy" ? !wantsCopy(settings.outputDestination) : wantsCopy(settings.outputDestination);
      const download = t === "download" ? !wantsDownload(settings.outputDestination) : wantsDownload(settings.outputDestination);
      save({ outputDestination: destinationFromToggles(copy, download) });
    } else {
      save({ [t]: !settings[t] });
    }
  });
  const range = root.querySelector('[data-range="outputQuality"]');
  range.addEventListener("input", () => {
    root.querySelector(".qs-ps-q").textContent = range.value;
    range.style.setProperty("--fill", `${((range.value - 50) / 50) * 100}%`);
  });
  range.addEventListener("change", () => save({ outputQuality: Number(range.value) / 100 }));

  // Stay in step with changes made elsewhere (the Settings page, another tab).
  const onChanged = (changes, area) => {
    if (!root.isConnected) {
      chrome.storage.onChanged.removeListener(onChanged);
      return;
    }
    if (area !== "local") return;
    getSettings().then((next) => {
      settings = next;
      render();
    });
  };
  try {
    chrome.storage.onChanged.addListener(onChanged);
  } catch {}

  getSettings().then((s) => {
    settings = s;
    render();
  });
}
