import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeProject } from '../src/model.js';
import { decodeHash, encodeProject } from '../src/share/codec.js';
import { compatibleMaterialIds, hasLibraryStock, libraryStockRows, mergeLibraryStock } from '../src/io/stockLibrary.js';

function project(materials = []) {
  return normalizeProject({ schemaVersion: 3, name: 'Project', materials, parts: [] });
}

const library = project([{
  id: 'ply', kind: 'sheet', name: 'Baltic birch', thicknessIn: 0.5, thicknessLabel: '1/2 in',
  sheets: [
    { id: 'offcut-a', widthIn: 18, lengthIn: 30, qty: 1, label: 'Left shelf' },
    { id: 'offcut-b', widthIn: 12, lengthIn: 20, qty: 2, label: '' },
    { id: 'buy', widthIn: 48, lengthIn: 96, qty: 0, label: '48 x 96' },
  ],
}, {
  id: 'oak', kind: 'board', name: 'White oak', thicknessIn: 1, widthIn: 3.5,
  boards: [
    { id: 'oak-short', lengthIn: 36, qty: 1 },
    { id: 'oak-buy', lengthIn: 96, qty: 0 },
  ],
}]);

test('the library lists physical stock but not quantity-zero purchase sizes', () => {
  assert.deepEqual(libraryStockRows(library).map(({ stock }) => stock.id), ['offcut-a', 'offcut-b', 'oak-short']);
});

test('compatible destinations require kind, thickness, and board width to match', () => {
  const target = project([
    { id: 'sheet-match', kind: 'sheet', thicknessIn: 0.5 },
    { id: 'sheet-wrong', kind: 'sheet', thicknessIn: 0.75 },
    { id: 'board-match', kind: 'board', thicknessIn: 1, widthIn: 3.5 },
    { id: 'board-wrong-width', kind: 'board', thicknessIn: 1, widthIn: 5.5 },
  ]);
  assert.deepEqual(compatibleMaterialIds(target, library.materials[0]), ['sheet-match']);
  assert.deepEqual(compatibleMaterialIds(target, library.materials[1]), ['board-match']);
});

test('selected stock is copied as a self-contained snapshot with provenance', () => {
  const result = mergeLibraryStock(project(), library, [
    { materialId: 'ply', stockId: 'offcut-a' },
  ], { ply: '' });
  assert.equal(result.ok, true);
  assert.equal(result.copied, 1);
  assert.equal(result.project.materials.length, 1);
  assert.deepEqual(result.project.materials[0].sheets.map((sheet) => sheet.qty), [0, 1]);
  assert.deepEqual(result.project.materials[0].sheets[1].inventoryRef, {
    file: 'storage.json', materialId: 'ply', stockId: 'offcut-a',
  });

  library.materials[0].sheets[0].widthIn = 99;
  assert.equal(result.project.materials[0].sheets[1].widthIn, 18);
  library.materials[0].sheets[0].widthIn = 18;
});

test('an existing compatible group receives stock and a missing purchase size', () => {
  const target = project([{
    id: 'mine', kind: 'sheet', name: 'My ply', thicknessIn: 0.5, sheets: [],
  }]);
  const result = mergeLibraryStock(target, library, [
    { materialId: 'ply', stockId: 'offcut-b' },
  ], { ply: 'mine' });
  assert.equal(result.ok, true);
  assert.equal(result.project.materials.length, 1);
  assert.deepEqual(result.project.materials[0].sheets.map((sheet) => sheet.qty), [0, 2]);
  assert.equal(result.project.materials[0].sheets[1].id === 'offcut-b', false);
});

test('a new material refuses offcuts when the library has no purchase size', () => {
  const incomplete = project([{
    id: 'scrap', kind: 'sheet', name: 'Scrap', thicknessIn: 0.25,
    sheets: [{ id: 'only', widthIn: 10, lengthIn: 12, qty: 1 }],
  }]);
  const result = mergeLibraryStock(project(), incomplete, [
    { materialId: 'scrap', stockId: 'only' },
  ], { scrap: '' });
  assert.equal(result.ok, false);
  assert.match(result.message, /quantity-zero purchase size/);
});

test('an existing material also needs a declared purchase size', () => {
  const target = project([{
    id: 'mine', kind: 'sheet', name: 'My ply', thicknessIn: 0.25, sheets: [],
  }]);
  const incomplete = project([{
    id: 'scrap', kind: 'sheet', name: 'Scrap', thicknessIn: 0.25,
    sheets: [{ id: 'only', widthIn: 10, lengthIn: 12, qty: 1 }],
  }]);
  const result = mergeLibraryStock(target, incomplete, [
    { materialId: 'scrap', stockId: 'only' },
  ], { scrap: 'mine' });
  assert.equal(result.ok, false);
  assert.match(result.message, /quantity-zero purchase size/);
});

test('the same physical library stock cannot be added twice', () => {
  const first = mergeLibraryStock(project(), library, [
    { materialId: 'ply', stockId: 'offcut-a' },
  ], { ply: '' });
  assert.equal(first.ok, true);
  assert.equal(hasLibraryStock(first.project, 'storage.json', 'ply', 'offcut-a'), true);

  const second = mergeLibraryStock(first.project, library, [
    { materialId: 'ply', stockId: 'offcut-a' },
  ], { ply: first.project.materials[0].id });
  assert.equal(second.ok, false);
  assert.match(second.message, /already in this project/);
});

test('library provenance survives a share-link round trip', () => {
  const merged = mergeLibraryStock(project(), library, [
    { materialId: 'ply', stockId: 'offcut-a' },
  ], { ply: '' });
  const restored = decodeHash(encodeProject(normalizeProject(merged.project)));
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.project.materials[0].sheets[1].inventoryRef, {
    file: 'storage.json', materialId: 'ply', stockId: 'offcut-a',
  });
});
