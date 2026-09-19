import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Pages CMS exposes Storage as a protected structured JSON file', async () => {
  const config = await readFile(new URL('../.pages.yml', import.meta.url), 'utf8');
  assert.match(config, /content:\n\s+merge: true/);
  assert.match(config, /type: file\n\s+path: projects\/storage\.json\n\s+format: json/);
  assert.match(config, /operations:\n\s+create: false\n\s+rename: false\n\s+delete: false/);
  assert.match(config, /name: materials[\s\S]*name: sheets/);
  assert.doesNotMatch(config, /name: boards/);
  assert.match(config, /name: id\n\s+label: ID\n\s+type: uuid/);
  assert.equal(config.match(/generate: false/g)?.length, 2);
});
