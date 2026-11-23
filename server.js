/**
 * Lightweight zero-dependency preview server for running SwiftSelect extension
 * pages on port 3000.
 *
 * Uses Node's built-in `node:http` so the server boots immediately without
 * waiting for heavy third-party server frameworks. Keeps Chrome MV3 extension
 * files untouched so the directory remains directly loadable via
 * chrome://extensions -> Load unpacked. When served over HTTP, HTML pages
 * receive the chrome.* browser shim in <head> before page scripts execute.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME_STORE_FILES, verifyPackageFiles, createZipBuffer } from "./scripts/package-manifest.js";
import { CWS_V2_ASSETS, auditGeneratedAssets } from "./tools/store-assets-v2/spec.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const STORE_V2_DIR = path.join(__dirname, "Chrome Web Store assets", "v2");

const HTML_PAGES = new Set([
  "gallery.html",
  "annotate.html",
  "popup.html",
  "settings.html",
  "convert.html",
  "options.html",
  "menu.html",
  "offscreen.html",
]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf-8"));
  } catch {
    return { manifest_version: 3, name: "SwiftSelect", version: "2.2.0", commands: {} };
  }
}

function send(res, status, contentType, body, method = "GET") {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": String(buf.length),
    // A preview server: always revalidate, so an edit shows on the next load.
    "Cache-Control": "no-cache",
  });
  res.end(method === "HEAD" ? undefined : buf);
}

function sendJson(res, status, data, method = "GET") {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(data), method);
}

function sendFile(res, filePath, method = "GET") {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return send(res, 404, "text/plain; charset=utf-8", "Not found", method);
  }
  if (!stat.isFile()) {
    return send(res, 404, "text/plain; charset=utf-8", "Not found", method);
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": String(stat.size),
    "Cache-Control": "no-cache",
  });
  if (method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("Internal server error");
  });
  stream.pipe(res);
}

function sendShimmedHtml(res, filePath, method = "GET") {
  if (!fs.existsSync(filePath)) {
    return send(res, 404, "text/plain; charset=utf-8", "Not found", method);
  }
  const manifestJson = JSON.stringify(readManifest()).replace(/</g, "\\u003c");
  const inject =
    `\n    <script>window.__SWIFTSELECT_MANIFEST__ = ${manifestJson};</script>` +
    `\n    <script src="/chrome-shim.js"></script>`;
  const html = fs.readFileSync(filePath, "utf-8");
  const patched = html.includes("<head>") ? html.replace("<head>", `<head>${inject}`) : `${inject}${html}`;
  send(res, 200, "text/html; charset=utf-8", patched, method);
}

function handleRequest(req, res) {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    return send(res, 405, "text/plain; charset=utf-8", "Method not allowed", method);
  }

  let pathname;
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, "text/plain; charset=utf-8", "Bad request", method);
  }

  // Default route opens the Chrome Web Store v2 Asset Studio showcase (live extension remains at /gallery.html).
  if (pathname === "/" || pathname === "/store-assets-v2.html") {
    return sendFile(res, path.join(__dirname, "store-assets-v2.html"), method);
  }

  // Live Chrome Web Store v2 asset specification audit.
  if (pathname === "/__dev/store-assets-v2-audit") {
    const audit = auditGeneratedAssets(STORE_V2_DIR, CWS_V2_ASSETS);
    const byId = new Map(audit.results.map((r) => [r.id, r]));
    const assets = CWS_V2_ASSETS.map((spec) => {
      const r = byId.get(spec.id) || {};
      return { ...spec, ...r };
    });
    return sendJson(res, 200, { ok: audit.ok, errors: audit.errors, assets }, method);
  }

  // One-click ZIP download of all 9 Chrome Web Store v2 assets.
  if (pathname === "/__dev/store-assets-v2.zip") {
    const entries = [];
    for (const spec of CWS_V2_ASSETS) {
      const abs = path.join(STORE_V2_DIR, spec.filename);
      if (!fs.existsSync(abs)) {
        return sendJson(res, 404, { ok: false, error: `Missing asset: ${spec.filename}` }, method);
      }
      entries.push({
        name: `swiftselect-chrome-web-store-v2/${spec.filename}`,
        data: fs.readFileSync(abs),
        mtime: fs.statSync(abs).mtime,
      });
    }
    const zip = createZipBuffer(entries);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="swiftselect-chrome-web-store-assets-v2.zip"',
      "Content-Length": String(zip.length),
    });
    return res.end(method === "HEAD" ? undefined : zip);
  }

  // Dev-only Chrome Web Store package audit & verified ZIP download.
  if (pathname === "/__dev/package-audit") {
    const report = verifyPackageFiles({ rootDir: __dirname, files: CHROME_STORE_FILES });
    return sendJson(res, report.ok ? 200 : 500, report, method);
  }

  if (pathname === "/__dev/chrome-web-store.zip") {
    const report = verifyPackageFiles({ rootDir: __dirname, files: CHROME_STORE_FILES });
    if (!report.ok) {
      return sendJson(res, 500, { ok: false, errors: report.errors }, method);
    }
    const entries = report.included.map((item) => {
      const abs = path.join(__dirname, item.path);
      return { name: item.path, data: fs.readFileSync(abs), mtime: fs.statSync(abs).mtime };
    });
    const zip = createZipBuffer(entries);
    const filename = `swiftselect-v${report.version}-chrome-web-store.zip`;
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(zip.length),
    });
    return res.end(method === "HEAD" ? undefined : zip);
  }

  // Serve extension HTML pages with the chrome.* preview shim injected.
  const rel = pathname.replace(/^\/+/, "");
  if (HTML_PAGES.has(rel)) {
    return sendShimmedHtml(res, path.join(__dirname, rel), method);
  }

  // Prevent exposing server/package internals or path traversal over HTTP.
  if (
    !rel ||
    rel === "server.js" ||
    rel.startsWith("node_modules/") ||
    rel.startsWith("scripts/") ||
    rel.startsWith("dist/") ||
    rel.startsWith(".") ||
    rel.includes("/.")
  ) {
    return send(res, 404, "text/plain; charset=utf-8", "Not found", method);
  }

  const resolved = path.resolve(__dirname, rel);
  if (!resolved.startsWith(__dirname + path.sep)) {
    return send(res, 404, "text/plain; charset=utf-8", "Not found", method);
  }

  return sendFile(res, resolved, method);
}

const server = http.createServer((req, res) => {
  try {
    handleRequest(req, res);
  } catch (err) {
    console.error("SwiftSelect server error:", err);
    if (!res.headersSent) {
      send(res, 500, "text/plain; charset=utf-8", "Internal server error", req.method || "GET");
    } else {
      res.end();
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`SwiftSelect preview server listening on http://0.0.0.0:${PORT}`);
});
