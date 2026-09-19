import test from 'node:test';
import assert from 'node:assert/strict';

import { newProject } from '../src/model.js';
import { loadRecovery, RECOVERY_KEY, saveRecovery } from '../src/share/recovery.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('a project survives a recovery round trip', () => {
  const storage = memoryStorage();
  const project = { ...newProject(), name: 'Workbench' };
  assert.equal(saveRecovery(storage, project), true);
  assert.deepEqual(loadRecovery(storage), { ok: true, project });
});

test('a damaged recovery copy is refused', () => {
  const storage = memoryStorage();
  storage.setItem(RECOVERY_KEY, '{not json');
  assert.equal(loadRecovery(storage).ok, false);
});

test('an unfinished supply row survives recovery', () => {
  const storage = memoryStorage();
  const project = { ...newProject(), supplies: [{ id: 's1', name: '', qty: 1, packQty: 1 }] };
  saveRecovery(storage, project);
  const recovered = loadRecovery(storage);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.project.supplies[0].name, '');
});

test('a schema 1 recovery copy migrates instead of disappearing on upgrade', () => {
  const storage = memoryStorage();
  storage.setItem(RECOVERY_KEY, JSON.stringify({
    schemaVersion: 1,
    materials: [{ id: 'ply', name: 'Plywood', sheets: [] }],
    parts: [],
  }));
  const recovered = loadRecovery(storage);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.project.schemaVersion, 3);
  assert.equal(recovered.project.materials[0].kind, 'sheet');
});

test('unavailable storage never takes down the app', () => {
  const storage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('full'); },
  };
  assert.equal(saveRecovery(storage, newProject()), false);
  assert.equal(loadRecovery(storage).ok, false);
});
