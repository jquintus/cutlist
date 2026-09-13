// The diagram has to show the sequence, not just the result.
//
// A numbered dashed line per cut step, spanning the piece that step cuts; the
// leftovers named where they lie; and each part's two measurements written
// along the edges they measure. These assertions are against the real emitted
// SVG for a real seed project.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { validateProject } from '../src/io/validate.js';
import { planProject } from '../src/plan.js';
import { sheetSvg } from '../src/ui/renderDiagram.js';
import { sheetKey } from '../src/ui/renderTable.js';

async function bothPlan() {
  const text = await readFile(new URL('../projects/omnisled-both.json', import.meta.url), 'utf8');
  const checked = validateProject(JSON.parse(text));
  assert.equal(checked.ok, true);
  return planProject(checked.project);
}

async function thickGroup() {
  const plan = await bothPlan();
  const materialPlan = plan.materials.find((material) => material.name.includes('3/4 in'));
  assert.ok(materialPlan, 'no 3/4 in group');
  return { plan, materialPlan, sheetPlan: materialPlan.sheets[0] };
}

function textsOf(svg, className) {
  return [...svg.matchAll(new RegExp(`<text class="${className}"[^>]*>([^<]*)</text>`, 'g'))]
    .map((match) => match[1]);
}

test('one numbered cut line per cut step, keyed to its own sheet', async () => {
  const { plan, materialPlan, sheetPlan } = await thickGroup();
  const svg = sheetSvg(sheetPlan, materialPlan, plan.params);
  const key = sheetKey(materialPlan, sheetPlan, 0);

  const lines = [...svg.matchAll(/<line class="cut-line" data-step="(\d+)" data-sheet="([^"]*)"/g)];
  assert.equal(lines.length, sheetPlan.cuts.length);
  assert.deepEqual(
    lines.map((match) => Number(match[1])),
    sheetPlan.cuts.map((step) => step.seq),
  );
  assert.ok(lines.every((match) => match[2] === key), 'a cut line is keyed to the wrong sheet');
  assert.deepEqual(
    textsOf(svg, 'cut-step-no'),
    sheetPlan.cuts.map((step) => String(step.seq)),
  );
});

test('the first cut line spans the whole length of the sheet it halves', async () => {
  const { plan, materialPlan, sheetPlan } = await thickGroup();
  const svg = sheetSvg(sheetPlan, materialPlan, plan.params);
  const first = svg.match(/<line class="cut-line" data-step="1"[^>]*y1="([^"]*)" x2="[^"]*" y2="([^"]*)"/);
  assert.ok(first, 'no first cut line');
  assert.equal(Number(first[1]), 0);
  assert.equal(Number(first[2]), sheetPlan.lengthIn);
});

test('the big leftover is named where it lies', async () => {
  const { plan, materialPlan, sheetPlan } = await thickGroup();
  const svg = sheetSvg(sheetPlan, materialPlan, plan.params);
  assert.ok(textsOf(svg, 'scrap-label').includes('44 3/8 in x 96 in'));
});

// B1 on this sheet is 3 1/2 x 30. "3 1/2 in" will not fit across a 3 1/2 in
// edge at any legible size, and writing "30 in" down a part only 3 1/2 in wide
// puts the measurement straight through the part's own name. So this part
// carries neither, and its size is in the PARTS checklist instead.
test('a part too narrow to hold a measurement clear of its own name gets none', async () => {
  const { plan, materialPlan, sheetPlan } = await thickGroup();
  const svg = sheetSvg(sheetPlan, materialPlan, plan.params);
  const b1 = sheetPlan.placements.find((placement) => placement.label === 'B1');
  assert.ok(b1, 'no B1 on this sheet');
  assert.deepEqual([b1.w, b1.h], [3.5, 30]);

  const dims = [...svg.matchAll(/<text class="edge-dim"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  assert.ok(!dims.includes('30 in'), 'a measurement was written through the part name');
  assert.ok(!dims.includes('3 1/2 in'), 'a label was written across an edge too short to hold it');
  // Still drawn, still named, and its size is in the checklist.
  assert.ok(svg.includes('data-part="B1"'));
});

test('a 3 1/2 x 5 1/2 part takes no edge label but is still on the checklist', async () => {
  const plan = await bothPlan();
  const materialPlan = plan.materials.find((material) => material.name.includes('3/4 in'));
  const sheetPlan = materialPlan.sheets[0];
  const small = sheetPlan.placements.find((placement) =>
    Math.abs(placement.w - 3.5) < 1e-6 && Math.abs(placement.h - 5.5) < 1e-6);
  assert.ok(small, 'the fixture must contain a 3 1/2 x 5 1/2 part');

  const svg = sheetSvg(sheetPlan, materialPlan, plan.params);
  const dims = [...svg.matchAll(/<text class="edge-dim"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
  assert.ok(!dims.includes('5 1/2 in'), 'a 3 1/2 in wide part cannot carry an edge dimension');

  // It is still drawn and still labeled, which is what the checklist reads.
  assert.ok(svg.includes(`data-part="${small.label}"`));
});

test('a part carries its width across and its length down', async () => {
  const plan = await bothPlan();
  for (const materialPlan of plan.materials) {
    for (const sheetPlan of materialPlan.sheets) {
      const mini = sheetPlan.placements.find((placement) => placement.name === 'Mini Base');
      if (!mini) continue;
      const svg = sheetSvg(sheetPlan, materialPlan, plan.params);
      const dims = [...svg.matchAll(/<text class="edge-dim"([^>]*)>([^<]*)<\/text>/g)];
      const flat = dims.filter((match) => !match[1].includes('rotate')).map((match) => match[2]);
      const turned = dims.filter((match) => match[1].includes('rotate')).map((match) => match[2]);
      assert.ok(flat.includes('14 in'), 'the 14 in edge is not written across');
      assert.ok(turned.includes('12 3/4 in'), 'the 12 3/4 in edge is not written down');
      return;
    }
  }
  assert.fail('no Mini Base was laid out');
});

test('the diagram no longer writes a dimension line through the middle of a part', async () => {
  const plan = await bothPlan();
  for (const materialPlan of plan.materials) {
    for (const sheetPlan of materialPlan.sheets) {
      const svg = sheetSvg(sheetPlan, materialPlan, plan.params);
      assert.ok(!svg.includes('class="cut-dims"'), 'a centered dimension line is still drawn');
    }
  }
});

// A step number and a part name are placed by two passes that never see each
// other's output, so on a narrow strip -- where a cut line runs along a part's
// own edge and the name already fills the rectangle -- they used to land within
// a twentieth of an inch of each other and print as one garbled glyph. The
// number is what a person is looking for at the saw, so it keeps its place and
// the name is laid out around it. Measured with a wider character estimate than
// the renderer's own, so this is a real bound rather than a restatement of it.
test('no cut step number is stamped over a part name on any seed', async () => {
  const WIDE_CHAR = 0.62;
  const dir = new URL('../projects/', import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json') && name !== 'index.json');

  const boxesOf = (svg, className) =>
    [...svg.matchAll(new RegExp(
      `<text class="${className}"[^>]*x="([-\\d.]+)" y="([-\\d.]+)" font-size="([\\d.]+)"[^>]*>([^<]*)</text>`,
      'g',
    ))].map(([, x, y, size, text]) => {
      const width = text.length * Number(size) * WIDE_CHAR;
      return {
        text,
        left: Number(x) - width / 2,
        right: Number(x) + width / 2,
        top: Number(y) - 0.8 * Number(size),
        bottom: Number(y) + 0.2 * Number(size),
      };
    });

  let compared = 0;
  for (const file of files) {
    const checked = validateProject(JSON.parse(await readFile(new URL(file, dir), 'utf8')));
    assert.equal(checked.ok, true, `projects/${file} did not validate`);
    const plan = planProject(checked.project);
    for (const materialPlan of plan.materials) {
      for (const sheetPlan of materialPlan.sheets) {
        const svg = sheetSvg(sheetPlan, materialPlan, plan.params);
        const numbers = boxesOf(svg, 'cut-step-no');
        assert.equal(numbers.length, sheetPlan.cuts.length);
        for (const number of numbers) {
          for (const label of boxesOf(svg, 'cut-label')) {
            compared += 1;
            assert.ok(
              number.left >= label.right || label.left >= number.right
                || number.top >= label.bottom || label.top >= number.bottom,
              `${file}: step ${number.text} is written over "${label.text}"`,
            );
          }
        }
      }
    }
  }
  assert.ok(compared > 100, 'the seeds must really put numbers and names on the same sheets');
});
