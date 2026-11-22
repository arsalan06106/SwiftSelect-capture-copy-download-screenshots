/**
 * Single source of truth for Chrome Web Store packaging.
 *
 * Uses an explicit allowlist (never a denylist) so local dev servers, browser
 * shims, unit tests, unbundled esbuild source files, docs, and attachments can
 * never leak into the Chrome Web Store upload ZIP.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/**
 * Exact runtime files shipped to Chrome Web Store.
 * Keep sorted by functional group so every file's purpose is obvious at a glance.
 */
export const CHROME_STORE_FILES = [
  // Extension manifest & license
  "manifest.json",
  "LICENSE.txt",

  // Service worker & offscreen canvas/clipboard document
  "background.js",
  "offscreen.html",
  "offscreen.js",

  // Bundled content & annotation scripts (built via `npm run build`)
  "contentScript.js",
  "annotatePage.js",

  // Stylesheets (styles.css is also in web_accessible_resources)
  "styles.css",
  "pages.css",

  // Extension HTML pages & top-level page scripts
  "popup.html",
  "popup.js",
  "gallery.html",
  "gallery.js",
  "annotate.html",
  "settings.html",
  "options.html",
  "options.js",
  "convert.html",
  "convert.js",

  // Unbundled runtime ES modules & redirect scripts imported by extension pages
  "src/storage.js",
  "src/settings.js",
  "src/downloadFile.js",
  "src/pageTheme.js",
  "src/pageKit.js",
  "src/issues.js",
  "src/peekData.js",
  "src/settingsRedirect.js",
  "src/convertRedirect.js",
  "src/converter/rules.js",
  "src/converter/engine.js",

  // Icons
  "icons/app16.png",
  "icons/app32.png",
  "icons/app48.png",
  "icons/app128.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "icons/tab-icon-16.png",
  "icons/tab-icon-32.png",
  "icons/tab-icon-64.png",

  // Bundled local UI fonts (MV3 CSP-safe, zero external font requests)
  "fonts/inter-latin.woff2",
  "fonts/inter-latin-ext.woff2",
  "fonts/LICENSE-Inter.txt",

  // Local offline PNG optimizer (zero CDN calls)
  "vendor/mazanoke/upng.js",
  "vendor/mazanoke/ATTRIBUTIONS.md",
];

/**
 * Patterns that must NEVER appear in a Chrome Web Store ZIP.
 */
export const FORBIDDEN_PATTERNS = [
  /^server\.js$/,
  /^chrome-shim\.js$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^bun\.lock$/,
  /^metadata\.json$/,
  /^menu\.(html|js)$/,
  /^node_modules\//,
  /^dist\//,
  /^public\//,
  /^scripts\//,
  /^\./,
  /\.test\.js$/,
  /\.spec\.js$/,
  /^src\/(contentScript|annotatePage|events|peek|panelSettings|theme|ui)\.js$/,
  /^src\/capture\//,
  /^src\/styles\.min\.css$/,
];

/**
 * Human-readable explanation for why a workspace path is excluded from the ZIP.
 */
export function explainExclusion(relPath) {
  const norm = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (norm === "server.js" || norm === "chrome-shim.js") {
    return "Local preview server / browser chrome.* shim (dev only)";
  }
  if (norm === "menu.html" || norm === "menu.js") {
    return "Unused legacy menu file (contains external Google Fonts link)";
  }
  if (norm === "package.json" || norm === "bun.lock" || norm === "package-lock.json" || norm === "metadata.json") {
    return "Build/package/workspace metadata";
  }
  if (norm.startsWith("scripts/")) {
    return "Build & Chrome Web Store packaging scripts";
  }
  if (norm.startsWith("public/")) {
    return "Workspace preview attachments (not part of extension)";
  }
  if (norm.startsWith("dist/")) {
    return "Generated build output directory";
  }
  if (norm.startsWith("node_modules/")) {
    return "Node.js build/dev dependencies";
  }
  if (norm.startsWith(".")) {
    return "Hidden workspace/git/tooling file";
  }
  if (/\.test\.js$|\.spec\.js$/.test(norm)) {
    return "Unit test file";
  }
  if (
    /^src\/(contentScript|annotatePage|events|peek|panelSettings|theme|ui)\.js$/.test(norm) ||
    norm.startsWith("src/capture/") ||
    norm === "src/styles.min.css"
  ) {
    return "Already bundled into contentScript.js / annotatePage.js by esbuild";
  }
  if (norm.endsWith(".md")) {
    return "Developer documentation";
  }
  return "Not referenced by Chrome extension runtime";
}

function isLocalAssetRef(ref) {
  if (!ref || typeof ref !== "string") return false;
  const trimmed = ref.trim();
  if (!trimmed) return false;
  if (/^(https?:|data:|blob:|chrome:|chrome-extension:|mailto:|javascript:|#)/i.test(trimmed)) {
    return false;
  }
  return true;
}

function resolveRel(fromFile, ref) {
  const cleanRef = ref.split(/[?#]/)[0].trim();
  if (!cleanRef) return null;
  const fromDir = path.posix.dirname(fromFile.replace(/\\/g, "/"));
  const joined = cleanRef.startsWith("/") ? cleanRef.slice(1) : path.posix.join(fromDir === "." ? "" : fromDir, cleanRef);
  return path.posix.normalize(joined);
}

/**
 * Extract local file references from an HTML file.
 */
export function extractHtmlAssetRefs(html, htmlFile) {
  const refs = new Set();
  const externalUrls = [];

  const attrRe = /\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = attrRe.exec(html))) {
    const raw = m[1].trim();
    if (/^https?:\/\//i.test(raw)) {
      // Allow outbound <a href="https://..."> links (like GitHub credits), flag external <script>/<link>
      const tagStart = html.lastIndexOf("<", m.index);
      const tagSnippet = html.slice(tagStart, m.index + m[0].length);
      if (/^<(script|link)\b/i.test(tagSnippet)) {
        externalUrls.push(raw);
      }
      continue;
    }
    if (isLocalAssetRef(raw)) {
      const resolved = resolveRel(htmlFile, raw);
      if (resolved) refs.add(resolved);
    }
  }

  // Also check <meta http-equiv="refresh" content="0; url=settings.html" />
  const metaRefreshRe = /content\s*=\s*["'][^"']*url\s*=\s*([^"'\s;]+)["']/gi;
  while ((m = metaRefreshRe.exec(html))) {
    const raw = m[1].trim();
    if (isLocalAssetRef(raw)) {
      const resolved = resolveRel(htmlFile, raw);
      if (resolved) refs.add(resolved);
    }
  }

  return { refs: [...refs], externalUrls };
}

/**
 * Extract local ES module imports and local vendor script paths from JS files.
 */
export function extractJsModuleRefs(code, jsFile) {
  const refs = new Set();

  // Static import/export from "./..."
  const staticRe = /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["'](\.[^"']+)["']/g;
  let m;
  while ((m = staticRe.exec(code))) {
    const resolved = resolveRel(jsFile, m[1]);
    if (resolved) refs.add(resolved);
  }

  // Dynamic import("./...")
  const dynRe = /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g;
  while ((m = dynRe.exec(code))) {
    const resolved = resolveRel(jsFile, m[1]);
    if (resolved) refs.add(resolved);
  }

  // Local vendor asset string literals (e.g. "vendor/mazanoke/upng.js")
  const vendorRe = /["'](vendor\/[^"']+\.(?:js|wasm|css))["']/g;
  while ((m = vendorRe.exec(code))) {
    refs.add(path.posix.normalize(m[1]));
  }

  return [...refs];
}

/**
 * Extract local url(...) references from CSS files.
 */
export function extractCssAssetRefs(css, cssFile) {
  const refs = new Set();
  const urlRe = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  let m;
  while ((m = urlRe.exec(css))) {
    const raw = m[1].trim();
    if (isLocalAssetRef(raw)) {
      const resolved = resolveRel(cssFile, raw);
      if (resolved) refs.add(resolved);
    }
  }
  return [...refs];
}

/**
 * Extract all local file paths / wildcard prefixes required by manifest.json.
 */
export function extractManifestRefs(manifest) {
  const files = new Set();
  const globs = new Set();

  if (manifest?.background?.service_worker) {
    files.add(manifest.background.service_worker);
  }
  if (manifest?.action?.default_popup) {
    files.add(manifest.action.default_popup);
  }
  if (manifest?.options_ui?.page) {
    files.add(manifest.options_ui.page);
  }
  if (manifest?.options_page) {
    files.add(manifest.options_page);
  }
  for (const iconMap of [manifest?.icons, manifest?.action?.default_icon]) {
    if (iconMap && typeof iconMap === "object") {
      for (const p of Object.values(iconMap)) {
        if (typeof p === "string") files.add(p);
      }
    }
  }
  if (Array.isArray(manifest?.content_scripts)) {
    for (const cs of manifest.content_scripts) {
      for (const p of [...(cs.js || []), ...(cs.css || [])]) {
        files.add(p);
      }
    }
  }
  if (Array.isArray(manifest?.web_accessible_resources)) {
    for (const entry of manifest.web_accessible_resources) {
      for (const r of entry.resources || []) {
        if (r.includes("*")) globs.add(r);
        else files.add(r);
      }
    }
  }
  return { files: [...files], globs: [...globs] };
}

function listWorkspaceFiles(rootDir, rel = "") {
  const out = [];
  const abs = path.join(rootDir, rel);
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  for (const entry of entries) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    // Skip huge/transient top-level folders while still noting them at top level
    if (!rel && (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git" || entry.name === ".playwright-cli" || entry.name === ".aistudio")) {
      out.push(`${childRel}/`);
      continue;
    }
    if (entry.isDirectory()) {
      out.push(...listWorkspaceFiles(rootDir, childRel));
    } else {
      out.push(childRel);
    }
  }
  return out;
}

/**
 * Audit the allowlisted Chrome Web Store file set against the workspace on disk.
 */
export function verifyPackageFiles({ rootDir, files = CHROME_STORE_FILES }) {
  const errors = [];
  const warnings = [];
  const normalized = files.map((f) => f.replace(/\\/g, "/").replace(/^\.\//, ""));
  const fileSet = new Set(normalized);

  // 1. Duplicate check & forbidden pattern check
  if (fileSet.size !== normalized.length) {
    errors.push("Duplicate file entries found in CHROME_STORE_FILES allowlist.");
  }
  for (const rel of normalized) {
    for (const pat of FORBIDDEN_PATTERNS) {
      if (pat.test(rel)) {
        errors.push(`Forbidden dev/internal file in package allowlist: ${rel}`);
      }
    }
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) {
      errors.push(`Allowlisted file missing on disk: ${rel}`);
    } else if (fs.statSync(abs).size === 0) {
      errors.push(`Allowlisted file is empty (0 bytes): ${rel}`);
    }
  }

  // 2. Validate manifest.json references
  const manifestPath = path.join(rootDir, "manifest.json");
  let manifest = null;
  if (!fileSet.has("manifest.json") || !fs.existsSync(manifestPath)) {
    errors.push("manifest.json must be present in the package root.");
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch (err) {
      errors.push(`manifest.json is invalid JSON: ${err.message}`);
    }
  }

  if (manifest) {
    if (manifest.manifest_version !== 3) {
      errors.push(`Expected manifest_version 3, got ${manifest.manifest_version}`);
    }
    const mRefs = extractManifestRefs(manifest);
    for (const ref of mRefs.files) {
      if (!fileSet.has(ref)) {
        errors.push(`manifest.json references "${ref}" which is NOT in the package allowlist.`);
      }
    }
    for (const glob of mRefs.globs) {
      const prefix = glob.replace(/\*.*$/, "");
      const matched = normalized.some((f) => f.startsWith(prefix));
      if (!matched) {
        errors.push(`manifest.json web_accessible_resources pattern "${glob}" matches zero packaged files.`);
      }
    }
  }

  // 3. Validate references inside every packaged HTML, CSS, and unbundled JS file
  for (const rel of normalized) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) continue;

    if (rel.endsWith(".html")) {
      const html = fs.readFileSync(abs, "utf-8");
      const { refs, externalUrls } = extractHtmlAssetRefs(html, rel);
      for (const ref of refs) {
        if (!fileSet.has(ref)) {
          errors.push(`${rel} references "${ref}" which is missing from the package allowlist.`);
        }
      }
      for (const url of externalUrls) {
        errors.push(`${rel} loads external remote resource "${url}" (disallowed in MV3 / offline packaging).`);
      }
    } else if (rel.endsWith(".css")) {
      const css = fs.readFileSync(abs, "utf-8");
      for (const ref of extractCssAssetRefs(css, rel)) {
        if (!fileSet.has(ref)) {
          errors.push(`${rel} references "${ref}" which is missing from the package allowlist.`);
        }
      }
    } else if (rel.endsWith(".js") && !rel.startsWith("vendor/") && rel !== "contentScript.js" && rel !== "annotatePage.js") {
      const code = fs.readFileSync(abs, "utf-8");
      for (const ref of extractJsModuleRefs(code, rel)) {
        if (!fileSet.has(ref)) {
          errors.push(`${rel} imports/references "${ref}" which is missing from the package allowlist.`);
        }
      }
    }
  }

  // 4. Collect stats + list excluded workspace files with clear reasons
  const included = [];
  let totalBytes = 0;
  for (const rel of normalized) {
    const abs = path.join(rootDir, rel);
    const size = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
    totalBytes += size;
    included.push({ path: rel, bytes: size });
  }

  const allWorkspace = fs.existsSync(rootDir) ? listWorkspaceFiles(rootDir) : [];
  const excluded = allWorkspace
    .filter((p) => !fileSet.has(p))
    .sort()
    .map((p) => ({ path: p, reason: explainExclusion(p) }));

  return {
    ok: errors.length === 0,
    version: manifest?.version || "0.0.0",
    name: manifest?.name || "SwiftSelect",
    errors,
    warnings,
    included,
    excluded,
    stats: {
      includedCount: included.length,
      excludedCount: excluded.length,
      totalUnpackedBytes: totalBytes,
    },
  };
}

// ─── Minimal, standards-compliant PKZIP builder (DEFLATE + STORE) ──────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getUTCFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  return { dosDate, dosTime };
}

/**
 * Create a standard PKZIP archive buffer using DEFLATE when beneficial (else STORE).
 * @param {{ name: string, data: Uint8Array | Buffer, mtime?: Date }[]} entries
 * @returns {Buffer}
 */
export function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameStr = entry.name.replace(/\\/g, "/");
    const nameBuf = Buffer.from(nameStr, "utf-8");
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(raw);

    // Try DEFLATE; keep STORE for already-compressed files (.png, .woff2) if no smaller
    const deflated = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const payload = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const { dosDate, dosTime } = dosDateTime(entry.mtime || new Date());

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed: 2.0
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, payload);

    // Central directory header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}
