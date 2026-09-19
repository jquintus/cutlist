import test from 'node:test';
import assert from 'node:assert/strict';
import { buySpecFor, packMaterial } from '../src/packer/index.js';
import { checkGuillotine } from '../src/packer/invariants.js';
import { EPS } from '../src/geometry.js';
import { assertValidLayout } from './fixtures/assertValid.js';
import {
  mixedPartsProject,
  grainLockProject,
  oversizedPartProject,
  blankMeasurementProject,
  sixteenPartTypesProject,
} from './fixtures/layouts.js';

function pack(project) {
  return packMaterial({
    material: project.materials[0],
    parts: project.parts,
    params: project.params,
  });
}

test('a quantity-zero sheet stays the purchase size when larger offcuts are on hand', () => {
  const spec = buySpecFor({ sheets: [
    { id: 'offcut', widthIn: 60, lengthIn: 60, qty: 1 },
    { id: 'buy', widthIn: 48, lengthIn: 96, qty: 0 },
  ] });
  assert.equal(spec.id, 'buy');
});

test('case 1: a mixed part set packs with no overlap, in bounds, kerf respected', () => {
  const project = mixedPartsProject();
  const result = pack(project);
  assert.equal(result.unplaceable.length, 0);
  assert.ok(result.sheets.length >= 1);
  for (const sheet of result.sheets) {
    assertValidLayout(sheet, project.params, project.parts);
  }
});

test('case 2: the same layout is guillotine valid under the independent validator', () => {
  const project = mixedPartsProject();
  const result = pack(project);
  for (const sheet of result.sheets) {
    assert.deepEqual(
      checkGuillotine({ usable: sheet.usable, placements: sheet.placements }),
      [],
    );
  }
});

test('case 3: a grain locked part is reported unplaceable rather than quietly rotated', () => {
  const project = grainLockProject();
  const result = pack(project);

  const locked = result.unplaceable.filter((instance) => instance.name === 'Locked plank');
  assert.equal(locked.length, 1);
  assert.ok(locked[0].reason.length > 0);

  const placedNames = result.sheets.flatMap((s) => s.placements.map((p) => p.name));
  assert.ok(!placedNames.includes('Locked plank'));

  for (const sheet of result.sheets) {
    assertValidLayout(sheet, project.params, project.parts);
  }
});

test('case 3b: an unlocked part does get placed rotated, so the lock test is not trivially true', () => {
  const project = grainLockProject();
  const result = pack(project);
  const rotated = result.sheets.flatMap((s) => s.placements).filter((p) => p.rotated === true);
  assert.ok(rotated.length >= 1, 'expected at least one rotated placement somewhere in the fixtures');
  assert.ok(rotated.some((p) => p.name === 'Free plank'));
});

test('case 4: kerf 0 and edge trim 0 still produce a valid, non degenerate layout', () => {
  const project = mixedPartsProject({ kerfIn: 0, edgeTrimIn: 0 });
  const result = pack(project);

  assert.equal(result.unplaceable.length, 0);
  assert.ok(result.sheets.length >= 1 && result.sheets.length < 10);

  let placedArea = 0;
  for (const sheet of result.sheets) {
    assertValidLayout(sheet, project.params, project.parts);
    for (const placement of sheet.placements) {
      assert.ok(placement.w > EPS, `${placement.label} has zero width`);
      assert.ok(placement.h > EPS, `${placement.label} has zero height`);
      placedArea += placement.w * placement.h;
    }
  }
  assert.ok(placedArea > 0);
});

test('case 5: an oversized part is unplaceable once, laid out nowhere, and does not spawn sheets forever', () => {
  const project = oversizedPartProject();
  const result = pack(project);

  const tooBig = result.unplaceable.filter((instance) => instance.name === 'Too big');
  assert.equal(tooBig.length, 1);
  assert.ok(tooBig[0].reason.length > 0);

  const placedNames = result.sheets.flatMap((s) => s.placements.map((p) => p.name));
  assert.ok(!placedNames.includes('Too big'));
  assert.ok(placedNames.includes('Fits fine'));
  assert.ok(result.sheets.length <= 2);
});

test('case 6: packing the same input twice gives deeply equal results', () => {
  const first = pack(mixedPartsProject());
  const second = pack(mixedPartsProject());
  assert.deepEqual(first, second);
});

test('on-hand sheets are tried by area from smallest to largest', () => {
  const project = {
    materials: [{
      id: 'm1',
      sheets: [
        { id: 'large', widthIn: 48, lengthIn: 96, qty: 1 },
        { id: 'small', widthIn: 12, lengthIn: 12, qty: 1 },
      ],
    }],
    parts: [{ id: 'p1', name: 'Small part', qty: 1, widthIn: 10, lengthIn: 10, materialId: 'm1' }],
    params: { kerfIn: 0, edgeTrimIn: 0 },
  };

  const result = pack(project);

  assert.equal(result.sheets.length, 1);
  assert.equal(result.sheets[0].sheetSpecId, 'small');
});

test('an unsuitable small offcut is skipped for the next-smallest suitable sheet', () => {
  const project = {
    materials: [{
      id: 'm1',
      sheets: [
        { id: 'large', widthIn: 48, lengthIn: 96, qty: 1 },
        { id: 'tiny', widthIn: 5, lengthIn: 5, qty: 1 },
        { id: 'medium', widthIn: 12, lengthIn: 12, qty: 1 },
      ],
    }],
    parts: [{ id: 'p1', name: 'Small part', qty: 1, widthIn: 10, lengthIn: 10, materialId: 'm1' }],
    params: { kerfIn: 0, edgeTrimIn: 0 },
  };

  const result = pack(project);

  assert.equal(result.sheets.length, 1);
  assert.equal(result.sheets[0].sheetSpecId, 'medium');
});

test('equal-area on-hand sheets retain project order', () => {
  const project = {
    materials: [{
      id: 'm1',
      sheets: [
        { id: 'first', widthIn: 12, lengthIn: 16, qty: 1 },
        { id: 'second', widthIn: 8, lengthIn: 24, qty: 1 },
      ],
    }],
    parts: [{ id: 'p1', name: 'Tie breaker', qty: 1, widthIn: 6, lengthIn: 10, materialId: 'm1' }],
    params: { kerfIn: 0, edgeTrimIn: 0 },
  };

  const result = pack(project);

  assert.equal(result.sheets.length, 1);
  assert.equal(result.sheets[0].sheetSpecId, 'first');
});

test('a part with a blank or zero width or length is rejected before layout, never placed', () => {
  const project = blankMeasurementProject();
  const result = pack(project);

  const rejected = result.unplaceable.filter((instance) => ['No width', 'No length'].includes(instance.name));
  assert.equal(rejected.length, 2);
  for (const instance of rejected) assert.ok(instance.reason.length > 0);

  const placedNames = result.sheets.flatMap((s) => s.placements.map((p) => p.name));
  assert.ok(!placedNames.includes('No width'));
  assert.ok(!placedNames.includes('No length'));
  assert.ok(placedNames.includes('Fine'));

  // The bug this guards against: a zero-length side reaches the guillotine
  // tree and produces a step measured at 0 in.
  for (const sheet of result.sheets) {
    for (const step of sheet.cuts) assert.ok(step.atIn > EPS, `a cut step measured at ${step.atIn} in`);
  }
});

test('auto piece numbering never collides with a part label, however many part types share a sheet', () => {
  const project = sixteenPartTypesProject();
  const result = pack(project);

  const labels = new Set(result.sheets.flatMap((sheet) => sheet.placements.map((p) => p.label)));
  assert.ok(labels.has('P1'), 'the 16th part type must actually be labeled P1 for this to be a real test');

  const isNotAPartLabeledId = (piece) => piece.role === 'part' || !labels.has(piece.id);
  for (const sheet of result.sheets) {
    for (const step of sheet.cuts) {
      assert.ok(isNotAPartLabeledId(step.pieceBefore), `${step.pieceBefore.id} collides with a part label`);
      for (const piece of step.pieceAfter) {
        assert.ok(isNotAPartLabeledId(piece), `${piece.id} collides with a part label`);
      }
    }
  }
});

test('placement labels are unique within a material group', () => {
  const project = mixedPartsProject();
  const result = pack(project);
  const labels = result.sheets.flatMap((s) => s.placements.map((p) => p.label));
  assert.equal(new Set(labels).size, labels.length);
});

test('edge trim is applied once and shrinks the usable region on all four sides', () => {
  const project = mixedPartsProject({ edgeTrimIn: 0.25 });
  const result = pack(project);
  const sheet = result.sheets[0];
  assert.equal(sheet.usable.x, 0.25);
  assert.equal(sheet.usable.y, 0.25);
  assert.equal(sheet.usable.w, 47.5);
  assert.equal(sheet.usable.h, 95.5);
  assertValidLayout(sheet, project.params, project.parts);
});

test('the packer stays free of the browser and of the UI layer', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const dir = new URL('../src/packer/', import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.js'));
  assert.ok(files.length >= 5);
  for (const file of files) {
    const source = await readFile(new URL(file, dir), 'utf8');
    assert.ok(!/\bdocument\b/.test(source), `${file} references document`);
    assert.ok(!/\bwindow\b/.test(source), `${file} references window`);
    assert.ok(!/\bfetch\b/.test(source), `${file} references fetch`);
    assert.ok(!/from '\.\.\/ui\//.test(source), `${file} imports from the UI layer`);
  }
});

test('the guillotine validator never consults the packer tree', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/packer/invariants.js', import.meta.url), 'utf8');
  // The validator must re-derive cuttability from the rectangles alone. If it
  // ever reaches into the node structure the packer built, it stops being an
  // independent check and becomes a restatement of that structure, so none of
  // the tree's own field names may be read here.
  for (const field of ['cut', 'first', 'second', 'tree', 'split']) {
    assert.ok(
      !new RegExp(`\\.${field}\\b`).test(source),
      `invariants.js reads .${field}, a field of the packer's own tree`,
    );
  }
});
