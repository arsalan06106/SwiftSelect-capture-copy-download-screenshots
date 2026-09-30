# Theme System

SwiftSelect's toolbar and status bar support light and dark themes. The system is adaptive: it tries to match the page by default, but the user can override it.

<br>

## Surface Sampling & Element Contrast Detection

Rather than applying a single page-wide luminance assumption across all UI components, SwiftSelect samples the area **directly beneath each element** (main menu toolbar, notification toasts, and selection HUD pill):

1. **Localized Sampling (`isAreaDark(rect)`)**:
   - Computes a distributed 9-point grid across the element's rendered bounding box (`document.elementsFromPoint`).
   - Filters out extension UI elements and alpha-composites background colors from top to bottom down the stack.
   - Evaluates `<canvas>` and same-origin `<img>` elements as well as text contrast cues (`style.color`).
   - Seamlessly handles transparent containers by compositing against the root page canvas.

2. **Per-Element Adaptive Theming (`applyElementTheme(el, theme, targetRect)`)**:
   - If the surface beneath the element is dark → element receives dark mode (`qs-theme-glass-dark` or `qs-theme-dark`) with high-contrast light text (`#ffffff` / `#e1e1e1`) and icons.
   - If the surface beneath the element is light → element receives light mode (`qs-theme-glass` or light standard) with high-contrast dark text (`#224` / `#1f1f1f`) and icons.
   - Preserves independent legibility across mixed-theme pages (e.g. dark headers with light content feeds).

<br>

## Theme Preference Storage

When the user clicks the theme toggle button in the toolbar, the preference (`glass` or `standard`) is saved to `chrome.storage.local`.

<br>

## Application

- `applyElementTheme()` dynamically styles individual components whenever they appear or move.
- `applyTheme()` reapplies themes across all registered elements, reacting to window resizes, scrolls, and mutation events.
- Caches the last computed state (`_qsThemeState`) per element to eliminate redundant DOM mutations and ensure smooth 60fps performance during drag selection.