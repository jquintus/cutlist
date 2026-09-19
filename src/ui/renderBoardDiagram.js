// One-dimensional board diagram renderer.
//
// Length is the only scaled axis. The bar has a fixed drawing height so a
// 3/4-inch-wide board does not become an unreadable hairline beside a sheet.

import { coordStr } from '../geometry.js';
import { formatLength } from '../units.js';
import { escapeHtml } from './escape.js';
import { boardKey } from './renderTable.js';

const BAR_TOP = 4;
const BAR_HEIGHT = 8;
const VIEW_HEIGHT = 19;

/** A proportional bar with every finished length and crosscut marked. */
export function boardSvg(boardPlan, materialPlan, system = 'imperial', index = materialPlan.boards.indexOf(boardPlan)) {
  const length = Math.max(1, boardPlan.lengthIn);
  const key = boardKey(materialPlan, boardPlan, index);
  const fontSize = Math.max(0.7, Math.min(2.2, length / 38));
  const stroke = Math.max(0.08, length / 900);

  const parts = boardPlan.placements.map((placement, placementIndex) => {
    const center = placement.startIn + placement.lengthIn / 2;
    const text = `${placement.label} ${placement.name}`.trim();
    const estimatedWidth = text.length * fontSize * 0.58;
    const label = estimatedWidth <= placement.lengthIn * 0.88
      ? `<text class="board-part-label" x="${coordStr(center)}" y="${coordStr(BAR_TOP + BAR_HEIGHT / 2 + fontSize * 0.35)}" font-size="${coordStr(fontSize)}" text-anchor="middle">${escapeHtml(text)}</text>`
      : `<text class="board-part-label" x="${coordStr(center)}" y="${coordStr(BAR_TOP + BAR_HEIGHT / 2 + fontSize * 0.35)}" font-size="${coordStr(fontSize)}" text-anchor="middle">${escapeHtml(placement.label)}</text>`;
    return `<g class="board-part-block">
  <rect class="board-part" data-part="${escapeHtml(placement.label)}" data-start="${coordStr(placement.startIn)}" data-length="${coordStr(placement.lengthIn)}" x="${coordStr(placement.startIn)}" y="${BAR_TOP}" width="${coordStr(placement.lengthIn)}" height="${BAR_HEIGHT}" fill="${placementIndex % 2 === 0 ? '#dce8f1' : '#eef3f6'}" stroke="#111" stroke-width="${coordStr(stroke)}" />
  ${label}
</g>`;
  }).join('\n');

  const cuts = boardPlan.cuts.map((step) => {
    const x = Math.min(length, Math.max(0, step.lineIn));
    const anchor = x > length * 0.86 ? 'end' : x < length * 0.14 ? 'start' : 'middle';
    return `<g class="board-cut-mark">
  <line class="board-cut-line cut-line" data-step="${escapeHtml(step.seq)}" data-sheet="${escapeHtml(key)}" x1="${coordStr(x)}" y1="${BAR_TOP - 1}" x2="${coordStr(x)}" y2="${BAR_TOP + BAR_HEIGHT + 1}" stroke="#555" stroke-width="${coordStr(stroke * 1.5)}" />
  <text class="board-cut-label cut-step-no" data-step="${escapeHtml(step.seq)}" data-sheet="${escapeHtml(key)}" x="${coordStr(x)}" y="${VIEW_HEIGHT - 1}" font-size="${coordStr(fontSize * 0.85)}" text-anchor="${anchor}">${escapeHtml(formatLength(step.atIn, system))}</text>
</g>`;
  }).join('\n');

  const usableStart = boardPlan.usable?.startIn ?? 0;
  const usableLength = boardPlan.usable?.lengthIn ?? boardPlan.lengthIn;
  const usable = usableStart > 0 || usableLength < boardPlan.lengthIn
    ? `<rect class="board-usable" x="${coordStr(usableStart)}" y="${BAR_TOP}" width="${coordStr(usableLength)}" height="${BAR_HEIGHT}" fill="none" stroke="#777" stroke-dasharray="${coordStr(stroke * 5)}" stroke-width="${coordStr(stroke)}" />\n`
    : '';

  return `<svg class="board-svg" viewBox="0 0 ${coordStr(length)} ${VIEW_HEIGHT}" preserveAspectRatio="xMidYMid meet" width="100%" role="img" aria-label="${escapeHtml(`${boardPlan.label}, ${materialPlan.name}`)}">
  <rect class="board-edge" x="0" y="${BAR_TOP}" width="${coordStr(boardPlan.lengthIn)}" height="${BAR_HEIGHT}" fill="#fdfdfb" stroke="#111" stroke-width="${coordStr(stroke * 2)}" />
  ${usable}${parts}
  ${cuts}
</svg>`;
}
