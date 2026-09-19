import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { directUpload, slugify, projectJson, urlBodyJson } from '../src/share/upload.js';
import { validateProject } from '../src/io/validate.js';
import { MAX_UPLOAD_URL_LEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH } from '../src/config.js';
import { newProject } from '../src/model.js';

function smallProject() {
  const project = newProject();
  project.name = 'OmniSled Both';
  project.date = '2026-09-12';
  project.materials = [{ id: 'm1', name: 'Half', thicknessIn: 0.5, sheets: [{ id: 'm1s1', widthIn: 48, lengthIn: 96, qty: 1 }] }];
  project.parts = [{ id: 'p1', name: 'Base', qty: 1, widthIn: 24, lengthIn: 36, materialId: 'm1', grainLocked: false }];
  return project;
}

test('slugify makes a file safe name and falls back when there is nothing left', () => {
  assert.equal(slugify('OmniSled Full Size'), 'omnisled-full-size');
  assert.equal(slugify('  ..Mini!! Sled  '), 'mini-sled');
  assert.equal(slugify('!!!'), 'project');
  assert.equal(slugify(''), 'project');
  assert.equal(slugify(undefined), 'project');
});

test('a small project gets a prefilled commit URL pointed at the project folder', () => {
  const result = directUpload(smallProject());
  assert.equal(result.kind, 'url');
  assert.equal(result.filename, 'omnisled-both.json');
  assert.ok(result.url.startsWith(`https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/new/${GITHUB_BRANCH}?filename=projects/`));
  assert.ok(result.url.includes('omnisled-both.json'));
  assert.ok(result.url.includes('&value='));
  assert.ok(result.url.length <= MAX_UPLOAD_URL_LEN, 'this fixture must stay under the real limit');
});

test('a project too large for a URL falls back to a plain download', () => {
  const project = smallProject();
  // Enough real parts to push the encoded body past the real threshold.
  project.parts = Array.from({ length: 200 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Panel number ${i + 1}`,
    qty: 2,
    widthIn: 12.5,
    lengthIn: 18.25,
    materialId: 'm1',
    grainLocked: false,
  }));

  const result = directUpload(project);
  assert.equal(result.kind, 'download');
  assert.equal(result.filename, 'omnisled-both.json');
  assert.equal(result.json, projectJson(project));

  // The two branches really do straddle the configured limit.
  const wouldBeUrlLength = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/new/${GITHUB_BRANCH}`
    .concat(`?filename=projects/${encodeURIComponent(result.filename)}`)
    .concat(`&value=${encodeURIComponent(urlBodyJson(project))}`).length;
  assert.ok(wouldBeUrlLength > MAX_UPLOAD_URL_LEN);
});

test('the downloaded body is pretty printed and the prefilled body is the same project', () => {
  const project = smallProject();
  const json = projectJson(project);
  assert.equal(json, `${JSON.stringify(project, null, 2)}\n`);
  assert.ok(json.endsWith('\n'));

  // The URL body is compact so real projects fit, but it has to describe the
  // same project the download would have written.
  const result = directUpload(project);
  const sent = decodeURIComponent(result.url.split('&value=')[1]);
  assert.deepEqual(JSON.parse(sent), JSON.parse(json));
  assert.ok(sent.length < json.length);
});

test('direct upload stamps the same date and schema version a manual export would', () => {
  const fixed = () => new Date('2026-09-12T17:31:00Z');
  const project = smallProject();
  project.date = '';
  project.schemaVersion = 0;

  const result = directUpload(project, { now: fixed });
  const sent = JSON.parse(decodeURIComponent(result.url.split('&value=')[1]));

  assert.equal(sent.date, '2026-09-12');
  assert.equal(sent.schemaVersion, 1);
});

test("direct upload keeps a project's own date rather than overwriting it", () => {
  const project = smallProject();
  project.date = '2020-01-01';

  const result = directUpload(project);
  const sent = JSON.parse(decodeURIComponent(result.url.split('&value=')[1]));

  assert.equal(sent.date, '2020-01-01');
});

test('every seeded project survives its direct-upload path', async () => {
  const dir = new URL('../projects/', import.meta.url);
  const files = (await readdir(dir)).filter((name) => name.endsWith('.json') && name !== 'index.json');
  assert.ok(files.length >= 3, 'the seed projects must actually be there');

  for (const file of files) {
    const checked = validateProject(JSON.parse(await readFile(new URL(file, dir), 'utf8')));
    assert.equal(checked.ok, true, `projects/${file} did not validate`);

    const result = directUpload(checked.project);
    const saved = result.kind === 'url'
      ? JSON.parse(decodeURIComponent(result.url.split('&value=')[1]))
      : JSON.parse(result.json);
    assert.deepEqual(saved, checked.project);
    if (result.kind === 'url') {
      assert.ok(result.url.length <= MAX_UPLOAD_URL_LEN);
    } else {
      assert.ok(result.json.endsWith('\n'));
    }
  }
});
