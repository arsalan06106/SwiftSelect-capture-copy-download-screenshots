/**
 * Small shared toolkit for the extension pages: icons, the sliding liquid
 * pill, ripples, toasts, confirm dialogs and locale-aware formatting.
 * No framework, no dependencies.
 */

// Icons are drawn on a 24px grid. Parts that move on hover carry a `p-*`
// class; pages.css animates them when any interactive parent is hovered.
const ICONS = {
  all: '<path class="p-back" d="M3 8V6a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.5 6H19a2 2 0 0 1 2 2v1.5"/><path class="p-front" d="M3 10h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  favorites: '<path class="p-star" d="M12 3.6l2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.62l-5.1 2.68.97-5.68L3.75 9.6l5.7-.83z"/>',
  star: '<path class="p-star" d="M12 3.6l2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.62l-5.1 2.68.97-5.68L3.75 9.6l5.7-.83z"/>',
  recent: '<circle cx="12" cy="12" r="8.5"/><path class="p-hand" d="M12 7.5V12l3 2"/>',
  earlier: '<rect class="p-lid" x="3" y="4" width="18" height="4.5" rx="1.5"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5"/><path class="p-slot" d="M10 12.5h4"/>',
  region: '<path class="p-c1" d="M4 9V6a2 2 0 0 1 2-2h3"/><path class="p-c2" d="M15 4h3a2 2 0 0 1 2 2v3"/><path class="p-c3" d="M20 15v3a2 2 0 0 1-2 2h-3"/><path class="p-c4" d="M9 20H6a2 2 0 0 1-2-2v-3"/><circle class="p-dot" cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/>',
  fit: '<path class="p-c1" d="M4 9V6a2 2 0 0 1 2-2h3"/><path class="p-c2" d="M15 4h3a2 2 0 0 1 2 2v3"/><path class="p-c3" d="M20 15v3a2 2 0 0 1-2 2h-3"/><path class="p-c4" d="M9 20H6a2 2 0 0 1-2-2v-3"/>',
  visible: '<rect x="3" y="4.5" width="18" height="13" rx="2.5"/><path d="M9 21h6M12 17.5V21"/><path class="p-scan" d="M6.5 8h11"/>',
  fullpage: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path class="p-up" d="M9.5 9.5 12 7l2.5 2.5"/><path class="p-down" d="M9.5 14.5 12 17l2.5-2.5"/><path class="p-mid" d="M12 8v8"/>',
  horizontal: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path class="p-left" d="M9.5 9.5 7 12l2.5 2.5"/><path class="p-right" d="M14.5 9.5 17 12l-2.5 2.5"/><path class="p-mid" d="M8 12h8"/>',
  annotated: '<path class="p-line" d="M12.5 20H21"/><path class="p-pen" d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path class="p-hand" d="M12 9.5v4l2.5 1.5"/><path class="p-knob" d="M9.5 2.5h5"/>',
  search: '<g class="p-mag"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></g>',
  grid: '<rect class="p-q1" x="4" y="4" width="6.5" height="6.5" rx="1.75"/><rect class="p-q2" x="13.5" y="4" width="6.5" height="6.5" rx="1.75"/><rect class="p-q3" x="4" y="13.5" width="6.5" height="6.5" rx="1.75"/><rect class="p-q4" x="13.5" y="13.5" width="6.5" height="6.5" rx="1.75"/>',
  list: '<g class="p-l1"><circle cx="4.5" cy="6" r="1"/><path d="M9 6h11"/></g><g class="p-l2"><circle cx="4.5" cy="12" r="1"/><path d="M9 12h11"/></g><g class="p-l3"><circle cx="4.5" cy="18" r="1"/><path d="M9 18h11"/></g>',
  settings: '<g class="p-gear"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></g>',
  copy: '<path class="p-back" d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/><rect class="p-front" x="8.5" y="8.5" width="12" height="12" rx="2.5"/>',
  download: '<path class="p-arrow" d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path class="p-base" d="M5 19.5h14"/>',
  trash: '<g class="p-lid"><path d="M4 7h16"/><path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2"/></g><path class="p-bin" d="M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7"/><path class="p-bin" d="M10 11v5M14 11v5"/>',
  restore: '<g class="p-spin"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/></g>',
  check: '<path class="p-check" d="m5 12.5 4.5 4.5L19 7.5"/>',
  select: '<circle cx="12" cy="12" r="8.5"/><path class="p-check" d="m8.25 12.25 2.6 2.6 4.9-5.35"/>',
  close: '<g class="p-x"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></g>',
  chevron: '<path class="p-chev" d="m6 9 6 6 6-6"/>',
  prev: '<path class="p-chev" d="m15 6-6 6 6 6"/>',
  next: '<path class="p-chev" d="m9 6 6 6-6 6"/>',
  arrow: '<g class="p-arr"><path d="M5 12h14M13 6l6 6-6 6"/></g>',
  external: '<path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/><g class="p-arr"><path d="M14 4h6v6M20 4l-9 9"/></g>',
  gallery: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle class="p-sun" cx="8.5" cy="9.5" r="1.6"/><path class="p-hills" d="m4 17 5-4.5 3.5 3L16 12l4.5 4.5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path class="p-k1" d="M6.5 10h.01"/><path class="p-k2" d="M10 10h.01"/><path class="p-k3" d="M13.5 10h.01"/><path class="p-k4" d="M17 10h.01"/><path class="p-space" d="M7.5 14h9"/>',
  system: '<rect x="3" y="4.5" width="18" height="12" rx="2.5"/><path d="M8.5 20.5h7M12 16.5v4"/><path class="p-half" d="M12 4.5v12" />',
  sun: '<circle class="p-core" cx="12" cy="12" r="3.75"/><g class="p-rays"><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></g>',
  moon: '<path class="p-moon" d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"/><path class="p-twinkle" d="M17.5 3.5v3M16 5h3"/>',
  warn: '<g class="p-shake"><path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.25h.01"/></g>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path class="p-shackle" d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path class="p-keyhole" d="M12 14.5v2"/>',
  tab: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9h18"/><g class="p-arr"><path d="M9.5 14h5M12.5 12l2 2-2 2"/></g>',
  drag: '<g class="p-hand"><path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10V5a1.5 1.5 0 0 1 3 0v5"/><path d="M14 10.5V7a1.5 1.5 0 0 1 3 0v6.5a6.5 6.5 0 0 1-6.5 6.5h-.6a5.5 5.5 0 0 1-4.4-2.2L4.2 15a1.6 1.6 0 0 1 2.5-2L8 14.5"/></g>',
  info: '<circle cx="12" cy="12" r="8.5"/><path class="p-dot" d="M12 11v5M12 8h.01"/>',
  convert: '<path class="p-right" d="M4 8h13M13.5 4.5 17 8l-3.5 3.5"/><path class="p-left" d="M20 16H7M10.5 12.5 7 16l3.5 3.5"/>',
  "size-s": '<g class="p-q1"><rect x="3.5" y="3.5" width="4.5" height="4.5" rx="1.2"/><rect x="9.75" y="3.5" width="4.5" height="4.5" rx="1.2"/><rect x="16" y="3.5" width="4.5" height="4.5" rx="1.2"/></g><g class="p-q2"><rect x="3.5" y="9.75" width="4.5" height="4.5" rx="1.2"/><rect x="9.75" y="9.75" width="4.5" height="4.5" rx="1.2"/><rect x="16" y="9.75" width="4.5" height="4.5" rx="1.2"/></g><g class="p-q3"><rect x="3.5" y="16" width="4.5" height="4.5" rx="1.2"/><rect x="9.75" y="16" width="4.5" height="4.5" rx="1.2"/><rect x="16" y="16" width="4.5" height="4.5" rx="1.2"/></g>',
  "size-m": '<rect class="p-q1" x="4" y="4" width="6.5" height="6.5" rx="1.75"/><rect class="p-q2" x="13.5" y="4" width="6.5" height="6.5" rx="1.75"/><rect class="p-q3" x="4" y="13.5" width="6.5" height="6.5" rx="1.75"/><rect class="p-q4" x="13.5" y="13.5" width="6.5" height="6.5" rx="1.75"/>',
  "size-l": '<rect class="p-q1" x="4" y="4" width="16" height="16" rx="3.5"/>',
  bell: '<g class="p-bell"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></g>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.25h.01"/>',
  zip: '<path d="M6 3.5h8l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 2-1.5z"/><path class="p-arrow" d="M10 3.5v2h2v2h-2v2h2v2h-2"/><rect x="9" y="13.5" width="4" height="4" rx="1"/>',
  invert: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path class="p-half" d="M12 3.5v17"/><path d="M12 3.5h4.5a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4H12z" fill="currentColor" stroke="none" opacity=".35"/>',
  plus: '<g class="p-x"><path d="M12 5.5v13M5.5 12h13"/></g>',
  sparkle: '<path class="p-star" d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z"/>',
};

export function icon(name, className = "icon") {
  return `<svg class="${className} icon-${name}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

/** Fill every <i data-icon="name"> placeholder in a subtree. */
export function hydrateIcons(root = document) {
  root.querySelectorAll("i[data-icon]").forEach((el) => {
    el.outerHTML = icon(el.dataset.icon, el.className || "icon");
  });
}

/**
 * Give a container a pill that glides to its active child.
 * Returns a function to call after the active child changes.
 */
export function mountPill(container, activeSelector) {
  const pill = document.createElement("span");
  pill.className = "liquid-pill";
  pill.setAttribute("aria-hidden", "true");
  container.prepend(pill);

  const sync = () => {
    const active = container.querySelector(activeSelector);
    if (!active || !active.offsetWidth) {
      pill.style.opacity = "0";
      return;
    }
    pill.style.opacity = "";
    // Sub-pixel geometry, measured against the container and divided by its
    // on-screen scale, so the pill is exact even while a parent is mid
    // entrance animation (offset* would round to whole pixels).
    const c = container.getBoundingClientRect();
    const r = active.getBoundingClientRect();
    const k = container.offsetWidth ? c.width / container.offsetWidth : 1;
    const x = (r.left - c.left) / k - container.clientLeft;
    const y = (r.top - c.top) / k - container.clientTop;
    pill.style.setProperty("--pill-x", `${x.toFixed(2)}px`);
    pill.style.setProperty("--pill-y", `${y.toFixed(2)}px`);
    pill.style.setProperty("--pill-w", `${(r.width / k).toFixed(2)}px`);
    pill.style.setProperty("--pill-h", `${(r.height / k).toFixed(2)}px`);
    // First placement must not animate from the corner.
    if (!pill.classList.contains("is-ready")) {
      requestAnimationFrame(() => requestAnimationFrame(() => pill.classList.add("is-ready")));
    }
  };

  sync();
  new ResizeObserver(sync).observe(container);
  document.fonts?.ready?.then(sync);
  return sync;
}

const SHEEN_HOSTS = ".btn, .act, .nav-item, .action, .link-row, .select-trigger, .chip, .notice-cta, .tool-link, [data-sheen]";

/**
 * Pointer-tracked specular light on glass controls. A delegated listener
 * writes --mx / --my on the control under the pointer; pages.css paints a
 * soft highlight there. Nothing is created or destroyed per frame.
 */
export function enableSheen(root = document) {
  root.addEventListener(
    "pointermove",
    (e) => {
      const host = e.target.closest?.(SHEEN_HOSTS);
      if (!host) return;
      const r = host.getBoundingClientRect();
      host.style.setProperty("--mx", `${Math.round(e.clientX - r.left)}px`);
      host.style.setProperty("--my", `${Math.round(e.clientY - r.top)}px`);
    },
    { passive: true },
  );
}

/** Kept for callers written against 2.0. */
export const enableRipples = enableSheen;

let _rail = null;

/** toast("Copied") or toast("Deleted", { action: "Undo", onAction, error }). */
export function toast(message, { action = "", onAction = null, error = false, duration = 2600 } = {}) {
  if (!_rail) {
    _rail = document.createElement("div");
    _rail.className = "toast-rail";
    _rail.setAttribute("role", "status");
    _rail.setAttribute("aria-live", "polite");
    document.body.appendChild(_rail);
  }
  while (_rail.children.length >= 3) _rail.firstChild.remove();

  // The icon and its colour say what happened, not just that something did.
  const kind = error
    ? ["warn", "#ff7a7a", "#e5323b"]
    : /forever|purg/i.test(message)
      ? ["trash", "#ff7a7a", "#e5323b"]
      : /trash/i.test(message)
        ? ["trash", "#a3abbd", "#5d6679"]
        : /favou?rite/i.test(message)
          ? ["star", "#ffc548", "#ff8619"]
          : /restor/i.test(message)
            ? ["restore", "#5b9bff", "#2453f0"]
            : /download|saved/i.test(message)
              ? ["download", "#5b9bff", "#2453f0"]
              : /renam/i.test(message)
                ? ["annotated", "#b18aff", "#6a45f0"]
                : ["check", "#4cd98a", "#11a65a"];
  const el = document.createElement("div");
  el.className = `toast glass glass-dense${error ? " is-error" : ""}`;
  el.style.setProperty("--tone-a", kind[1]);
  el.style.setProperty("--tone-b", kind[2]);
  el.innerHTML = icon(kind[0]);
  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);

  const dismiss = () => {
    if (el.classList.contains("is-leaving")) return;
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  };

  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action;
    btn.onclick = () => {
      onAction?.();
      dismiss();
    };
    el.appendChild(btn);
  }

  _rail.appendChild(el);
  setTimeout(dismiss, action ? Math.max(duration, 5200) : duration);
  return dismiss;
}

/** Liquid glass confirmation dialog. Resolves true when confirmed. */
export function confirmDialog({ title, body, confirm = "Confirm", cancel = "Cancel", glyph = "trash", tone = "danger" }) {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "modal-root";
    root.innerHTML = `
      <div class="modal glass glass-dense" role="alertdialog" aria-modal="true" aria-labelledby="ss-modal-title" aria-describedby="ss-modal-body">
        <div class="modal-glyph${tone === "danger" ? "" : " is-neutral"}">${icon(glyph)}</div>
        <h2 id="ss-modal-title"></h2>
        <p id="ss-modal-body"></p>
        <div class="modal-actions">
          <button type="button" class="btn" data-role="cancel"></button>
          <button type="button" class="btn ${tone === "danger" ? "btn-danger-solid" : "btn-primary"}" data-role="confirm"></button>
        </div>
      </div>`;
    root.querySelector("h2").textContent = title;
    root.querySelector("p").textContent = body;
    const cancelBtn = root.querySelector('[data-role="cancel"]');
    const confirmBtn = root.querySelector('[data-role="confirm"]');
    cancelBtn.textContent = cancel;
    confirmBtn.textContent = confirm;

    const previous = document.activeElement;
    const close = (value) => {
      root.classList.remove("is-open");
      document.removeEventListener("keydown", onKey, true);
      setTimeout(() => root.remove(), 280);
      previous?.focus?.();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (e.key === "Tab") {
        // Two buttons: keep focus inside the dialog.
        e.preventDefault();
        (document.activeElement === confirmBtn ? cancelBtn : confirmBtn).focus();
      }
    };

    cancelBtn.onclick = () => close(false);
    confirmBtn.onclick = () => close(true);
    root.addEventListener("pointerdown", (e) => {
      if (e.target === root) close(false);
    });
    document.addEventListener("keydown", onKey, true);

    document.body.appendChild(root);
    requestAnimationFrame(() => {
      root.classList.add("is-open");
      cancelBtn.focus();
    });
  });
}

// ─── Locale ──────────────────────────────────────────────────────────

let _locale = undefined; // undefined lets Intl follow the browser

export function setLocale(uiLanguage) {
  _locale = uiLanguage && uiLanguage !== "auto" ? uiLanguage : undefined;
  document.documentElement.lang = _locale || navigator.language || "en";
}

export function formatNumber(n) {
  return new Intl.NumberFormat(_locale).format(n);
}

export function formatDateTime(ts) {
  return new Intl.DateTimeFormat(_locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ts));
}

/** "just now", "12 min ago", "Yesterday", then a short date. */
export function formatRelative(ts, now = Date.now()) {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Just now";
  const rtf = new Intl.RelativeTimeFormat(_locale, { numeric: "auto", style: "short" });
  if (min < 60) return rtf.format(-min, "minute");
  const hours = Math.floor(min / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return rtf.format(-days, "day");
  return new Intl.DateTimeFormat(_locale, { month: "short", day: "numeric", year: "numeric" }).format(new Date(ts));
}

export function send(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) return resolve({ success: false, error: chrome.runtime.lastError.message });
        resolve(resp || { success: true });
      });
    } catch (err) {
      resolve({ success: false, error: err?.message });
    }
  });
}
