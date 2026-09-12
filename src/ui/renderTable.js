// Black and white cut list renderer.
//
// A pure function of the plan that returns rows and then HTML. The placement
// rows walk the very same sheetPlan.placements array, in the same order, that
// the SVG walks, which is what makes the printed sheet and the diagram agree
// rather than merely resemble each other.

import { coordStr } from '../geometry.js';
import { formatLength } from '../units.js';
import { escapeHtml } from './escape.js';

/**
 * Flat rows for the whole plan.
 *
 * Rows are tagged by `kind`: 'sheet' for a header, 'cut' for one saw step,
 * 'part' for one piece that comes off the sheet.
 *
 * Part rows carry x, y, w, h as canonical strings rather than floats so a
 * comparison against the SVG's data- attributes is an exact string match.
 */
export function cutListRows(plan) {
  const system = plan.displaySystem ?? 'imperial';
  const rows = [];

  for (const materialPlan of plan.materials) {
    for (const sheetPlan of materialPlan.sheets) {
      rows.push({
        kind: 'sheet',
        materialName: materialPlan.name,
        thicknessLabel: materialPlan.thicknessLabel,
        sheetLabel: sheetPlan.label,
        source: sheetPlan.source,
        sizeLabel: `${formatLength(sheetPlan.widthIn, system)} x ${formatLength(sheetPlan.lengthIn, system)}`,
      });

      for (const step of sheetPlan.cuts) {
        rows.push({
          kind: 'cut',
          seq: step.seq,
          cutKind: step.kind,
          measurement: formatLength(step.atIn, system),
          // Identifier first in both columns. Two pieces on the bench can be
          // the same size, so the size alone does not say which one to cut.
          piece: step.pieceBefore.id,
          pieceBefore: `${step.pieceBefore.id} (${formatLength(step.pieceBefore.w, system)} x ${formatLength(step.pieceBefore.h, system)})`,
          pieceAfter: step.pieceAfter
            .map((piece) => `${piece.id} (${formatLength(piece.w, system)} x ${formatLength(piece.h, system)})`)
            .join(' + '),
          note: step.note,
        });
      }

      // Same array, same order as the SVG. Do not sort or filter this.
      for (const placement of sheetPlan.placements) {
        rows.push({
          kind: 'part',
          label: placement.label,
          name: placement.name,
          x: coordStr(placement.x),
          y: coordStr(placement.y),
          w: coordStr(placement.w),
          h: coordStr(placement.h),
          rotated: placement.rotated === true,
          sizeLabel: `${formatLength(placement.w, system)} x ${formatLength(placement.h, system)}`,
        });
      }
    }
  }
  return rows;
}

function sheetHeaderHtml(row) {
  const source = row.source === 'to-buy' ? 'sheet to buy' : 'sheet on hand';
  const thickness = row.thicknessLabel ? ` ${escapeHtml(row.thicknessLabel)}` : '';
  return `<tr class="row-sheet"><th colspan="4" scope="colgroup">`
    + `${escapeHtml(row.materialName)}${thickness}, ${escapeHtml(row.sheetLabel)} `
    + `(${escapeHtml(row.sizeLabel)}, ${source})</th></tr>`;
}

function cutRowHtml(row) {
  return `<tr class="row-cut"><td>${row.seq}</td><td>${escapeHtml(row.cutKind)}</td>`
    + `<td>${escapeHtml(row.measurement)}</td><td>${escapeHtml(row.note)}</td></tr>`;
}

function partRowHtml(row) {
  const turned = row.rotated ? ' (turned)' : '';
  return `<tr class="row-part"><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.name)}</td>`
    + `<td>${escapeHtml(row.sizeLabel)}${turned}</td>`
    + `<td>at ${escapeHtml(row.x)}, ${escapeHtml(row.y)}</td></tr>`;
}

/** The cut list as a print-ready table. Identity is carried by the label, never by color. */
export function cutListHtml(rows) {
  const body = rows.map((row) => {
    if (row.kind === 'sheet') return sheetHeaderHtml(row);
    if (row.kind === 'cut') return cutRowHtml(row);
    return partRowHtml(row);
  }).join('\n');

  return `<table class="cut-list">\n`
    + `<thead><tr><th scope="col">Step</th><th scope="col">Cut</th>`
    + `<th scope="col">Measure</th><th scope="col">Detail</th></tr></thead>\n`
    + `<tbody>\n${body}\n</tbody>\n</table>`;
}
