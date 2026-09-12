// Ordered cut sequence for one sheet.
//
// The sequence is a pre-order walk of that sheet's free-area tree: a parent
// piece is always cut before either of the pieces it produces, which is the
// order a person can actually work in at the saw. This traversal order is the
// single source of truth for both the diagram and the printed table.
//
// Every piece the sequence ever mentions carries an identifier, because size
// alone does not identify a piece. A layout can easily leave two 3 1/2 by 30
// pieces on the bench at once, one of them a finished part, and a step that
// says only "cut the 3 1/2 by 30 piece" is an invitation to cut up the
// finished one. An offcut is named for the step that made it, and a piece that
// is already a finished part is named by its cut-list label, so a step always
// points at exactly one piece and says where it came from.

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

const REFERENCE_EDGE = { v: 'left', h: 'bottom' };

function sizeOf(piece, system) {
  return `${formatLength(piece.w, system)} x ${formatLength(piece.h, system)}`;
}

/** How a piece is named in a step: the identifier first, so it reads as an address. */
function nameOf(piece, system) {
  const size = sizeOf(piece, system);
  if (piece.role === 'part') return `${piece.id} (${piece.name}, ${size})`;
  if (piece.role === 'offcut') return `${piece.id} (offcut, ${size})`;
  return `${piece.id} (${size})`;
}

/** Where the piece being cut came from, so it can be found on the bench. */
function originOf(piece) {
  return piece.role === 'sheet' ? piece.origin : `from step ${piece.fromSeq}`;
}

function noteFor(step, system) {
  const verb = step.kind === 'rip' ? 'Rip' : 'Crosscut';
  const [first, second] = step.pieceAfter;
  return `${verb} ${nameOf(step.pieceBefore, system)}, ${originOf(step.pieceBefore)},`
    + ` at ${formatLength(step.atIn, system)} from the ${step.referenceEdge} edge.`
    + ` Makes ${nameOf(first, system)} and ${nameOf(second, system)}.`;
}

/**
 * Ordered rip and crosscut steps for a sheet plan, numbered from 1.
 *
 * `atIn` is measured from the piece's own reference edge, which the note
 * names in words so nobody has to guess which end of the piece to hook the
 * tape on. `pieceBefore` and each entry in `pieceAfter` carry an `id` that is
 * unique within the sheet, plus the `fromSeq` of the step that produced them.
 */
export function cutStepsFor(sheetPlan, system = 'imperial') {
  const steps = [];
  const { widthIn, lengthIn } = sheetPlan;
  let nextPieceNumber = 0;

  // Offcut numbers are handed out as pieces come into existence, which is the
  // step order, so an identifier always appears in an earlier step's "Makes"
  // clause before the step that cuts it up.
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

  const identify = (node, fromSeq) => {
    if (node.part !== null) {
      return { id: node.part.label, name: node.part.name, role: 'part', w: node.w, h: node.h, fromSeq };
    }
    return {
      id: nextPieceId(),
      name: '',
      role: node.cut === null ? 'offcut' : 'piece',
      w: node.w,
      h: node.h,
      fromSeq,
    };
  };

  const walk = (node, piece) => {
    if (node.cut === null) return;
    const { axis, at, first, second } = node.cut;
    const seq = steps.length + 1;
    const firstPiece = identify(first, seq);
    const secondPiece = identify(second, seq);

    const step = {
      seq,
      kind: kindFor(axis, widthIn, lengthIn),
      atIn: at,
      fromIn: axis === 'v' ? node.y : node.x,
      toIn: axis === 'v' ? node.y + node.h : node.x + node.w,
      referenceEdge: REFERENCE_EDGE[axis],
      pieceBefore: piece,
      pieceAfter: [firstPiece, secondPiece],
      note: '',
    };
    step.note = noteFor(step, system);
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
  };
  walk(tree, rootPiece);
  return steps;
}
