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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT) || 3000;

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

// Default route opens the Swift Gallery dashboard (which also hosts Settings and Batch Converter).
app.get("/", (_req, res) => {
  sendShimmedHtml(res, path.join(__dirname, "gallery.html"));
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
  if (rel === "server.js" || rel.startsWith("node_modules/") || rel.startsWith(".")) {
    return res.status(404).send("Not found");
  }
  next();
});

app.use(express.static(__dirname, { index: false }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SwiftSelect preview server listening on http://0.0.0.0:${PORT}`);
});
