// Presentational string builders for the editing surface.
//
// A pure function of the project and of `uiState`, the map of control modes
// app.js holds. All state and all event wiring lives in app.js, so nothing here
// reaches for the DOM or decides anything. The results surface is
// renderResults.js, and the two never import from each other.
//
// Why a control's mode is passed in rather than derived: the preset dropdowns
// used to recompute their own mode from the dimensions on every render, so
// choosing "Custom" without changing a number re-derived the old preset and the
// click did nothing visible. The mode is now stored, keyed by the entity's own
// id, and only the dimensions are read from the project. It is deliberately not
// stored on the project: normalizeProject returns a fixed object literal and
// drops unknown fields, so a mode written there would not survive a keystroke.

import { THICKNESS_PRESETS, SHEET_PRESETS } from '../units.js';
import { escapeHtml } from './escape.js';

function option(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function field(labelText, inputHtml) {
  return `<div><label>${escapeHtml(labelText)}</label>${inputHtml}</div>`;
}

function textInput({ key, value, type = 'text', placeholder = '' }) {
  return `<input type="${type}" data-focus-key="${escapeHtml(key)}" data-field="${escapeHtml(key)}"`
    + ` value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" />`;
}

/**
 * A field that holds a measurement or a count.
 *
 * Deliberately not <input type="number">. A number input hands JavaScript an
 * empty string for any text it considers invalid, and "17." on the way to
 * 17.75 is exactly that, so a fractional dimension used to read as blank and
 * collapse to a whole number between keystrokes. A text box with a decimal
 * keypad gives back the literal characters typed, which src/ui/numericEntry.js
 * can then read correctly while the entry is still half finished.
 *
 * `keypad` is 'decimal' for a measurement and 'numeric' for a whole count.
 */
function numericInput({ key, value, keypad = 'decimal' }) {
  return `<input type="text" inputmode="${keypad}" autocomplete="off" data-numeric="true"`
    + ` data-focus-key="${escapeHtml(key)}" data-field="${escapeHtml(key)}"`
    + ` value="${escapeHtml(value)}" />`;
}

/**
 * A measurement with nudge buttons.
 *
 * The box itself stays a text input, because a number input rejects the
 * fraction forms this app prints and a woodworker types ("3 1/2"). The buttons
 * give the up/down behavior a number input would have, stepping by an eighth,
 * which is the increment these measurements actually land on.
 */
function stepperInput({ key, value, step = 0.125, keypad = 'decimal' }) {
  return `<span class="stepper">`
    + numericInput({ key, value, keypad })
    + `<span class="steps">`
    + `<button type="button" class="step" data-step="${step}" data-step-for="${escapeHtml(key)}" tabindex="-1" aria-label="Increase">&#9650;</button>`
    + `<button type="button" class="step" data-step="${-step}" data-step-for="${escapeHtml(key)}" tabindex="-1" aria-label="Decrease">&#9660;</button>`
    + `</span></span>`;
}

function metaPanel(project) {
  return `<section class="section" data-panel="meta"><h2>Project</h2>
  <table class="grid-table"><tbody>
    <tr><th scope="row">Name</th><td colspan="3">${textInput({ key: 'name', value: project.name })}</td></tr>
    <tr><th scope="row">Date</th><td>${textInput({ key: 'date', value: project.date, type: 'date' })}</td>
        <th scope="row">Units</th><td><select data-focus-key="displaySystem" data-field="displaySystem">
          ${option('imperial', 'Inches', project.displaySystem === 'imperial')}
          ${option('metric', 'Millimeters', project.displaySystem === 'metric')}
        </select></td></tr>
    <tr><th scope="row">Blade kerf</th><td class="num">${stepperInput({ key: 'params.kerfIn', value: project.params.kerfIn, step: 0.0625 })}</td>
        <th scope="row">Edge trim</th><td class="num">${stepperInput({ key: 'params.edgeTrimIn', value: project.params.edgeTrimIn })}</td></tr>
    <tr><th scope="row">Notes</th><td colspan="3"><textarea rows="2" data-focus-key="notes" data-field="notes">${escapeHtml(project.notes)}</textarea></td></tr>
  </tbody></table>
</section>`;
}

/**
 * The control's mode: what the person last chose, or what the numbers imply
 * when they have not chosen anything yet.
 *
 * `uiState` is a Map keyed by the entity's own stable id, so a mode follows its
 * sheet or its group across a re-render and across the removal of a sibling.
 */
function modeFor(uiState, id, derived) {
  return uiState?.get(id)?.sizeMode ?? derived;
}

/**
 * One thickness control, not two.
 *
 * The preset list and the typed-in measurement were two inputs side by side,
 * which left it ambiguous which one won. Now the list carries an "Other" entry
 * and the measurement box appears only under it.
 */
function thicknessControl(material, index, uiState) {
  const match = THICKNESS_PRESETS.find((preset) => Math.abs(preset.inches - material.thicknessIn) < 1e-6);
  const mode = modeFor(uiState, material.id, match === undefined ? 'custom' : 'preset');
  const options = THICKNESS_PRESETS
    .map((preset) => option(preset.id, preset.label, mode === 'preset' && match !== undefined && preset.id === match.id))
    .join('');

  const select = `<select data-focus-key="m${index}.thickness" data-field="materials.${index}.thicknessPreset">
    ${options}${option('custom', 'Other...', mode === 'custom')}
  </select>`;

  const custom = mode === 'custom'
    ? field('Thickness (in)', stepperInput({ key: `materials.${index}.thicknessIn`, value: material.thicknessIn, step: 0.0625 }))
    : '';
  return field('Thickness', select) + custom;
}

/**
 * Move a row up or down in its list.
 *
 * The order a person enters stock and parts in is their own, and it survives
 * into the cut list and the parts checklist, so being stuck with the order of
 * first typing is a real cost. Disabled at the ends rather than hidden, so the
 * column never changes width as rows move.
 */
function reorderCell(action, index, count, extra = '') {
  const up = `<button type="button" class="row-move" data-action="${action}" data-dir="-1" ${extra} data-index="${index}"`
    + `${index === 0 ? ' disabled' : ''} aria-label="Move up" title="Move up">&#9650;</button>`;
  const down = `<button type="button" class="row-move" data-action="${action}" data-dir="1" ${extra} data-index="${index}"`
    + `${index === count - 1 ? ' disabled' : ''} aria-label="Move down" title="Move down">&#9660;</button>`;
  return `<td class="mid move"><span class="moves">${up}${down}</span></td>`;
}

function sheetRow(materialIndex, sheet, sheetIndex, uiState, sheetCount) {
  const preset = SHEET_PRESETS.find((p) => p.widthIn === sheet.widthIn && p.lengthIn === sheet.lengthIn);
  const mode = modeFor(uiState, sheet.id, preset === undefined ? 'custom' : 'preset');
  const options = SHEET_PRESETS
    .map((p) => option(p.id, p.label, mode === 'preset' && preset !== undefined && p.id === preset.id))
    .join('');
  const base = `materials.${materialIndex}.sheets.${sheetIndex}`;
  return `<tr>
    ${reorderCell('move-sheet', sheetIndex, sheetCount, `data-material="${materialIndex}"`)}
    <td><select data-focus-key="${base}.preset" data-field="${base}.preset">${options}${option('custom', 'Custom or offcut', mode === 'custom')}</select></td>
    <td class="num">${stepperInput({ key: `${base}.widthIn`, value: sheet.widthIn })}</td>
    <td class="num">${stepperInput({ key: `${base}.lengthIn`, value: sheet.lengthIn })}</td>
    <td class="qty num"><input type="number" min="0" step="1" data-focus-key="${base}.qty" data-field="${base}.qty" value="${escapeHtml(sheet.qty)}" /></td>
    <td>${textInput({ key: `${base}.label`, value: sheet.label, placeholder: 'Note' })}</td>
    <td class="mid"><button type="button" class="row-remove" data-action="remove-sheet" data-material="${materialIndex}" data-sheet="${sheetIndex}" title="Remove this ${escapeHtml(sheet.widthIn)} x ${escapeHtml(sheet.lengthIn)} sheet" aria-label="Remove this ${escapeHtml(sheet.widthIn)} by ${escapeHtml(sheet.lengthIn)} sheet">&times;</button></td>
  </tr>`;
}

function materialGroup(material, index, uiState, count) {
  const groupName = material.name === '' ? 'this unnamed group' : `"${escapeHtml(material.name)}"`;

  // The sheet sizes are drawn inside the group's own box with a rule down the
  // side, so "these sizes belong to this material" is something you can see
  // rather than something you have to work out from two Remove buttons.
  return `<div class="group">
    <div class="group-head">
      <span class="moves">
        <button type="button" class="row-move" data-action="move-material" data-dir="-1" data-index="${index}"${index === 0 ? ' disabled' : ''} aria-label="Move material up" title="Move up">&#9650;</button>
        <button type="button" class="row-move" data-action="move-material" data-dir="1" data-index="${index}"${index === count - 1 ? ' disabled' : ''} aria-label="Move material down" title="Move down">&#9660;</button>
      </span>
      ${textInput({ key: `materials.${index}.name`, value: material.name, placeholder: 'Material name' })}
      ${thicknessControl(material, index, uiState)}
      <button type="button" class="row-remove" data-action="remove-material" data-material="${index}" title="Remove ${groupName} and every sheet size in it" aria-label="Remove ${groupName} and every sheet size in it">&times;</button>
    </div>
    <div class="group-sheets">
      <h3>Sheets</h3>
      <table class="grid-table">
        <thead><tr>
          <th class="mid"></th><th>Size</th><th class="num">Width</th><th class="num">Length</th>
          <th class="num">On hand</th><th>Note</th><th></th>
        </tr></thead>
        <tbody>${material.sheets.map((sheet, i) => sheetRow(index, sheet, i, uiState, material.sheets.length)).join('')}</tbody>
      </table>
      <button type="button" class="add-row" data-action="add-sheet" data-material="${index}">+ Add sheet size</button>
    </div>
  </div>`;
}

function materialsPanel(project, uiState) {
  const groups = project.materials.map((m, i) => materialGroup(m, i, uiState, project.materials.length)).join('');
  return `<section class="section" data-panel="materials"><h2>Material</h2>
    ${groups}
    <button type="button" class="add-row" data-action="add-material">+ Add material</button>
  </section>`;
}

/**
 * A column header you can sort by.
 *
 * Sorting rewrites the stored order rather than layering a view on top of it,
 * so the manual up and down controls and the column sort are the same fact and
 * cannot disagree. Clicking the column already sorted reverses it.
 */
function sortHeader(key, label, sort, extraClass = '') {
  const active = sort?.key === key;
  const arrow = active ? (sort.dir === 1 ? ' \u25B2' : ' \u25BC') : '';
  const cls = ['sortable', extraClass, active ? 'sorted' : ''].filter(Boolean).join(' ');
  return `<th class="${cls}"><button type="button" data-action="sort-parts" data-key="${escapeHtml(key)}"`
    + ` aria-label="Sort by ${escapeHtml(label)}">${escapeHtml(label)}${arrow}</button></th>`;
}

function partsPanel(project, sort) {
  const declared = new Set(project.materials.map((material) => material.id));

  // A part can belong to no group at all: added before the first group existed,
  // or left behind when its group was deleted. The control has to say so rather
  // than display whichever group happens to come first, which reads as an
  // answer nobody gave.
  const materialOptions = (selected) => {
    const unassigned = declared.has(selected) ? '' : option('', 'Pick a material', true);
    return unassigned + project.materials
      .map((m) => option(m.id, m.name === '' ? 'Unnamed' : m.name, m.id === selected))
      .join('');
  };

  const rows = project.parts.map((part, index) => `<tr>
    ${reorderCell('move-part', index, project.parts.length)}
    <td>${textInput({ key: `parts.${index}.name`, value: part.name, placeholder: 'Part name' })}</td>
    <td class="qty num"><input type="number" min="1" step="1" data-focus-key="parts.${index}.qty" data-field="parts.${index}.qty" value="${escapeHtml(part.qty)}" /></td>
    <td class="num">${stepperInput({ key: `parts.${index}.widthIn`, value: part.widthIn })}</td>
    <td class="num">${stepperInput({ key: `parts.${index}.lengthIn`, value: part.lengthIn })}</td>
    <td><select data-focus-key="parts.${index}.materialId" data-field="parts.${index}.materialId">${materialOptions(part.materialId)}</select></td>
    <td class="mid"><input type="checkbox" data-focus-key="parts.${index}.grainLocked" data-field="parts.${index}.grainLocked"${part.grainLocked ? ' checked' : ''} aria-label="Grain runs along the length" /></td>
    <td class="mid"><button type="button" class="row-remove" data-action="remove-part" data-part="${index}" title="Remove this part" aria-label="Remove this part">&times;</button></td>
  </tr>`).join('');

  return `<section class="section" data-panel="parts"><h2>Parts</h2>
    <table class="grid-table">
      <thead><tr>
        <th class="mid"></th>
        ${sortHeader('name', 'Name', sort)}
        ${sortHeader('qty', 'Qty', sort, 'num')}
        ${sortHeader('widthIn', 'Width', sort, 'num')}
        ${sortHeader('lengthIn', 'Length', sort, 'num')}
        ${sortHeader('materialId', 'Material', sort)}
        <th class="mid" title="Grain must run along the length">Grain</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <button type="button" class="add-row" data-action="add-part">+ Add part</button>
  </section>`;
}

export function renderForms(project, uiState, sort = null) {
  return metaPanel(project)
    + materialsPanel(project, uiState) + partsPanel(project, sort);
}
