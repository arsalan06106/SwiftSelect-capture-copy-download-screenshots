# Architecture

SwiftSelect is a Chrome extension built on Manifest V3. It has no build step, no bundler, no framework — just ES modules loaded at runtime.

This document covers how the pieces connect.

<br>

## Execution Contexts

The extension runs code in three separate contexts. They cannot share memory; all communication happens through `chrome.runtime.sendMessage` and `chrome.tabs.sendMessage`.

| Context             | Files                              | What it does                                              |
| :------------------ | :--------------------------------- | :-------------------------------------------------------- |
| Service Worker      | `background.js`                    | Routes commands, injects content script, manages offscreen doc |
| Content Script      | `contentScript.js` → `src/*`       | Runs on the webpage, renders UI, handles user input       |
| Offscreen Document  | `offscreen.html` + `offscreen.js`  | Accesses `tabCapture` stream and clipboard for full-page capture |

The popup (`popup.html` + `popup.js`) is a fourth context, but it simply sends messages to the content script and closes itself. It does not perform any capture logic.

<br>

## Module Graph

The content script is bundled from `src/contentScript.js` into a standalone, CSP-safe `contentScript.js` using esbuild, eliminating cross-origin dynamic module loading and webpage CSP conflicts:

```
src/contentScript.js
├── src/theme.js
├── src/ui.js
│   ├── src/capture/region.js
│   │   ├── src/capture/utils.js
│   │   └── src/capture/download.js
│   ├── src/capture/fullpage.js
│   │   ├── src/capture/utils.js
│   │   └── src/capture/download.js
│   ├── src/theme.js
│   └── src/events.js
├── src/events.js
│   └── src/capture/region.js
├── src/capture/region.js
└── src/capture/fullpage.js
```

All functional modules and CSS are pre-compiled into `contentScript.js` so that pages with strict Content Security Policies (such as YouTube, GitHub, and banking portals) run cleanly without unsafe cross-origin dynamic import attempts.

<br>

## The Namespace Bridge

Once loaded, every module is attached to `window.SwiftSelect`:

```js
window.SwiftSelect.theme = theme;
window.SwiftSelect.ui = ui;
window.SwiftSelect.events = events;
window.SwiftSelect.capture = { ...region, ...fullpage };
```

This lets any module call into any other module at runtime without circular import issues. For example, `events.js` calls `window.SwiftSelect.ui.updateSelection()` during drag operations, and `region.js` calls `window.SwiftSelect.ui.setStatus()` after a capture completes.

<br>

## Shadow DOM Isolation

All UI elements — the overlay, selection box, toolbar, status bar, highlighter — are rendered inside Shadow DOM hosts. This prevents page CSS from interfering with the extension UI and vice versa.

Styles are loaded once from `styles.css` via `fetch()`, parsed into a `CSSStyleSheet`, and applied to each shadow root using `adoptedStyleSheets`. This avoids duplicating style tags and keeps things fast.

<br>

## Message Flow

### Region / Visible Capture

```
User draws selection or clicks toolbar button
  → events.js / ui.js
    → chrome.runtime.sendMessage({ type: "capture-visible-tab" })
      → background.js handles it
        → chrome.tabs.captureVisibleTab()
      → returns dataUrl
    → region.js crops the dataUrl on a canvas
    → writes to clipboard via navigator.clipboard.write()
    → (optional) triggers download via download.js
```

### Full-Page Capture

```
User clicks Full Page button
  → fullpage.js sends { type: "start-fullpage-capture" }
    → background.js
      → ensureOffscreen()
      → forwards to offscreen.js
        → offscreen.js starts tabCapture stream via getUserMedia
        → sends "fullpage-action" → "unroll-page" to content script
        → content script neutralises sticky/fixed elements
        → offscreen.js scrolls via CSS, grabs frames via ImageCapture
        → stitches frames on a canvas
        → sends blob back
      → background.js triggers download
```