// Container: all state and all event wiring live here.
//
// One loop, always in the same order: change the project, normalize it,
// validate it for a status line, plan it, then redraw every panel from that
// one plan. No handler patches the DOM in place of that loop, which is what
// keeps the diagram and the printed cut list from drifting apart.
//
// One deliberate exception: the active cut step. Highlighting the step someone
// is pointing at is presentation, never project data, and routing it through
// update() would re-render the forms and destroy focus and caret position in a
// half-typed measurement. So it toggles a class directly and is wiped by the
// next real render, which is fine -- nothing is lost but a highlight.

import { newProject, normalizeProject } from '../model.js';
import { planProject } from '../plan.js';
import { validatePlan } from '../packer/invariants.js';
import { validateProject } from '../io/validate.js';
import { createProjectStore, exportProjectJson, readProjectJson, checkReadsBack } from '../io/importExport.js';
import { loadProjectIndex, loadProjectFile } from '../io/projects.js';
import { encodeProject, decodeHash } from '../share/codec.js';
import { loadRecovery, saveRecovery } from '../share/recovery.js';
import { directUpload } from '../share/upload.js';
import { THICKNESS_PRESETS, BOARD_THICKNESS_PRESETS, SHEET_PRESETS, thicknessLabelFor } from '../units.js';
import { buildPdf } from '../export/pdf.js';
import { renderForms } from './renderForms.js';
import { renderResults } from './renderResults.js';
import { readNumericEntry, entryText } from './numericEntry.js';
import { escapeHtml } from './escape.js';
import { debounce } from './debounce.js';

// Deflating and base64-encoding the whole project is real work, and a phone
// keyboard can fire an 'input' event every few tens of milliseconds. Doing
// that encode synchronously on every keystroke made the hash write (and, on
// some browsers, history.replaceState itself, which throttles to 100 calls
// per 10 seconds and throws past that) a per-keystroke cost, and a throw
// there was being reported to the user as "too large to share" -- a message
// about size that had nothing to do with why it actually failed, and one
// that stomped whatever real warning render() had just put on screen.
// Debouncing means the encode only actually runs once typing pauses.
const HASH_WRITE_DEBOUNCE_MS = 400;

// A new project is genuinely empty: no group, no sheet, no part, and no
// invented name. Anything pre-filled here is content somebody has to notice
// and delete before their own project is right.
const store = createProjectStore(newProject());

// Which column the parts table was last sorted by, so the header can show it.
// The order itself lives in the project, not here: a sort rewrites parts[] once
// and the manual move controls go on working on the same array.
let partsSort = null;
let sheetSort = null;

// Which input sections are expanded. Read back off the DOM before each render,
// because the whole form is rebuilt on every keystroke and a section that
// collapsed itself mid-edit would be worse than not collapsing at all.
const openSections = { meta: false, materials: true, parts: true, supplies: true };

function readOpenSections() {
  for (const panel of document.querySelectorAll('[data-panel]')) {
    if (panel.dataset.panel in openSections) openSections[panel.dataset.panel] = panel.open === true;
  }
}

// The save this project is currently attached to, or null when it has never
// been saved. Save falls through to Save As while this is null.

const el = {
  projectName: document.getElementById('project-name'),
  picker: document.getElementById('project-picker'),
  pickerStatus: document.getElementById('picker-status'),
  openDialog: document.getElementById('dialog-open'),
  uploadLink: document.getElementById('link-upload'),
  forms: document.getElementById('forms'),
  results: document.getElementById('results'),
  status: document.getElementById('status'),
  importFile: document.getElementById('import-file'),
};

function setStatus(message, tone = 'muted') {
  el.status.className = `status ${tone === 'error' ? 'banner-warn' : 'muted'}`;
  el.status.textContent = message;
}

// How a menu action reports what happened: its own label, briefly, and then
// back. Nothing a click does adds prose to the page, so nothing a click does
// can shift the layout.
//
// One exception, and only one: an action that refuses to load, save or export
// the project writes the reason to the status line, the same line a refused
// import already uses. That line is where the app says what is wrong with the
// project, a refusal is exactly that, and a menu label is too small to carry
// it. Silence there is the bug this exists to avoid: work reported saved and
// then gone.
const LABEL_FLASH_MS = 2000;

function flashLabel(button, message) {
  if (button.dataset.restoreLabel === undefined) {
    button.dataset.restoreLabel = button.textContent;
  }
  button.textContent = message;
  clearTimeout(Number(button.dataset.restoreTimer));
  button.dataset.restoreTimer = String(setTimeout(() => {
    button.textContent = button.dataset.restoreLabel;
  }, LABEL_FLASH_MS));
}

// ---------------------------------------------------------------------------
// The render loop

function rememberFocus() {
  const active = document.activeElement;
  if (!active || !active.dataset || !active.dataset.focusKey) return null;
  const selection = typeof active.selectionStart === 'number'
    ? { start: active.selectionStart, end: active.selectionEnd }
    : null;
  // A measurement box keeps the characters that were actually typed. The
  // project holds 17 while "17.75" is half entered, and redrawing the box from
  // the project would wipe out the decimal point the moment it was typed.
  const typedText = active.dataset.numeric === 'true' ? active.value : null;
  return { key: active.dataset.focusKey, selection, typedText };
}

function openPanelNames() {
  return [...document.querySelectorAll('details.panel[open]')].map((panel) => panel.dataset.panel);
}

function restoreFocus(memory) {
  if (memory === null) return;
  const target = document.querySelector(`[data-focus-key="${CSS.escape(memory.key)}"]`);
  if (!target) return;
  target.focus();
  const shown = entryText(memory.typedText, target.value);
  if (target.value !== shown) target.value = shown;
  if (memory.selection && typeof target.setSelectionRange === 'function') {
    try {
      target.setSelectionRange(memory.selection.start, memory.selection.end);
    } catch {
      // Some input types refuse a selection range. Focus alone is enough.
    }
  }
}

function render() {
  const memory = rememberFocus();
  const openPanels = openPanelNames();
  const project = store.current;

  const checked = validateProject(project);
  const plan = planProject(project);

  readOpenSections();
  el.forms.innerHTML = renderForms(project, uiState, partsSort, openSections, sheetSort);
  // The base link travels in with the rest of the presentation state: the
  // results renderer stays free of the DOM so the whole surface can be
  // exercised under node --test, which is what caught this.
  view.baseHash = location.hash.split('&')[0] || '#';
  el.results.innerHTML = renderResults(plan, view);
  // The highlighted step belonged to markup that no longer exists.
  activeStep = null;

  for (const panel of document.querySelectorAll('details.panel')) {
    if (openPanels.includes(panel.dataset.panel)) panel.open = true;
  }
  restoreFocus(memory);

  el.projectName.textContent = project.name || 'Untitled project';
  updateUploadLink(project);
  debouncedWriteHash(project);

  if (!checked.ok) {
    setStatus(checked.message, 'error');
  } else if (plan.warnings.length > 0) {
    setStatus(`${plan.warnings.length} thing(s) to check before cutting.`, 'error');
  } else {
    setStatus('');
  }

  // Development aid. A violation here means the packer produced something the
  // saw cannot cut, which the person at the saw needs to know about. Never
  // throw from the render loop.
  const violations = validatePlan(plan);
  if (violations.length > 0) {
    console.warn('cutlist: layout invariants violated', violations);
  }
}

/** Mutate through here so every change lands in the loop exactly once. */
function update(mutate) {
  const draft = structuredClone(store.current);
  mutate(draft);
  store.load(normalizeProject(draft));
  saveRecovery(sessionStorage, store.current);
  render();
}

// ---------------------------------------------------------------------------
// View-only state: how the results are shown, never what they are.
//
// Kept out of the project on purpose. Turning the picture sideways to match
// how a sheet is lying on the horses changes nothing about the cuts, so it
// must not touch the plan, the share link or the print output.

// Presentation state: how a sheet is shown, which view is open on its own, and
// which boxes are ticked. None of it changes a measurement or a cut.
const view = { rotated: {}, focusSheet: null, focusView: null, ticked: new Set() };

/**
 * Which mode each preset control is in, keyed by the entity's own stable id.
 *
 * Deliberately not on the project: normalizeProject returns a fixed object
 * literal and drops unknown fields, so a mode stored there would not survive a
 * single keystroke. Deriving it from the numbers instead is what made choosing
 * "Custom or offcut" on a sheet that still matched a preset do nothing visible
 * -- the next render simply re-derived the old preset.
 */
const uiState = new Map();

function setControlMode(id, sizeMode) {
  uiState.set(id, { ...(uiState.get(id) ?? {}), sizeMode });
}

function setSupplyEditing(id, editing) {
  uiState.set(id, { ...(uiState.get(id) ?? {}), editing });
}

function finishAllSupplyEdits() {
  for (const [supplyId, state] of uiState) {
    uiState.set(supplyId, { ...state, editing: false });
  }
}

/**
 * Keep a sheet's stored size-preset mode honest after its dimensions change by
 * anything other than the preset dropdown itself -- the repack-rotate button,
 * or typing straight into Width/Length. Without this, the dropdown can go on
 * showing a preset (or "Custom or offcut") that no longer matches what the
 * sheet actually measures; picking whichever option merely looks selected
 * already does nothing, because as far as the browser can tell nothing about
 * the control changed.
 */
function syncSheetSizeMode(sheet) {
  const preset = SHEET_PRESETS.find((candidate) => candidate.widthIn === sheet.widthIn && candidate.lengthIn === sheet.lengthIn);
  setControlMode(sheet.id, preset === undefined ? 'custom' : 'preset');
}

function renderResultsOnly() {
  el.results.innerHTML = renderResults(planProject(store.current), view);
  activeStep = null;
}

// ---------------------------------------------------------------------------
// The active cut step: on screen only, never in the plan and never in print.

let activeStep = null;

/** The nearest element that names a step and the sheet it belongs to, or null. */
function stepElementFrom(node) {
  if (!node || typeof node.closest !== 'function') return null;
  return node.closest('[data-step][data-sheet]');
}

function clearActiveStep() {
  for (const node of el.results.querySelectorAll('.is-active')) node.classList.remove('is-active');
  for (const node of el.results.querySelectorAll('.has-selection')) node.classList.remove('has-selection');
  activeStep = null;
}

function setActiveStep(sheet, seq) {
  if (activeStep !== null && activeStep.sheet === sheet && activeStep.seq === seq) return;
  clearActiveStep();
  // Both the list item and the drawn line carry the same pair, so one query
  // lights the step up on both sides and on no other sheet.
  const selector = `[data-sheet="${CSS.escape(sheet)}"][data-step="${CSS.escape(seq)}"]`;
  for (const node of el.results.querySelectorAll(selector)) node.classList.add('is-active');
  // The sheet that owns the step goes quiet everywhere else: its other
  // measurements are noise once someone has said which cut they are making.
  const svg = el.results.querySelector(`.sheet-todo[data-sheet="${CSS.escape(sheet)}"]`)
    ?.closest('.sheet')?.querySelector('.sheet-view');
  svg?.classList.add('has-selection');
  activeStep = { sheet, seq };
}

el.results.addEventListener('change', (event) => {
  const box = event.target.closest?.('[data-tick]');
  if (!box) return;
  const id = box.dataset.tick;
  if (box.checked) view.ticked.add(id);
  else view.ticked.delete(id);
  box.closest('li')?.classList.toggle('done', box.checked);
  // Straight to the fragment, not through render(): re-rendering here would
  // drop the box the pointer is still on.
  debouncedWriteHash(store.current);
});

el.results.addEventListener('click', (event) => {
  const viewLink = event.target.closest?.('[data-view-link]');
  if (viewLink) return; // A real link. Let the browser navigate.

  const rotate = event.target.closest?.('[data-action="rotate-view"]');
  if (rotate) {
    const key = rotate.dataset.sheet;
    view.rotated[key] = !view.rotated[key];
    renderResultsOnly();
    return;
  }

  const repack = event.target.closest?.('[data-action="rotate-sheet"]');
  if (repack) {
    update((draft) => ACTIONS['rotate-sheet'](draft, { material: repack.dataset.material, spec: repack.dataset.spec }));
    return;
  }

  const target = stepElementFrom(event.target);
  if (target === null) {
    clearActiveStep();
    return;
  }
  const same = activeStep !== null
    && activeStep.sheet === target.dataset.sheet
    && String(activeStep.seq) === String(target.dataset.step);
  if (same) clearActiveStep();
  else setActiveStep(target.dataset.sheet, target.dataset.step);
});

// ---------------------------------------------------------------------------
// Field edits

function setPath(target, path, value) {
  const keys = path.split('.');
  let cursor = target;
  for (const key of keys.slice(0, -1)) cursor = cursor[key];
  cursor[keys.at(-1)] = value;
}

function getPath(target, path) {
  return path.split('.').reduce((cursor, key) => (cursor === undefined || cursor === null ? undefined : cursor[key]), target);
}

const NUMERIC_FIELDS = /(\.|^)(kerfIn|edgeTrimIn|widthIn|lengthIn|qty|packQty|thicknessIn)$/;
const SHEET_DIMENSION = /^materials\.(\d+)\.sheets\.(\d+)\.(widthIn|lengthIn)$/;
const BOARD_LENGTH_FEET = /^materials\.(\d+)\.boards\.(\d+)\.lengthFt$/;
const SUPPLY_COUNT = /^supplies\.\d+\.(qty|packQty)$/;

function invalidSupplyCountIn(row) {
  return [...row.querySelectorAll('[data-field]')].find((field) => {
    if (!SUPPLY_COUNT.test(field.dataset.field) || field.value === '') return false;
    const value = Number(field.value);
    return !Number.isInteger(value) || value <= 0;
  }) ?? null;
}

function rejectInvalidSupplyCount(action) {
  const invalid = [...el.forms.querySelectorAll('.supply-edit')]
    .map((row) => invalidSupplyCountIn(row))
    .find(Boolean);
  if (!invalid) return false;
  setStatus(`Fix the highlighted supply quantity before ${action}.`, 'error');
  invalid.focus();
  return true;
}

function hasInvalidLiveSupplyCount() {
  return [...el.forms.querySelectorAll('.supply-edit')]
    .some((row) => invalidSupplyCountIn(row) !== null);
}

/**
 * Resize a sheet, keeping its heading honest.
 *
 * A sheet's label is either the size the app derived for it or a note somebody
 * wrote about where the offcut came from. A derived label has to follow the
 * size, or the heading goes on announcing 48 x 96 over a diagram of a 30 1/2 in
 * offcut. A written note is never ours to overwrite.
 */
function resizeSheet(sheet, change) {
  const wasDerived = sheet.label === `${sheet.widthIn} x ${sheet.lengthIn}`;
  change(sheet);
  if (wasDerived) sheet.label = `${sheet.widthIn} x ${sheet.lengthIn}`;
}

function applyFieldChange(fieldPath, input, { deferRender = false } = {}) {
  const mutate = (draft) => {
    if (input.type === 'checkbox') {
      setPath(draft, fieldPath, input.checked === true);
      return;
    }
    if (fieldPath.endsWith('.kind')) {
      const base = fieldPath.replace(/\.kind$/, '');
      const material = getPath(draft, base);
      const nextKind = input.value === 'board' ? 'board' : 'sheet';
      material.kind = nextKind;
      if (nextKind === 'board') {
        material.sheets = [];
        if (!(material.widthIn > 0)) material.widthIn = 3.5;
      } else {
        material.boards = [];
      }
      const presets = nextKind === 'board' ? BOARD_THICKNESS_PRESETS : THICKNESS_PRESETS;
      const preset = presets.find((candidate) => Math.abs(candidate.inches - material.thicknessIn) < 1e-6);
      material.thicknessLabel = preset?.label ?? thicknessLabelFor(material.thicknessIn, draft.displaySystem);
      setControlMode(material.id, preset === undefined ? 'custom' : 'preset');
      return;
    }
    if (fieldPath.endsWith('.thicknessPreset')) {
      const base = fieldPath.replace(/\.thicknessPreset$/, '');
      const presets = getPath(draft, `${base}.kind`) === 'board' ? BOARD_THICKNESS_PRESETS : THICKNESS_PRESETS;
      const preset = presets.find((candidate) => candidate.id === input.value);
      // The choice is recorded whether or not it moves a number, which is what
      // makes picking "Other" visible even when the thickness is unchanged.
      setControlMode(getPath(draft, `${base}.id`), preset === undefined ? 'custom' : 'preset');
      if (preset === undefined) return; // "Other" leaves the typed inches alone.
      setPath(draft, `${base}.thicknessIn`, preset.inches);
      setPath(draft, `${base}.thicknessLabel`, preset.label);
      return;
    }
    if (fieldPath.endsWith('.thicknessIn')) {
      // A typed thickness has to relabel the group it belongs to. Every heading
      // and the whole-project shopping list read the label, so a custom
      // thickness that left the preset's label behind sent someone to the store
      // for the wrong plywood while the project quietly used the new number.
      const base = fieldPath.replace(/\.thicknessIn$/, '');
      const inches = readNumericEntry(input.value, getPath(draft, fieldPath));
      setPath(draft, fieldPath, inches);
      setPath(draft, `${base}.thicknessLabel`, thicknessLabelFor(inches, draft.displaySystem));
      return;
    }
    if (fieldPath.endsWith('.preset')) {
      const base = fieldPath.replace(/\.preset$/, '');
      const preset = SHEET_PRESETS.find((candidate) => candidate.id === input.value);
      setControlMode(getPath(draft, `${base}.id`), preset === undefined ? 'custom' : 'preset');
      if (preset === undefined) return; // "Custom or offcut" leaves the size alone.
      resizeSheet(getPath(draft, base), (sheet) => {
        sheet.widthIn = preset.widthIn;
        sheet.lengthIn = preset.lengthIn;
      });
      return;
    }
    const sheetDimension = SHEET_DIMENSION.exec(fieldPath);
    if (sheetDimension !== null) {
      const [, materialIndex, sheetIndex, dimension] = sheetDimension;
      const sheet = draft.materials[Number(materialIndex)].sheets[Number(sheetIndex)];
      resizeSheet(sheet, () => {
        sheet[dimension] = readNumericEntry(input.value, sheet[dimension]);
      });
      syncSheetSizeMode(sheet);
      return;
    }
    const boardLength = BOARD_LENGTH_FEET.exec(fieldPath);
    if (boardLength !== null) {
      const [, materialIndex, boardIndex] = boardLength;
      const board = draft.materials[Number(materialIndex)].boards[Number(boardIndex)];
      board.lengthIn = readNumericEntry(input.value, board.lengthIn / 12) * 12;
      return;
    }
    if (SUPPLY_COUNT.test(fieldPath)) {
      const count = Number(input.value);
      if (Number.isInteger(count) && count > 0) setPath(draft, fieldPath, count);
      return;
    }
    if (NUMERIC_FIELDS.test(fieldPath)) {
      // Half-typed text keeps the number entered so far rather than snapping to
      // zero, so a decimal inch survives the keystroke that starts it.
      setPath(draft, fieldPath, readNumericEntry(input.value, getPath(draft, fieldPath)));
      return;
    }
    setPath(draft, fieldPath, input.value);
  };

  if (!deferRender) {
    update(mutate);
    return;
  }

  const draft = structuredClone(store.current);
  mutate(draft);
  store.load(normalizeProject(draft));
  saveRecovery(sessionStorage, store.current);
  debouncedWriteHash(store.current);

  const typedInvalidCount = SUPPLY_COUNT.test(fieldPath)
    && input.value !== ''
    && (!Number.isInteger(Number(input.value)) || Number(input.value) <= 0);
  const checked = validateProject(store.current);
  const message = typedInvalidCount ? 'Supply quantities must be positive whole numbers.' : (checked.ok ? '' : checked.message);
  setStatus(message, message === '' ? 'muted' : 'error');

  // Need and Per pack affect one value in the row. Updating that output in
  // place keeps it live without rebuilding the entire form and layout for
  // every character typed.
  const supplyMatch = /^supplies\.(\d+)\.(qty|packQty)$/.exec(fieldPath);
  if (supplyMatch !== null) {
    const supply = store.current.supplies[Number(supplyMatch[1])];
    const output = input.closest('.supply-grid-row')?.querySelector('.supply-buy output');
    if (supply && output) output.textContent = String(Math.ceil(supply.qty / supply.packQty));
  }
}

// ---------------------------------------------------------------------------
// Structural actions

/**
 * A fresh id for a newly added entity: a stable prefix plus the current time
 * and its position, so ids stay unique within a session and never renumber
 * when a sibling is removed later. Spelled once so add-material, add-sheet
 * and add-part mint ids the same way.
 */
function mintId(prefix, position) {
  return `${prefix}${Date.now()}${position}`;
}

/** Move one entry of `list` by `dataset.dir`, clamped to the list. */
function moveWithin(list, dataset) {
  const from = Number(dataset.index);
  const to = from + Number(dataset.dir);
  if (to < 0 || to >= list.length) return;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
}

const ACTIONS = {
  // Ids are minted explicitly, the way add-part already does it. normalizeProject
  // derives a missing sheet id positionally, so ids would renumber after a
  // removal and a control mode keyed by sheet id would migrate onto a different
  // sheet.
  'add-material': (draft, dataset) => {
    const kind = dataset.kind === 'board' ? 'board' : 'sheet';
    const materialId = mintId('m', draft.materials.length + 1);
    draft.materials.push({
      id: materialId,
      // No invented name: an empty field reads as "fill this in", where
      // "Material 2" reads as a decision someone already made.
      name: '',
      thicknessIn: kind === 'board' ? 1 : 0.75,
      thicknessLabel: kind === 'board' ? '4/4' : '3/4 in',
      note: '',
      kind,
      widthIn: kind === 'board' ? 3.5 : 0,
      // Empty note, same as add-sheet: sheetLabel() falls back to the sheet's
      // own dimensions for the heading, so nothing is lost by not inventing it.
      sheets: kind === 'sheet'
        ? [{ id: `${materialId}s1`, label: '', widthIn: 48, lengthIn: 96, qty: 1, note: '' }]
        : [],
      boards: kind === 'board'
        ? [{ id: `${materialId}b1`, label: '', lengthIn: 96, qty: 1, note: '' }]
        : [],
    });
  },
  'remove-material': (draft, dataset) => {
    draft.materials.splice(Number(dataset.material), 1);
  },
  'add-sheet': (draft) => {
    const material = draft.materials.find((candidate) => candidate.kind !== 'board');
    if (material === undefined) return;
    material.sheets.push({
      id: mintId(`${material.id}s`, material.sheets.length + 1),
      // Empty note: sheetLabel() falls back to the sheet's own dimensions for
      // the heading, so nothing is lost by not inventing one.
      label: '',
      widthIn: 48,
      lengthIn: 96,
      qty: 1,
      note: '',
    });
  },
  'add-board': (draft) => {
    const material = draft.materials.find((candidate) => candidate.kind === 'board');
    if (material === undefined) return;
    material.boards.push({
      id: mintId(`${material.id}b`, material.boards.length + 1),
      label: '',
      lengthIn: 96,
      qty: 1,
      note: '',
    });
  },
  // Changing a sheet's material moves it between the two lists. The sheet keeps
  // its id, so a control mode set on it follows it across.
  'move-sheet-to': (draft, dataset) => {
    const from = Number(dataset.material);
    const to = Number(dataset.value);
    if (from === to || Number.isNaN(to) || draft.materials[to]?.kind === 'board') return;
    const [moved] = draft.materials[from].sheets.splice(Number(dataset.sheet), 1);
    draft.materials[to].sheets.push(moved);
  },
  'move-board-to': (draft, dataset) => {
    const from = Number(dataset.material);
    const to = Number(dataset.value);
    if (from === to || Number.isNaN(to) || draft.materials[to]?.kind !== 'board') return;
    const [moved] = draft.materials[from].boards.splice(Number(dataset.board), 1);
    draft.materials[to].boards.push(moved);
  },
  // Swapping a sheet spec's two dimensions is a real project edit: it goes
  // through update() like any other, so the packer reruns and the plan changes.
  // The view-only rotate is a different control entirely and touches nothing
  // here.
  'rotate-sheet': (draft, dataset) => {
    // Addressed by the spec's own id, not by position. A material with one
    // sheet size at a quantity of two lays out two sheets, so the index of a
    // drawn sheet is not the index of the size it came from, and repacking the
    // second one reached past the end of the list.
    const material = draft.materials[Number(dataset.material)];
    const sheet = material?.sheets.find((candidate) => candidate.id === dataset.spec);
    if (sheet === undefined) return;
    resizeSheet(sheet, () => {
      [sheet.widthIn, sheet.lengthIn] = [sheet.lengthIn, sheet.widthIn];
    });
    syncSheetSizeMode(sheet);
  },
  // Reordering. The list a person builds is their own, and its order carries
  // through to the cut list and the parts checklist, so it has to be editable
  // after the fact. A move that would run off either end is a no-op rather than
  // an error: the buttons are disabled there, and a keyboard can still reach
  // them for a moment during a re-render.
  'sort-parts': (draft, dataset) => {
    const key = dataset.key;
    partsSort = { key, dir: partsSort?.key === key && partsSort.dir === 1 ? -1 : 1 };
    const dir = partsSort.dir;
    // Material sorts by the group's position, not by its id, so the order on
    // screen matches the order the materials are listed in above.
    const rank = (part) => (key === 'materialId'
      ? draft.materials.findIndex((material) => material.id === part.materialId)
      : part[key]);
    draft.parts.sort((a, b) => {
      const left = rank(a);
      const right = rank(b);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * dir;
      return String(left).localeCompare(String(right), undefined, { numeric: true }) * dir;
    });
  },
  // Sheets sort inside their own material, because the table is grouped by
  // material and a sort that shuffled rows across those groups would be
  // reassigning stock rather than ordering it.
  'sort-sheets': (draft, dataset) => {
    const key = dataset.key;
    sheetSort = { key, dir: sheetSort?.key === key && sheetSort.dir === 1 ? -1 : 1 };
    if (key === 'materialId') {
      const positions = draft.materials
        .map((material, index) => ({ material, index }))
        .filter(({ material }) => material.kind !== 'board')
        .map(({ index }) => index);
      const sorted = positions
        .map((index) => draft.materials[index])
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) * sheetSort.dir);
      positions.forEach((position, index) => { draft.materials[position] = sorted[index]; });
      return;
    }
    for (const material of draft.materials) {
      material.sheets.sort((a, b) => (a[key] - b[key]) * sheetSort.dir);
    }
  },
  'move-part': (draft, dataset) => moveWithin(draft.parts, dataset),
  'move-supply': (draft, dataset) => moveWithin(draft.supplies, dataset),
  'move-material': (draft, dataset) => {
    const from = Number(dataset.material);
    const material = draft.materials[from];
    if (material === undefined || material.kind !== dataset.kind) return;
    const peers = draft.materials
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.kind === material.kind);
    const position = peers.findIndex(({ index }) => index === from);
    const target = peers[position + Number(dataset.dir)]?.index;
    if (target === undefined) return;
    [draft.materials[from], draft.materials[target]] = [draft.materials[target], draft.materials[from]];
  },
  'move-sheet': (draft, dataset) => moveWithin(draft.materials[Number(dataset.material)].sheets, dataset),
  'move-board': (draft, dataset) => moveWithin(draft.materials[Number(dataset.material)].boards, dataset),
  'remove-sheet': (draft, dataset) => {
    draft.materials[Number(dataset.material)].sheets.splice(Number(dataset.sheet), 1);
  },
  'remove-board': (draft, dataset) => {
    draft.materials[Number(dataset.material)].boards.splice(Number(dataset.board), 1);
  },
  'add-part': (draft) => {
    const material = draft.materials[0];
    draft.parts.push({
      id: mintId('p', draft.parts.length + 1),
      name: '',
      qty: 1,
      widthIn: material?.kind === 'board' ? material.widthIn : 12,
      lengthIn: 12,
      materialId: material?.id ?? '',
      grainLocked: false,
    });
  },
  'remove-part': (draft, dataset) => {
    draft.parts.splice(Number(dataset.part), 1);
  },
  'add-supply': (draft) => {
    finishAllSupplyEdits();
    const id = mintId('s', draft.supplies.length + 1);
    draft.supplies.push({
      id,
      name: '',
      qty: 1,
      packQty: 1,
      onHand: false,
      price: '',
      note: '',
      url: '',
    });
    setSupplyEditing(id, true);
  },
  'edit-supply': (_draft, dataset) => setSupplyEditing(dataset.supplyId, true),
  'finish-supply-edit': (_draft, dataset) => setSupplyEditing(dataset.supplyId, false),
  'remove-supply': (draft, dataset) => {
    uiState.delete(dataset.supplyId);
    draft.supplies.splice(Number(dataset.supply), 1);
  },
};

// ---------------------------------------------------------------------------
// Sharing, import, export

/**
 * Point every per-sheet link at the current project.
 *
 * A sheet link carries the whole project plus that sheet's key, so it is a real
 * URL someone can middle-click, open in a tab of its own, or keep on a phone at
 * the saw. That means its href has to be rebuilt whenever the project changes,
 * which is exactly when the address bar's own hash is rewritten.
 */
function refreshSheetLinks() {
  const base = location.hash.split('&')[0];
  const done = view.ticked?.size ? `&done=${[...view.ticked].map(encodeURIComponent).join(',')}` : '';
  for (const link of document.querySelectorAll('[data-sheet-link]')) {
    link.setAttribute('href', `${base}&sheet=${encodeURIComponent(link.dataset.sheetLink)}`);
  }
  for (const link of document.querySelectorAll('[data-view-link]')) {
    link.setAttribute('href', `${base}&view=${encodeURIComponent(link.dataset.viewLink)}${done}`);
  }
}

function focusSuffix() {
  const parts = [];
  if (view.focusSheet) parts.push(`&sheet=${encodeURIComponent(view.focusSheet)}`);
  if (view.focusView) parts.push(`&view=${encodeURIComponent(view.focusView)}`);
  // Ticks ride in the fragment too. A checkbox that forgets itself on refresh
  // is worse than no checkbox: it looks like progress and keeps none.
  if (view.ticked?.size) parts.push(`&done=${[...view.ticked].map(encodeURIComponent).join(',')}`);
  return parts.join('');
}

function writeHash(project) {
  try {
    const hash = `#${encodeProject(project)}${focusSuffix()}`;
    // replaceState, not pushState: the back button should leave the page, not
    // walk backward through every keystroke.
    history.replaceState(null, '', hash);
    refreshSheetLinks();
  } catch {
    setStatus('This project is too large to put in a share link. Export it as a file instead.', 'error');
  }
}

// See HASH_WRITE_DEBOUNCE_MS above for why this runs debounced rather than
// straight out of render(). Call `.flush()` (as copyShareLink does) anywhere
// the address bar's hash needs to be caught up with the in-memory project
// right now, rather than after the debounce window.
const debouncedWriteHash = debounce(writeHash, HASH_WRITE_DEBOUNCE_MS);

function saveTextFile(filename, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // WebKit may not begin reading the blob until after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyShareLink(button) {
  // The address bar may still be waiting out the debounce window from the
  // last keystroke; flush it so what gets copied is the project on screen,
  // not whatever was last written.
  debouncedWriteHash.flush();
  try {
    await navigator.clipboard.writeText(location.href);
    flashLabel(button, 'Copied');
  } catch {
    flashLabel(button, 'Link is in the address bar');
  }
}

/**
 * Point the Save to GitHub anchor at the current project.
 *
 * A plain href, recomputed on every render: the destination is visible in the
 * status bar before the click, middle click and right click work, and nothing
 * navigates on anyone's behalf. An oversized project, which will not fit in a
 * prefilled URL, becomes a data: href with a download name -- still a real
 * link, still right-clickable, still nothing scripted.
 */
function updateUploadLink(project) {
  const result = directUpload(project);
  el.uploadLink.removeAttribute('aria-disabled');
  if (result.kind === 'url') {
    el.uploadLink.href = result.url;
    el.uploadLink.removeAttribute('download');
    return;
  }
  el.uploadLink.href = `data:application/json;charset=utf-8,${encodeURIComponent(result.json)}`;
  el.uploadLink.setAttribute('download', result.filename);
}

// ---------------------------------------------------------------------------
// Projects: New, Open an example, and the file and URL round trips.

function loadProject(project) {
  // Both are this browser's own leftover display state, not this project's.
  // Left in place, a control mode or a rotated diagram from the project just
  // closed could carry into the one just opened -- including a sheet-size
  // dropdown that goes on naming a size the new project's own width and
  // length no longer match.
  uiState.clear();
  view.rotated = {};
  view.ticked.clear();
  store.load(project);
  saveRecovery(sessionStorage, store.current);
  render();
}


async function populatePicker() {
  const result = await loadProjectIndex();
  const options = ['<option value="">Pick a project</option>'];
  for (const entry of result.projects) {
    options.push(`<option value="${escapeHtml(entry.file)}">${escapeHtml(entry.name || entry.file)}</option>`);
  }
  el.picker.innerHTML = options.join('');
  el.pickerStatus.textContent = result.ok ? '' : result.message;
}

async function openIndexedProject(file) {
  if (file === '') return;
  const result = await loadProjectFile(file);
  if (!result.ok) {
    return;
  }
  // An in-repo project is not attached to a local save: saving it should ask
  // where to put it rather than silently overwriting something.
  loadProject(result.project);
  el.openDialog.close();
  // A <select> that fires only on an actual value change never notices a
  // repeated pick of the option already showing, so choosing the same
  // built-in project a second time -- to discard edits and reload it fresh --
  // did nothing. Clearing the value here makes the next pick of it, however
  // soon, a real change again.
  el.picker.value = '';
}

// ---------------------------------------------------------------------------
// Wiring

// A text field fires 'input' as you type; a select or checkbox fires only
// 'change'. Listening for both with the same handler covers every field type.
function onFieldEvent(event) {
  const fieldPath = event.target.dataset?.field;
  if (!fieldPath) return;
  if (fieldPath.endsWith('.kind')) {
    const base = fieldPath.replace(/\.kind$/, '');
    const material = getPath(store.current, base);
    const oldKind = material.kind === 'board' ? 'board' : 'sheet';
    const newKind = event.target.value === 'board' ? 'board' : 'sheet';
    const oldStock = oldKind === 'board' ? material.boards : material.sheets;
    if (oldKind !== newKind && oldStock.length > 0) {
      const noun = oldKind === 'board' ? 'board' : 'sheet';
      const message = `Changing this group to ${newKind} stock removes ${oldStock.length} ${noun} stock entr${oldStock.length === 1 ? 'y' : 'ies'}. Continue?`;
      if (!window.confirm(message)) {
        render();
        return;
      }
    }
  }
  const supplyEditor = event.target.closest?.('.supply-edit');
  applyFieldChange(fieldPath, event.target, { deferRender: supplyEditor !== null });
  if (SUPPLY_COUNT.test(fieldPath)) {
    const value = Number(event.target.value);
    const invalid = event.target.value !== '' && (!Number.isInteger(value) || value <= 0);
    event.target.toggleAttribute('aria-invalid', invalid);
    if (hasInvalidLiveSupplyCount()) {
      el.uploadLink.removeAttribute('href');
      el.uploadLink.removeAttribute('download');
      el.uploadLink.setAttribute('aria-disabled', 'true');
    } else {
      updateUploadLink(store.current);
    }
  }
}

el.forms.addEventListener('change', (event) => {
  const picker = event.target.closest?.('[data-action-select]');
  if (!picker) return;
  const action = ACTIONS[picker.dataset.actionSelect];
  if (action) update((draft) => action(draft, { ...picker.dataset, value: picker.value }));
});

el.forms.addEventListener('input', onFieldEvent);
el.forms.addEventListener('change', onFieldEvent);

el.forms.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.target.tagName === 'TEXTAREA') return;
  const row = event.target.closest?.('.supply-edit[data-supply-id]');
  if (!row) return;
  event.preventDefault();
  const invalid = invalidSupplyCountIn(row);
  if (invalid) {
    setStatus('Supply quantities must be positive whole numbers.', 'error');
    invalid.focus();
    return;
  }
  setSupplyEditing(row.dataset.supplyId, false);
  render();
});

// The nudge buttons beside a measurement. They read the field's stored value
// rather than the box's text, so a half-typed entry is never stepped into
// something nobody meant.
el.forms.addEventListener('click', (event) => {
  const step = event.target.closest?.('.step');
  if (!step) return;
  event.preventDefault();
  const key = step.dataset.stepFor;
  const by = Number(step.dataset.step);
  update((draft) => {
    const boardLength = BOARD_LENGTH_FEET.exec(key);
    if (boardLength !== null) {
      const [, materialIndex, boardIndex] = boardLength;
      const board = draft.materials[Number(materialIndex)].boards[Number(boardIndex)];
      board.lengthIn = Math.max(0, Math.round((board.lengthIn + by * 12) * 10000) / 10000);
      return;
    }
    const current = Number(getPath(draft, key));
    const base = Number.isFinite(current) ? current : 0;
    setPath(draft, key, Math.max(0, Math.round((base + by) * 10000) / 10000));
  });
});

el.forms.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'finish-supply-edit') {
    const row = button.closest('.supply-edit');
    const invalid = invalidSupplyCountIn(row);
    if (invalid) {
      event.preventDefault();
      setStatus('Supply quantities must be positive whole numbers.', 'error');
      invalid.focus();
      return;
    }
  }
  const action = ACTIONS[button.dataset.action];
  if (action) update((draft) => action(draft, button.dataset));
});

const shareButton = document.getElementById('btn-share');
// The menu is a button and a panel, so opening and closing it is ours to run.
// A menu that stays open when you click the page behaves like a stuck drawer,
// so a click anywhere else and the Escape key both close it, and focus goes
// back to the button so the keyboard does not get stranded in a hidden panel.
const menuButton = document.getElementById('btn-menu');
const menuBody = document.getElementById('menu-body');

function setMenuOpen(open) {
  menuBody.hidden = !open;
  menuButton.setAttribute('aria-expanded', String(open));
}

menuButton.addEventListener('click', (event) => {
  event.stopPropagation();
  setMenuOpen(menuBody.hidden);
});

// Any activation inside the menu finishes the interaction, including the
// Save to GitHub link, which the reader may be opening in a new tab.
menuBody.addEventListener('click', () => setMenuOpen(false));

document.addEventListener('click', (event) => {
  if (!menuBody.hidden && !menuBody.contains(event.target)) setMenuOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || menuBody.hidden) return;
  setMenuOpen(false);
  menuButton.focus();
});

shareButton.addEventListener('click', () => {
  if (!rejectInvalidSupplyCount('copying a share link')) copyShareLink(shareButton);
});

el.uploadLink.addEventListener('click', (event) => {
  if (rejectInvalidSupplyCount('saving to GitHub')) event.preventDefault();
});

// New project is a plain link to this page with no fragment, so it behaves like
// Save to GitHub: middle-click or cmd-click opens a blank project in a tab of
// its own, and where it opens stays the reader's call. No handler, because a
// handler is what would take that choice away.

document.getElementById('btn-open').addEventListener('click', () => el.openDialog.showModal());

// Export a PDF outright: one click, a file, nothing to choose. Going through
// the print dialog put a Save as PDF destination in front of someone who had
// already said what they wanted, and produced whatever the browser's page
// setup happened to be rather than a page built for this.
document.getElementById('btn-pdf').addEventListener('click', () => {
  if (rejectInvalidSupplyCount('exporting a PDF')) return;
  const project = store.current;
  const bytes = buildPdf(planProject(project), { title: project.name || 'cutlist' });
  const name = (project.name || 'cutlist').replace(/[^\w -]+/g, '').trim() || 'cutlist';
  saveTextFile(`${name}.pdf`, bytes, 'application/pdf');
  setStatus(`Saved ${name}.pdf`);
});

document.getElementById('btn-export').addEventListener('click', () => {
  if (rejectInvalidSupplyCount('exporting')) return;
  // A file this build would refuse to import is not a backup of anything, so
  // it is better not written: Export answers to the same chain Import does.
  const checked = checkReadsBack(store.current);
  if (!checked.ok) {
    setStatus(`Not exported. ${checked.message}`, 'error');
    el.status.scrollIntoView({ block: 'nearest' });
    return;
  }
  finishAllSupplyEdits();
  render();
  const json = exportProjectJson(store.current);
  const baseName = (store.current.name || 'project').replace(/[^\w -]+/g, '').trim() || 'project';
  const filename = `${baseName}.json`;
  saveTextFile(filename, json, 'application/json');
  setStatus(`Saved ${filename}`);
});
document.getElementById('btn-import').addEventListener('click', () => el.importFile.click());

// A reload right after typing should not land on a hash from before the last
// few keystrokes just because the debounce window had not closed yet.
window.addEventListener('pagehide', () => {
  saveRecovery(sessionStorage, store.current);
  debouncedWriteHash.flush();
});

el.importFile.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  const result = readProjectJson(text);
  if (!result.ok) {
    // The project on screen is untouched: nothing was assigned.
    setStatus(result.message, 'error');
  } else {
    // An imported file is not attached to a local save either.
    loadProject(result.project);
  }
  event.target.value = '';
});

el.picker.addEventListener('change', (event) => openIndexedProject(event.target.value));

// ---------------------------------------------------------------------------
// Start up. A share link in the fragment wins over anything the picker offers,
// because that link is what someone opened on purpose.

/** Which sheet, if any, the current fragment asks to show on its own. */
function focusFromHash() {
  const match = /[&]sheet=([^&]*)/.exec(location.hash);
  return match ? decodeURIComponent(match[1]) : null;
}

function viewFromHash() {
  const match = /[&]view=([^&]*)/.exec(location.hash);
  return match ? decodeURIComponent(match[1]) : null;
}

function ticksFromHash() {
  const match = /[&]done=([^&]*)/.exec(location.hash);
  if (!match || match[1] === '') return new Set();
  return new Set(match[1].split(',').map(decodeURIComponent));
}

/**
 * Follow a sheet link, and the Back button out of one.
 *
 * The app writes its own fragment with replaceState, which fires nothing, so
 * the only thing that reaches this is a real navigation: someone clicking a
 * sheet link, or going back. Only the focus changes; the project in the
 * fragment is the one already on screen, and reloading it would throw away
 * whatever has been typed since.
 */
window.addEventListener('hashchange', () => {
  const next = focusFromHash();
  const nextView = viewFromHash();
  if (next === view.focusSheet && nextView === view.focusView) return;
  view.focusSheet = next;
  view.focusView = nextView;
  document.body.classList.toggle('focus-sheet', next !== null || nextView !== null);
  render();
  refreshSheetLinks();
  window.scrollTo(0, 0);
});

view.focusSheet = focusFromHash();
view.focusView = viewFromHash();
view.ticked = ticksFromHash();

const restored = decodeHash(location.hash);
const navigation = performance.getEntriesByType?.('navigation')?.[0];
const reloadLostHash = location.hash === '' && navigation?.type === 'reload';
let startupStatus = '';
let startupStatusKind = '';
if (restored.ok) {
  store.load(restored.project);
} else if (location.hash !== '' || reloadLostHash) {
  const recovery = loadRecovery(sessionStorage);
  if (recovery.ok) {
    store.load(recovery.project);
    startupStatus = 'The project URL could not be read. Your last edit was recovered from this tab.';
  } else if (location.hash !== '') {
    startupStatus = restored.error;
    startupStatusKind = 'error';
  }
}
saveRecovery(sessionStorage, store.current);
document.body.classList.toggle('focus-sheet', view.focusSheet !== null || view.focusView !== null);
render();
if (startupStatus !== '') setStatus(startupStatus, startupStatusKind);
refreshSheetLinks();
populatePicker();
