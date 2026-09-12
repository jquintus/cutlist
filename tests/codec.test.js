import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeProject, decodeHash, HASH_PREFIX } from '../src/share/codec.js';
import { validateProject } from '../src/io/validate.js';
import { MAX_HASH_B64 } from '../src/config.js';
import { SCHEMA_VERSION } from '../src/model.js';

/** Shaped like the combined OmniSled seed: several groups, a shortfall, unplanned stock. */
function seedShapedProject() {
  return validateProject({
    schemaVersion: SCHEMA_VERSION,
    name: 'OmniSled shaped fixture',
    date: '2026-09-12',
    notes: 'Cut the 6 mm parts from the 1/4 in sheet.',
    displaySystem: 'imperial',
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [
      { id: 'm1', name: '1/2 in plywood', thicknessIn: 0.5, thicknessLabel: '1/2 in', note: '', color: '#2f6f9f', sheets: [{ id: 'm1s1', label: '48 x 96', widthIn: 48, lengthIn: 96, qty: 1, note: '' }] },
      { id: 'm2', name: '1/4 in plywood', thicknessIn: 0.25, thicknessLabel: '1/4 in', note: '6 mm parts cut from 1/4 in.', color: '#b1591f', sheets: [{ id: 'm2s1', label: '48 x 96', widthIn: 48, lengthIn: 96, qty: 1, note: '' }] },
      { id: 'm3', name: '3/4 in plywood', thicknessIn: 0.75, thicknessLabel: '3/4 in', note: 'None on hand.', color: '#3f7f4f', sheets: [{ id: 'm3s1', label: '48 x 96 (to buy)', widthIn: 48, lengthIn: 96, qty: 0, note: '' }] },
    ],
    parts: [
      { id: 'p1', name: 'Full Base', qty: 1, widthIn: 24, lengthIn: 36, materialId: 'm1', grainLocked: true },
      { id: 'p2', name: 'Full Base Riser', qty: 1, widthIn: 24, lengthIn: 36, materialId: 'm2', grainLocked: false },
      { id: 'p3', name: 'Full Front Fence', qty: 1, widthIn: 4, lengthIn: 36, materialId: 'm3', grainLocked: false },
    ],
    unplanned: [{ name: 'Full Miter Bar', qty: 2, note: 'Hardwood, deferred to round 2.' }],
  }).project;
}

test('a seed shaped project survives the share link round trip exactly', () => {
  const project = seedShapedProject();
  const hash = encodeProject(project);
  assert.ok(hash.startsWith(HASH_PREFIX));

  const restored = decodeHash(hash);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.project, project);
});

test('a leading hash character is tolerated, because that is what location.hash gives you', () => {
  const project = seedShapedProject();
  const restored = decodeHash(`#${encodeProject(project)}`);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.project, project);
});

test('a truncated link is refused with its own message and does not throw', () => {
  const hash = encodeProject(seedShapedProject());
  const result = decodeHash(hash.slice(0, hash.length - 12));
  assert.equal(result.ok, false);
  assert.ok(result.error.length > 0);
});

test('a link without the format marker is refused with its own message', () => {
  const result = decodeHash('#gzip:aaaa');
  assert.equal(result.ok, false);
  assert.match(result.error, /does not carry a cutlist project/);
});

test('random base64 behind the marker is refused with its own message', () => {
  const result = decodeHash(`#${HASH_PREFIX}bm90IGRlZmxhdGVkIGF0IGFsbA`);
  assert.equal(result.ok, false);
  assert.match(result.error, /decompressed|JSON|data/);
});

test('an empty fragment is refused', () => {
  assert.equal(decodeHash('').ok, false);
  assert.equal(decodeHash('#').ok, false);
  assert.equal(decodeHash(undefined).ok, false);
});

test('an oversized payload is rejected before it is ever decompressed', () => {
  let inflateCalls = 0;
  const spyInflate = () => {
    inflateCalls += 1;
    throw new Error('inflate must not run on an oversized payload');
  };
  const tooLong = HASH_PREFIX + 'A'.repeat(MAX_HASH_B64 + 1);

  const result = decodeHash(tooLong, { inflate: spyInflate });
  assert.equal(result.ok, false);
  assert.match(result.error, /too large to open/);
  assert.equal(inflateCalls, 0);
});

test('a payload that inflates past the byte cap is refused', () => {
  const bomb = () => new Uint8Array(3_000_000);
  const small = HASH_PREFIX + 'AAAA';
  const result = decodeHash(small, { inflate: bomb });
  assert.equal(result.ok, false);
  assert.match(result.error, /past the .* byte limit/);
});

test('a decoded project runs the same validation chain a file import uses', () => {
  // Deflated by the real codec but carrying a schema this build will not read.
  const hash = encodeProject({ ...seedShapedProject(), schemaVersion: 99 });
  const result = decodeHash(hash);
  assert.equal(result.ok, false);
  assert.match(result.error, /newer version of cutlist/);
});

test('a 700 KB project encodes without a RangeError from the chunked base64 path', () => {
  const project = seedShapedProject();
  // Roughly 700 KB of JSON so the binary string is built in more than one chunk.
  project.notes = 'x'.repeat(700_000);
  const hash = encodeProject(project, { deflate: (bytes) => bytes });
  assert.ok(hash.length > 900_000, 'the uncompressed path must actually exceed one chunk');

  // And the same project through the real compressor round trips.
  const real = encodeProject(project);
  const restored = decodeHash(real);
  assert.equal(restored.ok, true);
  assert.equal(restored.project.notes.length, 700_000);
});
