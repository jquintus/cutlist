// Two rotate controls that must never be confused for each other.
//
// One swaps a sheet spec's dimensions and reruns the packer, changing the
// plan. The other only turns the picture on screen. These assertions pin the
// difference: the view control provably changes no data, and the repack
// control provably changes the layout.

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject } from '../src/model.js';
import { planProject } from '../src/plan.js';
import { sheetSvg } from '../src/ui/renderDiagram.js';
import { cutListRows, sheetKey } from '../src/ui/renderTable.js';
import { renderResults } from '../src/ui/renderResults.js';
import { renderForms } from '../src/ui/renderForms.js';

function project({ widthIn = 48, lengthIn = 96 } = {}) {
  return normalizeProject({
    name: 'Rotate',
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [{ id: 'm1', name: 'Ply', sheets: [{ widthIn, lengthIn, qty: 1 }] }],
    parts: [
      { id: 'p1', name: 'Panel', qty: 2, widthIn: 20, lengthIn: 40, materialId: 'm1', grainLocked: true },
      { id: 'p2', name: 'Rail', qty: 3, widthIn: 4, lengthIn: 36, materialId: 'm1', grainLocked: true },
    ],
  });
}

test('rotating the view changes no drawing and no row', () => {
  const plan = planProject(project());
  const materialPlan = plan.materials[0];
  const sheetPlan = materialPlan.sheets[0];
  const key = sheetKey(materialPlan, sheetPlan, 0);

  const beforeSvg = sheetSvg(sheetPlan, materialPlan, plan.params);
  const beforeRows = cutListRows(plan);

  renderResults(plan, { rotated: { [key]: true } });

  assert.deepEqual(sheetSvg(sheetPlan, materialPlan, plan.params), beforeSvg);
  assert.deepEqual(cutListRows(plan), beforeRows);
});

test('the view rotation lands on the wrapper, never on the diagram', () => {
  const plan = planProject(project());
  const materialPlan = plan.materials[0];
  const key = sheetKey(materialPlan, materialPlan.sheets[0], 0);

  const flat = renderResults(plan, { rotated: {} });
  const turned = renderResults(plan, { rotated: { [key]: true } });

  assert.ok(flat.includes('<div class="sheet-view">'));
  assert.ok(turned.includes('<div class="sheet-view rotated">'));
  // The SVG itself is untouched, which is what makes print unaffected.
  const svgOf = (html) => html.match(/<svg[\s\S]*?<\/svg>/)[0];
  assert.equal(svgOf(flat), svgOf(turned));
});

test('swapping a sheet spec changes the layout it produces', () => {
  const upright = planProject(project({ widthIn: 48, lengthIn: 96 })).materials[0];
  const swapped = planProject(project({ widthIn: 96, lengthIn: 48 })).materials[0];

  const shape = (materialPlan) => materialPlan.sheets.map((sheet) => ({
    cuts: sheet.cuts.length,
    placements: sheet.placements.map((placement) => [placement.x, placement.y]),
  }));
  assert.notDeepEqual(shape(upright), shape(swapped), 'swapping the sheet spec changed nothing');
});

// Both controls now sit beside the picture they act on, which is where someone
// looking at a layout wants them. They stay distinguishable by their words and
// by what they do: one turns the drawing, the other lays the sheet the other
// way and works out the cuts again.
test('the two controls sit beside the diagram and use different words', () => {
  const forms = renderForms(project());
  const results = renderResults(planProject(project()), { rotated: {} });

  assert.ok(!forms.includes('rotate-sheet'), 'the repack control must not be back in the editing form');
  assert.ok(!forms.includes('rotate-view'), 'the view control must not appear in the editing form');

  assert.ok(results.includes('data-action="rotate-view"'), 'no view control on the diagram');
  assert.ok(results.includes('Turn picture'));
  assert.ok(results.includes('data-action="rotate-sheet"'), 'no repack control on the diagram');
  assert.ok(results.includes('Repack'));
});

test('the view control is not printed', () => {
  const results = renderResults(planProject(project()), { rotated: {} });
  const control = results.split('data-action="rotate-view"')[0].split('<div class="figure-tools').at(-1);
  assert.ok(control.includes('no-print'), 'the view control would print');
});
