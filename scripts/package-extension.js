#!/usr/bin/env node
/**
 * Build and verify the Chrome Web Store release package for SwiftSelect.
 *
 * Usage:
 *   npm run package          -> builds bundles, verifies allowlist, writes dist/unpacked/ + dist/*.zip
 *   npm run package:verify   -> audits workspace & verifies all extension runtime references (dry run)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROME_STORE_FILES, verifyPackageFiles, createZipBuffer } from "./package-manifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const verifyOnly = process.argv.includes("--verify-only");

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const report = verifyPackageFiles({ rootDir, files: CHROME_STORE_FILES });

if (!report.ok) {
  console.error("\nChrome Web Store package verification FAILED:\n");
  for (const err of report.errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

const zipFilename = `swiftselect-v${report.version}-chrome-web-store.zip`;

if (verifyOnly) {
  console.log(`\nSwiftSelect v${report.version} — Chrome Web Store Package Verification PASSED`);
  console.log(`Included runtime files (${report.stats.includedCount}, ${fmtBytes(report.stats.totalUnpackedBytes)} unpacked):`);
  for (const item of report.included) {
    console.log(`  [+] ${item.path.padEnd(46)} ${fmtBytes(item.bytes)}`);
  }
  console.log(`\nExcluded workspace files (${report.stats.excludedCount}):`);
  for (const item of report.excluded) {
    console.log(`  [-] ${item.path.padEnd(46)} ${item.reason}`);
  }
  process.exit(0);
}

const distDir = path.join(rootDir, "dist");
const unpackedDir = path.join(distDir, "unpacked");
const zipPath = path.join(distDir, zipFilename);
const manifestReportPath = path.join(distDir, "PACKAGE_CONTENTS.txt");

// Clean previous dist artifacts
fs.rmSync(unpackedDir, { recursive: true, force: true });
fs.mkdirSync(unpackedDir, { recursive: true });

// Copy ONLY verified allowlisted runtime files to dist/unpacked/ and pack into ZIP
const zipEntries = [];
for (const item of report.included) {
  const srcAbs = path.join(rootDir, item.path);
  const dstAbs = path.join(unpackedDir, item.path);
  fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
  fs.copyFileSync(srcAbs, dstAbs);

  const stat = fs.statSync(srcAbs);
  zipEntries.push({
    name: item.path,
    data: fs.readFileSync(srcAbs),
    mtime: stat.mtime,
  });
}

const zipBuffer = createZipBuffer(zipEntries);
fs.writeFileSync(zipPath, zipBuffer);

// Write a clean human-readable audit file alongside the ZIP (NOT inside the ZIP)
const lines = [
  `SwiftSelect v${report.version} — Chrome Web Store Release Package`,
  `ZIP archive: dist/${zipFilename} (${fmtBytes(zipBuffer.length)})`,
  `Unpacked dir: dist/unpacked/ (${fmtBytes(report.stats.totalUnpackedBytes)})`,
  `Verification: PASSED (${report.stats.includedCount} files included, 0 broken refs, 0 dev files)`,
  "",
  "=== INCLUDED IN CHROME WEB STORE ZIP ===",
  ...report.included.map((f) => `  [INCLUDE] ${f.path.padEnd(46)} ${fmtBytes(f.bytes)}`),
  "",
  "=== EXCLUDED FROM CHROME WEB STORE ZIP ===",
  ...report.excluded.map((f) => `  [EXCLUDE] ${f.path.padEnd(46)} ${f.reason}`),
  "",
];
fs.writeFileSync(manifestReportPath, lines.join("\n"), "utf-8");

console.log(`\nSwiftSelect v${report.version} Chrome Web Store package ready!`);
console.log(`  ZIP (upload to Chrome Web Store): dist/${zipFilename} (${fmtBytes(zipBuffer.length)})`);
console.log(`  Unpacked (chrome://extensions):   dist/unpacked/ (${report.stats.includedCount} files, ${fmtBytes(report.stats.totalUnpackedBytes)})`);
console.log(`  Audit report:                     dist/PACKAGE_CONTENTS.txt`);
