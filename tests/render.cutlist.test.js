// The results surface is what someone reads standing at the saw, so these
// assertions are about what does and does not reach the page: no internal
// piece identifier, no raw coordinate, one checkbox per part, and the
// leftovers stated once per sheet rather than once per cut.

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLength } from '../src/units.js';
import { readFile } from 'node:fs/promises';
import { validateProject } from '../src/io/validate.js';
import { planProject } from '../src/plan.js';
import { normalizeProject } from '../src/model.js';
import { renderResults } from '../src/ui/renderResults.js';
import { cutListRows, cutListHtml, sheetKey } from '../src/ui/renderTable.js';

const SEEDS = ['omnisled-full-size.json', 'omnisled-mini.json', 'omnisled-both.json'];

async function seedPlan(file) {
  const text = await readFile(new URL(`../projects/${file}`, import.meta.url), 'utf8');
  const checked = validateProject(JSON.parse(text));
  assert.equal(checked.ok, true, `projects/${file}: ${checked.message ?? ''}`);
  return planProject(checked.project);
}

test('the old global cut-list table is gone', async () => {
  for (const file of SEEDS) {
    const html = renderResults(await seedPlan(file));
    assert.ok(!html.includes('<table class="cut-list"'), `${file} still renders the old table`);
  }
});

// Attributes are machinery: the SVG's geometry and its data- coordinates are
// what make the diagram to scale and what the parity test reads. This checks
// the words on the page, so every tag is stripped before looking.
function visibleText(html) {
  return html.replace(/<[^>]*>/g, ' ');
}

test('no internal piece identifier and no raw coordinate reaches the page', async () => {
  for (const file of SEEDS) {
    const html = visibleText(renderResults(await seedPlan(file)));
    assert.doesNotMatch(html, /\bp\d+\b/, `${file} leaks an internal piece identifier`);
    assert.doesNotMatch(html, /\d\.\d{4}/, `${file} leaks a raw coordinate`);
  }
});

test('every part gets one checkbox row, in the order the diagram draws it', async () => {
  const plan = await seedPlan('omnisled-both.json');
  const html = renderResults(plan);

  for (const materialPlan of plan.materials) {
    materialPlan.sheets.forEach((sheetPlan, index) => {
      const key = sheetKey(materialPlan, sheetPlan, index);
      const section = html.split(`<section class="sheet-todo" data-sheet="${key}">`)[1];
      assert.ok(section, `no to-do section for ${sheetPlan.label}`);
      const parts = section.split('<ul class="parts">')[1].split('</ul>')[0];
      const items = [...parts.matchAll(/<strong>([^<]*)<\/strong>/g)].map((match) => match[1]);
      assert.deepEqual(
        items,
        sheetPlan.placements.map((placement) => placement.label),
        'the parts checklist is not in diagram order',
      );
    });
  }
});

test('a part row carries its name and one size, and nothing else', async () => {
  const plan = await seedPlan('omnisled-both.json');
  const html = renderResults(plan);
  const placement = plan.materials
    .flatMap((material) => material.sheets)
    .flatMap((sheet) => sheet.placements)
    .find((candidate) => candidate.name === 'Mini Base');
  assert.ok(placement, 'the fixture must contain a Mini Base');
  // Derived from the placement, not hardcoded: the seed file is a real project
  // the user edits from the app, so pinning its dimensions here turns one of
  // his edits into a red build.
  const size = `${formatLength(placement.w, 'imperial')} x ${formatLength(placement.h, 'imperial')}`;
  assert.ok(html.includes(`<strong>${placement.label}</strong> - Mini Base - ${size}`),
    `part row missing "${size}"`);
});

test('each sheet states its leftovers exactly once', async () => {
  const plan = await seedPlan('omnisled-both.json');
  const html = renderResults(plan);
  const sheetCount = plan.materials.reduce((sum, material) => sum + material.sheets.length, 0);
  const leftovers = html.match(/<p class="leftover">/g) ?? [];
  assert.equal(leftovers.length, sheetCount);
  assert.ok(html.includes('Leftovers from this sheet: 44 3/8 in x 96 in'));
});

test('every cut step is one numbered item keyed to its own sheet', async () => {
  const plan = await seedPlan('omnisled-both.json');
  const html = renderResults(plan);
  for (const materialPlan of plan.materials) {
    materialPlan.sheets.forEach((sheetPlan, index) => {
      const key = sheetKey(materialPlan, sheetPlan, index);
      for (const step of sheetPlan.cuts) {
        assert.ok(
          html.includes(`<li data-step="${step.seq}" data-sheet="${key}">`),
          `step ${step.seq} of ${sheetPlan.label} has no list item`,
        );
      }
    });
  }
});

test('a hostile part name is escaped in the to-do list', () => {
  const project = normalizeProject({
    materials: [{ id: 'm1', name: 'Ply', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [{
      id: 'p1',
      name: '<img src=x onerror=alert(1)>',
      qty: 1,
      widthIn: 20,
      lengthIn: 30,
      materialId: 'm1',
    }],
  });
  const html = cutListHtml(cutListRows(planProject(project)));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('both entry points into the to-do list render the same sections', async () => {
  const plan = await seedPlan('omnisled-mini.json');
  const fromRows = cutListHtml(cutListRows(plan));
  const html = renderResults(plan);
  for (const section of fromRows.split('\n<section class="sheet-todo"')) {
    const head = section.split('\n')[0];
    assert.ok(html.includes(head.trim()), 'a sheet section differs between the two entry points');
  }
});
