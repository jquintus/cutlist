import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject } from '../src/model.js';
import {
  beginRowEditing,
  cancelRowEditing,
  finishRowEditing,
} from '../src/ui/rowEditing.js';

function fixture() {
  return normalizeProject({
    materials: [
      { id: 'ply-a', name: 'Ply A', thicknessIn: 0.75, note: 'old', sheets: [{ id: 'sheet', widthIn: 48, lengthIn: 96, qty: 1 }] },
      { id: 'ply-b', name: 'Ply B', sheets: [] },
      { id: 'oak-a', kind: 'board', name: 'Oak A', widthIn: 3.5, boards: [{ id: 'board', lengthIn: 96, qty: 1 }] },
      { id: 'oak-b', kind: 'board', name: 'Oak B', widthIn: 3.5, boards: [] },
    ],
    parts: [{ id: 'part', name: 'Panel', qty: 1, widthIn: 12, lengthIn: 20, materialId: 'ply-a' }],
    supplies: [{ id: 'supply', name: 'Glue', qty: 1, packQty: 1 }],
  });
}

test('cancel restores only the edited material, part, or supply row', () => {
  for (const [id, mutate, read] of [
    ['ply-a', (project) => { project.materials[0].name = 'Changed'; }, (project) => project.materials[0].name],
    ['part', (project) => { project.parts[0].name = 'Changed'; }, (project) => project.parts[0].name],
    ['supply', (project) => { project.supplies[0].name = 'Changed'; }, (project) => project.supplies[0].name],
  ]) {
    const project = fixture();
    const state = new Map();
    beginRowEditing(state, id, project);
    mutate(project);
    project.materials[0].sheets[0].qty = 7;
    cancelRowEditing(state, project, id);
    assert.notEqual(read(project), 'Changed');
    assert.equal(project.materials[0].sheets[0].qty, 7, `${id} cancel reverted another row`);
    assert.equal(state.get(id).editing, false);
  }
});

test('cancel returns sheet and board stock to their original owner and position', () => {
  for (const [id, collection, from, to] of [
    ['sheet', 'sheets', 0, 1],
    ['board', 'boards', 2, 3],
  ]) {
    const project = fixture();
    const state = new Map();
    beginRowEditing(state, id, project);
    const [moved] = project.materials[from][collection].splice(0, 1);
    moved.qty = 9;
    project.materials[to][collection].push(moved);
    cancelRowEditing(state, project, id);
    assert.deepEqual(project.materials[from][collection].map((entry) => entry.id), [id]);
    assert.equal(project.materials[from][collection][0].qty, 1);
    assert.equal(project.materials[to][collection].length, 0);
  }
});

test('cancel restores the pre-edit size mode while Done commits the new one', () => {
  const project = fixture();
  const state = new Map([['sheet', { sizeMode: 'custom' }]]);
  beginRowEditing(state, 'sheet', project);
  state.set('sheet', { ...state.get('sheet'), sizeMode: 'preset' });
  cancelRowEditing(state, project, 'sheet');
  assert.deepEqual(state.get('sheet'), { sizeMode: 'custom', editing: false });

  beginRowEditing(state, 'sheet', project);
  state.set('sheet', { ...state.get('sheet'), sizeMode: 'preset' });
  finishRowEditing(state, 'sheet');
  assert.equal(state.get('sheet').sizeMode, 'preset');
  assert.equal(state.get('sheet').editSnapshot, undefined);
});

test('canceling a newly added row restores its defaults without removing it', () => {
  const project = fixture();
  project.parts.push({ id: 'new-part', name: '', qty: 1, widthIn: 12, lengthIn: 12, materialId: 'ply-a', grainLocked: false });
  const state = new Map();
  beginRowEditing(state, 'new-part', project);
  project.parts.at(-1).name = 'Half typed';
  cancelRowEditing(state, project, 'new-part');
  assert.equal(project.parts.at(-1).id, 'new-part');
  assert.equal(project.parts.at(-1).name, '');
});
