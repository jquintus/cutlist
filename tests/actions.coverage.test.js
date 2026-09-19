import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { renderForms } from '../src/ui/renderForms.js';
import { renderResults } from '../src/ui/renderResults.js';
import { planProject } from '../src/plan.js';
import { normalizeProject } from '../src/model.js';

/**
 * Every button the interface draws has something behind it.
 *
 * This exists because the same mistake shipped twice. A scripted edit replaced
 * a range of src/ui/app.js and took the action table's neighbours with it:
 * reordering, sorting and repack all lost their handlers while every control
 * that calls them stayed on the page. The tests passed, because no test
 * connected the markup to the table, and the buttons simply did nothing.
 *
 * app.js needs a DOM, so this reads it as text rather than importing it. That
 * is cruder than exporting the table, and it catches exactly the failure that
 * actually happened: markup naming an action that no longer exists.
 */

const project = normalizeProject({
  name: 'Coverage',
  materials: [{
    id: 'm1',
    name: '1/2 in ply',
    thicknessIn: 0.5,
    sheets: [
      { id: 'm1s1', widthIn: 48, lengthIn: 96, qty: 1 },
      { id: 'm1s2', widthIn: 24, lengthIn: 48, qty: 2 },
    ],
  }, {
    id: 'm2',
    name: '3/4 in ply',
    thicknessIn: 0.75,
    sheets: [{ id: 'm2s1', widthIn: 48, lengthIn: 96, qty: 0 }],
  }],
  parts: [
    { id: 'p1', name: 'Base', qty: 1, widthIn: 20, lengthIn: 30, materialId: 'm1' },
    { id: 'p2', name: 'Fence', qty: 2, widthIn: 3.5, lengthIn: 20, materialId: 'm2' },
  ],
  supplies: [{ id: 's1', name: 'Glue', qty: 1, packQty: 1, onHand: false, price: '', note: '', url: '' }],
});

/** Actions handled somewhere other than the ACTIONS table. */
const HANDLED_ELSEWHERE = new Set(['rotate-view']);

function actionsIn(html) {
  return new Set([...html.matchAll(/data-action(?:-select)?="([a-z-]+)"/g)].map((match) => match[1]));
}

test('every action the interface renders has a handler', async () => {
  const app = await readFile(new URL('../src/ui/app.js', import.meta.url), 'utf8');
  const handled = new Set([...app.matchAll(/^ {2}'([a-z-]+)':/gm)].map((match) => match[1]));

  const plan = planProject(project);
  const rendered = [
    renderForms(project, new Map(), { key: 'widthIn', dir: 1 }, { meta: true, materials: true, parts: true }, { key: 'qty', dir: 1 }),
    renderResults(plan, { rotated: {}, ticked: new Set(), baseHash: '#x' }),
  ].join('\n');

  const used = actionsIn(rendered);
  assert.ok(used.size > 5, `only ${used.size} actions rendered; the fixture is not exercising the forms`);

  const missing = [...used].filter((action) => !handled.has(action) && !HANDLED_ELSEWHERE.has(action));
  assert.deepEqual(missing, [], `markup calls actions nothing handles: ${missing.join(', ')}`);
});

test('the reorder and sort controls are actually rendered', () => {
  const html = renderForms(project, new Map(), null, { meta: true, materials: true, parts: true }, null);
  // Named one by one rather than counted, so deleting a control's markup fails
  // here instead of quietly shrinking a total nobody reads.
  for (const action of ['move-part', 'move-material', 'move-sheet', 'move-supply', 'sort-parts', 'sort-sheets']) {
    assert.ok(html.includes(`data-action="${action}"`), `${action} is not rendered anywhere`);
  }
});

test('the repack control is rendered beside the diagram', () => {
  const html = renderResults(planProject(project), { rotated: {}, ticked: new Set(), baseHash: '#x' });
  assert.ok(html.includes('data-action="rotate-sheet"'), 'repack is not rendered');
  assert.ok(html.includes('data-action="rotate-view"'), 'turn picture is not rendered');
});
