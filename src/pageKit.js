/**
 * Small shared toolkit for the extension pages: icons, the sliding liquid
 * pill, ripples, toasts, confirm dialogs and locale-aware formatting.
 * No framework, no dependencies.
 */

// Icons are drawn on a 24px grid. Parts that move on hover carry a `p-*`
// class; pages.css animates them when any interactive parent is hovered.
const ICONS = {
  all: '<path class="p-back" d="M3 8V6a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6L11.5 6H19a2 2 0 0 1 2 2v1.5"/><path class="p-front" d="M3 10h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  favorites: '<path class="p-star" d="M12 3.6l2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.62l-5.1 2.68.97-5.68L3.75 9.6l5.7-.83z"/>',
  star: '<path class="p-star" d="M12 3.6l2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.62l-5.1 2.68.97-5.68L3.75 9.6l5.7-.83z"/>',
  recent: '<circle cx="12" cy="12" r="8.5"/><path class="p-hand" d="M12 7.5V12l3 2"/>',
  earlier: '<rect class="p-lid" x="3" y="4" width="18" height="4.5" rx="1.5"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5"/><path class="p-slot" d="M10 12.5h4"/>',
  region: '<path class="p-c1" d="M4 9V6a2 2 0 0 1 2-2h3"/><path class="p-c2" d="M15 4h3a2 2 0 0 1 2 2v3"/><path class="p-c3" d="M20 15v3a2 2 0 0 1-2 2h-3"/><path class="p-c4" d="M9 20H6a2 2 0 0 1-2-2v-3"/><circle class="p-dot" cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/>',
  fit: '<path class="p-c1" d="M4 9V6a2 2 0 0 1 2-2h3"/><path class="p-c2" d="M15 4h3a2 2 0 0 1 2 2v3"/><path class="p-c3" d="M20 15v3a2 2 0 0 1-2 2h-3"/><path class="p-c4" d="M9 20H6a2 2 0 0 1-2-2v-3"/>',
  visible: '<rect x="3" y="4.5" width="18" height="13" rx="2.5"/><path d="M9 21h6M12 17.5V21"/><path class="p-scan" d="M6.5 8h11"/>',
  fullpage: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path class="p-up" d="M9.5 9.5 12 7l2.5 2.5"/><path class="p-down" d="M9.5 14.5 12 17l2.5-2.5"/><path class="p-mid" d="M12 8v8"/>',
  horizontal: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path class="p-left" d="M9.5 9.5 7 12l2.5 2.5"/><path class="p-right" d="M14.5 9.5 17 12l-2.5 2.5"/><path class="p-mid" d="M8 12h8"/>',
  annotated: '<path class="p-line" d="M12.5 20H21"/><path class="p-pen" d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path class="p-hand" d="M12 9.5v4l2.5 1.5"/><path class="p-knob" d="M9.5 2.5h5"/>',
  search: '<g class="p-mag"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/></g>',
  grid: '<rect class="p-q1" x="4" y="4" width="6.5" height="6.5" rx="1.75"/><rect class="p-q2" x="13.5" y="4" width="6.5" height="6.5" rx="1.75"/><rect class="p-q3" x="4" y="13.5" width="6.5" height="6.5" rx="1.75"/><rect class="p-q4" x="13.5" y="13.5" width="6.5" height="6.5" rx="1.75"/>',
  list: '<g class="p-l1"><circle cx="4.5" cy="6" r="1"/><path d="M9 6h11"/></g><g class="p-l2"><circle cx="4.5" cy="12" r="1"/><path d="M9 12h11"/></g><g class="p-l3"><circle cx="4.5" cy="18" r="1"/><path d="M9 18h11"/></g>',
  settings: '<g class="p-gear"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></g>',
  copy: '<path class="p-back" d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/><rect class="p-front" x="8.5" y="8.5" width="12" height="12" rx="2.5"/>',
  download: '<path class="p-arrow" d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path class="p-base" d="M5 19.5h14"/>',
  pdf: '<path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z"/><path d="M14 3.5V8h4.5"/><path class="p-arrow" d="M12 10.5v6M9.5 14l2.5 2.5 2.5-2.5"/>',
  trash: '<g class="p-lid"><path d="M4 7h16"/><path d="M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2"/></g><path class="p-bin" d="M6.5 7l.8 11.2a2 2 0 0 0 2 1.8h5.4a2 2 0 0 0 2-1.8L17.5 7"/><path class="p-bin" d="M10 11v5M14 11v5"/>',
  restore: '<g class="p-spin"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/></g>',
  check: '<path class="p-check" d="m5 12.5 4.5 4.5L19 7.5"/>',
  select: '<circle cx="12" cy="12" r="8.5"/><path class="p-check" d="m8.25 12.25 2.6 2.6 4.9-5.35"/>',
  close: '<g class="p-x"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></g>',
  chevron: '<path class="p-chev" d="m6 9 6 6 6-6"/>',
  prev: '<path class="p-chev" d="m15 6-6 6 6 6"/>',
  next: '<path class="p-chev" d="m9 6 6 6-6 6"/>',
  arrow: '<g class="p-arr"><path d="M5 12h14M13 6l6 6-6 6"/></g>',
  external: '<path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/><g class="p-arr"><path d="M14 4h6v6M20 4l-9 9"/></g>',
  gallery: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle class="p-sun" cx="8.5" cy="9.5" r="1.6"/><path class="p-hills" d="m4 17 5-4.5 3.5 3L16 12l4.5 4.5"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path class="p-k1" d="M6.5 10h.01"/><path class="p-k2" d="M10 10h.01"/><path class="p-k3" d="M13.5 10h.01"/><path class="p-k4" d="M17 10h.01"/><path class="p-space" d="M7.5 14h9"/>',
  system: '<rect x="3" y="4.5" width="18" height="12" rx="2.5"/><path d="M8.5 20.5h7M12 16.5v4"/><path class="p-half" d="M12 4.5v12" />',
  sun: '<circle class="p-core" cx="12" cy="12" r="3.75"/><g class="p-rays"><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></g>',
  moon: '<path class="p-moon" d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"/><path class="p-twinkle" d="M17.5 3.5v3M16 5h3"/>',
  warn: '<g class="p-shake"><path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.25h.01"/></g>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path class="p-shackle" d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path class="p-keyhole" d="M12 14.5v2"/>',
  tab: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9h18"/><g class="p-arr"><path d="M9.5 14h5M12.5 12l2 2-2 2"/></g>',
  drag: '<g class="p-hand"><path d="M8 11V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10V5a1.5 1.5 0 0 1 3 0v5"/><path d="M14 10.5V7a1.5 1.5 0 0 1 3 0v6.5a6.5 6.5 0 0 1-6.5 6.5h-.6a5.5 5.5 0 0 1-4.4-2.2L4.2 15a1.6 1.6 0 0 1 2.5-2L8 14.5"/></g>',
  info: '<circle cx="12" cy="12" r="8.5"/><path class="p-dot" d="M12 11v5M12 8h.01"/>',
  convert: '<path class="p-right" d="M4 8h13M13.5 4.5 17 8l-3.5 3.5"/><path class="p-left" d="M20 16H7M10.5 12.5 7 16l3.5 3.5"/>',
  "size-s": '<g class="p-q1"><rect x="3.5" y="3.5" width="4.5" height="4.5" rx="1.2"/><rect x="9.75" y="3.5" width="4.5" height="4.5" rx="1.2"/><rect x="16" y="3.5" width="4.5" height="4.5" rx="1.2"/></g><g class="p-q2"><rect x="3.5" y="9.75" width="4.5" height="4.5" rx="1.2"/><rect x="9.75" y="9.75" width="4.5" height="4.5" rx="1.2"/><rect x="16" y="9.75" width="4.5" height="4.5" rx="1.2"/></g><g class="p-q3"><rect x="3.5" y="16" width="4.5" height="4.5" rx="1.2"/><rect x="9.75" y="16" width="4.5" height="4.5" rx="1.2"/><rect x="16" y="16" width="4.5" height="4.5" rx="1.2"/></g>',
  "size-m": '<rect class="p-q1" x="4" y="4" width="6.5" height="6.5" rx="1.75"/><rect class="p-q2" x="13.5" y="4" width="6.5" height="6.5" rx="1.75"/><rect class="p-q3" x="4" y="13.5" width="6.5" height="6.5" rx="1.75"/><rect class="p-q4" x="13.5" y="13.5" width="6.5" height="6.5" rx="1.75"/>',
  "size-l": '<rect class="p-q1" x="4" y="4" width="16" height="16" rx="3.5"/>',
  bell: '<g class="p-bell"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></g>',
  alert: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.25h.01"/>',
  zip: '<path d="M6 3.5h8l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 2-1.5z"/><path class="p-arrow" d="M10 3.5v2h2v2h-2v2h2v2h-2"/><rect x="9" y="13.5" width="4" height="4" rx="1"/>',
  invert: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path class="p-half" d="M12 3.5v17"/><path d="M12 3.5h4.5a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4H12z" fill="currentColor" stroke="none" opacity=".35"/>',
  plus: '<g class="p-x"><path d="M12 5.5v13M5.5 12h13"/></g>',
  sparkle: '<path class="p-star" d="M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z"/>',
  github: '<path fill="currentColor" stroke="none" d="M12 2.25a9.75 9.75 0 0 0-3.08 19c.49.09.67-.21.67-.47 0-.23-.01-1-.01-1.82-2.72.59-3.29-1.15-3.29-1.15-.44-1.13-1.09-1.43-1.09-1.43-.89-.61.07-.6.07-.6.98.07 1.5 1.01 1.5 1.01.87 1.5 2.29 1.07 2.85.82.09-.63.34-1.07.62-1.31-2.17-.25-4.46-1.09-4.46-4.83 0-1.07.38-1.94 1.01-2.62-.1-.25-.44-1.24.1-2.59 0 0 .82-.26 2.68 1a9.35 9.35 0 0 1 4.88 0c1.86-1.26 2.68-1 2.68-1 .54 1.35.2 2.34.1 2.59.63.68 1.01 1.55 1.01 2.62 0 3.75-2.29 4.58-4.47 4.82.35.3.66.9.66 1.82 0 1.31-.01 2.37-.01 2.69 0 .26.18.57.67.47a9.75 9.75 0 0 0-3.07-19Z"/>',
  behance: '<path fill="currentColor" stroke="none" d="M2.5 6.5h5.2c1.9 0 3.2.95 3.2 2.55 0 1.05-.56 1.82-1.45 2.18 1.15.33 1.85 1.24 1.85 2.52 0 1.85-1.42 2.95-3.65 2.95H2.5zm2.2 1.85v2.2h2.65c.88 0 1.4-.42 1.4-1.1s-.52-1.1-1.4-1.1zm0 3.95v2.55h2.9c.98 0 1.55-.46 1.55-1.28 0-.82-.57-1.27-1.55-1.27zm9.9-4.75h4.7v1.55h-4.7zm2.35 2.25c2.55 0 4.1 1.78 4.1 4.35v.55h-6.15c.14 1.22.92 1.95 2.18 1.95.88 0 1.55-.36 1.92-1.02l1.72.88c-.68 1.25-1.92 1.94-3.66 1.94-2.66 0-4.36-1.7-4.36-4.35 0-2.62 1.72-4.3 4.25-4.3zm-1.98 3.45h3.95c-.12-1.08-.84-1.78-1.95-1.78-1.12 0-1.84.7-2 1.78z"/>',
  x: '<path fill="currentColor" stroke="none" d="M17.65 3.5h2.9l-6.34 7.25 7.46 9.75h-5.84l-4.58-5.98L6 20.5H3.1l6.78-7.75L2.73 3.5h5.99l4.14 5.47zm-1.02 15.27h1.6L7.86 5.14H6.14z"/>',
  cursor: '<path d="M5 4l6.5 16 2.6-6.1L20 11.3z"/>',
  pen: '<path d="M12.5 20H21"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  highlighter: '<path d="m14.5 4.5 5 5-9.5 9.5H5v-5z"/><path d="M11 8l5 5"/><path d="M4 20h16"/>',
  rect: '<rect x="4" y="5.5" width="16" height="13" rx="2.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  spotlight: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"/>',
  counter: '<circle cx="12" cy="12" r="8.5"/><path d="M10.7 9.5 12.2 8v8M10.5 16h3.5"/>',
  blur: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16"/>',
  text: '<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6"/>',
  callout: '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4.5 4v-4H6.5A2.5 2.5 0 0 1 4 13.5z"/><path d="M8.5 9h7M8.5 12.5h4.5"/>',
  crop: '<path d="M6.5 3.5v14h14"/><path d="M3.5 6.5h14v14"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="9.5" r="1.5"/><path d="m4.5 17 4.5-4.5 3.2 3.2 2.8-2.8 4.5 4.1"/>',
  layers: '<path d="M12 3.5 3.5 8 12 12.5 20.5 8z"/><path d="m3.5 12 8.5 4.5 8.5-4.5"/><path d="m3.5 16 8.5 4.5 8.5-4.5"/>',
  sliders: '<path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--bg, #fff)"/><circle cx="15" cy="12" r="2" fill="var(--bg, #fff)"/><circle cx="11" cy="17" r="2" fill="var(--bg, #fff)"/>',
  template: '<rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17M9.5 9.5V20"/>',
  frame: '<rect x="3.5" y="4" width="17" height="16" rx="3"/><rect x="7" y="7.5" width="10" height="9" rx="1.5"/>',
  undo: '<path d="M9 7 4 12l5 5"/><path d="M4.5 12H15a4.5 4.5 0 1 1 0 9h-2"/>',
  redo: '<path d="m15 7 5 5-5 5"/><path d="M19.5 12H9a4.5 4.5 0 1 0 0 9h2"/>',
  rotateCw: '<path d="M20 4.5v5h-5"/><path d="M19.5 9.5a8 8 0 1 0 1.4 6.1"/>',
  rotateCcw: '<path d="M4 4.5v5h5"/><path d="M4.5 9.5a8 8 0 1 1-1.4 6.1"/>',
  flipH: '<path d="M12 4v16"/><path d="M8.5 7.5 4 12l4.5 4.5z"/><path d="M15.5 7.5 20 12l-4.5 4.5z"/>',
  flipV: '<path d="M4 12h16"/><path d="M7.5 8.5 12 4l4.5 4.5z"/><path d="M7.5 15.5 12 20l4.5-4.5z"/>',
  eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 6.2A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.1 4"/><path d="M6.6 6.6C4 8.4 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.5 0 2.9-.4 4.1-1"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7"/>',
  duplicate: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
  moveUp: '<path d="m7 14 5-5 5 5"/>',
  moveDown: '<path d="m7 10 5 5 5-5"/>',
  share: '<path d="M12 4v11"/><path d="m8 8 4-4 4 4"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  focus: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M5 19.5h14"/>',
};

export function icon(name, className = "icon") {
  return `<svg class="${className} icon-${name}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

/** Fill every <i data-icon="name"> placeholder in a subtree. */
export function hydrateIcons(root = document) {
  root.querySelectorAll("i[data-icon]").forEach((el) => {
    el.outerHTML = icon(el.dataset.icon, el.className || "icon");
  });
}

/**
 * Give a container a pill that glides to its active child.
 * Returns a function to call after the active child changes.
 */
export function mountPill(container, activeSelector) {
  const pill = document.createElement("span");
  pill.className = "liquid-pill";
  pill.setAttribute("aria-hidden", "true");
  container.prepend(pill);

  let prevX = null;
  let prevY = null;
  let morphAnim = null;
  const reducedMotion = () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  const sync = () => {
    const active = container.querySelector(activeSelector);
    if (!active || !active.offsetWidth) {
      pill.style.opacity = "0";
      return;
    }
    pill.style.opacity = "";
    // Measure untransformed layout geometry relative to the container so
    // :active press scaling on the clicked button can NEVER lock the pill
    // to shrunk dimensions or offset its edges from the item.
    let x = 0;
    let y = 0;
    let node = active;
    while (node && node !== container) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent;
    }
    // Fallback if container is not an offsetParent chain ancestor.
    if (node !== container) {
      const c = container.getBoundingClientRect();
      const r = active.getBoundingClientRect();
      const k = container.offsetWidth ? c.width / container.offsetWidth : 1;
      x = (r.left - c.left) / k - container.clientLeft;
      y = (r.top - c.top) / k - container.clientTop;
    }
    const w = active.offsetWidth;
    const h = active.offsetHeight;

    const ready = pill.classList.contains("is-ready");
    if (ready && prevX !== null && prevY !== null && !reducedMotion()) {
      const dx = Math.abs(x - prevX);
      const dy = Math.abs(y - prevY);
      // A short hop stretches the pill a touch along its path, like a drop
      // being pulled; a long one barely more. Never squashes, never flashes.
      if ((dx > 4 || dy > 4) && typeof pill.animate === "function") {
        const horiz = dx >= dy;
        const pull = Math.min(0.035, 0.012 + Math.max(dx, dy) / 6000);
        const sx = horiz ? 1 + pull : 1 - pull / 2;
        const sy = horiz ? 1 - pull / 2 : 1 + pull;
        try {
          morphAnim?.cancel();
          morphAnim = pill.animate(
            [{ scale: "1 1" }, { scale: `${sx} ${sy}`, offset: 0.4 }, { scale: "1 1" }],
            { duration: 280, easing: "ease-out" },
          );
        } catch {}
      }
    }
    prevX = x;
    prevY = y;

    pill.style.setProperty("--pill-x", `${x.toFixed(2)}px`);
    pill.style.setProperty("--pill-y", `${y.toFixed(2)}px`);
    pill.style.setProperty("--pill-w", `${w.toFixed(2)}px`);
    pill.style.setProperty("--pill-h", `${h.toFixed(2)}px`);
    // First placement must not animate from the corner.
    if (!ready) {
      requestAnimationFrame(() => requestAnimationFrame(() => pill.classList.add("is-ready")));
    }
  };

  sync();
  new ResizeObserver(sync).observe(container);
  document.fonts?.ready?.then(sync);
  return sync;
}

const SHEEN_HOSTS = ".btn, .act, .nav-item, .action, .link-row, .select-trigger, .chip, .notice-cta, .tool-link, [data-sheen]";

/**
 * Pointer-tracked specular light on glass controls. A delegated listener
 * writes --mx / --my on the control under the pointer; pages.css paints a
 * soft highlight there. Nothing is created or destroyed per frame.
 */
export function enableSheen() {
  // Retired: no rule reads --mx / --my, and writing them on every mouse move
  // forced a layout and a style pass per event. Hover light is pure CSS.
}

/** Kept for callers written against 2.0. */
export const enableRipples = enableSheen;

// ─── Portal tooltips ─────────────────────────────────────────────────
// Rendered directly on <body> at z-index 9999 so glass panels (backdrop-filter),
// sticky bars, and overflow:hidden containers can never clip or bury a tooltip.

let _tipEl = null;
let _tipWired = false;
let _tipTarget = null;
let _tipShowTimer = 0;
let _tipLastHiddenAt = 0;

function isTipSuppressed(el) {
  if (!el || !el.isConnected) return true;
  const text = el.getAttribute("data-tip");
  if (!text || !text.trim()) return true;
  if (el.disabled || el.getAttribute("aria-disabled") === "true") return true;
  if (el.getAttribute("aria-expanded") === "true") return true;
  // On wide viewports the bulk action bar already renders full text labels beside
  // icons; suppress redundant tooltips there and show them when labels collapse.
  if (el.matches(".bulk-group:not(.bulk-pick) .bulk-btn")) {
    const label = el.querySelector("span");
    if (label && label.offsetWidth > 0 && getComputedStyle(label).display !== "none") return true;
  }
  return false;
}

function ensureTipEl() {
  if (_tipEl && _tipEl.isConnected) return _tipEl;
  _tipEl = document.createElement("div");
  _tipEl.className = "ss-tip";
  _tipEl.setAttribute("role", "tooltip");
  _tipEl.setAttribute("aria-hidden", "true");
  document.body.appendChild(_tipEl);
  return _tipEl;
}

function placeTooltip(target) {
  const tip = ensureTipEl();
  const text = target.getAttribute("data-tip");
  if (!text) return false;
  tip.textContent = text;

  const rect = target.getBoundingClientRect();
  if (!rect.width && !rect.height) return false;

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const gap = 9;
  const pad = 10;

  // Measure at natural size before applying final coordinates.
  tip.style.left = "0px";
  tip.style.top = "0px";
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;

  let side = target.getAttribute("data-tip-pos") || "top";
  if (side === "top" && rect.top - gap - th < pad && rect.bottom + gap + th <= vh - pad) {
    side = "bottom";
  } else if (side === "bottom" && rect.bottom + gap + th > vh - pad && rect.top - gap - th >= pad) {
    side = "top";
  } else if (side === "left" && rect.left - gap - tw < pad && rect.right + gap + tw <= vw - pad) {
    side = "right";
  } else if (side === "right" && rect.right + gap + tw > vw - pad && rect.left - gap - tw >= pad) {
    side = "left";
  }

  let left = 0;
  let top = 0;
  if (side === "bottom") {
    left = rect.left + rect.width / 2 - tw / 2;
    top = rect.bottom + gap;
  } else if (side === "left") {
    left = rect.left - gap - tw;
    top = rect.top + rect.height / 2 - th / 2;
  } else if (side === "right") {
    left = rect.right + gap;
    top = rect.top + rect.height / 2 - th / 2;
  } else {
    side = "top";
    left = rect.left + rect.width / 2 - tw / 2;
    top = rect.top - gap - th;
  }

  left = Math.max(pad, Math.min(vw - tw - pad, left));
  top = Math.max(pad, Math.min(vh - th - pad, top));

  tip.dataset.side = side;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
  return true;
}

export function hideTooltip() {
  clearTimeout(_tipShowTimer);
  _tipShowTimer = 0;
  if (_tipEl?.classList.contains("is-open")) {
    _tipEl.classList.remove("is-open");
    _tipEl.setAttribute("aria-hidden", "true");
    _tipLastHiddenAt = performance.now();
  }
  _tipTarget = null;
}

export function enableTooltips() {
  if (_tipWired || typeof document === "undefined") return;
  _tipWired = true;
  document.documentElement.classList.add("has-portal-tips");

  const schedule = (target, immediate = false) => {
    clearTimeout(_tipShowTimer);
    if (isTipSuppressed(target)) {
      hideTooltip();
      return;
    }
    _tipTarget = target;
    const warm = _tipEl?.classList.contains("is-open") || performance.now() - _tipLastHiddenAt < 340;
    const delay = immediate ? 0 : warm ? 40 : 240;
    _tipShowTimer = setTimeout(() => {
      if (_tipTarget !== target || isTipSuppressed(target)) return;
      if (placeTooltip(target)) {
        _tipEl.classList.add("is-open");
        _tipEl.setAttribute("aria-hidden", "false");
      }
    }, delay);
  };

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const target = e.target?.closest?.("[data-tip]");
    if (!target) return;
    if (target === _tipTarget && _tipEl?.classList.contains("is-open")) return;
    schedule(target);
  });

  document.addEventListener("pointerout", (e) => {
    if (!_tipTarget) return;
    const next = e.relatedTarget?.closest?.("[data-tip]");
    if (next === _tipTarget) return;
    if (!next) hideTooltip();
  });

  document.addEventListener("focusin", (e) => {
    const target = e.target?.closest?.("[data-tip]");
    if (target && target.matches(":focus-visible")) schedule(target, false);
  });

  document.addEventListener("focusout", hideTooltip);
  document.addEventListener("pointerdown", hideTooltip, true);
  document.addEventListener("click", hideTooltip, true);
  document.addEventListener("scroll", hideTooltip, true);
  window.addEventListener("resize", hideTooltip);
  window.addEventListener("blur", hideTooltip);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTooltip();
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enableTooltips, { once: true });
  } else {
    enableTooltips();
  }
}

let _rail = null;

/** toast("Copied") or toast("Deleted", { action: "Undo", onAction, error }). */
// ─── Liquid motion helpers ───────────────────────────────────────────
// The same spring the capture pill uses when progress turns into the
// result. Shared so every morph in the pages moves alike.
export const LIQUID =
  "linear(0, 0.006, 0.025 2.8%, 0.101 6.1%, 0.539 18.9%, 0.721 25.3%, 0.849 31.5%, 0.937 38.1%, 0.968 41.8%, 0.991 45.7%, 1.006 50.1%, 1.015 55%, 1.017 63.9%, 1.001 85.4%, 1)";
export const LIQUID_BOUNCE =
  "linear(0, 0.009, 0.035 2.1%, 0.141 4.4%, 0.723 12.9%, 0.938 16.7%, 1.017 19.4%, 1.067, 1.099 24.3%, 1.108 26%, 1.1, 1.083 30.4%, 1.019 38.4%, 0.996 42.6%, 0.984 46.9%, 0.986 52.7%, 1.001 65.8%, 1)";

function reducedMotion() {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Change an element's contents and let it spring to its new size: the box
 * goes from its old width/height to the new one on the liquid spring while
 * the new contents rise in. `mutate` makes the change synchronously.
 */
export function morph(el, mutate, { duration = 600, contents = true } = {}) {
  if (!el || !el.isConnected || reducedMotion() || el.offsetParent === null) {
    mutate();
    return;
  }
  const a = el.getBoundingClientRect();
  mutate();
  const b = el.getBoundingClientRect();
  el.getAnimations().forEach((x) => x.id === "morph" && x.cancel());
  if (Math.abs(a.width - b.width) > 1 || Math.abs(a.height - b.height) > 1) {
    const anim = el.animate(
      [
        { width: `${a.width}px`, height: `${a.height}px` },
        { width: `${b.width}px`, height: `${b.height}px` },
      ],
      { duration, easing: LIQUID },
    );
    anim.id = "morph";
  }
  if (contents) {
    for (const child of el.children) {
      child.animate(
        [
          { opacity: 0, transform: "translateY(5px) scale(0.92)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: Math.round(duration * 0.75), easing: LIQUID_BOUNCE },
      );
    }
  }
}

/**
 * The button itself says it worked: it morphs into a green "done" state
 * (check + label), holds for a beat, then morphs back. Text buttons show
 * the label; icon buttons just the check.
 */
const _confirmTimers = new WeakMap();
export function confirmButton(btn, label = "Done", { hold = 1500 } = {}) {
  if (!btn) return;
  clearTimeout(_confirmTimers.get(btn));
  if (!btn.dataset.restore) btn.dataset.restore = btn.innerHTML;
  const iconOnly = btn.classList.contains("btn-icon");
  morph(btn, () => {
    btn.classList.add("is-confirmed");
    btn.innerHTML = icon("check") + (iconOnly ? "" : `<span>${label}</span>`);
  });
  _confirmTimers.set(
    btn,
    setTimeout(() => {
      if (!btn.isConnected) return;
      morph(btn, () => {
        btn.classList.remove("is-confirmed");
        btn.innerHTML = btn.dataset.restore;
        delete btn.dataset.restore;
      });
    }, hold),
  );
}

/**
 * Animate a set of elements from where they were to where they are after
 * `mutate` (FLIP), on the spring. Used where items appear, leave or reorder.
 */
export function flip(elements, mutate, { duration = 560 } = {}) {
  const list = [...elements].filter(Boolean);
  if (reducedMotion()) {
    mutate();
    return;
  }
  const first = new Map(list.map((el) => [el, el.getBoundingClientRect()]));
  mutate();
  for (const el of list) {
    if (!el.isConnected) continue;
    const a = first.get(el);
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    el.animate([{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration, easing: LIQUID, composite: "add" });
  }
}

export function toast(message, { action = "", onAction = null, error = false, duration = 2600 } = {}) {
  if (!_rail) {
    _rail = document.createElement("div");
    _rail.className = "toast-rail";
    _rail.setAttribute("role", "status");
    _rail.setAttribute("aria-live", "polite");
    document.body.appendChild(_rail);
  }
  while (_rail.children.length >= 3) _rail.firstChild.remove();

  // The icon and its colour say what happened, not just that something did.
  const kind = error
    ? ["warn", "#ff7a7a", "#e5323b"]
    : /forever|purg/i.test(message)
      ? ["trash", "#ff7a7a", "#e5323b"]
      : /trash/i.test(message)
        ? ["trash", "#a3abbd", "#5d6679"]
        : /favou?rite/i.test(message)
          ? ["star", "#ffc548", "#ff8619"]
          : /restor/i.test(message)
            ? ["restore", "#5b9bff", "#2453f0"]
            : /download|saved/i.test(message)
              ? ["download", "#5b9bff", "#2453f0"]
              : /renam/i.test(message)
                ? ["annotated", "#b18aff", "#6a45f0"]
                : ["check", "#4cd98a", "#11a65a"];
  const el = document.createElement("div");
  el.className = `toast glass glass-dense${error ? " is-error" : ""}`;
  el.style.setProperty("--tone-a", kind[1]);
  el.style.setProperty("--tone-b", kind[2]);
  el.innerHTML = icon(kind[0]);
  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);

  // Leaving, the others glide into the gap instead of jumping.
  const removeNow = () => {
    if (!el.isConnected) return;
    const rest = [..._rail.children].filter((c) => c !== el);
    flip(rest, () => el.remove());
  };
  const dismiss = () => {
    if (el.classList.contains("is-leaving")) return;
    el.classList.add("is-leaving");
    el.addEventListener("animationend", removeNow, { once: true });
    setTimeout(removeNow, 400);
  };

  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action;
    btn.onclick = () => {
      onAction?.();
      dismiss();
    };
    el.appendChild(btn);
  }

  // Arriving, the ones already showing make room on the spring.
  flip([..._rail.children], () => _rail.appendChild(el));

  // The countdown pauses while the pointer rests on the toast, so an Undo
  // never slips away while someone is reaching for it.
  const life = action ? Math.max(duration, 5200) : duration;
  let timer = setTimeout(dismiss, life);
  el.addEventListener("pointerenter", () => clearTimeout(timer));
  el.addEventListener("pointerleave", () => {
    clearTimeout(timer);
    timer = setTimeout(dismiss, 1600);
  });
  return dismiss;
}

/** Liquid glass confirmation dialog. Resolves true when confirmed. */
export function confirmDialog({ title, body, confirm = "Confirm", cancel = "Cancel", glyph = "trash", tone = "danger" }) {
  return new Promise((resolve) => {
    const root = document.createElement("div");
    root.className = "modal-root";
    root.innerHTML = `
      <div class="modal glass glass-dense" role="alertdialog" aria-modal="true" aria-labelledby="ss-modal-title" aria-describedby="ss-modal-body">
        <div class="modal-glyph${tone === "danger" ? "" : " is-neutral"}">${icon(glyph)}</div>
        <h2 id="ss-modal-title"></h2>
        <p id="ss-modal-body"></p>
        <div class="modal-actions">
          <button type="button" class="btn" data-role="cancel"></button>
          <button type="button" class="btn ${tone === "danger" ? "btn-danger-solid" : "btn-primary"}" data-role="confirm"></button>
        </div>
      </div>`;
    root.querySelector("h2").textContent = title;
    root.querySelector("p").textContent = body;
    const cancelBtn = root.querySelector('[data-role="cancel"]');
    const confirmBtn = root.querySelector('[data-role="confirm"]');
    cancelBtn.textContent = cancel;
    confirmBtn.textContent = confirm;

    const previous = document.activeElement;
    const close = (value) => {
      root.classList.remove("is-open");
      document.removeEventListener("keydown", onKey, true);
      setTimeout(() => root.remove(), 280);
      previous?.focus?.();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (e.key === "Tab") {
        // Two buttons: keep focus inside the dialog.
        e.preventDefault();
        (document.activeElement === confirmBtn ? cancelBtn : confirmBtn).focus();
      }
    };

    cancelBtn.onclick = () => close(false);
    confirmBtn.onclick = () => close(true);
    root.addEventListener("pointerdown", (e) => {
      if (e.target === root) close(false);
    });
    document.addEventListener("keydown", onKey, true);

    document.body.appendChild(root);
    requestAnimationFrame(() => {
      root.classList.add("is-open");
      cancelBtn.focus();
    });
  });
}

// ─── Locale ──────────────────────────────────────────────────────────

let _locale = undefined; // undefined lets Intl follow the browser

export function setLocale(uiLanguage) {
  _locale = uiLanguage && uiLanguage !== "auto" ? uiLanguage : undefined;
  document.documentElement.lang = _locale || navigator.language || "en";
}

export function formatNumber(n) {
  return new Intl.NumberFormat(_locale).format(n);
}

export function formatDateTime(ts) {
  return new Intl.DateTimeFormat(_locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ts));
}

/** "just now", "12 min ago", "Yesterday", then a short date. */
export function formatRelative(ts, now = Date.now()) {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "Just now";
  const rtf = new Intl.RelativeTimeFormat(_locale, { numeric: "auto", style: "short" });
  if (min < 60) return rtf.format(-min, "minute");
  const hours = Math.floor(min / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return rtf.format(-days, "day");
  return new Intl.DateTimeFormat(_locale, { month: "short", day: "numeric", year: "numeric" }).format(new Date(ts));
}

export function send(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) return resolve({ success: false, error: chrome.runtime.lastError.message });
        resolve(resp || { success: true });
      });
    } catch (err) {
      resolve({ success: false, error: err?.message });
    }
  });
}
