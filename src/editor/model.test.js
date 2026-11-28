import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FILTERS,
  TEMPLATES,
  createDocument,
  buildFilterString,
  isDefaultFilters,
  computeCanvasLayout,
  addLayer,
  removeLayer,
  reorderLayer,
  duplicateLayer,
  toggleLayerVisibility,
  toggleLayerLock,
  hitTestLayers,
  hitTestHandle,
  applyTemplateToDoc,
  createHistory,
} from "./model.js";

test("computeCanvasLayout handles single image, side-by-side stitch, stacked stitch, and 16:9 ratio", () => {
  const doc = createDocument();
  doc.baseImages.push({ assetId: "a1", name: "Shot 1", width: 1000, height: 600 });
  doc.frame.padding = 5;
  doc.frame.aspectRatio = "auto";

  const single = computeCanvasLayout(doc);
  assert.equal(single.slots.length, 1);
  assert.equal(single.contentRect.width, 1000);
  assert.equal(single.contentRect.height, 600);
  assert.equal(single.totalWidth, 1000 + single.padPx * 2);
  assert.equal(single.totalHeight, 600 + single.padPx * 2);

  // Add second image with different height -> side-by-side normalizes height to first image (600)
  doc.baseImages.push({ assetId: "a2", name: "Shot 2", width: 600, height: 1200 });
  doc.frame.stitchLayout = "side-by-side";
  const side = computeCanvasLayout(doc);
  assert.equal(side.slots.length, 2);
  assert.equal(side.slots[0].height, 600);
  assert.equal(side.slots[1].height, 600);
  assert.equal(side.slots[1].width, 300);
  assert.ok(side.contentRect.width > 1300);

  // Stacked layout normalizes width to first image (1000)
  doc.frame.stitchLayout = "stacked";
  const stacked = computeCanvasLayout(doc);
  assert.equal(stacked.slots[0].width, 1000);
  assert.equal(stacked.slots[1].width, 1000);
  assert.equal(stacked.slots[1].height, 2000);

  // Window chrome increases card height cleanly
  doc.frame.windowStyle = "macos-dark";
  const withChrome = computeCanvasLayout(doc);
  assert.ok(withChrome.chromeTop >= 28);
  assert.equal(withChrome.cardRect.height, withChrome.contentRect.height + withChrome.chromeTop);

  // Aspect ratio 16:9 expands outer canvas while keeping content centered
  doc.baseImages.pop();
  doc.frame.windowStyle = "none";
  doc.frame.aspectRatio = "16:9";
  const wide = computeCanvasLayout(doc);
  assert.ok(Math.abs(wide.totalWidth / wide.totalHeight - 16 / 9) < 0.02);
});

test("buildFilterString generates exact CSS filters and detects defaults", () => {
  assert.equal(buildFilterString(DEFAULT_FILTERS), "none");
  assert.equal(isDefaultFilters(DEFAULT_FILTERS), true);

  const custom = { ...DEFAULT_FILTERS, brightness: 112, contrast: 120, saturation: 80, warmth: 25, hue: -10, grayscale: 50, blur: 2 };
  assert.equal(isDefaultFilters(custom), false);
  const str = buildFilterString(custom);
  assert.match(str, /brightness\(112%\)/);
  assert.match(str, /contrast\(120%\)/);
  assert.match(str, /saturate\(80%\)/);
  assert.match(str, /sepia\(25%\)/);
  assert.match(str, /hue-rotate\(-10deg\)/);
  assert.match(str, /grayscale\(50%\)/);
  assert.match(str, /blur\(2\.0px\)/);
});

test("layer stack supports add, reorder, visibility, lock, duplicate, hit-test, and delete", () => {
  const doc = createDocument();
  const l1 = addLayer(doc, { type: "rect", x: 100, y: 100, width: 200, height: 120, color: "#FF3333" });
  const l2 = addLayer(doc, { type: "arrow", x1: 50, y1: 50, x2: 250, y2: 50, color: "#007AFF", lineWidth: 6 });
  const l3 = addLayer(doc, { type: "counter", x: 150, y: 150, number: 1, color: "#10B981" });

  assert.equal(doc.layers.length, 3);
  assert.equal(doc.selectedLayerId, l3.id);
  assert.equal(doc.stepCounter, 2);

  // Hit-testing returns topmost visible unlocked layer
  assert.equal(hitTestLayers(doc, 150, 150)?.id, l3.id);
  toggleLayerVisibility(doc, l3.id);
  assert.equal(hitTestLayers(doc, 150, 150)?.id, l1.id);

  // Locking prevents hit-testing
  toggleLayerLock(doc, l1.id);
  assert.equal(hitTestLayers(doc, 150, 150), null);
  toggleLayerLock(doc, l1.id);

  // Resize handle hit-testing on box and arrow
  assert.equal(hitTestHandle(l1, 100, 100)?.id, "tl");
  assert.equal(hitTestHandle(l2, 250, 50)?.id, "end");

  // Reorder layer up/down/front/back
  assert.equal(reorderLayer(doc, l1.id, "front"), true);
  assert.equal(doc.layers[2].id, l1.id);
  assert.equal(reorderLayer(doc, l1.id, "back"), true);
  assert.equal(doc.layers[0].id, l1.id);

  // Duplicate increments step counter when duplicating counter
  const dup = duplicateLayer(doc, l3.id, 30);
  assert.ok(dup);
  assert.equal(dup.number, 2);
  assert.equal(doc.layers.length, 4);

  // Delete updates selection
  assert.equal(removeLayer(doc, dup.id), true);
  assert.equal(doc.layers.length, 3);
});

test("templates apply cleanly without erasing user annotations and history undoes/redoes with coalescing", () => {
  const doc = createDocument();
  doc.baseImages.push({ assetId: "b1", name: "Hero", width: 1200, height: 800 });
  const userLayer = addLayer(doc, { type: "rect", x: 40, y: 40, width: 100, height: 100 });

  const history = createHistory(doc);

  // Apply template that injects template typography layers
  assert.equal(applyTemplateToDoc(doc, "changelog-card"), true);
  assert.equal(doc.frame.windowStyle, "browser");
  assert.equal(doc.frame.aspectRatio, "16:9");
  assert.ok(doc.layers.some((l) => l.id === userLayer.id));
  assert.ok(doc.layers.some((l) => l.fromTemplate));
  history.push(doc, "template");

  // Switching template replaces previous template layers only
  assert.equal(applyTemplateToDoc(doc, "before-after"), true);
  assert.equal(doc.layers.filter((l) => l.fromTemplate).length, 2);
  assert.ok(doc.layers.some((l) => l.id === userLayer.id));
  history.push(doc, "template2");

  // Rapid slider edits with same coalesceKey collapse into one undo step
  doc.frame.padding = 12;
  history.push(doc, "frame:padding", 1000);
  doc.frame.padding = 15;
  history.push(doc, "frame:padding", 1200);
  doc.frame.padding = 18;
  history.push(doc, "frame:padding", 1350);

  assert.equal(history.depth, 3);
  const afterUndo = history.undo();
  assert.equal(afterUndo.frame.padding, 8); // back to before-after template default
  const afterRedo = history.redo();
  assert.equal(afterRedo.frame.padding, 18);
  assert.ok(TEMPLATES.length >= 8);
});
