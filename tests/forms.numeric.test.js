import test from 'node:test';
import assert from 'node:assert/strict';
import { renderForms } from '../src/ui/renderForms.js';
import { normalizeProject } from '../src/model.js';

// The thickness measurement box only exists while that group's thickness
// control is in its custom mode -- there is one thickness control now, not a
// preset list and a spare number box side by side. So these tests render the
// group in custom mode, which is the only state in which the box is on screen
// and therefore the only state in which how it behaves matters.
const CUSTOM_THICKNESS = new Map([['m1', { sizeMode: 'custom' }]]);

function formsHtml(uiState = CUSTOM_THICKNESS) {
  return renderForms(normalizeProject({
    name: 'Sled',
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [{
      id: 'm1',
      name: '1/2 in plywood',
      thicknessIn: 0.5,
      sheets: [{ id: 'm1s1', widthIn: 48, lengthIn: 96, qty: 1 }],
    }],
    parts: [{ id: 'p1', name: 'Base', qty: 1, widthIn: 17.75, lengthIn: 30, materialId: 'm1' }],
  }), uiState);
}

/** The one <input ...> tag whose data-field is this path. */
function inputFor(html, fieldPath) {
  const match = html.match(new RegExp(`<input[^>]*data-field="${fieldPath.replace(/\./g, '\\.')}"[^>]*>`));
  assert.ok(match, `no input for ${fieldPath}`);
  return match[0];
}

const MEASUREMENT_FIELDS = [
  'params.kerfIn',
  'params.edgeTrimIn',
  'materials.0.thicknessIn',
  'materials.0.sheets.0.widthIn',
  'materials.0.sheets.0.lengthIn',
  'parts.0.widthIn',
  'parts.0.lengthIn',
];

test('no measurement field is a number input, which reports half-typed text as blank', () => {
  const html = formsHtml();
  for (const field of MEASUREMENT_FIELDS) {
    assert.ok(
      !inputFor(html, field).includes('type="number"'),
      `${field} must not be a number input`,
    );
  }
});

test('every measurement field offers a decimal keypad', () => {
  const html = formsHtml();
  for (const field of MEASUREMENT_FIELDS) {
    assert.match(inputFor(html, field), /inputmode="decimal"/, field);
  }
});

test('counts get a whole-number keypad, not a decimal one', () => {
  const html = formsHtml();
  for (const field of ['materials.0.sheets.0.qty', 'parts.0.qty']) {
    assert.match(inputFor(html, field), /inputmode="numeric"/, field);
  }
});

test('every numeric field is marked so the typed text is preserved across a redraw', () => {
  const html = formsHtml();
  for (const field of [...MEASUREMENT_FIELDS, 'materials.0.sheets.0.qty', 'parts.0.qty']) {
    assert.match(inputFor(html, field), /data-numeric="true"/, field);
  }
});

test('a fractional dimension is written into the box as entered', () => {
  assert.match(inputFor(formsHtml(), 'parts.0.widthIn'), /value="17\.75"/);
});

test('a preset thickness shows one control, with no spare measurement box beside it', () => {
  const html = formsHtml(new Map());
  assert.ok(!html.includes('data-field="materials.0.thicknessIn"'), 'two thickness inputs are shown at once');
  assert.match(html, /data-field="materials\.0\.thicknessPreset"/);
});
