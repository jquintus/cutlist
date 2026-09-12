// Label text has to fit the part it names.
//
// A sheet-wide font size is readable on a 30 in base and unreadable garbage on
// a 3 1/2 in fence: the name runs past its own rectangle and over the labels
// of the parts beside it, so a sheet of small parts cannot be checked by eye.
// These assertions measure the drawn text against the rectangle that carries
// it, using a slightly wider character estimate than the renderer assumes so
// they are a real bound rather than a restatement of its arithmetic.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { validateProject } from '../src/io/validate.js';
import { planProject } from '../src/plan.js';
import { labelLayout, sheetSvg } from '../src/ui/renderDiagram.js';

const WIDE_CHAR = 0.62; // wider than the renderer's own estimate, on purpose
const TALL_LINE = 1.1;

/** Every rectangle on a sheet, paired with the text actually drawn inside it. */
function drawnBlocks(svg) {
  return svg.split('<rect class="cut-rect"').slice(1).map((block) => ({
    label: block.match(/data-part="([^"]*)"/)[1],
    w: Number(block.match(/data-w="([^"]*)"/)[1]),
    h: Number(block.match(/data-h="([^"]*)"/)[1]),
    lines: [...block.matchAll(/<text[^>]*font-size="([^"]*)"[^>]*>([^<]*)<\/text>/g)]
      .map((match) => ({ size: Number(match[1]), text: match[2] })),
  }));
}

async function seedPlans() {
  const dir = new URL('../projects/', import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json') && name !== 'index.json');
  const plans = [];
  for (const file of files) {
    const checked = validateProject(JSON.parse(await readFile(new URL(file, dir), 'utf8')));
    assert.equal(checked.ok, true, `projects/${file} did not validate`);
    plans.push({ file, plan: planProject(checked.project) });
  }
  return plans;
}

test('no label on a seeded project runs outside the part it names', async () => {
  let checked = 0;
  for (const { file, plan } of await seedPlans()) {
    for (const materialPlan of plan.materials) {
      for (const sheetPlan of materialPlan.sheets) {
        for (const block of drawnBlocks(sheetSvg(sheetPlan, materialPlan, plan.params))) {
          assert.ok(block.lines.length > 0, `${file}: ${block.label} was drawn with no text`);
          for (const line of block.lines) {
            const width = line.text.length * line.size * WIDE_CHAR;
            assert.ok(
              width <= block.w,
              `${file}: "${line.text}" needs ${width.toFixed(2)} in across a ${block.w} in part`,
            );
          }
          const height = block.lines.reduce((sum, line) => sum + line.size, 0) * TALL_LINE;
          assert.ok(
            height <= block.h,
            `${file}: ${block.label} needs ${height.toFixed(2)} in down a ${block.h} in part`,
          );
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 20, 'the seeds must actually draw a lot of parts');
});

test('a small part gets smaller text than a large part on the same sheet', async () => {
  const [{ plan }] = await seedPlans();
  const sizes = plan.materials.flatMap((materialPlan) => materialPlan.sheets.flatMap((sheetPlan) => (
    drawnBlocks(sheetSvg(sheetPlan, materialPlan, plan.params))
      .map((block) => ({ area: block.w * block.h, size: block.lines[0].size }))
  )));
  assert.ok(sizes.length >= 2);

  const smallest = sizes.reduce((a, b) => (a.area <= b.area ? a : b));
  const largest = sizes.reduce((a, b) => (a.area >= b.area ? a : b));
  assert.ok(
    smallest.size < largest.size,
    'every part still shares one sheet wide font size',
  );
});

test('a roomy part keeps its name, its dimensions and the full size font', () => {
  const layout = labelLayout({
    label: 'A1',
    name: 'Full Base',
    dims: '30 in x 25 1/2 in',
    w: 30,
    h: 25.5,
    maxSize: 2.1818,
  });
  assert.deepEqual(layout.lines, ['A1 Full Base']);
  assert.equal(layout.size, 2.1818);
  assert.equal(layout.dims, '30 in x 25 1/2 in');
});

test('a narrow part wraps its name instead of running past its edge', () => {
  const layout = labelLayout({
    label: 'D1',
    name: 'Mini Beveled Fence',
    dims: '6 in x 3 1/2 in',
    w: 6,
    h: 3.5,
    maxSize: 2.1818,
  });
  assert.ok(layout.lines.length > 1, 'a 6 in part cannot hold that name on one line');
  assert.ok(layout.size < 2.1818, 'the text must shrink below the sheet wide size');
  assert.equal(layout.lines.join(' '), 'D1 Mini Beveled Fence', 'the name must survive intact');
});

test('a part with no room for its dimensions keeps the label and drops them', () => {
  const layout = labelLayout({
    label: 'C1',
    name: 'Mini Front Fence',
    dims: '3 1/2 in x 5 1/2 in',
    w: 3.5,
    h: 5.5,
    maxSize: 2.1818,
  });
  assert.equal(layout.dims, '', 'the cut list carries the dimensions in this case');
  assert.equal(layout.lines.join(' '), 'C1 Mini Front Fence');
});

test('a part too small for any of its name still carries its identifier', () => {
  const layout = labelLayout({
    label: 'E7',
    name: 'Some Very Long Part Name',
    dims: '2 in x 2 in',
    w: 2,
    h: 2,
    maxSize: 2.1818,
  });
  assert.equal(layout.lines.length, 1);
  assert.ok(layout.lines[0].startsWith('E7'), 'the identifier ties the piece to the cut list');
  assert.ok(layout.lines[0].length * layout.size * WIDE_CHAR <= 2);
});
