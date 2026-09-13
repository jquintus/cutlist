// Guillotine free-area tree.
//
// The free area of a sheet is a tree whose only operation is a full
// edge-to-edge cut of one node into exactly two children. There is no
// representation for a stopped or plunge cut, so a layout that is not
// guillotine cuttable cannot be built out of this structure at all.
//
// Never post-process or "fix up" a layout produced here, and never swap this
// for maximal-rectangles or any other free-form placement scheme. The whole
// point is that validity is structural rather than checked after the fact.

import { EPS, fits, gtz } from '../geometry.js';

/**
 * A free-area node.
 *
 * `cut` is null on a leaf. On an interior node it is
 * { axis: 'v' | 'h', at, first, second } where `at` is the distance from the
 * node's own origin edge to the cut line: its left edge for 'v', and for 'h'
 * the edge at the smaller y, which is the top edge as the sheet is drawn.
 *
 * `part` is null unless this leaf holds a placement.
 */
export function makeNode(x, y, w, h) {
  return { x, y, w, h, part: null, cut: null };
}

/** Root free area of a sheet, with the edge trim taken off exactly once. */
export function makeRoot(widthIn, lengthIn, edgeTrimIn) {
  const trim = Math.max(0, edgeTrimIn);
  return makeNode(trim, trim, widthIn - 2 * trim, lengthIn - 2 * trim);
}

/** Every node that could still take a part: no cut beneath it and nothing in it. */
export function leaves(node, out = []) {
  if (node.cut === null) {
    if (node.part === null) out.push(node);
    return out;
  }
  leaves(node.cut.first, out);
  leaves(node.cut.second, out);
  return out;
}

/** Every placement in the tree, in traversal order. */
export function placementsOf(node, out = []) {
  if (node.part !== null) out.push(node.part);
  if (node.cut !== null) {
    placementsOf(node.cut.first, out);
    placementsOf(node.cut.second, out);
  }
  return out;
}

/** Smallest side of a leftover, or 0 when the leftover is degenerate and gets dropped. */
function minDim(w, h) {
  return gtz(w) && gtz(h) ? Math.min(w, h) : 0;
}

/**
 * How good a given cut order is for this placement, higher being better.
 *
 * Scoring by the largest surviving minimum dimension keeps one usefully wide
 * offcut rather than two slivers.
 */
export function scoreOrder(leaf, pw, ph, kerfIn, outerAxis) {
  if (outerAxis === 'v') {
    const rightStrip = minDim(leaf.w - pw - kerfIn, leaf.h);
    const belowPart = minDim(pw, leaf.h - ph - kerfIn);
    return Math.max(rightStrip, belowPart);
  }
  const topStrip = minDim(leaf.w, leaf.h - ph - kerfIn);
  const besidePart = minDim(leaf.w - pw - kerfIn, ph);
  return Math.max(topStrip, besidePart);
}

/**
 * Cut `node` edge to edge and return the child that keeps the near side.
 *
 * Returns the node itself when the remainder would be degenerate: there is no
 * cut to make, the leftover sliver is simply waste. This is what keeps a
 * kerf of 0 and a trim of 0 from producing zero-area children.
 */
function cutNode(node, axis, at, kerfIn) {
  const total = axis === 'v' ? node.w : node.h;
  const remainder = total - at - kerfIn;
  if (!gtz(remainder)) return node;

  const first = axis === 'v'
    ? makeNode(node.x, node.y, at, node.h)
    : makeNode(node.x, node.y, node.w, at);
  const second = axis === 'v'
    ? makeNode(node.x + at + kerfIn, node.y, remainder, node.h)
    : makeNode(node.x, node.y + at + kerfIn, node.w, remainder);

  node.cut = { axis, at, first, second };
  return first;
}

/**
 * Place a part of pw x ph into `leaf`, cutting along `outerAxis` first.
 *
 * Kerf is charged to the remainder only. The part itself is never shrunk by
 * the blade width, because the blade runs beside the part, not through it.
 */
export function placeInLeaf(leaf, pw, ph, kerfIn, outerAxis, placement) {
  let target = leaf;
  if (outerAxis === 'v') {
    target = cutNode(target, 'v', pw, kerfIn);
    target = cutNode(target, 'h', ph, kerfIn);
  } else {
    target = cutNode(target, 'h', ph, kerfIn);
    target = cutNode(target, 'v', pw, kerfIn);
  }
  target.part = { ...placement, x: target.x, y: target.y, w: pw, h: ph };
  return target.part;
}

/** Orientations this instance is allowed to be cut in. */
export function orientationsFor(instance) {
  const upright = { w: instance.widthIn, h: instance.lengthIn, rotated: false };
  if (instance.grainLocked) return [upright];
  return [upright, { w: instance.lengthIn, h: instance.widthIn, rotated: true }];
}

/** True when the instance fits an empty region of this size in some allowed orientation. */
export function fitsSomewhere(instance, w, h) {
  return orientationsFor(instance).some(
    (orientation) => fits(orientation.w, w) && fits(orientation.h, h),
  );
}

/** Best fit over a candidate list: smallest area, then smallest minimum
 * dimension, then lowest and leftmost. Spelled once so every tier below
 * breaks ties identically and packing stays reproducible. */
function bestFit(list) {
  if (list.length === 0) return null;
  return [...list].sort((a, b) => (
    (a.w * a.h) - (b.w * b.h)
    || Math.min(a.w, a.h) - Math.min(b.w, b.h)
    || a.y - b.y
    || a.x - b.x
  ))[0];
}

/**
 * How long a strip of this width would have to be to hold this part and every
 * peer that could share the strip, kerf between each.
 */
function runFor(orientation, peers, kerfIn) {
  let count = 0;
  let lengthIn = orientation.h;
  for (const peer of peers) {
    const match = orientationsFor(peer).find((o) => Math.abs(o.w - orientation.w) <= EPS);
    if (match === undefined) continue;
    count += 1;
    lengthIn += kerfIn + match.h;
  }
  return { count, lengthIn };
}

/**
 * Choose where to put an instance.
 *
 * Three preference tiers, in order:
 *
 * 1. Continue an open strip. A free leaf exactly as wide as the part is the
 *    remainder of a strip already ripped to that width, so crosscutting the
 *    part off it gangs this part onto that run for one more crosscut.
 * 2. Open a strip. When parts still waiting in the queue share this part's
 *    width, rip a strip off first and prefer a leaf long enough for the whole
 *    run, so the strip survives at full length for those peers.
 * 3. Best fit, unchanged: smallest free area, then smallest minimum dimension,
 *    then lowest and leftmost, with the orientation and cut order inside the
 *    chosen leaf picked by cut score.
 *
 * Only leaf, orientation and axis selection live here; how a cut is made is
 * entirely placeInLeaf's and cutNode's business, which is why no guillotine,
 * kerf, bounds, overlap or grain-lock property can move as these tiers change.
 * Every tier is a total order, so packing the same input twice gives the same
 * answer.
 *
 * `peers` is the not-yet-attempted remainder of this sheet's queue.
 *
 * Returns null when the instance fits no leaf.
 */
export function choosePlacement(root, instance, kerfIn, peers = []) {
  const all = leaves(root);
  const orientations = orientationsFor(instance);

  // Tier 1: crosscut the part off a strip that is already this wide.
  for (const orientation of orientations) {
    const leaf = bestFit(all.filter((candidate) =>
      Math.abs(candidate.w - orientation.w) <= EPS && fits(orientation.h, candidate.h)));
    if (leaf !== null) return { leaf, orientation, axis: 'h' };
  }

  // Tier 2: rip a fresh strip for this part and the peers that share its width.
  let opener = null;
  for (const orientation of orientations) {
    const run = runFor(orientation, peers, kerfIn);
    if (run.count === 0) continue;
    const fitsPart = all.filter((candidate) =>
      fits(orientation.w, candidate.w) && fits(orientation.h, candidate.h));
    const fitsWholeRun = fitsPart.filter((candidate) => fits(run.lengthIn, candidate.h));
    const leaf = bestFit(fitsWholeRun) ?? bestFit(fitsPart);
    if (leaf === null) continue;
    const wholeRun = fitsWholeRun.length > 0;
    const better = opener === null
      || (wholeRun && !opener.wholeRun)
      || (wholeRun === opener.wholeRun && run.count > opener.count);
    if (better) opener = { leaf, orientation, wholeRun, count: run.count };
  }
  if (opener !== null) return { leaf: opener.leaf, orientation: opener.orientation, axis: 'v' };

  // Tier 3: best fit, exactly as before.
  const candidates = all.filter((leaf) =>
    orientations.some((o) => fits(o.w, leaf.w) && fits(o.h, leaf.h)));
  const leaf = bestFit(candidates);
  if (leaf === null) return null;

  let best = null;
  for (const orientation of orientations) {
    if (!fits(orientation.w, leaf.w) || !fits(orientation.h, leaf.h)) continue;
    for (const axis of ['v', 'h']) {
      const score = scoreOrder(leaf, orientation.w, orientation.h, kerfIn, axis);
      // Ties break toward the upright orientation and then toward a vertical
      // first cut, so the output is stable run to run.
      if (best === null || score > best.score + EPS) {
        best = { leaf, orientation, axis, score };
      }
    }
  }
  return best;
}
