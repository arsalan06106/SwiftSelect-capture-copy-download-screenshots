/**
 * Batch Converter: convert, resize and compress images, as a view of the
 * Gallery (gallery.html#convert), mounted on first visit like Settings.
 *
 * Everything runs in this page with the browser's own codecs. Files are
 * never uploaded. Every change to the settings re-converts the whole batch
 * in the background, so the size next to each file is always the real size
 * of what "Download all" will hand over, not an estimate.
 *
 * Results can be downloaded as separate files (like a gallery selection) or
 * as one ZIP, and saved to the Gallery under their own type, "converted".
 */
import { addCapture, getCapture, formatBytes } from "./src/storage.js";
import { icon, hydrateIcons, enableSheen, mountPill, toast, formatNumber } from "./src/pageKit.js";

// Every element of the view carries a cv- prefix: Settings shares the page.
const $ = (id) => document.getElementById(`cv-${id}`);
const view = () => document.getElementById("convert-view");
/** The converter only takes drops and pastes while its view is showing. */
export const isConverterActive = () => !!view() && !view().hidden;

const FORMATS = {
  jpg: { ext: "jpg", mime: "image/jpeg", lossy: true },
  png: { ext: "png", mime: "image/png", lossy: false },
  webp: { ext: "webp", mime: "image/webp", lossy: true },
};

const PREFS_VERSION = 2;
const DEFAULT_PREFS = {
  v: PREFS_VERSION,
  format: "jpg",
  quality: 92,
  resize: "none", // none | fit | scale
  maxW: "",
  maxH: "",
  scale: 50,
  suffix: "",
  bgWhite: true,
};

let prefs = { ...DEFAULT_PREFS };
let items = []; // { id, name, blob, width, height, url, out, outUrl, outW, outH, state, error, el }
let nextId = 1;
let generation = 0; // bumps on every settings change; stale results are dropped
let working = false;
const pills = {};

// ─── Settings ────────────────────────────────────────────────────────

function normalizePrefs(raw = {}) {
  const p = { ...DEFAULT_PREFS, ...raw };
  // Version 1 defaulted to 82; the default is now 92, so earlier saved
  // settings move up once.
  if (raw && raw.v !== PREFS_VERSION) {
    p.quality = 92;
    p.v = PREFS_VERSION;
  }
  if (!FORMATS[p.format]) p.format = "jpg";
  p.quality = Math.min(100, Math.max(30, Math.round(Number(p.quality) || 92)));
  if (!["none", "fit", "scale"].includes(p.resize)) p.resize = "none";
  p.scale = Math.min(100, Math.max(10, Math.round(Number(p.scale) || 50)));
  const dim = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(20000, n) : "";
  };
  p.maxW = dim(p.maxW);
  p.maxH = dim(p.maxH);
  p.suffix = String(p.suffix || "").replace(/[<>:"/\\|?*\x00-\x1F]/g, "").slice(0, 40);
  p.bgWhite = p.bgWhite !== false;
  return p;
}

function savePrefs() {
  try {
    chrome.storage.local.set({ converterPrefs: prefs });
  } catch {}
}

function setRangeFill(input) {
  const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
  input.style.setProperty("--fill-pct", `${pct}%`);
}

function syncControls() {
  for (const seg of view().querySelectorAll(".seg[data-key]")) {
    const value = String(prefs[seg.dataset.key]);
    seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.value === value)));
    pills[seg.dataset.key]?.();
  }
  $("quality").value = prefs.quality;
  $("quality-out").textContent = prefs.quality;
  setRangeFill($("quality"));
  $("scale").value = prefs.scale;
  $("scale-out").textContent = `${prefs.scale}%`;
  setRangeFill($("scale"));
  $("max-w").value = prefs.maxW;
  $("max-h").value = prefs.maxH;
  $("suffix").value = prefs.suffix;
  $("suffix-demo").textContent = prefs.suffix;
  $("bg-white").setAttribute("aria-checked", String(prefs.bgWhite));

  const lossy = FORMATS[prefs.format].lossy;
  $("quality-row").classList.toggle("is-off", !lossy);
  $("quality").disabled = !lossy;
  $("bg-row").hidden = prefs.format !== "jpg";
  $("fit-row").hidden = prefs.resize !== "fit";
  $("scale-row").hidden = prefs.resize !== "scale";

  view().querySelectorAll('.cv-presets[data-key="quality"] .chip').forEach((c) => {
    c.classList.toggle("is-on", Number(c.dataset.value) === prefs.quality);
  });
  view().querySelectorAll('.cv-presets[data-key="box"] .chip').forEach((c) => {
    c.classList.toggle("is-on", Number(c.dataset.value) === prefs.maxW && Number(c.dataset.value) === prefs.maxH);
  });
}

let _rerunTimer = null;
function changed(patch, { delay = 220 } = {}) {
  prefs = normalizePrefs({ ...prefs, ...patch });
  syncControls();
  savePrefs();
  clearTimeout(_rerunTimer);
  _rerunTimer = setTimeout(reconvertAll, delay);
}

// ─── Converting ──────────────────────────────────────────────────────

function targetSize(w, h) {
  if (prefs.resize === "scale") {
    const k = prefs.scale / 100;
    return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
  }
  if (prefs.resize === "fit" && (prefs.maxW || prefs.maxH)) {
    const k = Math.min(1, prefs.maxW ? prefs.maxW / w : 1, prefs.maxH ? prefs.maxH / h : 1);
    return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
  }
  return [w, h];
}

/** Decode to something drawable. SVG and odd files go through <img>. */
async function decode(blob, w, h) {
  try {
    const opts = w && h ? { resizeWidth: w, resizeHeight: h, resizeQuality: "high" } : undefined;
    return await createImageBitmap(blob, opts);
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

async function convertOne(item, p) {
  const [w, h] = targetSize(item.width, item.height);
  const fmt = FORMATS[p.format];
  const source = await decode(item.blob, w, h);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { alpha: p.format !== "jpg" });
  if (p.format === "jpg") {
    ctx.fillStyle = p.bgWhite ? "#fff" : "#000";
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  source.close?.();
  const blob = await canvas.convertToBlob({ type: fmt.mime, quality: fmt.lossy ? p.quality / 100 : undefined });
  return { blob, w, h };
}

async function pump() {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const gen = generation;
      const item = items.find((i) => i.state === "queued");
      if (!item) break;
      item.state = "working";
      renderRow(item);
      try {
        const out = await convertOne(item, prefs);
        if (gen !== generation || !items.includes(item)) {
          if (items.includes(item)) item.state = "queued";
          continue;
        }
        if (item.outUrl) URL.revokeObjectURL(item.outUrl);
        item.out = out.blob;
        item.outW = out.w;
        item.outH = out.h;
        item.outUrl = URL.createObjectURL(out.blob);
        item.state = "done";
      } catch (err) {
        if (gen !== generation) {
          item.state = "queued";
          continue;
        }
        item.state = "error";
        item.error = err?.message || "Could not convert";
      }
      renderRow(item);
      renderSummary();
      // Let the page paint between files.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    working = false;
    renderSummary();
  }
}

function reconvertAll() {
  generation++;
  for (const item of items) {
    if (item.state !== "error" || item.width) item.state = "queued";
  }
  items.forEach(renderRow);
  renderSummary();
  pump();
}

// ─── Adding files ────────────────────────────────────────────────────

function cleanName(name) {
  return String(name || "image").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[<>:"/\\|?*\x00-\x1F]/g, " ").trim() || "image";
}

async function addBlobs(list) {
  const files = [...list].filter((f) => f && (f.type?.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif|svg|ico)$/i.test(f.name || "")));
  if (!files.length) {
    if ([...list].length) toast("Those files are not images", { error: true });
    return;
  }
  let failed = 0;
  for (const file of files) {
    try {
      const probe = await decode(file);
      const width = probe.width || probe.naturalWidth;
      const height = probe.height || probe.naturalHeight;
      probe.close?.();
      if (!width || !height) throw new Error("empty");
      const item = {
        id: nextId++,
        name: cleanName(file.name),
        blob: file,
        width,
        height,
        url: URL.createObjectURL(file),
        state: "queued",
      };
      items.push(item);
      $("list").appendChild(buildRow(item));
    } catch {
      failed++;
    }
  }
  if (failed) toast(failed === 1 ? "One file could not be read" : `${formatNumber(failed)} files could not be read`, { error: true });
  renderSummary();
  pump();
}

function removeItem(item) {
  items = items.filter((i) => i !== item);
  URL.revokeObjectURL(item.url);
  if (item.outUrl) URL.revokeObjectURL(item.outUrl);
  const el = item.el;
  el.classList.add("is-leaving");
  el.addEventListener("animationend", () => el.remove(), { once: true });
  setTimeout(() => el.remove(), 320);
  renderSummary();
}

function clearAll() {
  generation++;
  for (const item of items) {
    URL.revokeObjectURL(item.url);
    if (item.outUrl) URL.revokeObjectURL(item.outUrl);
  }
  items = [];
  $("list").replaceChildren();
  renderSummary();
}

// ─── Rendering ───────────────────────────────────────────────────────

function buildRow(item) {
  const li = document.createElement("li");
  li.className = "cv-item glass";
  li.style.setProperty("--i", Math.min(items.length, 10));
  li.innerHTML = `
    <span class="cv-thumb"><img alt="" /></span>
    <div class="cv-info">
      <b class="cv-name"></b>
      <span class="cv-meta"></span>
    </div>
    <div class="cv-result">
      <b class="cv-size"></b>
      <span class="cv-delta"></span>
    </div>
    <span class="cv-state" aria-hidden="true"></span>
    <button type="button" class="act" data-act="retry" data-tip="Try again" hidden>${icon("restore")}</button>
    <button type="button" class="act" data-act="download" data-tip="Download">${icon("download")}</button>
    <button type="button" class="act" data-act="remove" data-tip="Remove">${icon("close")}</button>`;
  li.querySelector("img").src = item.url;
  li.querySelector('[data-act="download"]').onclick = () => downloadItems([item]);
  li.querySelector('[data-act="remove"]').onclick = () => removeItem(item);
  li.querySelector('[data-act="retry"]').onclick = () => {
    item.state = "queued";
    item.error = "";
    renderRow(item);
    renderSummary();
    pump();
  };
  item.el = li;
  renderRow(item);
  return li;
}

function outName(item) {
  return `${item.name}${prefs.suffix}.${FORMATS[prefs.format].ext}`;
}

function renderRow(item) {
  const el = item.el;
  if (!el) return;
  el.dataset.state = item.state;
  el.querySelector(".cv-name").textContent = item.state === "done" ? outName(item) : item.name;
  const dims = `${formatNumber(item.width)} × ${formatNumber(item.height)}`;
  const size = el.querySelector(".cv-size");
  const delta = el.querySelector(".cv-delta");
  const meta = el.querySelector(".cv-meta");
  const dl = el.querySelector('[data-act="download"]');
  dl.disabled = item.state !== "done";
  el.querySelector('[data-act="retry"]').hidden = item.state !== "error";
  if (item.state === "done") el.querySelector(".cv-thumb img").src = item.outUrl;
  delta.className = "cv-delta";

  if (item.state === "done") {
    const resized = item.outW !== item.width || item.outH !== item.height;
    meta.textContent = resized
      ? `${dims} → ${formatNumber(item.outW)} × ${formatNumber(item.outH)} · was ${formatBytes(item.blob.size)}`
      : `${dims} · was ${formatBytes(item.blob.size)}`;
    size.textContent = formatBytes(item.out.size);
    const pct = Math.round((1 - item.out.size / item.blob.size) * 100);
    if (pct > 0) {
      delta.textContent = `−${pct}%`;
      delta.classList.add("is-smaller");
    } else if (pct < 0) {
      delta.textContent = `+${-pct}%`;
      delta.classList.add("is-larger");
    } else {
      delta.textContent = "same size";
    }
  } else if (item.state === "error") {
    meta.textContent = item.error || "Could not convert";
    size.textContent = "";
    delta.textContent = "";
  } else {
    meta.textContent = `${dims} · ${formatBytes(item.blob.size)}`;
    size.textContent = "";
    delta.textContent = item.state === "working" ? "Converting…" : "Waiting";
  }
}

function renderSummary() {
  const n = items.length;
  $("summary").hidden = n === 0;
  $("drop").classList.toggle("is-compact", n > 0);
  if (!n) return;
  const done = items.filter((i) => i.state === "done");
  const busy = items.some((i) => i.state === "queued" || i.state === "working");
  const before = items.reduce((s, i) => s + i.blob.size, 0);
  const after = done.reduce((s, i) => s + i.out.size, 0);
  const beforeDone = done.reduce((s, i) => s + i.blob.size, 0);

  $("sum-title").textContent = `${formatNumber(n)} ${n === 1 ? "image" : "images"}`;
  $("sum-detail").textContent = busy
    ? `Converting ${formatNumber(done.length)} of ${formatNumber(n)}…`
    : `${formatBytes(before)} → ${formatBytes(after)}`;

  const saving = $("sum-saving");
  const pct = beforeDone ? Math.round((1 - after / beforeDone) * 100) : 0;
  saving.hidden = busy || !done.length || pct === 0;
  saving.textContent = pct > 0 ? `${pct}% smaller` : `${-pct}% larger`;
  saving.classList.toggle("is-larger", pct < 0);

  $("summary").classList.toggle("is-busy", busy);
  $("progress").style.setProperty("--pct", `${n ? Math.round((done.length / n) * 100) : 0}%`);
  $("download-all").disabled = !done.length || busy;
  $("save-gallery").disabled = !done.length || busy;
  $("zip").hidden = done.length < 2;
  $("zip").disabled = busy;
  $("download-label").textContent = done.length > 1 ? `Download ${formatNumber(done.length)} files` : "Download";
}

// ─── Output ──────────────────────────────────────────────────────────

/** File names that do not collide inside one batch. */
function uniqueNames(list) {
  const seen = new Map();
  return list.map((item) => {
    const base = `${item.name}${prefs.suffix}`;
    const ext = FORMATS[prefs.format].ext;
    const count = seen.get(base.toLowerCase()) || 0;
    seen.set(base.toLowerCase(), count + 1);
    return count ? `${base} (${count + 1}).${ext}` : `${base}.${ext}`;
  });
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A plain ZIP archive, files stored without compression (images are already
 * compressed, so deflating them again would only cost time).
 */
async function buildZip(entries) {
  const enc = new TextEncoder();
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, blob } of entries) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const nameBytes = enc.encode(name);
    const crc = crc32(bytes);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, nameBytes, bytes);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, bytes.length, true);
    cd.setUint32(24, bytes.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd.buffer, nameBytes);

    offset += 30 + nameBytes.length + bytes.length;
  }

  const cdSize = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const fallback = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  };
  try {
    chrome.downloads.download({ url, filename, saveAs: false }, () => {
      if (chrome.runtime.lastError) fallback();
    });
  } catch {
    fallback();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Every result as its own file, the way a gallery selection downloads. */
function downloadItems(list) {
  const ready = list.filter((i) => i.state === "done");
  if (!ready.length) return;
  const names = uniqueNames(ready);
  // Small stagger: Chrome may ask once before allowing several downloads.
  ready.forEach((item, i) => setTimeout(() => saveBlob(item.out, names[i]), i * 140));
  toast(ready.length === 1 ? "Download started" : `Downloading ${formatNumber(ready.length)} files`);
}

async function downloadZip(list) {
  const ready = list.filter((i) => i.state === "done");
  if (!ready.length) return;
  const names = uniqueNames(ready);
  const btn = $("zip");
  btn.disabled = true;
  try {
    const zip = await buildZip(ready.map((item, i) => ({ name: names[i], blob: item.out })));
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    saveBlob(zip, `SwiftSelect converted ${stamp}.zip`);
    toast(`Downloading ${formatNumber(ready.length)} files as one ZIP`);
  } catch (err) {
    toast("Could not build the ZIP", { error: true });
    console.warn("SwiftSelect: zip failed", err);
  } finally {
    btn.disabled = false;
  }
}

async function saveToGallery() {
  const ready = items.filter((i) => i.state === "done");
  if (!ready.length) return;
  const names = uniqueNames(ready);
  let saved = 0;
  for (let i = 0; i < ready.length; i++) {
    try {
      await addCapture({
        blob: ready[i].out,
        title: names[i].replace(/\.[a-z0-9]+$/i, ""),
        type: "converted",
        width: ready[i].outW,
        height: ready[i].outH,
      });
      saved++;
    } catch {}
  }
  if (saved) toast(saved === 1 ? "Saved to Gallery under Converted" : `Saved ${formatNumber(saved)} images to Gallery under Converted`);
  else toast("Could not save to the Gallery", { error: true });
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
      blobs.push(new File([r.blob], `${r.title || "capture"}.${ext}`, { type: r.blob.type || "image/png" }));
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

  try {
    const data = await chrome.storage.local.get(["converterPrefs"]);
    prefs = normalizePrefs(data?.converterPrefs || {});
  } catch {
    prefs = normalizePrefs({});
  }
  savePrefs();

  for (const seg of view().querySelectorAll(".seg[data-key]")) {
    pills[seg.dataset.key] = mountPill(seg, '[aria-checked="true"]');
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-value]");
      if (b) changed({ [seg.dataset.key]: b.dataset.value }, { delay: 0 });
    });
  }
  syncControls();

  $("quality").addEventListener("input", (e) => changed({ quality: e.target.value }));
  $("scale").addEventListener("input", (e) => changed({ scale: e.target.value }));
  $("max-w").addEventListener("input", (e) => changed({ maxW: e.target.value }, { delay: 450 }));
  $("max-h").addEventListener("input", (e) => changed({ maxH: e.target.value }, { delay: 450 }));
  $("suffix").addEventListener("input", (e) => {
    prefs = normalizePrefs({ ...prefs, suffix: e.target.value });
    $("suffix-demo").textContent = prefs.suffix;
    savePrefs();
    items.forEach(renderRow);
  });
  $("bg-white").addEventListener("click", () => changed({ bgWhite: !prefs.bgWhite }, { delay: 0 }));

  view().querySelector('.cv-presets[data-key="quality"]').addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (c) changed({ quality: c.dataset.value }, { delay: 0 });
  });
  view().querySelector('.cv-presets[data-key="box"]').addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (c) changed({ maxW: c.dataset.value, maxH: c.dataset.value }, { delay: 0 });
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
      addBlobs(files);
    }
  });

  $("clear").addEventListener("click", clearAll);
  $("download-all").addEventListener("click", () => downloadItems(items));
  $("zip").addEventListener("click", () => downloadZip(items));
  $("save-gallery").addEventListener("click", saveToGallery);
}
