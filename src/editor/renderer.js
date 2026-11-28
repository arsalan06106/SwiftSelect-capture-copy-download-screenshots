/**
 * SwiftSelect Annotate Studio — Pure Canvas 2D Compositor.
 *
 * Renders the full non-destructive scene:
 *   1. Canvas backdrop (transparent, solid, linear gradient, multi-orb mesh, custom, dot/grid pattern)
 *   2. Multi-pass studio drop shadow & device/window chrome (macOS Light/Dark, Browser, Frosted Glass, Polaroid)
 *   3. Base screenshot(s) (with stitch layout, rotation/flip, non-destructive filter string, vignette & film grain)
 *   4. Spotlight focus masks (dimming everything outside highlighted regions)
 *   5. Ordered annotation & overlay image layers (with opacity, blend modes, per-layer filters, corner radius)
 *   6. Interactive selection handles & crop reticle (only in live preview mode, never in export)
 */

import {
  BACKGROUNDS,
  DEFAULT_FILTERS,
  TEXT_FONTS,
  buildFilterString,
  computeCanvasLayout,
  getLayerBounds,
  getResizeHandles,
} from "./model.js";

function roundedRectPath(ctx, x, y, w, h, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.722 * b * 0.1;
}

function isLightHex(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6;
}

function drawLinearGradient(ctx, w, h, angleDeg, stops) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  const len = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
  const dx = (Math.cos(rad) * len) / 2;
  const dy = (Math.sin(rad) * len) / 2;
  const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  stops.forEach((c, idx) => g.addColorStop(stops.length === 1 ? 0 : idx / (stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawBackground(ctx, w, h, frame, forceOpaqueWhite = false) {
  const mode = frame.customMode || "preset";
  if (mode === "solid") {
    ctx.fillStyle = frame.customColor || "#ffffff";
    ctx.fillRect(0, 0, w, h);
  } else if (mode === "linear") {
    drawLinearGradient(ctx, w, h, frame.customAngle ?? 135, [frame.customColor || "#3b82f6", frame.customColor2 || "#8b5cf6"]);
  } else {
    const preset = BACKGROUNDS.find((b) => b.id === frame.bgId) || BACKGROUNDS[0];
    if (preset.kind === "transparent") {
      if (forceOpaqueWhite) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
      }
    } else if (preset.kind === "solid") {
      ctx.fillStyle = preset.color;
      ctx.fillRect(0, 0, w, h);
    } else if (preset.kind === "linear") {
      drawLinearGradient(ctx, w, h, preset.angle ?? 135, preset.stops);
    } else if (preset.kind === "mesh") {
      ctx.fillStyle = preset.base || "#0b1120";
      ctx.fillRect(0, 0, w, h);
      for (const [color, rx, ry, rr] of preset.orbs || []) {
        const ox = w * rx;
        const oy = h * ry;
        const radius = Math.max(w, h) * rr;
        const rg = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius);
        rg.addColorStop(0, color);
        rg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.save();
        ctx.globalAlpha = 0.72;
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    }
  }

  // Optional subtle studio dot / grid pattern
  const pattern = frame.pattern || "none";
  if (pattern !== "none") {
    const preset = BACKGROUNDS.find((b) => b.id === frame.bgId);
    const isDarkBg =
      (mode === "preset" && (preset?.id?.includes("carbon") || preset?.id?.includes("slate") || preset?.id?.includes("obsidian") || preset?.id?.includes("aurora") || preset?.id?.includes("ocean") || preset?.id?.includes("plum"))) ||
      (mode !== "preset" && !isLightHex(frame.customColor || "#ffffff"));
    const stroke = isDarkBg ? "rgba(255,255,255,0.12)" : "rgba(15,23,42,0.09)";
    const step = Math.max(24, Math.round(Math.min(w, h) * 0.032));
    ctx.save();
    if (pattern === "dots") {
      ctx.fillStyle = stroke;
      const r = Math.max(1.2, step * 0.055);
      for (let y = step / 2; y < h; y += step) {
        for (let x = step / 2; x < w; x += step) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (pattern === "grid") {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, step * 0.03);
      ctx.beginPath();
      for (let x = 0; x <= w; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for (let y = 0; y <= h; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawTransformedImage(ctx, imgEl, crop, x, y, w, h, transform, cover = false) {
  const sx = crop ? crop.x : 0;
  const sy = crop ? crop.y : 0;
  const sw = crop ? crop.width : imgEl.naturalWidth || imgEl.width;
  const sh = crop ? crop.height : imgEl.naturalHeight || imgEl.height;
  const rot = (((transform?.rotation || 0) % 360) + 360) % 360;
  const flipH = !!transform?.flipH;
  const flipV = !!transform?.flipV;

  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  if (flipH || flipV) ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);

  const dw = rot === 90 || rot === 270 ? h : w;
  const dh = rot === 90 || rot === 270 ? w : h;

  if (cover) {
    const srcRatio = sw / sh;
    const dstRatio = dw / dh;
    let cw = sw;
    let ch = sh;
    let cx = sx;
    let cy = sy;
    if (srcRatio > dstRatio) {
      cw = sh * dstRatio;
      cx = sx + (sw - cw) / 2;
    } else {
      ch = sw / dstRatio;
      cy = sy + (sh - ch) / 2;
    }
    ctx.drawImage(imgEl, cx, cy, cw, ch, -dw / 2, -dh / 2, dw, dh);
  } else {
    ctx.drawImage(imgEl, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  }
  ctx.restore();
}

function drawVignetteAndGrain(ctx, rect, filters) {
  const vig = filters?.vignette || 0;
  if (vig > 0) {
    ctx.save();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const innerR = Math.min(rect.width, rect.height) * 0.25;
    const outerR = Math.hypot(rect.width / 2, rect.height / 2);
    const rg = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    rg.addColorStop(0, "rgba(0,0,0,0)");
    rg.addColorStop(1, `rgba(0,0,0,${(vig / 100) * 0.72})`);
    ctx.fillStyle = rg;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  }
  const grain = filters?.grain || 0;
  if (grain > 0) {
    ctx.save();
    const density = Math.min(4500, Math.round((rect.width * rect.height) / 180));
    const alpha = (grain / 100) * 0.28;
    // Deterministic pseudo-random grain so frames don't flicker while drawing
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const dotSize = Math.max(1.5, Math.min(rect.width, rect.height) * 0.0022);
    for (let i = 0; i < density; i++) {
      const gx = rect.x + rand() * rect.width;
      const gy = rect.y + rand() * rect.height;
      ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
      ctx.fillRect(gx, gy, dotSize, dotSize);
    }
    ctx.restore();
  }
}

function drawWindowChrome(ctx, layout, frame) {
  const style = frame.windowStyle || "none";
  if (style === "none") return;
  const { cardRect, chromeTop, chromeBottom, bezel, radiusPx } = layout;

  if (style === "macos-light" || style === "macos-dark" || style === "browser") {
    const dark = style === "macos-dark";
    ctx.save();
    ctx.fillStyle = dark ? "#1c1e26" : "#f3f4f8";
    ctx.fillRect(cardRect.x, cardRect.y, cardRect.width, chromeTop);

    // Subtle bottom hairline under bar
    ctx.fillStyle = dark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)";
    ctx.fillRect(cardRect.x, cardRect.y + chromeTop - 1, cardRect.width, 1);

    // Traffic lights
    const dotR = Math.max(4.5, chromeTop * 0.16);
    const dotY = cardRect.y + chromeTop / 2;
    const startX = cardRect.x + Math.max(16, chromeTop * 0.52);
    const gap = dotR * 3.1;
    const colors = ["#ff5f57", "#febc2e", "#28c840"];
    colors.forEach((c, idx) => {
      ctx.beginPath();
      ctx.arc(startX + idx * gap, dotY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    });

    const title = String(frame.windowTitle || "").trim();
    if (style === "browser") {
      const pillW = Math.min(cardRect.width * 0.52, Math.max(180, cardRect.width * 0.36));
      const pillH = Math.max(20, chromeTop * 0.56);
      const pillX = cardRect.x + (cardRect.width - pillW) / 2;
      const pillY = cardRect.y + (chromeTop - pillH) / 2;
      roundedRectPath(ctx, pillX, pillY, pillW, pillH, pillH / 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = "rgba(15,23,42,0.08)";
      ctx.lineWidth = 1;
      ctx.stroke();

      if (title) {
        ctx.fillStyle = "#475569";
        ctx.font = `500 ${Math.max(11, Math.round(pillH * 0.48))}px ${TEXT_FONTS.sans}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(title, cardRect.x + cardRect.width / 2, dotY + 0.5, pillW - 24);
      }
    } else if (title) {
      ctx.fillStyle = dark ? "rgba(241,245,249,0.72)" : "rgba(30,41,59,0.68)";
      ctx.font = `600 ${Math.max(11, Math.round(chromeTop * 0.34))}px ${TEXT_FONTS.sans}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(title, cardRect.x + cardRect.width / 2, dotY + 0.5, cardRect.width * 0.55);
    }
    ctx.restore();
  } else if (style === "glass") {
    ctx.save();
    roundedRectPath(ctx, cardRect.x, cardRect.y, cardRect.width, cardRect.height, radiusPx);
    ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.58)";
    ctx.lineWidth = Math.max(1.5, bezel * 0.08);
    ctx.stroke();
    ctx.restore();
  } else if (style === "polaroid") {
    ctx.save();
    roundedRectPath(ctx, cardRect.x, cardRect.y, cardRect.width, cardRect.height, Math.max(6, radiusPx));
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    const caption = String(frame.windowTitle || "").trim();
    if (caption) {
      ctx.fillStyle = "#334155";
      ctx.font = `500 ${Math.max(14, Math.round(chromeBottom * 0.32))}px ${TEXT_FONTS.serif}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(caption, cardRect.x + cardRect.width / 2, cardRect.y + cardRect.height - chromeBottom / 2, cardRect.width - bezel * 2);
    }
    ctx.restore();
  }
}

function applyDash(ctx, layer) {
  const lw = layer.lineWidth || 5;
  if (layer.dash === "dashed") {
    ctx.setLineDash([lw * 2.6, lw * 1.9]);
  } else if (layer.dash === "dotted") {
    ctx.setLineDash([0.01, lw * 2.1]);
  } else {
    ctx.setLineDash([]);
  }
}

function drawArrowHead(ctx, fromX, fromY, toX, toY, lw, color) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const headLen = Math.max(14, lw * 3.8);
  const spread = Math.PI / 6.5;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - headLen * Math.cos(angle - spread), toY - headLen * Math.sin(angle - spread));
  ctx.lineTo(toX - headLen * 0.68 * Math.cos(angle), toY - headLen * 0.68 * Math.sin(angle));
  ctx.lineTo(toX - headLen * Math.cos(angle + spread), toY - headLen * Math.sin(angle + spread));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMosaicRedact(ctx, sourceCanvas, x, y, w, h, solid = false) {
  const rx = Math.round(w < 0 ? x + w : x);
  const ry = Math.round(h < 0 ? y + h : y);
  const rw = Math.max(1, Math.round(Math.abs(w)));
  const rh = Math.max(1, Math.round(Math.abs(h)));
  if (solid) {
    ctx.save();
    roundedRectPath(ctx, rx, ry, rw, rh, Math.min(8, Math.min(rw, rh) * 0.15));
    ctx.fillStyle = "#0e1017";
    ctx.fill();
    ctx.restore();
    return;
  }
  const block = Math.max(8, Math.round(Math.min(sourceCanvas.width, sourceCanvas.height) * 0.014));
  const sw = Math.max(1, Math.ceil(rw / block));
  const sh = Math.max(1, Math.ceil(rh / block));
  const tmp = document.createElement("canvas");
  tmp.width = sw;
  tmp.height = sh;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(sourceCanvas, rx, ry, rw, rh, 0, 0, sw, sh);
  ctx.save();
  roundedRectPath(ctx, rx, ry, rw, rh, Math.min(6, Math.min(rw, rh) * 0.12));
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, sw, sh, rx, ry, rw, rh);
  ctx.restore();
}

function drawSingleLayer(ctx, layer, assets, canvas) {
  if (!layer.visible) return;
  ctx.save();
  ctx.globalAlpha = layer.opacity ?? 1;
  ctx.globalCompositeOperation = layer.blendMode || "source-over";

  if (layer.type === "image") {
    const imgEl = assets.get(layer.assetId);
    if (imgEl) {
      const b = getLayerBounds(layer);
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      ctx.save();
      ctx.translate(cx, cy);
      if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
      const r = Math.min(layer.radius || 0, b.width / 2, b.height / 2);
      if (layer.shadow) {
        ctx.save();
        ctx.shadowColor = `rgba(0, 0, 0, ${Math.min(0.45, (layer.shadow / 100) * 0.5)})`;
        ctx.shadowBlur = Math.max(8, Math.min(b.width, b.height) * 0.08 * (layer.shadow / 100));
        ctx.shadowOffsetY = Math.max(2, Math.min(b.width, b.height) * 0.02 * (layer.shadow / 100));
        roundedRectPath(ctx, -b.width / 2, -b.height / 2, b.width, b.height, r);
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.restore();
      }
      roundedRectPath(ctx, -b.width / 2, -b.height / 2, b.width, b.height, r);
      ctx.clip();
      const fStr = buildFilterString(layer.filters || DEFAULT_FILTERS);
      if (fStr !== "none") ctx.filter = fStr;
      ctx.drawImage(imgEl, -b.width / 2, -b.height / 2, b.width, b.height);
      ctx.filter = "none";
      if (layer.filters) {
        drawVignetteAndGrain(ctx, { x: -b.width / 2, y: -b.height / 2, width: b.width, height: b.height }, layer.filters);
      }
      ctx.restore();
    }
    ctx.restore();
    return;
  }

  if (layer.type === "pen" || layer.type === "highlighter") {
    const pts = layer.points || [];
    if (pts.length > 0) {
      ctx.strokeStyle = layer.color || "#FF3333";
      ctx.lineWidth = layer.lineWidth || (layer.type === "highlighter" ? 26 : 6);
      ctx.lineCap = layer.type === "highlighter" ? "butt" : "round";
      ctx.lineJoin = "round";
      if (layer.type === "pen") applyDash(ctx, layer);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      if (pts.length > 1) {
        const last = pts[pts.length - 1];
        ctx.lineTo(last.x, last.y);
      } else {
        ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1);
      }
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (layer.type === "arrow") {
    const color = layer.color || "#FF3333";
    const lw = layer.lineWidth || 6;
    const head = layer.head || "end";
    const dx = layer.x2 - layer.x1;
    const dy = layer.y2 - layer.y1;
    const dist = Math.hypot(dx, dy) || 1;
    const trim = head !== "none" ? Math.min(dist * 0.4, Math.max(10, lw * 2.2)) : 0;
    const startTrim = head === "both" ? trim : 0;
    const sx = layer.x1 + (dx / dist) * startTrim;
    const sy = layer.y1 + (dy / dist) * startTrim;
    const ex = layer.x2 - (dx / dist) * trim;
    const ey = layer.y2 - (dy / dist) * trim;

    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    applyDash(ctx, layer);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);

    if (head !== "none") drawArrowHead(ctx, layer.x1, layer.y1, layer.x2, layer.y2, lw, color);
    if (head === "both") drawArrowHead(ctx, layer.x2, layer.y2, layer.x1, layer.y1, lw, color);
    ctx.restore();
    return;
  }

  if (layer.type === "rect") {
    const b = getLayerBounds(layer);
    const lw = layer.lineWidth || 5;
    const r = layer.radius ?? Math.min(14, lw * 1.4 + 4);
    roundedRectPath(ctx, b.x, b.y, b.width, b.height, r);
    if (layer.fill) {
      ctx.save();
      ctx.globalAlpha = (layer.opacity ?? 1) * 0.22;
      ctx.fillStyle = layer.color || "#FF3333";
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = layer.color || "#FF3333";
    ctx.lineWidth = lw;
    applyDash(ctx, layer);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (layer.type === "ellipse") {
    const b = getLayerBounds(layer);
    const lw = layer.lineWidth || 5;
    ctx.beginPath();
    ctx.ellipse(b.x + b.width / 2, b.y + b.height / 2, Math.max(1, b.width / 2), Math.max(1, b.height / 2), 0, 0, Math.PI * 2);
    if (layer.fill) {
      ctx.save();
      ctx.globalAlpha = (layer.opacity ?? 1) * 0.22;
      ctx.fillStyle = layer.color || "#FF3333";
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = layer.color || "#FF3333";
    ctx.lineWidth = lw;
    applyDash(ctx, layer);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (layer.type === "blur") {
    drawMosaicRedact(ctx, canvas, layer.x, layer.y, layer.width, layer.height, !!layer.fill);
    ctx.restore();
    return;
  }

  if (layer.type === "counter") {
    const r = layer.radius || Math.max(16, (layer.lineWidth || 6) * 3.1);
    const col = layer.color || "#FF3333";
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.28)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.arc(layer.x, layer.y, r, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = Math.max(2.5, r * 0.14);
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(layer.x, layer.y, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = isLightHex(col) ? "#16171d" : "#ffffff";
    ctx.font = `700 ${Math.round(r * 1.08)}px ${TEXT_FONTS.sans}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(layer.number ?? 1), layer.x, layer.y + 1);
    ctx.restore();
    return;
  }

  if (layer.type === "text" || layer.type === "callout") {
    const fontSize = layer.fontSize || 28;
    const weight = layer.bold === false ? 500 : 700;
    const style = layer.italic ? "italic " : "";
    const family = TEXT_FONTS[layer.font] || TEXT_FONTS.sans;
    ctx.font = `${style}${weight} ${fontSize}px ${family}`;
    const lines = String(layer.text || "").split("\n");
    const widths = lines.map((l) => ctx.measureText(l).width);
    const maxW = Math.max(...widths, fontSize * 1.2);
    const lineH = fontSize * 1.28;
    const totalH = lines.length * lineH;
    // Cache measured text metrics onto layer so hit-testing stays pixel-exact
    layer.measuredWidth = maxW;
    layer.measuredHeight = totalH;

    const col = layer.color || "#FF3333";
    const isPill = !!layer.fill || layer.type === "callout";
    const padX = isPill ? fontSize * 0.62 : 0;
    const padY = isPill ? fontSize * 0.34 : 0;
    const align = layer.align || "left";
    const boxX = align === "center" ? layer.x - maxW / 2 - padX : layer.x - padX;
    const boxY = layer.y - padY;
    const boxW = maxW + padX * 2;
    const boxH = totalH + padY * 2;

    if (isPill) {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.22)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      const r = layer.type === "callout" ? Math.min(16, boxH * 0.35) : boxH / 2;
      roundedRectPath(ctx, boxX, boxY, boxW, boxH, r);
      ctx.fillStyle = col;
      ctx.fill();
      if (layer.type === "callout") {
        // Pointer tail at bottom-left of callout bubble
        const tailX = boxX + Math.min(28, boxW * 0.25);
        const tailY = boxY + boxH;
        ctx.beginPath();
        ctx.moveTo(tailX, tailY - 1);
        ctx.lineTo(tailX - 8, tailY + Math.max(10, fontSize * 0.42));
        ctx.lineTo(tailX + 12, tailY - 1);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.fillStyle = isPill ? (isLightHex(col) ? "#111318" : "#ffffff") : col;
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    if (!isPill) {
      ctx.shadowColor = "rgba(0,0,0,0.22)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetY = 2;
    }
    lines.forEach((line, idx) => {
      const tx = align === "center" ? layer.x : layer.x;
      ctx.fillText(line, tx, layer.y + idx * lineH);
    });
    ctx.restore();
    return;
  }

  ctx.restore();
}

function drawSpotlightOverlay(ctx, doc, w, h) {
  const spots = (doc.layers || []).filter((l) => l.type === "spotlight" && l.visible);
  if (!spots.length) return;
  ctx.save();
  ctx.fillStyle = "rgba(8, 10, 18, 0.56)";
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  for (const s of spots) {
    const b = getLayerBounds(s);
    if (!b || b.width < 2 || b.height < 2) continue;
    const r = Math.min(16, b.width / 2, b.height / 2);
    // Counter-clockwise rounded cutout using evenodd fill rule
    ctx.moveTo(b.x + r, b.y);
    ctx.arcTo(b.x + b.width, b.y, b.x + b.width, b.y + b.height, r);
    ctx.arcTo(b.x + b.width, b.y + b.height, b.x, b.y + b.height, r);
    ctx.arcTo(b.x, b.y + b.height, b.x, b.y, r);
    ctx.arcTo(b.x, b.y, b.x + b.width, b.y, r);
    ctx.closePath();
  }
  ctx.fill("evenodd");

  // Crisp glowing highlight rim around each spotlight region
  for (const s of spots) {
    const b = getLayerBounds(s);
    if (!b || b.width < 2 || b.height < 2) continue;
    const r = Math.min(16, b.width / 2, b.height / 2);
    roundedRectPath(ctx, b.x, b.y, b.width, b.height, r);
    ctx.strokeStyle = s.color || "rgba(255,255,255,0.92)";
    ctx.lineWidth = Math.max(2, s.lineWidth || 3);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSelectionChrome(ctx, layer, zoomScale = 1) {
  if (!layer || !layer.visible) return;
  const b = getLayerBounds(layer);
  if (!b) return;
  const inv = 1 / Math.max(0.2, zoomScale);
  ctx.save();
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 1.75 * inv;
  ctx.setLineDash([5 * inv, 4 * inv]);
  ctx.strokeRect(b.x - 3 * inv, b.y - 3 * inv, b.width + 6 * inv, b.height + 6 * inv);
  ctx.setLineDash([]);

  const handles = getResizeHandles(layer);
  const r = 5.5 * inv;
  for (const h of handles) {
    ctx.beginPath();
    ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2 * inv;
    ctx.strokeStyle = "#2563eb";
    ctx.stroke();
  }
  ctx.restore();
}

function drawCropOverlay(ctx, cropRect, w, h, zoomScale = 1) {
  if (!cropRect) return;
  const inv = 1 / Math.max(0.2, zoomScale);
  ctx.save();
  ctx.fillStyle = "rgba(8, 10, 18, 0.56)";
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.rect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);
  ctx.fill("evenodd");

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2 * inv;
  ctx.strokeRect(cropRect.x, cropRect.y, cropRect.width, cropRect.height);

  // Rule of thirds
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1 * inv;
  for (let i = 1; i <= 2; i++) {
    const vx = cropRect.x + (cropRect.width * i) / 3;
    const hy = cropRect.y + (cropRect.height * i) / 3;
    ctx.beginPath();
    ctx.moveTo(vx, cropRect.y);
    ctx.lineTo(vx, cropRect.y + cropRect.height);
    ctx.moveTo(cropRect.x, hy);
    ctx.lineTo(cropRect.x + cropRect.width, hy);
    ctx.stroke();
  }

  // Corner L-brackets
  const len = Math.min(22 * inv, cropRect.width * 0.25, cropRect.height * 0.25);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3.5 * inv;
  ctx.lineCap = "round";
  const { x, y, width, height } = cropRect;
  const corners = [
    [[x, y + len], [x, y], [x + len, y]],
    [[x + width - len, y], [x + width, y], [x + width, y + len]],
    [[x + width, y + height - len], [x + width, y + height], [x + width - len, y + height]],
    [[x + len, y + height], [x, y + height], [x, y + height - len]],
  ];
  for (const [p0, p1, p2] of corners) {
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Render the complete Annotate Studio document onto `canvas`.
 *
 * Options:
 *   showSelection   draw selection box + resize handles (false for exports)
 *   draftLayer      in-progress shape currently being drawn by pointer
 *   cropRect        active crop box while crop tool is open
 *   zoomScale       current display CSS scale so handles keep crisp screen size
 *   forceOpaqueWhite fill white behind transparent backdrop (for JPG / PDF)
 */
export function renderStudioCanvas(canvas, doc, assets, options = {}) {
  const {
    showSelection = false,
    draftLayer = null,
    cropRect = null,
    zoomScale = 1,
    forceOpaqueWhite = false,
  } = options;

  const layout = computeCanvasLayout(doc);
  if (canvas.width !== layout.totalWidth || canvas.height !== layout.totalHeight) {
    canvas.width = layout.totalWidth;
    canvas.height = layout.totalHeight;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, layout.totalWidth, layout.totalHeight);

  const frame = doc.frame || {};
  const { cardRect, contentRect, radiusPx, baseDim } = layout;

  // 1. Canvas Background + optional pattern
  drawBackground(ctx, layout.totalWidth, layout.totalHeight, frame, forceOpaqueWhite);

  // 2. Multi-pass studio drop shadow behind the card
  const shadowPct = (frame.shadow ?? 35) / 100;
  if (shadowPct > 0 && (doc.baseImages.length > 0 || doc.blankSize)) {
    ctx.save();
    const blur = baseDim * 0.08 * shadowPct;
    const offsetY = baseDim * 0.022 * shadowPct;
    const alpha = Math.min(0.54, 0.56 * shadowPct);
    ctx.shadowColor = `rgba(10, 14, 28, ${alpha})`;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = offsetY;
    roundedRectPath(ctx, cardRect.x, cardRect.y, cardRect.width, cardRect.height, radiusPx);
    ctx.fillStyle = frame.windowStyle === "glass" ? "rgba(255,255,255,0.45)" : "#ffffff";
    ctx.fill();
    ctx.restore();
  }

  // 3. Window Chrome outer shell (for glass / polaroid)
  if (frame.windowStyle === "glass" || frame.windowStyle === "polaroid") {
    drawWindowChrome(ctx, layout, frame);
  }

  // 4. Card body clipped cleanly
  const isBezelStyle = frame.windowStyle === "glass" || frame.windowStyle === "polaroid";
  const clipRect = isBezelStyle ? contentRect : cardRect;
  const clipRadius = isBezelStyle ? Math.max(4, radiusPx - Math.round(layout.bezel * 0.45)) : radiusPx;

  ctx.save();
  roundedRectPath(ctx, clipRect.x, clipRect.y, clipRect.width, clipRect.height, clipRadius);
  ctx.clip();

  // Fill white backing inside card (important for blank canvas or transparent PNG screenshots)
  ctx.fillStyle = frame.windowStyle === "macos-dark" ? "#11131a" : "#ffffff";
  ctx.fillRect(clipRect.x, clipRect.y, clipRect.width, clipRect.height);

  // Draw top macOS / Browser chrome bar inside the card clip
  if (frame.windowStyle === "macos-light" || frame.windowStyle === "macos-dark" || frame.windowStyle === "browser") {
    drawWindowChrome(ctx, layout, frame);
  }

  // Draw base image(s) with non-destructive filters & transforms
  if (doc.baseImages.length > 0) {
    const fStr = buildFilterString(doc.filters || DEFAULT_FILTERS);
    ctx.save();
    if (fStr !== "none") ctx.filter = fStr;
    for (const slot of layout.slots) {
      const meta = doc.baseImages[slot.index];
      const imgEl = assets.get(slot.assetId);
      if (!imgEl || !meta) continue;
      drawTransformedImage(ctx, imgEl, meta.crop, slot.x, slot.y, slot.width, slot.height, doc.transform, !!slot.cover);
    }
    ctx.restore();

    // Stitch dividers between side-by-side or stacked screenshots
    if (layout.dividers.length) {
      ctx.save();
      ctx.fillStyle = frame.windowStyle === "macos-dark" ? "rgba(255,255,255,0.16)" : "#d4d8dd";
      for (const d of layout.dividers) {
        ctx.fillRect(d.x, d.y, d.width, d.height);
      }
      ctx.restore();
    }

    // Vignette & film grain
    drawVignetteAndGrain(ctx, contentRect, doc.filters);
  }
  ctx.restore();

  // 5. Crisp inner hairline border so white screenshots separate cleanly from white backdrops
  if ((frame.border ?? 1) > 0 && frame.windowStyle !== "glass") {
    ctx.save();
    roundedRectPath(ctx, cardRect.x, cardRect.y, cardRect.width, cardRect.height, radiusPx);
    ctx.lineWidth = Math.max(1, Math.round((frame.border || 1) * Math.max(1, baseDim * 0.0011)));
    ctx.strokeStyle = frame.windowStyle === "macos-dark" ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.09)";
    ctx.stroke();
    ctx.restore();
  }

  // 6. Spotlight focus overlay (if any spotlight layers exist)
  drawSpotlightOverlay(ctx, doc, layout.totalWidth, layout.totalHeight);

  // 7. Ordered layers (annotations + overlay images)
  for (const layer of doc.layers || []) {
    if (layer.type === "spotlight") continue;
    drawSingleLayer(ctx, layer, assets, canvas);
  }
  if (draftLayer) {
    if (draftLayer.type === "spotlight") {
      drawSpotlightOverlay(ctx, { layers: [draftLayer] }, layout.totalWidth, layout.totalHeight);
    } else {
      drawSingleLayer(ctx, draftLayer, assets, canvas);
    }
  }

  // 8. Selection chrome (live preview only)
  if (showSelection && doc.selectedLayerId && !cropRect) {
    const selected = (doc.layers || []).find((l) => l.id === doc.selectedLayerId);
    if (selected) drawSelectionChrome(ctx, selected, zoomScale);
  }

  // 9. Interactive crop reticle
  if (cropRect) {
    drawCropOverlay(ctx, cropRect, layout.totalWidth, layout.totalHeight, zoomScale);
  }

  return layout;
}
