/**
 * Batch Converter: convert, resize and compress images as a view of the
 * Gallery (gallery.html#convert), mounted on first visit like Settings.
 *
 * Lean local conversion pipeline (100% on-device, EXIF always stripped):
 *   - Supports PNG, JPG, WebP, AVIF, GIF, SVG, BMP, ICO
 *   - Converts to Auto (original / smart fallback), JPG, PNG (UPNG.js), WebP, or ICO
 *   - Quality slider OR iterative Target File Size (KB / MB) compression
 *   - Changing settings never wipes or forcibly reconverts already-finished files
 */
import { addCapture, getCapture, formatBytes } from "./src/storage.js";
import { getSettings, DEFAULTS as SETTINGS_DEFAULTS } from "./src/settings.js";
import { downloadBlobFile } from "./src/downloadFile.js";
import { icon, hydrateIcons, enableSheen, mountPill, toast, formatNumber, hideTooltip } from "./src/pageKit.js";
import {
  DEFAULT_PREFS,
  FORMATS,
  normalizePrefs,
  isSupportedImageFile,
  cleanBaseName,
  isGenericImageName,
  renameBrowserDefaultFileName,
  formatConverterFilename,
  uniqueOutputNames,
  computeSavings,
  buildZipBytes,
  describePngQuality,
  isPhotoToPngExpansion,
  conversionSettingsKey,
} from "./src/converter/rules.js";
import { ingestImageFile, convertImageItem } from "./src/converter/engine.js";

// Every element of the view carries a cv- prefix: Settings shares the page.
const $ = (id) => document.getElementById(`cv-${id}`);
const view = () => document.getElementById("convert-view");
/** The converter only takes drops and pastes while its view is showing. */
export const isConverterActive = () => !!view() && !view().hidden;

let prefs = { ...DEFAULT_PREFS };
let namingTemplate = SETTINGS_DEFAULTS.filenameTemplate;
let autoSaveToGallery = SETTINGS_DEFAULTS.autoSaveConvertedToGallery;
let items = []; // { id, name, sourceUrl, addedAt, inputMime, blob, rasterBlob, width, height, url, out, outUrl, outW, outH, outExt, settingsKey, savedToGallery, progress, state, error, el }
let nextId = 1;
let generation = 0; // bumps on explicit abort or clear; stale in-flight results are dropped
let working = false;
let activeController = null;
const pills = {};

function isItemStale(item) {
  return item.state === "done" && !!item.settingsKey && item.settingsKey !== conversionSettingsKey(prefs, item.inputMime);
}

// ─── Settings ────────────────────────────────────────────────────────

function savePrefs() {
  try {
    chrome.storage.local.set({ converterPrefs: prefs });
  } catch {}
}

function setRangeFill(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
  input.style.setProperty("--fill-pct", `${Math.max(0, Math.min(100, pct))}%`);
}

function syncControls() {
  for (const seg of view().querySelectorAll(".seg[data-key]")) {
    const value = String(prefs[seg.dataset.key]);
    seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.value === value)));
    pills[seg.dataset.key]?.();
  }

  $("quality").value = prefs.quality;
  const isIco = prefs.format === "ico";
  const isPng = prefs.format === "png";
  const isAuto = prefs.format === "auto";
  const isLimitWeight = prefs.compressMethod === "limitWeight";

  $("quality-out").textContent = isPng ? `${prefs.quality}% · ${describePngQuality(prefs.quality)}` : `${prefs.quality}%`;
  setRangeFill($("quality"));

  const weightInput = $("target-weight");
  if (document.activeElement !== weightInput) {
    weightInput.value = prefs.targetWeight;
  }
  weightInput.min = prefs.targetWeightUnit === "MB" ? "0.01" : "10";
  weightInput.max = prefs.targetWeightUnit === "MB" ? "100" : "102400";
  weightInput.step = prefs.targetWeightUnit === "MB" ? "0.1" : "50";

  $("scale").value = prefs.scale;
  $("scale-out").textContent = `${prefs.scale}%`;
  setRangeFill($("scale"));
  if (document.activeElement !== $("max-w")) $("max-w").value = prefs.maxW;
  if (document.activeElement !== $("max-h")) $("max-h").value = prefs.maxH;
  if (document.activeElement !== $("suffix")) $("suffix").value = prefs.suffix;
  $("ext-demo").textContent = FORMATS[prefs.format]?.ext || "ext";
  updateNamingPreview();
  $("bg-white").setAttribute("aria-checked", String(prefs.bgWhite));

  const formatNote = $("format-note");
  if (isAuto) {
    formatNote.textContent = "Keeps JPG, PNG & WebP; converts AVIF, GIF, SVG, BMP & ICO to PNG.";
    formatNote.hidden = false;
  } else if (isIco) {
    formatNote.textContent = "Standard Windows / favicon .ico (capped at 256 × 256).";
    formatNote.hidden = false;
  } else if (isPng && !isLimitWeight) {
    formatNote.textContent = "Uses adaptive palette compression below 100%; set Best for lossless.";
    formatNote.hidden = false;
  } else {
    formatNote.hidden = true;
  }

  // ICO is always lossless PNG-in-ICO; JPG, WebP, Auto & PNG all support Quality and Target Size.
  $("method-row").hidden = isIco;
  $("quality-row").hidden = isIco || isLimitWeight;
  $("weight-row").hidden = isIco || !isLimitWeight;
  $("quality-row").classList.remove("is-off");
  $("quality").disabled = false;

  $("bg-row").hidden = prefs.format !== "jpg" && prefs.format !== "auto";
  $("fit-row").hidden = prefs.resize !== "fit";
  $("scale-row").hidden = prefs.resize !== "scale";

  view()
    .querySelectorAll('.cv-presets[data-key="quality"] .chip')
    .forEach((c) => {
      c.classList.toggle("is-on", Number(c.dataset.value) === prefs.quality);
    });
  view()
    .querySelectorAll('.cv-presets[data-key="weight"] .chip')
    .forEach((c) => {
      c.classList.toggle(
        "is-on",
        Number(c.dataset.value) === Number(prefs.targetWeight) && c.dataset.unit === prefs.targetWeightUnit,
      );
    });
  view()
    .querySelectorAll('.cv-presets[data-key="box"] .chip')
    .forEach((c) => {
      c.classList.toggle("is-on", Number(c.dataset.value) === prefs.maxW && Number(c.dataset.value) === prefs.maxH);
    });

  updatePngTip();

  // Re-measure gliding segmented pills after visibility changes.
  requestAnimationFrame(() => Object.values(pills).forEach((sync) => sync()));
}

function updateNamingPreview() {
  const el = $("name-preview");
  if (!el) return;
  const sampleItem = items[0] || { name: "design-shot", sourceUrl: "https://example.com", addedAt: Date.now() };
  const ext = sampleItem.outExt || FORMATS[prefs.format]?.ext || "jpg";
  el.textContent = formatConverterFilename(sampleItem, {
    namingMode: prefs.namingMode,
    template: namingTemplate,
    suffix: prefs.suffix,
    ext,
  });
  const editBtn = $("edit-template");
  if (editBtn) editBtn.hidden = prefs.namingMode !== "template";
}

function updatePngTip() {
  const tip = $("png-tip");
  if (!tip) return;
  const expandedPhoto =
    prefs.format === "png" &&
    items.some(
      (i) => i.state === "done" && i.out && isPhotoToPngExpansion(i.inputMime, "image/png", i.blob.size, i.out.size),
    );
  tip.hidden = !expandedPhoto;
}

function changed(patch) {
  prefs = normalizePrefs({ ...prefs, ...patch });
  syncControls();
  savePrefs();
  // Never wipe or auto-reconvert already-converted files when tweaking settings.
  // Finished items stay intact and calmly show a Reconvert action when settings differ.
  items.forEach(renderRow);
  renderSummary();
  if (compareItem) renderCompare();
}

// ─── Converting queue ────────────────────────────────────────────────

async function saveSingleToGallery(item) {
  if (!item?.out || item.savedToGallery) return false;
  try {
    const rawStem = cleanBaseName(item.name);
    const outFileName = outName(item);
    const galleryTitle =
      prefs.namingMode === "original"
        ? outFileName.replace(/\.[a-z0-9]+$/i, "")
        : isGenericImageName(rawStem)
          ? ""
          : `${rawStem}${prefs.suffix || ""}`;
    await addCapture({
      blob: item.out,
      title: galleryTitle,
      url: item.sourceUrl || "",
      type: "converted",
      width: item.outW,
      height: item.outH,
    });
    item.savedToGallery = true;
    return true;
  } catch {
    return false;
  }
}

async function pump() {
  if (working) return;
  working = true;
  let autoSavedCount = 0;
  renderSummary();
  try {
    for (;;) {
      const gen = generation;
      const item = items.find((i) => i.state === "queued");
      if (!item) break;

      const runPrefs = { ...prefs };
      const runKey = conversionSettingsKey(runPrefs, item.inputMime);

      item.state = "working";
      item.progress = 8;
      item.error = "";
      renderRow(item);
      renderSummary();

      activeController = new AbortController();
      const { signal } = activeController;

      try {
        const out = await convertImageItem(item, runPrefs, {
          signal,
          onProgress: (pct) => {
            if (gen !== generation) return;
            item.progress = pct;
            renderRow(item);
            renderSummary();
          },
        });

        if (gen !== generation || !items.includes(item)) {
          if (items.includes(item) && item.state === "working") item.state = "queued";
          continue;
        }
        if (item.outUrl) URL.revokeObjectURL(item.outUrl);
        item.out = out.blob;
        item.outW = out.width;
        item.outH = out.height;
        item.outExt = out.ext;
        item.outUrl = URL.createObjectURL(out.blob);
        item.settingsKey = runKey;
        item.savedToGallery = false;
        item.progress = 100;
        item.state = "done";

        // Update UI immediately so rows transition cleanly to "done" without waiting on IndexedDB thumbnail writes.
        renderRow(item);
        renderSummary();

        if (autoSaveToGallery) {
          const didSave = await saveSingleToGallery(item);
          if (didSave) autoSavedCount++;
        }
      } catch (err) {
        if (err?.name === "AbortError") {
          if (gen === generation && items.includes(item)) {
            item.state = "aborted";
            item.error = "Stopped";
          }
          continue;
        }
        if (gen !== generation) {
          if (items.includes(item)) item.state = "queued";
          continue;
        }
        item.state = "error";
        item.error = err?.message || "Could not convert";
      } finally {
        activeController = null;
      }

      renderRow(item);
      renderSummary();
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    working = false;
    activeController = null;
    renderSummary();
    if (autoSavedCount > 0) {
      toast(
        autoSavedCount === 1
          ? "Auto-saved to Gallery under Converted"
          : `Auto-saved ${formatNumber(autoSavedCount)} images to Gallery`,
      );
    }
  }
}

function abortBatch() {
  generation++;
  activeController?.abort();
  for (const item of items) {
    if (item.state === "queued" || item.state === "working") {
      item.state = "aborted";
      item.error = "Stopped";
      item.progress = 0;
    }
  }
  items.forEach(renderRow);
  renderSummary();
  toast("Conversion stopped");
}

function reconvertItems(targetItems) {
  const list = targetItems.filter((item) => item.width && item.height);
  if (!list.length) return;
  for (const item of list) {
    item.state = "queued";
    item.progress = 0;
    item.error = "";
    item.savedToGallery = false;
    renderRow(item);
  }
  renderSummary();
  pump();
}

function reconvertStale() {
  const stale = items.filter((item) => isItemStale(item) || item.state === "aborted" || item.state === "error");
  reconvertItems(stale.length ? stale : items);
}

// ─── Adding files ────────────────────────────────────────────────────

async function addBlobs(list, { fromPaste = false } = {}) {
  const incoming = [...(list || [])];
  const files = incoming.filter((f) => f && isSupportedImageFile(f));
  if (!files.length) {
    if (incoming.length) toast("Unsupported file type — drop PNG, JPG, WebP, AVIF, GIF, SVG, BMP, or ICO", { error: true });
    return;
  }

  let failed = 0;
  for (const file of files) {
    try {
      const displayFileName = fromPaste ? renameBrowserDefaultFileName(file.name).renamedFileName : file.name;
      const ingested = await ingestImageFile(file);
      const item = {
        id: nextId++,
        name: cleanBaseName(displayFileName),
        sourceUrl: file._sourceUrl || "",
        addedAt: Date.now(),
        inputMime: ingested.inputMime,
        blob: file,
        rasterBlob: ingested.rasterBlob,
        width: ingested.width,
        height: ingested.height,
        url: URL.createObjectURL(ingested.previewBlob),
        out: null,
        outUrl: "",
        outW: 0,
        outH: 0,
        outExt: "",
        settingsKey: "",
        savedToGallery: false,
        progress: 0,
        state: "queued",
        error: "",
        el: null,
      };
      items.push(item);
      $("list").appendChild(buildRow(item));
    } catch (err) {
      console.warn("SwiftSelect converter: could not read file", file?.name, err);
      failed++;
    }
  }

  if (failed) {
    toast(failed === 1 ? "One image could not be decoded" : `${formatNumber(failed)} images could not be decoded`, { error: true });
  }
  renderSummary();
  pump();
}

function revokeItemUrls(item) {
  if (item.url) URL.revokeObjectURL(item.url);
  if (item.outUrl) URL.revokeObjectURL(item.outUrl);
}

function removeItem(item) {
  const index = items.indexOf(item);
  if (index === -1) return;
  items.splice(index, 1);
  const el = item.el;
  if (el) {
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 320);
  }
  renderSummary();

  let restored = false;
  const timer = setTimeout(() => {
    if (!restored) revokeItemUrls(item);
  }, 6500);

  toast(`Removed ${item.name}`, {
    action: "Undo",
    onAction: () => {
      if (restored) return;
      restored = true;
      clearTimeout(timer);
      const insertAt = Math.min(index, items.length);
      items.splice(insertAt, 0, item);
      const row = buildRow(item);
      const listEl = $("list");
      const refNode = listEl.children[insertAt] || null;
      listEl.insertBefore(row, refNode);
      renderSummary();
      if (item.state === "queued") pump();
    },
  });
}

function clearAll() {
  if (!items.length) return;
  generation++;
  activeController?.abort();
  const snapshot = [...items];
  items = [];
  $("list").replaceChildren();
  renderSummary();

  let restored = false;
  const timer = setTimeout(() => {
    if (!restored) snapshot.forEach(revokeItemUrls);
  }, 6500);

  toast(snapshot.length === 1 ? "Cleared 1 image" : `Cleared ${formatNumber(snapshot.length)} images`, {
    action: "Undo",
    onAction: () => {
      if (restored) return;
      restored = true;
      clearTimeout(timer);
      const listEl = $("list");
      for (const item of snapshot) {
        if (item.state === "working") item.state = "queued";
        items.push(item);
        listEl.appendChild(buildRow(item));
      }
      renderSummary();
      if (items.some((i) => i.state === "queued")) pump();
    },
  });
}

// ─── Rendering ───────────────────────────────────────────────────────

function buildRow(item) {
  const li = document.createElement("li");
  li.className = "cv-item glass is-entering";
  li.style.setProperty("--i", Math.min(items.length, 8));
  li.innerHTML = `
    <button type="button" class="cv-thumb" data-act="preview" aria-label="Inspect and compare image quality" data-tip="Inspect &amp; compare"><img alt="" /><span class="cv-thumb-lens" aria-hidden="true">${icon("search")}</span></button>
    <div class="cv-info">
      <div class="cv-name-line">
        <b class="cv-name"></b>
        <span class="cv-fmt" hidden></span>
        <span class="cv-stale-tag" hidden>Updated settings</span>
      </div>
      <span class="cv-meta"></span>
    </div>
    <div class="cv-result">
      <b class="cv-size"></b>
      <span class="cv-delta"></span>
    </div>
    <span class="cv-state" aria-hidden="true"></span>
    <button type="button" class="act" data-act="reconvert" aria-label="Reconvert with new settings" data-tip="Reconvert with current settings" hidden>${icon("restore")}</button>
    <button type="button" class="act" data-act="retry" aria-label="Retry conversion" data-tip="Try again" hidden>${icon("restore")}</button>
    <button type="button" class="act" data-act="download" aria-label="Download converted image" data-tip="Download">${icon("download")}</button>
    <button type="button" class="act" data-act="remove" aria-label="Remove image" data-tip="Remove">${icon("close")}</button>
    <i class="cv-row-bar" aria-hidden="true"><i></i></i>`;

  // Play entrance animation strictly once so later state changes never blink or replay opacity: 0.
  const finishEnter = () => li.classList.remove("is-entering");
  li.addEventListener("animationend", finishEnter, { once: true });
  setTimeout(finishEnter, 420);

  const img = li.querySelector("img");
  img.src = item.url;
  img.dataset.srcKey = item.url;

  li.querySelector('[data-act="preview"]').onclick = () => openCompare(item);
  li.querySelector('[data-act="download"]').onclick = () => downloadItems([item]);
  li.querySelector('[data-act="remove"]').onclick = () => removeItem(item);
  li.querySelector('[data-act="reconvert"]').onclick = () => reconvertItems([item]);
  li.querySelector('[data-act="retry"]').onclick = () => reconvertItems([item]);
  item.el = li;
  renderRow(item);
  return li;
}

function outName(item) {
  const ext = item.outExt || FORMATS[prefs.format]?.ext || "png";
  return formatConverterFilename(item, {
    namingMode: prefs.namingMode,
    template: namingTemplate,
    suffix: prefs.suffix,
    ext,
  });
}

function swapThumbSmoothly(img, targetSrc) {
  if (!img || !targetSrc || img.dataset.srcKey === targetSrc) return;
  img.dataset.srcKey = targetSrc;
  const loader = new Image();
  loader.src = targetSrc;
  const apply = () => {
    if (img.dataset.srcKey === targetSrc) img.src = targetSrc;
  };
  if (typeof loader.decode === "function") {
    loader.decode().then(apply, apply);
  } else {
    loader.onload = apply;
    loader.onerror = apply;
  }
}

function renderRow(item) {
  const el = item.el;
  if (!el) return;
  const stale = isItemStale(item);
  if (el.dataset.state !== item.state) el.dataset.state = item.state;
  el.dataset.stale = stale ? "true" : "false";

  const nextName = item.state === "done" ? outName(item) : item.name;
  const nameEl = el.querySelector(".cv-name");
  if (nameEl.textContent !== nextName) nameEl.textContent = nextName;

  const fmtBadge = el.querySelector(".cv-fmt");
  if (item.state === "done" && item.outExt) {
    const extLabel = item.outExt.toUpperCase();
    if (fmtBadge.textContent !== extLabel) fmtBadge.textContent = extLabel;
    fmtBadge.hidden = false;
  } else {
    fmtBadge.hidden = true;
  }

  const staleTag = el.querySelector(".cv-stale-tag");
  if (staleTag) staleTag.hidden = !stale;

  const dims = `${formatNumber(item.width)} × ${formatNumber(item.height)}`;
  const size = el.querySelector(".cv-size");
  const delta = el.querySelector(".cv-delta");
  const meta = el.querySelector(".cv-meta");
  const dl = el.querySelector('[data-act="download"]');
  dl.disabled = item.state !== "done";
  el.querySelector('[data-act="retry"]').hidden = item.state !== "error" && item.state !== "aborted";
  const reconvBtn = el.querySelector('[data-act="reconvert"]');
  if (reconvBtn) reconvBtn.hidden = !stale;

  const rowBar = el.querySelector(".cv-row-bar");
  if (rowBar) {
    const pct = item.state === "working" ? Math.max(8, item.progress || 0) : item.state === "done" ? 100 : 0;
    rowBar.style.setProperty("--pct", `${pct}%`);
  }

  // Only swap preview thumbnail when the URL genuinely changes, pre-decoding first to guarantee zero blink.
  const desiredThumb = item.state === "done" && item.outUrl && item.outExt !== "ico" ? item.outUrl : item.url;
  swapThumbSmoothly(el.querySelector(".cv-thumb img"), desiredThumb);

  delta.className = "cv-delta";

  if (item.state === "done") {
    const resized = item.outW !== item.width || item.outH !== item.height;
    meta.textContent = resized
      ? `${dims} → ${formatNumber(item.outW)} × ${formatNumber(item.outH)} · was ${formatBytes(item.blob.size)}`
      : `${dims} · was ${formatBytes(item.blob.size)}`;
    size.textContent = formatBytes(item.out.size);
    const saved = computeSavings(item.blob.size, item.out.size);
    delta.textContent = saved.label;
    if (saved.direction === "smaller") delta.classList.add("is-smaller");
    else if (saved.direction === "larger") delta.classList.add("is-larger");
  } else if (item.state === "error" || item.state === "aborted") {
    meta.textContent = item.error || "Could not convert";
    size.textContent = "—";
    delta.textContent = item.state === "aborted" ? "Stopped" : "Failed";
  } else {
    meta.textContent = `${dims} · ${formatBytes(item.blob.size)}`;
    size.textContent = item.state === "working" ? `${item.progress || 0}%` : "—";
    delta.textContent = item.state === "working" ? "Converting" : "Queued";
  }
}

function renderSummary() {
  const n = items.length;
  const dock = $("summary-dock");
  if (dock) dock.hidden = n === 0;
  $("summary").hidden = n === 0;
  $("drop").classList.toggle("is-compact", n > 0);
  updatePngTip();
  updateNamingPreview();
  if (!n) {
    dock?.classList.remove("is-stuck");
    $("summary").classList.remove("is-stuck");
    return;
  }

  const done = items.filter((i) => i.state === "done");
  const stale = items.filter((i) => isItemStale(i));
  const active = items.find((i) => i.state === "working");
  const busy = working || items.some((i) => i.state === "queued" || i.state === "working");
  const before = items.reduce((s, i) => s + i.blob.size, 0);
  const after = done.reduce((s, i) => s + i.out.size, 0);
  const beforeDone = done.reduce((s, i) => s + i.blob.size, 0);

  const overallPct = n
    ? Math.round(
        items.reduce((acc, i) => acc + (i.state === "done" ? 100 : i.state === "working" ? i.progress || 0 : 0), 0) / n,
      )
    : 0;

  $("sum-title").textContent = `${formatNumber(n)} ${n === 1 ? "image" : "images"}`;
  $("sum-detail").textContent = busy
    ? active
      ? `Converting ${active.name} (${overallPct}%)…`
      : `Converting ${formatNumber(done.length)} of ${formatNumber(n)}…`
    : stale.length
      ? `${formatBytes(before)} → ${formatBytes(after)} · Settings changed`
      : `${formatBytes(before)} → ${formatBytes(after)}`;

  const saving = $("sum-saving");
  const stats = computeSavings(beforeDone, after);
  saving.hidden = busy || !done.length || stats.direction === "same";
  saving.textContent = stats.direction === "smaller" ? `${stats.pct}% smaller` : `${stats.pct}% larger`;
  saving.classList.toggle("is-larger", stats.direction === "larger");

  $("summary").classList.toggle("is-busy", busy);
  $("progress").style.setProperty("--pct", `${overallPct}%`);
  $("abort").hidden = !busy;

  const reconvBtn = $("reconvert");
  const reconvLabel = $("reconvert-label");
  if (reconvBtn) {
    reconvBtn.hidden = busy || stale.length === 0;
    if (reconvLabel) {
      reconvLabel.textContent = stale.length === n ? "Reconvert" : `Reconvert ${formatNumber(stale.length)}`;
    }
  }

  $("download-all").disabled = !done.length || busy;
  $("save-gallery").disabled = !done.length || busy;
  $("zip").hidden = done.length < 2;
  $("zip").disabled = busy;
  $("download-label").textContent = done.length > 1 ? `Download ${formatNumber(done.length)} files` : "Download";
}

// ─── Interactive Split / Original / Converted quality inspector ──────

let compareItem = null;
let compareMode = "split";
let compareSplitPct = 50;
let comparePillSync = null;
let compareCloseTimer = 0;

function setSplitPercent(pct) {
  compareSplitPct = Math.max(2, Math.min(98, pct));
  const split = $("split");
  if (!split) return;
  split.style.setProperty("--split", `${compareSplitPct.toFixed(2)}%`);
  split.setAttribute("aria-valuenow", String(Math.round(compareSplitPct)));
}

function renderCompare() {
  if (!compareItem) return;
  const canCompare = compareItem.state === "done" && !!compareItem.outUrl && compareItem.outExt !== "ico";
  if (!canCompare && compareMode !== "original") compareMode = "original";

  const isSplit = compareMode === "split" && canCompare;
  $("split").hidden = !isSplit;
  $("compare-img").hidden = isSplit;

  if (isSplit) {
    $("split-orig").src = compareItem.url;
    $("split-conv").src = compareItem.outUrl;
    const saved = computeSavings(compareItem.blob.size, compareItem.out.size);
    $("split-badge-l").textContent = `Original · ${formatBytes(compareItem.blob.size)}`;
    $("split-badge-r").textContent = `${(compareItem.outExt || "").toUpperCase()} · ${formatBytes(compareItem.out.size)}${saved.direction !== "same" ? ` (${saved.label})` : ""}`;
    setSplitPercent(compareSplitPct);
  } else {
    const useConverted = compareMode === "converted" && canCompare;
    $("compare-img").src = useConverted ? compareItem.outUrl : compareItem.url;
  }

  $("compare-title").textContent = compareItem.state === "done" ? outName(compareItem) : compareItem.name;
  const origDims = `${formatNumber(compareItem.width)} × ${formatNumber(compareItem.height)}`;
  if (compareItem.state === "done" && compareItem.out) {
    const outDims = `${formatNumber(compareItem.outW)} × ${formatNumber(compareItem.outH)}`;
    const dimsText = compareItem.outW !== compareItem.width || compareItem.outH !== compareItem.height ? `${origDims} → ${outDims}` : origDims;
    const saved = computeSavings(compareItem.blob.size, compareItem.out.size);
    $("compare-stats").textContent =
      compareMode === "original"
        ? `Original · ${origDims} · ${formatBytes(compareItem.blob.size)}`
        : compareMode === "split"
          ? `${dimsText} · ${formatBytes(compareItem.blob.size)} → ${formatBytes(compareItem.out.size)} (${saved.label})`
          : `${(compareItem.outExt || "").toUpperCase()} · ${outDims} · ${formatBytes(compareItem.out.size)} (${saved.label})`;
  } else {
    $("compare-stats").textContent = `${origDims} · ${formatBytes(compareItem.blob.size)}`;
  }

  const dlBtn = $("compare-dl");
  if (dlBtn) dlBtn.disabled = compareItem.state !== "done";

  $("compare-seg")
    .querySelectorAll("button")
    .forEach((b) => {
      b.setAttribute("aria-checked", String(b.dataset.mode === compareMode));
      if (b.dataset.mode === "converted" || b.dataset.mode === "split") {
        b.disabled = !canCompare;
      }
    });
  requestAnimationFrame(() => comparePillSync?.());
}

function openCompare(item) {
  hideTooltip();
  clearTimeout(compareCloseTimer);
  compareItem = item;
  const canCompare = item.state === "done" && !!item.outUrl && item.outExt !== "ico";
  compareMode = canCompare ? "split" : "original";
  compareSplitPct = 50;
  const modal = $("compare");
  modal.hidden = false;
  renderCompare();
  requestAnimationFrame(() => {
    modal.classList.add("is-open");
    comparePillSync?.();
  });
}

function closeCompare() {
  const modal = $("compare");
  if (!modal || modal.hidden) return;
  modal.classList.remove("is-open");
  compareItem = null;
  clearTimeout(compareCloseTimer);
  compareCloseTimer = setTimeout(() => {
    if (!compareItem) modal.hidden = true;
  }, 190);
}

// ─── Output ──────────────────────────────────────────────────────────

function namingOptions() {
  return { namingMode: prefs.namingMode, template: namingTemplate };
}

/** Every result as its own file, the way a gallery selection downloads. */
function downloadItems(list) {
  const ready = list.filter((i) => i.state === "done");
  if (!ready.length) return;
  const names = uniqueOutputNames(ready, prefs.suffix, namingOptions());
  ready.forEach((item, i) => {
    const run = () => downloadBlobFile(item.out, names[i]);
    // Trigger index 0 synchronously inside the click gesture so strict browser/iframe download policies honor filename.
    if (i === 0) run();
    else setTimeout(run, i * 140);
  });
  toast(ready.length === 1 ? "Download started" : `Downloading ${formatNumber(ready.length)} files`);
}

async function downloadZip(list) {
  const ready = list.filter((i) => i.state === "done");
  if (!ready.length) return;
  const names = uniqueOutputNames(ready, prefs.suffix, namingOptions());
  const btn = $("zip");
  btn.disabled = true;
  try {
    const zipBytes = await buildZipBytes(ready.map((item, i) => ({ name: names[i], blob: item.out })));
    const zip = new Blob([zipBytes], { type: "application/zip" });
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    downloadBlobFile(zip, `SwiftSelect converted ${stamp}.zip`);
    toast(`Downloading ${formatNumber(ready.length)} files as one ZIP`);
  } catch (err) {
    toast("Could not build the ZIP", { error: true });
    console.warn("SwiftSelect: zip failed", err);
  } finally {
    btn.disabled = false;
  }
}

let _savingToGallery = false;
async function saveToGallery() {
  const ready = items.filter((i) => i.state === "done");
  if (!ready.length || _savingToGallery) return;
  const unsaved = ready.filter((i) => !i.savedToGallery);
  if (!unsaved.length) {
    toast(ready.length === 1 ? "Already saved to Gallery" : "All converted images are already in Gallery");
    return;
  }
  _savingToGallery = true;
  const btn = $("save-gallery");
  const label = btn?.querySelector("span");
  if (btn) btn.disabled = true;
  let saved = 0;
  try {
    for (const item of unsaved) {
      if (await saveSingleToGallery(item)) saved++;
    }
    if (saved) {
      toast(saved === 1 ? "Saved to Gallery under Converted" : `Saved ${formatNumber(saved)} images to Gallery under Converted`);
      if (btn && label) {
        const origLabel = label.textContent;
        btn.classList.add("is-saved-flash");
        label.textContent = "Saved!";
        setTimeout(() => {
          btn.classList.remove("is-saved-flash");
          label.textContent = origLabel;
        }, 1400);
      }
    } else {
      toast("Could not save to the Gallery", { error: true });
    }
  } finally {
    _savingToGallery = false;
    renderSummary();
  }
}

// ─── Wiring ──────────────────────────────────────────────────────────

let mountPromise = null;

/** Add gallery captures to the batch (bulk Convert in the Gallery). */
export async function addCaptureIds(ids = []) {
  const blobs = [];
  for (const id of ids) {
    try {
      const r = await getCapture(id);
      if (!r?.blob) continue;
      const ext = (r.blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
      const file = new File([r.blob], `${r.title || "capture"}.${ext}`, { type: r.blob.type || "image/png" });
      if (r.url) file._sourceUrl = r.url;
      blobs.push(file);
    } catch {}
  }
  if (blobs.length) await addBlobs(blobs);
}

/** Build the view once; later calls wait for that and re-sync the pills. */
export function mountConverter() {
  if (mountPromise) {
    return mountPromise.then(() => Object.values(pills).forEach((sync) => sync()));
  }
  mountPromise = setup();
  return mountPromise;
}

async function setup() {
  hydrateIcons(view());
  enableSheen(view());

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("compare").hidden) closeCompare();
  });

  try {
    const [data, settings] = await Promise.all([chrome.storage.local.get(["converterPrefs"]), getSettings()]);
    prefs = normalizePrefs(data?.converterPrefs || {});
    namingTemplate = settings?.filenameTemplate || SETTINGS_DEFAULTS.filenameTemplate;
    autoSaveToGallery = settings?.autoSaveConvertedToGallery === true;
  } catch {
    prefs = normalizePrefs({});
    namingTemplate = SETTINGS_DEFAULTS.filenameTemplate;
    autoSaveToGallery = SETTINGS_DEFAULTS.autoSaveConvertedToGallery;
  }
  savePrefs();

  // Keep converter settings live-synced with Settings page changes.
  try {
    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes.filenameTemplate) {
        const next = changes.filenameTemplate.newValue;
        namingTemplate = typeof next === "string" && next.trim() ? next.trim() : SETTINGS_DEFAULTS.filenameTemplate;
        updateNamingPreview();
        items.forEach(renderRow);
        if (compareItem) renderCompare();
      }
      if (changes.autoSaveConvertedToGallery) {
        autoSaveToGallery = changes.autoSaveConvertedToGallery.newValue === true;
      }
    });
  } catch {}

  // Observe scroll position so the sticky summary bar elevates cleanly over scrolled rows.
  const sentinel = $("summary-sentinel");
  const dock = $("summary-dock");
  const scrollRoot = view();
  if (sentinel && dock && scrollRoot && typeof IntersectionObserver !== "undefined") {
    new IntersectionObserver(
      ([entry]) => {
        const stuck = !entry.isIntersecting && items.length > 0;
        dock.classList.toggle("is-stuck", stuck);
        $("summary")?.classList.toggle("is-stuck", stuck);
      },
      { root: scrollRoot, threshold: 0 },
    ).observe(sentinel);
  }

  for (const seg of view().querySelectorAll(".seg[data-key]")) {
    pills[seg.dataset.key] = mountPill(seg, '[aria-checked="true"]');
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-value]");
      if (!b) return;
      const key = seg.dataset.key;
      const val = b.dataset.value;
      if (key === "namingMode") {
        changed({ namingMode: val });
        return;
      }
      // When toggling KB <-> MB, convert the visible default nicely if switching units.
      if (key === "targetWeightUnit" && val !== prefs.targetWeightUnit) {
        const nextWeight = val === "MB" ? Math.max(0.1, Number((prefs.targetWeight / 1024).toFixed(2))) : Math.round(prefs.targetWeight * 1024);
        changed({ targetWeightUnit: val, targetWeight: nextWeight });
        return;
      }
      changed({ [key]: val });
    });
  }

  // The folded Output card remembers whether it was left open.
  const output = $("output");
  if (output) {
    try {
      output.open = localStorage.getItem("ss.cvOutputOpen") === "1";
    } catch {}
    output.addEventListener("toggle", () => {
      try {
        localStorage.setItem("ss.cvOutputOpen", output.open ? "1" : "0");
      } catch {}
    });
  }

  $("edit-template")?.addEventListener("click", () => {
    location.hash = "#settings";
    setTimeout(() => {
      const input = document.getElementById("template");
      if (input) {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        input.focus({ preventScroll: true });
      }
    }, 120);
  });

  // Portal the compare modal directly onto <body> so its backdrop always covers
  // the full viewport (sidebar included), never trapped by view stacking contexts.
  const compareModal = $("compare");
  if (compareModal && compareModal.parentElement !== document.body) {
    document.body.appendChild(compareModal);
  }

  const compareSeg = $("compare-seg");
  if (compareSeg) {
    comparePillSync = mountPill(compareSeg, '[aria-checked="true"]');
    compareSeg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-mode]");
      if (!b || b.disabled) return;
      compareMode = b.dataset.mode;
      renderCompare();
    });
  }
  $("compare-dl")?.addEventListener("click", () => {
    if (compareItem && compareItem.state === "done") downloadItems([compareItem]);
  });
  $("compare-close")?.addEventListener("click", closeCompare);
  $("compare")?.addEventListener("click", (e) => {
    if (e.target === $("compare")) closeCompare();
  });

  // Interactive pointer + keyboard scrubbing for the Split Before/After curtain.
  const splitEl = $("split");
  if (splitEl) {
    const updateFromClientX = (clientX) => {
      const rect = splitEl.getBoundingClientRect();
      if (!rect.width) return;
      setSplitPercent(((clientX - rect.left) / rect.width) * 100);
    };
    let draggingSplit = false;
    splitEl.addEventListener("pointerdown", (e) => {
      draggingSplit = true;
      splitEl.classList.add("is-dragging");
      splitEl.setPointerCapture?.(e.pointerId);
      updateFromClientX(e.clientX);
    });
    splitEl.addEventListener("pointermove", (e) => {
      if (draggingSplit) updateFromClientX(e.clientX);
    });
    const endDrag = () => {
      draggingSplit = false;
      splitEl.classList.remove("is-dragging");
    };
    splitEl.addEventListener("pointerup", endDrag);
    splitEl.addEventListener("pointercancel", endDrag);
    splitEl.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 1 : 5;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSplitPercent(compareSplitPct - step);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSplitPercent(compareSplitPct + step);
      }
    });
  }

  window.addEventListener("keydown", (e) => {
    if (!compareItem || $("compare").hidden) return;
    if (e.key === " " && !e.target?.closest?.("button, input")) {
      e.preventDefault();
      if (compareItem.state === "done" && compareItem.outExt !== "ico") {
        compareMode = compareMode === "original" ? "converted" : "original";
        renderCompare();
      }
    }
  });

  syncControls();

  $("switch-webp")?.addEventListener("click", () => {
    changed({ format: "webp" });
    reconvertStale();
  });

  $("quality").addEventListener("input", (e) => changed({ quality: e.target.value }));
  $("target-weight").addEventListener("input", (e) => changed({ targetWeight: e.target.value }));
  $("scale").addEventListener("input", (e) => changed({ scale: e.target.value }));
  $("max-w").addEventListener("input", (e) => changed({ maxW: e.target.value }));
  $("max-h").addEventListener("input", (e) => changed({ maxH: e.target.value }));
  $("suffix").addEventListener("input", (e) => {
    prefs = normalizePrefs({ ...prefs, suffix: e.target.value });
    updateNamingPreview();
    savePrefs();
    items.forEach(renderRow);
    if (compareItem) renderCompare();
  });
  $("bg-white").addEventListener("click", () => changed({ bgWhite: !prefs.bgWhite }));

  view()
    .querySelector('.cv-presets[data-key="quality"]')
    .addEventListener("click", (e) => {
      const c = e.target.closest(".chip");
      if (c) changed({ quality: c.dataset.value });
    });
  view()
    .querySelector('.cv-presets[data-key="weight"]')
    .addEventListener("click", (e) => {
      const c = e.target.closest(".chip");
      if (c) changed({ targetWeight: c.dataset.value, targetWeightUnit: c.dataset.unit || "KB" });
    });
  view()
    .querySelector('.cv-presets[data-key="box"]')
    .addEventListener("click", (e) => {
      const c = e.target.closest(".chip");
      if (c) changed({ maxW: c.dataset.value, maxH: c.dataset.value });
    });

  // Files: picker, drop anywhere on the view, paste.
  const drop = $("drop");
  $("file").addEventListener("change", (e) => {
    addBlobs(e.target.files);
    e.target.value = "";
  });
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      $("file").click();
    }
  });
  let depth = 0;
  const hasFiles = (e) => isConverterActive() && [...(e.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    drop.classList.add("is-over");
  });
  window.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) drop.classList.remove("is-over");
  });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    drop.classList.remove("is-over");
    addBlobs(e.dataTransfer.files);
  });
  window.addEventListener("blur", () => {
    depth = 0;
    drop.classList.remove("is-over");
  });
  window.addEventListener("paste", (e) => {
    if (!isConverterActive() || e.target.closest?.("input, textarea")) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      addBlobs(files, { fromPaste: true });
    }
  });

  $("abort").addEventListener("click", abortBatch);
  $("reconvert")?.addEventListener("click", reconvertStale);
  $("clear").addEventListener("click", clearAll);
  $("download-all").addEventListener("click", () => downloadItems(items));
  $("zip").addEventListener("click", () => downloadZip(items));
  $("save-gallery").addEventListener("click", saveToGallery);
}
