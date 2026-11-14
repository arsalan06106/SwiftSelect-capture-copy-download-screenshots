/**
 * The capture toolbar's panel: the Gallery and Settings without leaving the
 * page.
 *
 * The Gallery and Settings tiles (or the chevron) grow the toolbar itself:
 * its pill reshapes into a panel that unfolds under the buttons, or above
 * them when the toolbar sits low on the page. While it is open the two
 * tiles fuse into the panel's tabs. (Convert opens the full Batch Converter,
 * where images are dropped and handled in bulk.)
 *
 *   Gallery   the newest captures: drag one into the page (a file drop, as
 *             if from the desktop), click to copy, download, convert or
 *             annotate.
 *   Settings  the settings people change most (src/panelSettings.js).
 *
 * Each tab has a small button that opens its full page in a new tab. The
 * panel closes on Esc, the chevron, a press outside the toolbar, or when a
 * capture starts. Gallery images come from the service worker (see
 * src/peekData.js): small previews up front, full files fetched in the
 * background, nearest first.
 */
import { writeImageBlobToClipboard } from "./capture/utils.js";
import { downloadBlob } from "./capture/download.js";
import { openAnnotationEditor } from "./capture/annotate.js";
import { mountSettingsTab } from "./panelSettings.js";

const LIMIT = 14;
const PREFETCH_BUDGET = 160 * 1024 * 1024;
const PREFETCH_MAX_ITEM = 48 * 1024 * 1024;

const TYPE_LABEL = {
  region: "Region",
  visible: "Visible",
  fullpage: "Full page",
  horizontal: "Horizontal",
  annotated: "Annotated",
  imported: "Imported",
  converted: "Converted",
};

const SVG = {
  gallery:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 5-4.5 3.5 3L16 12l4.5 4.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/><rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/></svg>',
  download:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/></svg>',
  annotate:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 20H21"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  collapse:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  external:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/><path d="M14 4h6v6M20 4l-9 9"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  drag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10V5a1.5 1.5 0 0 1 3 0v5"/><path d="M14 10.5V7a1.5 1.5 0 0 1 3 0v6.5a6.5 6.5 0 0 1-6.5 6.5h-.6a5.5 5.5 0 0 1-4.4-2.2L4.2 15a1.6 1.6 0 0 1 2.5-2L8 14.5"/></svg>',
  sliders:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
  convert:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h13M13.5 4.5 17 8l-3.5 3.5"/><path d="M20 16H7M10.5 12.5 7 16l3.5 3.5"/></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

const s = {
  guide: null, // the toolbar element that grows
  host: null, // the toolbar's shadow host
  tray: null, // the drawer inside the toolbar
  strip: null,
  saved: null, // the toolbar's inline position before it grew
  open: false,
  closing: false,
  detached: false,
  dragging: false,
  up: false,
  items: [],
  files: new Map(), // id → { file, url }
  pending: new Map(), // id → Promise
  closeTimer: 0,
  tab: "gallery",
  lastTab: "gallery",
  panes: null,
  anchor: null,
  generation: 0,
  onKey: null,
  onOutside: null,
  dragFile: null,
};

/**
 * In-page drops: the file goes on the drag at dragstart, but if the drop
 * target receives the drag without it (some pages, some Chrome builds),
 * hand the same target a drop that does carry the file. Most upload areas
 * listen for exactly this event.
 */
function relayDrop(e) {
  const file = s.dragFile;
  if (!s.dragging || !file) return;
  const dt0 = e.dataTransfer;
  if (dt0 && [...(dt0.types || [])].includes("Files") && dt0.files?.length) return;
  const target = e.composedPath?.()[0] || e.target;
  if (!target || target === s.host || (s.guide && target.getRootNode?.() === s.guide.getRootNode())) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: e.clientX,
      clientY: e.clientY,
      screenX: e.screenX,
      screenY: e.screenY,
      dataTransfer: dt,
    };
    target.dispatchEvent(new DragEvent("drop", init));
  } catch (err) {
    console.debug("SwiftSelect: drop relay failed", err);
  }
}

// ─── Messaging ───────────────────────────────────────────────────────

function send(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) return resolve({ success: false, error: chrome.runtime.lastError.message });
        resolve(resp || { success: false });
      });
    } catch (err) {
      resolve({ success: false, error: err?.message });
    }
  });
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The full image as a File, fetched once and kept while the tray is open. */
function ensureFile(item) {
  const have = s.files.get(item.id);
  if (have) return Promise.resolve(have);
  if (s.pending.has(item.id)) return s.pending.get(item.id);
  const gen = s.generation;
  const job = (async () => {
    const first = await send({ type: "gallery-peek-chunk", id: item.id, index: 0 });
    if (!first?.success) throw new Error(first?.error || "Could not read the capture");
    const parts = [base64ToBytes(first.data)];
    for (let i = 1; i < first.total; i++) {
      const next = await send({ type: "gallery-peek-chunk", id: item.id, index: i });
      if (!next?.success) throw new Error(next?.error || "Could not read the capture");
      parts.push(base64ToBytes(next.data));
    }
    const file = new File(parts, item.name || `screenshot-${item.id}.png`, { type: first.mime || item.mime || "image/png" });
    const entry = { file, url: URL.createObjectURL(file) };
    if (gen !== s.generation) {
      // The tray closed while this was loading.
      setTimeout(() => URL.revokeObjectURL(entry.url), 1000);
      return entry;
    }
    s.files.set(item.id, entry);
    cardFor(item.id)?.classList.remove("is-loading");
    return entry;
  })();
  s.pending.set(item.id, job);
  job.catch(() => {}).finally(() => s.pending.delete(item.id));
  return job;
}

async function prefetch(gen) {
  let budget = PREFETCH_BUDGET;
  for (const item of s.items) {
    if (gen !== s.generation) return;
    if (item.size > PREFETCH_MAX_ITEM || item.size > budget) continue;
    budget -= item.size;
    try {
      await ensureFile(item);
    } catch {}
  }
}

// ─── Formatting ──────────────────────────────────────────────────────

function ago(ts) {
  const d = Date.now() - ts;
  const min = Math.round(d / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleDateString();
  }
}

function titleOf(item) {
  if (item.title) return item.title;
  try {
    return new URL(item.url).hostname;
  } catch {
    return `${TYPE_LABEL[item.type] || "Capture"} screenshot`;
  }
}

// ─── Tray ────────────────────────────────────────────────────────────

export function isPeekOpen() {
  return s.open && !s.closing;
}

export function isPeekDetached() {
  return s.open && s.detached;
}

function ui() {
  return window.SwiftSelect?.ui;
}

function cardFor(id) {
  return s.strip?.querySelector(`.qs-peek-card[data-id="${id}"]`) || null;
}

function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html) node.innerHTML = html;
  return node;
}

function iconBtn(act, label, svg) {
  const b = el("button", "qs-peek-act", svg);
  b.type = "button";
  b.dataset.act = act;
  b.setAttribute("aria-label", label);
  b.dataset.tip = label;
  return b;
}

const TABS = {
  gallery: { label: "Gallery", open: "Open Gallery", message: "open-gallery", sub: "Drag in, or click to copy" },
  settings: { label: "Settings", open: "All settings", message: "open-settings", sub: "Applies straight away" },
};

/**
 * Open the panel on a tab (or switch tabs when it is already open).
 * With no tab, it opens on the last one used (Gallery the first time).
 */
export async function openPeek(anchor = s.anchor, tab = null) {
  const want = TABS[tab] ? tab : s.lastTab || "gallery";
  if (s.open && !s.closing) {
    showTab(want);
    return;
  }
  const U = ui();
  if (document.getElementById("swiftselect-annotate-root")) return;
  const guide = anchor?.closest?.(".qs-guide");
  if (!guide) return;

  clearTimeout(s.closeTimer);
  teardown(true);
  s.generation++;
  const gen = s.generation;
  s.open = true;
  s.closing = false;
  s.detached = false;
  s.anchor = anchor;
  s.guide = guide;
  s.host = guide.getRootNode()?.host || null;

  U?.hideCustomTooltip?.();
  // Tooltips of the tiles that fused into tabs must not linger.
  U?.setTooltipGuard?.((btn) => !(s.open && btn.closest?.(".qs-fuse, .qs-expand-btn")));

  // Grow downward, or upward when the toolbar sits in the lower part of the
  // page (pin its bottom edge so the buttons stay where the pointer is).
  const r = guide.getBoundingClientRect();
  const drawerH = 330;
  s.up = r.bottom + drawerH > window.innerHeight - 12 && r.top > drawerH;
  s.saved = {
    top: guide.style.getPropertyValue("top"),
    topP: guide.style.getPropertyPriority("top"),
    bottom: guide.style.getPropertyValue("bottom"),
    bottomP: guide.style.getPropertyPriority("bottom"),
    radius: guide.style.getPropertyValue("border-radius"),
  };
  if (s.up) {
    guide.style.setProperty("top", "auto", "important");
    guide.style.setProperty("bottom", `${Math.round(window.innerHeight - r.bottom)}px`, "important");
  }
  // Start the corner morph from the pill's real radius, not 999px, so the
  // shape eases instead of snapping.
  guide.style.setProperty("border-radius", `${Math.round(r.height / 2)}px`, "important");
  void guide.offsetWidth;

  const tray = el("div", "qs-peek-drawer");
  tray.setAttribute("role", "region");
  tray.setAttribute("aria-label", "Toolbar panel");
  s.tray = tray;
  const inner = el("div", "qs-peek-inner");

  // Head: tabs on the left, "open in a tab" on the right.
  const head = el("div", "qs-peek-head");
  const tabs = el("div", "qs-panel-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.appendChild(el("i", "qs-panel-tab-pill"));
  for (const [key, cfg] of Object.entries(TABS)) {
    const b = el("button", "qs-panel-tab");
    b.type = "button";
    b.dataset.tab = key;
    b.setAttribute("role", "tab");
    b.innerHTML = `${key === "gallery" ? SVG.gallery : SVG.sliders}<span>${cfg.label}</span>`;
    b.addEventListener("click", () => showTab(key));
    tabs.appendChild(b);
  }
  const openBtn = el("button", "qs-peek-open", `<span></span>${SVG.external}`);
  openBtn.type = "button";
  openBtn.addEventListener("click", () => {
    const cfg = TABS[s.tab];
    closePeek({ immediate: true });
    window.SwiftSelect?.events?.cleanup?.();
    U?.cleanup?.();
    try {
      chrome.runtime.sendMessage({ type: cfg.message }, () => void chrome.runtime.lastError);
    } catch {}
  });
  const sub = el("div", "qs-peek-sub");
  head.append(tabs, sub, openBtn);

  // Panes: built once per opening, kept while switching tabs.
  const body = el("div", "qs-panel-body");
  const gallery = el("div", "qs-pane qs-pane-gallery");
  gallery.dataset.tab = "gallery";
  const strip = el("div", "qs-peek-strip");
  strip.setAttribute("role", "list");
  s.strip = strip;
  for (let i = 0; i < 4; i++) {
    const sk = el("div", "qs-peek-skeleton");
    sk.style.setProperty("--i", String(i));
    strip.appendChild(sk);
  }
  gallery.appendChild(strip);
  const settings = el("div", "qs-pane qs-pane-settings");
  settings.dataset.tab = "settings";
  body.append(gallery, settings);
  s.panes = { gallery, settings, body, tabs, openBtn, sub, mounted: new Set() };

  inner.append(head, body);
  tray.appendChild(inner);
  guide.appendChild(tray);
  guide.classList.add("qs-grow");
  guide.classList.toggle("qs-grow-up", s.up);
  guide.querySelector(".qs-expand-btn")?.setAttribute("aria-expanded", "true");
  wireTray(tray, strip);
  showTab(want, { instant: true });
  // The bar narrows while the tiles fuse; keep the tab highlight on its tab.
  try {
    new ResizeObserver(() => placeTabPill()).observe(tabs);
  } catch {}

  // Unfold on the next frame so the folded state is painted first.
  requestAnimationFrame(() => requestAnimationFrame(() => s.tray === tray && guide.classList.add("qs-grow-in")));

  const resp = await send({ type: "gallery-peek", limit: LIMIT });
  if (gen !== s.generation) return;
  renderItems(resp);
  if (resp?.success && resp.items?.length) prefetch(gen);
}

/** Switch tabs; the panel eases to the new pane's height. */
function showTab(tab, { instant = false } = {}) {
  const p = s.panes;
  if (!p || !TABS[tab]) return;
  const before = p.body.offsetHeight;
  s.tab = tab;
  s.lastTab = tab;
  for (const key of Object.keys(TABS)) {
    const on = key === tab;
    p[key].hidden = !on;
    const b = p.tabs.querySelector(`[data-tab="${key}"]`);
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  }
  placeTabPill();
  p.openBtn.querySelector("span").textContent = TABS[tab].open;
  if (!s.detached || tab !== "gallery") p.sub.textContent = TABS[tab].sub;

  if (!p.mounted.has(tab)) {
    p.mounted.add(tab);
    if (tab === "settings") mountSettingsTab(p.settings);
  }

  if (instant || prefersReducedMotion()) return;
  const after = p.body.offsetHeight;
  if (before && after && before !== after) {
    p.body.animate([{ height: `${before}px` }, { height: `${after}px` }], { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
  }
  p[tab].animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
}

function placeTabPill() {
  const p = s.panes;
  if (!p) return;
  const active = p.tabs.querySelector(`[data-tab="${s.tab}"]`);
  const pill = p.tabs.querySelector(".qs-panel-tab-pill");
  if (!active || !pill) return;
  pill.style.setProperty("--x", `${active.offsetLeft}px`);
  pill.style.setProperty("--w", `${active.offsetWidth}px`);
}

function prefersReducedMotion() {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function renderItems(resp) {
  const strip = s.strip;
  if (!strip) return;
  strip.replaceChildren();
  s.items = resp?.success ? resp.items || [] : [];

  if (!resp?.success || !s.items.length) {
    s.panes.gallery.classList.add("is-empty");
    const empty = el("div", "qs-peek-empty");
    const art = el("span", "qs-peek-empty-art", SVG.gallery);
    const text = el("div", "qs-peek-empty-text");
    const t = el("b");
    const p = el("span");
    if (!resp?.success) {
      t.textContent = "The gallery could not be read";
      p.textContent = "Try again in a moment, or open the Gallery.";
    } else if (resp.enabled === false) {
      t.textContent = "Your gallery is empty, and saving is off";
      p.textContent = "Turn on “Keep in Gallery” in the Settings tab and every capture will wait here.";
    } else {
      t.textContent = "No captures yet";
      p.textContent = "Take one with the buttons above. It will wait here, ready to drag into any page.";
    }
    text.append(t, p);
    empty.append(art, text);
    if (resp?.success && resp.enabled === false) {
      const go = el("button", "qs-peek-cta", "Turn it on");
      go.type = "button";
      go.addEventListener("click", () => showTab("settings"));
      empty.appendChild(go);
    }
    strip.appendChild(empty);
    if (s.tab === "gallery") s.panes.sub.textContent = resp?.success ? "Your gallery is empty" : "Something went wrong";
    return;
  }

  s.panes.gallery.classList.remove("is-empty");
  s.items.forEach((item, i) => strip.appendChild(buildCard(item, i)));
  if (resp.more) {
    const more = el("button", "qs-peek-more", `<span class="qs-peek-more-ic">${SVG.arrow}</span><b>See all</b><span>in the Gallery</span>`);
    more.type = "button";
    more.style.setProperty("--i", String(s.items.length));
    more.addEventListener("click", () => {
      closePeek({ immediate: true });
      window.SwiftSelect?.events?.cleanup?.();
      ui()?.cleanup?.();
      ui()?.openGallery?.();
    });
    strip.appendChild(more);
  }
}

function buildCard(item, i) {
  const card = el("div", "qs-peek-card is-loading");
  card.dataset.id = item.id;
  card.setAttribute("role", "listitem");
  card.tabIndex = 0;
  card.draggable = true;
  card.style.setProperty("--i", String(i));
  card.title = "";
  card.setAttribute("aria-label", `${titleOf(item)}. Drag into the page, or press Enter to copy.`);

  const thumb = el("div", "qs-peek-thumb");
  const img = document.createElement("img");
  img.alt = "";
  img.draggable = false;
  img.decoding = "async";
  if (item.thumb) img.src = item.thumb;
  thumb.appendChild(img);
  const badge = el("span", "qs-peek-badge");
  badge.textContent = TYPE_LABEL[item.type] || "Capture";
  badge.dataset.type = item.type;
  thumb.appendChild(badge);
  const flag = el("span", "qs-peek-flag");
  thumb.appendChild(flag);
  const spin = el("span", "qs-peek-spin");
  thumb.appendChild(spin);

  const acts = el("div", "qs-peek-acts");
  acts.append(
    iconBtn("copy", "Copy", SVG.copy),
    iconBtn("download", "Download", SVG.download),
    iconBtn("convert", "Convert", SVG.convert),
    iconBtn("annotate", "Annotate", SVG.annotate),
  );
  thumb.appendChild(acts);

  const meta = el("div", "qs-peek-meta");
  const t = el("b");
  t.textContent = titleOf(item);
  const sub = el("span");
  const dims = item.width && item.height ? `${item.width.toLocaleString()} × ${item.height.toLocaleString()}` : "";
  sub.textContent = [dims, ago(item.createdAt)].filter(Boolean).join(" · ");
  meta.append(t, sub);

  card.append(thumb, meta);
  return card;
}

function flash(card, text, kind = "ok") {
  if (!card) return;
  const flag = card.querySelector(".qs-peek-flag");
  if (flag) flag.innerHTML = `${kind === "ok" ? SVG.check : ""}<span></span>`;
  flag?.querySelector("span") && (flag.querySelector("span").textContent = text);
  card.dataset.flag = kind;
  card.classList.remove("is-flash");
  void card.offsetWidth;
  card.classList.add("is-flash");
  clearTimeout(card._flashTimer);
  card._flashTimer = setTimeout(() => card.classList.remove("is-flash"), 1600);
}

/**
 * Leave capture mode but keep the tray: after a copy or a drag the person
 * wants the page back (to paste, to drop), with the other captures still
 * at hand.
 */
function detach() {
  if (s.detached || !s.open) return;
  s.detached = true;
  s.guide?.classList.add("qs-grow-detached");
  if (s.panes && s.tab === "gallery") s.panes.sub.textContent = "Paste it, or drag another · Esc closes";
  // Leave capture mode so the page is usable again (click to paste, drop
  // targets react), but keep the toolbar and its drawer on screen.
  setTimeout(() => {
    window.SwiftSelect?.events?.cleanup?.();
    const U = ui();
    U?.removeCrosshairCursor?.();
    if (U?.overlayHost) U.overlayHost.style.display = "none";
    U?.setTooltipGuard?.(null);
  }, 0);
}

async function toPng(blob) {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  bitmap.close?.();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("PNG encode failed"))), "image/png"));
}

async function copyItem(item, card) {
  card?.classList.add("is-busy");
  const png = ensureFile(item).then((entry) => toPng(entry.file));
  let ok = false;
  try {
    // Handing the clipboard a promise keeps the write inside this click's
    // user activation even while the file is still arriving.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    ok = true;
  } catch {
    try {
      ok = await writeImageBlobToClipboard(await png);
    } catch {
      ok = false;
    }
  }
  card?.classList.remove("is-busy");
  flash(card, ok ? "Copied" : "Copy blocked", ok ? "ok" : "error");
  if (ok) detach();
}

async function downloadItem(item, card) {
  card?.classList.add("is-busy");
  let ok = false;
  try {
    const entry = await ensureFile(item);
    ok = await downloadBlob(entry.file, item.name);
  } catch {}
  card?.classList.remove("is-busy");
  flash(card, ok ? "Saved" : "Download failed", ok ? "ok" : "error");
}

/** Open the Batch Converter in the Gallery with this capture in it. */
function convertItem(item, card) {
  flash(card, "Opening converter", "ok");
  try {
    chrome.runtime.sendMessage({ type: "open-convert", ids: [item.id] }, () => void chrome.runtime.lastError);
  } catch {}
}

async function annotateItem(item, card) {
  card?.classList.add("is-busy");
  try {
    const entry = await ensureFile(item);
    const file = entry.file;
    closePeek({ immediate: true });
    window.SwiftSelect?.events?.cleanup?.();
    ui()?.cleanup?.();
    openAnnotationEditor(file, { title: item.title, url: item.url, fromGallery: true });
  } catch {
    card?.classList.remove("is-busy");
    flash(card, "Could not open", "error");
  }
}

function itemFor(node) {
  const card = node?.closest?.(".qs-peek-card");
  if (!card) return {};
  const id = Number(card.dataset.id);
  return { card, item: s.items.find((x) => x.id === id) };
}

function wireTray(tray, strip) {
  // Nothing in the tray may start a region selection underneath it.
  ["pointerdown", "mousedown", "click", "dblclick", "contextmenu"].forEach((type) =>
    tray.addEventListener(type, (e) => e.stopPropagation()),
  );

  // A vertical wheel scrolls the strip sideways.
  strip.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      strip.scrollLeft += e.deltaY;
    },
    { passive: false },
  );

  strip.addEventListener("pointerover", (e) => {
    const { item } = itemFor(e.target);
    if (item) ensureFile(item).catch(() => {});
  });

  strip.addEventListener("click", (e) => {
    const { card, item } = itemFor(e.target);
    if (!item) return;
    const act = e.target.closest?.(".qs-peek-act")?.dataset.act || "copy";
    if (act === "download") downloadItem(item, card);
    else if (act === "convert") convertItem(item, card);
    else if (act === "annotate") annotateItem(item, card);
    else copyItem(item, card);
  });

  strip.addEventListener("keydown", (e) => {
    const { card, item } = itemFor(e.target);
    if (!item || e.target !== card) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      copyItem(item, card);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = e.key === "ArrowRight" ? card.nextElementSibling : card.previousElementSibling;
      next?.focus?.();
    }
  });

  strip.addEventListener("dragstart", (e) => {
    const { card, item } = itemFor(e.target);
    if (!item) return;
    const entry = s.files.get(item.id);
    if (!entry) {
      // The full file is not here yet; a drag cannot wait for it.
      e.preventDefault();
      card.classList.add("is-loading");
      flash(card, "Getting it ready…", "wait");
      ensureFile(item)
        .then(() => flash(card, "Ready, drag again", "ok"))
        .catch(() => flash(card, "Could not load", "error"));
      return;
    }
    e.dataTransfer.effectAllowed = "copy";
    try {
      e.dataTransfer.items.add(entry.file);
    } catch {}
    try {
      // Dropped outside the browser (desktop, another app) it saves as a file.
      e.dataTransfer.setData("DownloadURL", `${entry.file.type}:${entry.file.name}:${entry.url}`);
    } catch {}
    const img = card.querySelector(".qs-peek-thumb img");
    if (img?.complete && img.naturalWidth) {
      try {
        e.dataTransfer.setDragImage(img, Math.min(80, img.width / 2), Math.min(50, img.height / 2));
      } catch {}
    }
    s.dragging = true;
    s.dragFile = entry.file;
    document.addEventListener("drop", relayDrop, true);
    // Changing layout inside dragstart can cancel the drag; defer it.
    setTimeout(() => {
      s.guide?.classList.add("qs-grow-dragging");
      card.classList.add("is-dragged");
      detach();
    }, 0);
  });

  strip.addEventListener("dragend", (e) => {
    const { card } = itemFor(e.target);
    s.dragging = false;
    s.dragFile = null;
    document.removeEventListener("drop", relayDrop, true);
    s.guide?.classList.remove("qs-grow-dragging");
    card?.classList.remove("is-dragged");
    if (card && e.dataTransfer?.dropEffect && e.dataTransfer.dropEffect !== "none") flash(card, "Dropped", "ok");
  });

  s.onKey = (e) => {
    if (e.key !== "Escape" || !s.open) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    closePeek({ finish: s.detached });
  };
  window.addEventListener("keydown", s.onKey, true);

  // A press anywhere else puts the tray away (selection starts, or the
  // person clicks into the page to paste).
  s.onOutside = (e) => {
    if (!s.open || s.dragging) return;
    const path = e.composedPath?.() || [];
    if (path.includes(s.guide) || (s.host && path.includes(s.host))) return;
    closePeek({ finish: s.detached });
  };
  window.addEventListener("pointerdown", s.onOutside, true);
}

/**
 * Fold the drawer away. `finish` also puts the toolbar away: used once the
 * person has taken something out of the drawer, since capture mode has
 * already ended by then.
 */
export function closePeek({ immediate = false, finish = false } = {}) {
  if (!s.open || s.closing) return;
  s.closing = true;
  ui()?.setTooltipGuard?.(null);
  const guide = s.guide;
  const done = () => {
    teardown();
    if (finish) {
      const U = ui();
      U?.hideGuide?.();
      setTimeout(() => U?.cleanup?.(), 200);
    }
  };
  if (!guide || !guide.isConnected || immediate) return done();
  guide.classList.remove("qs-grow-in");
  clearTimeout(s.closeTimer);
  s.closeTimer = setTimeout(done, 300);
}

function teardown(silent = false) {
  if (s.onKey) window.removeEventListener("keydown", s.onKey, true);
  if (s.onOutside) window.removeEventListener("pointerdown", s.onOutside, true);
  s.onKey = null;
  s.onOutside = null;
  s.tray?.remove();
  const g = s.guide;
  if (g) {
    g.classList.remove("qs-grow", "qs-grow-in", "qs-grow-up", "qs-grow-detached", "qs-grow-dragging");
    const v = s.saved;
    if (v) {
      if (v.top) g.style.setProperty("top", v.top, v.topP);
      else g.style.removeProperty("top");
      if (v.bottom) g.style.setProperty("bottom", v.bottom, v.bottomP);
      else g.style.removeProperty("bottom");
      if (v.radius) g.style.setProperty("border-radius", v.radius);
      else g.style.removeProperty("border-radius");
    }
  }
  g?.querySelector(".qs-expand-btn")?.setAttribute("aria-expanded", "false");
  s.guide = null;
  s.saved = null;
  s.panes = null;
  s.host = null;
  s.tray = null;
  s.strip = null;
  // Revoke late: a file dropped outside the browser is fetched after dragend.
  const urls = [...s.files.values()].map((f) => f.url);
  if (urls.length) setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 60000);
  s.files.clear();
  s.pending.clear();
  s.items = [];
  s.dragging = false;
  s.dragFile = null;
  document.removeEventListener("drop", relayDrop, true);
  if (!silent) s.generation++;
  s.open = false;
  s.closing = false;
  s.detached = false;
}
