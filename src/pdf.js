/**
 * Image → PDF, with no dependencies.
 *
 * A full-page capture is usually far taller than any paper, so it is laid
 * out on A4-width pages, edge to edge. Each break is moved up to the nearest
 * calm row (a line of one flat colour: the gap between paragraphs, cards or
 * sections) so a line of text is never sliced in half; when no calm row is
 * close enough the page breaks at full height. The last page is only as tall
 * as what is left, so there is no blank tail.
 *
 * Every page embeds its slice as a baseline JPEG (DCTDecode), which PDF
 * viewers decode natively, keeping the file small and the writer tiny.
 */

const PAGE_W_PT = 595.28; // A4 width
const PAGE_H_PT = 841.89; // A4 height
const MAX_SLICE_W = 6000; // keep each page canvas well inside Chromium limits
const CALM_SEARCH = 0.14; // look this far (share of a page) above a break
const CALM_TOLERANCE = 10; // max channel difference that still counts as flat

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function canvasToJpegBytes(canvas, quality) {
  const blob =
    typeof canvas.convertToBlob === "function"
      ? await canvas.convertToBlob({ type: "image/jpeg", quality })
      : await new Promise((res, rej) =>
          canvas.toBlob((b) => (b ? res(b) : rej(new Error("JPEG encode failed"))), "image/jpeg", quality),
        );
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * The bottom-most flat row between yFrom and yTo, or -1. Rows are read from
 * a narrow copy of the band (horizontal detail does not matter for "is this
 * row one colour"), so even a very wide capture costs a few hundred KB.
 */
function findCalmRow(bmp, width, yFrom, yTo) {
  const bandH = yTo - yFrom;
  if (bandH < 2) return -1;
  const sw = Math.min(240, width);
  const c = makeCanvas(sw, bandH);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, yFrom, width, bandH, 0, 0, sw, bandH);
  const data = ctx.getImageData(0, 0, sw, bandH).data;
  for (let y = bandH - 1; y >= 0; y--) {
    const row = y * sw * 4;
    const r0 = data[row];
    const g0 = data[row + 1];
    const b0 = data[row + 2];
    let flat = true;
    for (let x = 1; x < sw; x++) {
      const i = row + x * 4;
      if (
        Math.abs(data[i] - r0) > CALM_TOLERANCE ||
        Math.abs(data[i + 1] - g0) > CALM_TOLERANCE ||
        Math.abs(data[i + 2] - b0) > CALM_TOLERANCE
      ) {
        flat = false;
        break;
      }
    }
    if (flat) return yFrom + y;
  }
  return -1;
}

/** Where each page starts and ends, in image pixels. */
function planPages(bmp, width, height, pagePx) {
  const pages = [];
  let y = 0;
  while (y < height) {
    const remaining = height - y;
    // A small leftover joins the last page (up to 15% taller than A4)
    // rather than becoming a thin sliver of a page of its own.
    if (remaining <= pagePx * 1.15) {
      pages.push([y, height]);
      break;
    }
    const target = y + pagePx;
    const searchFrom = Math.max(y + 1, Math.round(target - pagePx * CALM_SEARCH));
    const calm = findCalmRow(bmp, width, searchFrom, target);
    const end = calm > y ? calm + 1 : target;
    pages.push([y, end]);
    y = end;
  }
  return pages;
}

const enc = new TextEncoder();

/** A PDF text string as UTF-16BE hex, so any title survives. */
function pdfText(str) {
  let hex = "FEFF";
  for (const ch of String(str || "")) {
    const code = ch.codePointAt(0);
    if (code > 0xffff) {
      const v = code - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, "0");
      hex += (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, "0");
    } else {
      hex += code.toString(16).padStart(4, "0");
    }
  }
  return `<${hex.toUpperCase()}>`;
}

function pdfDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `(D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z)`;
}

const num = (n) => (Math.round(n * 100) / 100).toString();

/** Assemble pages of { jpg, pxW, pxH, ptW, ptH } into one PDF file. */
function writePdf(pages, title) {
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (part) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id, body, stream = null) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  // Objects: 1 catalog, 2 page tree, 3 info, then three per page.
  const pageIds = pages.map((_, i) => 4 + i * 3);
  // Header, then a comment of high bytes so tools treat the file as binary.
  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  object(1, "<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> >>");
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  object(3, `<< /Producer ${pdfText("SwiftSelect")} /Title ${pdfText(title || "Screenshot")} /CreationDate ${pdfDate()} >>`);

  pages.forEach((pg, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const draw = `q ${num(pg.ptW)} 0 0 ${num(pg.ptH)} 0 0 cm /Im0 Do Q`;
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pg.ptW)} ${num(pg.ptH)}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    object(contentId, `<< /Length ${draw.length} >>`, enc.encode(draw));
    object(
      imageId,
      `<< /Type /XObject /Subtype /Image /Width ${pg.pxW} /Height ${pg.pxH} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpg.length} >>`,
      pg.jpg,
    );
  });

  const total = 4 + pages.length * 3;
  const xrefAt = length;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let id = 1; id < total; id++) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  return new Blob(chunks, { type: "application/pdf" });
}

/**
 * Turn an image (Blob, ImageBitmap or anything createImageBitmap accepts)
 * into a paged PDF. `onProgress(done, total)` reports per page.
 */
export async function imageToPdf(source, { title = "", quality = 0.9, onProgress = null } = {}) {
  const bmp = source instanceof ImageBitmap ? source : await createImageBitmap(source);
  try {
    const width = bmp.width;
    const height = bmp.height;
    if (!width || !height) throw new Error("Empty image");

    // Wider than tall (a horizontal capture, a banner): one landscape page.
    const pagePx = width > height ? height : Math.round((width * PAGE_H_PT) / PAGE_W_PT);
    const plan = planPages(bmp, width, height, pagePx);

    const k = Math.min(1, MAX_SLICE_W / width);
    const ptPerPx = width > height ? PAGE_H_PT / height : PAGE_W_PT / width;
    const pages = [];
    for (let i = 0; i < plan.length; i++) {
      const [y0, y1] = plan[i];
      const sliceH = y1 - y0;
      const outW = Math.max(1, Math.round(width * k));
      const outH = Math.max(1, Math.round(sliceH * k));
      const c = makeCanvas(outW, outH);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff"; // JPEG has no alpha: transparency prints white
      ctx.fillRect(0, 0, outW, outH);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, y0, width, sliceH, 0, 0, outW, outH);
      pages.push({
        jpg: await canvasToJpegBytes(c, quality),
        pxW: outW,
        pxH: outH,
        ptW: width * ptPerPx,
        ptH: sliceH * ptPerPx,
      });
      onProgress?.(i + 1, plan.length);
    }
    return writePdf(pages, title);
  } finally {
    if (bmp !== source) bmp.close?.();
  }
}
