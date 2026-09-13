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
import { createProjectStorage, slugFor } from '../io/projectStorage.js';
import { encodeProject, decodeHash } from '../share/codec.js';
import { directUpload } from '../share/upload.js';
import { THICKNESS_PRESETS, SHEET_PRESETS, thicknessLabelFor } from '../units.js';
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
const projects = createProjectStorage();

// The save this project is currently attached to, or null when it has never
// been saved. Save falls through to Save As while this is null.
let currentSlug = null;

const el = {
  projectName: document.getElementById('project-name'),
  picker: document.getElementById('project-picker'),
  pickerStatus: document.getElementById('picker-status'),
  localPicker: document.getElementById('local-picker'),
  dialogStatus: document.getElementById('dialog-status'),
  openDialog: document.getElementById('dialog-open'),
  saveAsDialog: document.getElementById('dialog-save-as'),
  saveAsName: document.getElementById('save-as-name'),
  uploadLink: document.getElementById('link-upload'),
  forms: document.getElementById('forms'),
  results: document.getElementById('results'),
  status: document.getElementById('status'),
  importFile: document.getElementById('import-file'),
};

function setStatus(message, tone = 'muted') {
  el.status.className = tone === 'error' ? 'banner-warn' : 'muted';
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

  el.forms.innerHTML = renderForms(project, uiState);
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
  render();
}

// ---------------------------------------------------------------------------
// View-only state: how the results are shown, never what they are.
//
// Kept out of the project on purpose. Turning the picture sideways to match
// how a sheet is lying on the horses changes nothing about the cuts, so it
// must not touch the plan, the share link or the print output.

const view = { rotated: {} };

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
  activeStep = null;
}

function setActiveStep(sheet, seq) {
  if (activeStep !== null && activeStep.sheet === sheet && activeStep.seq === seq) return;
  clearActiveStep();
  // Both the list item and the drawn line carry the same pair, so one query
  // lights the step up on both sides and on no other sheet.
  const selector = `[data-sheet="${CSS.escape(sheet)}"][data-step="${CSS.escape(seq)}"]`;
  for (const node of el.results.querySelectorAll(selector)) node.classList.add('is-active');
  activeStep = { sheet, seq };
}

el.results.addEventListener('mouseover', (event) => {
  const target = stepElementFrom(event.target);
  if (target) setActiveStep(target.dataset.sheet, target.dataset.step);
});

el.results.addEventListener('mouseout', (event) => {
  const target = stepElementFrom(event.target);
  if (target === null) return;
  // Moving between the number and its own line is not leaving the step.
  const next = stepElementFrom(event.relatedTarget);
  if (next !== null && next.dataset.sheet === target.dataset.sheet
    && next.dataset.step === target.dataset.step) return;
  clearActiveStep();
});

el.results.addEventListener('click', (event) => {
  const rotate = event.target.closest?.('[data-action="rotate-view"]');
  if (rotate) {
    const key = rotate.dataset.sheet;
    view.rotated[key] = !view.rotated[key];
    renderResultsOnly();
    return;
  }
  const target = stepElementFrom(event.target);
  if (target) setActiveStep(target.dataset.sheet, target.dataset.step);
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

const NUMERIC_FIELDS = /(\.|^)(kerfIn|edgeTrimIn|widthIn|lengthIn|qty|thicknessIn)$/;
const SHEET_DIMENSION = /^materials\.(\d+)\.sheets\.(\d+)\.(widthIn|lengthIn)$/;

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

function applyFieldChange(fieldPath, input) {
  update((draft) => {
    if (fieldPath.endsWith('.grainLocked')) {
      setPath(draft, fieldPath, input.checked === true);
      return;
    }
    if (fieldPath.endsWith('.thicknessPreset')) {
      const base = fieldPath.replace(/\.thicknessPreset$/, '');
      const preset = THICKNESS_PRESETS.find((candidate) => candidate.id === input.value);
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
    if (NUMERIC_FIELDS.test(fieldPath)) {
      // Half-typed text keeps the number entered so far rather than snapping to
      // zero, so a decimal inch survives the keystroke that starts it.
      setPath(draft, fieldPath, readNumericEntry(input.value, getPath(draft, fieldPath)));
      return;
    }
    setPath(draft, fieldPath, input.value);
  });
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

const ACTIONS = {
  // Ids are minted explicitly, the way add-part already does it. normalizeProject
  // derives a missing sheet id positionally, so ids would renumber after a
  // removal and a control mode keyed by sheet id would migrate onto a different
  // sheet.
  'add-material': (draft) => {
    const materialId = mintId('m', draft.materials.length + 1);
    draft.materials.push({
      id: materialId,
      // No invented name: an empty field reads as "fill this in", where
      // "Material 2" reads as a decision someone already made.
      name: '',
      thicknessIn: 0.75,
      thicknessLabel: '3/4 in',
      note: '',
      sheets: [{ id: `${materialId}s1`, label: '48 x 96', widthIn: 48, lengthIn: 96, qty: 1, note: '' }],
    });
  },
  'remove-material': (draft, dataset) => {
    draft.materials.splice(Number(dataset.material), 1);
  },
  'add-sheet': (draft, dataset) => {
    const material = draft.materials[Number(dataset.material)];
    material.sheets.push({
      id: mintId(`${material.id}s`, material.sheets.length + 1),
      label: '48 x 96',
      widthIn: 48,
      lengthIn: 96,
      qty: 1,
      note: '',
    });
  },
  // Swapping a sheet spec's two dimensions is a real project edit: it goes
  // through update() like any other, so the packer reruns and the plan changes.
  // The view-only rotate below is a different control entirely and touches
  // nothing here.
  'rotate-sheet': (draft, dataset) => {
    const sheet = draft.materials[Number(dataset.material)].sheets[Number(dataset.sheet)];
    resizeSheet(sheet, () => {
      [sheet.widthIn, sheet.lengthIn] = [sheet.lengthIn, sheet.widthIn];
    });
    syncSheetSizeMode(sheet);
  },
  'remove-sheet': (draft, dataset) => {
    draft.materials[Number(dataset.material)].sheets.splice(Number(dataset.sheet), 1);
  },
  'add-part': (draft) => {
    draft.parts.push({
      id: mintId('p', draft.parts.length + 1),
      name: '',
      qty: 1,
      widthIn: 12,
      lengthIn: 12,
      materialId: draft.materials[0]?.id ?? '',
      grainLocked: false,
    });
  },
  'remove-part': (draft, dataset) => {
    draft.parts.splice(Number(dataset.part), 1);
  },
};

// ---------------------------------------------------------------------------
// Sharing, import, export

function writeHash(project) {
  try {
    const hash = `#${encodeProject(project)}`;
    // replaceState, not pushState: the back button should leave the page, not
    // walk backward through every keystroke.
    history.replaceState(null, '', hash);
  } catch {
    setStatus('This project is too large to put in a share link. Export it as a file instead.', 'error');
  }
}

// See HASH_WRITE_DEBOUNCE_MS above for why this runs debounced rather than
// straight out of render(). Call `.flush()` (as copyShareLink does) anywhere
// the address bar's hash needs to be caught up with the in-memory project
// right now, rather than after the debounce window.
const debouncedWriteHash = debounce(writeHash, HASH_WRITE_DEBOUNCE_MS);

function saveTextFile(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
  if (result.kind === 'url') {
    el.uploadLink.href = result.url;
    el.uploadLink.removeAttribute('download');
    return;
  }
  el.uploadLink.href = `data:application/json;charset=utf-8,${encodeURIComponent(result.json)}`;
  el.uploadLink.setAttribute('download', result.filename);
}

// ---------------------------------------------------------------------------
// Projects: New, Open, Save, Save As

function loadProject(project, slug) {
  // Both are this browser's own leftover display state, not this project's.
  // Left in place, a control mode or a rotated diagram from the project just
  // closed could carry into the one just opened -- including a sheet-size
  // dropdown that goes on naming a size the new project's own width and
  // length no longer match.
  uiState.clear();
  view.rotated = {};
  store.load(project);
  currentSlug = slug;
  if (slug !== null) projects.setLastOpened(slug);
  render();
}

function saveTo(slug, button) {
  const result = projects.write(slug, store.current);
  if (!result.ok) {
    // The project is untouched and still on screen, so it is still fixable --
    // but only by someone who has been told what is wrong with it.
    setStatus(result.message, 'error');
    flashLabel(button, 'Not saved');
    return;
  }
  currentSlug = slug;
  projects.setLastOpened(slug);
  flashLabel(button, 'Saved');
}

function openSaveAsDialog() {
  el.saveAsName.value = store.current.name;
  // A <dialog> that closes without an explicit result (Escape included) keeps
  // whatever returnValue its last close left behind rather than clearing it.
  // Left alone, checking the name here and backing out with Escape would reuse
  // the 'save' from a previous, real save and quietly save again -- canceling
  // must never do that.
  el.saveAsDialog.returnValue = '';
  el.saveAsDialog.showModal();
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

function populateLocalPicker() {
  const saves = projects.list();
  const last = projects.lastOpened();
  const options = saves.length === 0
    ? ['<option value="">Nothing saved in this browser yet</option>']
    : ['<option value="">Pick a saved project</option>', ...saves.map((entry) => {
      // Named rather than preselected: preselecting an option means picking it
      // again fires no change event and the click appears to do nothing.
      const suffix = entry.slug === last ? ' (last opened)' : '';
      return `<option value="${escapeHtml(entry.slug)}">${escapeHtml(entry.name)}${suffix}</option>`;
    })];
  el.localPicker.innerHTML = options.join('');
}

async function openIndexedProject(file) {
  if (file === '') return;
  const result = await loadProjectFile(file);
  if (!result.ok) {
    el.dialogStatus.textContent = result.message;
    return;
  }
  // An in-repo project is not attached to a local save: saving it should ask
  // where to put it rather than silently overwriting something.
  loadProject(result.project, null);
  el.openDialog.close();
  // A <select> that fires only on an actual value change never notices a
  // repeated pick of the option already showing, so choosing the same
  // built-in project a second time -- to discard edits and reload it fresh --
  // did nothing. Clearing the value here makes the next pick of it, however
  // soon, a real change again.
  el.picker.value = '';
}

function openLocalProject(slug) {
  if (slug === '') return;
  const result = projects.read(slug);
  if (!result.ok) {
    el.dialogStatus.textContent = result.message;
    return;
  }
  loadProject(result.project, slug);
  el.openDialog.close();
}

// ---------------------------------------------------------------------------
// Wiring

// A text field fires 'input' as you type; a select or checkbox fires only
// 'change'. Listening for both with the same handler covers every field type.
function onFieldEvent(event) {
  const fieldPath = event.target.dataset?.field;
  if (fieldPath) applyFieldChange(fieldPath, event.target);
}

el.forms.addEventListener('input', onFieldEvent);
el.forms.addEventListener('change', onFieldEvent);

el.forms.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = ACTIONS[button.dataset.action];
  if (action) update((draft) => action(draft, button.dataset));
});

const shareButton = document.getElementById('btn-share');
shareButton.addEventListener('click', () => copyShareLink(shareButton));

document.getElementById('btn-new').addEventListener('click', () => loadProject(newProject(), null));

document.getElementById('btn-open').addEventListener('click', () => {
  el.dialogStatus.textContent = '';
  populateLocalPicker();
  el.openDialog.showModal();
});

const saveButton = document.getElementById('btn-save');
saveButton.addEventListener('click', () => {
  if (currentSlug === null) {
    openSaveAsDialog();
    return;
  }
  saveTo(currentSlug, saveButton);
});

document.getElementById('btn-save-as').addEventListener('click', openSaveAsDialog);

el.saveAsDialog.addEventListener('close', () => {
  if (el.saveAsDialog.returnValue !== 'save') return;
  const name = el.saveAsName.value.trim();
  const slug = slugFor(name);
  // A slug collapses case, spacing and punctuation, so two names that read as
  // different to a person can land on the same saved entry. Saving over one
  // that is not the project already open here would discard it with no
  // warning, so ask before that happens rather than after.
  if (slug !== currentSlug) {
    const collision = projects.read(slug);
    if (collision.ok) {
      const proceed = confirm(`A project named "${collision.project.name || slug}" is already saved in this browser. Save over it?`);
      if (!proceed) return;
    }
  }
  update((draft) => { draft.name = name; });
  saveTo(slug, saveButton);
});

document.getElementById('btn-export').addEventListener('click', () => {
  // A file this build would refuse to import is not a backup of anything, so
  // it is better not written: Export answers to the same chain Import does.
  const checked = checkReadsBack(store.current);
  if (!checked.ok) {
    setStatus(`Not exported. ${checked.message}`, 'error');
    return;
  }
  const json = exportProjectJson(store.current);
  saveTextFile(`${store.current.name || 'project'}.json`, json, 'application/json');
});
document.getElementById('btn-import').addEventListener('click', () => el.importFile.click());

// A reload right after typing should not land on a hash from before the last
// few keystrokes just because the debounce window had not closed yet.
window.addEventListener('pagehide', () => debouncedWriteHash.flush());

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
    loadProject(result.project, null);
  }
  event.target.value = '';
});

el.picker.addEventListener('change', (event) => openIndexedProject(event.target.value));
el.localPicker.addEventListener('change', (event) => openLocalProject(event.target.value));

// ---------------------------------------------------------------------------
// Start up. A share link in the fragment wins over anything the picker offers,
// because that link is what someone opened on purpose.

const restored = decodeHash(location.hash);
if (restored.ok) {
  store.load(restored.project);
} else if (location.hash.startsWith('#pako:')) {
  setStatus(restored.error, 'error');
}
render();
populatePicker();
