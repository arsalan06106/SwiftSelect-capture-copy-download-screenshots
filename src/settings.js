/**
 * SwiftSelect settings model.
 *
 * One schema, shared by the service worker, the extension pages and the
 * content bundle. Everything lives in chrome.storage.local so a change made
 * anywhere reaches every context through storage.onChanged.
 */

export const DEFAULTS = Object.freeze({
  userTheme: "light", // light | dark | system   (legacy: glass | standard)
  uiLanguage: "auto", // auto | en
  outputFormat: "jpg", // png | jpg | webp
  outputQuality: 0.92, // 0.5 – 1.0, ignored for png
  outputDestination: "both", // both | clipboard | download | none
  saveToGallery: true,
  captureDelay: 0, // seconds: 0 | 3 | 5
  filenameTemplate: "{title} - {type} - {date}-{time}",
  actionClick: "region", // region | menu
  captureFlash: true, // shutter flash after a capture
  toolbarShortcuts: false, // single-key shortcuts while the capture toolbar is open
  editorShortcuts: false, // single-key and Ctrl shortcuts in the annotation editor
  retentionDays: 90, // gallery auto-delete: 0 = keep forever, else 7 | 30 | 90
  trashDays: 30, // how long deleted captures stay recoverable: 7 | 30
});

export const RETENTION_CHOICES = [0, 7, 30, 90];
export const TRASH_CHOICES = [7, 30];

export const SETTING_KEYS = Object.freeze(Object.keys(DEFAULTS));

const FORMATS = {
  png: { ext: "png", mime: "image/png" },
  jpg: { ext: "jpg", mime: "image/jpeg" },
  webp: { ext: "webp", mime: "image/webp" },
};

export function normalizeTheme(value) {
  if (value === "light" || value === "dark" || value === "standard" || value === "system") return value;
  if (value === "glass") return "system"; // pre-2.0 name
  return "light"; // nothing stored: light is the default
}

export function normalizeSettings(raw = {}) {
  const format = FORMATS[raw.outputFormat] ? raw.outputFormat : DEFAULTS.outputFormat;
  const q = Number(raw.outputQuality);
  const quality = Number.isFinite(q) ? Math.min(1, Math.max(0.5, q)) : DEFAULTS.outputQuality;
  const destination = ["both", "clipboard", "download", "none"].includes(raw.outputDestination)
    ? raw.outputDestination
    : DEFAULTS.outputDestination;
  const delay = [0, 3, 5].includes(Number(raw.captureDelay)) ? Number(raw.captureDelay) : 0;
  const template =
    typeof raw.filenameTemplate === "string" && raw.filenameTemplate.trim()
      ? raw.filenameTemplate.trim()
      : DEFAULTS.filenameTemplate;

  return {
    userTheme: normalizeTheme(raw.userTheme),
    uiLanguage: raw.uiLanguage === "en" ? "en" : "auto",
    outputFormat: format,
    outputQuality: quality,
    outputDestination: destination,
    saveToGallery: raw.saveToGallery !== false,
    captureDelay: delay,
    filenameTemplate: template,
    actionClick: raw.actionClick === "menu" ? "menu" : "region",
    captureFlash: raw.captureFlash !== false,
    toolbarShortcuts: raw.toolbarShortcuts === true,
    editorShortcuts: raw.editorShortcuts === true,
    retentionDays: RETENTION_CHOICES.includes(Number(raw.retentionDays)) ? Number(raw.retentionDays) : 90,
    trashDays: TRASH_CHOICES.includes(Number(raw.trashDays)) ? Number(raw.trashDays) : 30,
  };
}

export function getSettings() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(SETTING_KEYS, (data) => {
        if (chrome.runtime.lastError) return resolve(normalizeSettings());
        resolve(normalizeSettings(data || {}));
      });
    } catch {
      resolve(normalizeSettings());
    }
  });
}

export function setSettings(patch) {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set(patch, () => resolve(!chrome.runtime.lastError));
    } catch {
      resolve(false);
    }
  });
}

export function formatInfo(format) {
  return FORMATS[format] || FORMATS.jpg;
}

export function wantsCopy(destination) {
  return destination === "both" || destination === "clipboard";
}

export function wantsDownload(destination) {
  return destination === "both" || destination === "download";
}

export function destinationFromToggles(copy, download) {
  if (copy && download) return "both";
  if (copy) return "clipboard";
  if (download) return "download";
  return "none";
}

const ILLEGAL = /[<>:"\/\\|?*\x00-\x1F]/g;

function clean(value, max = 100) {
  let s = String(value || "").replace(ILLEGAL, " ").replace(/\s+/g, " ").trim();
  if (s.length > max) s = s.substring(0, max).trim();
  return s;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/**
 * Expand a filename template. Tags: {date} {time} {title} {url} {type}.
 * Empty tags collapse cleanly, so "{title} - {type}" on an untitled page
 * becomes "fullpage" and not " - fullpage".
 */
export function buildFilename(template, { title = "", url = "", type = "screenshot", ext = "jpg", date = new Date() } = {}) {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {}

  const tags = {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
    title: clean(title),
    url: clean(host, 60),
    type: clean(type, 30),
  };

  let name = String(template || DEFAULTS.filenameTemplate).replace(
    /\{(date|time|title|url|type)\}/gi,
    (_, tag) => tags[tag.toLowerCase()],
  );

  name = name
    .replace(ILLEGAL, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-_.]+|[\s\-_.]+$/g, "")
    .replace(/(\s[-_]\s)(?:[-_]\s)+/g, "$1")
    .trim();

  if (!name) name = `${tags.type || "screenshot"} ${tags.date} ${tags.time}`;
  if (name.length > 180) name = name.substring(0, 180).trim();

  return `${name}.${String(ext || "jpg").replace(/^\./, "")}`;
}
