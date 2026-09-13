// The seed projects are this build's live test. These assertions are about
// the real files under projects/, not about a fixture, so a bad edit to a seed
// fails the suite rather than surfacing at the saw.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { validateProject } from '../src/io/validate.js';
import { planProject } from '../src/plan.js';
import { validatePlan } from '../src/packer/invariants.js';
import { sheetSvg } from '../src/ui/renderDiagram.js';
import { cutListRows, cutListHtml } from '../src/ui/renderTable.js';
import { encodeProject, decodeHash } from '../src/share/codec.js';

const SEEDS = ['omnisled-full-size.json', 'omnisled-mini.json', 'omnisled-both.json'];

async function loadSeed(file) {
  const text = await readFile(new URL(`../projects/${file}`, import.meta.url), 'utf8');
  const checked = validateProject(JSON.parse(text));
  assert.equal(checked.ok, true, `projects/${file}: ${checked.message ?? ''}`);
  return checked.project;
}

function groupNamed(plan, fragment) {
  const group = plan.materials.find((material) => material.name.includes(fragment));
  assert.ok(group, `no material group matching ${fragment}`);
  return group;
}

for (const file of SEEDS) {
  test(`${file} is valid and its layout satisfies every invariant`, async () => {
    const plan = planProject(await loadSeed(file));
    assert.deepEqual(validatePlan(plan), []);
  });

  // The orientation and the exact size are the user's to change from the app,
  // so this pins the part that matters: both thicknesses he owns are stocked
  // with one full sheet, whichever way round it is entered.
  test(`${file} stocks one full sheet each of 1/4 in and 1/2 in`, async () => {
    const project = await loadSeed(file);
    for (const fragment of ['1/2 in', '1/4 in']) {
      const material = project.materials.find((m) => m.name.includes(fragment));
      assert.ok(material, `no ${fragment} group`);
      assert.equal(material.sheets.length, 1);
      const [sheet] = material.sheets;
      const sides = [sheet.widthIn, sheet.lengthIn].sort((a, b) => a - b);
      assert.deepEqual(sides, [48, 96], `${fragment} is not a full sheet`);
      assert.equal(sheet.qty, 1);
    }
  });

  test(`${file} packs the in-stock thicknesses with nothing left over`, async () => {
    const plan = planProject(await loadSeed(file));
    for (const fragment of ['1/2 in', '1/4 in']) {
      const group = groupNamed(plan, fragment);
      assert.deepEqual(group.unplaceable, [], `${fragment} left parts unplaced`);
      assert.equal(group.extraSheetsNeeded, 0, `${fragment} should not need a new sheet`);
      assert.ok(group.sheets.every((sheet) => sheet.source === 'on-hand'));
    }
  });

  test(`${file} reports a specific count of 3/4 in sheets to buy`, async () => {
    const plan = planProject(await loadSeed(file));
    const group = groupNamed(plan, '3/4 in');
    assert.equal(group.onHandSheetCount, 0);
    assert.ok(group.extraSheetsNeeded >= 1);
    assert.equal(group.extraSheetsNeeded, group.sheets.length);
    assert.ok(group.sheets.every((sheet) => sheet.source === 'to-buy'));
    assert.deepEqual(group.unplaceable, []);
    assert.equal(group.buySpec.widthIn, 48);
    assert.equal(group.buySpec.lengthIn, 96);
  });

  test(`${file} records the 6 mm substitution in the material note, not in code`, async () => {
    const project = await loadSeed(file);
    const quarter = project.materials.find((material) => material.name.includes('1/4 in'));
    assert.match(quarter.note, /6 mm/);
  });

  test(`${file} carries its miter bars and lays none of them out`, async () => {
    const plan = planProject(await loadSeed(file));
    assert.ok(plan.unplanned.length >= 1);
    assert.ok(plan.unplanned.every((item) => /Miter Bar/.test(item.name)));

    const rendered = plan.materials.flatMap((materialPlan) => [
      ...materialPlan.sheets.map((sheet) => sheetSvg(sheet, materialPlan, plan.params)),
    ]).join('\n') + cutListHtml(cutListRows(plan));

    assert.ok(!rendered.includes('Miter Bar'), 'a miter bar reached a diagram or the cut list');
  });

  test(`${file} round trips through a share link unchanged`, async () => {
    const project = await loadSeed(file);
    const restored = decodeHash(encodeProject(project));
    assert.equal(restored.ok, true);
    assert.deepEqual(restored.project, project);
  });

  test(`${file} plans without a single warning`, async () => {
    const plan = planProject(await loadSeed(file));
    assert.deepEqual(plan.warnings, []);
  });
}

test('omnisled-both carries every part from both sleds under disambiguated names', async () => {
  const project = await loadSeed('omnisled-both.json');
  const names = project.parts.map((part) => part.name);
  for (const expected of [
    'Full Base', 'Full Base Riser', 'Full Beveled Fence', 'Full Front Fence', 'Full Back Fence',
    'Mini Base', 'Mini Base Riser', 'Mini Beveled Fence', 'Mini Front Fence', 'Mini Back Fence',
  ]) {
    assert.ok(names.includes(expected), `omnisled-both is missing ${expected}`);
  }
  assert.equal(project.unplanned.length, 2);
  assert.deepEqual(
    project.unplanned.map((item) => item.name),
    ['Full Miter Bar', 'Mini Miter Bar'],
  );
});

test('projects/index.json lists exactly the project files beside it', async () => {
  const dir = new URL('../projects/', import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json') && name !== 'index.json').sort();
  const index = JSON.parse(await readFile(new URL('index.json', dir), 'utf8'));
  assert.equal(index.schemaVersion, 1);
  assert.deepEqual(index.projects.map((entry) => entry.file), files);
});
