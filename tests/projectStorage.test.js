// Saving in the browser, against a plain object standing in for localStorage.
//
// The two things that matter: what comes back out is revalidated before anyone
// can act on it, and a browser that refuses to store anything leaves the app
// working rather than broken.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectStorage, slugFor } from '../src/io/projectStorage.js';
import { newProject, normalizeProject } from '../src/model.js';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    raw: data,
  };
}

function throwingStorage() {
  return {
    getItem() { throw new DOMException('denied'); },
    setItem() { throw new DOMException('denied'); },
    removeItem() { throw new DOMException('denied'); },
  };
}

function sampleProject(name = 'Shelf job') {
  return normalizeProject({
    ...newProject(),
    name,
    materials: [{ id: 'm1', name: 'Ply', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [{ id: 'p1', name: 'Side', qty: 2, widthIn: 12, lengthIn: 30, materialId: 'm1' }],
  });
}

test('a project written comes back out unchanged', () => {
  const store = createProjectStorage(fakeStorage());
  const project = sampleProject();
  const written = store.write('shelf-job', project);
  assert.equal(written.ok, true);

  const read = store.read('shelf-job');
  assert.equal(read.ok, true);
  assert.deepEqual(read.project, written.project);
  assert.deepEqual(read.project.parts, project.parts);
});

test('a save is stamped the way an export is', () => {
  const store = createProjectStorage(fakeStorage());
  const written = store.write('shelf-job', sampleProject());
  assert.equal(written.project.schemaVersion, 1);
  assert.match(written.project.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('list names every save and remove takes one away', () => {
  const store = createProjectStorage(fakeStorage());
  store.write('shelf-job', sampleProject('Shelf job'));
  store.write('sled', sampleProject('Sled'));
  assert.deepEqual(store.list().map((entry) => entry.slug), ['shelf-job', 'sled']);
  assert.deepEqual(store.list().map((entry) => entry.name), ['Shelf job', 'Sled']);

  store.remove('sled');
  assert.deepEqual(store.list().map((entry) => entry.slug), ['shelf-job']);
  assert.equal(store.read('sled').ok, false);
});

test('a corrupt entry is dropped from the list rather than surfaced', () => {
  const storage = fakeStorage();
  const store = createProjectStorage(storage);
  store.write('good', sampleProject('Good'));

  const entries = JSON.parse(storage.getItem('cutlist.projects.v1'));
  entries.bad = { schemaVersion: 99, materials: 'not an array' };
  storage.setItem('cutlist.projects.v1', JSON.stringify(entries));

  assert.deepEqual(store.list().map((entry) => entry.slug), ['good']);
  assert.equal(store.read('bad').ok, false);
});

test('unparseable storage reads as empty rather than throwing', () => {
  const storage = fakeStorage({ 'cutlist.projects.v1': 'not json at all' });
  const store = createProjectStorage(storage);
  assert.deepEqual(store.list(), []);
  assert.equal(store.read('anything').ok, false);
});

test('a browser that refuses storage leaves everything usable', () => {
  const store = createProjectStorage(throwingStorage());
  assert.deepEqual(store.list(), []);
  assert.equal(store.read('x').ok, false);
  assert.equal(store.write('x', sampleProject()).ok, false);
  assert.deepEqual(store.remove('x'), { ok: true });
  assert.equal(store.lastOpened(), null);
  assert.doesNotThrow(() => store.setLastOpened('x'));
});

test('the last opened project is remembered and read back', () => {
  const store = createProjectStorage(fakeStorage());
  assert.equal(store.lastOpened(), null);
  store.setLastOpened('shelf-job');
  assert.equal(store.lastOpened(), 'shelf-job');
});

test('a project name becomes the same slug an export would use', () => {
  assert.equal(slugFor('Shelf job'), 'shelf-job');
  assert.equal(slugFor(''), 'project');
});

test('a browser where reading localStorage itself throws still gives a working store', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('storage is disabled'); },
  });
  try {
    // Constructing must not throw: this module loads at app start, and a throw
    // here would take the whole page down rather than one feature.
    const store = createProjectStorage();
    assert.deepEqual(store.list(), []);
    assert.equal(store.write('x', sampleProject()).ok, false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

// Save and Open have to agree. Open drops a stored entry that no longer
// validates, so a save that wrote one reported success and then lost the work
// with nothing on screen to say so.
test('Save refuses a project Open would drop, and says why', () => {
  const storage = fakeStorage();
  const store = createProjectStorage(storage);
  const orphaned = { ...sampleProject('Shelf job'), materials: [] };

  const written = store.write('shelf-job', orphaned);
  assert.equal(written.ok, false);
  assert.match(written.message, /^Not saved\./);
  assert.match(written.message, /does not declare/);
  assert.deepEqual(store.list(), []);
  assert.equal(storage.raw.size, 0, 'a refused save must write nothing at all');
});

test('Save refuses a part added before any material group exists', () => {
  const store = createProjectStorage(fakeStorage());
  const started = normalizeProject({
    ...newProject(),
    name: 'Just started',
    parts: [{ id: 'p1', name: '', qty: 1, widthIn: 12, lengthIn: 12, materialId: '' }],
  });

  const written = store.write('just-started', started);
  assert.equal(written.ok, false);
  assert.match(written.message, /not in any material group/);
});

test('a refused save leaves an earlier good save of the same name alone', () => {
  const store = createProjectStorage(fakeStorage());
  store.write('shelf-job', sampleProject('Shelf job'));
  store.write('shelf-job', { ...sampleProject('Shelf job'), materials: [] });

  const read = store.read('shelf-job');
  assert.equal(read.ok, true);
  assert.equal(read.project.materials.length, 1);
});
