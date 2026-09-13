/**
 * A PDF of the cut plan, written by hand.
 *
 * No library. A PDF is a text container around a drawing language, and
 * everything this plan needs is in that language already: filled and stroked
 * rectangles, straight lines, dashes, and text in one of the fourteen fonts
 * every reader ships with. Pulling in a PDF toolkit would mean 350 KB vendored
 * into a repository whose whole point is that it has no build step, to draw
 * shapes the format draws natively.
 *
 * Coordinates. PDF puts the origin at the bottom left and measures in points,
 * 72 to the inch. Everything below works in points from the top left, the way
 * the rest of this code thinks, and `y()` does the one flip at the end.
 */

import { formatLength } from '../units.js';
import { sourceLabel } from '../ui/renderTable.js';

const PAGE = { w: 612, h: 792 };        // US Letter, portrait, in points
const MARGIN = 36;                       // half an inch
const BODY = PAGE.w - MARGIN * 2;

const FONT = { body: 9, small: 7.5, head: 13, sub: 10.5 };
const LINE = 12;

/** Widths of Helvetica, per 1000 units, for the characters this plan emits. */
const WIDE = new Set('ABCDEFGHKLMNOPQRSTUVWXYZmwDGOQ');
const NARROW = new Set("ijlt.,:;'|!/ ");

/** Close enough to lay out a line without embedding a metrics table. */
function textWidth(text, size) {
  let units = 0;
  for (const ch of String(text)) {
    if (NARROW.has(ch)) units += 280;
    else if (WIDE.has(ch)) units += 700;
    else units += 540;
  }
  return (units / 1000) * size;
}

/** PDF strings are parenthesized, so the delimiters have to be escaped. */
function pdfString(text) {
  return String(text).replace(/([\\()])/g, '\\$1').replace(/[^\x20-\x7E]/g, '?');
}

function num(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

/**
 * One page's drawing operations.
 *
 * Collects content-stream operators and hands back a string. Nothing here
 * knows about the plan; it is only a pen.
 */
function page() {
  const ops = [];
  const y = (top) => num(PAGE.h - top);

  return {
    ops,
    text(value, left, top, { size = FONT.body, bold = false, gray = 0 } = {}) {
      const font = bold ? '/F2' : '/F1';
      ops.push(`BT ${font} ${size} Tf ${gray} ${gray} ${gray} rg ${num(left)} ${y(top + size)} Td (${pdfString(value)}) Tj ET`);
    },
    textRight(value, right, top, options = {}) {
      this.text(value, right - textWidth(value, options.size ?? FONT.body), top, options);
    },
    rect(left, top, w, h, { fill = null, stroke = null, width = 0.6 } = {}) {
      if (fill !== null) ops.push(`${fill} ${fill} ${fill} rg ${num(left)} ${y(top + h)} ${num(w)} ${num(h)} re f`);
      if (stroke !== null) {
        ops.push(`${stroke} ${stroke} ${stroke} RG ${num(width)} w ${num(left)} ${y(top + h)} ${num(w)} ${num(h)} re S`);
      }
    },
    line(x1, top1, x2, top2, { gray = 0, width = 0.5, dash = null } = {}) {
      ops.push(`${gray} ${gray} ${gray} RG ${num(width)} w ${dash ? `[${dash}] 0 d` : '[] 0 d'}`);
      ops.push(`${num(x1)} ${y(top1)} m ${num(x2)} ${y(top2)} l S`);
      ops.push('[] 0 d');
    },
    /** An empty box to tick with a pencil. */
    checkbox(left, top, size = 7.5) {
      this.rect(left, top, size, size, { stroke: 0, width: 0.6 });
    },
  };
}

/** The sheet diagram, scaled into a box, in the same monochrome as print. */
function drawSheetAt(pg, sheetPlan, left, top, scale, system) {
  const w = sheetPlan.widthIn * scale;
  const h = sheetPlan.lengthIn * scale;

  pg.rect(left, top, w, h, { stroke: 0, width: 1 });

  for (const placement of sheetPlan.placements) {
    const px = left + placement.x * scale;
    const py = top + placement.y * scale;
    const pw = placement.w * scale;
    const ph = placement.h * scale;
    // Outlined, never filled: a part is told apart by its label, exactly as on
    // the printed page, so this reads the same off a mono laser printer.
    pg.rect(px, py, pw, ph, { fill: 0.93, stroke: 0, width: 0.6 });
    const label = placement.label;
    if (textWidth(label, FONT.small) < pw - 4 && ph > FONT.small + 4) {
      pg.text(label, px + (pw - textWidth(label, FONT.small)) / 2, py + (ph - FONT.small) / 2, { size: FONT.small, bold: true });
    }
  }

  // Cut lines, dashed, each carrying its measurement. No step number: the
  // screen dropped it for reading as a second number competing with the one
  // that matters, and paper has the same problem.
  for (const step of sheetPlan.cuts) {
    const across = step.axis === 'v';
    const x1 = left + (across ? step.lineIn : step.fromIn) * scale;
    const x2 = left + (across ? step.lineIn : step.toIn) * scale;
    const y1 = top + (across ? step.fromIn : step.lineIn) * scale;
    const y2 = top + (across ? step.toIn : step.lineIn) * scale;
    pg.line(x1, y1, x2, y2, { gray: 0, width: 0.7, dash: '3 2' });

    const tag = formatLength(step.atIn, system);
    const tw = textWidth(tag, FONT.small);
    let tx = across ? x1 + 2 : x1 + 2;
    let ty = across ? y1 + 2 : y1 - FONT.small - 1;
    tx = Math.min(Math.max(tx, left), left + w - tw);
    ty = Math.min(Math.max(ty, top), top + h - FONT.small);
    pg.text(tag, tx, ty, { size: FONT.small, bold: true });
  }

  return h;
}

/**
 * The whole plan as a PDF byte array.
 *
 * One page per sheet, so a page is a thing you carry to the saw, plus a first
 * page for the shopping list when there is something to buy.
 */
export function buildPdf(plan, { title = 'cutlist' } = {}) {
  const system = plan.displaySystem ?? 'imperial';
  const pages = [];

  // Everything flows down a page and breaks only when the next block will not
  // fit. A page per sheet left two thirds of most of them white, which for a
  // plan you print and tape to a wall is just paper.
  const widest = plan.widestSheetIn || 48;
  let pg = null;
  let top = MARGIN;

  const startPage = () => {
    pg = page();
    top = MARGIN;
    pg.text(title, MARGIN, top, { size: FONT.head, bold: true });
    top += FONT.head + 10;
    pages.push(pg);
  };

  const room = (height) => {
    if (pg === null || top + height > PAGE.h - MARGIN) startPage();
  };

  if (plan.shoppingList.length > 0) {
    room(FONT.sub + 10 + plan.shoppingList.length * (LINE + 2));
    pg.text('Shopping list', MARGIN, top, { size: FONT.sub, bold: true });
    top += FONT.sub + 6;

    for (const entry of plan.shoppingList) {
      const thickness = entry.thicknessLabel ? ` (${entry.thicknessLabel})` : '';
      pg.checkbox(MARGIN, top);
      pg.text(
        `${entry.qty} sheet${entry.qty === 1 ? '' : 's'} of ${entry.name}${thickness}, `
        + `${formatLength(entry.widthIn, system)} x ${formatLength(entry.lengthIn, system)}`,
        MARGIN + 13, top,
      );
      top += LINE + 2;
    }
    top += 8;
  }

  if (plan.notes) {
    const rows = String(plan.notes).split('\n').flatMap((line) => wrap(line, BODY, FONT.small));
    room(FONT.sub + 8 + rows.length * (FONT.small + 2));
    pg.text('Notes', MARGIN, top, { size: FONT.sub, bold: true });
    top += FONT.sub + 4;
    for (const row of rows) {
      pg.text(row, MARGIN, top, { size: FONT.small, gray: 0.25 });
      top += FONT.small + 2;
    }
    top += 10;
  }

  for (const materialPlan of plan.materials) {
    for (const sheetPlan of materialPlan.sheets) {
      const thickness = materialPlan.thicknessLabel ? ` (${materialPlan.thicknessLabel})` : '';

      // Every diagram at the same inches per point, measured against the widest
      // sheet in the project, so a 24 in panel is visibly half a 48 in one and
      // 25 in is the same length of line on every picture.
      const fullW = BODY * 0.56;
      const perInch = fullW / widest;
      const drawW = sheetPlan.widthIn * perInch;
      const drawH = sheetPlan.lengthIn * perInch;

      const rows = sheetPlan.cuts.length + sheetPlan.placements.length * 2;
      const columnH = FONT.small * 2 + 20 + rows * LINE;
      const blockH = FONT.sub + 8 + Math.max(drawH, columnH) + 18;

      room(blockH);

      pg.text(`${materialPlan.name}${thickness} \u2014 ${sheetPlan.label} (${sourceLabel(sheetPlan.source)})`
        .replace('\u2014', '-'), MARGIN, top, { size: FONT.sub, bold: true });
      top += FONT.sub + 8;

      drawSheetAt(pg, sheetPlan, MARGIN, top, perInch, system);

      const colX = MARGIN + fullW + 18;
      let colTop = top;

      pg.text('CUTS', colX, colTop, { size: FONT.small, bold: true, gray: 0.35 });
      colTop += FONT.small + 5;
      for (const step of sheetPlan.cuts) {
        pg.text(`${step.seq}.`, colX, colTop, { size: FONT.small, gray: 0.4 });
        const at = formatLength(step.atIn, system);
        pg.text(at, colX + 15, colTop, { bold: true });
        pg.text(`from ${step.referenceEdge}`, colX + 15 + textWidth(at, FONT.body) + 5, colTop, { size: FONT.small, gray: 0.35 });
        colTop += LINE;
      }

      colTop += 6;
      pg.text('PARTS', colX, colTop, { size: FONT.small, bold: true, gray: 0.35 });
      colTop += FONT.small + 5;
      for (const placement of sheetPlan.placements) {
        pg.checkbox(colX, colTop);
        pg.text(placement.label, colX + 12, colTop, { bold: true, size: FONT.small });
        pg.text(placement.name, colX + 12 + textWidth(placement.label, FONT.small) + 4, colTop, { size: FONT.small });
        colTop += LINE - 2;
        pg.text(`${formatLength(placement.w, system)} x ${formatLength(placement.h, system)}`,
          colX + 12, colTop, { size: FONT.small, gray: 0.4 });
        colTop += LINE - 1;
      }

      let bottom = Math.max(top + drawH, colTop);
      if ((sheetPlan.offcuts ?? []).length > 0) {
        bottom += 4;
        const text = 'Left over: ' + sheetPlan.offcuts
          .map((offcut) => `${formatLength(offcut.w, system)} x ${formatLength(offcut.h, system)}`)
          .join(', ');
        for (const row of wrap(text, BODY, FONT.small)) {
          pg.text(row, MARGIN, bottom, { size: FONT.small, gray: 0.4 });
          bottom += FONT.small + 2;
        }
      }

      top = bottom + 16;
      pg.line(MARGIN, top - 8, PAGE.w - MARGIN, top - 8, { gray: 0.75, width: 0.4 });
    }
  }

  if (pages.length === 0) {
    const pg = page();
    pg.text(title, MARGIN, MARGIN, { size: FONT.head, bold: true });
    pg.text('This project has no sheets to lay out yet.', MARGIN, MARGIN + 24);
    pages.push(pg);
  }

  return assemble(pages);
}

/** Break a line to a width, on spaces. */
function wrap(text, width, size) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const rows = [];
  let row = '';
  for (const word of words) {
    const candidate = row === '' ? word : `${row} ${word}`;
    if (textWidth(candidate, size) > width && row !== '') {
      rows.push(row);
      row = word;
    } else {
      row = candidate;
    }
  }
  if (row !== '') rows.push(row);
  return rows;
}

/**
 * Wrap the drawn pages in the PDF file structure.
 *
 * Objects are numbered from 1 and the cross reference table records the byte
 * offset of each, which is why the body is built before the table rather than
 * alongside it.
 */
function assemble(pages) {
  const encoder = new TextEncoder();
  const objects = [];

  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  const boldId = 3 + pages.length * 2 + 1;

  pages.forEach((pg, i) => {
    const id = pageIds[i];
    const contentId = id + 1;
    const body = pg.ops.join('\n');
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] `
      + `/Resources << /Font << /F1 3 0 R /F2 ${boldId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${encoder.encode(body).length} >>\nstream\n${body}\nendstream`;
  });
  objects[boldId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objects.length; id += 1) {
    if (objects[id] === undefined) continue;
    offsets[id] = encoder.encode(out).length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }

  const xrefAt = encoder.encode(out).length;
  const count = objects.length;
  out += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id += 1) {
    const at = offsets[id] ?? 0;
    out += `${String(at).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return encoder.encode(out);
}
