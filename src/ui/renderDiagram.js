// Color diagram renderer.
//
// A pure function of the plan that returns an SVG string. No DOM APIs, which
// is what lets the parity test parse the real emitted artifact in a plain
// node --test run with no browser.

import { coordStr } from '../geometry.js';
import { formatLength } from '../units.js';
import { escapeHtml } from './escape.js';

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

/** The text block for one placement, centered on the rectangle. */
function labelSvg(placement, layout) {
  const cx = placement.x + placement.w / 2;
  const cy = placement.y + placement.h / 2;
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

/**
 * One sheet as a to-scale SVG.
 *
 * The viewBox is the sheet's real dimensions in inches, so everything inside
 * is drawn in inches and the picture is to scale by construction.
 *
 * The data- attributes are emitted in this fixed order and nothing else may
 * be interleaved among them: data-part, data-x, data-y, data-w, data-h,
 * data-rotated. The parity test parses the emitted SVG with a regex over
 * exactly that order, so reordering them here silently breaks it.
 */
export function sheetSvg(sheetPlan, materialPlan, params) {
  const system = params.displaySystem ?? 'imperial';
  const { widthIn, lengthIn, usable } = sheetPlan;
  const scale = Math.min(widthIn, lengthIn);
  const maxLabelSize = Math.max(0.75, scale / 22);
  const stroke = Math.max(0.05, scale / 400);

  const colors = colorsForSheet(sheetPlan.placements);
  const rects = sheetPlan.placements.map((placement) => {
    const dims = `${formatLength(placement.w, system)} x ${formatLength(placement.h, system)}`
      + (placement.rotated ? ' (turned)' : '');
    const layout = labelLayout({
      label: placement.label,
      name: placement.name,
      dims,
      w: placement.w,
      h: placement.h,
      maxSize: maxLabelSize,
    });
    return [
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
      labelSvg(placement, layout),
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
    rects,
    `\n</svg>`,
  ].join('');
}
