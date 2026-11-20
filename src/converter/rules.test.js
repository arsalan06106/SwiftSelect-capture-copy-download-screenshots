import test from "node:test";
import assert from "node:assert/strict";
import {
  detectInputMime,
  isSupportedImageFile,
  resolveOutputSpec,
  computeTargetDimensions,
  validateTargetWeight,
  computeTargetMaxSizeMB,
  normalizePrefs,
  renameBrowserDefaultFileName,
  isGenericImageName,
  formatConverterFilename,
  uniqueOutputNames,
  computeSavings,
  buildZipBytes,
  pngColorCountFromQuality,
  describePngQuality,
  shouldGuardSameFormatBloat,
  isPhotoToPngExpansion,
  ICO_MAX_EDGE,
} from "./rules.js";
import { sanitizeDownloadFilename, extFromBlob } from "../downloadFile.js";

test("detectInputMime handles standard and exotic formats even with missing MIME", () => {
  assert.equal(detectInputMime({ name: "photo.HEIC", type: "" }), "image/heic");
  assert.equal(detectInputMime({ name: "scan.tif", type: "application/octet-stream" }), "image/tiff");
  assert.equal(detectInputMime({ name: "favicon.ico", type: "" }), "image/vnd.microsoft.icon");
  assert.equal(detectInputMime({ name: "vector.svg", type: "image/svg+xml" }), "image/svg+xml");
  assert.equal(detectInputMime({ name: "shot.jpg", type: "image/jpg" }), "image/jpeg");
  assert.equal(isSupportedImageFile({ name: "photo.heic", type: "" }), true);
  assert.equal(isSupportedImageFile({ name: "notes.pdf", type: "application/pdf" }), false);
});

test("resolveOutputSpec handles auto fallback and ICO post-processing", () => {
  const autoHeic = resolveOutputSpec("image/heic", "auto");
  assert.equal(autoHeic.outputMime, "image/png");
  assert.equal(autoHeic.ext, "png");
  assert.equal(autoHeic.isLossy, false);

  const autoJpg = resolveOutputSpec("image/jpeg", "auto");
  assert.equal(autoJpg.outputMime, "image/jpeg");
  assert.equal(autoJpg.ext, "jpg");
  assert.equal(autoJpg.isLossy, true);
  assert.equal(autoJpg.needsOpaqueBg, true);

  const toIco = resolveOutputSpec("image/png", "ico");
  assert.equal(toIco.ext, "ico");
  assert.equal(toIco.intermediateMime, "image/png");
  assert.equal(toIco.needsIcoPostProcess, true);
});

test("computeTargetDimensions preserves aspect ratio, never upscales, and caps ICO at 256px", () => {
  assert.deepEqual(computeTargetDimensions(1920, 1080, { resize: "none" }, "jpg"), [1920, 1080]);
  assert.deepEqual(computeTargetDimensions(1920, 1080, { resize: "fit", maxW: 960, maxH: 960 }, "jpg"), [960, 540]);
  // Never enlarges smaller images
  assert.deepEqual(computeTargetDimensions(400, 300, { resize: "fit", maxW: 1920, maxH: 1920 }, "jpg"), [400, 300]);
  // Scale mode
  assert.deepEqual(computeTargetDimensions(1000, 500, { resize: "scale", scale: 50 }, "webp"), [500, 250]);
  // Extreme aspect ratio never produces 0px edge
  const [narrowW, narrowH] = computeTargetDimensions(5000, 10, { resize: "fit", maxW: 100, maxH: 100 }, "png");
  assert.equal(narrowW, 100);
  assert.ok(narrowH >= 1);
  // ICO max dimension cap
  const [icoW, icoH] = computeTargetDimensions(1024, 512, { resize: "none" }, "ico");
  assert.equal(icoW, ICO_MAX_EDGE);
  assert.equal(icoH, 128);
});

test("validateTargetWeight and computeTargetMaxSizeMB clamp safely", () => {
  assert.equal(validateTargetWeight(500, "KB").value, 500);
  assert.equal(validateTargetWeight(2, "KB").clamped, true);
  assert.equal(validateTargetWeight(2, "KB").value, 10);
  assert.equal(validateTargetWeight(250, "MB").value, 100);
  assert.ok(Math.abs(computeTargetMaxSizeMB({ targetWeight: 512, targetWeightUnit: "KB" }) - 0.5) < 1e-6);
  assert.equal(computeTargetMaxSizeMB({ targetWeight: 2, targetWeightUnit: "MB" }), 2);
});

test("normalizePrefs, naming, and savings behave deterministically", () => {
  const prefs = normalizePrefs({ format: "ico", compressMethod: "limitWeight", quality: 5, suffix: " - web/?" });
  assert.equal(prefs.format, "ico");
  assert.equal(prefs.compressMethod, "limitWeight");
  assert.equal(prefs.quality, 10);
  assert.equal(prefs.suffix, " - web");
  assert.equal(prefs.namingMode, "template");

  const pasted = renameBrowserDefaultFileName("image.png", "A1B2");
  assert.equal(pasted.isBrowserDefault, true);
  assert.equal(pasted.renamedFileName, "image-A1B2.png");

  const normal = renameBrowserDefaultFileName("dashboard.png", "A1B2");
  assert.equal(normal.isBrowserDefault, false);
  assert.equal(normal.renamedFileName, "dashboard.png");

  const names = uniqueOutputNames(
    [
      { name: "hero", outExt: "webp" },
      { name: "hero", outExt: "webp" },
      { name: "hero", outExt: "png" },
    ],
    "-opt",
  );
  assert.deepEqual(names, ["hero-opt.webp", "hero-opt (2).webp", "hero-opt.png"]);

  assert.deepEqual(computeSavings(1000, 250), { pct: 75, direction: "smaller", label: "−75%" });
  assert.deepEqual(computeSavings(1000, 1200), { pct: 20, direction: "larger", label: "+20%" });
});

test("Naming Engine integration formats meaningful and generic image names cleanly", () => {
  assert.equal(isGenericImageName("download.jpg"), true);
  assert.equal(isGenericImageName("download (2).png"), true);
  assert.equal(isGenericImageName("image (1).jpg"), true);
  assert.equal(isGenericImageName("hero-banner.png"), false);

  const fixedDate = new Date(2026, 10, 20, 9, 5, 30);
  const template = "{title} - {type} - {date}-{time}";

  // Meaningful source name preserves title in the Naming Engine
  const named = formatConverterFilename(
    { name: "hero-banner", outExt: "webp", addedAt: fixedDate.getTime() },
    { namingMode: "template", template, suffix: "", ext: "webp", date: fixedDate },
  );
  assert.equal(named, "hero-banner - converted - 2026-11-20-09-05-30.webp");

  // Generic browser names like "download" or "image (1)" never leak "download" into output
  const fromGeneric = formatConverterFilename(
    { name: "download", outExt: "jpg", addedAt: fixedDate.getTime() },
    { namingMode: "template", template, suffix: "", ext: "jpg", date: fixedDate },
  );
  assert.equal(fromGeneric, "converted - 2026-11-20-09-05-30.jpg");
  assert.ok(!fromGeneric.toLowerCase().includes("download"));

  // Underscore-separated custom templates collapse empty tags cleanly without "__"
  const customTpl = formatConverterFilename(
    { name: "download", outExt: "jpg", addedAt: fixedDate.getTime() },
    { namingMode: "template", template: "Swift_{title}_{type}", suffix: "", ext: "jpg", date: fixedDate },
  );
  assert.equal(customTpl, "Swift_converted.jpg");

  // Batch collision deduplication in template mode
  const batch = uniqueOutputNames(
    [
      { name: "image (1)", outExt: "jpg", addedAt: fixedDate.getTime() },
      { name: "download", outExt: "jpg", addedAt: fixedDate.getTime() },
    ],
    "-min",
    { namingMode: "template", template, date: fixedDate },
  );
  assert.deepEqual(batch, [
    "converted - 2026-11-20-09-05-30-min.jpg",
    "converted - 2026-11-20-09-05-30-min (2).jpg",
  ]);

  // Original mode preserves exact source name + suffix
  const orig = formatConverterFilename(
    { name: "logo-mark", outExt: "png" },
    { namingMode: "original", suffix: "-2x", ext: "png" },
  );
  assert.equal(orig, "logo-mark-2x.png");
});

test("sanitizeDownloadFilename and extFromBlob guard against empty, reserved, and illegal filenames", () => {
  assert.equal(sanitizeDownloadFilename("", "jpg"), "SwiftSelect-image.jpg");
  assert.equal(sanitizeDownloadFilename(".../bad:name?.webp", "png"), "bad name.webp");
  assert.equal(sanitizeDownloadFilename("CON.png", "png"), "SwiftSelect-image.png");
  assert.equal(sanitizeDownloadFilename("hero - converted - 2026-11-20", "webp"), "hero - converted - 2026-11-20.webp");
  assert.equal(extFromBlob({ type: "image/jpeg" }), "jpg");
  assert.equal(extFromBlob({ type: "image/vnd.microsoft.icon" }), "ico");
  assert.equal(extFromBlob({ type: "application/zip" }), "zip");
});

test("buildZipBytes generates a valid PKZIP archive with local headers and EOCD", async () => {
  const zip = await buildZipBytes([
    { name: "a.txt", bytes: new Uint8Array([1, 2, 3, 4]) },
    { name: "b.txt", bytes: new Uint8Array([5, 6, 7]) },
  ]);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // Local file header signature
  assert.equal(view.getUint32(0, true), 0x04034b50);
  // End of central directory signature at end - 22
  assert.equal(view.getUint32(zip.byteLength - 22, true), 0x06054b50);
  // Entry count = 2
  assert.equal(view.getUint16(zip.byteLength - 14, true), 2);
});

test("PNG quantization mapping, bloat guard, and photo-to-PNG detection work as expected", () => {
  assert.equal(pngColorCountFromQuality(100), 0);
  assert.equal(describePngQuality(100), "Lossless");
  assert.equal(pngColorCountFromQuality(92), 256);
  assert.equal(describePngQuality(92), "256 colors");
  assert.ok(pngColorCountFromQuality(80) > 128 && pngColorCountFromQuality(80) < 256);
  assert.ok(pngColorCountFromQuality(60) >= 64 && pngColorCountFromQuality(60) <= 128);
  assert.equal(pngColorCountFromQuality(10), 16);

  assert.equal(shouldGuardSameFormatBloat("image/jpeg", "image/jpeg", false, 85), true);
  assert.equal(shouldGuardSameFormatBloat("image/jpeg", "image/jpeg", true, 85), false);
  assert.equal(shouldGuardSameFormatBloat("image/jpeg", "image/jpeg", false, 100), false);
  assert.equal(shouldGuardSameFormatBloat("image/jpeg", "image/png", false, 85), false);

  assert.equal(isPhotoToPngExpansion("image/jpeg", "image/png", 163000, 320000), true);
  assert.equal(isPhotoToPngExpansion("image/jpeg", "image/png", 163000, 150000), false);
  assert.equal(isPhotoToPngExpansion("image/png", "image/png", 163000, 320000), false);
  assert.equal(isPhotoToPngExpansion("image/jpeg", "image/webp", 163000, 320000), false);
});
