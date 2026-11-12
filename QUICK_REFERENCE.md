# Quick Reference

A one-page sheet for working on SwiftSelect. Deeper explanations live in [ARCHITECTURE.md](ARCHITECTURE.md), [CAPTURE_ENGINE.md](CAPTURE_ENGINE.md) and [LOADING_SEQUENCE.md](LOADING_SEQUENCE.md).

<br>

## Build and run

```bash
npm run build           # CSS, then contentScript.js, then annotatePage.js
npm run build:css       # styles.css -> src/styles.min.css
npm run build:content   # src/contentScript.js -> contentScript.js
npm run build:annotate  # src/annotatePage.js -> annotatePage.js
npm run check           # node --check on every unbundled script
```

Load unpacked from `chrome://extensions/`, then use the reload button after each change. Service worker logs are under "Inspect views: service worker". The offscreen document appears in the same list while it is alive.

| You changed | Rebuild | Reload extension |
| :--- | :---: | :---: |
| `src/**` used in pages, `styles.css` | yes | yes |
| `src/settings.js`, `src/storage.js` | yes | yes |
| `background.js`, `offscreen.js`, `gallery.js`, `options.js`, `popup.js`, `src/pageKit.js`, `src/pageTheme.js` | no | yes |
| `pages.css`, `*.html` | no | refresh the page |

<br>

## Chrome commands (`manifest.json`)

| Command id | Default | macOS | Message sent to tab |
| :--- | :--- | :--- | :--- |
| `activate-selection` | <kbd>Alt</kbd>+<kbd>X</kbd> | <kbd>Ctrl</kbd>+<kbd>X</kbd> | `start-selection` |
| `capture-visible-download` | <kbd>Alt</kbd>+<kbd>S</kbd> | <kbd>Ctrl</kbd>+<kbd>S</kbd> | `capture-visible` |
| `capture-horizontal` | <kbd>Alt</kbd>+<kbd>H</kbd> | <kbd>Ctrl</kbd>+<kbd>H</kbd> | `capture-horizontal` |
| `capture-full-page` | <kbd>Alt</kbd>+<kbd>F</kbd> | <kbd>Ctrl</kbd>+<kbd>F</kbd> | `capture-full` |
| `capture-timer` | unassigned | unassigned | `capture-timer` |

Chrome binds at most four suggested shortcuts and skips any that collide. Read the real bindings with `chrome.commands.getAll()`.

<br>

## Context menu ids

| Id | Action |
| :--- | :--- |
| `ss-select-area`, `ss-capture-visible`, `ss-capture-timer`, `ss-capture-horizontal`, `ss-capture-full` | Start that capture |
| `ss-format-jpg`, `ss-format-png`, `ss-format-webp` | Set `outputFormat` |
| `ss-dest-both`, `ss-dest-clipboard`, `ss-dest-download`, `ss-dest-none` | Set `outputDestination` |
| `ss-theme-system`, `ss-theme-light`, `ss-theme-dark` | Set `userTheme` and broadcast `apply-theme` |
| `ss-gallery`, `ss-options`, `ss-help` | Open Gallery, Settings, Settings at `#shortcuts` |

<br>

## Runtime messages

Responses are `{ success, error? }` plus the fields listed.

### To the service worker

| `type` | Request fields | Response fields |
| :--- | :--- | :--- |
| `capture-visible-tab` | | `dataUrl` (PNG) |
| `start-fullpage-capture` | `mode`, `frameInterval`, `format` (MIME), `quality` | `dataUrl?`, `blobUrl?`, `abort?` |
| `write-image-to-clipboard` | `dataUrl` | |
| `fetch-blob-url` | `blobUrl` | `dataUrl` |
| `download-file` | `url`, `filename` | `downloadId` |
| `update-badge` | `text`, `color?` | none |
| `gallery-save` | `dataUrl`, `meta` | `id` |
| `gallery-save-chunk` | `key`, `index`, `total`, `chunk`, `meta?` (last chunk) | `id` (last chunk) |
| `run-capture` | `mode`, `tabId?` | `tabId`, or `error: "no-target"` |
| `open-gallery` | | |
| `open-settings` | `hash?` | |
| `open-annotate` | `id` | |
| `restore-tab-action` | | none |

```js
// meta
{ title: string, url: string, type: CaptureType, width: number, height: number }

// mode
"region" | "visible" | "full" | "horizontal" | "timer"

// CaptureType (stored in the gallery)
"region" | "visible" | "fullpage" | "horizontal" | "annotated" | "screenshot"
```

### To the content script

| `type` | Fields |
| :--- | :--- |
| `start-selection` | |
| `capture-visible`, `capture-download`, `capture-full`, `capture-horizontal`, `capture-timer` | |
| `show-help-modal`, `show-settings-modal` | |
| `fullpage-progress` | `progress`, `current`, `total` |
| `fullpage-action` | `action`: `unroll-page` \| `update-unroll` \| `restore-unroll`, `data` |
| `apply-theme` | `theme` |

### Worker and offscreen document

| Direction | `type` | Fields |
| :--- | :--- | :--- |
| worker → offscreen | `start-offscreen-capture` | `streamId`, `tabId`, `mode`, `frameInterval`, `format`, `quality` |
| worker → offscreen | `write-image-clipboard` | `dataUrl` |
| offscreen → worker | `offscreen-to-content` | `tabId`, `action`, `data` |
| offscreen → worker | `offscreen-progress` | `tabId`, `progress`, `current`, `total` |

### Other channels

| Channel | Payload | Purpose |
| :--- | :--- | :--- |
| `BroadcastChannel("swiftselect-gallery")` | `{ kind: "add" \| "update" \| "delete" \| "clear" \| "retention", id?, ids? }` | Gallery change notices between extension contexts |
| `runtime.connect({ name: "popup-lifecycle" })` | none | Lets the worker restore per-tab action state when the popup closes |

<br>

## Storage schemas

### `chrome.storage.local` (preferences)

Defined in `src/settings.js`. Always read through `getSettings()`, which normalises.

| Key | Type | Default | Values |
| :--- | :--- | :--- | :--- |
| `userTheme` | string | `"system"` | `system`, `light`, `dark` |
| `uiLanguage` | string | `"auto"` | `auto`, `en` |
| `outputFormat` | string | `"jpg"` | `png`, `jpg`, `webp` |
| `outputQuality` | number | `0.92` | 0.5 to 1.0 |
| `outputDestination` | string | `"both"` | `both`, `clipboard`, `download`, `none` |
| `saveToGallery` | boolean | `true` | |
| `captureDelay` | number | `0` | `0`, `3`, `5` |
| `filenameTemplate` | string | `"{title} - {type} - {date}-{time}"` | Tags below |
| `actionClick` | string | `"region"` | `region`, `menu` |
| `captureFlash` | boolean | `true` | Shutter flash after a capture |
| `toolbarShortcuts` | boolean | `false` | Single-key shortcuts while the capture toolbar is open |
| `editorShortcuts` | boolean | `false` | Tool keys and Ctrl shortcuts in the editor |
| `toolbarPosition` | `{ x, y }` | none | Where the capture toolbar was dragged, as fractions of the window |
| `retentionDays` | number | `90` | `0` (keep forever), `7`, `30`, `90`. Schema 4 moves existing installs from `0` to `90` once |
| `trashDays` | number | `30` | `7`, `30` |
| `settingsSchema` | number | `3` | Migration marker, written by the worker. Schema 3 sets `actionClick` to `region` and both shortcut switches off |

The Auto-copy and Auto-download switches are two views of `outputDestination`:

| Auto-copy | Auto-download | `outputDestination` |
| :---: | :---: | :--- |
| on | on | `both` |
| on | off | `clipboard` |
| off | on | `download` |
| off | off | `none` |

### Filename template tags

| Tag | Expands to | Example |
| :--- | :--- | :--- |
| `{date}` | Local date | `2026-11-11` |
| `{time}` | Local time | `17-41-05` |
| `{title}` | Page title, sanitised, 100 chars max | `Quarterly Report` |
| `{url}` | Hostname without `www.` | `example.com` |
| `{type}` | Capture type | `fullpage` |

The extension is appended automatically.

### `chrome.storage.session`

| Key | Value |
| :--- | :--- |
| `lastTab:<windowId>` | Id of the last capturable tab in that window |
| `lastTab` | Id of the last capturable tab overall |

### `localStorage` (extension origin)

| Key | Value |
| :--- | :--- |
| `ss-theme` | Mirror of `userTheme` for flash-free first paint |
| `ss-gallery-view` | `grid` or `list` |

### IndexedDB

```text
Database  swiftselect_db   version 1
Store     screenshots      keyPath "id", autoIncrement
Indexes   createdAt, type
```

| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | number | Auto-increment key |
| `blob` | Blob | Full image in its capture format |
| `thumb` | Blob \| null | WebP preview, at most 640 px wide, top-left of the image |
| `title` | string | Page title, 300 chars max |
| `url` | string | Page URL, 2000 chars max |
| `type` | string | `CaptureType`, or `imported` for images dropped or pasted into the gallery |
| `format` | string | `png`, `jpg`, `webp`, derived from `blob.type` |
| `width`, `height` | number | Device pixels |
| `size` | number | `blob.size + thumb.size`, in bytes |
| `createdAt` | number | Epoch milliseconds |
| `favorite` | boolean | Exempt from auto-delete |
| `deletedAt` | number | `0` when live; epoch milliseconds once moved to Trash |

Retention (`applyRetention`) runs in the worker at start-up, a few seconds after each capture and when the retention settings change, and in the gallery before its first paint. Captures older than `retentionDays` (not favorites) move to Trash; Trash older than `trashDays` is deleted. It is one cursor pass and never decodes an image.

<br>

## Module APIs

### `src/storage.js`

| Function | Returns |
| :--- | :--- |
| `addCapture({ blob, title, url, type, width, height, createdAt })` | Stored record with `id` |
| `listCaptures()` | Records, newest first |
| `getCapture(id)` | Record or `null` |
| `updateCapture(id, patch)` | Merges fields (rename) |
| `setFavorite(ids, value)` | |
| `trashCaptures(ids)`, `restoreCaptures(ids)` | Soft delete and restore |
| `deleteCaptures(ids)`, `deleteCapture(id)`, `emptyTrash()`, `clearCaptures()` | Permanent |
| `restoreCapture(record)` | Puts a full record back (undo of a permanent delete) |
| `applyRetention({ retentionDays, trashDays })` | `{ trashed, purged }` |
| `getStats()` | `{ count, bytes, trashCount, trashBytes }` |
| `makeThumbnail(blob, width?, height?)` | `{ thumb, width, height }` |
| `onGalleryChange(listener)` | Unsubscribe function |
| `isRecent(record)` | `true` within 24 hours |
| `formatBytes(n)` | `"59 KB"`, `"1.2 MB"` |

### `src/settings.js`

| Export | Purpose |
| :--- | :--- |
| `DEFAULTS`, `SETTING_KEYS` | Schema |
| `getSettings()`, `setSettings(patch)` | Normalised read, raw write |
| `normalizeSettings(raw)`, `normalizeTheme(value)` | Coercion |
| `formatInfo(format)` | `{ ext, mime }` |
| `wantsCopy(dest)`, `wantsDownload(dest)`, `destinationFromToggles(copy, download)` | Destination helpers |
| `buildFilename(template, { title, url, type, ext, date })` | Safe filename |

### `src/capture/deliver.js`

| Function | Purpose |
| :--- | :--- |
| `deliverCanvas(canvas, { type, flash, flashRect })` | Encode, copy, download, store, report |
| `saveToGallery(blob, meta, { force })` | Hand a capture to the worker. Never throws |

### `src/capture/annotate.js`

| Function | Purpose |
| :--- | :--- |
| `openAnnotationEditor(source?, { standalone, onClose, title, url })` | `source`: `Blob`, `HTMLImageElement`, URL string, or nothing to capture the visible tab |
| `closeAnnotationEditor()` | Tear down and call `onClose` |
| `isAnnotationOpen()` | |

Shape objects in the scene:

| `type` | Fields |
| :--- | :--- |
| `pen` | `points[{ x, y, p }]`, `color`, `lineWidth`, `opacity`, `pressure?`, `blend?` (`multiply` or `screen` for the highlighter) |
| `arrow` | `x1`, `y1`, `x2`, `y2`, `color`, `lineWidth`, `opacity` |
| `rect`, `ellipse` | `x1`, `y1`, `x2`, `y2`, `color`, `lineWidth`, `opacity`, `fill?` |
| `blur` | `x1`, `y1`, `x2`, `y2`, `fill?` (`true` for a solid bar) |
| `counter` | `x`, `y`, `number`, `color`, `opacity` |
| `text` | `x`, `y`, `text`, `fontSize`, `color`, `opacity`, `fill?` (background pill) |

Undo stack entries: `add`, `delete`, `edit` (move, resize, restyle), `edit-text`, `clear`, `crop`.

<br>

## DOM markers

| Marker | Meaning |
| :--- | :--- |
| `window.__swiftSelectInjected_v2` | Content bundle already initialised in this document |
| `window.SwiftSelect` | `{ theme, ui, events, capture }` |
| `.qs-shadow-host`, `[data-qs-role]` | A SwiftSelect shadow host |
| `#swiftselect-annotate-root` | The editor is open |
| `style[data-swiftselect-unroll]` | A stitched capture is in progress |
| `html[data-theme]`, `html[data-theme-pref]` | Resolved tone and stored preference on extension pages |

<br>

## Limits worth remembering

| Limit | Value | Handled in |
| :--- | :--- | :--- |
| Canvas side | 32,767 px (stream path clamps at 16,384) | `fullpage.js`, `offscreen.js` |
| Canvas area | 268,435,456 px | `fullpage.js`, `offscreen.js` |
| Compositor tiles before switching to the stream path | 12 | `fullpage.js` |
| Gallery message chunk | 8 MB of data URL text | `deliver.js` |
| Offscreen idle timeout | 30 s | `background.js` |
| Chunk reassembly timeout | 120 s | `background.js` |
| `captureVisibleTab` retries | 3, backing off from 600 ms | `region.js` |
