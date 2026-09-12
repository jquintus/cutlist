// Negative tests on the validators themselves. A validator that never reports
// anything would let every layout test above pass while proving nothing, so
// each one is handed a layout it must reject.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkNoOverlap,
  checkInBounds,
  checkKerf,
  checkGuillotine,
  checkGrainLock,
} from '../src/packer/invariants.js';

const USABLE = { x: 0, y: 0, w: 48, h: 96 };

function rect(label, x, y, w, h, extra = {}) {
  return { label, name: label, partId: label, x, y, w, h, rotated: false, ...extra };
}

test('checkNoOverlap reports two rectangles sharing material', () => {
  const violations = checkNoOverlap({
    placements: [rect('A1', 0, 0, 10, 10), rect('A2', 5, 5, 10, 10)],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /overlap/);
});

test('checkNoOverlap accepts rectangles that merely touch', () => {
  const violations = checkNoOverlap({
    placements: [rect('A1', 0, 0, 10, 10), rect('A2', 10, 0, 10, 10)],
  });
  assert.deepEqual(violations, []);
});

test('checkInBounds reports a placement hanging off the usable region', () => {
  const violations = checkInBounds({
    usable: USABLE,
    placements: [rect('A1', 40, 0, 12, 10)],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /outside the usable area/);
});

test('checkKerf reports two touching rectangles when the blade has a width', () => {
  const violations = checkKerf({
    placements: [rect('A1', 0, 0, 10, 10), rect('A2', 10, 0, 10, 10)],
    kerfIn: 0.125,
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /less than the 0.125 in kerf/);
});

test('checkKerf accepts rectangles a full blade apart', () => {
  const violations = checkKerf({
    placements: [rect('A1', 0, 0, 10, 10), rect('A2', 10.125, 0, 10, 10)],
    kerfIn: 0.125,
  });
  assert.deepEqual(violations, []);
});

test('checkKerf has nothing to say when the kerf is zero', () => {
  const violations = checkKerf({
    placements: [rect('A1', 0, 0, 10, 10), rect('A2', 10, 0, 10, 10)],
    kerfIn: 0,
  });
  assert.deepEqual(violations, []);
});

test('checkGuillotine reports a pinwheel, which admits no edge to edge cut', () => {
  // Four rectangles around an empty center. Every candidate full span line is
  // straddled by one of them, so no saw cut separates the group.
  const violations = checkGuillotine({
    usable: { x: 0, y: 0, w: 3, h: 3 },
    placements: [
      rect('A1', 0, 0, 2, 1),
      rect('A2', 2, 0, 1, 2),
      rect('A3', 1, 2, 2, 1),
      rect('A4', 0, 1, 1, 2),
    ],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /edge-to-edge/);
});

test('checkGuillotine accepts a plain grid of rectangles', () => {
  const violations = checkGuillotine({
    usable: { x: 0, y: 0, w: 4, h: 4 },
    placements: [
      rect('A1', 0, 0, 2, 2),
      rect('A2', 2, 0, 2, 2),
      rect('A3', 0, 2, 2, 2),
      rect('A4', 2, 2, 2, 2),
    ],
  });
  assert.deepEqual(violations, []);
});

test('checkGuillotine accepts a layout whose only valid first cut is the second one tried', () => {
  // Separable on y first but not on x first, which is what the backtracking buys.
  const violations = checkGuillotine({
    usable: { x: 0, y: 0, w: 4, h: 4 },
    placements: [
      rect('A1', 0, 0, 4, 1),
      rect('A2', 0, 1, 1, 3),
      rect('A3', 1, 1, 3, 3),
    ],
  });
  assert.deepEqual(violations, []);
});

test('checkGrainLock reports a locked part that was rotated', () => {
  const violations = checkGrainLock({
    placements: [rect('A1', 0, 0, 10, 10, { rotated: true, grainLocked: true })],
    parts: [{ id: 'A1', grainLocked: true }],
  });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /grain locked but was rotated/);
});

test('checkGrainLock catches a lock recorded on the part even when the placement forgot it', () => {
  const violations = checkGrainLock({
    placements: [rect('A1', 0, 0, 10, 10, { rotated: true, grainLocked: false })],
    parts: [{ id: 'A1', grainLocked: true }],
  });
  assert.equal(violations.length, 1);
});

test('checkGrainLock accepts an unlocked part that was rotated', () => {
  const violations = checkGrainLock({
    placements: [rect('A1', 0, 0, 10, 10, { rotated: true, grainLocked: false })],
    parts: [{ id: 'A1', grainLocked: false }],
  });
  assert.deepEqual(violations, []);
});
