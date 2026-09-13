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
function shoppingListSection(plan, system) {
  if (plan.shoppingList.length === 0) return '';
  const items = plan.shoppingList.map((entry) => {
    const thickness = entry.thicknessLabel ? ` (${escapeHtml(entry.thicknessLabel)})` : '';
    const sheetWord = entry.qty === 1 ? 'sheet' : 'sheets';
    return `<li>${escapeHtml(entry.qty)} ${sheetWord} of ${escapeHtml(entry.name)}${thickness}`
      + `, ${escapeHtml(formatLength(entry.widthIn, system))}`
      + ` x ${escapeHtml(formatLength(entry.lengthIn, system))}</li>`;
  }).join('');
  return `<section class="shopping-list"><h2>Shopping list</h2><ul>${items}</ul></section>`;
}

function materialSection(plan, materialPlan, view) {
  const noteHtml = materialPlan.note ? `<p class="muted">${escapeHtml(materialPlan.note)}</p>` : '';
  const onHand = `<p class="muted">${escapeHtml(materialPlan.onHandSheetCount)} sheet(s) on hand, ${escapeHtml(materialPlan.sheets.length)} laid out.</p>`;

  const system = plan.displaySystem ?? 'imperial';
  const sheets = materialPlan.sheets.map((sheetPlan, index) => {
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
      <h3>${escapeHtml(sheetPlan.label)} <span class="muted">(${sourceLabel(sheetPlan.source)})</span></h3>
      <div class="sheet-grid">
        <div class="sheet-figure">
          <div class="sheet-view${turned}">${sheetSvg(sheetPlan, materialPlan, { ...plan.params, displaySystem: plan.displaySystem })}</div>
          ${rotatedNotice}
          <div class="figure-tools no-print">
            <button type="button" data-action="rotate-view" data-sheet="${escapeHtml(key)}" title="Turn the picture only. The cuts do not change.">&#8635; Turn picture</button>
            <button type="button" data-action="rotate-sheet" data-material="${materialPlan.materialIndex}" data-sheet-index="${index}" title="Lay the sheet the other way and work out the cuts again.">&#8644; Repack ${escapeHtml(sheetPlan.lengthIn)} x ${escapeHtml(sheetPlan.widthIn)}</button>
          </div>
        </div>
        <div class="sheet-steps">${sheetCutListHtml(sheetPlan, materialPlan, system, index)}</div>
      </div>
    </article>`;
  }).join('');

  return `<section class="material-section">
    <h2>${escapeHtml(materialPlan.name)}${materialPlan.thicknessLabel ? ` (${escapeHtml(materialPlan.thicknessLabel)})` : ''}</h2>
    ${noteHtml}${buyBanner(materialPlan)}${onHand}
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
  const anySheets = plan.materials.some((materialPlan) => materialPlan.sheets.length > 0);
  if (!anySheets) {
    return notesSection(plan) + warningsSection(plan)
      + '<p class="muted">Add a material group and some parts to see a layout.</p>';
  }

  const settings = `<p class="muted">Kerf ${escapeHtml(formatLength(plan.params.kerfIn, system))},`
    + ` edge trim ${escapeHtml(formatLength(plan.params.edgeTrimIn, system))}.`
    + ' Work down each sheet\'s CUTS list in order, then tick off its parts.</p>';
  const materials = plan.materials.map((materialPlan) => materialSection(plan, materialPlan, view)).join('');

  return notesSection(plan) + warningsSection(plan) + shoppingListSection(plan, system)
    + settings + materials;
}
