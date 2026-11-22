import test from "node:test";
import assert from "node:assert/strict";
import {
  CWS_V2_ASSETS,
  CWS_MAX_SCREENSHOTS,
  inspectPngBuffer,
  validateAssetManifest,
} from "./spec.mjs";

function makeFakePng(width, height, colorType = 2, bitDepth = 8) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = bitDepth;
  buf[25] = colorType;
  return buf;
}

test("CWS v2 asset manifest satisfies Chrome Web Store slot rules", () => {
  const report = validateAssetManifest(CWS_V2_ASSETS);
  assert.equal(report.ok, true, report.errors.join("; "));
  assert.equal(report.counts.icon, 1);
  assert.equal(report.counts.promo, 2);
  assert.equal(report.counts.screenshot, CWS_MAX_SCREENSHOTS);
  assert.equal(report.counts.video, 1);
  assert.equal(report.counts.total, 9);
});

test("validateAssetManifest rejects more than 5 screenshots", () => {
  const extra = [
    ...CWS_V2_ASSETS,
    {
      id: "shot-6-extra",
      category: "screenshot",
      filename: "screenshot-6-extra.png",
      width: 1280,
      height: 800,
      allowAlpha: false,
      kind: "image",
    },
  ];
  const report = validateAssetManifest(extra);
  assert.equal(report.ok, false);
  assert.match(report.errors[0], /allows 1\.\.5 screenshots/);
});

test("inspectPngBuffer accurately detects dimensions and RGB vs RGBA alpha channel", () => {
  const rgb = inspectPngBuffer(makeFakePng(1280, 800, 2));
  assert.equal(rgb.width, 1280);
  assert.equal(rgb.height, 800);
  assert.equal(rgb.hasAlpha, false);

  const rgba = inspectPngBuffer(makeFakePng(128, 128, 6));
  assert.equal(rgba.width, 128);
  assert.equal(rgba.height, 128);
  assert.equal(rgba.hasAlpha, true);
});
