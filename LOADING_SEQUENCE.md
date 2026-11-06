# Loading Sequence

This document explains exactly what happens from the moment SwiftSelect is activated to the point where the UI is interactive and ready for input.

<br>

## Activation Triggers

There are three ways SwiftSelect starts:

1. The user clicks the extension icon in the toolbar → `chrome.action.onClicked` fires in `background.js`
2. The user presses a keyboard shortcut (`Alt+X`, `Alt+S`, `Alt+F`) → `chrome.commands.onCommand` fires in `background.js`
3. The user opens the popup and clicks a button → `popup.js` sends a message to the content script

All three paths converge on the same function: `injectAndStart(tab, messageType)`.

<br>

## Step 1 — URL Validation

Before injecting anything, `background.js` checks the tab URL. The extension cannot run on:

- `chrome://` pages
- `edge://` pages
- `about:` pages
- `chrome-extension://` pages
- Chrome Web Store pages (`https://chrome.google.com/webstore` and `https://chromewebstore.google.com`)

If the URL matches any of these, the extension silently aborts.

<br>

## Step 2 — Content Script Injection

`background.js` calls `chrome.scripting.executeScript()` to inject `contentScript.js` into the active tab. This happens every time the extension is activated, but `contentScript.js` guards against double-injection:

```js
if (window.__swiftSelectInjected_v2) {
  // Already injected — skip
} else {
  window.__swiftSelectInjected_v2 = true;
  // proceed with setup
}
```

If the script was already injected (from a previous activation on the same page), the existing message listener receives the new command directly.

<br>

## Step 3 — Self-Contained Module Loading

`contentScript.js` is bundled with all five functional modules and core stylesheet:

1. `src/theme.js` — detects page luminance, loads saved theme preference
2. `src/ui.js` — creates Shadow DOM hosts, builds the toolbar
3. `src/events.js` — pointer/keyboard event handlers
4. `src/capture/region.js` — visible-area and region capture logic
5. `src/capture/fullpage.js` — scroll-and-stitch full-page capture

Because all modules and styles are bundled into `contentScript.js`, the script runs synchronously and immediately inside the page's isolated world without triggering cross-origin dynamic import or fetch errors on pages with strict CSPs like YouTube.

<br>

## Step 4 — Namespace Initialisation

After all modules load, they are attached to `window.SwiftSelect`:

```js
window.SwiftSelect.theme = theme;
window.SwiftSelect.ui = ui;
window.SwiftSelect.events = events;
window.SwiftSelect.capture = { ...region, ...fullpage };
```

This bridge allows cross-module calls without circular import problems.

<br>

## Step 5 — Theme Initialisation

`theme.init()` runs immediately. It:

- Samples the page background colour to determine if the page is light or dark
- Loads the user's saved theme preference from `chrome.storage.local`
- Defaults to matching the page luminance if no preference is stored

<br>

## Step 6 — Message Routing

A `chrome.runtime.onMessage` listener is registered. It routes incoming messages to the correct handler:

| Message type          | Handler                                |
| :-------------------- | :------------------------------------- |
| `start-selection`     | `ui.ensureUi()` + `events.addListeners()` |
| `capture-download`    | `region.handleCaptureAndDownload()`    |
| `capture-full`        | `fullpage.handleCaptureFullPage()`     |
| `fullpage-progress`   | Updates progress text in the UI        |
| `fullpage-action`     | Delegates to fullpage unroll/restore   |

<br>

## Step 7 — UI Materialisation (on `start-selection`)

When the message type is `start-selection`, the UI layer builds:

1. Loads `styles.css` via `fetch()` → parses into a `CSSStyleSheet`
2. Creates four Shadow DOM hosts: overlay, status bar, highlighter, toolbar
3. Adopts the shared stylesheet into each shadow root
4. Sets the cursor to crosshair
5. Attaches pointer and keyboard listeners to the document (capture phase)

At this point the user sees the floating toolbar and can begin drawing a selection.

<br>

## Cleanup

When the user presses Escape, completes a capture, or navigates away:

- All event listeners are removed
- All Shadow DOM hosts are detached from the page
- The crosshair cursor is restored
- Safety listeners on `beforeunload` and `visibilitychange` ensure no stale cursor or overlay persists