import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject } from '../src/model.js';
import { planProject } from '../src/plan.js';

function mixedProject() {
  return normalizeProject({
    materials: [
      {
        id: 'ply',
        name: 'Plywood',
        kind: 'sheet',
        sheets: [{ id: 's1', widthIn: 48, lengthIn: 96, qty: 0 }],
      },
      {
        id: 'oak',
        name: 'White oak',
        kind: 'board',
        thicknessLabel: '4/4',
        widthIn: 7,
        boards: [{ id: 'b1', label: '8 ft', lengthIn: 96, qty: 0 }],
      },
    ],
    parts: [
      { id: 'panel', name: 'Panel', qty: 1, widthIn: 20, lengthIn: 20, materialId: 'ply' },
      { id: 'rail', name: 'Rail', qty: 4, widthIn: 7, lengthIn: 30, materialId: 'oak' },
    ],
  });
}

test('planProject dispatches board groups to the one-dimensional packer', () => {
  const plan = planProject(mixedProject());
  const board = plan.materials[1];

  assert.equal(board.kind, 'board');
  assert.deepEqual(board.sheets, []);
  assert.equal(board.boards.length, 2);
  assert.equal(board.extraBoardsNeeded, 2);
  assert.equal(board.onHandBoardCount, 0);
  assert.equal(plan.widestBoardIn, 96);
});

test('sheet and board shortages share one explicitly typed shopping list', () => {
  const plan = planProject(mixedProject());

  assert.deepEqual(plan.shoppingList.map((entry) => entry.kind), ['sheet', 'board']);
  assert.deepEqual(plan.shoppingList[1], {
    kind: 'board',
    materialId: 'oak',
    name: 'White oak',
    thicknessLabel: '4/4',
    qty: 2,
    widthIn: 7,
    lengthIn: 96,
    label: '8 ft',
  });
});

test('missing board stock becomes a warning and never throws', () => {
  const project = normalizeProject({
    materials: [{ id: 'oak', name: 'Oak', kind: 'board', widthIn: 3.5, boards: [] }],
    parts: [{ id: 'rail', name: 'Rail', qty: 1, widthIn: 3.5, lengthIn: 30, materialId: 'oak' }],
  });
  const plan = planProject(project);

  assert.equal(plan.materials[0].buySpec, null);
  assert.equal(plan.materials[0].unplaceable.length, 1);
  assert.ok(plan.warnings.some((warning) => /no valid board length/.test(warning)));
  assert.deepEqual(plan.shoppingList, []);
});
