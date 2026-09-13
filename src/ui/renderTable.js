// The per-sheet to-do list: what to cut, then what to tick off.
//
// A pure function of the plan that returns rows and then HTML. The part rows
// walk the very same sheetPlan.placements array, in the same order, that the
// SVG walks, which is what makes the printed sheet and the diagram agree
// rather than merely resemble each other.
//
// Nothing a person reads here carries an internal piece identifier or a raw
// coordinate. Part rows still hold the canonical coordinate strings, because
// that is what the parity test compares against the SVG's data- attributes,
// but those strings are never written into the markup.

import { coordStr } from '../geometry.js';
import { formatLength } from '../units.js';
import { escapeHtml } from './escape.js';

/** How many leftovers are worth naming before the list stops being useful. */
const LEFTOVERS_SHOWN = 3;

/**
 * The key that ties one sheet's cut list to that sheet's diagram.
 *
 * Spelled once, here, and imported by the diagram and by app.js, because a
 * hover highlight that matches the wrong sheet is worse than no highlight.
 */
export function sheetKey(materialPlan, sheetPlan, index) {
  return `${materialPlan.materialId}:${sheetPlan.sheetSpecId}:${index}`;
}

function sizeLabel(w, h, system) {
  return `${formatLength(w, system)} x ${formatLength(h, system)}`;
}

/**
 * How a sheet's `source` reads in prose.
 *
 * Spelled once and imported wherever a sheet's source needs to be said in
 * words, so the to-do list and the diagram's own heading cannot drift apart
 * on the wording.
 */
export function sourceLabel(source) {
  return source === 'to-buy' ? 'sheet to buy' : 'sheet on hand';
}

/**
 * Rows for one sheet: its header, one row per saw step, one row per part that
 * comes off it, and up to three leftover rows.
 *
 * Rows are tagged by `kind`: 'sheet', 'cut', 'part', 'leftover'.
 */
export function sheetRows(
  sheetPlan,
  materialPlan,
  system,
  index = materialPlan.sheets.indexOf(sheetPlan),
) {
  const key = sheetKey(materialPlan, sheetPlan, index);
  const rows = [{
    kind: 'sheet',
    sheetKey: key,
    materialName: materialPlan.name,
    thicknessLabel: materialPlan.thicknessLabel,
    sheetLabel: sheetPlan.label,
    source: sheetPlan.source,
    sizeLabel: sizeLabel(sheetPlan.widthIn, sheetPlan.lengthIn, system),
  }];

  for (const step of sheetPlan.cuts) {
    rows.push({
      kind: 'cut',
      sheetKey: key,
      seq: step.seq,
      cutKind: step.kind,
      measurement: formatLength(step.atIn, system),
      note: step.note,
    });
  }

  // Same array, same order as the SVG. Do not sort or filter this.
  for (const placement of sheetPlan.placements) {
    rows.push({
      kind: 'part',
      sheetKey: key,
      label: placement.label,
      name: placement.name,
      x: coordStr(placement.x),
      y: coordStr(placement.y),
      w: coordStr(placement.w),
      h: coordStr(placement.h),
      rotated: placement.rotated === true,
      sizeLabel: sizeLabel(placement.w, placement.h, system),
    });
  }

  for (const offcut of (sheetPlan.offcuts ?? []).slice(0, LEFTOVERS_SHOWN)) {
    rows.push({
      kind: 'leftover',
      sheetKey: key,
      sizeLabel: sizeLabel(offcut.w, offcut.h, system),
    });
  }

  return rows;
}

/** Flat rows for the whole plan: every sheet's rows, in plan order. */
export function cutListRows(plan) {
  const system = plan.displaySystem ?? 'imperial';
  const rows = [];
  for (const materialPlan of plan.materials) {
    materialPlan.sheets.forEach((sheetPlan, index) => {
      rows.push(...sheetRows(sheetPlan, materialPlan, system, index));
    });
  }
  return rows;
}

function cutItemHtml(row) {
  return `<li data-step="${row.seq}" data-sheet="${escapeHtml(row.sheetKey)}">`
    + `${escapeHtml(row.note)}</li>`;
}

function partItemHtml(row) {
  const turned = row.rotated ? ' (turned)' : '';
  return '<li><label><input type="checkbox" />'
    + ` <strong>${escapeHtml(row.label)}</strong> - ${escapeHtml(row.name)}`
    + ` - ${escapeHtml(row.sizeLabel)}${turned}</label></li>`;
}

function leftoverHtml(rows) {
  if (rows.length === 0) return '';
  const sizes = rows.map((row) => escapeHtml(row.sizeLabel)).join(', ');
  const word = rows.length === 1 ? 'Leftover' : 'Leftovers';
  return `<p class="leftover">${word} from this sheet: ${sizes}.</p>`;
}

/**
 * One sheet's section, built from that sheet's rows.
 *
 * The single implementation behind both entry points below, so the whole-plan
 * list and a sheet rendered under its own diagram cannot drift apart.
 */
function sectionHtml(rows) {
  const header = rows.find((row) => row.kind === 'sheet');
  const cuts = rows.filter((row) => row.kind === 'cut');
  const parts = rows.filter((row) => row.kind === 'part');
  const leftovers = rows.filter((row) => row.kind === 'leftover');

  const thickness = header.thicknessLabel ? ` ${escapeHtml(header.thicknessLabel)}` : '';
  const title = `${escapeHtml(header.materialName)}${thickness}, ${escapeHtml(header.sheetLabel)}`
    + ` (${escapeHtml(header.sizeLabel)}, ${sourceLabel(header.source)})`;

  return `<section class="sheet-todo" data-sheet="${escapeHtml(header.sheetKey)}">
  <h3 class="sheet-todo-title">${title}</h3>
  <h4>CUTS</h4>
  <ol class="cuts">${cuts.map(cutItemHtml).join('')}</ol>
  <h4>PARTS OFF THIS SHEET</h4>
  <ul class="parts">${parts.map(partItemHtml).join('')}</ul>
  ${leftoverHtml(leftovers)}
</section>`;
}

/** One sheet's to-do list, for rendering directly under that sheet's diagram. */
export function sheetCutListHtml(sheetPlan, materialPlan, system, index) {
  return sectionHtml(sheetRows(sheetPlan, materialPlan, system, index));
}

/**
 * The whole plan's to-do lists, one section per sheet.
 *
 * Takes rows rather than the plan so that a caller that already has rows (the
 * seed and parity tests) does not have to re-derive them.
 */
export function cutListHtml(rows) {
  const sections = [];
  for (const row of rows) {
    if (row.kind === 'sheet') sections.push([]);
    if (sections.length > 0) sections[sections.length - 1].push(row);
  }
  return sections.map(sectionHtml).join('\n');
}
