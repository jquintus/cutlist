import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCHEMA_VERSION,
  newProject,
  normalizeProject,
  expandParts,
  letterFor,
} from '../src/model.js';

test('newProject carries the schema version and the documented defaults', () => {
  const project = newProject();
  assert.equal(project.schemaVersion, SCHEMA_VERSION);
  assert.equal(project.params.kerfIn, 0.125);
  assert.equal(project.params.edgeTrimIn, 0);
  assert.deepEqual(project.unplanned, []);
});

test('normalizeProject fills the defaults on an empty object', () => {
  const project = normalizeProject({});
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.params.kerfIn, 0.125);
  assert.equal(project.params.edgeTrimIn, 0);
  assert.deepEqual(project.unplanned, []);
  assert.deepEqual(project.materials, []);
  assert.deepEqual(project.parts, []);
});

test('normalizeProject does not mutate its argument', () => {
  const input = { materials: [{ name: 'Ply' }], parts: [{ name: 'Base', widthIn: '12' }] };
  const before = JSON.stringify(input);
  normalizeProject(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(input.materials[0].id, undefined);
});

test('normalizeProject coerces numeric strings from form fields', () => {
  const project = normalizeProject({
    params: { kerfIn: '0.09', edgeTrimIn: '0.25' },
    materials: [{ name: 'Ply', thicknessIn: '0.5', sheets: [{ widthIn: '48', lengthIn: '96', qty: '2' }] }],
    parts: [{ name: 'Base', widthIn: '18.5', lengthIn: '24', qty: '3', materialId: 'm1' }],
  });
  assert.equal(project.params.kerfIn, 0.09);
  assert.equal(project.params.edgeTrimIn, 0.25);
  assert.equal(project.materials[0].thicknessIn, 0.5);
  assert.equal(project.materials[0].sheets[0].qty, 2);
  assert.equal(project.parts[0].widthIn, 18.5);
  assert.equal(project.parts[0].qty, 3);
});

test('normalizeProject assigns deterministic ids where they are missing', () => {
  const input = { materials: [{ name: 'A' }, { name: 'B' }], parts: [{ name: 'P' }] };
  const first = normalizeProject(input);
  const second = normalizeProject(input);
  assert.equal(first.materials[0].id, 'm1');
  assert.equal(first.materials[1].id, 'm2');
  assert.equal(first.materials[0].sheets.length, 0);
  assert.equal(first.parts[0].id, 'p1');
  assert.deepEqual(first, second);
});

test('a sheet entry with qty zero survives normalization as the buy spec', () => {
  const project = normalizeProject({
    materials: [{ name: '3/4 in', sheets: [{ widthIn: 48, lengthIn: 96, qty: 0 }] }],
  });
  assert.equal(project.materials[0].sheets[0].qty, 0);
});

test('grainLocked defaults to false and only true turns it on', () => {
  const project = normalizeProject({ parts: [{ name: 'a' }, { name: 'b', grainLocked: 'yes' }, { name: 'c', grainLocked: true }] });
  assert.equal(project.parts[0].grainLocked, false);
  assert.equal(project.parts[1].grainLocked, false);
  assert.equal(project.parts[2].grainLocked, true);
});

test('letterFor rolls past Z instead of repeating', () => {
  assert.equal(letterFor(0), 'A');
  assert.equal(letterFor(25), 'Z');
  assert.equal(letterFor(26), 'AA');
  assert.equal(letterFor(27), 'AB');
});

test('expandParts turns quantity into labeled instances per material group', () => {
  const project = normalizeProject({
    materials: [{ id: 'm1', name: 'Half' }, { id: 'm2', name: 'Quarter' }],
    parts: [
      { id: 'p1', name: 'Base', qty: 2, widthIn: 10, lengthIn: 20, materialId: 'm1' },
      { id: 'p2', name: 'Rail', qty: 3, widthIn: 2, lengthIn: 20, materialId: 'm1' },
      { id: 'p3', name: 'Riser', qty: 1, widthIn: 5, lengthIn: 5, materialId: 'm2' },
    ],
  });
  const half = expandParts(project.materials[0], project.parts);
  assert.deepEqual(half.map((instance) => instance.label), ['A1', 'A2', 'B1', 'B2', 'B3']);

  const quarter = expandParts(project.materials[1], project.parts);
  assert.deepEqual(quarter.map((instance) => instance.label), ['A1']);
});

test('expandParts drops nothing and carries grain lock onto each instance', () => {
  const material = { id: 'm1' };
  const parts = [{ id: 'p1', name: 'Fence', qty: 2, widthIn: 3, lengthIn: 30, materialId: 'm1', grainLocked: true }];
  const instances = expandParts(material, parts);
  assert.equal(instances.length, 2);
  assert.ok(instances.every((instance) => instance.grainLocked === true));
});
