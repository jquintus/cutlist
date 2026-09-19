import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject } from '../src/model.js';
import { renderForms } from '../src/ui/renderForms.js';

const project = normalizeProject({
  materials: [
    { id: 'ply', name: 'Plywood', thicknessIn: 0.75, sheets: [{ id: 'sheet', widthIn: 48, lengthIn: 96, qty: 1 }] },
    { id: 'oak', kind: 'board', name: 'Oak', thicknessIn: 1, thicknessLabel: '4/4', widthIn: 3.5, boards: [{ id: 'board', lengthIn: 96, qty: 2 }] },
  ],
  parts: [{ id: 'part', name: 'Panel', qty: 2, widthIn: 12, lengthIn: 24, materialId: 'ply' }],
});

const ids = ['ply', 'sheet', 'oak', 'board', 'part'];

function row(html, id) {
  const match = html.match(new RegExp(`<tr[^>]*data-row-id="${id}"[^>]*>[\\s\\S]*?</tr>`));
  assert.ok(match, `no row for ${id}`);
  return match[0];
}

test('every material, stock, and part row starts in readable view mode', () => {
  const html = renderForms(project, new Map());
  for (const id of ids) {
    const rendered = row(html, id);
    assert.match(rendered, /class="row-display"/);
    assert.match(rendered, /data-action="edit-row"/);
    assert.doesNotMatch(rendered, /data-action="finish-row-edit"/);
  }
  assert.match(row(html, 'part'), /data-field="parts\.0\.grainLocked"/);
  assert.doesNotMatch(html, /data-field="parts\.0\.name"/);
});

test('editing preserves each table shape and exposes the row fields', () => {
  const view = renderForms(project, new Map());
  const editState = new Map(ids.map((id) => [id, { editing: true }]));
  const edit = renderForms(project, editState);

  for (const id of ids) {
    const viewCells = [...row(view, id).matchAll(/<td\b/g)].length;
    const editCells = [...row(edit, id).matchAll(/<td\b/g)].length;
    assert.equal(editCells, viewCells, `${id} changes column count while editing`);
    assert.match(row(edit, id), /class="row-edit"/);
    assert.match(row(edit, id), /data-action="finish-row-edit"/);
  }

  for (const field of [
    'materials.0.name',
    'materials.0.sheets.0.widthIn',
    'materials.1.widthIn',
    'materials.1.boards.0.lengthFt',
    'parts.0.name',
  ]) assert.match(edit, new RegExp(`data-field="${field.replaceAll('.', '\\.')}"`));
});

test('each editable table declares one stable column for every row cell', () => {
  const html = renderForms(project, new Map());
  for (const [tableClass, count] of [
    ['sheet-material-table', 5],
    ['sheet-stock-table', 8],
    ['board-material-table', 6],
    ['board-stock-table', 6],
    ['parts-table', 8],
  ]) {
    const table = html.match(new RegExp(`<table[^>]*${tableClass}[^>]*>[\\s\\S]*?</table>`))?.[0];
    assert.ok(table, `no ${tableClass}`);
    const colgroup = table.match(/<colgroup>([\s\S]*?)<\/colgroup>/)?.[1] ?? '';
    assert.equal([...colgroup.matchAll(/<col\b/g)].length, count, `${tableClass} column model`);
  }
});

test('each material kind contains its definition and inventory tables in one block', () => {
  const html = renderForms(project, new Map());
  const groups = [...html.matchAll(/<section class="material-stock-group"[\s\S]*?<\/section>/g)].map((match) => match[0]);
  assert.equal(groups.length, 2);
  assert.match(groups[0], /Sheet goods[\s\S]*sheet-material-table[\s\S]*Sheets on hand[\s\S]*sheet-stock-table/);
  assert.match(groups[1], /Board stock[\s\S]*board-material-table[\s\S]*Boards on hand[\s\S]*board-stock-table/);
});
