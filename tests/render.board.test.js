import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPdf } from '../src/export/pdf.js';
import { normalizeProject } from '../src/model.js';
import { planProject } from '../src/plan.js';
import { boardSvg } from '../src/ui/renderBoardDiagram.js';
import { renderResults } from '../src/ui/renderResults.js';
import { boardKey, boardRows, cutListRows } from '../src/ui/renderTable.js';

function boardPlan() {
  const board = {
    boardSpecId: 'oak-8',
    label: 'Oak 1',
    source: 'on-hand',
    widthIn: 3.5,
    lengthIn: 96,
    usable: { startIn: 0, lengthIn: 96 },
    placements: [
      { startIn: 0, lengthIn: 30, label: 'A1', name: 'Long rail', partId: 'a' },
      { startIn: 30.125, lengthIn: 20, label: 'B1', name: 'Short rail', partId: 'b' },
    ],
    cuts: [
      { seq: 1, atIn: 30, lineIn: 30, referenceEdge: 'left' },
      { seq: 2, atIn: 20, lineIn: 50.125, referenceEdge: 'left' },
    ],
    offcuts: [{ startIn: 50.125, lengthIn: 45.875 }],
    wasteLengthIn: 0.25,
  };
  const material = {
    kind: 'board',
    materialId: 'oak',
    name: 'White oak',
    note: 'Use straight grain.',
    thicknessLabel: '4/4',
    boards: [board],
    onHandBoardCount: 1,
    extraBoardsNeeded: 0,
    buySpec: { widthIn: 3.5, lengthIn: 96 },
  };
  return { board, material };
}

function plan(extra = {}) {
  const { material } = boardPlan();
  return {
    projectName: 'Board test',
    notes: '',
    warnings: [],
    displaySystem: 'imperial',
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [material],
    shoppingList: [],
    ...extra,
  };
}

test('a board-only plan renders its diagram, crosscuts, parts, and leftover', () => {
  const result = renderResults(plan());
  assert.match(result, /class="sheet board"/);
  assert.match(result, /30 in/);
  assert.match(result, /20 in/);
  assert.match(result, /PARTS OFF THIS BOARD/);
  assert.match(result, /Use straight grain\./);
  assert.match(result, /Leftover from this board: 45 7\/8 in/);
  assert.doesNotMatch(result, /Add a material group/);
  assert.doesNotMatch(result, /edge trim/);
});

test('board diagram and rows expose the same placements in the same order', () => {
  const { board, material } = boardPlan();
  const svg = boardSvg(board, material, 'imperial', 0);
  const drawn = [...svg.matchAll(/data-part="([^"]*)" data-start="([^"]*)" data-length="([^"]*)"/g)]
    .map((match) => match.slice(1));
  const rows = boardRows(board, material, 'imperial', 0)
    .filter((row) => row.kind === 'part')
    .map((row) => [row.label, row.start, row.length]);
  assert.deepEqual(drawn, rows);
  assert.equal(cutListRows(plan()).filter((row) => row.kind === 'board').length, 1);
});

test('later cuts are drawn at their absolute line but labeled with the local saw measurement', () => {
  const project = normalizeProject({
    materials: [{
      id: 'oak', kind: 'board', name: 'White oak', widthIn: 3.5,
      boards: [{ id: 'oak-8', label: '8 ft', lengthIn: 96, qty: 1 }],
    }],
    parts: [
      { id: 'a', name: 'Long rail', qty: 1, widthIn: 3.5, lengthIn: 30, materialId: 'oak' },
      { id: 'b', name: 'Short rail', qty: 1, widthIn: 3.5, lengthIn: 20, materialId: 'oak' },
    ],
  });
  const material = planProject(project).materials[0];
  const board = material.boards[0];
  assert.equal(board.cuts[1].atIn, 20);
  assert.equal(board.cuts[1].lineIn, 50.125);

  const svg = boardSvg(board, material, 'imperial', 0);
  const second = svg.match(/data-step="2"[^>]*x1="([^"]+)"/);
  assert.equal(Number(second?.[1]), 50.125);
  assert.match(svg, />20 in<\/text>/);
});

test('a focused board uses the existing stock URL and navigation machinery', () => {
  const { board, material } = boardPlan();
  const key = boardKey(material, board, 0);
  const result = renderResults(plan(), { focusSheet: key, baseHash: '#project' });
  assert.match(result, /&larr; All stock/);
  assert.match(result, /1 of 1/);
  assert.match(result, /Oak 1/);
  assert.doesNotMatch(result, /Shopping list/);
});

test('board shortfalls join the consolidated shopping list in HTML and PDF', () => {
  const shoppingList = [{
    kind: 'board', materialId: 'oak', name: 'White oak', thicknessLabel: '4/4',
    qty: 2, widthIn: 7, lengthIn: 96, label: '8 ft',
  }];
  const withShopping = plan({ shoppingList });
  const html = renderResults(withShopping);
  assert.match(html, /2 boards of White oak \(4\/4\), 7 in wide x 96 in long/);
  assert.doesNotMatch(html, /sheets of White oak/);
  assert.doesNotMatch(html, /banner-buy/, 'the material section must not repeat the consolidated shopping list');

  const pdf = new TextDecoder().decode(buildPdf(withShopping));
  assert.match(pdf, /2 boards of White oak \\\(4\/4\\\), 7 in wide x 96 in long/);
  assert.match(pdf, /Oak 1 \\\(board on hand\\\)/);
  assert.match(pdf, /Use straight grain\./);
});
