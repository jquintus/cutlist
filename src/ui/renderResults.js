// Presentational string builders for the results surface.
//
// A pure function of the plan, exactly like renderForms.js, and deliberately
// independent of it: the editing surface and the results surface change for
// entirely different reasons. Nothing here touches the DOM, which is what lets
// the whole results surface be exercised under node --test.

import { escapeHtml } from './escape.js';
import { formatLength } from '../units.js';
import { sheetSvg } from './renderDiagram.js';
import { sheetCutListHtml, sheetKey, sourceLabel } from './renderTable.js';

function warningsSection(plan) {
  if (plan.warnings.length === 0) return '';
  const items = plan.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('');
  return `<section class="banner-warn"><h2>Check these before cutting</h2><ul>${items}</ul></section>`;
}

function notesSection(plan) {
  if (!plan.notes) return '';
  return `<section class="notes-banner"><strong>Project notes</strong>\n${escapeHtml(plan.notes)}</section>`;
}

function buyBanner(materialPlan) {
  if (materialPlan.extraSheetsNeeded === 0) return '';
  const { widthIn, lengthIn } = materialPlan.buySpec;
  const sheetWord = materialPlan.extraSheetsNeeded === 1 ? 'sheet' : 'sheets';
  return `<p class="banner-buy">Shopping list: buy ${materialPlan.extraSheetsNeeded} more ${escapeHtml(widthIn)} x ${escapeHtml(lengthIn)} ${sheetWord} of ${escapeHtml(materialPlan.name)}.</p>`;
}

/**
 * Everything this project needs bought, in one place.
 *
 * Both dimensions go through formatLength: a metric project must say 1220 mm,
 * not 48 in, and interpolating raw inches here is exactly the bug the metric
 * test catches. Not marked no-print -- this is the list you take to the store.
 */
function shoppingListSection(plan, system, ticked = new Set(), standalone = false) {
  if (plan.shoppingList.length === 0) return '';
  const items = plan.shoppingList.map((entry, index) => {
    const thickness = entry.thicknessLabel ? ` (${escapeHtml(entry.thicknessLabel)})` : '';
    const sheetWord = entry.qty === 1 ? 'sheet' : 'sheets';
    const text = `${escapeHtml(entry.qty)} ${sheetWord} of ${escapeHtml(entry.name)}${thickness}`
      + `, ${escapeHtml(formatLength(entry.widthIn, system))}`
      + ` x ${escapeHtml(formatLength(entry.lengthIn, system))}`;
    // Keyed to the material rather than to its place in the list, so a tick
    // made in the aisle survives an edit to the project on the way there.
    const id = `buy:${entry.materialId ?? index}`;
    const done = ticked.has(id);
    return `<li${done ? ' class="done"' : ''}><label>`
      + `<input type="checkbox" data-tick="${escapeHtml(id)}"${done ? ' checked' : ''} /> ${text}</label></li>`;
  }).join('');

  // The heading is the link, exactly like a sheet's heading, so there is one
  // way to open a thing on its own rather than a separate phrase to find.
  const heading = standalone
    ? 'Shopping list'
    : `<a class="sheet-link" data-view-link="shopping" href="#"
        title="Open the shopping list on its own, for the store">Shopping list</a>`;
  return `<section class="shopping-list"><h2>${heading}</h2><ul class="buy-list">${items}</ul></section>`;
}

/**
 * Prev or Next, as a real link when there is a sheet that way and a dead button
 * when there is not.
 *
 * Kept as a disabled button rather than dropped, so the row does not reflow
 * under a thumb as you step from the first sheet to the second.
 */
function stepLink(entry, view, label) {
  if (entry === undefined) return `<span class="sheet-step is-off">${escapeHtml(label)}</span>`;
  const href = `${view.baseHash || '#'}&sheet=${encodeURIComponent(entry.key)}`;
  return `<a class="sheet-step" href="${escapeHtml(href)}" title="${escapeHtml(entry.sheetPlan.label)}">${escapeHtml(label)}</a>`;
}

/**
 * How wide this sheet is drawn, as a share of the column.
 *
 * Every diagram uses the same inches per pixel, measured against the widest
 * sheet in the project, so a 24 in panel is visibly half a 48 in one. Drawn at
 * full width each, a small offcut and a full sheet came out the same size on
 * screen and 25 in was a different length of line on every picture.
 */
function sheetScalePercent(sheetPlan, plan, isRotated) {
  const widest = plan.widestSheetIn || sheetPlan.widthIn;
  // A turned picture presents its length across, so that is the edge to measure.
  const across = isRotated ? sheetPlan.lengthIn : sheetPlan.widthIn;
  return Math.max(12, Math.min(100, (across / widest) * 100)).toFixed(2);
}

/** One sheet: its picture, the cuts that make it, and the parts it yields. */
function sheetArticle(plan, materialPlan, sheetPlan, index, view, system) {
  const key = sheetKey(materialPlan, sheetPlan, index);
  // The rotation lives on the wrapper, never on the SVG: the emitted diagram
  // is byte for byte the same whichever way the picture is turned, so no
  // measurement and no cut can change with it.
  const isRotated = view.rotated?.[key] === true;
  const turned = isRotated ? ' rotated' : '';
  // The picture can be turned to match how the sheet is lying on the horses,
  // but the CUTS list below always names the sheet's own original edges --
  // it never reads the rotated view. Without a visible marker here, that
  // mismatch is exactly what could send someone to the wrong edge.
  const rotatedNotice = isRotated
    ? '<p class="view-rotated-note no-print">View rotated on screen -- the CUTS list still names this sheet\'s original edges.</p>'
    : '';
  // Diagram and to-do list in one block, so a sheet and its steps stay
  // together on screen and on paper.
  return `<article class="sheet">
    <h3><a class="sheet-link" data-sheet-link="${escapeHtml(key)}" href="#"
      title="Open this sheet on its own, for the phone at the saw"
      >${escapeHtml(sheetPlan.label)}</a> <span class="muted">(${sourceLabel(sheetPlan.source)})</span></h3>
    <div class="sheet-grid">
      <div class="sheet-figure" style="width:${sheetScalePercent(sheetPlan, plan, isRotated)}%">
        <div class="sheet-view${turned}"${isRotated ? ` style="--sheet-ratio:${sheetPlan.widthIn / sheetPlan.lengthIn};--turned-ratio:${sheetPlan.lengthIn} / ${sheetPlan.widthIn}"` : ''}>${sheetSvg(sheetPlan, materialPlan, { ...plan.params, displaySystem: plan.displaySystem })}</div>
        ${rotatedNotice}
        <div class="figure-tools no-print">
          <button type="button" data-action="rotate-view" data-sheet="${escapeHtml(key)}" title="Turn the picture only. The cuts do not change.">&#8635; Turn picture</button>
          <button type="button" data-action="rotate-sheet" data-material="${materialPlan.materialIndex}" data-spec="${escapeHtml(sheetPlan.sheetSpecId ?? '')}" title="Lay the sheet the other way and work out the cuts again.">&#8644; Repack ${escapeHtml(sheetPlan.lengthIn)} x ${escapeHtml(sheetPlan.widthIn)}</button>
        </div>
      </div>
      <div class="sheet-steps">${sheetCutListHtml(sheetPlan, materialPlan, system, index, view.ticked ?? new Set())}</div>
    </div>
  </article>`;
}

function materialSection(plan, materialPlan, view) {
  const onHand = `<p class="muted">${escapeHtml(materialPlan.onHandSheetCount)} sheet(s) on hand, ${escapeHtml(materialPlan.sheets.length)} laid out.</p>`;

  const system = plan.displaySystem ?? 'imperial';
  const sheets = materialPlan.sheets
    .map((sheetPlan, index) => sheetArticle(plan, materialPlan, sheetPlan, index, view, system))
    .join('');

  return `<section class="material-section">
    <h2>${escapeHtml(materialPlan.name)}${materialPlan.thicknessLabel ? ` (${escapeHtml(materialPlan.thicknessLabel)})` : ''}</h2>
    ${buyBanner(materialPlan)}${onHand}
    <div class="sheets">${sheets}</div>
  </section>`;
}

/**
 * Notes first, because they carry things like the 6 mm substitution and have to
 * be read before anyone cuts. Then the one shopping list for the whole project,
 * because that is what you need before you leave the house. Then each material
 * group: its sheets, and under every sheet that sheet's own diagram and its
 * CUTS and PARTS lists together. Out of scope stock comes last.
 *
 * `view` is app.js's presentation state, which affects how a sheet is shown on
 * screen and nothing else. It never reaches sheetSvg.
 */
export function renderResults(plan, view = {}) {
  const system = plan.displaySystem ?? 'imperial';

  const backLink = `<p class="focus-back no-print"><a href="${escapeHtml(view.baseHash || '#')}">&larr; Back to the plan</a></p>`;

  // The shopping list on its own, for standing in an aisle ticking things off.
  if (view.focusView === 'shopping') {
    return backLink + shoppingListSection(plan, system, view.ticked ?? new Set(), true);
  }

  // One sheet on its own, which is the view for a phone at the saw: the
  // diagram, its cuts and its parts, and nothing else competing for the screen.
  if (view.focusSheet) {
    // Every sheet in the plan, in the order they are laid out, so the focused
    // view can step to the one before and the one after. Flattened once rather
    // than searched twice: the position is what Prev and Next are built from.
    const all = plan.materials.flatMap((materialPlan) => materialPlan.sheets
      .map((sheetPlan, index) => ({ materialPlan, sheetPlan, index, key: sheetKey(materialPlan, sheetPlan, index) })));
    const at = all.findIndex((entry) => entry.key === view.focusSheet);
    const back = `<a href="${escapeHtml(view.baseHash || '#')}">&larr; All sheets</a>`;

    if (at === -1) {
      return `<p class="focus-back no-print">${back}</p>`
        + '<p class="muted">That sheet is not in this project any more.</p>';
    }

    const { materialPlan, sheetPlan, index } = all[at];
    return `<nav class="sheet-nav no-print">${back}`
      + `<span class="sheet-count">${at + 1} of ${all.length}</span>`
      + `<span class="sheet-steps-nav">${stepLink(all[at - 1], view, 'Prev')}${stepLink(all[at + 1], view, 'Next')}</span>`
      + '</nav>'
      + `<section class="material-section"><h2>${escapeHtml(materialPlan.name)}`
      + `${materialPlan.thicknessLabel ? ` (${escapeHtml(materialPlan.thicknessLabel)})` : ''}</h2>`
      + sheetArticle(plan, materialPlan, sheetPlan, index, view, system)
      + '</section>';
  }

  const anySheets = plan.materials.some((materialPlan) => materialPlan.sheets.length > 0);
  if (!anySheets) {
    return notesSection(plan) + warningsSection(plan)
      + '<p class="muted">Add a material group and some parts to see a layout.</p>';
  }

  const settings = `<p class="muted">Kerf ${escapeHtml(formatLength(plan.params.kerfIn, system))},`
    + ` edge trim ${escapeHtml(formatLength(plan.params.edgeTrimIn, system))}.</p>`;
  const materials = plan.materials.map((materialPlan) => materialSection(plan, materialPlan, view)).join('');

  return notesSection(plan) + warningsSection(plan) + shoppingListSection(plan, system, view.ticked ?? new Set())
    + settings + materials;
}
