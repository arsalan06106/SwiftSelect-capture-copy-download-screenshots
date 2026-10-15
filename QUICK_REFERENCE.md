# Quick Reference

A compact cheat sheet for SwiftSelect's interface and shortcuts.

<br>

## Activation & Shortcuts

| Action                                            | Result                                  |
| :------------------------------------------------ | :-------------------------------------- |
| Click extension icon                              | Opens selection mode                    |
| <kbd>Alt</kbd> + <kbd>X</kbd>                     | Opens selection mode                    |
| <kbd>Alt</kbd> + <kbd>S</kbd>                     | Captures visible area & downloads       |
| <kbd>Alt</kbd> + <kbd>H</kbd>                     | Captures horizontal view & downloads    |
| <kbd>Alt</kbd> + <kbd>F</kbd>                     | Captures full page & downloads          |
| <kbd>Esc</kbd>                                    | Cancels and closes                      |

### In-Session Hotkeys (When Toolbar is Open)
- <kbd>Alt</kbd> + <kbd>S</kbd> or <kbd>S</kbd> / <kbd>V</kbd>: Save & Copy Visible Area
- <kbd>Alt</kbd> + <kbd>H</kbd> or <kbd>H</kbd>: Save & Copy Horizontal View
- <kbd>Alt</kbd> + <kbd>F</kbd> or <kbd>F</kbd>: Save & Copy Full Page
- <kbd>Alt</kbd> + <kbd>X</kbd> or <kbd>Esc</kbd>: Cancel selection

<br>

## Selection Modifiers

| Hold while dragging              | Effect                                       |
| :------------------------------- | :------------------------------------------- |
| <kbd>Shift</kbd>                 | Constrains to a perfect square               |
| <kbd>Space</kbd>                 | Repositions the selection box mid-drag        |
| <kbd>Ctrl</kbd> / <kbd>⌘</kbd>  | Auto-detects elements — click to capture      |

<br>

## Toolbar Buttons

From left to right when the floating toolbar appears:

| Button         | Action                               | Output                    | Hotkey |
| :------------- | :----------------------------------- | :------------------------ | :----- |
| Eye icon       | Capture visible area                 | Clipboard + file download | `Alt+S` / `V` |
| Wide-view icon | Capture horizontal view              | Clipboard + file download | `Alt+H` / `H` |
| Scroll icon    | Capture full page                    | High-res file download    | `Alt+F` / `F` |

*Hovering over any action button for ~1600ms displays an elegant floating liquid-glass card with shortcut key and description.*

<br>

## Right-Click Context Menu

Right-click the extension icon in Chrome's toolbar (or right-click anywhere on any page) to access:

- **Quick Capture**:
  - `Select Area (Alt+X)`
  - `Capture Visible Area (Alt+S)`
  - `Capture Horizontal View (Alt+H)`
  - `Capture Full Page (Alt+F)`
- **Theme Selection**:
  - `Liquid Glass (Modern)` (default, adaptive)
  - `Standard Minimal`
  - `Always Light`
  - `Always Dark`
- **Configure Keyboard Shortcuts...**

<br>

## Output Behaviour

| Capture Type    | Clipboard | File Download | Notes                                    |
| :-------------- | :-------- | :------------ | :--------------------------------------- |
| Region select   | ✓         | On demand ¹   | Save button appears in status bar        |
| Visible area    | ✓         | Auto          | Copied to clipboard & saved as JPG       |
| Horizontal view | ✓         | Auto          | Copied to clipboard & saved as JPG       |
| Full page       | ✓ ²       | Auto          | Saved as high-quality JPG (space-saving) |

¹ After a region capture, the status bar shows a save button. Clicking it downloads the captured image.  
² Full-page captures attempt silent clipboard copy; if image exceeds clipboard size limits, file download succeeds seamlessly.

<br>

## Limitations & Page State

- Restricted on `chrome://`, `edge://`, `about:` pages, and the Chrome Web Store (clicking extension icon displays explanatory guidance).
- On `file://` local pages, Chrome requires "Allow access to file URLs" permission in `chrome://extensions/`.
- Full-page capture may produce artifacts on pages with complex WebGL canvases.
- Clipboard write can be blocked by page Content Security Policy; the extension falls back to download in that case.