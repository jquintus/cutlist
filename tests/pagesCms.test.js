import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { parseMeasurement } from '../src/units.js';

test('Pages CMS exposes Storage as a protected structured JSON file', async () => {
  const config = await readFile(new URL('../.pages.yml', import.meta.url), 'utf8');
  assert.match(config, /content:\n\s+merge: true/);
  assert.match(config, /type: file\n\s+path: projects\/storage\.json\n\s+format: json/);
  assert.match(config, /operations:\n\s+create: false\n\s+rename: false\n\s+delete: false/);
  assert.match(config, /name: materials\n\s+label: Stock\n\s+type: block\n\s+blockKey: kind/);
  assert.match(config, /name: sheet\n\s+label: Sheet goods[\s\S]*name: sheets/);
  assert.match(config, /name: board\n\s+label: Boards[\s\S]*name: boards/);
  assert.doesNotMatch(config, /name: displaySystem|name: thicknessLabel|name: color|name: params/);
  assert.match(config, /name: species\n\s+label: Species\n\s+type: reference/);
  assert.match(config, /collection: wood_species/);
  assert.match(config, /collection: stock_thicknesses/);
  assert.match(config, /collection: board_widths/);
  assert.match(config, /name: species[\s\S]*collection: wood_species\n\s+search: "label"\n\s+value: "\{fields\.label\}"/);
  assert.equal(config.match(/value: "\{fields\.label\}"/g)?.length, 4);
  assert.match(config, /summary: "\{species\}\{name\} \{thicknessIn\}\{summarySeparator\}\{widthIn\}"/);
  assert.equal(config.match(/name: summarySeparator/g)?.length, 2);
  assert.equal(config.match(/hidden: true/g)?.length, 6);
  assert.equal(config.match(/generate: false/g)?.length, 4);
  assert.equal(config.match(/step: 0\.001/g)?.length, 3);
  assert.equal(config.match(/step: 1$/gm)?.length, 2);
});

test('species references use a content field that does not collide with entry names', async () => {
  const dir = new URL('../inventory/species/', import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json'));
  for (const file of files) {
    const entry = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
    assert.equal(typeof entry.label, 'string');
    assert.ok(entry.label.length > 0);
    assert.equal(Object.hasOwn(entry, 'name'), false);
  }
});

test('inventory reference filenames sort dimensions from smallest to largest', async () => {
  for (const catalog of ['thicknesses', 'widths']) {
    const dir = new URL(`../inventory/${catalog}/`, import.meta.url);
    const files = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
    const entries = await Promise.all(files.map(async (file) => {
      const entry = JSON.parse(await readFile(new URL(file, dir), 'utf8'));
      assert.equal(file.slice(0, 2), entry.order);
      return entry;
    }));
    const dimensions = entries.map((entry) => {
      assert.equal(Object.hasOwn(entry, 'inches'), false);
      return parseMeasurement(entry.label);
    });
    assert.deepEqual(dimensions, dimensions.toSorted((left, right) => left - right));
  }
});
