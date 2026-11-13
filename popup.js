/**
 * Toolbar popup.
 *
 * Normally a quick-action menu. On pages Chrome will not let extensions
 * capture, it becomes a clear notice with a way out: capture the last
 * normal tab in this window instead. The popup never captures anything
 * itself; it asks the service worker and closes, so it cannot end up in
 * the screenshot.
 */
import { getSettings } from "./src/settings.js";
import { listCaptures } from "./src/storage.js";
import { icon, hydrateIcons, enableSheen, formatNumber, send } from "./src/pageKit.js";

const $ = (id) => document.getElementById(id);

function isRestrictedUrl(url) {
  if (!url) return true;
  return (
    /^(chrome|edge|about|chrome-extension|view-source|devtools):/i.test(url) ||
    url.startsWith("https://chrome.google.com/webstore") ||
    url.startsWith("https://chromewebstore.google.com")
  );
}

function pageName(url) {
  if (!url) return "This page";
  if (url.startsWith("chrome-extension://")) return "An extension page";
  if (/chromewebstore\.google\.com|chrome\.google\.com\/webstore/.test(url)) return "The Chrome Web Store";
  const m = /^(chrome|edge|about|devtools|view-source):\/*([^/?#]*)/i.exec(url);
  return m ? `${m[1]}://${m[2]}` : "This page";
}

/** Last normal tab in this window, remembered by the service worker. */
async function lastCapturableTab(windowId) {
  try {
    const stored = (await chrome.storage.session.get([`lastTab:${windowId}`, "lastTab"])) || {};
    for (const id of [stored[`lastTab:${windowId}`], stored.lastTab]) {
      if (typeof id !== "number") continue;
      const tab = await chrome.tabs.get(id).catch(() => null);
      if (tab && !isRestrictedUrl(tab.url || "")) return tab;
    }
  } catch {}
  return null;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url || "";
  }
}

async function showNotice({ glyph, title, sub, body, actions }) {
  $("notice-glyph").innerHTML = icon(glyph);
  $("notice-title").textContent = title;
  $("notice-sub").textContent = sub;
  $("notice-body").textContent = body;
  $("notice-actions").replaceChildren(...actions);
  $("notice").hidden = false;
  $("actions").hidden = true;
}

function cta({ iconName, title, detail, onClick }) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "notice-cta";
  b.innerHTML = `${icon(iconName)}<span><b></b><small></small></span>${icon("arrow")}`;
  b.querySelector("b").textContent = title;
  b.querySelector("small").textContent = detail;
  b.onclick = onClick;
  return b;
}

function link(text, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "notice-link";
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function keysToHtml(shortcut) {
  return shortcut
    .split("+")
    .map((k) => `<kbd class="kbd">${k.trim().replace(/[<>&]/g, "")}</kbd>`)
    .join("");
}

async function toPng(blob) {
  if (blob.type === "image/png") return blob;
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((r) => c.toBlob(r, "image/png"));
}

async function renderRecent() {
  let records = [];
  try {
    records = (await listCaptures()).filter((r) => !r.deletedAt);
  } catch {}
  if (records.length) {
    $("gallery-count").textContent = formatNumber(records.length);
    $("gallery-count").hidden = false;
  }
  const latest = records.slice(0, 3);
  if (!latest.length) return;

  const gridEl = $("recent-grid");
  latest.forEach((r) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "recent-item";
    b.title = r.title || "Capture";
    const img = document.createElement("img");
    img.alt = "";
    img.src = URL.createObjectURL(r.thumb || r.blob);
    const overlay = document.createElement("i");
    overlay.innerHTML = icon("copy");
    b.append(img, overlay);
    b.onclick = async () => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": toPng(r.blob) })]);
        overlay.innerHTML = icon("check");
        b.classList.add("is-copied");
        setTimeout(() => {
          overlay.innerHTML = icon("copy");
          b.classList.remove("is-copied");
        }, 1300);
      } catch {
        b.title = "Clipboard unavailable";
      }
    };
    gridEl.appendChild(b);
  });
  $("recent").hidden = false;
}

async function init() {
  hydrateIcons();

  // Lets the worker restore the per-tab action state when the popup closes.
  try {
    chrome.runtime.connect({ name: "popup-lifecycle" });
  } catch {}

  const view = new URLSearchParams(location.search).get("view");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || "";

  const goGallery = async () => {
    await send({ type: "open-gallery" });
    window.close();
  };

  if (view === "file-access" || (url.startsWith("file://") && !(await chrome.extension.isAllowedFileSchemeAccess()))) {
    showNotice({
      glyph: "lock",
      title: "File access is off",
      sub: "Local files need one permission",
      body: "Turn on “Allow access to file URLs” for SwiftSelect, then reload this file to capture it.",
      actions: [
        cta({
          iconName: "settings",
          title: "Allow file access",
          detail: "Opens SwiftSelect's extension details",
          onClick: () => {
            chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
            window.close();
          },
        }),
      ],
    });
  } else if (view === "restricted" || isRestrictedUrl(url)) {
    const target = await lastCapturableTab(tab?.windowId);
    const actions = [];
    if (target) {
      actions.push(
        cta({
          iconName: "tab",
          title: "Capture your last tab",
          detail: `${target.title || hostOf(target.url)} · ${hostOf(target.url)}`,
          onClick: async () => {
            await send({ type: "run-capture", mode: "region", tabId: target.id });
            window.close();
          },
        }),
      );
    }
    actions.push(link("Open Gallery instead", goGallery));
    showNotice({
      glyph: "lock",
      title: "Can't capture this page",
      sub: pageName(url),
      body: "Chrome protects its own pages and the Web Store from every extension. Switch to a normal web page and SwiftSelect works as usual.",
      actions,
    });
  }

  // Live key bindings, exactly as Chrome has them.
  try {
    const commands = await chrome.commands.getAll();
    for (const cmd of commands) {
      const row = document.querySelector(`.action[data-command="${cmd.name}"] .action-keys`);
      if (row && cmd.shortcut) row.innerHTML = keysToHtml(cmd.shortcut);
    }
  } catch {}

  getSettings().then((s) => {
    $("timer-label").textContent = `Delayed Capture (${s.captureDelay || 3}s)`;
  });

  renderRecent();

  document.querySelectorAll(".action").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await send({ type: "run-capture", mode: btn.dataset.mode, tabId: tab?.id });
      window.close();
    });
  });

  $("open-settings").addEventListener("click", async () => {
    await send({ type: "open-settings" });
    window.close();
  });
  $("open-gallery").addEventListener("click", goGallery);
  $("open-convert").addEventListener("click", async () => {
    await send({ type: "open-convert" });
    window.close();
  });
  $("recent-all").addEventListener("click", goGallery);

  // Arrow keys move between actions (no single-key shortcuts here).
  const actionEls = [...document.querySelectorAll(".action")];
  document.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if ($("actions").hidden) return;
    e.preventDefault();
    const i = actionEls.indexOf(document.activeElement);
    const next = e.key === "ArrowDown" ? (i + 1) % actionEls.length : (i - 1 + actionEls.length) % actionEls.length;
    actionEls[next].focus();
  });
}

init();
