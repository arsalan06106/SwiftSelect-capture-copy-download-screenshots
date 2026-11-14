/**
 * Settings controller, mounted by the Gallery's Settings view. Every control writes straight to
 * chrome.storage.local; the page re-renders from storage.onChanged, so it
 * stays correct when a setting is changed from the context menu or a
 * second Settings tab.
 */
import {
  DEFAULTS,
  getSettings,
  setSettings,
  buildFilename,
  formatInfo,
  wantsCopy,
  wantsDownload,
  destinationFromToggles,
} from "./src/settings.js";
import { getStats, formatBytes, onGalleryChange, emptyTrash } from "./src/storage.js";
import { hydrateIcons, mountPill, enableSheen, setLocale, formatNumber, send, confirmDialog, toast } from "./src/pageKit.js";

const $ = (id) => document.getElementById(id);
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

let settings = { ...DEFAULTS };
const pillSyncs = [];

// ─── Save feedback ───────────────────────────────────────────────────

let syncTimer = 0;

async function save(patch) {
  const sync = $("sync");
  clearTimeout(syncTimer);
  sync.classList.remove("is-saved", "is-error");
  sync.classList.add("is-saving");
  $("sync-text").textContent = "Saving…";
  const ok = await setSettings(patch);
  sync.classList.remove("is-saving");
  void sync.offsetWidth; // restart the pop
  sync.classList.add(ok ? "is-saved" : "is-error");
  $("sync-text").textContent = ok ? "Saved just now" : "Could not save";
  syncTimer = setTimeout(() => {
    sync.classList.remove("is-saved");
    if (ok) $("sync-text").textContent = "All changes saved";
  }, 2400);
}

/** The header sticks to the top; give it a solid glass bar once it is stuck. */
function watchStickyHead() {
  const sentinel = $("head-sentinel");
  const head = $("settings-head");
  if (!sentinel || !head || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(([entry]) => head.classList.toggle("is-stuck", !entry.isIntersecting), {
    rootMargin: "-12px 0px 0px 0px",
  }).observe(sentinel);
}

// ─── Rendering from state ────────────────────────────────────────────

function renderSegments() {
  document.querySelectorAll("#settings-view .seg[data-key]").forEach((seg) => {
    const value = String(settings[seg.dataset.key]);
    seg.querySelectorAll("button").forEach((btn) => {
      const on = btn.dataset.value === value;
      btn.setAttribute("aria-checked", String(on));
      btn.tabIndex = on ? 0 : -1;
    });
  });
  pillSyncs.forEach((sync) => sync());
}

function renderSelect() {
  const root = $("language");
  const value = settings.uiLanguage;
  document.querySelectorAll(".select-option").forEach((opt) => {
    const on = opt.dataset.value === value;
    opt.setAttribute("aria-selected", String(on));
    if (on) $("language-value").textContent = opt.textContent.trim();
  });
}

function renderQuality() {
  const lossless = settings.outputFormat === "png";
  const input = $("quality");
  input.disabled = lossless;
  input.value = String(settings.outputQuality);
  $("quality-value").textContent = lossless ? "1.00" : settings.outputQuality.toFixed(2);
  input.style.setProperty("--fill-pct", `${((settings.outputQuality - 0.5) / 0.5) * 100}%`);
  $("quality-wrap").classList.toggle("is-off", lossless);
  $("quality-note").textContent = lossless
    ? "PNG is lossless, so quality does not apply."
    : "Higher is sharper and larger.";
}

function renderToggles() {
  $("auto-copy").setAttribute("aria-checked", String(wantsCopy(settings.outputDestination)));
  $("auto-download").setAttribute("aria-checked", String(wantsDownload(settings.outputDestination)));
  $("save-gallery").setAttribute("aria-checked", String(settings.saveToGallery));
  document.querySelectorAll(".switch[data-bool]").forEach((sw) => {
    sw.setAttribute("aria-checked", String(!!settings[sw.dataset.bool]));
  });
  document.querySelectorAll(".shortcut-block[data-block]").forEach((block) => {
    block.classList.toggle("is-off", !settings[block.dataset.block]);
  });
}

function renderTemplatePreview() {
  const template = $("template").value.trim() || DEFAULTS.filenameTemplate;
  $("template-preview").textContent = buildFilename(template, {
    title: "Quarterly report",
    url: "https://www.example.com/reports/q3",
    type: "fullpage",
    ext: formatInfo(settings.outputFormat).ext,
  });
}

function render() {
  setLocale(settings.uiLanguage);
  renderSegments();
  renderSelect();
  renderQuality();
  renderToggles();
  if (document.activeElement !== $("template")) $("template").value = settings.filenameTemplate;
  renderTemplatePreview();
}

// ─── Shortcuts table ─────────────────────────────────────────────────

function keysToHtml(shortcut) {
  return shortcut
    .split("+")
    .map((k) => `<kbd class="kbd">${k.trim().replace(/[<>&]/g, "")}</kbd>`)
    .join("");
}

async function renderShortcuts() {
  const body = $("global-shortcuts");
  let commands = [];
  try {
    commands = await chrome.commands.getAll();
  } catch {}
  const labels = {
    "activate-selection": "Start region selection",
    "capture-visible-download": "Capture visible area",
    "capture-horizontal": "Capture horizontal view",
    "capture-full-page": "Capture full page",
    "capture-timer": "Delayed capture",
  };
  body.replaceChildren();
  for (const cmd of commands) {
    if (!labels[cmd.name]) continue;
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = labels[cmd.name];
    const keys = document.createElement("td");
    keys.innerHTML = cmd.shortcut ? keysToHtml(cmd.shortcut) : '<span class="unset">Not set</span>';
    tr.append(name, keys);
    body.appendChild(tr);
  }
  if (isMac) document.querySelectorAll("[data-mod]").forEach((el) => (el.textContent = "⌘"));
}

async function renderGallerySummary() {
  try {
    const { count, bytes, trashCount, trashBytes } = await getStats();
    const out = $("storage-summary");
    out.textContent = "";
    const b = (t) => {
      const el = document.createElement("b");
      el.textContent = t;
      return el;
    };
    out.append(
      b(formatNumber(count)),
      ` screenshot${count === 1 ? "" : "s"} · `,
      b(formatBytes(bytes + trashBytes)),
      " used",
    );
    if (trashCount) out.append(" · Trash holds ", b(formatNumber(trashCount)));
    $("empty-trash").hidden = !trashCount;
  } catch {}
}

// ─── Wiring ──────────────────────────────────────────────────────────

function wireSegments() {
  document.querySelectorAll("#settings-view .seg[data-key]").forEach((seg) => {
    pillSyncs.push(mountPill(seg, '[aria-checked="true"]'));
    const key = seg.dataset.key;
    const cast = (v) => (seg.dataset.type === "number" ? Number(v) : v);

    const choose = (btn) => {
      settings = { ...settings, [key]: cast(btn.dataset.value) };
      render();
      btn.focus();
      const patch = { [key]: cast(btn.dataset.value) };
      save(patch);
      if (key === "userTheme") {
        // Nudge tabs that already have the capture UI injected.
        chrome.tabs.query({}, (tabs) => {
          for (const t of tabs || []) {
            if (t.id) chrome.tabs.sendMessage(t.id, { type: "apply-theme", theme: patch.userTheme }).catch(() => {});
          }
        });
      }
    };

    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-value]");
      if (btn) choose(btn);
    });

    // Radio group keyboard model: arrows move and select.
    seg.addEventListener("keydown", (e) => {
      const buttons = [...seg.querySelectorAll("button[data-value]")];
      const i = buttons.indexOf(document.activeElement);
      if (i === -1) return;
      let next = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % buttons.length;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + buttons.length) % buttons.length;
      if (next !== -1) {
        e.preventDefault();
        choose(buttons[next]);
      }
    });
  });
}

function wireSelect() {
  const root = $("language");
  const trigger = root.querySelector(".select-trigger");
  const options = [...root.querySelectorAll(".select-option")];
  const menu = root.querySelector(".select-menu");

  // The menu is glass, and so is the card around it. A backdrop-filter inside
  // another one gets an empty backdrop, so the open menu moves to <body> and
  // is positioned against the trigger.
  menu.classList.add("is-floating");
  document.body.appendChild(menu);
  const place = () => {
    const r = trigger.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 8)}px`;
    menu.style.right = `${Math.round(document.documentElement.clientWidth - r.right)}px`;
    menu.style.minWidth = `${Math.round(r.width)}px`;
  };

  const setOpen = (open) => {
    root.classList.toggle("is-open", open);
    menu.classList.toggle("is-shown", open);
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      place();
      (options.find((o) => o.getAttribute("aria-selected") === "true") || options[0]).focus({ preventScroll: true });
    }
  };
  document.getElementById("settings-view")?.addEventListener("scroll", () => setOpen(false), { passive: true });
  window.addEventListener("resize", () => setOpen(false));

  trigger.addEventListener("click", () => setOpen(!root.classList.contains("is-open")));
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  });

  options.forEach((opt, i) => {
    opt.addEventListener("click", () => {
      settings = { ...settings, uiLanguage: opt.dataset.value };
      render();
      save({ uiLanguage: opt.dataset.value });
      setOpen(false);
      trigger.focus();
    });
    opt.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        options[(i + 1) % options.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        options[(i - 1 + options.length) % options.length].focus();
      } else if (e.key === "Escape" || e.key === "Tab") {
        setOpen(false);
        trigger.focus();
      }
    });
  });

  document.addEventListener("pointerdown", (e) => {
    if (!root.contains(e.target) && !menu.contains(e.target)) setOpen(false);
  });
}

function wireQuality() {
  const input = $("quality");
  let timer = 0;
  input.addEventListener("input", () => {
    settings = { ...settings, outputQuality: Number(input.value) };
    renderQuality();
    renderTemplatePreview();
    clearTimeout(timer);
    timer = setTimeout(() => save({ outputQuality: settings.outputQuality }), 160);
  });
}

function wireToggles() {
  const flip = (el) => el.getAttribute("aria-checked") !== "true";

  const saveDestination = () => {
    const destination = destinationFromToggles(
      $("auto-copy").getAttribute("aria-checked") === "true",
      $("auto-download").getAttribute("aria-checked") === "true",
    );
    settings = { ...settings, outputDestination: destination };
    save({ outputDestination: destination });
  };

  $("auto-copy").addEventListener("click", (e) => {
    e.currentTarget.setAttribute("aria-checked", String(flip(e.currentTarget)));
    saveDestination();
  });
  $("auto-download").addEventListener("click", (e) => {
    e.currentTarget.setAttribute("aria-checked", String(flip(e.currentTarget)));
    saveDestination();
  });
  document.querySelectorAll(".switch[data-bool]").forEach((sw) => {
    sw.addEventListener("click", () => {
      const key = sw.dataset.bool;
      const on = sw.getAttribute("aria-checked") !== "true";
      settings = { ...settings, [key]: on };
      renderToggles();
      save({ [key]: on });
    });
  });
  $("save-gallery").addEventListener("click", (e) => {
    const on = flip(e.currentTarget);
    e.currentTarget.setAttribute("aria-checked", String(on));
    settings = { ...settings, saveToGallery: on };
    save({ saveToGallery: on });
  });
}

function wireTemplate() {
  const input = $("template");
  let timer = 0;

  const commit = () => {
    const value = input.value.trim() || DEFAULTS.filenameTemplate;
    settings = { ...settings, filenameTemplate: value };
    save({ filenameTemplate: value });
  };

  input.addEventListener("input", () => {
    renderTemplatePreview();
    clearTimeout(timer);
    timer = setTimeout(commit, 350);
  });
  input.addEventListener("blur", () => {
    if (!input.value.trim()) {
      input.value = DEFAULTS.filenameTemplate;
      renderTemplatePreview();
      commit();
    }
  });

  $("template-chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.setRangeText(chip.dataset.tag, start, end, "end");
    input.focus();
    renderTemplatePreview();
    clearTimeout(timer);
    commit();
  });
}

let mounted = false;

/** Wire the Settings view once, the first time it is shown. */
export async function mountSettings() {
  if (mounted) {
    pillSyncs.forEach((sync) => sync());
    renderShortcuts();
    renderGallerySummary();
    return;
  }
  mounted = true;
  hydrateIcons();
  if ($("version")) $("version").textContent = `v${chrome.runtime.getManifest().version}`;

  settings = await getSettings();
  wireSegments();
  wireSelect();
  wireQuality();
  wireToggles();
  wireTemplate();
  render();
  renderShortcuts();
  renderGallerySummary();

  $("open-shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));
  $("empty-trash").addEventListener("click", async () => {
    const { trashCount } = await getStats();
    const ok = await confirmDialog({
      title: "Empty Trash?",
      body: `${formatNumber(trashCount)} capture${trashCount === 1 ? "" : "s"} will be deleted forever. This cannot be undone.`,
      confirm: "Empty Trash",
    });
    if (!ok) return;
    const n = await emptyTrash();
    renderGallerySummary();
    toast(`${formatNumber(n)} deleted forever`);
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    settings = await getSettings();
    render();
  });
  onGalleryChange(renderGallerySummary);
  // Shortcuts may have been edited on chrome://extensions/shortcuts.
  window.addEventListener("focus", renderShortcuts);
}
