import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject } from '../src/model.js';
import { packBoardMaterial } from '../src/packer/boards.js';

function boardProject({ widthIn = 3.5, boardLengthIn = 96, boardQty = 1, parts = [] } = {}) {
  return normalizeProject({
    materials: [{
      id: 'm1',
      name: '2x4',
      kind: 'board',
      widthIn,
      boards: boardLengthIn === null ? [] : [{ id: 'b1', label: '8 ft', lengthIn: boardLengthIn, qty: boardQty }],
    }],
    parts: parts.map((part, index) => ({
      id: `p${index + 1}`,
      name: part.name ?? `Part ${index + 1}`,
      qty: part.qty ?? 1,
      widthIn: part.widthIn ?? widthIn,
      lengthIn: part.lengthIn,
      materialId: 'm1',
    })),
  });
}

function pack(project, params = project.params) {
  return packBoardMaterial({
    material: project.materials[0],
    parts: project.parts,
    params,
    system: project.displaySystem,
  });
}

test('board packing is stable first-fit decreasing', () => {
  const project = boardProject({
    boardLengthIn: 100,
    boardQty: 2,
    parts: [{ lengthIn: 30 }, { lengthIn: 60 }, { lengthIn: 40 }, { lengthIn: 70 }],
  });
  const first = pack(project, { kerfIn: 0, edgeTrimIn: 0 });
  const second = pack(project, { kerfIn: 0, edgeTrimIn: 0 });

  assert.deepEqual(first, second);
  assert.deepEqual(first.boards.map((board) => board.placements.map((part) => part.lengthIn)), [
    [70, 30],
    [60, 40],
  ]);
});

test('kerf is charged after each real crosscut and repeated crosscuts stay separate', () => {
  const project = boardProject({ parts: [{ name: 'Rail', qty: 3, lengthIn: 30 }] });
  const result = pack(project);
  const board = result.boards[0];

  assert.deepEqual(board.placements.map((part) => part.startIn), [0, 30.125, 60.25]);
  assert.deepEqual(board.cuts.map((cut) => cut.seq), [1, 2, 3]);
  assert.deepEqual(board.cuts.map((cut) => cut.atIn), [30, 30, 30]);
  assert.deepEqual(board.cuts.map((cut) => cut.lineIn), [30, 60.125, 90.25]);
  assert.ok(board.cuts.every((cut) => cut.kind === 'crosscut'));
  assert.ok(board.cuts.every((cut) => cut.instruction.startsWith('30 in')));
  assert.equal(board.offcuts[0].lengthIn, 5.625);
});

test('an exact-fit final piece needs no additional saw action', () => {
  const project = boardProject({ boardLengthIn: 80.125, parts: [{ lengthIn: 40 }, { lengthIn: 40 }] });
  const board = pack(project).boards[0];

  assert.equal(board.placements.length, 2);
  assert.equal(board.cuts.length, 1);
  assert.deepEqual(board.offcuts, []);
});

test('on-hand boards stay ahead of purchased boards', () => {
  const project = boardProject({ boardLengthIn: 48, boardQty: 1, parts: [{ qty: 2, lengthIn: 40 }] });
  const result = pack(project);

  assert.deepEqual(result.boards.map((board) => board.source), ['on-hand', 'to-buy']);
  assert.equal(result.onHandBoardCount, 1);
});

test('board parts must match the final stock width', () => {
  const project = boardProject({ parts: [{ name: 'Narrow', widthIn: 2, lengthIn: 20 }] });
  const result = pack(project);

  assert.deepEqual(result.boards, []);
  assert.equal(result.unplaceable.length, 1);
  assert.match(result.unplaceable[0].reason, /final-width board stock is 3\.5 in wide/);
});

test('a material with no valid board specification returns safely without a fallback', () => {
  const project = boardProject({ boardLengthIn: null, parts: [{ name: 'Rail', lengthIn: 20 }] });
  const result = pack(project);

  assert.equal(result.buySpec, null);
  assert.deepEqual(result.boards, []);
  assert.equal(result.unplaceable.length, 1);
  assert.match(result.unplaceable[0].reason, /no valid board length declared/);
});

test('sheet edge trim does not silently shorten board stock', () => {
  const project = boardProject({ boardLengthIn: 20, parts: [{ lengthIn: 19 }] });
  const result = pack(project, { kerfIn: 0.125, edgeTrimIn: 1 });

  assert.equal(result.boards.length, 1);
  assert.equal(result.boards[0].usable.startIn, 0);
  assert.equal(result.boards[0].usable.lengthIn, 20);
  assert.deepEqual(result.unplaceable, []);
});
