// Shared packer fixtures. Kept as raw project-shaped data so each test goes
// through normalizeProject exactly the way an imported file would.

import { normalizeProject } from '../../src/model.js';

/** One full sheet, a mix of large panels and narrow rails. */
export function mixedPartsProject({ kerfIn = 0.125, edgeTrimIn = 0 } = {}) {
  return normalizeProject({
    name: 'Mixed parts',
    params: { kerfIn, edgeTrimIn },
    materials: [{ id: 'm1', name: 'Half inch ply', thicknessIn: 0.5, sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [
      { id: 'p1', name: 'Base', qty: 2, widthIn: 18.5, lengthIn: 27, materialId: 'm1' },
      { id: 'p2', name: 'Rail', qty: 4, widthIn: 3, lengthIn: 30, materialId: 'm1' },
      { id: 'p3', name: 'Riser', qty: 3, widthIn: 8, lengthIn: 12.25, materialId: 'm1' },
    ],
  });
}

/** A grain-locked part that would only fit rotated, next to parts that may rotate. */
export function grainLockProject() {
  return normalizeProject({
    name: 'Grain lock',
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [{ id: 'm1', name: 'Quarter inch ply', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [
      // 60 in wide will not fit the 48 in width upright, and the lock forbids turning it.
      { id: 'p1', name: 'Locked plank', qty: 1, widthIn: 60, lengthIn: 20, materialId: 'm1', grainLocked: true },
      // Same shape, free to rotate, so it can be placed.
      { id: 'p2', name: 'Free plank', qty: 1, widthIn: 60, lengthIn: 20, materialId: 'm1' },
      { id: 'p3', name: 'Small panel', qty: 2, widthIn: 12, lengthIn: 18, materialId: 'm1' },
    ],
  });
}

/** A part larger than any sheet in every orientation. */
export function oversizedPartProject() {
  return normalizeProject({
    name: 'Oversized',
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [{ id: 'm1', name: 'Half inch ply', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [
      { id: 'p1', name: 'Too big', qty: 1, widthIn: 120, lengthIn: 130, materialId: 'm1' },
      { id: 'p2', name: 'Fits fine', qty: 1, widthIn: 20, lengthIn: 20, materialId: 'm1' },
    ],
  });
}

/**
 * A part left with a blank measurement (coerced to 0 by normalizeProject)
 * sitting next to ordinary parts, so the zero-dimension one has to be
 * rejected without derailing the rest of the group.
 */
export function blankMeasurementProject() {
  return normalizeProject({
    name: 'Blank measurement',
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [{ id: 'm1', name: 'Half inch ply', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [
      { id: 'p1', name: 'No width', qty: 1, widthIn: 0, lengthIn: 12, materialId: 'm1' },
      { id: 'p2', name: 'No length', qty: 1, widthIn: 12, lengthIn: '', materialId: 'm1' },
      { id: 'p3', name: 'Fine', qty: 2, widthIn: 10, lengthIn: 10, materialId: 'm1' },
    ],
  });
}

/**
 * Sixteen distinct part types in one group, so the 16th (index 15) gets the
 * letter "P" and its first copy is labeled "P1" -- the same string
 * cutStepsFor used to hand the first (root) piece of every sheet before the
 * lowercase-prefix fix.
 */
export function sixteenPartTypesProject() {
  return normalizeProject({
    name: 'Many part types',
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [{ id: 'm1', name: 'Ply', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: Array.from({ length: 16 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Part ${i + 1}`,
      qty: 1,
      widthIn: 2,
      lengthIn: 2,
      materialId: 'm1',
    })),
  });
}

/** A group with nothing on hand, declaring its buy spec with a qty-0 entry. */
export function shortfallProject() {
  return normalizeProject({
    name: 'Shortfall',
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [{
      id: 'm1',
      name: 'Three quarter ply',
      sheets: [{ widthIn: 48, lengthIn: 96, qty: 0, label: '48 x 96 (to buy)' }],
    }],
    parts: [{ id: 'p1', name: 'Fence', qty: 4, widthIn: 4, lengthIn: 30, materialId: 'm1' }],
  });
}
