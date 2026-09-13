// The preset controls have to honor what was chosen, not what the numbers
// imply.
//
// The bug these pin: the sheet-size dropdown used to recompute its own mode
// from widthIn and lengthIn on every render, so choosing "Custom or offcut"
// on a sheet that still measured 48 x 96 re-derived the 48 x 96 preset and the
// click had no visible effect at all. The mode is now stored by app.js and
// passed in, and these assertions are about it being obeyed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderForms } from '../src/ui/renderForms.js';
import { normalizeProject } from '../src/model.js';

function project() {
  return normalizeProject({
    name: 'Presets',
    materials: [{
      id: 'm1',
      name: 'Ply',
      thicknessIn: 0.75,
      sheets: [{ id: 'm1s1', widthIn: 48, lengthIn: 96, qty: 1 }],
    }],
    parts: [{ id: 'p1', name: 'Panel', qty: 1, widthIn: 12, lengthIn: 12, materialId: 'm1' }],
  });
}

/** The option tags of the one select whose data-field is this path. */
function optionsOf(html, fieldPath) {
  const select = html.match(new RegExp(`<select[^>]*data-field="${fieldPath.replace(/\./g, '\\.')}"[\\s\\S]*?</select>`));
  assert.ok(select, `no select for ${fieldPath}`);
  return [...select[0].matchAll(/<option value="([^"]*)"( selected)?>([^<]*)<\/option>/g)]
    .map((match) => ({ value: match[1], selected: match[2] !== undefined, label: match[3] }));
}

function selectedOf(html, fieldPath) {
  return optionsOf(html, fieldPath).find((option) => option.selected) ?? null;
}

test('custom stays custom even when the dimensions still match a preset', () => {
  const html = renderForms(project(), new Map([['m1s1', { sizeMode: 'custom' }]]));
  assert.equal(selectedOf(html, 'materials.0.sheets.0.preset').value, 'custom');
});

test('with no stored mode the control falls back to what the numbers imply', () => {
  const html = renderForms(project(), new Map());
  assert.equal(selectedOf(html, 'materials.0.sheets.0.preset').value, '48x96');
});

test('choosing a preset again selects that preset', () => {
  const html = renderForms(project(), new Map([['m1s1', { sizeMode: 'preset' }]]));
  assert.equal(selectedOf(html, 'materials.0.sheets.0.preset').value, '48x96');
});

test('a mode is keyed to its own sheet and does not touch a sibling', () => {
  const twoSheets = normalizeProject({
    materials: [{
      id: 'm1',
      name: 'Ply',
      sheets: [
        { id: 'm1s1', widthIn: 48, lengthIn: 96, qty: 1 },
        { id: 'm1sX', widthIn: 48, lengthIn: 96, qty: 1 },
      ],
    }],
    parts: [],
  });
  const html = renderForms(twoSheets, new Map([['m1sX', { sizeMode: 'custom' }]]));
  assert.equal(selectedOf(html, 'materials.0.sheets.0.preset').value, '48x96');
  assert.equal(selectedOf(html, 'materials.0.sheets.1.preset').value, 'custom');
});

test('the thickness control is one control: Other reveals the measurement box', () => {
  const preset = renderForms(project(), new Map());
  assert.equal(selectedOf(preset, 'materials.0.thicknessPreset').label, '3/4 in');
  assert.ok(!preset.includes('data-field="materials.0.thicknessIn"'));

  const custom = renderForms(project(), new Map([['m1', { sizeMode: 'custom' }]]));
  assert.equal(selectedOf(custom, 'materials.0.thicknessPreset').value, 'custom');
  assert.ok(custom.includes('data-field="materials.0.thicknessIn"'));
});

test('the sheets of a group are nested inside their own labeled box', () => {
  const html = renderForms(project(), new Map());
  // The sheets live in the group's own box behind a left rule, with their own
  // heading, so the nesting is something you can see.
  assert.match(html, /<div class="group-sheets">\s*<h3>Sheets<\/h3>/);
});

test('a destructive button says what it will destroy', () => {
  const html = renderForms(project(), new Map());
  assert.ok(html.includes('title="Remove this 48 x 96 sheet"'));
  assert.ok(html.includes('and every sheet size in it'), 'the group control does not say it takes the sheets too');
});

test('a hostile group name cannot break out of a destructive label', () => {
  const hostile = normalizeProject({
    materials: [{ id: 'm1', name: '"><script>alert(1)</script>', sheets: [{ id: 'm1s1', widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [],
  });
  const html = renderForms(hostile, new Map());
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

// A part that belongs to no group is a state the app can be walked into: add a
// part before the first group, or delete a group out from under its parts. The
// project will not save in that state, so the form has to make it fixable.
test('a part in no material group says so instead of showing the first group', () => {
  const orphaned = normalizeProject({
    ...project(),
    parts: [{ id: 'p1', name: 'Panel', qty: 1, widthIn: 12, lengthIn: 12, materialId: '' }],
  });
  const options = optionsOf(renderForms(orphaned), 'parts.0.materialId');
  assert.deepEqual(options[0], { value: '', selected: true, label: 'Pick a material' });
  assert.ok(options.some((entry) => entry.value === 'm1' && !entry.selected), 'the real group is still pickable');
});

test('a part already in a group is offered only the real groups', () => {
  const options = optionsOf(renderForms(project()), 'parts.0.materialId');
  assert.deepEqual(options.map((entry) => entry.value), ['m1']);
  assert.equal(options[0].selected, true);
});
