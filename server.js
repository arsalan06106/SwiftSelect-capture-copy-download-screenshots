/**
 * Lightweight preview server for running SwiftSelect extension pages on port 3000.
 *
 * Keeps the Chrome MV3 extension files untouched so the directory remains
 * directly loadable via chrome://extensions -> Load unpacked. When served over
 * HTTP, HTML pages receive the chrome.* browser shim in <head> before page
 * scripts execute.
 */
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME_STORE_FILES, verifyPackageFiles, createZipBuffer } from "./scripts/package-manifest.js";
import { CWS_V2_ASSETS, auditGeneratedAssets } from "./tools/store-assets-v2/spec.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;
const STORE_V2_DIR = path.join(__dirname, "Chrome Web Store assets", "v2");

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf-8"));
  } catch {
    return { manifest_version: 3, name: "SwiftSelect", version: "2.2.0", commands: {} };
  }
}

function sendShimmedHtml(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.status(404).send("Not found");
    return;
  }
  const manifestJson = JSON.stringify(readManifest()).replace(/</g, "\\u003c");
  const inject =
    `\n    <script>window.__SWIFTSELECT_MANIFEST__ = ${manifestJson};</script>` +
    `\n    <script src="/chrome-shim.js"></script>`;
  const html = fs.readFileSync(filePath, "utf-8");
  const patched = html.includes("<head>") ? html.replace("<head>", `<head>${inject}`) : `${inject}${html}`;
  res.type("html").send(patched);
}

// Default route opens the Chrome Web Store v2 Asset Studio showcase (live extension remains at /gallery.html).
app.get(["/", "/store-assets-v2.html"], (_req, res) => {
  res.sendFile(path.join(__dirname, "store-assets-v2.html"));
});

// Live Chrome Web Store v2 asset specification audit.
app.get("/__dev/store-assets-v2-audit", (_req, res) => {
  const audit = auditGeneratedAssets(STORE_V2_DIR, CWS_V2_ASSETS);
  const byId = new Map(audit.results.map((r) => [r.id, r]));
  const assets = CWS_V2_ASSETS.map((spec) => {
    const r = byId.get(spec.id) || {};
    return { ...spec, ...r };
  });
  res.json({ ok: audit.ok, errors: audit.errors, assets });
});

// One-click ZIP download of all 9 Chrome Web Store v2 assets.
app.get("/__dev/store-assets-v2.zip", (_req, res) => {
  const entries = [];
  for (const spec of CWS_V2_ASSETS) {
    const abs = path.join(STORE_V2_DIR, spec.filename);
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ ok: false, error: `Missing asset: ${spec.filename}` });
    }
    entries.push({
      name: `swiftselect-chrome-web-store-v2/${spec.filename}`,
      data: fs.readFileSync(abs),
      mtime: fs.statSync(abs).mtime,
    });
  }
  const zip = createZipBuffer(entries);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="swiftselect-chrome-web-store-assets-v2.zip"');
  res.setHeader("Content-Length", String(zip.length));
  res.send(zip);
});

// Dev-only Chrome Web Store package audit & verified ZIP download (not part of the extension bundle).
app.get("/__dev/package-audit", (_req, res) => {
  const report = verifyPackageFiles({ rootDir: __dirname, files: CHROME_STORE_FILES });
  res.status(report.ok ? 200 : 500).json(report);
});

app.get("/__dev/chrome-web-store.zip", (_req, res) => {
  const report = verifyPackageFiles({ rootDir: __dirname, files: CHROME_STORE_FILES });
  if (!report.ok) {
    return res.status(500).json({ ok: false, errors: report.errors });
  }
  const entries = report.included.map((item) => {
    const abs = path.join(__dirname, item.path);
    return { name: item.path, data: fs.readFileSync(abs), mtime: fs.statSync(abs).mtime };
  });
  const zip = createZipBuffer(entries);
  const filename = `swiftselect-v${report.version}-chrome-web-store.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", String(zip.length));
  res.send(zip);
});

// Serve extension HTML pages with the chrome.* preview shim injected.
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

app.get("/:page", (req, res, next) => {
  if (HTML_PAGES.has(req.params.page)) {
    return sendShimmedHtml(res, path.join(__dirname, req.params.page));
  }
  next();
});

// Prevent exposing server/package internals over HTTP.
app.use((req, res, next) => {
  const rel = req.path.replace(/^\/+/, "");
  if (
    rel === "server.js" ||
    rel.startsWith("node_modules/") ||
    rel.startsWith("scripts/") ||
    rel.startsWith("dist/") ||
    rel.startsWith(".")
  ) {
    return res.status(404).send("Not found");
  }
  next();
});

app.use(express.static(__dirname, { index: false }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SwiftSelect preview server listening on http://0.0.0.0:${PORT}`);
});
