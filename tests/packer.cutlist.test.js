import test from 'node:test';
import assert from 'node:assert/strict';
import { packMaterial, cutStepsFor } from '../src/packer/index.js';
import { normalizeProject } from '../src/model.js';
import { mixedPartsProject } from './fixtures/layouts.js';

function pack(project) {
  return packMaterial({
    material: project.materials[0],
    parts: project.parts,
    params: project.params,
  });
}

test('cut steps are numbered from one with no gaps', () => {
  const result = pack(mixedPartsProject());
  for (const sheet of result.sheets) {
    assert.deepEqual(sheet.cuts.map((step) => step.seq), sheet.cuts.map((_, i) => i + 1));
  }
});

test('each step accounts for its whole piece: the two results plus the kerf equal the original', () => {
  const project = mixedPartsProject();
  const { kerfIn } = project.params;
  const result = pack(project);
  for (const sheet of result.sheets) {
    for (const step of sheet.cuts) {
      const [a, b] = step.pieceAfter;
      const acrossWidth = Math.abs(a.w + b.w + kerfIn - step.pieceBefore.w) < 1e-9
        && Math.abs(a.h - step.pieceBefore.h) < 1e-9
        && Math.abs(b.h - step.pieceBefore.h) < 1e-9;
      const acrossHeight = Math.abs(a.h + b.h + kerfIn - step.pieceBefore.h) < 1e-9
        && Math.abs(a.w - step.pieceBefore.w) < 1e-9
        && Math.abs(b.w - step.pieceBefore.w) < 1e-9;
      assert.ok(acrossWidth || acrossHeight, `step ${step.seq} does not account for its piece`);
    }
  }
});

test('every step cuts a piece that is on the bench, identified by name', () => {
  const result = pack(mixedPartsProject());
  for (const sheet of result.sheets) {
    // Pieces on the bench, by identifier. Matching by identifier rather than by
    // size is the point: two pieces of one size can be waiting at once.
    const bench = new Map();
    const start = sheet.cuts[0].pieceBefore;
    assert.equal(start.role, 'sheet', 'the first step starts from the sheet itself');
    assert.deepEqual(
      [start.w, start.h],
      [sheet.usable.w, sheet.usable.h],
      'the starting piece is the usable area of the sheet',
    );
    bench.set(start.id, start);

    for (const step of sheet.cuts) {
      assert.ok(bench.has(step.pieceBefore.id), `step ${step.seq} cuts ${step.pieceBefore.id}, which is not on the bench`);
      bench.delete(step.pieceBefore.id);
      for (const piece of step.pieceAfter) {
        assert.ok(!bench.has(piece.id), `step ${step.seq} produces ${piece.id}, an identifier already in use`);
        bench.set(piece.id, piece);
      }
    }
  }
});

test('every step names the edge to measure from and gives a measurement', () => {
  const result = pack(mixedPartsProject());
  for (const sheet of result.sheets) {
    for (const step of sheet.cuts) {
      assert.match(step.note, /from the (left|bottom) edge/);
      assert.ok(Number.isFinite(step.atIn));
      assert.ok(step.toIn > step.fromIn);
    }
  }
});

test('rip and crosscut come from the sheet proportions, not the axis letter', () => {
  // A 96 wide by 48 long piece has its long edge along x, so a cut at a
  // constant x runs across the short side and is a crosscut.
  const wide = normalizeProject({
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [{ id: 'm1', name: 'Wide', sheets: [{ widthIn: 96, lengthIn: 48, qty: 1 }] }],
    parts: [{ id: 'p1', name: 'Strip', qty: 3, widthIn: 10, lengthIn: 48, materialId: 'm1', grainLocked: true }],
  });
  const wideResult = pack(wide);
  const wideKinds = new Set(wideResult.sheets[0].cuts.map((step) => step.kind));
  assert.ok(wideKinds.has('crosscut'), 'a constant-x cut on a 96 x 48 piece must be a crosscut');

  // The same part set on a 48 wide by 96 long sheet makes those same cuts rips.
  const tall = normalizeProject({
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [{ id: 'm1', name: 'Tall', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [{ id: 'p1', name: 'Strip', qty: 3, widthIn: 10, lengthIn: 48, materialId: 'm1', grainLocked: true }],
  });
  const tallResult = pack(tall);
  const tallKinds = new Set(tallResult.sheets[0].cuts.map((step) => step.kind));
  assert.ok(tallKinds.has('rip'), 'a constant-x cut on a 48 x 96 sheet must be a rip');
});

test('a square sheet still resolves rip and crosscut from its own dimensions', () => {
  const square = normalizeProject({
    params: { kerfIn: 0.125, edgeTrimIn: 0 },
    materials: [{ id: 'm1', name: 'Square', sheets: [{ widthIn: 48, lengthIn: 48, qty: 1 }] }],
    parts: [{ id: 'p1', name: 'Panel', qty: 4, widthIn: 20, lengthIn: 20, materialId: 'm1' }],
  });
  const result = pack(square);
  const steps = result.sheets[0].cuts;
  assert.ok(steps.length > 0);
  for (const step of steps) {
    assert.ok(step.kind === 'rip' || step.kind === 'crosscut');
  }
});

test('cutStepsFor is a pure function of the sheet plan and repeats exactly', () => {
  const result = pack(mixedPartsProject());
  const sheet = result.sheets[0];
  assert.deepEqual(cutStepsFor(sheet), cutStepsFor(sheet));
  assert.deepEqual(cutStepsFor(sheet), sheet.cuts);
});

// A symmetric layout: the first cut halves the sheet, so steps 2 and 3 each
// cut a 48 by 48 piece and there are two of those on the bench at once. This
// is exactly the situation a size-only instruction cannot describe.
function twinPiecesProject() {
  return normalizeProject({
    params: { kerfIn: 0, edgeTrimIn: 0 },
    materials: [{ id: 'm1', name: 'Ply', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [{ id: 'p1', name: 'Panel', qty: 4, widthIn: 24, lengthIn: 48, materialId: 'm1' }],
  });
}

/** Every piece any step mentions, keyed by identifier. */
function piecesById(sheet) {
  const byId = new Map();
  for (const step of sheet.cuts) {
    for (const piece of [step.pieceBefore, ...step.pieceAfter]) {
      const seen = byId.get(piece.id);
      if (seen !== undefined) {
        assert.deepEqual([seen.w, seen.h], [piece.w, piece.h], `${piece.id} names two different pieces`);
      }
      byId.set(piece.id, piece);
    }
  }
  return byId;
}

test('two pieces of the same size never share an identifier', () => {
  const sheet = pack(twinPiecesProject()).sheets[0];
  const pieces = [...piecesById(sheet).values()];

  const bySize = new Map();
  for (const piece of pieces) {
    const size = `${piece.w} x ${piece.h}`;
    bySize.set(size, [...(bySize.get(size) ?? []), piece]);
  }
  const duplicated = [...bySize.values()].filter((group) => group.length > 1);

  // Cut-apart pieces, not finished parts: parts are told apart by the label on
  // the diagram anyway, so a fixture that only duplicates parts would let a
  // size-derived identifier pass this test.
  const duplicatedOffcuts = duplicated.filter((group) => group.some((piece) => piece.role !== 'part'));
  assert.ok(
    duplicatedOffcuts.length > 0,
    'this layout must really leave two same-sized unfinished pieces on the bench at once',
  );

  for (const group of duplicated) {
    const ids = new Set(group.map((piece) => piece.id));
    assert.equal(ids.size, group.length, `same-sized pieces share an identifier: ${[...ids].join(', ')}`);
  }
});

test('no two steps send someone to the same piece', () => {
  const sheet = pack(twinPiecesProject()).sheets[0];

  // The same cut, at the same measurement, on two pieces of the same size.
  const byCut = new Map();
  for (const step of sheet.cuts) {
    const cut = `${step.kind} ${step.atIn} on ${step.pieceBefore.w} x ${step.pieceBefore.h}`;
    byCut.set(cut, (byCut.get(cut) ?? 0) + 1);
  }
  assert.ok(
    [...byCut.values()].some((count) => count > 1),
    'this layout must really make the same cut on two same-sized pieces',
  );

  // Which piece to pick up and where to cut it, with the results stripped off.
  const instructions = sheet.cuts.map((step) => {
    const [instruction, results] = step.note.split(' Makes ');
    assert.ok(results, `step ${step.seq} does not say what it produces`);
    return instruction;
  });
  assert.equal(
    new Set(instructions).size,
    instructions.length,
    'two steps tell someone to pick up the same piece',
  );
});

test('every step names the piece to cut and where that piece came from', () => {
  const sheet = pack(twinPiecesProject()).sheets[0];
  for (const step of sheet.cuts) {
    assert.ok(
      step.note.includes(step.pieceBefore.id),
      `step ${step.seq} does not name the piece it cuts`,
    );
    if (step.pieceBefore.fromSeq === null) {
      assert.equal(step.pieceBefore.role, 'sheet');
      assert.match(step.note, /the full sheet|edges trimmed/);
    } else {
      assert.ok(step.pieceBefore.fromSeq < step.seq, 'a piece is produced before it is cut');
      assert.ok(step.note.includes(`from step ${step.pieceBefore.fromSeq}`));
    }
  }
});

test('a step that frees a finished part names it by its cut-list label', () => {
  const sheet = pack(twinPiecesProject()).sheets[0];
  const labels = new Set(sheet.placements.map((placement) => placement.label));

  const partPieces = sheet.cuts.flatMap((step) =>
    step.pieceAfter.filter((piece) => piece.role === 'part').map((piece) => ({ step, piece })));
  assert.ok(partPieces.length > 0, 'these cuts must free finished parts');

  for (const { step, piece } of partPieces) {
    assert.ok(labels.has(piece.id), `${piece.id} is not a label on this sheet`);
    assert.ok(step.note.includes(piece.id), `step ${step.seq} does not name the part it frees`);
    assert.ok(step.note.includes(piece.name), `step ${step.seq} does not name the part it frees`);
  }
});

test('the edge trimmed off the sheet is called out on the piece it changes', () => {
  const trimmed = normalizeProject({
    params: { kerfIn: 0.125, edgeTrimIn: 0.25 },
    materials: [{ id: 'm1', name: 'Ply', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [{ id: 'p1', name: 'Fence', qty: 2, widthIn: 3.5, lengthIn: 30, materialId: 'm1' }],
  });
  const first = pack(trimmed).sheets[0].cuts[0];
  assert.match(first.note, /edges trimmed/, 'the starting piece is not the full sheet once trim comes off');
});
