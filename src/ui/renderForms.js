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

import { THICKNESS_PRESETS, BOARD_THICKNESS_PRESETS, SHEET_PRESETS } from '../units.js';
import { escapeHtml } from './escape.js';

function option(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function field(labelText, inputHtml) {
  return `<div><label>${escapeHtml(labelText)}</label>${inputHtml}</div>`;
}

function textInput({ key, value, type = 'text', placeholder = '' }) {
  return `<input type="${type}" name="${escapeHtml(key)}" data-focus-key="${escapeHtml(key)}" data-field="${escapeHtml(key)}"`
    + ` value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" />`;
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

function displayPrice(value) {
  const price = String(value ?? '').trim();
  if (price === '') return '&mdash;';
  return escapeHtml(price.startsWith('$') ? price : `$${price}`);
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
    + ` name="${escapeHtml(key)}" data-focus-key="${escapeHtml(key)}" data-field="${escapeHtml(key)}"`
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

function metaPanel(project, open) {
  return `<details class="section" data-panel="meta"${open.meta ? ' open' : ''}><summary><h2>Project</h2></summary>
  <div class="table-scroll"><table class="grid-table"><tbody>
    <tr><th scope="row">Name</th><td colspan="3">${textInput({ key: 'name', value: project.name })}</td></tr>
    <tr><th scope="row">Date</th><td>${textInput({ key: 'date', value: project.date, type: 'date' })}</td>
        <th scope="row">Units</th><td><select name="displaySystem" data-focus-key="displaySystem" data-field="displaySystem">
          ${option('imperial', 'Inches', project.displaySystem === 'imperial')}
          ${option('metric', 'Millimeters', project.displaySystem === 'metric')}
        </select></td></tr>
    <tr><th scope="row">Blade kerf</th><td class="num">${stepperInput({ key: 'params.kerfIn', value: project.params.kerfIn, step: 0.0625 })}</td>
        <th scope="row">Edge trim</th><td class="num">${stepperInput({ key: 'params.edgeTrimIn', value: project.params.edgeTrimIn })}</td></tr>
    <tr><th scope="row">Notes</th><td colspan="3"><textarea rows="2" name="notes" data-focus-key="notes" data-field="notes">${escapeHtml(project.notes)}</textarea></td></tr>
  </tbody></table></div>
</details>`;
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
function thicknessControl(material, index, uiState, bare = false) {
  const presets = material.kind === 'board' ? BOARD_THICKNESS_PRESETS : THICKNESS_PRESETS;
  const match = presets.find((preset) => Math.abs(preset.inches - material.thicknessIn) < 1e-6
    && (material.thicknessLabel === '' || material.thicknessLabel === preset.label));
  const mode = modeFor(uiState, material.id, match === undefined ? 'custom' : 'preset');
  const options = presets
    .map((preset) => option(preset.id, preset.label, mode === 'preset' && match !== undefined && preset.id === match.id))
    .join('');

  const select = `<select name="materials.${index}.thicknessPreset" data-focus-key="m${index}.thickness" data-field="materials.${index}.thicknessPreset">
    ${options}${option('custom', 'Other...', mode === 'custom')}
  </select>`;

  const customInput = stepperInput({ key: `materials.${index}.thicknessIn`, value: material.thicknessIn, step: 0.0625 });
  const custom = mode === 'custom' ? field('Thickness (in)', customInput) : '';
  if (bare) {
    return mode === 'custom'
      ? `<span class="thickness-custom">${select}<label><span class="visually-hidden">Thickness (in)</span>${customInput}</label></span>`
      : select;
  }
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
function reorderButtons(action, index, count, extra = '') {
  const up = `<button type="button" class="row-move" data-action="${action}" data-dir="-1" ${extra} data-index="${index}"`
    + `${index === 0 ? ' disabled' : ''} aria-label="Move up" title="Move up">&#9650;</button>`;
  const down = `<button type="button" class="row-move" data-action="${action}" data-dir="1" ${extra} data-index="${index}"`
    + `${index === count - 1 ? ' disabled' : ''} aria-label="Move down" title="Move down">&#9660;</button>`;
  return `<span class="moves">${up}${down}</span>`;
}

function reorderCell(action, index, count, extra = '') {
  return `<td class="mid move">${reorderButtons(action, index, count, extra)}</td>`;
}

/**
 * One row of the flat Sheets table.
 *
 * A sheet belongs to a material, and that link is a dropdown here exactly as it
 * is on a part. The alternative, repeating the material's name as text on every
 * row, means a typo silently splits one pile of plywood into two the packer
 * treats as unrelated stock.
 */
function sheetRow(project, materialIndex, sheetIndex, uiState) {
  const material = project.materials[materialIndex];
  const sheet = material.sheets[sheetIndex];
  const preset = SHEET_PRESETS.find((p) => p.widthIn === sheet.widthIn && p.lengthIn === sheet.lengthIn);
  const mode = modeFor(uiState, sheet.id, preset === undefined ? 'custom' : 'preset');
  const options = SHEET_PRESETS
    .map((p) => option(p.id, p.label, mode === 'preset' && preset !== undefined && p.id === preset.id))
    .join('');
  const base = `materials.${materialIndex}.sheets.${sheetIndex}`;
  const owners = project.materials
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.kind !== 'board')
    .map(({ candidate, index }) => option(String(index), candidate.name === '' ? 'Unnamed' : candidate.name, index === materialIndex))
    .join('');

  return `<tr>
    ${reorderCell('move-sheet', sheetIndex, material.sheets.length, `data-material="${materialIndex}"`)}
    <td><select name="sheet-material" data-action-select="move-sheet-to" data-material="${materialIndex}" data-sheet="${sheetIndex}">${owners}</select></td>
    <td><select name="${base}.preset" data-focus-key="${base}.preset" data-field="${base}.preset">${options}${option('custom', 'Custom or offcut', mode === 'custom')}</select></td>
    <td class="num">${stepperInput({ key: `${base}.widthIn`, value: sheet.widthIn })}</td>
    <td class="num">${stepperInput({ key: `${base}.lengthIn`, value: sheet.lengthIn })}</td>
    <td class="qty num"><input type="number" min="0" step="1" name="${base}.qty" data-focus-key="${base}.qty" data-field="${base}.qty" value="${escapeHtml(sheet.qty)}" /></td>
    <td>${textInput({ key: `${base}.label`, value: sheet.label, placeholder: 'Note' })}</td>
    <td class="mid"><button type="button" class="row-remove" data-action="remove-sheet" data-material="${materialIndex}" data-sheet="${sheetIndex}" title="Remove this ${escapeHtml(sheet.widthIn)} x ${escapeHtml(sheet.lengthIn)} sheet" aria-label="Remove this ${escapeHtml(sheet.widthIn)} by ${escapeHtml(sheet.lengthIn)} sheet">&times;</button></td>
  </tr>`;
}

function materialReorderCell(project, material, index) {
  const peers = project.materials
    .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
    .filter(({ candidate }) => candidate.kind === material.kind);
  const position = peers.findIndex(({ candidateIndex }) => candidateIndex === index);
  return reorderCell('move-material', position, peers.length,
    `data-material="${index}" data-kind="${escapeHtml(material.kind)}"`);
}

function sheetMaterialRow(project, material, index, uiState) {
  return `<tr>
    ${materialReorderCell(project, material, index)}
    <td>${textInput({ key: `materials.${index}.name`, value: material.name, placeholder: 'Material name' })}</td>
    <td>${thicknessControl(material, index, uiState, true)}</td>
    <td>${textInput({ key: `materials.${index}.note`, value: material.note, placeholder: 'Group note or tag' })}</td>
    <td class="mid"><button type="button" class="row-remove" data-action="remove-material" data-material="${index}" title="Remove this material and every sheet of it" aria-label="Remove this material and every sheet of it">&times;</button></td>
  </tr>`;
}

function boardMaterialRow(project, material, index, uiState) {
  return `<tr>
    ${materialReorderCell(project, material, index)}
    <td>${textInput({ key: `materials.${index}.name`, value: material.name, placeholder: 'Material name' })}</td>
    <td>${thicknessControl(material, index, uiState, true)}</td>
    <td class="num">${stepperInput({ key: `materials.${index}.widthIn`, value: material.widthIn })}</td>
    <td>${textInput({ key: `materials.${index}.note`, value: material.note, placeholder: 'Group note or tag' })}</td>
    <td class="mid"><button type="button" class="row-remove" data-action="remove-material" data-material="${index}" title="Remove this material and every board of it" aria-label="Remove this material and every board of it">&times;</button></td>
  </tr>`;
}

function boardRow(project, materialIndex, boardIndex) {
  const material = project.materials[materialIndex];
  const board = material.boards[boardIndex];
  const base = `materials.${materialIndex}.boards.${boardIndex}`;
  const owners = project.materials
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => candidate.kind === 'board')
    .map(({ candidate, index }) => option(String(index), candidate.name === '' ? 'Unnamed' : candidate.name, index === materialIndex))
    .join('');

  return `<tr>
    ${reorderCell('move-board', boardIndex, material.boards.length, `data-material="${materialIndex}"`)}
    <td><select name="board-material" data-action-select="move-board-to" data-material="${materialIndex}" data-board="${boardIndex}">${owners}</select></td>
    <td class="num">${stepperInput({ key: `${base}.lengthFt`, value: board.lengthIn / 12, step: 1 })}</td>
    <td class="qty num"><input type="number" min="0" step="1" name="${base}.qty" data-focus-key="${base}.qty" data-field="${base}.qty" value="${escapeHtml(board.qty)}" /></td>
    <td>${textInput({ key: `${base}.label`, value: board.label, placeholder: 'Lot note' })}</td>
    <td class="mid"><button type="button" class="row-remove" data-action="remove-board" data-material="${materialIndex}" data-board="${boardIndex}" title="Remove this ${escapeHtml(board.lengthIn / 12)} ft board" aria-label="Remove this ${escapeHtml(board.lengthIn / 12)} foot board">&times;</button></td>
  </tr>`;
}

function materialsPanel(project, uiState, open, sheetSort) {
  const sheetMaterials = project.materials
    .map((material, index) => ({ material, index }))
    .filter(({ material }) => material.kind !== 'board')
    .map(({ material, index }) => sheetMaterialRow(project, material, index, uiState))
    .join('');
  const boardMaterials = project.materials
    .map((material, index) => ({ material, index }))
    .filter(({ material }) => material.kind === 'board')
    .map(({ material, index }) => boardMaterialRow(project, material, index, uiState))
    .join('');

  // Every sheet in the project, flattened, so stock reads as one list rather
  // than as something nested inside each material.
  const sheets = project.materials
    .filter((material) => material.kind !== 'board')
    .flatMap((material, materialIndex) => material.sheets
      .map((sheet, sheetIndex) => sheetRow(project, project.materials.indexOf(material), sheetIndex, uiState)))
    .join('');

  const boards = project.materials
    .filter((material) => material.kind === 'board')
    .flatMap((material) => material.boards
      .map((board, boardIndex) => boardRow(project, project.materials.indexOf(material), boardIndex)))
    .join('');

  const noSheetMaterials = !project.materials.some((material) => material.kind !== 'board');
  const noBoardMaterials = !project.materials.some((material) => material.kind === 'board');

  return `<details class="section" data-panel="materials"${open.materials ? ' open' : ''}><summary><h2>Material</h2></summary>
    <h3 class="sub-head material-kind-head">Sheet goods</h3>
    <div class="table-scroll"><table class="grid-table">
      <thead><tr><th class="mid"></th><th>Name</th><th>Thickness</th><th>Note / tag</th><th></th></tr></thead>
      <tbody>${sheetMaterials}</tbody>
    </table></div>
    <button type="button" class="add-row" data-action="add-material" data-kind="sheet">+ Add sheet material</button>

    <h3 class="sub-head">Sheets on hand</h3>
    <div class="table-scroll"><table class="grid-table">
      <thead><tr>
        <th class="mid"></th>
        ${sortHeader('materialId', 'Material', sheetSort, '', 'sort-sheets')}
        <th>Size</th>
        ${sortHeader('widthIn', 'Width', sheetSort, 'num', 'sort-sheets')}
        ${sortHeader('lengthIn', 'Length', sheetSort, 'num', 'sort-sheets')}
        ${sortHeader('qty', 'On hand', sheetSort, 'num', 'sort-sheets')}
        <th>Note</th><th></th>
      </tr></thead>
      <tbody>${sheets}</tbody>
    </table></div>
    <button type="button" class="add-row" data-action="add-sheet"${noSheetMaterials ? ' disabled title="Add a sheet material first"' : ''}>+ Add sheet</button>

    <h3 class="sub-head material-kind-head">Board stock</h3>
    <div class="table-scroll"><table class="grid-table">
      <thead><tr><th class="mid"></th><th>Name</th><th>Thickness</th><th>Width</th><th>Note / tag</th><th></th></tr></thead>
      <tbody>${boardMaterials}</tbody>
    </table></div>
    <button type="button" class="add-row" data-action="add-material" data-kind="board">+ Add board material</button>

    <h3 class="sub-head">Boards on hand</h3>
    <div class="table-scroll"><table class="grid-table">
      <thead><tr><th class="mid"></th><th>Material</th><th>Length (ft)</th><th>On hand</th><th>Note</th><th></th></tr></thead>
      <tbody>${boards}</tbody>
    </table></div>
    <button type="button" class="add-row" data-action="add-board"${noBoardMaterials ? ' disabled title="Add a board material first"' : ''}>+ Add board</button>
  </details>`;
}

/**
 * A column header you can sort by.
 *
 * Sorting rewrites the stored order rather than layering a view on top of it,
 * so the manual up and down controls and the column sort are the same fact and
 * cannot disagree. Clicking the column already sorted reverses it.
 */
function sortHeader(key, label, sort, extraClass = '', action = 'sort-parts') {
  const active = sort?.key === key;
  const arrow = active ? (sort.dir === 1 ? ' \u25B2' : ' \u25BC') : '';
  const cls = ['sortable', extraClass, active ? 'sorted' : ''].filter(Boolean).join(' ');
  return `<th class="${cls}"><button type="button" data-action="${action}" data-key="${escapeHtml(key)}"`
    + ` aria-label="Sort by ${escapeHtml(label)}">${escapeHtml(label)}${arrow}</button></th>`;
}

function partsPanel(project, sort, open) {
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
    <td class="qty num"><input type="number" min="1" step="1" name="parts.${index}.qty" data-focus-key="parts.${index}.qty" data-field="parts.${index}.qty" value="${escapeHtml(part.qty)}" /></td>
    <td class="num">${stepperInput({ key: `parts.${index}.widthIn`, value: part.widthIn })}</td>
    <td class="num">${stepperInput({ key: `parts.${index}.lengthIn`, value: part.lengthIn })}</td>
    <td><select name="parts.${index}.materialId" data-focus-key="parts.${index}.materialId" data-field="parts.${index}.materialId">${materialOptions(part.materialId)}</select></td>
    <td class="mid">${project.materials.find((material) => material.id === part.materialId)?.kind === 'board' ? '&mdash;' : `<input type="checkbox" name="parts.${index}.grainLocked" data-focus-key="parts.${index}.grainLocked" data-field="parts.${index}.grainLocked"${part.grainLocked ? ' checked' : ''} aria-label="Grain runs along the length" />`}</td>
    <td class="mid"><button type="button" class="row-remove" data-action="remove-part" data-part="${index}" title="Remove this part" aria-label="Remove this part">&times;</button></td>
  </tr>`).join('');

  return `<details class="section" data-panel="parts"${open.parts ? ' open' : ''}><summary><h2>Parts</h2></summary>
    <div class="table-scroll"><table class="grid-table">
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
    </table></div>
    <button type="button" class="add-row" data-action="add-part">+ Add part</button>
  </details>`;
}

function suppliesPanel(project, open, uiState) {
  const rows = project.supplies.map((supply, index) => {
    const url = safeHttpUrl(supply.url);
    const buyQty = Math.ceil(supply.qty / supply.packQty);
    const editing = uiState?.get(supply.id)?.editing === true;
    const checkbox = `<input type="checkbox" name="supplies.${index}.onHand" data-focus-key="supplies.${index}.onHand" data-field="supplies.${index}.onHand"${supply.onHand ? ' checked' : ''} aria-label="Already have ${escapeHtml(supply.name || 'this supply')}" />`;
    const reorder = `<div class="mid move" role="cell">${reorderButtons('move-supply', index, project.supplies.length)}</div>`;
    const remove = `<button type="button" class="row-remove" data-action="remove-supply" data-supply="${index}" data-supply-id="${escapeHtml(supply.id)}" title="Remove this supply" aria-label="Remove this supply">&times;</button>`;

    if (!editing) {
      const domain = url ? new URL(url).hostname.replace(/^www\./, '') : '';
      const link = url
        ? `<a class="supply-domain" href="${escapeHtml(url)}" title="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(domain)}</a>`
        : '&mdash;';
      const edit = `data-action="edit-supply" data-supply-id="${escapeHtml(supply.id)}"`;
      return `<div class="supply-grid-row supply-display" role="row">
        ${reorder}
        <div class="mid" role="cell">${checkbox}</div>
        <div class="supply-name supply-editable${supply.name ? '' : ' muted'}" role="cell" ${edit}>${escapeHtml(supply.name || 'Unnamed')}</div>
        <div class="num supply-editable" role="cell" ${edit}>${escapeHtml(supply.qty)}</div>
        <div class="num supply-editable" role="cell" ${edit}>${escapeHtml(supply.packQty)}</div>
        <div class="num supply-buy supply-editable" role="cell" ${edit}><output>${escapeHtml(buyQty)}</output></div>
        <div class="supply-editable" role="cell" ${edit}>${displayPrice(supply.price)}</div>
        <div class="supply-editable" role="cell" ${edit}>${escapeHtml(supply.note) || '&mdash;'}</div>
        <div role="cell">${link}</div>
        <div role="cell"><span class="supply-actions"><button type="button" class="supply-edit-action" data-action="edit-supply" data-supply-id="${escapeHtml(supply.id)}">Edit</button>${remove}</span></div>
      </div>`;
    }

    return `<div class="supply-grid-row supply-edit" role="row" data-supply-id="${escapeHtml(supply.id)}">
      ${reorder}
      <div class="mid" role="cell">${checkbox}</div>
      <div role="cell">${textInput({ key: `supplies.${index}.name`, value: supply.name, placeholder: 'Supply name' })}</div>
      <div class="qty num" role="cell">${numericInput({ key: `supplies.${index}.qty`, value: supply.qty, keypad: 'numeric' })}</div>
      <div class="qty num" role="cell">${numericInput({ key: `supplies.${index}.packQty`, value: supply.packQty, keypad: 'numeric' })}</div>
      <div class="num supply-buy" role="cell"><output>${escapeHtml(buyQty)}</output></div>
      <div role="cell">${textInput({ key: `supplies.${index}.price`, value: supply.price })}</div>
      <div role="cell">${textInput({ key: `supplies.${index}.note`, value: supply.note })}</div>
      <div role="cell">${textInput({ key: `supplies.${index}.url`, value: supply.url, type: 'url' })}</div>
      <div role="cell"><span class="supply-actions"><button type="button" class="supply-edit-action" data-action="finish-supply-edit" data-supply-id="${escapeHtml(supply.id)}">Done</button>${remove}</span></div>
    </div>`;
  }).join('');

  return `<details class="section" data-panel="supplies"${open.supplies ? ' open' : ''}><summary><h2>Supplies</h2></summary>
    <div class="table-scroll"><div class="supply-grid" role="table">
      <div class="supply-grid-row supply-grid-head" role="row"><div role="columnheader"></div><div role="columnheader"></div><div role="columnheader">Name</div><div class="num" role="columnheader">Need</div><div class="num" role="columnheader">Per pack</div><div class="num" role="columnheader">Buy</div><div role="columnheader">Price each</div><div role="columnheader">Note</div><div role="columnheader">Link</div><div role="columnheader"></div></div>
      ${rows}
    </div></div>
    <button type="button" class="add-row" data-action="add-supply">+ Add supply</button>
  </details>`;
}

/**
 * `open` says which sections are expanded, so the state survives the re-render
 * that follows every keystroke. Project is closed by default: it is filled in
 * once and then rarely looked at, and it was taking the top of the column to
 * say nothing.
 */
export function renderForms(project, uiState, sort = null, open = { meta: false, materials: true, parts: true, supplies: true }, sheetSort = null) {
  return metaPanel(project, open)
    + materialsPanel(project, uiState, open, sheetSort) + partsPanel(project, sort, open)
    + suppliesPanel(project, open, uiState);
}
