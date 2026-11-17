// Composes the raw UI captures in out/ into the store images.
// Usage: node render.mjs            → every asset into "Chrome Web Store assets/"
//        node render.mjs annotate   → only jobs whose name contains "annotate"
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { CHROME, EXT } from './lib.mjs';
const HERE = new URL('.', import.meta.url);
const DEST = process.env.ASSETS_DIR || path.join(EXT, 'Chrome Web Store assets');
const JOBS = [
  ['compose', 'region',   1280, 800, 'screenshot-1-toolbar-region-1280x800.png'],
  ['compose', 'panel',    1280, 800, 'screenshot-2-toolbar-gallery-1280x800.png'],
  ['compose', 'smart',    1280, 800, 'screenshot-3-smart-element-1280x800.png'],
  ['compose', 'annotate', 1280, 800, 'screenshot-4-annotate-1280x800.png'],
  ['compose', 'gallery',  1280, 800, 'screenshot-5-gallery-1280x800.png'],
  ['compose', 'settings', 1280, 800, 'screenshot-6-quick-settings-1280x800.png'],
  ['promo',   'small',    440,  280, 'promo-tile-small-440x280.png'],
  ['promo',   'marquee',  1400, 560, 'promo-tile-marquee-1400x560.png'],
];
const filter = process.argv[2];
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--force-color-profile=srgb', '--allow-file-access-from-files'] });
for (const [tpl, hash, w, h, out] of JOBS) {
  if (filter && !out.includes(filter)) continue;
  const p = await b.newPage();
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await p.goto(new URL(`templates/${tpl}.html#${hash}`, HERE).href, { waitUntil: 'networkidle0' });
  await p.evaluate(() => { document.documentElement.style.setProperty('--w', innerWidth + 'px'); document.documentElement.style.setProperty('--h', innerHeight + 'px'); });
  await p.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 300));
  await p.screenshot({ path: path.join(DEST, out) });
  await p.close();
  console.log('wrote', out);
}
await b.close();
