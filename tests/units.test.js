import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toInches,
  formatLength,
  customThickness,
  customSheet,
  THICKNESS_PRESETS,
  SHEET_PRESETS,
} from '../src/units.js';

test('toInches converts millimeters and passes inches through', () => {
  assert.equal(toInches(6, 'mm').toFixed(4), '0.2362');
  assert.equal(toInches(0.5, 'in'), 0.5);
});

test('toInches coerces numeric strings from form fields', () => {
  assert.equal(toInches('12.5', 'in'), 12.5);
});

test('toInches throws on an unknown unit instead of guessing', () => {
  assert.throws(() => toInches(1, 'cubits'), RangeError);
  assert.throws(() => toInches('not a number', 'in'), TypeError);
});

test('formatLength renders imperial as a reduced mixed fraction', () => {
  assert.equal(formatLength(22.75), '22 3/4 in');
  assert.equal(formatLength(48), '48 in');
  assert.equal(formatLength(0.125), '1/8 in');
  assert.equal(formatLength(0.0625), '1/16 in');
  assert.equal(formatLength(-1.5), '-1 1/2 in');
});

test('formatLength rounds imperial to the nearest sixteenth', () => {
  assert.equal(formatLength(6 / 25.4), '1/4 in');
});

test('formatLength renders metric to one decimal millimeter', () => {
  assert.equal(formatLength(6 / 25.4, 'metric'), '6.0 mm');
});

test('thickness presets cover 1/8 in through 1 in plus the metric sheet sizes', () => {
  const labels = THICKNESS_PRESETS.map((preset) => preset.label);
  assert.equal(labels.length, 16);
  assert.ok(labels.includes('1/8 in'));
  assert.ok(labels.includes('1 in'));
  assert.ok(labels.includes('6 mm'));
  assert.ok(labels.includes('25 mm'));
});

test('sheet presets include the four stock sizes', () => {
  const ids = SHEET_PRESETS.map((preset) => preset.id);
  assert.deepEqual(ids, ['48x96', '48x48', '24x48', '60x60']);
});

test('a custom value is preset shaped, not a separate code path', () => {
  const thickness = customThickness(18, 'mm');
  assert.equal(thickness.system, 'metric');
  assert.equal(thickness.label, '18.0 mm');
  assert.ok(Object.hasOwn(thickness, 'inches'));

  const sheet = customSheet(30, 62.5, 'in');
  assert.equal(sheet.widthIn, 30);
  assert.equal(sheet.lengthIn, 62.5);
  assert.ok(Object.hasOwn(sheet, 'label'));
});
