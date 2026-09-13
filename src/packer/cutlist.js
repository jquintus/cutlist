// Ordered cut sequence for one sheet.
//
// The sequence is a pre-order walk of that sheet's free-area tree: a parent
// piece is always cut before either of the pieces it produces, which is the
// order a person can actually work in at the saw. This traversal order is the
// single source of truth for both the diagram and the printed list.
//
// Every piece carries an internal identifier because size alone does not
// identify a piece: a layout can easily leave two 3 1/2 by 30 pieces on the
// bench at once, one of them a finished part. That identifier stays in the
// data, where the bench-tracking and uniqueness invariants are checked on it,
// and is never shown to anyone. What a person reads is the piece's `address`:
// a finished part by its cut-list label, and any other piece by the step that
// produced it and which side of that cut it came off. A cut makes exactly two
// pieces, so "the left piece from step 3" points at exactly one of them
// without asking anybody to measure anything twice. Left/right and top/bottom
// mean what they mean on the drawn sheet, which is the sheet a person lines up
// in front of them; see REFERENCE_EDGE below.

import { EPS } from '../geometry.js';
import { formatLength } from '../units.js';

/**
 * Is a cut along `axis` a rip on this sheet?
 *
 * A rip runs parallel to the sheet's long edge. That depends on the sheet's
 * own proportions, not on the axis letter: on a 96 x 48 piece a vertical cut
 * runs along the short side and is a crosscut.
 */
function kindFor(axis, widthIn, lengthIn) {
  const longEdgeRunsAlongY = lengthIn >= widthIn;
  const cutRunsAlongY = axis === 'v';
  return cutRunsAlongY === longEdgeRunsAlongY ? 'rip' : 'crosscut';
}

// Which edge a measurement is hooked on, in the orientation the diagram draws.
//
// One convention covers both the words and the picture. The sheet is drawn
// with x = 0 at the left and y = 0 at the TOP, so the origin end of a piece is
// its left edge for a 'v' cut and its top edge for an 'h' cut. Calling the
// 'h' origin "bottom" mirrored the list against the drawing: the step said to
// measure up from the bottom while the line was drawn down from the top, and
// the piece a step called "top" was the one drawn at the bottom. Lining the
// printed diagram up with the real sheet and following the written
// measurement then cut the panel at the wrong end.
const REFERENCE_EDGE = { v: 'left', h: 'top' };

// Which side of the cut each child comes off. cutNode always builds `first` as
// the near side -- the smaller x or the smaller y -- which is the left or the
// top one as the sheet is drawn.
const SIDES = { v: ['left', 'right'], h: ['top', 'bottom'] };

/** How a step names the piece it is about to cut, with no internal id in it. */
function addressOf(piece) {
  if (piece.role === 'sheet') return piece.origin;
  if (piece.role === 'part') return piece.id;
  return `the ${piece.side} piece from step ${piece.fromSeq}`;
}

/** The one saw action: one verb, one piece, one measurement, one edge. */
function instructionFor(step, system) {
  const verb = step.kind === 'rip' ? 'Rip' : 'Crosscut';
  return `${verb} ${addressOf(step.pieceBefore)}`
    + ` at ${formatLength(step.atIn, system)} from the ${step.referenceEdge} edge.`;
}

/**
 * What this cut finishes, if anything.
 *
 * Kept apart from the instruction so a reader is never handed two things to do
 * in one sentence, and so nothing downstream has to split prose to tell the
 * action from its result. A cut that only yields offcuts says nothing here;
 * the leftovers are summarized once per sheet instead.
 */
function freesFor(step) {
  const parts = step.pieceAfter.filter((piece) => piece.role === 'part');
  if (parts.length === 0) return '';
  const named = parts.map((piece) => `${piece.id} ${piece.name}`.trim());
  return `Frees ${named.join(' and ')}.`;
}

/**
 * Ordered rip and crosscut steps for a sheet plan, numbered from 1.
 *
 * `atIn` is measured from the piece's own reference edge -- its left edge or
 * its top edge, as the sheet is drawn -- which the note names in words so
 * nobody has to guess which end of the piece to hook the tape on. `lineIn` is
 * the same cut expressed in absolute sheet inches, which is what the diagram
 * draws; `fromIn` and `toIn` span the cut along the other axis. `pieceBefore` and each entry in `pieceAfter` carry an internal `id`
 * that is unique within the sheet, the `fromSeq` of the step that produced
 * them, and the human `address` that is safe to show.
 */
export function cutStepsFor(sheetPlan, system = 'imperial') {
  const steps = [];
  const { widthIn, lengthIn } = sheetPlan;
  let nextPieceNumber = 0;

  // Internal identifiers are handed out as pieces come into existence, which
  // is the step order.
  //
  // Lowercase "p", never uppercase: a part label is always an uppercase
  // letter run followed by a copy number (model.js's letterFor/expandParts),
  // and a material group with 16 or more distinct part types reaches the
  // letter "P", so an uppercase "P1" here used to collide with that part's
  // own label on the very same sheet. A lowercase prefix is a string no
  // label can ever produce, so this id is unambiguous no matter how many
  // part types share a sheet.
  const nextPieceId = () => {
    nextPieceNumber += 1;
    return `p${nextPieceNumber}`;
  };

  const identify = (node, fromSeq, side) => {
    const piece = node.part !== null
      ? { id: node.part.label, name: node.part.name, role: 'part', w: node.w, h: node.h, fromSeq, side }
      : {
        id: nextPieceId(),
        name: '',
        role: node.cut === null ? 'offcut' : 'piece',
        w: node.w,
        h: node.h,
        fromSeq,
        side,
      };
    piece.address = addressOf(piece);
    return piece;
  };

  const walk = (node, piece) => {
    if (node.cut === null) return;
    const { axis, at, first, second } = node.cut;
    const seq = steps.length + 1;
    const [nearSide, farSide] = SIDES[axis];
    const firstPiece = identify(first, seq, nearSide);
    const secondPiece = identify(second, seq, farSide);

    const step = {
      seq,
      kind: kindFor(axis, widthIn, lengthIn),
      axis,
      atIn: at,
      lineIn: axis === 'v' ? node.x + at : node.y + at,
      fromIn: axis === 'v' ? node.y : node.x,
      toIn: axis === 'v' ? node.y + node.h : node.x + node.w,
      referenceEdge: REFERENCE_EDGE[axis],
      pieceBefore: piece,
      pieceAfter: [firstPiece, secondPiece],
      instruction: '',
      frees: '',
      note: '',
    };
    step.instruction = instructionFor(step, system);
    step.frees = freesFor(step);
    step.note = step.frees === '' ? step.instruction : `${step.instruction} ${step.frees}`;
    steps.push(step);

    walk(first, firstPiece);
    walk(second, secondPiece);
  };

  const tree = sheetPlan.tree;
  // Only the starting piece has no producing step, so it says what it is
  // instead. Its size is the usable area, which is smaller than the sheet
  // whenever edge trim was taken off.
  const trimmed = tree.w < widthIn - EPS || tree.h < lengthIn - EPS;
  const rootPiece = {
    id: nextPieceId(),
    name: '',
    role: 'sheet',
    origin: trimmed ? 'the sheet with its edges trimmed' : 'the full sheet',
    w: tree.w,
    h: tree.h,
    fromSeq: null,
    side: null,
  };
  rootPiece.address = addressOf(rootPiece);
  walk(tree, rootPiece);
  return steps;
}
