import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject } from '../src/model.js';
import { planProject } from '../src/plan.js';
import {
  checkBoardNoOverlap,
  checkBoardInBounds,
  checkBoardKerf,
  checkBoardWidth,
  checkBoardConservation,
  checkBoardCuts,
  validatePlan,
} from '../src/packer/invariants.js';

const placement = (label, startIn, lengthIn, widthIn = 3.5) => ({
  label, startIn, lengthIn, widthIn,
});

test('board validators reject overlap, bounds, kerf and width violations', () => {
  assert.equal(checkBoardNoOverlap({ placements: [placement('A1', 0, 10), placement('A2', 9, 10)] }).length, 1);
  assert.equal(checkBoardInBounds({
    usable: { startIn: 1, lengthIn: 20 },
    placements: [placement('A1', 0, 10)],
  }).length, 1);
  assert.equal(checkBoardKerf({
    placements: [placement('A1', 0, 10), placement('A2', 10.05, 10)],
    kerfIn: 0.125,
  }).length, 1);
  assert.equal(checkBoardWidth({ placements: [placement('A1', 0, 10, 2)], materialWidthIn: 3.5 }).length, 1);
});

test('board conservation and cut-sequence validators reject corrupt plans', () => {
  const board = {
    usable: { startIn: 0, lengthIn: 20 },
    placements: [placement('A1', 0, 10)],
    offcuts: [{ startIn: 10.125, lengthIn: 8 }],
    cuts: [{ seq: 2, kind: 'rip', atIn: 10, lineIn: 25, kerfConsumedIn: 0.125 }],
  };
  assert.equal(checkBoardConservation({ board }).length, 1);
  assert.ok(checkBoardCuts({ board }).length >= 3);
});

test('a generated board plan satisfies every invariant', () => {
  const project = normalizeProject({
    materials: [{
      id: 'm1', name: '2x4', kind: 'board', widthIn: 3.5,
      boards: [{ id: 'b1', label: '8 ft', lengthIn: 96, qty: 1 }],
    }],
    parts: [{ id: 'p1', name: 'Rail', qty: 3, widthIn: 3.5, lengthIn: 30, materialId: 'm1' }],
  });
  assert.deepEqual(validatePlan(planProject(project)), []);
});
