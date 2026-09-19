import test from 'node:test';
import assert from 'node:assert/strict';
import { packMaterial, cutStepsFor } from '../src/packer/index.js';
import { normalizeProject } from '../src/model.js';
import { readFile } from 'node:fs/promises';
import { validateProject } from '../src/io/validate.js';
import { planProject } from '../src/plan.js';
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
      assert.match(step.note, /from the (left|top) edge/);
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
//
// The part is grain locked so that the packer's strip affinity cannot gang all
// four panels onto a single 24 in strip. A ganged run leaves no two same-sized
// unfinished pieces waiting at once and makes no cut twice, which is precisely
// what the two tests below need this fixture to produce.
function twinPiecesProject() {
  return normalizeProject({
    params: { kerfIn: 0, edgeTrimIn: 0 },
    materials: [{ id: 'm1', name: 'Ply', sheets: [{ widthIn: 48, lengthIn: 96, qty: 1 }] }],
    parts: [{ id: 'p1', name: 'Panel', qty: 4, widthIn: 24, lengthIn: 48, materialId: 'm1', grainLocked: true }],
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

  // Which piece to pick up and where to cut it, read straight off the field
  // that carries exactly that and nothing else. No splitting prose apart.
  const instructions = sheet.cuts.map((step) => step.instruction);
  assert.equal(
    new Set(instructions).size,
    instructions.length,
    'two steps tell someone to pick up the same piece',
  );
});

// A cut deliberately says nothing about the offcuts it leaves, so the sequence
// itself has to be what accounts for them: every piece a step produces is
// either a finished part on this sheet, a piece a later step picks back up, or
// a leftover the sheet reports once at the end.
test('every piece a step produces is accounted for somewhere', () => {
  const sheet = pack(twinPiecesProject()).sheets[0];
  const labels = new Set(sheet.placements.map((placement) => placement.label));
  const cutAgain = new Set(sheet.cuts.map((step) => step.pieceBefore.id));
  const isLeftover = (piece) => sheet.offcuts.some((offcut) =>
    Math.abs(offcut.w - piece.w) < 1e-6 && Math.abs(offcut.h - piece.h) < 1e-6);

  for (const step of sheet.cuts) {
    for (const piece of step.pieceAfter) {
      if (piece.role === 'part') {
        assert.ok(labels.has(piece.id), `step ${step.seq} frees ${piece.id}, which is not on this sheet`);
      } else {
        assert.ok(
          cutAgain.has(piece.id) || isLeftover(piece),
          `step ${step.seq} produces a piece that is neither cut again nor reported as a leftover`,
        );
      }
    }
  }
});

test('every step names the piece to cut and where that piece came from', () => {
  const sheet = pack(twinPiecesProject()).sheets[0];
  for (const step of sheet.cuts) {
    assert.ok(
      step.note.includes(step.pieceBefore.address),
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

// The three seed projects, read from disk, are the closest thing this build
// has to a real user's project, so the "nothing internal reaches a person"
// rules are checked against them and not only against a fixture.
async function seedPlans() {
  const files = ['demo-omnisled-full-size.json', 'demo-omnisled-mini.json', 'omnisled-full-and-mini.json'];
  return Promise.all(files.map(async (file) => {
    const text = await readFile(new URL(`../projects/${file}`, import.meta.url), 'utf8');
    const checked = validateProject(JSON.parse(text));
    assert.equal(checked.ok, true, `projects/${file}: ${checked.message ?? ''}`);
    return { file, plan: planProject(checked.project) };
  }));
}

function eachSeedStep(plans, check) {
  for (const { file, plan } of plans) {
    for (const material of plan.materials) {
      for (const sheet of material.sheets) {
        for (const step of sheet.cuts) check(step, `${file} ${material.name} step ${step.seq}`);
      }
    }
  }
}

test('no step ever shows an internal piece identifier', async () => {
  eachSeedStep(await seedPlans(), (step, where) => {
    assert.doesNotMatch(step.note, /\bp\d+\b/, `${where} leaks an internal identifier`);
  });
});

test('a step gives exactly one measurement, so nobody has to pick which one', async () => {
  eachSeedStep(await seedPlans(), (step, where) => {
    const measurements = step.note.split(' at ').length - 1;
    assert.equal(measurements, 1, `${where} gives ${measurements} measurements`);
  });
});

test('the instruction field is one complete saw action with no result clause', async () => {
  eachSeedStep(await seedPlans(), (step, where) => {
    assert.ok(step.instruction.length > 0, `${where} has no instruction`);
    assert.ok(step.instruction.endsWith('.'), `${where} instruction is not a sentence`);
    assert.ok(!step.instruction.includes(' Frees '), `${where} mixes its result into the action`);
    const expected = step.frees === '' ? step.instruction : `${step.instruction} ${step.frees}`;
    assert.equal(step.note, expected, `${where} note is not its instruction plus its result`);
  });
});

test('every cut line lands inside the sheet on the axis it runs across', async () => {
  for (const { file, plan } of await seedPlans()) {
    for (const material of plan.materials) {
      for (const sheet of material.sheets) {
        for (const step of sheet.cuts) {
          const span = step.axis === 'v' ? sheet.widthIn : sheet.lengthIn;
          assert.ok(
            step.lineIn > 0 && step.lineIn < span,
            `${file} step ${step.seq} draws a cut at ${step.lineIn}, outside the sheet`,
          );
          assert.ok(step.toIn > step.fromIn);
        }
      }
    }
  }
});

test('every piece address reads as a place on the bench, never as an id', async () => {
  const shapes = /^(the full sheet|the sheet with its edges trimmed|the (left|right|bottom|top) piece from step \d+|[A-Z]+\d+)$/;
  for (const { file, plan } of await seedPlans()) {
    for (const material of plan.materials) {
      for (const sheet of material.sheets) {
        const addresses = new Set();
        for (const step of sheet.cuts) {
          for (const piece of [step.pieceBefore, ...step.pieceAfter]) {
            assert.match(piece.address, shapes, `${file}: "${piece.address}" is not an address`);
          }
          assert.ok(
            !addresses.has(step.pieceBefore.address),
            `${file}: two steps send someone to ${step.pieceBefore.address}`,
          );
          addresses.add(step.pieceBefore.address);
        }
      }
    }
  }
});

// The picture and the words have to describe the same sheet. The diagram draws
// x = 0 at the left and y = 0 at the top, so a step that measures from "the
// top edge" has to draw its line that far DOWN from the piece's top, and the
// piece it calls "top" has to be the one drawn above the line. When these two
// disagree, someone lines the printed diagram up with the real sheet, follows
// the written measurement, and cuts the panel at the wrong end.
test('the first cut on a sheet is drawn where its measurement says, from the named edge', async () => {
  for (const { file, plan } of await seedPlans()) {
    for (const material of plan.materials) {
      for (const sheet of material.sheets) {
        const [step] = sheet.cuts;
        if (step === undefined) continue;
        const origin = step.axis === 'v' ? sheet.usable.x : sheet.usable.y;
        assert.equal(step.referenceEdge, step.axis === 'v' ? 'left' : 'top');
        assert.ok(
          Math.abs(step.lineIn - (origin + step.atIn)) < 1e-9,
          `${file} step 1 says ${step.atIn} from the ${step.referenceEdge} edge but draws at ${step.lineIn}`,
        );
      }
    }
  }
});

test('a part on the left or top side of a cut is drawn on that side of the line', async () => {
  for (const { file, plan } of await seedPlans()) {
    for (const material of plan.materials) {
      for (const sheet of material.sheets) {
        const drawn = new Map(sheet.placements.map((placement) => [placement.label, placement]));
        for (const step of sheet.cuts) {
          for (const piece of step.pieceAfter) {
            if (piece.role !== 'part') continue;
            const placement = drawn.get(piece.id);
            assert.ok(placement !== undefined, `${file}: ${piece.id} is freed but never drawn`);
            const near = step.axis === 'v' ? placement.x + placement.w : placement.y + placement.h;
            const far = step.axis === 'v' ? placement.x : placement.y;
            const onNearSide = piece.side === 'left' || piece.side === 'top';
            assert.ok(
              onNearSide ? near <= step.lineIn + 1e-9 : far >= step.lineIn - 1e-9,
              `${file} step ${step.seq}: ${piece.id} is called the ${piece.side} piece but is not drawn there`,
            );
          }
        }
      }
    }
  }
});
