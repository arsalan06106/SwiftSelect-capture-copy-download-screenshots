/**
 * Gallery peek tray.
 *
 * Rest the pointer on the Gallery button of the capture toolbar for three
 * seconds and the newest captures slide in along the bottom of the page
 * (or the top, when the toolbar has been dragged into the lower half).
 * Each one can be dragged straight into the page (a file drop, as if it came
 * from the desktop), clicked to copy, downloaded or opened in the editor.
 *
 * The button shows a ring filling up while it waits, so the delay reads as
 * "keep holding" rather than as lag. The Gallery tooltip is vetoed while the
 * tray is open so the two are never on screen together.
 *
 * The tray does not vanish when the pointer wanders off (the trip from a
 * toolbar at the top to a tray at the bottom takes a moment); it closes on
 * Esc, its close button, a press anywhere else, or when a capture starts.
 *
 * Images come from the service worker (see src/peekData.js): small previews
 * up front, full files fetched in the background, nearest-first.
 */
import { applyElementTheme, currentUserTheme } from "./theme.js";
import { writeImageBlobToClipboard } from "./capture/utils.js";
import { downloadBlob } from "./capture/download.js";
import { openAnnotationEditor } from "./capture/annotate.js";

const HOLD_MS = 3000;
const RING_DELAY_MS = 650;
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
};

const SVG = {
  gallery:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 5-4.5 3.5 3L16 12l4.5 4.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/><rect x="8.5" y="8.5" width="12" height="12" rx="2.5"/></svg>',
  download:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/></svg>',
  annotate:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 20H21"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
  external:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/><path d="M14 4h6v6M20 4l-9 9"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  drag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10V5a1.5 1.5 0 0 1 3 0v5"/><path d="M14 10.5V7a1.5 1.5 0 0 1 3 0v6.5a6.5 6.5 0 0 1-6.5 6.5h-.6a5.5 5.5 0 0 1-4.4-2.2L4.2 15a1.6 1.6 0 0 1 2.5-2L8 14.5"/></svg>',
  arrow:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

const s = {
  host: null,
  shadow: null,
  tray: null,
  strip: null,
  open: false,
  closing: false,
  detached: false,
  dragging: false,
  edge: "bottom",
  items: [],
  files: new Map(), // id → { file, url }
  pending: new Map(), // id → Promise
  closeTimer: 0,
  holdTimer: 0,
  ringTimer: 0,
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
  if (!target || s.host?.contains?.(target) || target === s.host) return;
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

// ─── Hold to open ────────────────────────────────────────────────────

/** Arm a button: holding the pointer on it for three seconds opens the tray. */
export function armPeek(btn) {
  if (!btn || btn._qsPeek) return;
  btn._qsPeek = true;
  btn.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "touch" || (s.open && !s.closing)) return;
    startHold(btn);
  });
  btn.addEventListener("pointerleave", () => cancelHold(btn));
  btn.addEventListener("pointerdown", () => cancelHold(btn));
}

function ringOf(btn) {
  let ring = btn.querySelector(".qs-peek-ring");
  if (!ring) {
    ring = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    ring.setAttribute("class", "qs-peek-ring");
    ring.setAttribute("viewBox", "0 0 40 40");
    ring.setAttribute("aria-hidden", "true");
    ring.innerHTML = '<circle cx="20" cy="20" r="18" pathLength="100"/>';
    btn.appendChild(ring);
  }
  return ring;
}

function startHold(btn) {
  cancelHold(btn);
  s.anchor = btn;
  s.ringTimer = setTimeout(() => {
    const ring = ringOf(btn);
    ring.style.setProperty("--qs-peek-ms", `${HOLD_MS - RING_DELAY_MS}ms`);
    btn.classList.remove("qs-peek-arming");
    void btn.offsetWidth;
    btn.classList.add("qs-peek-arming");
  }, RING_DELAY_MS);
  s.holdTimer = setTimeout(() => {
    btn.classList.remove("qs-peek-arming");
    openPeek(btn);
  }, HOLD_MS);
}

function cancelHold(btn) {
  clearTimeout(s.holdTimer);
  clearTimeout(s.ringTimer);
  s.holdTimer = 0;
  s.ringTimer = 0;
  btn?.classList.remove("qs-peek-arming");
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

export async function openPeek(anchor = s.anchor) {
  if (s.open && !s.closing) return;
  const U = ui();
  if (!U?.makeShadowOverlay) return;
  if (document.getElementById("swiftselect-annotate-root")) return;

  clearTimeout(s.closeTimer);
  teardown(true);
  s.generation++;
  const gen = s.generation;
  s.open = true;
  s.closing = false;
  s.detached = false;
  s.anchor = anchor || null;

  const r = anchor?.getBoundingClientRect?.();
  s.edge = r && r.top + r.height / 2 > window.innerHeight * 0.55 ? "top" : "bottom";

  // The Gallery tooltip and the tray never share the screen.
  U.hideCustomTooltip?.();
  U.setTooltipGuard?.((btn) => !(s.open && btn === s.anchor));

  const { host, el: tray, shadow } = U.makeShadowOverlay("div", "qs-peek");
  host.id = "qs-peek-host";
  s.host = host;
  s.shadow = shadow;
  s.tray = tray;
  tray.dataset.edge = s.edge;
  tray.setAttribute("role", "dialog");
  tray.setAttribute("aria-label", "Recent captures");
  // Same tone as the toolbar it came from, so the two read as one surface.
  const guide = anchor?.closest?.(".qs-guide");
  if (guide?.classList.contains("qs-theme-glass")) {
    tray.classList.add("qs-theme-glass");
    tray.classList.toggle("qs-theme-glass-dark", guide.classList.contains("qs-theme-glass-dark"));
  } else {
    applyElementTheme(tray, currentUserTheme);
  }

  const head = el("div", "qs-peek-head");
  const glyph = el("span", "qs-peek-glyph", SVG.gallery);
  const heading = el("div", "qs-peek-heading");
  const h = el("b");
  h.textContent = "Recent captures";
  const sub = el("span", "qs-peek-sub");
  sub.textContent = "Drag one into the page, or click to copy";
  heading.append(h, sub);
  const openBtn = el("button", "qs-peek-open", `${SVG.external}<span>Open Gallery</span>`);
  openBtn.type = "button";
  openBtn.addEventListener("click", () => {
    closePeek();
    U.openGallery?.();
  });
  const closeBtn = el("button", "qs-peek-close", SVG.close);
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.addEventListener("click", () => closePeek());
  head.append(glyph, heading, openBtn, closeBtn);

  const strip = el("div", "qs-peek-strip");
  strip.setAttribute("role", "list");
  s.strip = strip;
  for (let i = 0; i < 5; i++) strip.appendChild(el("div", "qs-peek-skeleton"));

  tray.append(head, strip);
  wireTray(tray, strip);

  // Slide in on the next frame so the start position is painted first.
  requestAnimationFrame(() => requestAnimationFrame(() => s.tray === tray && tray.classList.add("is-in")));

  const resp = await send({ type: "gallery-peek", limit: LIMIT });
  if (gen !== s.generation) return;
  renderItems(resp);
  if (resp?.success && resp.items?.length) prefetch(gen);
}

function renderItems(resp) {
  const strip = s.strip;
  if (!strip) return;
  strip.replaceChildren();
  s.items = resp?.success ? resp.items || [] : [];

  if (!resp?.success || !s.items.length) {
    s.tray.classList.add("is-empty");
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
      p.textContent = "Turn on “Keep captures in the Gallery” in Settings and every capture will wait here.";
    } else {
      t.textContent = "No captures yet";
      p.textContent = "Take one with the capture toolbar. It will wait here, ready to drag into any page.";
    }
    text.append(t, p);
    empty.append(art, text);
    if (resp?.success && resp.enabled === false) {
      const go = el("button", "qs-peek-cta", "Open Settings");
      go.type = "button";
      go.addEventListener("click", () => {
        closePeek();
        ui()?.showSettingsModal?.();
      });
      empty.appendChild(go);
    }
    strip.appendChild(empty);
    s.tray.querySelector(".qs-peek-sub").textContent = resp?.success ? "Your gallery is empty" : "Something went wrong";
    return;
  }

  s.tray.classList.remove("is-empty");
  s.items.forEach((item, i) => strip.appendChild(buildCard(item, i)));
  if (resp.more) {
    const more = el("button", "qs-peek-more", `<span class="qs-peek-more-ic">${SVG.arrow}</span><b>See all</b><span>in the Gallery</span>`);
    more.type = "button";
    more.style.setProperty("--i", String(s.items.length));
    more.addEventListener("click", () => {
      closePeek();
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
  acts.append(iconBtn("copy", "Copy", SVG.copy), iconBtn("download", "Download", SVG.download), iconBtn("annotate", "Annotate", SVG.annotate));
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
  s.tray?.classList.add("is-detached");
  const sub = s.tray?.querySelector(".qs-peek-sub");
  if (sub) sub.textContent = "Paste it, or drag another one in · Esc closes";
  setTimeout(() => {
    window.SwiftSelect?.events?.cleanup?.();
    ui()?.cleanup?.();
    ui()?.setTooltipGuard?.(null);
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
      tray.classList.add("is-dragging");
      card.classList.add("is-dragged");
      detach();
    }, 0);
  });

  strip.addEventListener("dragend", (e) => {
    const { card } = itemFor(e.target);
    s.dragging = false;
    s.dragFile = null;
    document.removeEventListener("drop", relayDrop, true);
    tray.classList.remove("is-dragging");
    card?.classList.remove("is-dragged");
    if (card && e.dataTransfer?.dropEffect && e.dataTransfer.dropEffect !== "none") flash(card, "Dropped", "ok");
  });

  s.onKey = (e) => {
    if (e.key !== "Escape" || !s.open) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    closePeek();
  };
  window.addEventListener("keydown", s.onKey, true);

  // A press anywhere else puts the tray away (selection starts, or the
  // person clicks into the page to paste).
  s.onOutside = (e) => {
    if (!s.open || s.dragging) return;
    const path = e.composedPath?.() || [];
    if (path.includes(s.host) || (s.anchor && path.includes(s.anchor))) return;
    closePeek();
  };
  window.addEventListener("pointerdown", s.onOutside, true);
}

export function closePeek({ immediate = false } = {}) {
  if (!s.open || s.closing) return;
  s.closing = true;
  cancelHold(s.anchor);
  ui()?.setTooltipGuard?.(null);
  const tray = s.tray;
  if (!tray || immediate) return teardown();
  tray.classList.remove("is-in");
  tray.classList.add("is-out");
  clearTimeout(s.closeTimer);
  s.closeTimer = setTimeout(() => teardown(), 240);
}

function teardown(silent = false) {
  if (s.onKey) window.removeEventListener("keydown", s.onKey, true);
  if (s.onOutside) window.removeEventListener("pointerdown", s.onOutside, true);
  s.onKey = null;
  s.onOutside = null;
  s.host?.remove();
  s.host = null;
  s.shadow = null;
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
