// "The print matches the diagram exactly" as an executable claim.
//
// The SVG side of every comparison is parsed out of the artifact the renderer
// actually emitted. Rebuilding the expected tuples from the Plan on both
// sides would only prove the Plan equals itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import { planProject } from '../src/plan.js';
import { normalizeProject } from '../src/model.js';
import { sheetSvg } from '../src/ui/renderDiagram.js';
import { cutListRows, cutListHtml } from '../src/ui/renderTable.js';
import { mixedPartsProject, shortfallProject } from './fixtures/layouts.js';

// Matches the fixed data- attribute order documented in renderDiagram.js.
const RECT_RE = /data-part="([^"]*)" data-x="([^"]*)" data-y="([^"]*)" data-w="([^"]*)" data-h="([^"]*)" data-rotated="([^"]*)"/g;

function svgTuples(plan) {
  const tuples = [];
  for (const materialPlan of plan.materials) {
    for (const sheetPlan of materialPlan.sheets) {
      const svg = sheetSvg(sheetPlan, materialPlan, plan.params);
      for (const match of svg.matchAll(RECT_RE)) {
        tuples.push([match[1], match[2], match[3], match[4], match[5], match[6]]);
      }
    }
  }
  return tuples;
}

function tableTuples(plan) {
  return cutListRows(plan)
    .filter((row) => row.kind === 'part')
    .map((row) => [row.label, row.x, row.y, row.w, row.h, String(row.rotated)]);
}

function planFor(project) {
  return planProject(project);
}

test('every rectangle drawn on a sheet appears in the printed cut list, in the same order', () => {
  const plan = planFor(mixedPartsProject());
  const fromSvg = svgTuples(plan);
  assert.ok(fromSvg.length > 0, 'the fixture must actually draw something');
  assert.deepEqual(fromSvg, tableTuples(plan));
});

test('parity holds for a shopping list sheet too', () => {
  const plan = planFor(shortfallProject());
  assert.deepEqual(svgTuples(plan), tableTuples(plan));
});

test('parity breaks if either renderer reorders its placements', () => {
  const plan = planFor(mixedPartsProject());
  const sheet = plan.materials[0].sheets[0];
  assert.ok(sheet.placements.length >= 2);

  const baseline = tableTuples(plan);
  sheet.placements.reverse();
  const reordered = svgTuples(plan);
  assert.notDeepEqual(reordered, baseline);

  sheet.placements.reverse();
  assert.deepEqual(svgTuples(plan), baseline);
});

test('every drawn rectangle carries a text label with its identifier, so print needs no color', () => {
  const plan = planFor(mixedPartsProject());
  for (const materialPlan of plan.materials) {
    for (const sheetPlan of materialPlan.sheets) {
      const svg = sheetSvg(sheetPlan, materialPlan, plan.params);
      for (const match of svg.matchAll(RECT_RE)) {
        const label = match[1];
        const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
        assert.ok(
          texts.some((text) => text.includes(label)),
          `no <text> carries the identifier ${label}`,
        );
      }
    }
  }
});

test('the viewBox is the sheet, so the diagram is to scale', () => {
  const plan = planFor(mixedPartsProject());
  const materialPlan = plan.materials[0];
  const sheetPlan = materialPlan.sheets[0];
  const svg = sheetSvg(sheetPlan, materialPlan, plan.params);
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  assert.ok(viewBox);
  const drawnRatio = Number(viewBox[1]) / Number(viewBox[2]);
  assert.ok(Math.abs(drawnRatio - sheetPlan.widthIn / sheetPlan.lengthIn) < 1e-9);
  assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(svg, /width="100%"/);
});

test('a hostile part name is escaped in the diagram and in the table alike', () => {
  const project = normalizeProject({
    name: 'XSS check',
    materials: [{ id: 'm1', name: 'Half', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [{
      id: 'p1',
      name: '<img src=x onerror=alert(1)>',
      qty: 1,
      widthIn: 20,
      lengthIn: 30,
      materialId: 'm1',
    }],
  });
  const plan = planFor(project);
  const materialPlan = plan.materials[0];
  const svg = sheetSvg(materialPlan.sheets[0], materialPlan, plan.params);
  const html = cutListHtml(cutListRows(plan));

  assert.ok(!svg.includes('<img src=x'), 'the SVG must not carry a live tag');
  assert.ok(!html.includes('<img src=x'), 'the table must not carry a live tag');

  // The diagram wraps a long name to fit the part's own rectangle, so rejoin
  // the lines it drew before looking for the escaped name.
  const drawn = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]).join(' ');
  assert.ok(drawn.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('a hostile material name and sheet label are escaped in the table header', () => {
  const project = normalizeProject({
    materials: [{
      id: 'm1',
      name: '"><script>alert(1)</script>',
      sheets: [{ widthIn: 48, lengthIn: 96, qty: 1, label: '<b>oops</b>' }],
    }],
    parts: [{ id: 'p1', name: 'Panel', qty: 1, widthIn: 10, lengthIn: 10, materialId: 'm1' }],
  });
  const html = cutListHtml(cutListRows(planFor(project)));
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<b>oops</b>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('the renderers touch no browser globals', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['src/ui/renderDiagram.js', 'src/ui/renderTable.js', 'src/ui/escape.js']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(!/\bdocument\b/.test(source), `${file} references document`);
    assert.ok(!/\bwindow\b/.test(source), `${file} references window`);
  }
});
