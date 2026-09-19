import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject } from '../src/model.js';
import { renderForms } from '../src/ui/renderForms.js';

function boardProject() {
  return normalizeProject({
    schemaVersion: 2,
    materials: [{
      id: 'oak',
      kind: 'board',
      name: 'White oak',
      thicknessIn: 1,
      thicknessLabel: '4/4',
      widthIn: 7,
      note: 'Rift sawn',
      boards: [{ id: 'oak-8', label: 'Clear', lengthIn: 96, qty: 2 }],
    }],
    parts: [{ id: 'rail', name: 'Rail', qty: 2, widthIn: 7, lengthIn: 30, materialId: 'oak' }],
  });
}

test('board stock is entered as boards with a foot-based length', () => {
  const html = renderForms(boardProject(), new Map());
  assert.match(html, /<h3 class="sub-head">Boards on hand<\/h3>/);
  assert.match(html, /data-field="materials\.0\.boards\.0\.lengthFt" value="8"/);
  assert.match(html, /data-action="add-board"/);
  assert.match(html, /data-field="materials\.0\.note" value="Rift sawn"/);
});

test('board materials live in their own definition table with width and quarter thickness', () => {
  const html = renderForms(boardProject(), new Map());
  assert.match(html, /<h3 class="sub-head material-kind-head">Sheet goods<\/h3>/);
  assert.match(html, /<h3 class="sub-head material-kind-head">Board stock<\/h3>/);
  assert.match(html, /data-action="add-material" data-kind="sheet"/);
  assert.match(html, /data-action="add-material" data-kind="board"/);
  assert.doesNotMatch(html, /data-field="materials\.0\.kind"/);
  assert.match(html, /option value="quarter-4-4" selected>4\/4<\/option>/);
  assert.match(html, /data-field="materials\.0\.widthIn" value="7"/);
  assert.doesNotMatch(html, /data-field="materials\.0\.sheets\./);
});

test('material reorder controls address only visible peers of the same kind', () => {
  const project = normalizeProject({
    schemaVersion: 2,
    materials: [
      { id: 's1', kind: 'sheet', name: 'Sheet one' },
      { id: 'b1', kind: 'board', name: 'Board one', widthIn: 3.5 },
      { id: 's2', kind: 'sheet', name: 'Sheet two' },
      { id: 'b2', kind: 'board', name: 'Board two', widthIn: 5.5 },
    ],
    parts: [],
  });
  const buttons = [...renderForms(project, new Map()).matchAll(/<button[^>]*data-action="move-material"[^>]*>/g)]
    .map((match) => match[0]);
  const button = (material, dir) => buttons.find((tag) =>
    tag.includes(`data-material="${material}"`) && tag.includes(`data-dir="${dir}"`));

  assert.match(button(0, -1), / disabled/);
  assert.doesNotMatch(button(0, 1), / disabled/);
  assert.doesNotMatch(button(2, -1), / disabled/);
  assert.match(button(2, 1), / disabled/);
  assert.match(button(1, -1), / disabled/);
  assert.doesNotMatch(button(1, 1), / disabled/);
  assert.doesNotMatch(button(3, -1), / disabled/);
  assert.match(button(3, 1), / disabled/);
});

test('grain rotation is not offered for final-width board parts', () => {
  const html = renderForms(boardProject(), new Map());
  assert.doesNotMatch(html, /data-field="parts\.0\.grainLocked"/);
});

test('sheet stock cannot be reassigned to a board material', () => {
  const project = normalizeProject({
    schemaVersion: 2,
    materials: [
      { id: 'ply', kind: 'sheet', name: 'Plywood', sheets: [{ id: 'ply-1', widthIn: 48, lengthIn: 96, qty: 1 }] },
      { id: 'oak', kind: 'board', name: 'Oak', widthIn: 3.5, boards: [{ id: 'oak-1', lengthIn: 96, qty: 1 }] },
    ],
    parts: [],
  });
  const html = renderForms(project, new Map());
  const owner = html.match(/<select name="sheet-material"[^>]*>(.*?)<\/select>/s)?.[1] ?? '';
  assert.match(owner, />Plywood<\/option>/);
  assert.doesNotMatch(owner, />Oak<\/option>/);
});

test('actual dimensional-lumber thickness stays custom instead of being relabeled as quarters', () => {
  const project = boardProject();
  project.materials[0].thicknessIn = 1.5;
  project.materials[0].thicknessLabel = '1 1/2 in';
  const html = renderForms(project, new Map());
  assert.match(html, /option value="custom" selected>Other\.\.\.<\/option>/);
  assert.match(html, /data-field="materials\.0\.thicknessIn" value="1.5"/);
});
