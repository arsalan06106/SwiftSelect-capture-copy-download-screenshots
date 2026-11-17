# Chrome Web Store assets

Rebuilds the store screenshots and promo tiles from the **real extension UI**,
so they can be refreshed whenever the toolbar, editor or gallery changes.

```bash
cd tools/store-assets
npm install        # once: puppeteer-core only, uses your installed Chrome
npm run build      # capture the UI, then compose the store images
```

Output goes to `Chrome Web Store assets/` at the repo root, overwriting the
files there.

## How it works

1. **`raw.mjs`** loads the unpacked extension (the repo root) into headless
   Chrome, serves the fictional demo sites in `site/` on `localhost:8765`, seeds
   the gallery with captures of them, then drives the extension. It opens the
   toolbar, drags a region, Ctrl-snaps a card, opens the panel tabs, draws in
   the annotate editor, and opens the gallery and quick menu. Each state is
   saved as a 2× PNG in `out/`.
2. **`render.mjs`** places those captures into `templates/compose.html`
   (1280×800 screenshots) and `templates/promo.html` (440×280 and 1400×560
   tiles) and screenshots them at their exact store sizes.

Run part of it:

```bash
node raw.mjs annotate,panel   # only some states: region, smart, panel,
                              # gallery, popup, annotate, toolbar
node render.mjs annotate      # only outputs whose filename contains "annotate"
```

Headlines, captions and accent colours live in the `L` table in
`templates/compose.html`.

## Notes

- Chrome path defaults to `/usr/bin/google-chrome`. Override with
  `CHROME_PATH=...`. The output folder can be overridden with `ASSETS_DIR=...`.
- The run uses its own temporary Chrome profile, so your real gallery and
  settings are never touched. Captures use the Light theme and Calm colour.
- The demo sites (Northbound, Tally, Saltmarsh Kitchen) and the email in the
  annotate shot are made up.
- The quick-menu (popup) shot treats the demo tab as the active tab. Without
  that, the popup shows its "can't capture this page" notice.
- The Chrome Web Store accepts at most 5 screenshots and this builds 6. Choose
  which 5 to upload.
- If you package the extension by zipping the repo, leave `tools/` out.
