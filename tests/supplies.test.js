import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPdf } from '../src/export/pdf.js';
import { validateProject } from '../src/io/validate.js';
import { newProject, normalizeProject } from '../src/model.js';
import { planProject } from '../src/plan.js';
import { decodeHash, encodeProject } from '../src/share/codec.js';
import { renderForms } from '../src/ui/renderForms.js';
import { renderResults } from '../src/ui/renderResults.js';

function supplyProject(extra = {}) {
  return normalizeProject({
    ...newProject(),
    name: 'Supplies',
    supplies: [{
      id: 'screws',
      name: 'Pocket screws',
      qty: '8',
      packQty: '3',
      onHand: false,
      price: '$12.99',
      note: '1 1/4 in',
      url: 'https://example.com/screws',
    }],
    ...extra,
  });
}

test('supplies normalize with stable ids and blank optional fields', () => {
  const project = normalizeProject({ supplies: [{ name: 'Glue', qty: '2' }] });
  assert.deepEqual(project.supplies, [{
    id: 's1', name: 'Glue', qty: 2, packQty: 1, onHand: false, price: '', note: '', url: '',
  }]);
  assert.deepEqual(newProject().supplies, []);
});

test('generated supply ids do not collide with explicit ids', () => {
  const project = normalizeProject({ supplies: [{ id: 's2' }, {}] });
  assert.deepEqual(project.supplies.map((supply) => supply.id), ['s2', 's1']);
});

test('supply validation rejects unsafe links and duplicate ids', () => {
  const unsafe = validateProject({
    ...newProject(),
    supplies: [{ id: 's1', name: 'Glue', qty: 1, url: 'javascript:alert(1)' }],
  });
  assert.equal(unsafe.field, 'supplies');

  const duplicate = validateProject({
    ...newProject(),
    supplies: [
      { id: 's1', name: 'Glue', qty: 1 },
      { id: 's1', name: 'Finish', qty: 1 },
    ],
  });
  assert.equal(duplicate.field, 'supplies');
});

test('supply quantities must be positive whole numbers', () => {
  for (const supply of [{ qty: 1.5 }, { packQty: 2.5 }, { qty: 0 }, { packQty: -1 }]) {
    const checked = validateProject({ ...newProject(), supplies: [supply] });
    assert.equal(checked.field, 'supplies');
  }
});

test('every supply field is optional', () => {
  const checked = validateProject({ ...newProject(), supplies: [{}] });
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.project.supplies[0], {
    id: 's1', name: '', qty: 1, packQty: 1, onHand: false, price: '', note: '', url: '',
  });
  const plan = planProject(checked.project);
  assert.match(renderResults(plan), /Unnamed/);
  assert.match(new TextDecoder().decode(buildPdf(plan)), /Unnamed/);
});

test('supplies join sheet shortfalls without reaching the packer', () => {
  const project = supplyProject({
    materials: [{
      id: 'm1', name: 'Plywood', thicknessLabel: '3/4 in',
      sheets: [{ id: 'm1s1', widthIn: 48, lengthIn: 96, qty: 0 }],
    }],
    parts: [{ id: 'p1', name: 'Top', qty: 1, widthIn: 20, lengthIn: 30, materialId: 'm1' }],
  });
  const plan = planProject(project);
  assert.equal(plan.shoppingList.length, 2);
  assert.equal(plan.shoppingList[0].materialId, 'm1');
  assert.deepEqual(plan.shoppingList[1], { kind: 'supply', ...project.supplies[0], buyQty: 3 });
  assert.ok(plan.materials.every((material) => material.parts.every((part) => part.name !== 'Pocket screws')));
});

test('the form renders supplies as one grid with all editable fields', () => {
  const html = renderForms(supplyProject(), new Map([['screws', { editing: true }]]), null, { supplies: true });
  assert.match(html, /data-panel="supplies" open/);
  for (const field of ['name', 'qty', 'packQty', 'onHand', 'price', 'note', 'url']) {
    assert.ok(html.includes(`data-field="supplies.0.${field}"`));
  }
  assert.match(html, /data-action="remove-supply"/);
  assert.match(html, /data-action="add-supply"/);
  assert.match(html, /data-action="finish-supply-edit"/);
  assert.match(html, /data-action="move-supply"/);
  for (const field of ['qty', 'packQty']) {
    const input = html.match(new RegExp(`<input[^>]*data-field="supplies\\.0\\.${field}"[^>]*>`))?.[0];
    assert.match(input, /type="text"/);
    assert.match(input, /inputmode="numeric"/);
    assert.match(input, /data-numeric="true"/);
  }
});

test('the normal supply row is a checklist row with a compact domain link', () => {
  const html = renderForms(supplyProject(), new Map(), null, { supplies: true });
  assert.ok(html.indexOf('type="checkbox"') < html.indexOf('Pocket screws'));
  assert.match(html, />example\.com<\/a>/);
  assert.ok(!html.includes('>https://example.com/screws</a>'));
  assert.match(html, /data-action="edit-supply"/);
  assert.match(html, /class="supply-name supply-editable"[^>]+data-action="edit-supply"/);
  assert.doesNotMatch(html, />Have<\/th>/);
  assert.doesNotMatch(html, />Unit<\/div>/);
});

test('a price renders with one dollar sign', () => {
  const withoutSign = supplyProject();
  withoutSign.supplies[0].price = '12.99';
  assert.match(renderForms(withoutSign, new Map()), />\$12\.99<\/div>/);
  assert.match(renderForms(supplyProject(), new Map()), />\$12\.99<\/div>/);
});

test('main and standalone shopping views share stable tick ids and purchase links', () => {
  const plan = planProject(supplyProject());
  const ticked = new Set(['buy:supply:screws']);
  const main = renderResults(plan, { ticked, baseHash: '#project' });
  const standalone = renderResults(plan, { ticked, baseHash: '#project', focusView: 'shopping' });

  for (const html of [main, standalone]) {
    assert.match(html, /data-tick="buy:supply:screws" checked/);
    assert.match(html, /href="https:\/\/example\.com\/screws"/);
    assert.match(html, /3 &times; <a[^>]+>Pocket screws<\/a>/);
    assert.match(html, /8 needed/);
    assert.match(html, /3 per item/);
    assert.match(html, /1 1\/4 in/);
    assert.doesNotMatch(html, /\$12\.99/);
    assert.doesNotMatch(html, /package/);
    assert.doesNotMatch(html, /—/);
  }
});

test('a supply-only project survives a share link and appears in the PDF', () => {
  const project = supplyProject();
  const restored = decodeHash(`#${encodeProject(project)}`);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.project.supplies, project.supplies);

  const pdf = new TextDecoder().decode(buildPdf(planProject(project)));
  assert.match(pdf, /3 x Pocket screws/);
  assert.match(pdf, /8 needed; 3 per item; 1 1\/4 in/);
  assert.doesNotMatch(pdf, /\$12\.99/);
  assert.doesNotMatch(pdf, /package/);
  assert.match(pdf, /https:\/\/example\.com\/screws/);
});

test('purchase quantity rounds the needed amount up by the pack size', () => {
  const project = normalizeProject({
    supplies: [{ name: 'Flanges', qty: 6, packQty: 3 }],
  });
  assert.equal(planProject(project).shoppingList[0].buyQty, 2);

  project.supplies[0].qty = 7;
  assert.equal(planProject(project).shoppingList[0].buyQty, 3);
});

test('supplies already on hand stay out of every shopping view', () => {
  const project = supplyProject();
  project.supplies[0].onHand = true;
  const plan = planProject(project);
  assert.deepEqual(plan.shoppingList, []);
  assert.ok(!renderResults(plan).includes('Pocket screws'));
  assert.ok(!new TextDecoder().decode(buildPdf(plan)).includes('Pocket screws'));
});

test('an unsafe normalized URL is never emitted as a link', () => {
  const project = supplyProject();
  project.supplies[0].url = 'javascript:alert(1)';
  const html = renderResults(planProject(project));
  assert.ok(!html.includes('href="javascript:'));
  assert.match(html, /Pocket screws/);
});
