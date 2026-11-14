/**
 * Swift Gallery: full-tab dashboard over the IndexedDB capture store.
 *
 * Library   All, Favorites, Recent, Earlier, one view per capture type.
 * Trash     Soft delete with restore; purged after the configured days.
 * Gestures  Drag cards onto the dock or sidebar to favorite or trash them,
 *           or out of the browser to save the file. Ctrl/⌘-click and
 *           Shift-click select, dragging across empty space draws a
 *           selection box; the bulk bar acts on the selection.
 * Sizes     Small, medium and large thumbnails (−/+ keys, Ctrl+wheel).
 */
import {
  addCapture,
  listCaptures,
  trashCaptures,
  restoreCaptures,
  deleteCaptures,
  restoreCapture,
  setFavorite,
  updateCapture,
  applyRetention,
  onGalleryChange,
  isRecent,
  formatBytes,
} from "./src/storage.js";
import { getSettings, buildFilename } from "./src/settings.js";
import { listIssues, dismissIssue, clearIssues, ISSUES_KEY } from "./src/issues.js";
import {
  icon,
  hydrateIcons,
  mountPill,
  enableSheen,
  toast,
  confirmDialog,
  setLocale,
  formatNumber,
  formatDateTime,
  formatRelative,
  send,
} from "./src/pageKit.js";

const $ = (id) => document.getElementById(id);
const DAY = 24 * 60 * 60 * 1000;

const TYPE_LABEL = {
  region: "Region",
  visible: "Visible",
  fullpage: "Full page",
  horizontal: "Horizontal",
  annotated: "Annotated",
  imported: "Imported",
  converted: "Converted",
  screenshot: "Capture",
};

// Each type has its own colour of glass; the sidebar tiles match.
const TYPE_TONE = {
  region: "orchid",
  visible: "coral",
  fullpage: "violet",
  horizontal: "orange",
  annotated: "pink",
  imported: "teal",
  converted: "lime",
};

const FILTER_TITLE = {
  all: "All Screenshots",
  favorites: "Favorites",
  recent: "Recent",
  earlier: "Earlier",
  region: "Region Captures",
  visible: "Visible Captures",
  fullpage: "Full Page Captures",
  horizontal: "Horizontal Captures",
  annotated: "Annotated",
  converted: "Converted",
  trash: "Trash",
};

/** Views that are tools in this window rather than lists of captures. */
const TOOL_VIEWS = {
  settings: { el: "settings-view", title: "Settings" },
  convert: { el: "convert-view", title: "Batch Converter", sub: "Convert, resize and compress. Nothing leaves this device." },
};
const isToolView = (filter = state.filter) => filter in TOOL_VIEWS;

/** Title for a library view; Settings (and anything unknown) reads as All. */
const filterTitle = (filter) => FILTER_TITLE[filter] || FILTER_TITLE.all;

const state = {
  records: [],
  filter: "all",
  query: "",
  view: "grid",
  size: "m",
  settings: null,
  lightboxId: null,
  selected: new Set(),
  anchorId: null,
};

const thumbUrls = new Map();
let lightboxUrl = "";

const grid = $("grid");
const search = $("search");
const lightbox = $("lightbox");

let syncNavPill = () => {};
let syncViewPill = () => {};
let syncSizePill = () => {};

const SIZES = ["s", "m", "l"];

// ─── Data ────────────────────────────────────────────────────────────

const inTrashView = () => state.filter === "trash";
const byId = (id) => state.records.find((r) => r.id === Number(id)) || null;

function matchesFilter(r, filter) {
  if (filter === "trash") return !!r.deletedAt;
  if (r.deletedAt) return false;
  if (filter === "all") return true;
  if (filter === "favorites") return !!r.favorite;
  if (filter === "recent") return isRecent(r);
  if (filter === "earlier") return !isRecent(r);
  return r.type === filter;
}

function matchesQuery(r, query) {
  if (!query) return true;
  const hay =
    `${r.title} ${r.url} ${TYPE_LABEL[r.type] || ""} ${r.format} ${r.width}x${r.height} ${r.favorite ? "favorite" : ""}`.toLowerCase();
  return query.split(/\s+/).every((term) => hay.includes(term));
}

function visibleRecords() {
  const q = state.query.trim().toLowerCase();
  const list = state.records.filter((r) => matchesFilter(r, state.filter) && matchesQuery(r, q));
  if (inTrashView()) list.sort((a, b) => b.deletedAt - a.deletedAt);
  return list;
}

async function load() {
  try {
    state.records = await listCaptures();
  } catch (err) {
    console.error("SwiftSelect: could not read gallery", err);
    state.records = [];
    toast("Could not read the gallery database", { error: true });
  }
  // Drop selections that no longer exist.
  const ids = new Set(state.records.map((r) => r.id));
  for (const id of state.selected) if (!ids.has(id)) state.selected.delete(id);
  render();
}

// ─── Formatting ──────────────────────────────────────────────────────

function displayTitle(r) {
  if (r.title) return r.title;
  try {
    return new URL(r.url).hostname;
  } catch {
    return `${TYPE_LABEL[r.type] || "Capture"} screenshot`;
  }
}

function filenameFor(r) {
  return buildFilename(state.settings?.filenameTemplate, {
    title: r.title,
    url: r.url,
    type: r.type,
    ext: r.format || "png",
    date: new Date(r.createdAt),
  });
}

function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Date buckets in the order people scan them. */
function bucketOf(ts, now = Date.now()) {
  const today = startOfDay(now);
  if (ts >= today) return { key: "today", label: "Today" };
  if (ts >= today - DAY) return { key: "yesterday", label: "Yesterday" };
  if (ts >= today - 7 * DAY) return { key: "week", label: "Previous 7 days" };
  if (ts >= today - 30 * DAY) return { key: "month", label: "Previous 30 days" };
  const d = new Date(ts);
  return {
    key: `${d.getFullYear()}-${d.getMonth()}`,
    label: new Intl.DateTimeFormat(document.documentElement.lang || undefined, { month: "long", year: "numeric" }).format(d),
  };
}

function thumbUrl(r) {
  let url = thumbUrls.get(r.id);
  if (!url) {
    url = URL.createObjectURL(r.thumb || r.blob);
    thumbUrls.set(r.id, url);
  }
  return url;
}

// ─── Rendering ───────────────────────────────────────────────────────

function iconButton(action, label, name, extra = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `act ${extra}`.trim();
  b.dataset.action = action;
  b.dataset.tip = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = icon(name);
  return b;
}

function buildCard(r, index) {
  const trash = !!r.deletedAt;
  const card = document.createElement("article");
  card.className = "card glass";
  card.dataset.id = r.id;
  if (!trash) card.dataset.bucket = bucketOf(r.createdAt).key;
  card.style.setProperty("--i", index);
  card.draggable = !trash;
  if (r.favorite) card.classList.add("is-favorite");
  if (state.selected.has(r.id)) card.classList.add("is-selected");

  const wrap = document.createElement("div");
  wrap.className = "card-thumb-wrap";

  const thumb = document.createElement("button");
  thumb.type = "button";
  thumb.className = "card-thumb";
  thumb.dataset.action = "preview";
  thumb.setAttribute("aria-label", `Preview ${displayTitle(r)}`);
  const img = document.createElement("img");
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = "";
  img.draggable = false;
  img.src = thumbUrl(r);
  thumb.appendChild(img);

  const select = document.createElement("button");
  select.type = "button";
  select.className = "card-select";
  select.dataset.action = "select";
  select.setAttribute("aria-label", "Select");
  select.setAttribute("aria-pressed", String(state.selected.has(r.id)));
  select.innerHTML = icon("check");

  const type = document.createElement("span");
  type.className = "chip-over card-type";
  type.textContent = TYPE_LABEL[r.type] || "Capture";
  type.dataset.tone = TYPE_TONE[r.type] || "slate";
  card.dataset.tone = type.dataset.tone;

  const copied = document.createElement("span");
  copied.className = "badge-copied glass-dense";
  copied.innerHTML = `${icon("check")}Copied`;

  const actions = document.createElement("div");
  actions.className = "card-actions";
  if (trash) {
    actions.append(
      iconButton("restore", "Restore", "restore"),
      iconButton("purge", "Delete forever", "trash", "act-danger"),
    );
  } else {
    actions.append(
      iconButton("copy", "Copy to clipboard", "copy"),
      iconButton("download", "Download", "download"),
      iconButton("annotate", "Annotate", "annotated"),
      iconButton("trash", "Move to Trash", "trash", "act-danger"),
    );
  }

  wrap.append(thumb, select, type, copied, actions);

  if (!trash) {
    const fav = document.createElement("button");
    fav.type = "button";
    fav.className = "card-fav";
    fav.dataset.action = "fav";
    fav.setAttribute("aria-label", r.favorite ? "Remove from Favorites" : "Add to Favorites");
    fav.setAttribute("aria-pressed", String(!!r.favorite));
    fav.innerHTML = icon("star");
    wrap.appendChild(fav);
  }

  const meta = document.createElement("div");
  meta.className = "card-meta";

  const row = document.createElement("div");
  row.className = "card-title-row";
  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = displayTitle(r);
  title.title = trash ? displayTitle(r) : "Double-click to rename";
  const when = document.createElement("span");
  when.className = "card-when";
  when.textContent = formatRelative(r.createdAt);
  when.title = formatDateTime(r.createdAt);
  row.append(title, when);

  const sub = document.createElement("p");
  sub.className = "card-sub";
  const dot = () => document.createElement("i");
  const span = (text, cls = "") => {
    const s = document.createElement("span");
    s.textContent = text;
    if (cls) s.className = cls;
    return s;
  };

  if (trash) {
    const left = Math.max(0, Math.ceil((r.deletedAt + (state.settings?.trashDays || 30) * DAY - Date.now()) / DAY));
    sub.append(
      span(
        Date.now() - r.deletedAt < 7 * DAY
          ? `Deleted ${formatRelative(r.deletedAt).toLowerCase()}`
          : `Deleted on ${formatRelative(r.deletedAt)}`,
      ),
      dot(),
      span(left <= 1 ? "Removed within a day" : `Removed in ${left} days`, left <= 3 ? "card-expiry" : ""),
    );
  } else {
    sub.append(
      span(r.width && r.height ? `${formatNumber(r.width)} × ${formatNumber(r.height)}` : "Unknown size"),
      dot(),
      span((r.format || "img").toUpperCase(), "fmt"),
      dot(),
      span(formatBytes(r.blob?.size || r.size || 0)),
    );
    const stampDot = dot();
    stampDot.className = "card-stamp";
    sub.append(stampDot, span(formatDateTime(r.createdAt), "card-stamp"));
  }

  meta.append(row, sub);
  card.append(wrap, meta);
  return card;
}

function renderCounts() {
  const counts = { all: 0, favorites: 0, recent: 0, earlier: 0, trash: 0 };
  let liveBytes = 0;
  let trashBytes = 0;
  for (const r of state.records) {
    const size = r.size || r.blob?.size || 0;
    if (r.deletedAt) {
      counts.trash += 1;
      trashBytes += size;
      continue;
    }
    counts.all += 1;
    liveBytes += size;
    if (r.favorite) counts.favorites += 1;
    if (isRecent(r)) counts.recent += 1;
    else counts.earlier += 1;
    counts[r.type] = (counts[r.type] || 0) + 1;
  }
  document.querySelectorAll("[data-count]").forEach((el) => {
    const n = counts[el.dataset.count] || 0;
    el.textContent = n ? formatNumber(n) : "";
  });

  const tel = $("telemetry");
  const n = counts.all;
  tel.textContent = "";
  const count = document.createElement("b");
  count.textContent = formatNumber(n);
  const space = document.createElement("b");
  space.textContent = formatBytes(liveBytes + trashBytes);
  tel.append(count, ` capture${n === 1 ? "" : "s"}`, document.createElement("i"), space, " used");
  $("clear-all").disabled = n === 0;

  navigator.storage?.estimate?.().then((est) => {
    const quota = est?.quota || 0;
    const used = liveBytes + trashBytes;
    const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
    $("meter").style.setProperty("--pct", `${used ? Math.max(pct, 1.5) : 0}%`);
    $("meter").title = quota ? `${formatBytes(used)} of ${formatBytes(quota)} available to the browser` : "";
  });
  return counts;
}

function renderHead(shown, counts) {
  $("section-title").textContent = filterTitle(state.filter);
  $("section-count").textContent = shown.length ? `${formatNumber(shown.length)} item${shown.length === 1 ? "" : "s"}` : "";

  const actions = $("canvas-actions");
  const note = $("canvas-note");
  actions.replaceChildren();
  note.hidden = true;

  if (inTrashView()) {
    note.hidden = false;
    note.innerHTML = `${icon("info")}<span></span>`;
    note.querySelector("span").textContent =
      `Captures in Trash are deleted for good after ${state.settings?.trashDays || 30} days. Restore anything you want to keep.`;
    if (counts.trash) {
      actions.innerHTML = `
        <button type="button" class="btn" data-head="restore-all">${icon("restore")}Restore all</button>
        <button type="button" class="btn btn-danger" data-head="empty-trash">${icon("trash")}Empty Trash</button>`;
    }
  } else if (state.filter === "favorites" && counts.favorites) {
    note.hidden = false;
    note.innerHTML = `${icon("star")}<span>Favorites are never auto-deleted.</span>`;
  }
}

function renderEmpty(counts) {
  const glyph = $("empty-glyph");
  const title = $("empty-title");
  const body = $("empty-body");
  const cta = $("empty-cta");
  const hint = $("empty-hint");
  const searching = !!state.query.trim();
  hint.textContent = "";
  cta.hidden = false;

  if (searching) {
    glyph.innerHTML = icon("search");
    title.textContent = "No captures match";
    body.textContent = `Nothing in ${filterTitle(state.filter).toLowerCase()} matches “${state.query.trim()}”.`;
    cta.innerHTML = "Clear search";
    cta.dataset.mode = "clear-search";
  } else if (inTrashView()) {
    glyph.innerHTML = icon("trash");
    title.textContent = "Trash is empty";
    body.textContent = "Deleted captures wait here so you can change your mind.";
    cta.hidden = true;
  } else if (state.filter === "favorites") {
    glyph.innerHTML = icon("star");
    title.textContent = "No favorites yet";
    body.textContent = "Star a capture, or drag it onto Favorites, to keep it close. Favorites are never auto-deleted.";
    cta.hidden = !counts.all;
    cta.innerHTML = "Browse all screenshots";
    cta.dataset.mode = "show-all";
  } else if (!counts.all) {
    glyph.innerHTML = icon("region");
    title.textContent = "Time to fill this space!";
    body.textContent = "Every capture you take lands here automatically, ready to copy, download or annotate.";
    cta.innerHTML = `${icon("region")}Take Your First Capture`;
    cta.dataset.mode = "capture";
    hint.innerHTML = "Or click the SwiftSelect icon on any web page";
  } else {
    glyph.innerHTML = icon("gallery");
    title.textContent = "Nothing here yet";
    body.textContent = `You have no ${filterTitle(state.filter).toLowerCase()} right now.`;
    cta.innerHTML = "Show all screenshots";
    cta.dataset.mode = "show-all";
  }
}

function renderBulkBar() {
  const n = state.selected.size;
  const bar = $("bulk-bar");
  const wasOpen = bar.classList.contains("is-open");
  bar.classList.toggle("is-open", n > 0);
  grid.classList.toggle("is-selecting", n > 0);
  if (!n) return;

  const shown = visibleRecords().length;
  const badge = $("bulk-count");
  const next = formatNumber(n);
  if (badge.textContent !== next) {
    badge.textContent = next;
    if (wasOpen) {
      badge.classList.remove("is-bump");
      void badge.offsetWidth;
      badge.classList.add("is-bump");
    }
  }
  $("bulk-noun").textContent = "selected";
  $("bulk-of").textContent = shown ? `of ${formatNumber(shown)}` : "";
  $("bulk-live").hidden = inTrashView();
  $("bulk-trash").hidden = !inTrashView();

  const allShown = shown > 0 && n >= shown && visibleRecords().every((r) => state.selected.has(r.id));
  bar.querySelector('[data-bulk="all"]').disabled = allShown;
  // The clipboard holds one image at a time.
  bar.querySelector('[data-bulk="copy"]').hidden = n !== 1;

  const allFav = [...state.selected].every((id) => byId(id)?.favorite);
  const favBtn = bar.querySelector('[data-bulk="favorite"]');
  favBtn.querySelector(".bulk-fav-label").textContent = allFav ? "Unfavorite" : "Favorite";
  favBtn.dataset.tip = allFav ? "Remove from Favorites" : "Add to Favorites";
  favBtn.dataset.mode = allFav ? "off" : "on";
  favBtn.classList.toggle("is-on", allFav);
}

function render({ animate = false } = {}) {
  const counts = renderCounts();
  // While Settings is open the library is hidden: keep the sidebar counts
  // live and leave the grid for when a library view comes back.
  if (isToolView()) return;
  const shown = visibleRecords();
  renderHead(shown, counts);

  // Release previews that are no longer in the store.
  const live = new Set(state.records.map((r) => r.id));
  for (const [id, url] of thumbUrls) {
    if (!live.has(id)) {
      URL.revokeObjectURL(url);
      thumbUrls.delete(id);
    }
  }

  const frag = document.createDocumentFragment();
  let lastBucket = "";
  shown.forEach((r, i) => {
    if (!inTrashView()) {
      const b = bucketOf(r.createdAt);
      if (b.key !== lastBucket) {
        lastBucket = b.key;
        const head = document.createElement("h2");
        head.className = "group-head";
        head.textContent = b.label;
        const n = shown.filter((x) => bucketOf(x.createdAt).key === b.key).length;
        const c = document.createElement("span");
        c.textContent = formatNumber(n);
        head.appendChild(c);
        head.dataset.bucket = b.key;
        const pick = document.createElement("button");
        pick.type = "button";
        pick.className = "group-pick";
        pick.dataset.bucket = b.key;
        pick.innerHTML = `${icon("select")}<span>Select</span>`;
        pick.setAttribute("aria-label", `Select everything from ${b.label}`);
        head.appendChild(pick);
        frag.appendChild(head);
      }
    }
    frag.appendChild(buildCard(r, i));
  });

  // Entrance motion only when the view itself changes, not on every edit.
  grid.classList.toggle("is-settled", !animate);
  grid.replaceChildren(frag);
  grid.classList.toggle("is-list", state.view === "list");
  grid.dataset.size = state.size;
  grid.hidden = shown.length === 0;

  $("empty").hidden = shown.length !== 0;
  if (!shown.length) renderEmpty(counts);
  renderBulkBar();
  syncGroupPicks();
  if (lightbox.classList.contains("is-open")) syncLightbox();
}

// ─── Actions ─────────────────────────────────────────────────────────

async function toPngBlob(blob) {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("PNG encode failed"))), "image/png"));
}

async function copyRecord(r, card) {
  try {
    // A promise keeps the write inside the click's user activation.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": toPngBlob(r.blob) })]);
    if (card) {
      card.classList.add("is-copied");
      setTimeout(() => card.classList.remove("is-copied"), 1400);
    } else {
      toast("Copied to clipboard");
    }
  } catch (err) {
    console.warn("SwiftSelect: copy failed", err);
    toast("Clipboard refused the image", { error: true });
  }
}

function downloadRecords(records) {
  records.forEach((r, i) => {
    const url = URL.createObjectURL(r.blob);
    // Small stagger: Chrome may ask once before allowing several downloads.
    setTimeout(() => {
      chrome.downloads.download({ url, filename: filenameFor(r), saveAs: false }, () => {
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        if (chrome.runtime.lastError) console.warn("SwiftSelect: download failed", chrome.runtime.lastError.message);
      });
    }, i * 120);
  });
  toast(records.length === 1 ? "Download started" : `Downloading ${formatNumber(records.length)} files`);
}

function annotateRecord(r) {
  location.href = `annotate.html?id=${encodeURIComponent(r.id)}`;
}

function cardsFor(ids) {
  return ids.map((id) => grid.querySelector(`.card[data-id="${id}"]`)).filter(Boolean);
}

async function animateOut(ids) {
  const cards = cardsFor(ids);
  cards.forEach((c) => c.classList.add("is-removing"));
  if (cards.length) await new Promise((r) => setTimeout(r, 300));
}

async function moveToTrash(ids) {
  if (!ids.length) return;
  await animateOut(ids);
  const now = Date.now();
  await trashCaptures(ids, now);
  ids.forEach((id) => {
    const r = byId(id);
    if (r) r.deletedAt = now;
    state.selected.delete(id);
  });
  if (state.lightboxId && ids.includes(state.lightboxId)) closeLightbox();
  render();
  toast(ids.length === 1 ? "Moved to Trash" : `${formatNumber(ids.length)} moved to Trash`, {
    action: "Undo",
    onAction: async () => {
      await restoreCaptures(ids);
      ids.forEach((id) => {
        const r = byId(id);
        if (r) r.deletedAt = 0;
      });
      render();
    },
  });
}

async function restoreFromTrash(ids) {
  if (!ids.length) return;
  await animateOut(ids);
  await restoreCaptures(ids);
  ids.forEach((id) => {
    const r = byId(id);
    if (r) r.deletedAt = 0;
    state.selected.delete(id);
  });
  render();
  toast(ids.length === 1 ? "Restored" : `${formatNumber(ids.length)} restored`);
}

async function purge(ids, { confirmFirst = true } = {}) {
  if (!ids.length) return;
  if (confirmFirst) {
    const ok = await confirmDialog({
      title: ids.length === 1 ? "Delete forever?" : `Delete ${formatNumber(ids.length)} captures forever?`,
      body: "This cannot be undone. Files already in your Downloads folder are not touched.",
      confirm: "Delete forever",
    });
    if (!ok) return;
  }
  await animateOut(ids);
  await deleteCaptures(ids);
  state.records = state.records.filter((r) => !ids.includes(r.id));
  ids.forEach((id) => state.selected.delete(id));
  render();
  toast(ids.length === 1 ? "Deleted forever" : `${formatNumber(ids.length)} deleted forever`);
}

async function toggleFavorite(ids, value) {
  if (!ids.length) return;
  await setFavorite(ids, value);
  ids.forEach((id) => {
    const r = byId(id);
    if (r) r.favorite = value;
  });
  if (state.filter === "favorites" && !value) {
    await animateOut(ids);
    render();
  } else {
    // Update in place so the star can animate.
    cardsFor(ids).forEach((card) => {
      card.classList.toggle("is-favorite", value);
      const fav = card.querySelector(".card-fav");
      if (fav) {
        fav.setAttribute("aria-pressed", String(value));
        fav.setAttribute("aria-label", value ? "Remove from Favorites" : "Add to Favorites");
        if (value) {
          fav.classList.remove("is-popping");
          void fav.offsetWidth;
          fav.classList.add("is-popping");
        }
      }
    });
    renderCounts();
    renderBulkBar();
    if (lightbox.classList.contains("is-open")) syncLightbox();
  }
  if (ids.length > 1 || !value) {
    toast(value ? `${formatNumber(ids.length)} added to Favorites` : "Removed from Favorites");
  }
}

async function runCapture(mode) {
  const resp = await send({ type: "run-capture", mode });
  if (!resp?.success) {
    toast(
      resp?.error === "no-target"
        ? "Open a web page in this window first, then capture it"
        : "Could not start a capture on that tab",
      { error: true, duration: 4200 },
    );
  }
}

// ─── Selection ───────────────────────────────────────────────────────

function setSelected(ids, on) {
  ids.forEach((id) => (on ? state.selected.add(id) : state.selected.delete(id)));
  cardsFor(ids).forEach((card) => {
    card.classList.toggle("is-selected", on);
    card.querySelector(".card-select")?.setAttribute("aria-pressed", String(on));
  });
  renderBulkBar();
  syncGroupPicks();
}

function toggleSelect(id, { range = false } = {}) {
  const shown = visibleRecords().map((r) => r.id);
  if (range && state.anchorId !== null && shown.includes(state.anchorId)) {
    const a = shown.indexOf(state.anchorId);
    const b = shown.indexOf(id);
    setSelected(shown.slice(Math.min(a, b), Math.max(a, b) + 1), true);
    return;
  }
  setSelected([id], !state.selected.has(id));
  state.anchorId = id;
}

function clearSelection() {
  if (!state.selected.size) return;
  setSelected([...state.selected], false);
  state.anchorId = null;
}

function invertSelection() {
  const shown = visibleRecords().map((r) => r.id);
  const on = shown.filter((id) => !state.selected.has(id));
  const off = shown.filter((id) => state.selected.has(id));
  off.forEach((id) => state.selected.delete(id));
  on.forEach((id) => state.selected.add(id));
  cardsFor(shown).forEach((card) => {
    const sel = state.selected.has(Number(card.dataset.id));
    card.classList.toggle("is-selected", sel);
    card.querySelector(".card-select")?.setAttribute("aria-pressed", String(sel));
  });
  renderBulkBar();
  syncGroupPicks();
}

/** Reflect the selection on each card's checkbox and on the day headings. */
function syncGroupPicks() {
  grid.querySelectorAll(".group-head[data-bucket]").forEach((head) => {
    const cards = grid.querySelectorAll(`.card[data-bucket="${head.dataset.bucket}"]`);
    const all = cards.length > 0 && [...cards].every((c) => c.classList.contains("is-selected"));
    head.classList.toggle("is-all", all);
    const label = head.querySelector(".group-pick span");
    if (label) label.textContent = all ? "Deselect" : "Select";
  });
}

// ─── Marquee selection ───────────────────────────────────────────────
// Press on empty space and drag: every card the box touches is selected.
// Shift or Ctrl/⌘ adds to what is already selected; Ctrl/⌘ toggles.
// The view scrolls on its own near the top and bottom edges.

function wireMarquee() {
  const canvas = $("canvas");
  const box = document.createElement("div");
  box.className = "marquee";
  box.hidden = true;
  canvas.appendChild(box);

  let m = null;

  const isBlank = (target) =>
    !target.closest(".card, button, a, input, textarea, select, label, [contenteditable], .canvas-head .btn, .empty");

  const toCanvas = (x, y) => {
    const r = canvas.getBoundingClientRect();
    return { x: x - r.left + canvas.scrollLeft, y: y - r.top + canvas.scrollTop };
  };

  function update() {
    if (!m) return;
    const p = toCanvas(m.cx, m.cy);
    const left = Math.min(m.sx, p.x);
    const top = Math.min(m.sy, p.y);
    const w = Math.abs(p.x - m.sx);
    const h = Math.abs(p.y - m.sy);
    box.style.transform = `translate(${left}px, ${top}px)`;
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;

    const cr = canvas.getBoundingClientRect();
    const sel = { l: left + cr.left - canvas.scrollLeft, t: top + cr.top - canvas.scrollTop };
    sel.r = sel.l + w;
    sel.b = sel.t + h;
    const next = new Set(m.base);
    for (const card of m.cards) {
      const r = card.getBoundingClientRect();
      const hit = r.left < sel.r && r.right > sel.l && r.top < sel.b && r.bottom > sel.t;
      if (!hit) continue;
      const id = Number(card.dataset.id);
      if (m.toggle && m.base.has(id)) next.delete(id);
      else next.add(id);
    }
    // Only touch cards whose state changes.
    for (const card of m.cards) {
      const id = Number(card.dataset.id);
      const on = next.has(id);
      if (card.classList.contains("is-selected") !== on) {
        card.classList.toggle("is-selected", on);
        card.querySelector(".card-select")?.setAttribute("aria-pressed", String(on));
      }
    }
    state.selected = next;
    renderBulkBar();
  }

  function tick() {
    if (!m) return;
    const r = canvas.getBoundingClientRect();
    const edge = 56;
    let dy = 0;
    if (m.cy < r.top + edge) dy = -Math.ceil(((r.top + edge - m.cy) / edge) * 18);
    else if (m.cy > r.bottom - edge) dy = Math.ceil(((m.cy - (r.bottom - edge)) / edge) * 18);
    if (dy) {
      canvas.scrollTop += dy;
      update();
    }
    m.raf = requestAnimationFrame(tick);
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.pointerType === "touch" || isToolView()) return;
    if (lightbox.classList.contains("is-open") || !isBlank(e.target)) return;
    // The scrollbar is not empty space.
    if (e.clientX - canvas.getBoundingClientRect().left > canvas.clientLeft + canvas.clientWidth) return;
    const p = toCanvas(e.clientX, e.clientY);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    m = {
      id: e.pointerId,
      sx: p.x,
      sy: p.y,
      cx: e.clientX,
      cy: e.clientY,
      active: false,
      toggle: e.ctrlKey || e.metaKey,
      base: additive ? new Set(state.selected) : new Set(),
      cards: [],
      raf: 0,
    };
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!m || e.pointerId !== m.id) return;
    m.cx = e.clientX;
    m.cy = e.clientY;
    if (!m.active) {
      const p = toCanvas(e.clientX, e.clientY);
      if (Math.hypot(p.x - m.sx, p.y - m.sy) < 6) return;
      m.active = true;
      m.cards = [...grid.querySelectorAll(".card")];
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}
      document.body.classList.add("is-marquee");
      box.hidden = false;
      getSelection()?.removeAllRanges();
      m.raf = requestAnimationFrame(tick);
    }
    e.preventDefault();
    update();
  });

  const end = (e) => {
    if (!m || (e && e.pointerId !== m.id)) return;
    const wasActive = m.active;
    cancelAnimationFrame(m.raf);
    const base = m.base;
    m = null;
    box.hidden = true;
    document.body.classList.remove("is-marquee");
    if (wasActive) {
      syncGroupPicks();
      return;
    }
    // A plain click on empty space puts the selection down.
    if (!base.size && e?.type === "pointerup") clearSelection();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("lostpointercapture", (e) => m?.active && end(e));
}

// ─── Rename ──────────────────────────────────────────────────────────

function beginRename(card, r) {
  const title = card.querySelector(".card-title");
  if (!title || r.deletedAt) return;
  const original = title.textContent;
  card.draggable = false;
  title.contentEditable = "true";
  title.focus();
  const range = document.createRange();
  range.selectNodeContents(title);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = async (commit) => {
    title.removeEventListener("keydown", onKey);
    title.removeEventListener("blur", onBlur);
    title.contentEditable = "false";
    card.draggable = true;
    const next = title.textContent.replace(/\s+/g, " ").trim();
    if (!commit || !next || next === original) {
      title.textContent = original;
      return;
    }
    r.title = next.slice(0, 300);
    title.textContent = r.title;
    await updateCapture(r.id, { title: r.title });
    toast("Renamed");
  };
  const onKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  };
  const onBlur = () => finish(true);
  title.addEventListener("keydown", onKey);
  title.addEventListener("blur", onBlur);
}

// ─── Drag and drop ───────────────────────────────────────────────────

let dragIds = null;
let dragUrl = "";
let overZone = null;

function setOver(zone) {
  if (overZone === zone) return;
  overZone?.classList.remove("is-over");
  overZone = zone;
  overZone?.classList.add("is-over");
}

function buildGhost(ids) {
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ids.slice(0, 3).forEach((id) => {
    const r = byId(id);
    if (!r) return;
    const img = document.createElement("img");
    img.src = thumbUrl(r);
    ghost.prepend(img);
  });
  if (ids.length > 1) {
    const b = document.createElement("b");
    b.textContent = formatNumber(ids.length);
    ghost.appendChild(b);
  }
  document.body.appendChild(ghost);
  return ghost;
}

function wireDragAndDrop() {
  grid.addEventListener("dragstart", (e) => {
    const card = e.target.closest?.(".card");
    const id = Number(card?.dataset.id);
    const r = byId(id);
    if (!card || !r || r.deletedAt) {
      e.preventDefault();
      return;
    }
    dragIds = state.selected.has(id) ? [...state.selected] : [id];
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("application/x-swiftselect", JSON.stringify(dragIds));
    e.dataTransfer.setData("text/plain", dragIds.map((x) => displayTitle(byId(x))).join("\n"));

    // A single capture can be dropped onto the desktop or another app as a file.
    if (dragIds.length === 1) {
      dragUrl = URL.createObjectURL(r.blob);
      e.dataTransfer.setData("DownloadURL", `${r.blob.type}:${filenameFor(r)}:${dragUrl}`);
    }

    const ghost = buildGhost(dragIds);
    e.dataTransfer.setDragImage(ghost, 66, 42);
    setTimeout(() => ghost.remove(), 0);

    // Changing layout inside dragstart can cancel the drag; defer it.
    setTimeout(() => {
      document.body.classList.add("is-dragging");
      cardsFor(dragIds).forEach((c) => c.classList.add("is-dragging"));
      document.querySelectorAll(".nav-item[data-drop]").forEach((n) => n.classList.add("is-drop-ready"));
    }, 0);
  });

  grid.addEventListener("dragend", () => {
    document.body.classList.remove("is-dragging");
    grid.querySelectorAll(".card.is-dragging").forEach((c) => c.classList.remove("is-dragging"));
    document.querySelectorAll(".is-drop-ready").forEach((n) => n.classList.remove("is-drop-ready"));
    setOver(null);
    dragIds = null;
    if (dragUrl) {
      const url = dragUrl;
      dragUrl = "";
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  });

  document.addEventListener("dragover", (e) => {
    if (!dragIds) return;
    const zone = e.target.closest?.("[data-drop]");
    setOver(zone || null);
    if (zone) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  });

  document.addEventListener("drop", async (e) => {
    const zone = e.target.closest?.("[data-drop]");
    if (!zone || !dragIds) return;
    e.preventDefault();
    const ids = dragIds;
    zone.classList.remove("is-gulp");
    void zone.offsetWidth;
    zone.classList.add("is-gulp");
    if (zone.dataset.drop === "trash") await moveToTrash(ids);
    else if (zone.dataset.drop === "favorite") await toggleFavorite(ids, true);
    clearSelection();
  });
}

// ─── Lightbox ────────────────────────────────────────────────────────

function currentLightboxRecord() {
  return byId(state.lightboxId);
}

function syncLightbox() {
  const r = currentLightboxRecord();
  if (!r) return;
  const fav = $("lb-fav");
  fav.classList.toggle("is-on", !!r.favorite);
  fav.hidden = !!r.deletedAt;
  $("lb-trash").hidden = !!r.deletedAt;
  $("lb-annotate").hidden = !!r.deletedAt;
  const shown = visibleRecords();
  const i = shown.findIndex((x) => x.id === r.id);
  $("lb-prev").hidden = i <= 0;
  $("lb-next").hidden = i === -1 || i >= shown.length - 1;
}

function fillLightbox(r) {
  state.lightboxId = r.id;
  if (lightboxUrl) URL.revokeObjectURL(lightboxUrl);
  lightboxUrl = URL.createObjectURL(r.blob);
  $("lb-img").src = lightboxUrl;
  $("lb-img").alt = displayTitle(r);
  $("lb-title").textContent = displayTitle(r);
  const link = $("lb-url");
  link.textContent = `${formatNumber(r.width)} × ${formatNumber(r.height)} · ${formatBytes(r.blob.size)} · ${r.url || formatDateTime(r.createdAt)}`;
  if (/^https?:\/\//i.test(r.url || "")) link.href = r.url;
  else link.removeAttribute("href");
  lightbox.classList.add("is-open", "is-fit");
  syncLightbox();
  $("lb-close").focus();
}

/**
 * Open the preview. From a card, the thumbnail grows into the preview (a
 * shared-element View Transition); stepping with the arrows just swaps.
 */
function openLightbox(r, { hero = null } = {}) {
  const img = $("lb-img");
  if (!hero || !document.startViewTransition || prefersReducedMotion()) {
    fillLightbox(r);
    return;
  }
  hero.style.viewTransitionName = "lb-hero";
  const vt = document.startViewTransition(async () => {
    hero.style.viewTransitionName = "";
    fillLightbox(r);
    img.style.viewTransitionName = "lb-hero";
    try {
      await img.decode();
    } catch {}
  });
  vt.finished.finally(() => {
    img.style.viewTransitionName = "";
    hero.style.viewTransitionName = "";
  });
}

function closeLightbox() {
  if (!lightbox.classList.contains("is-open")) return;
  const id = state.lightboxId;
  const img = $("lb-img");
  const thumb = grid.querySelector(`[data-id="${id}"] .card-thumb img`);
  const finish = () => {
    lightbox.classList.remove("is-open");
    state.lightboxId = null;
    setTimeout(() => {
      if (state.lightboxId === null && lightboxUrl) {
        URL.revokeObjectURL(lightboxUrl);
        lightboxUrl = "";
        img.removeAttribute("src");
      }
    }, 320);
    grid.querySelector(`[data-id="${id}"] .card-thumb`)?.focus({ preventScroll: true });
  };
  // Shrink back into the card when it is on screen.
  const r = thumb?.getBoundingClientRect();
  const visible = r && r.bottom > 0 && r.top < innerHeight && r.width > 0;
  if (!visible || !document.startViewTransition || prefersReducedMotion() || !lightbox.classList.contains("is-fit")) {
    finish();
    return;
  }
  img.style.viewTransitionName = "lb-hero";
  const vt = document.startViewTransition(() => {
    img.style.viewTransitionName = "";
    thumb.style.viewTransitionName = "lb-hero";
    finish();
  });
  vt.finished.finally(() => {
    thumb.style.viewTransitionName = "";
    img.style.viewTransitionName = "";
  });
}

function stepLightbox(delta) {
  const shown = visibleRecords();
  const i = shown.findIndex((r) => r.id === state.lightboxId);
  const next = shown[i + delta];
  if (next) openLightbox(next);
}

// ─── Wiring ──────────────────────────────────────────────────────────

// ─── Tool views and section motion ───────────────────────────────────
// Settings and the Batch Converter are views of this window rather than
// separate tabs: the same sidebar, the same top bar, the same glass. Every
// switch between sections runs as a View Transition: the stage slides and
// fades in the direction of travel in the sidebar while the sidebar itself
// stays put and its pill glides.

let settingsModule = null;
let converterModule = null;

const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Swap sections with motion that never blocks input: the new stage glides
 * and fades in from the direction of travel in the sidebar, the top bar's
 * contents cross-fade. (View Transitions hold clicks while they play, which
 * made quick hops down the sidebar drop clicks, so they are kept for the
 * preview morph only.)
 */
let stageAnim = null;
function transition(update, direction = "down") {
  const result = update();
  if (prefersReducedMotion() || document.hidden) return Promise.resolve(result);
  const stage = [$("canvas"), $("settings-view"), $("convert-view")].find((el) => el && !el.hidden);
  const dy = direction === "up" ? -18 : 18;
  stageAnim?.cancel();
  stageAnim = stage?.animate(
    [
      { opacity: 0, transform: `translateY(${dy}px) scale(0.99)`, filter: "blur(6px)" },
      { opacity: 1, transform: "none", filter: "none" },
    ],
    { duration: 340, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  );
  document.querySelector(".topbar")?.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 220, easing: "ease-out" });
  return Promise.resolve(result);
}

function navIndex(filter) {
  return [...document.querySelectorAll(".nav-item")].findIndex((n) => n.dataset.filter === filter);
}

function showStage(filter) {
  for (const [key, cfg] of Object.entries(TOOL_VIEWS)) $(cfg.el).hidden = key !== filter;
  $("canvas").hidden = isToolView(filter);
  const tool = TOOL_VIEWS[filter];
  document.body.classList.toggle("is-tool", !!tool);
  document.body.classList.toggle("is-settings", filter === "settings");
  document.body.classList.toggle("is-convert", filter === "convert");
  if (tool) {
    $("topbar-title").textContent = tool.title;
    const sub = $("topbar-sub");
    if (tool.sub) sub.textContent = tool.sub;
    else sub.innerHTML = `SwiftSelect <span id="version">v${chrome.runtime.getManifest().version}</span>`;
  }
}

async function mountTool(filter, section = "") {
  if (filter === "settings") {
    settingsModule ||= await import("./options.js");
    await settingsModule.mountSettings();
    const view = $("settings-view");
    // Scroll only the settings pane. scrollIntoView would also scroll every
    // ancestor, nudging the whole window (sidebar included) out of place.
    const target = section && document.getElementById(section);
    let top = 0;
    for (let el = target; el && el !== view; el = el.offsetParent) top += el.offsetTop;
    view.scrollTo({ top: target ? Math.max(0, top - 8) : 0, behavior: target ? "smooth" : "auto" });
  } else if (filter === "convert") {
    converterModule ||= await import("./convert.js");
    await converterModule.mountConverter();
    const ids = String(section || "").split(",").map(Number).filter(Boolean);
    if (ids.length) await converterModule.addCaptureIds(ids);
  }
}

async function openConverterWith(ids) {
  clearSelection();
  setFilter("convert");
  converterModule ||= await import("./convert.js");
  await converterModule.mountConverter();
  await converterModule.addCaptureIds(ids);
}

/** #settings, #settings/shortcuts, #convert, #convert/3,7, #trash … */
function routeFromHash() {
  const [view, section] = location.hash.replace(/^#/, "").split("/");
  if (view === "capture") {
    // #capture/<id>: opened from a web page's recent-captures tray.
    if (state.filter !== "all") setFilter("all", { fromHash: true });
    const r = byId(section);
    if (r && !r.deletedAt) openLightbox(r);
    try {
      history.replaceState(null, "", location.pathname);
    } catch {}
    return;
  }
  const known = [...document.querySelectorAll(".nav-item")].map((n) => n.dataset.filter);
  if (view && known.includes(view)) setFilter(view, { section, fromHash: true });
  if (view === "convert" && section) {
    try {
      history.replaceState(null, "", `${location.pathname}#convert`);
    } catch {}
  }
}

function setFilter(filter, { section = "", fromHash = false } = {}) {
  const from = state.filter;
  const same = from === filter;
  if (!same) clearSelection();
  if (!fromHash) {
    try {
      history.replaceState(null, "", filter === "all" ? location.pathname : `#${filter}`);
    } catch {}
  }
  state.filter = filter;
  document.querySelectorAll(".nav-item").forEach((el) => {
    if (el.dataset.filter === filter) el.setAttribute("aria-current", "true");
    else el.removeAttribute("aria-current");
  });
  syncNavPill();

  const direction = navIndex(filter) >= navIndex(from) ? "down" : "up";
  const swap = () => {
    showStage(filter);
    if (isToolView(filter)) return mountTool(filter, section);
    $("canvas").scrollTop = 0;
    // The transition carries the motion; cards only stagger on first paint.
    render({ animate: same || !document.startViewTransition });
  };
  if (same && !isToolView(filter)) {
    swap();
    return;
  }
  transition(swap, direction);
}

function setView(view) {
  state.view = view === "list" ? "list" : "grid";
  document.querySelectorAll("#view-toggle button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.view === state.view));
  });
  syncViewPill();
  try {
    localStorage.setItem("ss-gallery-view", state.view);
  } catch {}
  render({ animate: true });
}

function setSize(size, { announce = false } = {}) {
  const next = SIZES.includes(size) ? size : "m";
  if (next === state.size && grid.dataset.size === next) return;
  // Keep the card under the middle of the view in place while the grid reflows.
  const canvas = $("canvas");
  const mid = canvas.getBoundingClientRect();
  const anchor = document.elementFromPoint(mid.left + mid.width / 2, mid.top + mid.height / 2)?.closest?.(".card");
  const before = anchor?.getBoundingClientRect().top;

  state.size = next;
  grid.dataset.size = next;
  document.querySelectorAll("#size-toggle button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.size === next));
  });
  syncSizePill();
  try {
    localStorage.setItem("ss-gallery-size", next);
  } catch {}
  if (anchor && before !== undefined) {
    canvas.scrollTop += anchor.getBoundingClientRect().top - before;
  }
  if (announce) toast({ s: "Small thumbnails", m: "Medium thumbnails", l: "Large thumbnails" }[next], { duration: 1100 });
}

function stepSize(delta) {
  const i = SIZES.indexOf(state.size);
  const next = SIZES[Math.max(0, Math.min(SIZES.length - 1, i + delta))];
  if (next !== state.size) setSize(next, { announce: true });
}

function selectedRecords() {
  return [...state.selected].map(byId).filter(Boolean);
}

function wireGrid() {
  grid.addEventListener("click", (e) => {
    const pick = e.target.closest(".group-pick");
    if (pick) {
      const ids = [...grid.querySelectorAll(`.card[data-bucket="${pick.dataset.bucket}"]`)].map((c) => Number(c.dataset.id));
      const allOn = ids.length && ids.every((id) => state.selected.has(id));
      setSelected(ids, !allOn);
      return;
    }
    const target = e.target.closest("[data-action]");
    const card = e.target.closest(".card");
    const r = byId(card?.dataset.id);
    if (!r) return;
    const action = target?.dataset.action;

    if (action === "select") {
      toggleSelect(r.id, { range: e.shiftKey });
      return;
    }
    if (action === "fav") {
      toggleFavorite([r.id], !r.favorite);
      return;
    }
    if (action === "preview" || (!action && e.target.closest(".card-thumb-wrap"))) {
      if (e.metaKey || e.ctrlKey || (e.shiftKey && state.anchorId !== null) || state.selected.size) {
        toggleSelect(r.id, { range: e.shiftKey });
      } else {
        openLightbox(r, { hero: card.querySelector(".card-thumb img") });
      }
      return;
    }
    if (action === "copy") copyRecord(r, card);
    else if (action === "download") downloadRecords([r]);
    else if (action === "annotate") annotateRecord(r);
    else if (action === "trash") moveToTrash([r.id]);
    else if (action === "restore") restoreFromTrash([r.id]);
    else if (action === "purge") purge([r.id]);
  });

  grid.addEventListener("dblclick", (e) => {
    const title = e.target.closest(".card-title");
    const card = e.target.closest(".card");
    const r = byId(card?.dataset.id);
    if (title && r) beginRename(card, r);
  });
}

function wireHeaderAndBulk() {
  $("canvas-actions").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-head]");
    if (!b) return;
    const trashIds = state.records.filter((r) => r.deletedAt).map((r) => r.id);
    if (b.dataset.head === "restore-all") restoreFromTrash(trashIds);
    if (b.dataset.head === "empty-trash") {
      const ok = await confirmDialog({
        title: "Empty Trash?",
        body: `${formatNumber(trashIds.length)} capture${trashIds.length === 1 ? "" : "s"} will be deleted forever. This cannot be undone.`,
        confirm: "Empty Trash",
      });
      if (ok) purge(trashIds, { confirmFirst: false });
    }
  });

  $("bulk-bar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-bulk]");
    if (!b) return;
    const ids = [...state.selected];
    const kind = b.dataset.bulk;
    if (kind === "clear") clearSelection();
    else if (kind === "all") setSelected(visibleRecords().map((r) => r.id), true);
    else if (kind === "invert") invertSelection();
    else if (kind === "copy") {
      const r = byId(ids[0]);
      if (r) copyRecord(r, cardsFor([r.id])[0] || null);
    }
    else if (kind === "favorite") toggleFavorite(ids, b.dataset.mode !== "off");
    else if (kind === "download") downloadRecords(selectedRecords());
    else if (kind === "convert") openConverterWith(ids);
    else if (kind === "trash") moveToTrash(ids);
    else if (kind === "restore") restoreFromTrash(ids);
    else if (kind === "purge") purge(ids);
  });

  $("clear-all").addEventListener("click", async () => {
    const live = state.records.filter((r) => !r.deletedAt);
    const ids = live.filter((r) => !r.favorite).map((r) => r.id);
    const favs = live.length - ids.length;
    if (!ids.length) {
      toast("Only favorites are left. Unstar them to clear them.");
      return;
    }
    const ok = await confirmDialog({
      title: "Move everything to Trash?",
      body: `${formatNumber(ids.length)} screenshot${ids.length === 1 ? "" : "s"} move to Trash, where you can restore them for ${state.settings?.trashDays || 30} days.${favs ? ` ${formatNumber(favs)} favorite${favs === 1 ? " stays" : "s stay"} where ${favs === 1 ? "it is" : "they are"}.` : ""}`,
      confirm: "Move to Trash",
    });
    if (ok) moveToTrash(ids);
  });
}

function wireLightbox() {
  $("lb-close").addEventListener("click", closeLightbox);
  $("lb-fit").addEventListener("click", () => lightbox.classList.toggle("is-fit"));
  $("lb-img").addEventListener("click", () => lightbox.classList.toggle("is-fit"));
  $("lb-stage").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeLightbox();
  });
  $("lb-prev").addEventListener("click", () => stepLightbox(-1));
  $("lb-next").addEventListener("click", () => stepLightbox(1));
  $("lb-copy").addEventListener("click", () => {
    const r = currentLightboxRecord();
    if (r) copyRecord(r, null);
  });
  $("lb-download").addEventListener("click", () => {
    const r = currentLightboxRecord();
    if (r) downloadRecords([r]);
  });
  $("lb-annotate").addEventListener("click", () => {
    const r = currentLightboxRecord();
    if (r) annotateRecord(r);
  });
  $("lb-fav").addEventListener("click", () => {
    const r = currentLightboxRecord();
    if (r) toggleFavorite([r.id], !r.favorite);
  });
  $("lb-trash").addEventListener("click", () => {
    const r = currentLightboxRecord();
    if (!r) return;
    const shown = visibleRecords();
    const next = shown[shown.findIndex((x) => x.id === r.id) + 1];
    moveToTrash([r.id]).then(() => {
      if (next) openLightbox(next);
    });
  });
}

function wireKeyboard() {
  document.addEventListener("keydown", (e) => {
    const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (document.querySelector(".modal-root.is-open")) return;
    if (isToolView()) return;

    if (lightbox.classList.contains("is-open")) {
      const r = currentLightboxRecord();
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowRight") stepLightbox(1);
      else if (e.key === "ArrowLeft") stepLightbox(-1);
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && r && !getSelection()?.toString()) {
        e.preventDefault();
        copyRecord(r, null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && r && !r.deletedAt) {
        e.preventDefault();
        $("lb-trash").click();
      }
      return;
    }

    if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault();
      search.focus();
      search.select();
      return;
    }
    if (typing) {
      if (e.key === "Escape" && document.activeElement === search) {
        search.value = "";
        state.query = "";
        render();
        search.blur();
      }
      return;
    }
    if (e.key === "Escape") {
      clearSelection();
    } else if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "-" || e.key === "_")) {
      e.preventDefault();
      stepSize(-1);
    } else if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      stepSize(1);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && state.selected.size === 1 && !getSelection()?.toString()) {
      e.preventDefault();
      const r = byId([...state.selected][0]);
      if (r && !r.deletedAt) copyRecord(r, cardsFor([r.id])[0] || null);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i" && state.selected.size) {
      e.preventDefault();
      invertSelection();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      setSelected(
        visibleRecords().map((r) => r.id),
        true,
      );
    } else if ((e.key === "Delete" || e.key === "Backspace") && state.selected.size) {
      e.preventDefault();
      if (inTrashView()) purge([...state.selected]);
      else moveToTrash([...state.selected]);
    }
  });
}

async function init() {
  hydrateIcons();

  state.settings = await getSettings();
  setLocale(state.settings.uiLanguage);

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  document.querySelector(".search-hint").innerHTML =
    `<kbd class="kbd">/</kbd><kbd class="kbd">${isMac ? "⌘" : "Ctrl"} K</kbd>`;

  syncNavPill = mountPill($("nav"), '.nav-item[aria-current="true"]');
  syncViewPill = mountPill($("view-toggle"), '[aria-checked="true"]');
  syncSizePill = mountPill($("size-toggle"), '[aria-checked="true"]');
  try {
    state.size = SIZES.includes(localStorage.getItem("ss-gallery-size")) ? localStorage.getItem("ss-gallery-size") : "m";
  } catch {}
  grid.dataset.size = state.size;
  document.querySelectorAll("#size-toggle button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.size === state.size));
  });
  syncSizePill();
  $("size-toggle").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-size]");
    if (b) setSize(b.dataset.size);
  });
  // Ctrl/⌘ + wheel over the captures resizes the thumbnails instead of the page.
  let wheelAt = 0;
  $("canvas").addEventListener(
    "wheel",
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || isToolView()) return;
      e.preventDefault();
      const now = Date.now();
      if (now - wheelAt < 220 || Math.abs(e.deltaY) < 4) return;
      wheelAt = now;
      stepSize(e.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );

  try {
    state.view = localStorage.getItem("ss-gallery-view") === "list" ? "list" : "grid";
  } catch {}
  document.querySelectorAll("#view-toggle button").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.view === state.view));
  });
  syncViewPill();

  $("nav").addEventListener("click", (e) => {
    const item = e.target.closest(".nav-item");
    if (item) setFilter(item.dataset.filter);
  });
  $("view-toggle").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (b && b.dataset.view !== state.view) setView(b.dataset.view);
  });

  let searchTimer = 0;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = search.value;
      render();
    }, 90);
  });

  document.querySelectorAll("[data-capture]").forEach((b) => {
    b.addEventListener("click", () => runCapture(b.dataset.capture));
  });
  $("open-settings").addEventListener("click", () => setFilter("settings"));
  window.addEventListener("hashchange", routeFromHash);

  $("empty-cta").addEventListener("click", (e) => {
    const mode = e.currentTarget.dataset.mode;
    if (mode === "clear-search") {
      search.value = "";
      state.query = "";
      render();
      search.focus();
    } else if (mode === "show-all") {
      setFilter("all");
    } else {
      runCapture("region");
    }
  });

  wireGrid();
  wireHeaderAndBulk();
  wireLightbox();
  wireKeyboard();
  wireDragAndDrop();
  wireMarquee();
  wireImport();
  wireIssues();

  // Stay live: captures from other tabs, retention runs, other gallery tabs.
  let reloadTimer = 0;
  onGalleryChange(() => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(load, 150);
  });
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    state.settings = await getSettings();
    if (changes.uiLanguage) setLocale(state.settings.uiLanguage);
    if (changes.uiLanguage || changes.trashDays) render();
  });
  // Relative times and the Recent/Earlier split drift with the clock.
  setInterval(() => {
    if (!document.hidden && !lightbox.classList.contains("is-open") && !dragIds) render();
  }, 5 * 60 * 1000);

  // Apply retention before the first paint so expired captures never flash.
  try {
    await applyRetention(state.settings);
  } catch {}
  state.records = await listCaptures().catch(() => []);
  render({ animate: true });
  routeFromHash();
}

// ─── Notices ─────────────────────────────────────────────────────────
// Capture problems from web pages (a failed capture, a full-page capture cut
// short by a closed tab) wait here behind a small icon, each dismissible.

async function renderIssues({ fresh = false } = {}) {
  const list = await listIssues();
  const wrap = $("issues");
  wrap.hidden = list.length === 0;
  if (!list.length) {
    closeIssues();
    return;
  }
  const errors = list.filter((i) => i.kind === "error").length;
  $("issues-count").textContent = formatNumber(list.length);
  wrap.dataset.kind = errors ? "error" : "warn";
  if (fresh) {
    wrap.classList.remove("is-new");
    void wrap.offsetWidth;
    wrap.classList.add("is-new");
  }
  const ul = $("issues-list");
  ul.replaceChildren(
    ...list.map((i) => {
      const li = document.createElement("li");
      li.className = `issue is-${i.kind}`;
      li.dataset.id = i.id;
      li.innerHTML = `<span class="issue-glyph">${icon(i.kind === "error" ? "alert" : "warn")}</span>
        <div class="issue-text"><b></b><p></p><small></small></div>
        <button type="button" class="issue-dismiss" aria-label="Dismiss" data-tip="Dismiss">${icon("close")}</button>`;
      li.querySelector("b").textContent = i.count > 1 ? `${i.title} (×${i.count})` : i.title;
      li.querySelector("p").textContent = i.detail || "";
      let where = "";
      try {
        where = i.source ? new URL(i.source).hostname : "";
      } catch {}
      li.querySelector("small").textContent = [formatRelative(i.at), where].filter(Boolean).join(" · ");
      return li;
    }),
  );
}

function closeIssues() {
  $("issues-pop").hidden = true;
  $("issues-btn").setAttribute("aria-expanded", "false");
}

function wireIssues() {
  $("issues-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const pop = $("issues-pop");
    pop.hidden = !pop.hidden;
    $("issues-btn").setAttribute("aria-expanded", String(!pop.hidden));
    $("issues").classList.remove("is-new");
  });
  $("issues-list").addEventListener("click", async (e) => {
    const b = e.target.closest(".issue-dismiss");
    if (!b) return;
    const li = b.closest(".issue");
    li.classList.add("is-leaving");
    await new Promise((r) => setTimeout(r, 180));
    await dismissIssue(li.dataset.id);
  });
  $("issues-clear").addEventListener("click", () => clearIssues());
  document.addEventListener("click", (e) => {
    if (!$("issues-pop").hidden && !e.target.closest("#issues")) closeIssues();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("issues-pop").hidden) {
      e.stopPropagation();
      closeIssues();
    }
  }, true);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[ISSUES_KEY]) {
      const before = changes[ISSUES_KEY].oldValue?.length || 0;
      const after = changes[ISSUES_KEY].newValue?.length || 0;
      renderIssues({ fresh: after > before });
    }
  });
  renderIssues();
}

// ─── Import: drop image files or paste an image ──────────────────────

const IMPORT_TYPES = /^image\/(png|jpe?g|webp|gif|bmp|avif)$/;

async function importFiles(files) {
  const images = [...files].filter((f) => IMPORT_TYPES.test(f.type));
  if (!images.length) {
    if (files.length) toast("Only image files can be added", { error: true });
    return;
  }
  let added = 0;
  for (const file of images) {
    try {
      const name = (file.name || "").replace(/\.[a-z0-9]+$/i, "");
      await addCapture({
        blob: file,
        title: name || "Pasted image",
        type: "imported",
        createdAt: Date.now(),
      });
      added++;
    } catch {}
  }
  if (added) {
    if (state.filter === "trash") setFilter("all");
    toast(added === 1 ? "Image added to the gallery" : `${formatNumber(added)} images added`);
  } else {
    toast("Could not add the image", { error: true });
  }
}

function wireImport() {
  // The Batch Converter takes its own drops and pastes while it is showing.
  const isFileDrag = (e) => !dragIds && !isToolView() && [...(e.dataTransfer?.types || [])].includes("Files");
  let depth = 0;
  const end = () => {
    depth = 0;
    document.body.classList.remove("is-importing");
  };

  document.addEventListener("dragenter", (e) => {
    if (!isFileDrag(e)) return;
    depth++;
    document.body.classList.add("is-importing");
  });
  document.addEventListener("dragleave", (e) => {
    if (!isFileDrag(e)) return;
    if (--depth <= 0) end();
  });
  document.addEventListener("dragover", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  document.addEventListener("drop", (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    end();
    importFiles(e.dataTransfer.files);
  });
  window.addEventListener("blur", end);

  document.addEventListener("paste", (e) => {
    if (isToolView() || e.target.closest?.("input, textarea, [contenteditable]")) return;
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    importFiles(files);
  });
}

init();
