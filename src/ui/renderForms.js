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

function metaPanel(project) {
  return `<details class="panel" data-panel="meta"><summary>Project</summary><div class="panel-body">
  <div class="row">
    ${field('Name', textInput({ key: 'name', value: project.name }))}
    ${field('Date', textInput({ key: 'date', value: project.date, type: 'date' }))}
  </div>
  ${field('Notes', `<textarea rows="3" data-focus-key="notes" data-field="notes">${escapeHtml(project.notes)}</textarea>`)}
  ${field('Show measurements as', `<select data-focus-key="displaySystem" data-field="displaySystem">
    ${option('imperial', 'Inches', project.displaySystem === 'imperial')}
    ${option('metric', 'Millimeters', project.displaySystem === 'metric')}
  </select>`)}
</div></details>`;
}

function paramsPanel(project) {
  return `<details class="panel" data-panel="params"><summary>Cutting parameters</summary><div class="panel-body">
  <div class="row">
    ${field('Blade kerf (in)', numericInput({ key: 'params.kerfIn', value: project.params.kerfIn }))}
    ${field('Edge trim (in)', numericInput({ key: 'params.edgeTrimIn', value: project.params.edgeTrimIn }))}
  </div>
  <p class="muted">Defaults: 0.125 in kerf taken between neighboring parts, 0 in trimmed off the factory edges.</p>
</div></details>`;
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
    ? field('Thickness (in)', numericInput({ key: `materials.${index}.thicknessIn`, value: material.thicknessIn }))
    : '';
  return field('Thickness', select) + custom;
}

function sheetRow(materialIndex, sheet, sheetIndex, uiState) {
  const preset = SHEET_PRESETS.find((p) => p.widthIn === sheet.widthIn && p.lengthIn === sheet.lengthIn);
  const mode = modeFor(uiState, sheet.id, preset === undefined ? 'custom' : 'preset');
  const options = SHEET_PRESETS
    .map((p) => option(p.id, p.label, mode === 'preset' && preset !== undefined && p.id === preset.id))
    .join('');
  const base = `materials.${materialIndex}.sheets.${sheetIndex}`;
  return `<div class="entry"><div class="row">
    ${field('Size preset', `<select data-focus-key="${base}.preset" data-field="${base}.preset">${options}${option('custom', 'Custom or offcut', mode === 'custom')}</select>`)}
    ${field('Width (in)', numericInput({ key: `${base}.widthIn`, value: sheet.widthIn }))}
    ${field('Length (in)', numericInput({ key: `${base}.lengthIn`, value: sheet.lengthIn }))}
    ${field('On hand', numericInput({ key: `${base}.qty`, value: sheet.qty, keypad: 'numeric' }))}
  </div><div class="row">
    ${field('Label or note', textInput({ key: `${base}.label`, value: sheet.label, placeholder: 'Where this sheet came from' }))}
    <div><button class="secondary" type="button" data-action="rotate-sheet" data-material="${materialIndex}" data-sheet="${sheetIndex}">&#8644; Swap to ${escapeHtml(sheet.lengthIn)} x ${escapeHtml(sheet.widthIn)} and repack</button></div>
    <div><button class="danger" type="button" data-action="remove-sheet" data-material="${materialIndex}" data-sheet="${sheetIndex}">Remove this ${escapeHtml(sheet.widthIn)} x ${escapeHtml(sheet.lengthIn)} sheet (${escapeHtml(sheet.qty)} on hand)</button></div>
  </div>
  <p class="muted">Set On hand to 0 for a sheet size you still need to buy.</p>
</div>`;
}

function materialGroup(material, index, uiState) {
  const sheetCount = material.sheets.length;
  const sizeWord = sheetCount === 1 ? 'sheet size' : 'sheet sizes';
  const groupName = material.name === '' ? 'this unnamed group' : `"${escapeHtml(material.name)}"`;

  // The sheets sit inside a fieldset, with their own legend and a left rule, so
  // that "these sizes belong to this group" is visible rather than implied by
  // indentation that disappears at phone width.
  return `<div class="entry">
    <div class="row">
      ${field('Group name', textInput({ key: `materials.${index}.name`, value: material.name }))}
      ${thicknessControl(material, index, uiState)}
    </div>
    ${field('Group note', textInput({ key: `materials.${index}.note`, value: material.note }))}
    <fieldset class="sheet-group">
      <legend>Sheet sizes (${sheetCount})</legend>
      ${material.sheets.map((sheet, sheetIndex) => sheetRow(index, sheet, sheetIndex, uiState)).join('')}
      <button class="secondary" type="button" data-action="add-sheet" data-material="${index}">Add sheet size</button>
    </fieldset>
    <div class="row">
      <div><button class="danger" type="button" data-action="remove-material" data-material="${index}">Remove ${groupName} and its ${sheetCount} ${sizeWord}</button></div>
    </div>
  </div>`;
}

function materialsPanel(project, uiState) {
  const groups = project.materials
    .map((material, index) => materialGroup(material, index, uiState))
    .join('');

  return `<details class="panel" data-panel="materials"><summary>Material groups (${project.materials.length})</summary><div class="panel-body">
    ${groups}
    <button class="secondary" type="button" data-action="add-material">Add material group</button>
  </div></details>`;
}

function partsPanel(project) {
  const declared = new Set(project.materials.map((material) => material.id));

  // A part can belong to no group at all: added before the first group existed,
  // or left behind when its group was deleted. The control has to say so. Left
  // to the plain option list the browser displays whichever group comes first,
  // which reads as an answer nobody gave and, with a single group on the list,
  // leaves nothing to pick to put the part right -- the project then cannot be
  // saved and cannot be fixed either.
  const materialOptions = (selected) => {
    const unassigned = declared.has(selected) ? '' : option('', 'Not in a group yet', true);
    return unassigned + project.materials
      .map((material) => option(material.id, material.name === '' ? 'Unnamed group' : material.name, material.id === selected))
      .join('');
  };

  const rows = project.parts.map((part, index) => `<div class="entry">
    <div class="row">
      ${field('Part name', textInput({ key: `parts.${index}.name`, value: part.name }))}
      ${field('Quantity', numericInput({ key: `parts.${index}.qty`, value: part.qty, keypad: 'numeric' }))}
    </div>
    <div class="row">
      ${field('Width (in)', numericInput({ key: `parts.${index}.widthIn`, value: part.widthIn }))}
      ${field('Length (in)', numericInput({ key: `parts.${index}.lengthIn`, value: part.lengthIn }))}
    </div>
    <div class="row">
      ${field('Material group', `<select data-focus-key="parts.${index}.materialId" data-field="parts.${index}.materialId">${materialOptions(part.materialId)}</select>`)}
      <div><label>Grain locked</label>
        <input type="checkbox" data-focus-key="parts.${index}.grainLocked" data-field="parts.${index}.grainLocked"${part.grainLocked ? ' checked' : ''} />
      </div>
      <div><button class="danger" type="button" data-action="remove-part" data-part="${index}">Remove part</button></div>
    </div>
  </div>`).join('');

  return `<details class="panel" data-panel="parts"><summary>Parts (${project.parts.length})</summary><div class="panel-body">
    ${rows}
    <button class="secondary" type="button" data-action="add-part">Add part</button>
    <p class="muted">A grain locked part is never turned 90 degrees. Leave it off unless the grain direction matters.</p>
  </div></details>`;
}

/**
 * The whole editing surface.
 *
 * `uiState` is app.js's map of control modes, keyed by entity id. Absent, every
 * control falls back to the mode its numbers imply, which is exactly what a
 * freshly loaded project should show.
 */
export function renderForms(project, uiState) {
  return metaPanel(project) + paramsPanel(project)
    + materialsPanel(project, uiState) + partsPanel(project);
}
