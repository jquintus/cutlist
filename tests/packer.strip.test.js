// Strip affinity: equal-width parts belong on one strip.
//
// The packer's job here is not the smallest waste area but the fewest trips to
// the saw. Five parts that are all 3 1/2 in wide should be one rip and four
// crosscuts, not three separate columns each with its own rip. These
// assertions are about that gang, so a regression in choosePlacement's
// preference tiers fails here rather than at the saw.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateProject } from '../src/io/validate.js';
import { planProject } from '../src/plan.js';
import { normalizeProject } from '../src/model.js';
import { packMaterial } from '../src/packer/index.js';

async function loadSeed(file) {
  const text = await readFile(new URL(`../projects/${file}`, import.meta.url), 'utf8');
  const checked = validateProject(JSON.parse(text));
  assert.equal(checked.ok, true, `projects/${file}: ${checked.message ?? ''}`);
  return checked.project;
}

test('omnisled-both gangs its 3/4 in parts onto one strip', async () => {
  const plan = planProject(await loadSeed('omnisled-both.json'));
  const group = plan.materials.find((material) => material.name.includes('3/4 in'));
  assert.ok(group, 'no 3/4 in group');

  assert.equal(group.sheets.length, 1, 'the 3/4 in parts fit one sheet');
  const sheet = group.sheets[0];
  assert.equal(sheet.placements.length, 5);

  const columns = new Set(sheet.placements.map((placement) => placement.x.toFixed(6)));
  assert.equal(columns.size, 1, `parts sprawled across ${columns.size} columns instead of ganging on one strip`);
  assert.ok(sheet.cuts.length <= 6, `${sheet.cuts.length} cut steps, more than the six a single strip needs`);
});

test('equal-width parts whose combined length fits one sheet land on a single strip', () => {
  // Six 6 x 15 parts plus five kerfs is 90.625 in, inside a 96 in sheet, so a
  // packer with strip affinity has no reason to open a second column.
  const project = normalizeProject({
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [{ id: 'm1', name: 'Ply', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [{ id: 'p1', name: 'Rail', qty: 6, widthIn: 6, lengthIn: 15, materialId: 'm1', grainLocked: true }],
  });
  const result = packMaterial({
    material: project.materials[0],
    parts: project.parts,
    params: project.params,
  });

  assert.equal(result.sheets.length, 1);
  const sheet = result.sheets[0];
  assert.equal(sheet.placements.length, 6);
  const columns = new Set(sheet.placements.map((placement) => placement.x.toFixed(6)));
  assert.equal(columns.size, 1, 'a run that fits one strip was split across columns');
});

test('packing the same input twice gives the same layout', async () => {
  const project = await loadSeed('omnisled-both.json');
  const pack = () => project.materials.map((material) => packMaterial({
    material,
    parts: project.parts,
    params: project.params,
    system: project.displaySystem,
  }));
  // Deliberately deep-equal over the whole result, trees included: a
  // preference tier that reads anything non-deterministic shows up here.
  assert.deepEqual(pack(), pack());
});
