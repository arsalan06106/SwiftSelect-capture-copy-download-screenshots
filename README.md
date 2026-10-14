<div align="center">

<br>

<img src="icons/icon48.png" alt="SwiftSelect" width="76">

# SwiftSelect

Capture, copy, and download in a single motion.

<br>

[![Chrome](https://raw.githubusercontent.com/creosB/creosB/refs/heads/main/assets/Chrome%20Web%20Store.svg)](https://chromewebstore.google.com/detail/swiftselect-capture-copy/aboceojignbeaclebdpjjgkocmdldoec)

The fastest screenshot tool for Chrome. Select a region, grab the viewport, or scroll-capture an entire page. Everything lands on your clipboard automatically.

</div>

<br>

---

<br>
<div align="center">
  <img src="https://lh3.googleusercontent.com/OF283NjktCBE8qv5Cin-vxiSi9k__jc0Zxb4aP7vu_popwnfNAOYDVqa6AE3LhnkNHAECGikszOVuJEyrRPjn0Ebzw=s1280-w1280-h800" alt="SwiftSelect Interface Preview" width="100%">
</div>

<br>
## The Mechanics of SwiftSelect

Most screenshot extensions are slow, cluttered, or demand unnecessary sign-ups. SwiftSelect gives you instant capture with zero friction.

| Mode | Action | Output |
| :--- | :--- | :--- |
| Region Select | Draw a box around any element | Copied to clipboard (+ save button) |
| Visible Area | Capture current viewport | Copied to clipboard & auto-downloaded |
| Horizontal View | Capture wide content / zoomed areas | Copied to clipboard & auto-downloaded |
| Full Page | Scroll and stitch entire page | High-res image file |

Full-page and horizontal captures reliably handle complex single-page applications and wide data tables, bypassing sticky headers and fixed elements.

<br>
<div align="center">
  <img src="https://lh3.googleusercontent.com/8ZZpH-oeIqJv8pwRuW8rbKg6f2wZWcuSdkT7SHDSOwdpAD-pnGfiGkgDjOSbMGSPVySgRN64_7c48enz_tilZoUnkA=s1280-w1280-h800" alt="SwiftSelect Shortcuts Overview" width="100%">
</div>

<br>
## Shortcuts & In-Session Hotkeys

Every action has dedicated shortcuts and in-session single-key hotkeys.

### Global Chrome Shortcuts
| Shortcut | Action |
| :--- | :--- |
| <kbd>Alt</kbd> + <kbd>X</kbd> | Activate SwiftSelect floating toolbar |
| <kbd>Alt</kbd> + <kbd>S</kbd> | Capture visible area & download |
| <kbd>Alt</kbd> + <kbd>H</kbd> | Capture horizontal view & download |
| <kbd>Alt</kbd> + <kbd>F</kbd> | Capture full page & download |

### In-Session Hotkeys (When Toolbar is Open)
| Key | Action |
| :--- | :--- |
| <kbd>V</kbd> | Capture visible area & download |
| <kbd>H</kbd> | Capture horizontal view & download |
| <kbd>F</kbd> | Capture full page & download |
| <kbd>Esc</kbd> | Cancel and close |

Clicking the extension icon in the toolbar also activates selection mode directly.

<br>

## Selection Modifiers

While dragging a region selection, hold a modifier key to alter the capture behavior.

| Hold | Effect |
| :--- | :--- |
| <kbd>Shift</kbd> | Constrain to a perfect square |
| <kbd>Space</kbd> | Reposition the selection box mid-drag |
| <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + hover | Auto-detect elements like images or cards, then click to capture |

<br>

## Theming

The floating toolbar includes a toggle for light and dark modes. The interface also supports a liquid glass aesthetic. Preferences persist across sessions.

<br>

## Installation

### 🌐 Chrome Web Store (Recommended)

<a href="https://chromewebstore.google.com/detail/swiftselect-capture-copy/aboceojignbeaclebdpjjgkocmdldoec">
  <img src="https://img.shields.io/badge/Install_SwiftSelect-Chrome_Web_Store-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Install from Chrome Web Store">
</a>

### 📦 From Releases

1. Navigate to the [Releases](https://github.com/arsalan06106/SwiftSelect-capture-copy-download-screenshots/releases) page and download the latest `.zip` file.
2. Extract the downloaded archive to a permanent folder on your local machine.
3. Open `chrome://extensions/` in your browser.
4. Enable Developer mode using the toggle in the top right corner.
5. Click Load unpacked and select the extracted folder.
6. Pin SwiftSelect from the extensions menu.

### 💻 From Source

```bash
git clone https://github.com/arsalan06106/SwiftSelect-capture-copy-download-screenshots.git
```

1. Open `chrome://extensions/`
2. Enable Developer mode using the toggle in the top right corner.
3. Click Load unpacked and select the cloned repository directory.
4. Pin SwiftSelect from the extensions menu.

<br>

<details>
<summary>Project Structure</summary>

<br>

```text
SwiftSelect/
├── manifest.json            # Extension config (MV3)
├── background.js            # Service worker — command routing, offscreen doc management
├── contentScript.js         # Entry point injected into pages, loads src/ modules
├── popup.html               # Extension popup UI
├── popup.js                 # Popup button handlers
├── menu.html                # Context menu UI
├── menu.js                  # Menu theme toggle & button interactions
├── offscreen.html           # Offscreen document shell (MV3 clipboard/tabCapture)
├── offscreen.js             # Offscreen logic — full-page stitching & clipboard ops
├── styles.css               # All overlay, toolbar & selection styles
├── src/
│   ├── ui.js                # Toolbar & overlay rendering
│   ├── events.js            # Input & event handling (drag, modifiers, element detection)
│   ├── theme.js             # Light/dark theme logic
│   └── capture/
│       ├── region.js        # Region & visible-area capture engine
│       ├── fullpage.js      # Scroll-capture with sticky-element neutralisation
│       ├── download.js      # File-save & status-bar transition logic
│       └── utils.js         # Shared helpers (image loading, smart filenames, cursor toggle)
└── icons/                   # Extension icons (48px, 128px)
```

</details>

<details>
<summary>Permissions Justification</summary>

<br>

| Permission | Reason |
| :--- | :--- |
| `activeTab` | Access the current tab to capture content |
| `scripting` | Inject the capture overlay into pages |
| `tabs` | Query tab state for multi-step captures |
| `tabCapture` | Capture visible tab content as an image |
| `clipboardWrite` | Copy screenshots to clipboard automatically |
| `offscreen` | Create an offscreen document for clipboard API (MV3 requirement) |
| `storage` | Persist user preferences |
| `<all_urls>` | Operate on any webpage |

Declared under `host_permissions` in Manifest V3.

</details>

<br>

## Contributing

If you discover an anomaly or have a feature concept, [open an issue](https://github.com/arsalan06106/SwiftSelect-capture-copy-download-screenshots/issues). Pull requests are evaluated and welcome.

<br>

## License

[MIT](LICENSE.txt) © 2026 [arsalan06106](https://github.com/arsalan06106)

<br>

---

<div align="center">

<br>

Built by <a href="https://github.com/arsalan06106">@arsalan06106</a>

If SwiftSelect saves you time, consider leaving a ★ on the repository.

<br>

</div>
