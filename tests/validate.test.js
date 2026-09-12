import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, VALIDATORS } from '../src/io/validate.js';
import { createProjectStore, readProjectJson, exportProjectJson } from '../src/io/importExport.js';
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
