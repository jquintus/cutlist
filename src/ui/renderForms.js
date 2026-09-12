// Presentational string builders for the whole page body.
//
// Everything here is a pure function of the project or the plan. All state
// and all event wiring lives in app.js, so nothing in this file reaches for
// the DOM and nothing here decides anything.

import { THICKNESS_PRESETS, SHEET_PRESETS, formatLength } from '../units.js';
import { escapeHtml } from './escape.js';
import { sheetSvg } from './renderDiagram.js';
import { cutListRows, cutListHtml } from './renderTable.js';

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
    ${field('Name', textInput({ key: 'name', value: project.name, placeholder: 'OmniSled' }))}
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

function thicknessSelect(material, index) {
  const match = THICKNESS_PRESETS.find((preset) => Math.abs(preset.inches - material.thicknessIn) < 1e-6);
  const options = THICKNESS_PRESETS
    .map((preset) => option(preset.id, preset.label, match !== undefined && preset.id === match.id))
    .join('');
  return `<select data-focus-key="m${index}.thickness" data-field="materials.${index}.thicknessPreset">
    ${options}${option('custom', 'Custom', match === undefined)}
  </select>`;
}

function sheetRow(materialIndex, sheet, sheetIndex) {
  const preset = SHEET_PRESETS.find((p) => p.widthIn === sheet.widthIn && p.lengthIn === sheet.lengthIn);
  const options = SHEET_PRESETS
    .map((p) => option(p.id, p.label, preset !== undefined && p.id === preset.id))
    .join('');
  const base = `materials.${materialIndex}.sheets.${sheetIndex}`;
  return `<div class="entry"><div class="row">
    ${field('Size preset', `<select data-focus-key="${base}.preset" data-field="${base}.preset">${options}${option('custom', 'Custom or offcut', preset === undefined)}</select>`)}
    ${field('Width (in)', numericInput({ key: `${base}.widthIn`, value: sheet.widthIn }))}
    ${field('Length (in)', numericInput({ key: `${base}.lengthIn`, value: sheet.lengthIn }))}
    ${field('On hand', numericInput({ key: `${base}.qty`, value: sheet.qty, keypad: 'numeric' }))}
  </div><div class="row">
    ${field('Label or note', textInput({ key: `${base}.label`, value: sheet.label, placeholder: 'Offcut from the shelf job' }))}
    <div><button class="danger" type="button" data-action="remove-sheet" data-material="${materialIndex}" data-sheet="${sheetIndex}">Remove sheet</button></div>
  </div>
  <p class="muted">Set On hand to 0 for a sheet size you still need to buy.</p>
</div>`;
}

function materialsPanel(project) {
  const groups = project.materials.map((material, index) => `<div class="entry">
    <div class="row">
      ${field('Group name', textInput({ key: `materials.${index}.name`, value: material.name, placeholder: '3/4 in plywood' }))}
      ${field('Thickness', thicknessSelect(material, index))}
      ${field('Thickness (in)', numericInput({ key: `materials.${index}.thicknessIn`, value: material.thicknessIn }))}
    </div>
    ${field('Group note', textInput({ key: `materials.${index}.note`, value: material.note, placeholder: '6 mm parts cut from this sheet' }))}
    <h3>Sheets</h3>
    ${material.sheets.map((sheet, sheetIndex) => sheetRow(index, sheet, sheetIndex)).join('')}
    <div class="row">
      <div><button class="secondary" type="button" data-action="add-sheet" data-material="${index}">Add sheet size</button></div>
      <div><button class="danger" type="button" data-action="remove-material" data-material="${index}">Remove group</button></div>
    </div>
  </div>`).join('');

  return `<details class="panel" data-panel="materials"><summary>Material groups (${project.materials.length})</summary><div class="panel-body">
    ${groups}
    <button class="secondary" type="button" data-action="add-material">Add material group</button>
  </div></details>`;
}

function partsPanel(project) {
  const materialOptions = (selected) => project.materials
    .map((material) => option(material.id, material.name, material.id === selected))
    .join('');

  const rows = project.parts.map((part, index) => `<div class="entry">
    <div class="row">
      ${field('Part name', textInput({ key: `parts.${index}.name`, value: part.name, placeholder: 'Full Base' }))}
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

/** The whole editing surface. */
export function renderForms(project) {
  return metaPanel(project) + paramsPanel(project) + materialsPanel(project) + partsPanel(project);
}

function unplannedSection(plan) {
  if (plan.unplanned.length === 0) return '';
  const items = plan.unplanned.map((item) => `<li><strong>${escapeHtml(item.name)}</strong>`
    + ` &times; ${escapeHtml(item.qty)}${item.note ? `. ${escapeHtml(item.note)}` : ''}</li>`).join('');
  return `<section class="unplanned"><h2>Not planned in this version</h2>
    <p>These are carried with the project but are not sheet goods, so nothing below lays them out. Cut them from board stock yourself.</p>
    <ul>${items}</ul></section>`;
}

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

function materialSection(plan, materialPlan) {
  const noteHtml = materialPlan.note ? `<p class="muted">${escapeHtml(materialPlan.note)}</p>` : '';
  const onHand = `<p class="muted">${escapeHtml(materialPlan.onHandSheetCount)} sheet(s) on hand, ${escapeHtml(materialPlan.sheets.length)} laid out.</p>`;

  const sheets = materialPlan.sheets.map((sheetPlan) => {
    const source = sheetPlan.source === 'to-buy' ? 'sheet to buy' : 'sheet on hand';
    return `<article class="sheet-block">
      <h3>${escapeHtml(sheetPlan.label)} <span class="muted">(${source})</span></h3>
      ${sheetSvg(sheetPlan, materialPlan, { ...plan.params, displaySystem: plan.displaySystem })}
    </article>`;
  }).join('');

  return `<section class="material-section">
    <h2>${escapeHtml(materialPlan.name)}${materialPlan.thicknessLabel ? ` (${escapeHtml(materialPlan.thicknessLabel)})` : ''}</h2>
    ${noteHtml}${buyBanner(materialPlan)}${onHand}
    <div class="sheets">${sheets}</div>
  </section>`;
}

/**
 * Notes first, because they carry things like the 6 mm substitution and have
 * to be read before anyone cuts. Then the diagrams, which are the primary view
 * on a phone at the saw, then the out of scope stock, then the printable list.
 */
export function renderResults(plan) {
  const system = plan.displaySystem ?? 'imperial';
  const materials = plan.materials.map((materialPlan) => materialSection(plan, materialPlan)).join('');
  const table = plan.materials.some((materialPlan) => materialPlan.sheets.length > 0)
    ? `<section><h2>Cut list</h2><p class="muted">Kerf ${escapeHtml(formatLength(plan.params.kerfIn, system))}, edge trim ${escapeHtml(formatLength(plan.params.edgeTrimIn, system))}. Work down the list in order.</p>
       <div class="table-wrap">${cutListHtml(cutListRows(plan))}</div></section>`
    : '<p class="muted">Add a material group and some parts to see a layout.</p>';

  return notesSection(plan) + warningsSection(plan) + materials + unplannedSection(plan) + table;
}
