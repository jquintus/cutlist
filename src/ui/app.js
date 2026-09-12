// Container: all state and all event wiring live here.
//
// One loop, always in the same order: change the project, normalize it,
// validate it for a status line, plan it, then redraw every panel from that
// one plan. Nothing patches the DOM from inside a handler, which is what
// keeps the diagram and the printed cut list from drifting apart.

import { newProject, normalizeProject } from '../model.js';
import { planProject } from '../plan.js';
import { validatePlan } from '../packer/invariants.js';
import { validateProject } from '../io/validate.js';
import { createProjectStore, exportProjectJson, readProjectJson } from '../io/importExport.js';
import { loadProjectIndex, loadProjectFile } from '../io/projects.js';
import { encodeProject, decodeHash } from '../share/codec.js';
import { directUpload } from '../share/upload.js';
import { THICKNESS_PRESETS, SHEET_PRESETS } from '../units.js';
import { renderForms, renderResults } from './renderForms.js';
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

const store = createProjectStore(starterProject());

const el = {
  picker: document.getElementById('project-picker'),
  pickerStatus: document.getElementById('picker-status'),
  forms: document.getElementById('forms'),
  results: document.getElementById('results'),
  status: document.getElementById('status'),
  importFile: document.getElementById('import-file'),
};

function starterProject() {
  const project = newProject();
  project.name = 'New project';
  project.materials = [{
    id: 'm1',
    name: '3/4 in plywood',
    thicknessIn: 0.75,
    thicknessLabel: '3/4 in',
    note: '',
    color: '#2f6f9f',
    sheets: [{ id: 'm1s1', label: '48 x 96', widthIn: 48, lengthIn: 96, qty: 1, note: '' }],
  }];
  return normalizeProject(project);
}

function setStatus(message, tone = 'muted') {
  el.status.className = tone === 'error' ? 'banner-warn' : 'muted';
  el.status.textContent = message;
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

  el.forms.innerHTML = renderForms(project);
  el.results.innerHTML = renderResults(plan);

  for (const panel of document.querySelectorAll('details.panel')) {
    if (openPanels.includes(panel.dataset.panel)) panel.open = true;
  }
  restoreFocus(memory);

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

function applyFieldChange(fieldPath, input) {
  update((draft) => {
    if (fieldPath.endsWith('.grainLocked')) {
      setPath(draft, fieldPath, input.checked === true);
      return;
    }
    if (fieldPath.endsWith('.thicknessPreset')) {
      const preset = THICKNESS_PRESETS.find((candidate) => candidate.id === input.value);
      if (preset === undefined) return; // "Custom" leaves the typed inches alone.
      const base = fieldPath.replace(/\.thicknessPreset$/, '');
      setPath(draft, `${base}.thicknessIn`, preset.inches);
      setPath(draft, `${base}.thicknessLabel`, preset.label);
      return;
    }
    if (fieldPath.endsWith('.preset')) {
      const preset = SHEET_PRESETS.find((candidate) => candidate.id === input.value);
      if (preset === undefined) return; // "Custom" leaves the typed size alone.
      const base = fieldPath.replace(/\.preset$/, '');
      setPath(draft, `${base}.widthIn`, preset.widthIn);
      setPath(draft, `${base}.lengthIn`, preset.lengthIn);
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

const ACTIONS = {
  'add-material': (draft) => {
    const index = draft.materials.length + 1;
    draft.materials.push({
      id: `m${Date.now()}${index}`,
      name: `Material ${index}`,
      thicknessIn: 0.75,
      thicknessLabel: '3/4 in',
      note: '',
      sheets: [{ label: '48 x 96', widthIn: 48, lengthIn: 96, qty: 1, note: '' }],
    });
  },
  'remove-material': (draft, dataset) => {
    draft.materials.splice(Number(dataset.material), 1);
  },
  'add-sheet': (draft, dataset) => {
    draft.materials[Number(dataset.material)].sheets.push({
      label: '48 x 96', widthIn: 48, lengthIn: 96, qty: 1, note: '',
    });
  },
  'remove-sheet': (draft, dataset) => {
    draft.materials[Number(dataset.material)].sheets.splice(Number(dataset.sheet), 1);
  },
  'add-part': (draft) => {
    draft.parts.push({
      id: `p${Date.now()}${draft.parts.length + 1}`,
      name: `Part ${draft.parts.length + 1}`,
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

async function copyShareLink() {
  // The address bar may still be waiting out the debounce window from the
  // last keystroke; flush it so what gets copied is the project on screen,
  // not whatever was last written.
  debouncedWriteHash.flush();
  try {
    await navigator.clipboard.writeText(location.href);
    setStatus('Share link copied.');
  } catch {
    setStatus('Could not copy automatically. The link is in the address bar.');
  }
}

function doDirectUpload() {
  const result = directUpload(store.current);
  if (result.kind === 'url') {
    window.open(result.url, '_blank', 'noopener');
    setStatus('Opened GitHub with the file filled in. Commit it there.');
    return;
  }
  saveTextFile(result.filename, result.json, 'application/json');
  setStatus('This project is too big for a prefilled link, so it was downloaded instead. Add it to the projects folder by hand.');
}

async function openIndexedProject(file) {
  if (file === '') return;
  const result = await loadProjectFile(file);
  if (!result.ok) {
    setStatus(result.message, 'error');
    return;
  }
  store.load(result.project);
  render();
}

async function populatePicker() {
  const result = await loadProjectIndex();
  const options = ['<option value="">Pick a saved project</option>'];
  for (const entry of result.projects) {
    options.push(`<option value="${escapeHtml(entry.file)}">${escapeHtml(entry.name || entry.file)}</option>`);
  }
  el.picker.innerHTML = options.join('');
  el.pickerStatus.textContent = result.ok ? '' : result.message;
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

document.getElementById('btn-share').addEventListener('click', copyShareLink);
document.getElementById('btn-print').addEventListener('click', () => window.print());
document.getElementById('btn-upload').addEventListener('click', doDirectUpload);
document.getElementById('btn-export').addEventListener('click', () => {
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
    store.load(result.project);
    render();
  }
  event.target.value = '';
});

el.picker.addEventListener('change', (event) => openIndexedProject(event.target.value));

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
