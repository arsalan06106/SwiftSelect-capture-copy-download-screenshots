/**
 * Theme management for SwiftSelect
 */

export let currentUserTheme = "glass";

export function init() {
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["userTheme", "glassThemeMigrated"], (data) => {
      if (!data.glassThemeMigrated) {
        currentUserTheme = "glass";
        applyTheme("glass");
        chrome.storage.local.set({
          userTheme: "glass",
          glassThemeMigrated: true,
        });
      } else if (data.userTheme) {
        if (data.userTheme === "light" || data.userTheme === "dark") {
          currentUserTheme = "standard";
        } else {
          currentUserTheme = data.userTheme;
        }
        applyTheme(currentUserTheme);
      } else {
        applyTheme(currentUserTheme);
      }
    });
  }

  if (window.matchMedia) {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => {
        applyTheme(currentUserTheme);
      });
  }

  let themeUpdatePending = false;
  const observer = new MutationObserver(() => {
    if (themeUpdatePending) return;
    themeUpdatePending = true;
    requestAnimationFrame(() => {
      applyTheme(currentUserTheme);
      themeUpdatePending = false;
    });
  });

  const config = {
    attributes: true,
    attributeFilter: [
      "class",
      "style",
      "data-theme",
      "data-mode",
      "data-color-mode",
      "data-color-scheme",
    ],
  };

  observer.observe(document.documentElement, config);
  observer.observe(document.body, config);

  let scrollPending = false;
  const onScrollOrResize = () => {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => {
      const ui = window.SwiftSelect?.ui;
      if (
        (ui?.guideHost && ui.guideHost.style.display !== "none") ||
        (ui?.statusHost && ui.statusHost.style.display !== "none")
      ) {
        applyTheme(currentUserTheme);
      }
      scrollPending = false;
    });
  };

  window.addEventListener("scroll", onScrollOrResize, { passive: true });
  window.addEventListener("resize", onScrollOrResize, { passive: true });
}

export function handleThemeToggle() {
  if (currentUserTheme === "glass") {
    currentUserTheme = "standard";
  } else {
    currentUserTheme = "glass";
  }
  applyTheme(currentUserTheme);
  chrome.storage.local.set({ userTheme: currentUserTheme });
}

export function applyTheme(theme = currentUserTheme) {
  const ui = window.SwiftSelect?.ui;
  if (!ui) return;

  if (ui.guideEl) {
    ui.guideEl._qsThemeState = null;
    applyElementTheme(ui.guideEl, theme);
  }

  if (ui.statusEl) {
    ui.statusEl._qsThemeState = null;
    applyElementTheme(ui.statusEl, theme);
  }

  if (ui.hudEl) {
    ui.hudEl._qsThemeState = null;
    applyElementTheme(ui.hudEl, theme);
  }

  const decorative = [ui.box, ui.overlay].filter(Boolean);
  decorative.forEach((el) => {
    el.classList.remove(
      "qs-theme-dark",
      "qs-theme-glass",
      "qs-theme-glass-dark",
    );
  });

  const isDarkSite = isPageDark();

  if (theme === "standard") {
    _applyStandardPalette(decorative, isDarkSite);
    if (isDarkSite) {
      decorative.forEach((el) => el.classList.add("qs-theme-dark"));
    }
  } else if (theme === "glass") {
    if (isDarkSite) {
      decorative.forEach((el) =>
        el.classList.add("qs-theme-glass", "qs-theme-glass-dark")
      );
    } else {
      decorative.forEach((el) => el.classList.add("qs-theme-glass"));
    }
  }
}

export function applyElementTheme(
  el,
  theme = currentUserTheme,
  targetRect = null,
) {
  if (!el) return false;

  let rect = targetRect;
  if (!rect) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      rect = r;
    } else {
      rect = _getFallbackRectForElement(el);
    }
  }

  const isDark = isAreaDark(rect);

  el.classList.remove(
    "qs-theme-dark",
    "qs-theme-glass",
    "qs-theme-glass-dark",
  );

  if (theme === "standard") {
    _applyStandardPalette([el], isDark);
    if (isDark) {
      el.classList.add("qs-theme-dark");
    }
  } else if (theme === "glass") {
    if (isDark) {
      el.classList.add("qs-theme-glass", "qs-theme-glass-dark");
    } else {
      el.classList.add("qs-theme-glass");
    }
  }

  return isDark;
}

function _applyStandardPalette(elements, isDarkSite) {
  const pageSurface = _getPageSurfaceColor();
  const pageAccent = _getPageAccentColor();
  const neutralSurface =
    pageSurface && _chroma(pageSurface) < 80 ? pageSurface : null;

  const palette = isDarkSite
    ? _buildDarkStandardPalette(neutralSurface, pageAccent)
    : _buildLightStandardPalette(neutralSurface, pageAccent);

  elements.forEach((el) => {
    if (!el) return;
    Object.entries(palette).forEach(([name, value]) => {
      el.style.setProperty(name, value);
    });
  });
}

function _buildLightStandardPalette(surface, accent) {
  const base = surface && _luma(surface) > 130 ? surface : { r: 248, g: 249, b: 250 };
  const panel = _mix(base, { r: 255, g: 255, b: 255 }, 0.72);
  const panelHover = _mix(base, { r: 240, g: 241, b: 243 }, 0.5);
  const ink = { r: 28, g: 31, b: 36 };

  // Use page accent for interactive fills when detected (with safety bounds)
  const fill = accent && _luma(accent) > 35 && _luma(accent) < 195
    ? accent : ink;
  const fillText = _luma(fill) > 150
    ? { r: 28, g: 31, b: 36 }
    : { r: 255, g: 255, b: 255 };

  return {
    "--qs-standard-bg": _rgb(panel),
    "--qs-standard-bg-hover": _rgb(panelHover),
    "--qs-standard-text": _rgb(ink),
    "--qs-standard-border": accent
      ? `rgba(${fill.r}, ${fill.g}, ${fill.b}, 0.72)`
      : "rgba(28, 31, 36, 0.82)",
    "--qs-standard-border-soft": accent
      ? `rgba(${fill.r}, ${fill.g}, ${fill.b}, 0.14)`
      : "rgba(28, 31, 36, 0.16)",
    "--qs-standard-fill": _rgb(fill),
    "--qs-standard-fill-text": _rgb(fillText),
    "--qs-standard-shadow":
      "0 2px 6px 2px rgba(60, 64, 67, 0.15), 0 1px 2px 0 rgba(60, 64, 67, 0.3)",
    "--qs-standard-inner-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.82)",
  };
}

function _buildDarkStandardPalette(surface, accent) {
  const base = surface && _luma(surface) < 130 ? surface : { r: 24, g: 25, b: 28 };
  const panel = _mix(base, { r: 18, g: 19, b: 22 }, 0.68);
  const panelHover = _mix(base, { r: 36, g: 38, b: 43 }, 0.56);
  const ink = { r: 244, g: 246, b: 248 };

  // Use page accent for interactive fills when detected
  const fill = accent && _luma(accent) > 35 && _luma(accent) < 195
    ? accent : ink;
  const fillText = _luma(fill) > 150
    ? { r: 24, g: 25, b: 28 }
    : { r: 244, g: 246, b: 248 };

  return {
    "--qs-standard-bg": _rgb(panel),
    "--qs-standard-bg-hover": _rgb(panelHover),
    "--qs-standard-text": _rgb(ink),
    "--qs-standard-border": accent
      ? `rgba(${fill.r}, ${fill.g}, ${fill.b}, 0.72)`
      : "rgba(244, 246, 248, 0.82)",
    "--qs-standard-border-soft": accent
      ? `rgba(${fill.r}, ${fill.g}, ${fill.b}, 0.18)`
      : "rgba(244, 246, 248, 0.18)",
    "--qs-standard-fill": _rgb(fill),
    "--qs-standard-fill-text": _rgb(fillText),
    "--qs-standard-shadow":
      "0 8px 24px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.25)",
    "--qs-standard-inner-shadow": "inset 0 1px 0 rgba(255, 255, 255, 0.08)",
  };
}

function _getPageSurfaceColor() {
  const roots = [document.body, document.documentElement].filter(Boolean);
  for (const el of roots) {
    const color = _parseColor(window.getComputedStyle(el).backgroundColor);
    if (color && color.a >= 0.8) return color;
  }

  const vw = window.innerWidth || document.documentElement.clientWidth || 1;
  const vh = window.innerHeight || document.documentElement.clientHeight || 1;
  const points = [
    [vw * 0.5, vh * 0.5],
    [vw * 0.2, vh * 0.2],
    [vw * 0.8, vh * 0.2],
    [vw * 0.2, vh * 0.8],
    [vw * 0.8, vh * 0.8],
  ];

  for (const [rawX, rawY] of points) {
    const x = Math.max(0, Math.min(vw - 1, Math.round(rawX)));
    const y = Math.max(0, Math.min(vh - 1, Math.round(rawY)));
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (!_isThemeSampleCandidate(el)) continue;
      const color = _parseColor(window.getComputedStyle(el).backgroundColor);
      if (color && color.a >= 0.8 && _chroma(color) < 80) return color;
    }
  }

  return null;
}

/**
 * Detect the page's dominant accent/brand color by sampling links and buttons.
 * Returns an {r, g, b} object if a confident accent is found, null otherwise.
 */
function _getPageAccentColor() {
  const samples = [];

  // 1) Sample link text colors — most reliable accent source on any page
  try {
    const links = document.querySelectorAll('a:not([class*="qs-"])');
    const linkLimit = Math.min(links.length, 20);
    for (let i = 0; i < linkLimit; i++) {
      const el = links[i];
      if (el.clientWidth < 1 || el.clientHeight < 1) continue;
      const c = _parseColor(window.getComputedStyle(el).color);
      if (c && c.a >= 0.7 && _chroma(c) > 50 && _luma(c) > 30 && _luma(c) < 220) {
        samples.push(c);
      }
    }
  } catch (e) { /* ignore */ }

  // 2) Sample button backgrounds for brand-colored CTAs
  try {
    const btns = document.querySelectorAll(
      'button:not([class*="qs-"]), [role="button"], input[type="submit"]'
    );
    const btnLimit = Math.min(btns.length, 10);
    for (let i = 0; i < btnLimit; i++) {
      const el = btns[i];
      if (el.clientWidth < 1 || el.clientHeight < 1) continue;
      const c = _parseColor(window.getComputedStyle(el).backgroundColor);
      if (c && c.a >= 0.7 && _chroma(c) > 50 && _luma(c) > 30 && _luma(c) < 220) {
        samples.push(c);
      }
    }
  } catch (e) { /* ignore */ }

  if (samples.length < 2) return null; // need at least 2 samples for confidence

  // Bucket by rounding to nearest 25 to find the dominant color
  const buckets = new Map();
  for (const c of samples) {
    const key = `${Math.round(c.r / 25) * 25},${Math.round(c.g / 25) * 25},${Math.round(c.b / 25) * 25}`;
    if (!buckets.has(key)) buckets.set(key, { count: 0, r: 0, g: 0, b: 0 });
    const b = buckets.get(key);
    b.count++;
    b.r += c.r;
    b.g += c.g;
    b.b += c.b;
  }

  let best = null;
  let bestCount = 0;
  for (const [, b] of buckets) {
    if (b.count > bestCount) {
      bestCount = b.count;
      best = {
        r: Math.round(b.r / b.count),
        g: Math.round(b.g / b.count),
        b: Math.round(b.b / b.count),
      };
    }
  }

  return best;
}

export function shouldUseDarkMode() {
  return isPageDark();
}

let _tabScreenshotCanvas = null;
let _tabScreenshotCtx = null;
let _tabScreenshotVersion = 0;
let _scratchCanvas = null;
let _scratchCtx = null;

export function setTabScreenshot(dataUrl) {
  if (!dataUrl) return;
  const version = ++_tabScreenshotVersion;
  const img = new Image();
  img.onload = () => {
    if (version !== _tabScreenshotVersion) return;
    if (!_tabScreenshotCanvas) {
      _tabScreenshotCanvas = document.createElement("canvas");
    }
    _tabScreenshotCanvas.width = img.naturalWidth || img.width;
    _tabScreenshotCanvas.height = img.naturalHeight || img.height;
    _tabScreenshotCtx = _tabScreenshotCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    _tabScreenshotCtx.drawImage(img, 0, 0);

    const ui = window.SwiftSelect?.ui;
    if (ui) {
      if (ui.guideHost && ui.guideHost.style.display !== "none" && ui.guideEl) {
        applyElementTheme(ui.guideEl, currentUserTheme);
      }
      if (
        ui.statusHost &&
        ui.statusHost.style.display !== "none" &&
        ui.statusEl
      ) {
        applyElementTheme(ui.statusEl, currentUserTheme);
      }
      if (ui.hudEl && ui.hudEl.style.display !== "none") {
        applyElementTheme(ui.hudEl, currentUserTheme);
      }
    }
  };
  img.src = dataUrl;
}

function _isSwiftSelectElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return true;
  if (el.id && el.id.startsWith("qs-")) return true;
  if (typeof el.className === "string" && el.className.includes("qs-"))
    return true;

  const ui = window.SwiftSelect?.ui;
  if (ui) {
    if (
      el === ui.guideHost ||
      el === ui.statusHost ||
      el === ui.overlayHost ||
      el === ui.highlighterHost
    ) {
      return true;
    }
  }

  const root = el.getRootNode();
  if (root instanceof ShadowRoot) {
    const host = root.host;
    if (
      host &&
      (host === ui?.guideHost ||
        host === ui?.statusHost ||
        host === ui?.overlayHost ||
        host === ui?.highlighterHost ||
        (typeof host.className === "string" && host.className.includes("qs-")))
    ) {
      return true;
    }
  }

  return false;
}

export function samplePointTheme(x, y) {
  // 1. Ground truth: sample the physical screen pixels from tab screenshot if available
  if (_tabScreenshotCanvas && _tabScreenshotCtx) {
    try {
      const vw = window.innerWidth || document.documentElement.clientWidth || 1;
      const vh =
        window.innerHeight || document.documentElement.clientHeight || 1;
      const sx = Math.max(
        0,
        Math.min(
          _tabScreenshotCanvas.width - 1,
          Math.round(x * (_tabScreenshotCanvas.width / vw)),
        ),
      );
      const sy = Math.max(
        0,
        Math.min(
          _tabScreenshotCanvas.height - 1,
          Math.round(y * (_tabScreenshotCanvas.height / vh)),
        ),
      );
      const pixel = _tabScreenshotCtx.getImageData(sx, sy, 1, 1).data;
      if (pixel[3] > 30) {
        const luma = _luma({ r: pixel[0], g: pixel[1], b: pixel[2] });
        return luma < 128 ? "dark" : "light";
      }
    } catch (e) {}
  }

  // 2. DOM Sampling Fallback
  let stack = [];
  try {
    stack = document.elementsFromPoint(x, y) || [];
  } catch (e) {
    return null;
  }

  const cleanStack = stack.filter((el) => !_isSwiftSelectElement(el));
  if (cleanStack.length === 0) {
    return null;
  }

  let rAcc = 0;
  let gAcc = 0;
  let bAcc = 0;
  let aAcc = 0;
  let textTheme = null;
  let isInsideVideoPlayer = false;

  for (const el of cleanStack) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) continue;

    if (
      el instanceof HTMLVideoElement ||
      el.tagName === "VIDEO" ||
      (el.className &&
        typeof el.className === "string" &&
        (el.className.includes("video") ||
          el.className.includes("player") ||
          el.className.includes("ytp-") ||
          el.className.includes("caption")))
    ) {
      isInsideVideoPlayer = true;
    }

    let style = null;
    try {
      style = window.getComputedStyle(el);
    } catch (e) {
      continue;
    }
    if (!style) continue;

    const bg = _parseColor(style.backgroundColor);
    if (bg && bg.a > 0.01) {
      const aTop = aAcc;
      const aBottom = bg.a;
      const aOut = aTop + aBottom * (1 - aTop);
      if (aOut > 0) {
        rAcc = (rAcc * aTop + bg.r * aBottom * (1 - aTop)) / aOut;
        gAcc = (gAcc * aTop + bg.g * aBottom * (1 - aTop)) / aOut;
        bAcc = (bAcc * aTop + bg.b * aBottom * (1 - aTop)) / aOut;
        aAcc = aOut;
      }
      if (aAcc >= 0.95) break;
    }

    // Try sampling video frame directly
    if (
      (el instanceof HTMLVideoElement || el.tagName === "VIDEO") &&
      el.videoWidth > 0 &&
      el.readyState >= 2
    ) {
      try {
        if (!_scratchCanvas) {
          _scratchCanvas = document.createElement("canvas");
          _scratchCanvas.width = 1;
          _scratchCanvas.height = 1;
          _scratchCtx = _scratchCanvas.getContext("2d", {
            willReadFrequently: true,
          });
        }
        if (_scratchCtx) {
          const vRect = el.getBoundingClientRect();
          const sx = Math.max(
            0,
            Math.min(
              el.videoWidth - 1,
              Math.round((x - vRect.left) * (el.videoWidth / vRect.width)),
            ),
          );
          const sy = Math.max(
            0,
            Math.min(
              el.videoHeight - 1,
              Math.round((y - vRect.top) * (el.videoHeight / vRect.height)),
            ),
          );
          _scratchCtx.clearRect(0, 0, 1, 1);
          _scratchCtx.drawImage(el, sx, sy, 1, 1, 0, 0, 1, 1);
          const pixel = _scratchCtx.getImageData(0, 0, 1, 1).data;
          const cpA = pixel[3] / 255;
          if (cpA > 0.01) {
            const aTop = aAcc;
            const aBottom = cpA;
            const aOut = aTop + aBottom * (1 - aTop);
            if (aOut > 0) {
              rAcc = (rAcc * aTop + pixel[0] * aBottom * (1 - aTop)) / aOut;
              gAcc = (gAcc * aTop + pixel[1] * aBottom * (1 - aTop)) / aOut;
              bAcc = (bAcc * aTop + pixel[2] * aBottom * (1 - aTop)) / aOut;
              aAcc = aOut;
            }
            if (aAcc >= 0.95) break;
          }
        }
      } catch (e) {}
    }

    if (el instanceof HTMLCanvasElement && el.width > 0 && el.height > 0) {
      try {
        const ctx =
          el.getContext("2d", { willReadFrequently: true }) ||
          el.getContext("2d");
        if (ctx) {
          const cRect = el.getBoundingClientRect();
          const cx = Math.max(
            0,
            Math.min(
              el.width - 1,
              Math.round((x - cRect.left) * (el.width / cRect.width)),
            ),
          );
          const cy = Math.max(
            0,
            Math.min(
              el.height - 1,
              Math.round((y - cRect.top) * (el.height / cRect.height)),
            ),
          );
          const pixel = ctx.getImageData(cx, cy, 1, 1).data;
          const cpA = pixel[3] / 255;
          if (cpA > 0.01) {
            const aTop = aAcc;
            const aBottom = cpA;
            const aOut = aTop + aBottom * (1 - aTop);
            if (aOut > 0) {
              rAcc = (rAcc * aTop + pixel[0] * aBottom * (1 - aTop)) / aOut;
              gAcc = (gAcc * aTop + pixel[1] * aBottom * (1 - aTop)) / aOut;
              bAcc = (bAcc * aTop + pixel[2] * aBottom * (1 - aTop)) / aOut;
              aAcc = aOut;
            }
            if (aAcc >= 0.95) break;
          }
        }
      } catch (e) {}
    }

    if (
      (el instanceof HTMLImageElement || el.tagName === "IMG") &&
      el.naturalWidth > 0 &&
      el.complete
    ) {
      try {
        if (!_scratchCanvas) {
          _scratchCanvas = document.createElement("canvas");
          _scratchCanvas.width = 1;
          _scratchCanvas.height = 1;
          _scratchCtx = _scratchCanvas.getContext("2d", {
            willReadFrequently: true,
          });
        }
        if (_scratchCtx) {
          const imgRect = el.getBoundingClientRect();
          const sx = Math.max(
            0,
            Math.min(
              el.naturalWidth - 1,
              Math.round(
                (x - imgRect.left) * (el.naturalWidth / imgRect.width),
              ),
            ),
          );
          const sy = Math.max(
            0,
            Math.min(
              el.naturalHeight - 1,
              Math.round(
                (y - imgRect.top) * (el.naturalHeight / imgRect.height),
              ),
            ),
          );
          _scratchCtx.clearRect(0, 0, 1, 1);
          _scratchCtx.drawImage(el, sx, sy, 1, 1, 0, 0, 1, 1);
          const pixel = _scratchCtx.getImageData(0, 0, 1, 1).data;
          const cpA = pixel[3] / 255;
          if (cpA > 0.01) {
            const aTop = aAcc;
            const aBottom = cpA;
            const aOut = aTop + aBottom * (1 - aTop);
            if (aOut > 0) {
              rAcc = (rAcc * aTop + pixel[0] * aBottom * (1 - aTop)) / aOut;
              gAcc = (gAcc * aTop + pixel[1] * aBottom * (1 - aTop)) / aOut;
              bAcc = (bAcc * aTop + pixel[2] * aBottom * (1 - aTop)) / aOut;
              aAcc = aOut;
            }
            if (aAcc >= 0.95) break;
          }
        }
      } catch (e) {}
    }

    // Check text color cues (e.g. subtitles)
    if (!textTheme && el.innerText && el.innerText.trim().length > 0) {
      const textColor = _parseColor(style.color);
      if (textColor && textColor.a >= 0.5) {
        const tl = _luma(textColor);
        if (tl > 180) textTheme = "dark";
        else if (tl < 75) textTheme = "light";
      }
    }
  }

  // If a confident background color was found from elements or video:
  if (aAcc >= 0.75) {
    const finalLuma = _luma({ r: rAcc, g: gAcc, b: bAcc });
    return finalLuma < 128 ? "dark" : "light";
  }

  // If transparent but we found clear text cues (like white subtitles!), trust it!
  if (textTheme) {
    return textTheme;
  }

  // If inside a video player container and no background was found, player is dark
  if (isInsideVideoPlayer) {
    return "dark";
  }

  const rootBg =
    (document.body &&
      _parseColor(window.getComputedStyle(document.body).backgroundColor)) ||
    (document.documentElement &&
      _parseColor(
        window.getComputedStyle(document.documentElement).backgroundColor,
      ));

  const base =
    rootBg && rootBg.a >= 0.5 ? rootBg : { r: 255, g: 255, b: 255 };

  const aTop = aAcc;
  rAcc = rAcc * aTop + base.r * (1 - aTop);
  gAcc = gAcc * aTop + base.g * (1 - aTop);
  bAcc = bAcc * aTop + base.b * (1 - aTop);

  const finalLuma = _luma({ r: rAcc, g: gAcc, b: bAcc });
  return finalLuma < 128 ? "dark" : "light";
}

export function isAreaDark(rect) {
  if (!rect || rect.width <= 0 || rect.height <= 0) {
    return isPageDark();
  }

  const vw = window.innerWidth || document.documentElement.clientWidth || 1;
  const vh = window.innerHeight || document.documentElement.clientHeight || 1;

  const samplePoints = [];
  const xFracs = [0.2, 0.5, 0.8];
  const yFracs = [0.25, 0.5, 0.75];

  for (const fx of xFracs) {
    for (const fy of yFracs) {
      const px = Math.max(
        0,
        Math.min(vw - 1, Math.round(rect.left + rect.width * fx)),
      );
      const py = Math.max(
        0,
        Math.min(vh - 1, Math.round(rect.top + rect.height * fy)),
      );
      samplePoints.push([px, py]);
    }
  }

  let darkVotes = 0;
  let lightVotes = 0;

  for (const [x, y] of samplePoints) {
    const vote = samplePointTheme(x, y);
    if (vote === "dark") darkVotes++;
    else if (vote === "light") lightVotes++;
  }

  if (darkVotes + lightVotes > 0) {
    return darkVotes > lightVotes;
  }

  return isPageDark();
}

function _getFallbackRectForElement(el) {
  const vw = window.innerWidth || document.documentElement.clientWidth || 800;
  const vh = window.innerHeight || document.documentElement.clientHeight || 600;

  const ui = window.SwiftSelect?.ui;
  if (ui) {
    if (el === ui.guideEl) {
      return {
        left: Math.max(0, vw - 24 - 320),
        top: 24,
        width: 320,
        height: 56,
      };
    }
    if (el === ui.statusEl) {
      return {
        left: Math.max(0, (vw - 260) / 2),
        top: Math.max(0, vh - 40 - 76),
        width: 260,
        height: 76,
      };
    }
    if (el === ui.hudEl) {
      return {
        left: Math.max(0, (vw - 100) / 2),
        top: Math.max(0, (vh - 30) / 2),
        width: 100,
        height: 30,
      };
    }
  }

  if (el?.classList?.contains("qs-guide")) {
    return {
      left: Math.max(0, vw - 24 - 320),
      top: 24,
      width: 320,
      height: 56,
    };
  }
  if (el?.classList?.contains("qs-status")) {
    return {
      left: Math.max(0, (vw - 260) / 2),
      top: Math.max(0, vh - 40 - 76),
      width: 260,
      height: 76,
    };
  }
  if (el?.classList?.contains("qs-hud")) {
    return {
      left: Math.max(0, (vw - 100) / 2),
      top: Math.max(0, (vh - 30) / 2),
      width: 100,
      height: 30,
    };
  }

  return null;
}

export function isPageDark() {
  try {
    const explicitTheme = _readExplicitPageTheme();
    if (explicitTheme) return explicitTheme === "dark";

    const vw = window.innerWidth || document.documentElement.clientWidth || 1;
    const vh = window.innerHeight || document.documentElement.clientHeight || 1;
    const points = [
      [vw * 0.5, vh * 0.5],
      [vw * 0.5, Math.min(96, vh * 0.2)],
      [Math.min(96, vw * 0.2), Math.min(96, vh * 0.2)],
      [Math.max(vw - 96, vw * 0.8), Math.min(96, vh * 0.2)],
      [vw * 0.25, vh * 0.35],
      [vw * 0.75, vh * 0.35],
      [vw * 0.25, vh * 0.75],
      [vw * 0.75, vh * 0.75],
    ];

    let darkScore = 0;
    let lightScore = 0;

    for (const [rawX, rawY] of points) {
      const x = Math.max(0, Math.min(vw - 1, Math.round(rawX)));
      const y = Math.max(0, Math.min(vh - 1, Math.round(rawY)));
      const vote = samplePointTheme(x, y);

      if (vote === "dark") darkScore += 1;
      if (vote === "light") lightScore += 1;
    }

    if (lightScore || darkScore) {
      return darkScore > lightScore * 1.15;
    }

    const roots = [document.documentElement, document.body].filter(Boolean);
    for (const r of roots) {
      const bg = _parseColor(window.getComputedStyle(r).backgroundColor);
      if (bg && bg.a >= 0.5) {
        return _luma(bg) < 128;
      }
    }

    return Boolean(
      window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
  } catch (e) {
    return false;
  }
}

function _readExplicitPageTheme() {
  const nodes = [document.documentElement, document.body].filter(Boolean);

  for (const el of nodes) {
    const explicit = [
      el.getAttribute("data-theme"),
      el.getAttribute("data-mode"),
      el.getAttribute("data-color-mode"),
      el.getAttribute("data-color-scheme"),
      el.style?.colorScheme,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (/\blight\b/.test(explicit) && !/\bdark\b/.test(explicit))
      return "light";
    if (/\bdark\b/.test(explicit) && !/\blight\b/.test(explicit))
      return "dark";
  }

  return null;
}

function _isThemeSampleCandidate(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
  if (
    el.className &&
    typeof el.className === "string" &&
    el.className.includes("qs-")
  )
    return false;
  if (el.clientWidth < 24 || el.clientHeight < 24) return false;
  return true;
}

function _parseColor(colorStr) {
  if (!colorStr) return null;
  if (colorStr === "transparent" || colorStr === "rgba(0, 0, 0, 0)")
    return null;

  if (colorStr.startsWith("#")) {
    let hex = colorStr.slice(1);
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((char) => char + char)
        .join("");
    }
    if (hex.length !== 6) return null;

    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return { r, g, b, a: 1 };
  }

  const match = colorStr.match(/(\d+(\.\d+)?)/g);
  if (!match || match.length < 3) return null;

  const r = parseFloat(match[0]);
  const g = parseFloat(match[1]);
  const b = parseFloat(match[2]);
  const a = match.length > 3 ? parseFloat(match[3]) : 1;

  if (a < 0.1) return null;

  return { r, g, b, a };
}

function _classifySurfaceColor(color) {
  const luma = _luma(color);
  const chroma =
    Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);

  if (luma > 180) return "light";
  if (luma < 70 && chroma < 70) return "dark";

  // Saturated brand colors, such as Facebook blue buttons, are accents rather
  // than page theme surfaces. Treat them as neutral so they cannot dominate.
  if (chroma > 70) return null;

  if (luma < 105) return "dark";
  if (luma > 155) return "light";
  return null;
}

function _luma({ r, g, b }) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function _chroma({ r, g, b }) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function _mix(c1, c2, t) {
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t),
  };
}

function _rgb({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
}
