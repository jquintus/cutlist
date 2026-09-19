import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, VALIDATORS } from '../src/io/validate.js';
import { createProjectStore, readProjectJson, exportProjectJson, checkReadsBack } from '../src/io/importExport.js';
import { newProject, SCHEMA_VERSION } from '../src/model.js';

function goodProject() {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'Good',
    date: '2026-09-12',
    notes: 'fine',
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [{ id: 'm1', name: 'Half', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [{ id: 'p1', name: 'Base', qty: 1, widthIn: 10, lengthIn: 20, materialId: 'm1' }],
    unplanned: [{ name: 'Miter Bar', qty: 2, note: 'hardwood' }],
  };
}

test('a well formed project passes the chain and comes back normalized', () => {
  const result = validateProject(goodProject());
  assert.equal(result.ok, true);
  assert.equal(result.project.params.kerfIn, 0.125);
  assert.equal(result.project.unplanned.length, 1);
});

test('hasObjectShape rejects a non object', () => {
  for (const bad of [null, 42, 'nope', ['a']]) {
    const result = validateProject(bad);
    assert.equal(result.ok, false);
    assert.equal(result.field, 'project');
  }
});

test('schemaVersionSupported names a newer version distinctly', () => {
  const newer = validateProject({ ...goodProject(), schemaVersion: SCHEMA_VERSION + 1 });
  assert.equal(newer.ok, false);
  assert.equal(newer.field, 'schemaVersion');
  assert.match(newer.message, /newer version of cutlist/);

  const older = validateProject({ ...goodProject(), schemaVersion: 0 });
  assert.equal(older.ok, false);
  assert.ok(!/newer version of cutlist/.test(older.message));

  const missing = validateProject({ ...goodProject(), schemaVersion: undefined });
  assert.equal(missing.ok, false);
  assert.match(missing.message, /no schema version/);
});

test('the library marker must be boolean and survives normalization', () => {
  const bad = validateProject({ ...goodProject(), library: 'yes' });
  assert.equal(bad.ok, false);
  assert.equal(bad.field, 'library');

  const library = validateProject({ ...goodProject(), library: true });
  assert.equal(library.ok, true);
  assert.equal(library.project.library, true);
});

test('schema 1 projects migrate to the current sheet-material shape', () => {
  const result = validateProject({ ...goodProject(), schemaVersion: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.project.schemaVersion, 3);
  assert.equal(result.project.materials[0].kind, 'sheet');
  assert.deepEqual(result.project.materials[0].boards, []);
});

test('materialsWellFormed rejects a sheet with no real size', () => {
  const result = validateProject({
    ...goodProject(),
    materials: [{ id: 'm1', name: 'Half', sheets: [{ widthIn: 0, lengthIn: 96, qty: 1 }] }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.field, 'materials');
  assert.match(result.message, /width or length/);
});

test('materialsWellFormed accepts a qty zero sheet, which is how a group says what to buy', () => {
  const result = validateProject({
    ...goodProject(),
    materials: [{ id: 'm1', name: 'Half', sheets: [{ widthIn: 48, lengthIn: 96, qty: 0 }] }],
  });
  assert.equal(result.ok, true);
});

test('stock quantities must be whole numbers instead of being silently truncated', () => {
  const project = goodProject();
  project.materials[0].sheets[0].qty = 0.5;
  const result = validateProject(project);
  assert.equal(result.ok, false);
  assert.match(result.message, /whole number/);
});

test('materialsWellFormed accepts board stock and a qty zero buy spec', () => {
  const result = validateProject({
    ...goodProject(),
    materials: [{
      id: 'm1',
      name: 'White oak',
      kind: 'board',
      thicknessIn: 1,
      thicknessLabel: '4/4',
      widthIn: 7,
      boards: [{ id: 'm1b1', label: '8 ft', lengthIn: 96, qty: 0, note: '' }],
    }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.project.materials[0].boards[0].qty, 0);
});

test('materialsWellFormed rejects an unknown material kind', () => {
  const result = validateProject({
    ...goodProject(),
    materials: [{ ...goodProject().materials[0], kind: 'tube' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.field, 'materials');
  assert.match(result.message, /unknown kind/);
});

test('materialsWellFormed rejects a board group without a positive width', () => {
  const result = validateProject({
    ...goodProject(),
    materials: [{ id: 'm1', name: 'Oak', kind: 'board', widthIn: 0, boards: [] }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.field, 'materials');
  assert.match(result.message, /width/);
});

test('materialsWellFormed rejects malformed board stock', () => {
  for (const boards of [
    'not a list',
    [null],
    [{ lengthIn: 0, qty: 1 }],
    [{ lengthIn: 96, qty: -1 }],
  ]) {
    const result = validateProject({
      ...goodProject(),
      materials: [{ id: 'm1', name: 'Oak', kind: 'board', widthIn: 4, boards }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.field, 'materials');
  }
});

test('a material cannot hide stock belonging to the other kind', () => {
  const boardWithSheet = goodProject();
  boardWithSheet.materials[0] = {
    ...boardWithSheet.materials[0],
    kind: 'board',
    widthIn: 3.5,
    boards: [],
  };
  assert.equal(validateProject(boardWithSheet).ok, false);

  const sheetWithBoard = goodProject();
  sheetWithBoard.materials[0].boards = [{ id: 'b1', lengthIn: 96, qty: 1 }];
  assert.equal(validateProject(sheetWithBoard).ok, false);
});

test('partsWellFormed rejects a part pointing at an undeclared material group', () => {
  const result = validateProject({
    ...goodProject(),
    parts: [{ id: 'p1', name: 'Orphan', qty: 1, widthIn: 10, lengthIn: 10, materialId: 'ghost' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.field, 'parts');
  assert.match(result.message, /does not declare/);
});

test('partsWellFormed rejects a non positive dimension', () => {
  const result = validateProject({
    ...goodProject(),
    parts: [{ id: 'p1', name: 'Flat', qty: 1, widthIn: -3, lengthIn: 10, materialId: 'm1' }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.field, 'parts');
});

test('unplannedWellFormed rejects a nameless out of scope item', () => {
  const result = validateProject({ ...goodProject(), unplanned: [{ qty: 1 }] });
  assert.equal(result.ok, false);
  assert.equal(result.field, 'unplanned');
});

test('paramsWellFormed rejects a negative kerf', () => {
  const result = validateProject({ ...goodProject(), params: { kerfIn: -0.1, edgeTrimIn: 0 } });
  assert.equal(result.ok, false);
  assert.equal(result.field, 'params');
  assert.match(result.message, /kerf/);
});

test('the chain reports the first failure, not the last', () => {
  // Broken at the schema version and again at the parts, several steps apart.
  const doublyBroken = {
    ...goodProject(),
    schemaVersion: 99,
    parts: [{ id: 'p1', name: 'Orphan', qty: 1, widthIn: 10, lengthIn: 10, materialId: 'ghost' }],
  };
  const result = validateProject(doublyBroken);
  assert.equal(result.ok, false);
  assert.equal(result.field, 'schemaVersion');

  const schemaIndex = VALIDATORS.findIndex((v) => v.name === 'schemaVersionSupported');
  const partsIndex = VALIDATORS.findIndex((v) => v.name === 'partsWellFormed');
  assert.ok(schemaIndex < partsIndex, 'the fixture must break an earlier check and a later one');
});

test('readProjectJson refuses text that is not JSON', () => {
  const result = readProjectJson('{ not json');
  assert.equal(result.ok, false);
  assert.match(result.message, /not valid JSON/);
});

test('a rejected import leaves the live project referentially unchanged', () => {
  const sentinel = newProject();
  sentinel.name = 'Do not touch';
  const store = createProjectStore(sentinel);

  const badJson = store.importJsonText('{ broken');
  assert.equal(badJson.ok, false);
  assert.ok(store.current === sentinel);

  const badProject = store.importJsonText(JSON.stringify({ ...goodProject(), schemaVersion: 99 }));
  assert.equal(badProject.ok, false);
  assert.ok(store.current === sentinel);

  const badHash = store.importShareHash('#pako:not-really-deflated');
  assert.equal(badHash.ok, false);
  assert.ok(store.current === sentinel);

  assert.equal(store.current.name, 'Do not touch');
});

test('a good import replaces the live project exactly once', () => {
  const sentinel = newProject();
  const store = createProjectStore(sentinel);
  const result = store.importJsonText(JSON.stringify(goodProject()));
  assert.equal(result.ok, true);
  assert.ok(store.current !== sentinel);
  assert.equal(store.current.name, 'Good');
});

test('export stamps a date when the project has none and keeps one it has', () => {
  const fixed = () => new Date('2026-09-12T17:31:00Z');
  const blank = JSON.parse(exportProjectJson({ ...goodProject(), date: '' }, { now: fixed }));
  assert.equal(blank.date, '2026-09-12');

  const kept = JSON.parse(exportProjectJson(goodProject(), { now: fixed }));
  assert.equal(kept.date, '2026-09-12');
});

test('a project survives a file round trip unchanged', () => {
  const original = validateProject(goodProject()).project;
  const text = exportProjectJson(original);
  const restored = readProjectJson(text);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.project, original);
});

// Export and Import, like Save and Open, have to agree about what a project is.
// A file this build would refuse to read back is not a copy of anybody's work.
test('checkReadsBack passes a project that would import again', () => {
  assert.deepEqual(checkReadsBack(validateProject(goodProject()).project), { ok: true });
});

test('checkReadsBack catches a part left behind by a deleted material group', () => {
  const orphaned = { ...goodProject(), materials: [] };
  const result = checkReadsBack(orphaned);
  assert.equal(result.ok, false);
  assert.equal(result.field, 'parts');
  assert.match(result.message, /does not declare/);
});

test('a part added before any material group is named as unassigned, not quoted as empty', () => {
  // The app lets someone add a part first and pick its group later, so this is
  // the message they get, and an empty pair of quotes tells them nothing.
  const result = checkReadsBack({
    ...goodProject(),
    materials: [],
    parts: [{ id: 'p1', name: '', qty: 1, widthIn: 12, lengthIn: 12, materialId: '' }],
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /^A part with no name yet is not in any material group\./);
});
