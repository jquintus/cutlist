import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Pages CMS exposes Storage as a protected structured JSON file', async () => {
  const config = await readFile(new URL('../.pages.yml', import.meta.url), 'utf8');
  assert.match(config, /content:\n\s+merge: true/);
  assert.match(config, /type: file\n\s+path: projects\/storage\.json\n\s+format: json/);
  assert.match(config, /operations:\n\s+create: false\n\s+rename: false\n\s+delete: false/);
  assert.match(config, /name: materials\n\s+label: Stock\n\s+type: block\n\s+blockKey: kind/);
  assert.match(config, /name: sheet\n\s+label: Sheet goods[\s\S]*name: sheets/);
  assert.match(config, /name: board\n\s+label: Boards[\s\S]*name: boards/);
  assert.doesNotMatch(config, /name: displaySystem|name: thicknessLabel|name: color|name: params/);
  assert.equal(config.match(/hidden: true/g)?.length, 4);
  assert.equal(config.match(/generate: false/g)?.length, 4);
  assert.equal(config.match(/step: 0\.001/g)?.length, 6);
  assert.equal(config.match(/step: 1$/gm)?.length, 2);
});
