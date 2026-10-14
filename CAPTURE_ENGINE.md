# Capture Engine

SwiftSelect supports three capture modes. Each uses a different pipeline internally.

<br>

## Region Capture

Triggered when the user draws a selection box on the page.

### Pipeline

1. User drags to create a rectangle. `events.js` tracks pointer coordinates and updates the selection box in real time via `requestAnimationFrame`.
2. On `pointerup`, the selection rectangle (in viewport coordinates) is passed to `captureAndCrop()` in `region.js`.
3. `captureAndCrop()` sends a `capture-visible-tab` message to `background.js`.
4. `background.js` calls `chrome.tabs.captureVisibleTab()`, which returns a full-viewport PNG as a data URL.
5. The data URL is loaded into an `Image`, drawn onto a `<canvas>`, then cropped to the selection rectangle using `drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh)`.
6. The cropped canvas is converted to a PNG blob.
7. The blob is written to the clipboard via `navigator.clipboard.write()`.

### DPR Handling

Screen coordinates are multiplied by `window.devicePixelRatio` when mapping to the captured image, because `captureVisibleTab` captures at native resolution.

### Clipboard Fallback

If `navigator.clipboard.write()` fails (some pages block it), the extension falls back to an automatic file download and shows a status message indicating the clipboard was blocked.

<br>

## Visible Area Capture

Triggered via the toolbar eye button or `Alt+S` shortcut.

Captures strictly what is currently displayed on screen:

1. The UI is hidden (toolbar, overlay, highlighter all set to `display: none`).
2. A brief delay (`requestAnimationFrame` + 100ms) ensures the browser finishes painting without the extension UI.
3. `captureVisibleTab()` grabs the viewport, and native browser scrollbars are mathematically cropped out.
4. The result is copied to clipboard AND automatically saved/downloaded.

<br>

## Horizontal View Capture

Triggered via the toolbar wide-screen button (`[ <-> ]`) or `Alt+H`.

Captures the current visible vertical section expanded across the entire horizontal content width (ideal for wide tables, spreadsheets, or zoomed-in pages) while fully preserving `position: fixed` and `position: sticky` sidebars/headers (such as Twitter/X feeds and dashboards):

1. Measures `measureFullContentWidth()`. If the page does not overflow horizontally (`contentWidth <= window.innerWidth + 5`), unroll CSS and transforms are completely bypassed, preventing any vertical shifts or containing block dislocations for fixed sidebars.
2. When horizontal overflow exists, only horizontal unrolling is applied (`translate3d(var(--scroll-left), 0px, 0px)` with `neutralizeStickyElements()` locking fixed sidebars to their current viewport positions).
3. The offscreen document traverses horizontal coordinate tiles across the width with zero vertical shift (`scrollTop: 0`).
4. Tiles are stitched onto a panoramic canvas of size `rectWidth × innerHeight` (in device pixels).
5. The result is copied to clipboard AND downloaded instantly with zero artificial UI delays.

<br>

## Full-Page Capture

Triggered via the toolbar scroll button or `Alt+F` shortcut. This is the most complex pipeline.

### Why Not Just ScrollY + CaptureVisibleTab?

Calling `captureVisibleTab` in a loop while scrolling with `window.scrollTo()` sounds straightforward, but it breaks on:

- SPAs that use internal scroll containers instead of the document body
- Pages with sticky/fixed headers and footers that appear in every frame
- Lazy-loaded content that has not rendered yet at scroll positions
- Canvas-heavy pages where `captureVisibleTab` timing is unpredictable

SwiftSelect solves these with a scroll-unroll + tab-capture-stream approach.

### Pipeline

1. `fullpage.js` sends `start-fullpage-capture` to `background.js`.
2. `background.js` creates an offscreen document (`offscreen.html` + `offscreen.js`) if one does not exist.
3. `offscreen.js` starts a `tabCapture` media stream via `chrome.tabCapture.getMediaStreamId()` → `navigator.mediaDevices.getUserMedia()`.
4. An `ImageCapture` instance is created from the video track.

### Sticky Element Neutralisation

Before scrolling begins, `fullpage.js` runs `neutralizeStickyElements()`:

- A `TreeWalker` scans every element on the page.
- Any element with `position: fixed` or `position: sticky` is converted to `position: absolute` at its current document-relative coordinates.
- Original styles are saved so they can be restored after capture.

This prevents headers, navbars, and floating buttons from appearing in every captured frame.

### The 2D Scroll-and-Stitch Matrix Loop

1. The page is unrolled in 2D: overflow is set to visible, both content height and width (including horizontal scrollbars when zoomed in or on wide layouts) are measured.
2. The offscreen document navigates a 2D grid of `(x, y)` coordinate tiles across both dimensions by updating `--scroll-top` and `--scroll-left` via the content script.
3. For each tile, after repaint, `ImageCapture.grabFrame()` captures the current frame.
4. A `FrameDetector` class downsamples each frame to 10×10 pixels and compares it to the previous frame to confirm the browser has actually repainted. If the frame is identical, it retries.
5. Each tile is converted to a blob and stored with its 2D coordinates `(dx, dy)`.
6. Progress is reported back to the content script, which updates the on-page progress indicator and the extension badge.

### Stitching & Canvas Safety

After all tiles are captured:

1. A 2D canvas is created matching the full content width and height (`rectWidth × rectHeight` in device pixels).
2. **Safety Clamping**: Chromium limits HTML5 canvases to 16,384px per side and 268,435,456 total pixels. If an exceptionally large page exceeds these bounds, `offscreen.js` computes an exact `scaleRatio` and applies `ctx.scale(scaleRatio, scaleRatio)`, safeguarding against browser engine crashes.
3. Each tile is drawn at its corresponding `(dx, dy)` offsets with boundary snapping on final rows and columns, and `imageSmoothingEnabled = false` for 1:1 pixel fidelity.
4. **Lossless PNG Export**: Both Horizontal View and Full-page captures export to pristine lossless PNG (`.png`), preserving text sharpness with zero compression blur or artifacts.
5. The blob is downloaded as a file and copied to clipboard where supported.

### Cleanup

After capture (success or failure):

- Sticky elements are restored to their original styles.
- The unroll styles are removed and scroll position is restored inside `requestAnimationFrame`.
- The offscreen document is closed.
- The progress UI and badge are cleared.

<br>

## Shortcuts & In-Session Hotkeys

- **Global Shortcuts**:
  - `Alt+X`: Activate selection mode
  - `Alt+S`: Capture visible area & download
  - `Alt+H`: Capture horizontal view & download
  - `Alt+F`: Capture full page & download
- **In-Session Hotkeys** (when toolbar overlay is open):
  - `Alt+S` or `S` / `V`: Capture & Copy Visible Area
  - `Alt+H` or `H`: Capture & Copy Horizontal View
  - `Alt+F` or `F`: Capture & Save Full Page
  - `Escape`: Cancel selection
  - `Space`: Hold to pan selection box
  - `Ctrl` / `Cmd`: Snapping highlight toggle

<br>

## Custom Floating Tooltips

Hovering over an action button on the floating toolbar for ~1600ms triggers a clean, floating liquid-glass card (without obstructive triangle indicators) featuring:
- Button title and purpose
- Action description (clarifying horizontal panoramic capture vs visible area)
- Keyboard shortcut pill badge
- Liquid glass styling with specular highlights and adaptive dark mode

<br>

## Badge & Tab State System

The extension monitors tab activation and navigation in `background.js`:
- **Active Capture Progress**: Displays pure white text on royal blue (`#2563EB`) during tiling, immediately swapping to `✓` on emerald green (`#10B981`) upon completion, auto-clearing after 1.5 seconds.
- **Restricted Sites** (`chrome://`, `edge://`, `about:`, Web Store): Extension icon remains visually clean (no alarming red badge); clicking the icon opens an explanatory guidance card.
- **File URLs** (`file://`): If "Allow access to file URLs" is disabled in Chrome settings, displays an amber `FILE` badge. Clicking the icon opens a direct "Open Settings" prompt.
- **Normal Web Pages**: Clean icon with zero badge overhead, launching selection mode immediately upon click.