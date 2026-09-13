// Color diagram renderer.
//
// A pure function of the plan that returns an SVG string. No DOM APIs, which
// is what lets the parity test parse the real emitted artifact in a plain
// node --test run with no browser.

import { coordStr } from '../geometry.js';
import { formatLength } from '../units.js';
import { escapeHtml } from './escape.js';
import { sheetKey } from './renderTable.js';

// Distinct enough to tell apart under shop lighting, and all dark enough to
// carry white label text.
const PART_COLORS = Object.freeze([
  '#2f6f9f', '#b1591f', '#3f7f4f', '#8a4f9e', '#a03b4f',
  '#4f5f8f', '#6f7a2f', '#1f6f7f', '#8f4f2f', '#5f4f9f',
]);

// Everything inside the SVG is drawn in inches, so these are inches too. A
// label has to fit the part it names, not the sheet: a sheet-wide font size
// spills a small part's name across its neighbors and makes the group of
// small parts impossible to check by eye.
const CHAR_ASPECT = 0.6;   // advance width of one character, as a fraction of the font size
const FILL = 0.9;          // fraction of a rectangle that text is allowed to occupy
const LINE_GAP = 1.05;     // baseline to baseline, as a fraction of the font size
const DIM_RATIO = 0.7;     // the dimension line, relative to the label line
const MIN_LABEL_IN = 0.5;  // below this, dropping content beats shrinking further
const SIZE_SEARCH_STEPS = 24;
const MIN_SCRAP_IN = 2;    // a leftover narrower than this is not worth naming on the picture
const EDGE_GUTTER = 1.3;   // clear space kept at an edge that carries a dimension, in font sizes
const EDGE_ROOM = 4;       // a dimension needs this many font sizes across the part it sits on
const MARK_PAD = 0.15;     // clear space kept around a cut step number, in font sizes

/**
 * One color per distinct part on this sheet, assigned in placement order.
 *
 * Indexing by first appearance rather than hashing the id means two different
 * parts on the same sheet never collide on a color, which is the whole point
 * of coloring them. Every copy of the same part keeps the same color.
 */
function colorsForSheet(placements) {
  const colors = new Map();
  for (const placement of placements) {
    if (!colors.has(placement.partId)) {
      colors.set(placement.partId, PART_COLORS[colors.size % PART_COLORS.length]);
    }
  }
  return colors;
}

/** How wide `text` runs at `size`, in inches. */
function textWidth(text, size) {
  return text.length * size * CHAR_ASPECT;
}

/** Greedy word wrap. Words are never broken, so an identifier stays readable. */
function wrapToWidth(words, boxW, size) {
  const maxChars = Math.max(1, Math.floor((boxW * FILL) / (size * CHAR_ASPECT)));
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current !== '') lines.push(current);
    current = word;
  }
  if (current !== '') lines.push(current);
  return lines.length === 0 ? [''] : lines;
}

/** True when the wrapped block, plus the dimension line, stays inside w x h. */
function blockFits({ lines, dims, size, w, h }) {
  for (const line of lines) {
    if (textWidth(line, size) > w * FILL) return false;
  }
  if (dims !== '' && textWidth(dims, size * DIM_RATIO) > w * FILL) return false;
  const rows = lines.length + (dims === '' ? 0 : DIM_RATIO);
  return rows * size * LINE_GAP <= h * FILL;
}

/**
 * The largest font size at or below `maxSize` whose wrapped block fits the
 * box, or 0 when even the smallest legible size does not fit.
 *
 * Fitting gets easier as the size shrinks (more characters per line, fewer
 * lines, less height), so bisection converges on the boundary.
 */
function largestSizeThatFits({ words, dims, w, h, maxSize }) {
  const fitsAt = (size) => blockFits({ lines: wrapToWidth(words, w, size), dims, size, w, h });
  if (fitsAt(maxSize)) return maxSize;
  if (!fitsAt(MIN_LABEL_IN)) return 0;

  let low = MIN_LABEL_IN;
  let high = maxSize;
  for (let step = 0; step < SIZE_SEARCH_STEPS; step += 1) {
    const mid = (low + high) / 2;
    if (fitsAt(mid)) low = mid;
    else high = mid;
  }
  return low;
}

/**
 * Keep the identifier and trim the name to whatever still fits beside it.
 *
 * The identifier is what ties a drawn rectangle to a row in the cut list, so
 * it is the last thing to go.
 */
function truncateToWidth(text, label, boxW, size) {
  const maxChars = Math.floor((boxW * FILL) / (size * CHAR_ASPECT));
  if (text.length <= maxChars) return text;
  if (maxChars <= label.length + 1) return label;
  return `${text.slice(0, maxChars - 1)}…`;
}

/**
 * How one placement's text is laid out inside its own rectangle.
 *
 * Returns raw (unescaped) strings; the caller escapes them on the way into the
 * SVG. Escaping first would count entity characters against the line width.
 */
export function labelLayout({ label, name, dims, w, h, maxSize }) {
  const text = `${label} ${name}`.trim();
  const words = text.split(/\s+/);

  const sized = largestSizeThatFits({ words, dims, w, h, maxSize });
  if (sized > 0) {
    return { lines: wrapToWidth(words, w, sized), size: sized, dims, dimsSize: sized * DIM_RATIO };
  }

  // The cut list prints the dimensions too, so they are what we give up first.
  const bare = largestSizeThatFits({ words, dims: '', w, h, maxSize });
  if (bare > 0) {
    return { lines: wrapToWidth(words, w, bare), size: bare, dims: '', dimsSize: 0 };
  }

  return {
    lines: [truncateToWidth(text, label, w, MIN_LABEL_IN)],
    size: MIN_LABEL_IN,
    dims: '',
    dimsSize: 0,
  };
}

/** The text block for one placement, centered in the box left for it. */
function labelSvg(box, layout) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rows = layout.lines.length + (layout.dims === '' ? 0 : DIM_RATIO);
  const step = layout.size * LINE_GAP;
  // Baselines run downward from the top of a block centered on cy, offset by
  // roughly one cap height so the block reads as vertically centered.
  let baseline = cy - (rows * step) / 2 + layout.size * 0.8;

  const elements = layout.lines.map((line) => {
    const element = `    <text class="cut-label" x="${coordStr(cx)}" y="${coordStr(baseline)}"`
      + ` font-size="${coordStr(layout.size)}" text-anchor="middle">${escapeHtml(line)}</text>`;
    baseline += step;
    return element;
  });

  if (layout.dims !== '') {
    elements.push(
      `    <text class="cut-dims" x="${coordStr(cx)}" y="${coordStr(baseline)}"`
      + ` font-size="${coordStr(layout.dimsSize)}" text-anchor="middle">${escapeHtml(layout.dims)}</text>`,
    );
  }
  return elements.join('\n');
}

/** Do two rectangles share any area? */
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Where every cut step number on this sheet is drawn, with the box its text
 * occupies.
 *
 * Worked out before any part label is laid out, because the two passes write
 * into the same picture and neither can see the other: a step number stamped
 * over a part name leaves both unreadable, and on a narrow strip that is
 * exactly where a number lands. The number keeps its place -- it is what a
 * person is looking for at the saw -- and the name is moved aside instead.
 *
 * A number is nudged clear of its line, and sits at the end of the line the
 * measurement is taken from rather than at its midpoint: an edge dimension is
 * centered on its own edge, and a cut line very often runs exactly along one.
 */
function stepNumberMarks(sheetPlan, scale, system, widthIn, lengthIn) {
  const size = Math.max(0.6, scale / 28);
  return sheetPlan.cuts.map((step) => {
    const acrossX = step.axis === 'v';
    // The measurement rides with the step number, on the line it belongs to.
    // A part's own dimensions are already on the parts list; what cannot be
    // read anywhere else is where the saw goes, and that is a property of the
    // line, not of the box beside it.
    const text = `${step.seq}. ${formatLength(step.atIn, system)}`;
    const width = textWidth(text, size) + 2 * size * MARK_PAD;

    // The label is centered on its anchor, so a cut that starts at an edge puts
    // half the text outside the viewBox and the browser simply clips it: "2. 25
    // 1/2 in" arrived reading "5 1/2 in". Nudge the anchor back inside by
    // however much hangs over, which moves the label along its own line rather
    // than away from it.
    const clamp = (value, half, limit) => Math.min(Math.max(value, half), Math.max(half, limit - half));
    const x = clamp(acrossX ? step.lineIn + size * 0.7 : step.fromIn + size, width / 2, widthIn);
    const y = clamp(acrossX ? step.fromIn + size : step.lineIn - size * 0.5, size, lengthIn);

    return {
      step,
      text,
      x,
      y,
      size,
      // Baseline sits at y, so the glyphs run from one cap height above it to a
      // descender below; the pad is what keeps a name from touching the number
      // rather than merely missing it.
      box: {
        x: x - width / 2,
        y: y - size * (0.8 + MARK_PAD),
        w: width,
        h: size * (1 + 2 * MARK_PAD),
      },
    };
  });
}

/** How much room a box has for text, in square inches. */
function boxArea(box) {
  return Math.max(0, box.w) * Math.max(0, box.h);
}

/**
 * The part of `box` that no cut step number is written into.
 *
 * Each colliding number is escaped by pulling in the one side that leaves the
 * most room behind, so the name ends up beside the number instead of under it
 * and keeps as much of its rectangle as the number allows. Biggest remainder
 * rather than smallest trim is what saves the name on a narrow strip: there,
 * clearing the number sideways leaves a column too narrow for any word, while
 * clearing it downward leaves most of the part.
 */
function clearOfMarks(box, marks) {
  let clear = box;
  for (const mark of marks) {
    if (!overlaps(clear, mark.box)) continue;
    const below = mark.box.y + mark.box.h;
    const right = mark.box.x + mark.box.w;
    clear = [
      { x: clear.x, y: below, w: clear.w, h: clear.y + clear.h - below },
      { x: clear.x, y: clear.y, w: clear.w, h: mark.box.y - clear.y },
      { x: right, y: clear.y, w: clear.x + clear.w - right, h: clear.h },
      { x: clear.x, y: clear.y, w: mark.box.x - clear.x, h: clear.h },
    ].reduce((best, option) => (boxArea(option) > boxArea(best) ? option : best));
    clear = { ...clear, w: Math.max(0, clear.w), h: Math.max(0, clear.h) };
  }
  return clear;
}

/**
 * The numbered cut lines, drawn over the parts.
 *
 * Each line spans the full extent of the piece that step cuts, which is what
 * makes it a guillotine cut you can see: it runs edge to edge of that piece and
 * nothing stops halfway. Faint by default; app.js bolds the active one on
 * screen and print.css forces them all to black.
 */
function cutLinesSvg(marks, key, scale) {
  if (marks.length === 0) return '';
  const width = Math.max(0.03, scale / 500);
  const dash = `${coordStr(scale / 60)} ${coordStr(scale / 90)}`;

  const parts = marks.map(({ step, x, y, size, text }) => {
    const acrossX = step.axis === 'v';
    const x1 = acrossX ? step.lineIn : step.fromIn;
    const x2 = acrossX ? step.lineIn : step.toIn;
    const y1 = acrossX ? step.fromIn : step.lineIn;
    const y2 = acrossX ? step.toIn : step.lineIn;
    return `    <line class="cut-line" data-step="${step.seq}" data-sheet="${escapeHtml(key)}"`
      + ` x1="${coordStr(x1)}" y1="${coordStr(y1)}" x2="${coordStr(x2)}" y2="${coordStr(y2)}"`
      + ` stroke="#111" stroke-width="${coordStr(width)}" stroke-dasharray="${dash}" />\n`
      + `    <text class="cut-step-no" data-step="${step.seq}" data-sheet="${escapeHtml(key)}"`
      + ` x="${coordStr(x)}" y="${coordStr(y)}" font-size="${coordStr(size)}"`
      + ` text-anchor="middle">${escapeHtml(text)}</text>`;
  }).join('\n');

  return `  <g class="cut-lines">\n${parts}\n  </g>\n`;
}

/**
 * One label per leftover, naming its size where it actually lies.
 *
 * Read straight off sheetPlan.offcuts, the same array the per-sheet leftover
 * summary reads, so the picture and the words cannot disagree.
 */
function scrapLabelsSvg(sheetPlan, system, maxLabelSize) {
  const size = maxLabelSize * DIM_RATIO;
  const labels = (sheetPlan.offcuts ?? [])
    .filter((offcut) => Math.min(offcut.w, offcut.h) >= MIN_SCRAP_IN)
    .map((offcut) => {
      const text = `${formatLength(offcut.w, system)} x ${formatLength(offcut.h, system)}`;
      if (textWidth(text, size) > offcut.w * FILL) return '';
      if (size * LINE_GAP > offcut.h * FILL) return '';
      return `    <text class="scrap-label" x="${coordStr(offcut.x + offcut.w / 2)}"`
        + ` y="${coordStr(offcut.y + offcut.h / 2)}" font-size="${coordStr(size)}"`
        + ` text-anchor="middle">${escapeHtml(text)}</text>`;
    })
    .filter((element) => element !== '');

  if (labels.length === 0) return '';
  return `  <g class="scrap-labels">\n${labels.join('\n')}\n  </g>\n`;
}



/**
 * One sheet as a to-scale SVG, in explicit layers.
 *
 * The viewBox is the sheet's real dimensions in inches, so everything inside
 * is drawn in inches and the picture is to scale by construction.
 *
 * Layer order is deliberate: the sheet, then one group per part, then the cut
 * lines, the scrap labels and the edge dimensions on top, so a numbered cut
 * line is never hidden under a part it crosses.
 *
 * The data- attributes on a part rectangle are emitted in this fixed order and
 * nothing else may be interleaved among them: data-part, data-x, data-y,
 * data-w, data-h, data-rotated. The parity test parses the emitted SVG with a
 * regex over exactly that order, so reordering them here silently breaks it.
 */
export function sheetSvg(sheetPlan, materialPlan, params) {
  const system = params.displaySystem ?? 'imperial';
  const { widthIn, lengthIn, usable } = sheetPlan;
  const scale = Math.min(widthIn, lengthIn);
  const maxLabelSize = Math.max(0.75, scale / 22);
  const stroke = Math.max(0.05, scale / 400);
  const key = sheetKey(materialPlan, sheetPlan, materialPlan.sheets.indexOf(sheetPlan));

  const colors = colorsForSheet(sheetPlan.placements);
  const marks = stepNumberMarks(sheetPlan, scale, system, widthIn, lengthIn);
  const blocks = sheetPlan.placements.map((placement) => {
    // A part carries its name and nothing else. Its size is on the parts list
    // beside the diagram, and writing it along the edges put faint text over a
    // saturated fill where it could not be read. The whole rectangle is
    // available to the name now, minus whatever the cut labels sit on.
    const box = clearOfMarks({
      x: placement.x,
      y: placement.y,
      w: placement.w,
      h: placement.h,
    }, marks);
    const layout = labelLayout({
      label: placement.label,
      name: placement.name,
      dims: '',
      w: box.w,
      h: box.h,
      maxSize: maxLabelSize,
    });
    return [
      `  <g class="part-block">\n`,
      `    <rect class="cut-rect"`,
      ` data-part="${escapeHtml(placement.label)}"`,
      ` data-x="${coordStr(placement.x)}"`,
      ` data-y="${coordStr(placement.y)}"`,
      ` data-w="${coordStr(placement.w)}"`,
      ` data-h="${coordStr(placement.h)}"`,
      ` data-rotated="${placement.rotated === true}"`,
      ` x="${coordStr(placement.x)}" y="${coordStr(placement.y)}"`,
      ` width="${coordStr(placement.w)}" height="${coordStr(placement.h)}"`,
      ` fill="${colors.get(placement.partId)}" stroke="#111" stroke-width="${coordStr(stroke)}" />\n`,
      labelSvg(box, layout),
      `\n  </g>`,
    ].join('');
  }).join('\n');

  return [
    `<svg class="sheet-svg" viewBox="0 0 ${coordStr(widthIn)} ${coordStr(lengthIn)}"`,
    ` preserveAspectRatio="xMidYMid meet" width="100%"`,
    ` role="img" aria-label="${escapeHtml(`${sheetPlan.label}, ${materialPlan.name}`)}">\n`,
    `    <rect class="sheet-edge" x="0" y="0" width="${coordStr(widthIn)}" height="${coordStr(lengthIn)}"`,
    ` fill="#fdfdfb" stroke="#111" stroke-width="${coordStr(stroke * 2)}" />\n`,
    `    <rect class="sheet-usable" x="${coordStr(usable.x)}" y="${coordStr(usable.y)}"`,
    ` width="${coordStr(usable.w)}" height="${coordStr(usable.h)}"`,
    ` fill="none" stroke="#999" stroke-dasharray="${coordStr(stroke * 6)}" stroke-width="${coordStr(stroke)}" />\n`,
    blocks,
    `\n`,
    cutLinesSvg(marks, key, scale),
    scrapLabelsSvg(sheetPlan, system, maxLabelSize),
    `</svg>`,
  ].join('');
}
