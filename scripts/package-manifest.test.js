import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import {
  CHROME_STORE_FILES,
  explainExclusion,
  extractHtmlAssetRefs,
  extractJsModuleRefs,
  extractCssAssetRefs,
  extractManifestRefs,
  verifyPackageFiles,
  createZipBuffer,
  crc32,
} from "./package-manifest.js";

test("extractHtmlAssetRefs finds local scripts, stylesheets, icons, meta refresh, and flags external scripts", () => {
  const html = `
    <head>
      <link rel="icon" href="icons/tab-icon-16.png" />
      <link rel="stylesheet" href="pages.css" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />
      <meta http-equiv="refresh" content="0; url=settings.html" />
      <script src="src/pageTheme.js"></script>
    </head>
    <body>
      <img src="icons/icon128.png" />
      <a href="https://github.com/civilblur/mazanoke">Credits</a>
    </body>
  `;
  const { refs, externalUrls } = extractHtmlAssetRefs(html, "gallery.html");
  assert.deepEqual(
    refs.sort(),
    ["icons/icon128.png", "icons/tab-icon-16.png", "pages.css", "settings.html", "src/pageTheme.js"].sort()
  );
  assert.deepEqual(externalUrls, ["https://fonts.googleapis.com/css2?family=Inter"]);
});

test("extractJsModuleRefs resolves relative static imports, dynamic imports, and vendor paths", () => {
  const code = `
    import { a } from "./src/settings.js";
    import "./storage.js";
    const mod = await import("./convert.js");
    const url = "vendor/mazanoke/upng.js";
  `;
  const refs = extractJsModuleRefs(code, "gallery.js");
  assert.deepEqual(
    refs.sort(),
    ["convert.js", "src/settings.js", "storage.js", "vendor/mazanoke/upng.js"].sort()
  );
});

test("extractCssAssetRefs extracts local font URLs while ignoring data URIs", () => {
  const css = `
    @font-face { src: url("fonts/inter-latin.woff2") format("woff2"); }
    .x { background: url("data:image/svg+xml;base64,abc"); }
  `;
  assert.deepEqual(extractCssAssetRefs(css, "pages.css"), ["fonts/inter-latin.woff2"]);
});

test("extractManifestRefs collects service worker, popup, options, icons, and web_accessible_resources", () => {
  const refs = extractManifestRefs({
    background: { service_worker: "background.js" },
    action: { default_popup: "popup.html", default_icon: { "16": "icons/app16.png" } },
    icons: { "128": "icons/app128.png" },
    options_ui: { page: "settings.html" },
    web_accessible_resources: [{ resources: ["styles.css", "fonts/*"], matches: ["<all_urls>"] }],
  });
  assert.deepEqual(
    refs.files.sort(),
    ["background.js", "icons/app128.png", "icons/app16.png", "popup.html", "settings.html", "styles.css"].sort()
  );
  assert.deepEqual(refs.globs, ["fonts/*"]);
});

test("verifyPackageFiles rejects forbidden dev files and missing referenced assets", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-pkg-test-"));
  try {
    fs.writeFileSync(
      path.join(tmp, "manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name: "Test",
        version: "1.0.0",
        background: { service_worker: "background.js" },
        action: { default_popup: "popup.html" },
      })
    );
    fs.writeFileSync(path.join(tmp, "background.js"), 'import "./missing.js";');
    fs.writeFileSync(path.join(tmp, "popup.html"), '<script src="popup.js"></script>');
    fs.writeFileSync(path.join(tmp, "popup.js"), "console.log(1);");
    fs.writeFileSync(path.join(tmp, "server.js"), "// dev server");

    const res = verifyPackageFiles({
      rootDir: tmp,
      files: ["manifest.json", "background.js", "popup.html", "popup.js", "server.js"],
    });
    assert.equal(res.ok, false);
    assert.ok(res.errors.some((e) => e.includes("server.js")));
    assert.ok(res.errors.some((e) => e.includes("missing.js")));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("createZipBuffer produces a valid PKZIP archive with intact CRC32 and DEFLATE decompression", () => {
  const textPayload = Buffer.from("SwiftSelect Chrome Web Store test payload ".repeat(40), "utf-8");
  const tinyPayload = Buffer.from([1, 2, 3, 4]);
  const zip = createZipBuffer([
    { name: "manifest.json", data: textPayload },
    { name: "icons/tiny.bin", data: tinyPayload },
  ]);

  // Verify local header signature & EOCD signature
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const eocdOffset = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocdOffset > 0);
  assert.equal(zip.readUInt16LE(eocdOffset + 10), 2);

  // Verify first entry decompresses back identically with matching CRC-32
  const method = zip.readUInt16LE(8);
  const storedCrc = zip.readUInt32LE(14);
  const compSize = zip.readUInt32LE(18);
  const uncompSize = zip.readUInt32LE(22);
  const nameLen = zip.readUInt16LE(26);
  const dataStart = 30 + nameLen;
  const compData = zip.subarray(dataStart, dataStart + compSize);

  assert.equal(method, 8); // DEFLATE used on repetitive text
  assert.equal(uncompSize, textPayload.length);
  assert.equal(storedCrc, crc32(textPayload));
  assert.deepEqual(zlib.inflateRawSync(compData), textPayload);
});

test("real SwiftSelect workspace passes Chrome Web Store package verification cleanly", () => {
  const rootDir = path.resolve(import.meta.dirname, "..");
  const report = verifyPackageFiles({ rootDir, files: CHROME_STORE_FILES });
  assert.equal(report.ok, true, `Unexpected package verification errors: ${report.errors.join("; ")}`);
  assert.ok(report.included.some((f) => f.path === "manifest.json"));
  assert.ok(report.included.some((f) => f.path === "vendor/mazanoke/upng.js"));
  assert.equal(report.included.some((f) => f.path === "vendor/mazanoke/libheif.js"), false);
  assert.equal(report.included.some((f) => f.path === "vendor/mazanoke/utif.js"), false);
  assert.equal(report.included.some((f) => f.path === "vendor/mazanoke/browser-image-compression.js"), false);
  assert.equal(report.included.some((f) => f.path === "vendor/mazanoke/ico.js"), false);
  assert.ok(report.stats.totalUnpackedBytes < 2_200_000, `Unpacked extension grew unexpectedly: ${report.stats.totalUnpackedBytes} bytes`);
  assert.equal(report.included.some((f) => f.path === "server.js"), false);
  assert.equal(report.included.some((f) => f.path === "chrome-shim.js"), false);
  assert.equal(report.included.some((f) => f.path === "menu.html"), false);
  assert.match(explainExclusion("server.js"), /preview server/i);
  assert.match(explainExclusion("src/capture/region.js"), /bundled/i);
});
