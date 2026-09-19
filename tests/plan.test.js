import test from 'node:test';
import assert from 'node:assert/strict';
import { planProject } from '../src/plan.js';
import { normalizeProject } from '../src/model.js';
import { validatePlan } from '../src/packer/invariants.js';
import { renderResults } from '../src/ui/renderResults.js';
import { shortfallProject, mixedPartsProject } from './fixtures/layouts.js';

function allPlacements(plan) {
  return plan.materials.flatMap((material) => material.sheets.flatMap((sheet) => sheet.placements));
}

test('a project that fits on hand needs nothing bought', () => {
  const plan = planProject(mixedPartsProject());
  assert.equal(plan.materials[0].extraSheetsNeeded, 0);
  assert.ok(plan.materials[0].sheets.every((sheet) => sheet.source === 'on-hand'));
  assert.deepEqual(plan.warnings, []);
});

test('a group with zero sheets on hand produces a shopping list, not an error', () => {
  const project = shortfallProject();
  const errors = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args) => errors.push(args);
  console.warn = (...args) => errors.push(args);
  try {
    const plan = planProject(project);
    assert.ok(plan.materials[0].extraSheetsNeeded >= 1);
    assert.ok(plan.materials[0].sheets.length >= 1);
    assert.ok(plan.materials[0].sheets.every((sheet) => sheet.source === 'to-buy'));
    assert.equal(plan.materials[0].onHandSheetCount, 0);
    assert.equal(plan.materials[0].buySpec.widthIn, 48);
    assert.equal(plan.materials[0].buySpec.lengthIn, 96);
    assert.deepEqual(plan.materials[0].unplaceable, []);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
  assert.deepEqual(errors, [], 'planning a shortfall must not log anything');
});

test('bought sheets are packed and validated exactly like on hand sheets', () => {
  const plan = planProject(shortfallProject());
  assert.deepEqual(validatePlan(plan), []);
  assert.ok(plan.materials[0].sheets[0].cuts.length > 0);
});

test('unplanned stock passes through and reaches no sheet', () => {
  const project = normalizeProject({
    name: 'With hardwood',
    materials: [{ id: 'm1', name: 'Half', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [{ id: 'p1', name: 'Base', qty: 1, widthIn: 20, lengthIn: 30, materialId: 'm1' }],
    unplanned: [{ name: 'Miter Bar', qty: 2, note: 'Hardwood, deferred to round 2.' }],
  });
  const plan = planProject(project);

  assert.equal(plan.unplanned.length, 1);
  assert.equal(plan.unplanned[0].name, 'Miter Bar');

  const names = allPlacements(plan).map((placement) => placement.name);
  assert.ok(!names.includes('Miter Bar'));
});

test('a part pointing at a material that does not exist warns instead of throwing', () => {
  const project = normalizeProject({
    materials: [{ id: 'm1', name: 'Half', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [{ id: 'p1', name: 'Ghost', qty: 1, widthIn: 10, lengthIn: 10, materialId: 'nope' }],
  });
  const plan = planProject(project);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /does not exist/);
  assert.equal(allPlacements(plan).length, 0);
});

test('a material with no sheet entry still plans against the fallback sheet', () => {
  const project = normalizeProject({
    materials: [{ id: 'm1', name: 'Mystery ply', sheets: [] }],
    parts: [{ id: 'p1', name: 'Panel', qty: 1, widthIn: 10, lengthIn: 10, materialId: 'm1' }],
  });
  const plan = planProject(project);
  // No warning: the shopping list already names the size to buy, so announcing
  // the fallback told nobody anything they could act on.
  assert.ok(!plan.warnings.some((warning) => /no sheet size/.test(warning)));
  assert.equal(plan.materials[0].extraSheetsNeeded, 1);
});

test('an unplaceable part surfaces as a warning rather than disappearing', () => {
  const project = normalizeProject({
    materials: [{ id: 'm1', name: 'Half', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [{ id: 'p1', name: 'Enormous', qty: 1, widthIn: 200, lengthIn: 200, materialId: 'm1' }],
  });
  const plan = planProject(project);
  assert.equal(plan.materials[0].unplaceable.length, 1);
  assert.ok(plan.warnings.some((warning) => /Enormous/.test(warning)));
});

test('ordering is stable: materials in project order, on hand sheets before bought ones', () => {
  const project = normalizeProject({
    materials: [
      { id: 'm1', name: 'First', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] },
      { id: 'm2', name: 'Second', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] },
    ],
    parts: [
      { id: 'p1', name: 'Big', qty: 6, widthIn: 24, lengthIn: 40, materialId: 'm1' },
      { id: 'p2', name: 'Small', qty: 1, widthIn: 10, lengthIn: 10, materialId: 'm2' },
    ],
  });
  const plan = planProject(project);
  assert.deepEqual(plan.materials.map((material) => material.name), ['First', 'Second']);

  const sources = plan.materials[0].sheets.map((sheet) => sheet.source);
  assert.equal(sources[0], 'on-hand');
  assert.ok(sources.includes('to-buy'), 'this fixture is meant to overflow onto a bought sheet');
  assert.equal(sources.lastIndexOf('on-hand') + 1, sources.indexOf('to-buy'));
  assert.deepEqual(planProject(project), plan);
});

test('the shopping list names every group that ran short, once each', () => {
  const project = normalizeProject({
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [
      { id: 'm1', name: 'Three quarter ply', thicknessLabel: '3/4 in', sheets: [{ widthIn: 48, lengthIn: 96, qty: 0 }] },
      { id: 'm2', name: 'Half ply', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] },
    ],
    parts: [
      { id: 'p1', name: 'Fence', qty: 2, widthIn: 4, lengthIn: 30, materialId: 'm1' },
      { id: 'p2', name: 'Panel', qty: 1, widthIn: 10, lengthIn: 10, materialId: 'm2' },
    ],
  });
  const plan = planProject(project);
  assert.deepEqual(plan.shoppingList, [{
    kind: 'sheet',
    materialId: 'm1',
    name: 'Three quarter ply',
    thicknessLabel: '3/4 in',
    qty: 1,
    widthIn: 48,
    lengthIn: 96,
    label: '48 x 96',
  }]);
});

test('a project with everything on hand has nothing to buy', () => {
  const project = normalizeProject({
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [{ id: 'm1', name: 'Ply', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [{ id: 'p1', name: 'Panel', qty: 1, widthIn: 10, lengthIn: 10, materialId: 'm1' }],
  });
  const plan = planProject(project);
  assert.deepEqual(plan.shoppingList, []);
  assert.ok(!renderResults(plan).includes('shopping-list'), 'an empty shopping list must not render a section');
});
