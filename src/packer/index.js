// Packer facade.
//
// This is an explicitly heuristic greedy packer. It is not optimal and must
// not be tuned toward optimality at the cost of the invariants: correctness
// here means what invariants.js asserts, not the smallest possible sheet
// count. If a future change would buy a fuller sheet by allowing a stopped
// cut, that change is wrong, because every cut has to be makeable on a table
// saw in one pass.

import { expandParts } from '../model.js';
import { EPS, gtz } from '../geometry.js';
import { STRATEGIES } from './strategies.js';
import { cutStepsFor } from './cutlist.js';
import {
  makeRoot,
  choosePlacement,
  placeInLeaf,
  placementsOf,
  fitsSomewhere,
  leaves,
} from './guillotine.js';

const FALLBACK_SHEET = { widthIn: 48, lengthIn: 96, label: '48 x 96' };

function sheetLabel(spec) {
  return spec.label || `${spec.widthIn} x ${spec.lengthIn}`;
}

/**
 * What this group buys when its on-hand sheets run out: the largest sheet it
 * lists, whether or not any are in stock. A qty-0 entry is exactly how a group
 * with nothing on hand declares what to shop for.
 */
export function buySpecFor(material) {
  const usable = (material.sheets ?? []).filter((s) => gtz(s.widthIn) && gtz(s.lengthIn));
  if (usable.length === 0) return { ...FALLBACK_SHEET, id: 'fallback', fallback: true };
  const largest = usable.reduce((best, s) =>
    (s.widthIn * s.lengthIn > best.widthIn * best.lengthIn ? s : best));
  return { ...largest, label: sheetLabel(largest), fallback: false };
}

/** On-hand sheets, one entry per physical sheet, in the order the group lists them. */
function onHandSpecs(material) {
  const specs = [];
  for (const sheet of material.sheets ?? []) {
    if (!gtz(sheet.widthIn) || !gtz(sheet.lengthIn)) continue;
    for (let copy = 0; copy < sheet.qty; copy += 1) {
      specs.push({ ...sheet, label: sheetLabel(sheet) });
    }
  }
  return specs;
}

function usableRegion(spec, edgeTrimIn) {
  const root = makeRoot(spec.widthIn, spec.lengthIn, edgeTrimIn);
  return { x: root.x, y: root.y, w: root.w, h: root.h };
}

/** Fill one sheet greedily and return the finished sheet plan, or null if nothing fit. */
function fillSheet(spec, source, sheetNumber, queue, params, system) {
  const tree = makeRoot(spec.widthIn, spec.lengthIn, params.edgeTrimIn);
  const remaining = [];
  for (let index = 0; index < queue.length; index += 1) {
    const instance = queue[index];
    // The rest of the queue is what lets choosePlacement see that equal-width
    // parts are still coming and open one strip wide enough for all of them.
    const choice = choosePlacement(tree, instance, params.kerfIn, queue.slice(index + 1));
    if (choice === null) {
      remaining.push(instance);
      continue;
    }
    placeInLeaf(choice.leaf, choice.orientation.w, choice.orientation.h, params.kerfIn, choice.axis, {
      partId: instance.partId,
      label: instance.label,
      name: instance.name,
      rotated: choice.orientation.rotated,
      grainLocked: instance.grainLocked,
    });
  }

  const placements = placementsOf(tree);
  if (placements.length === 0) return { plan: null, remaining };

  const usable = { x: tree.x, y: tree.y, w: tree.w, h: tree.h };
  const placedArea = placements.reduce((sum, p) => sum + p.w * p.h, 0);
  // The one place leftovers are derived. The diagram's scrap labels, the
  // per-sheet leftover summary and the cut list's traceability all read this
  // array, so nothing downstream can disagree about what is left over.
  const offcuts = leaves(tree)
    .filter((leaf) => Math.min(leaf.w, leaf.h) > EPS)
    .map((leaf) => ({ x: leaf.x, y: leaf.y, w: leaf.w, h: leaf.h }))
    .sort((a, b) => (b.w * b.h) - (a.w * a.h));
  const sheetPlan = {
    sheetSpecId: spec.id ?? spec.label,
    label: `Sheet ${sheetNumber}: ${sheetLabel(spec)}`,
    source,
    widthIn: spec.widthIn,
    lengthIn: spec.lengthIn,
    usable,
    placements,
    offcuts,
    cuts: [],
    wasteAreaIn2: usable.w * usable.h - placedArea,
    tree,
  };
  sheetPlan.cuts = cutStepsFor(sheetPlan, system);
  return { plan: sheetPlan, remaining };
}

function runStrategy(strategy, { material, instances, params, system }) {
  const buySpec = buySpecFor(material);
  const onHand = onHandSpecs(material);
  const buyUsable = usableRegion(buySpec, params.edgeTrimIn);

  let queue = strategy.order(instances);
  const unplaceable = [];

  // An instance that fits no available sheet empty will never fit one that is
  // already partly used. Rejecting it up front is what stops the allocator
  // opening new sheets forever on an oversized part.
  const allSpecs = [...onHand, buySpec];
  queue = queue.filter((instance) => {
    const fitsAny = allSpecs.some((spec) => {
      const region = usableRegion(spec, params.edgeTrimIn);
      return fitsSomewhere(instance, region.w, region.h);
    });
    if (fitsAny) return true;
    unplaceable.push({
      ...instance,
      reason: `does not fit any available sheet, even empty (largest is ${sheetLabel(buySpec)} with ${params.edgeTrimIn} in edge trim)`,
    });
    return false;
  });

  const sheets = [];
  let nextOnHand = 0;
  while (queue.length > 0) {
    const openingToBuy = nextOnHand >= onHand.length;
    if (openingToBuy) {
      // Second guard, on the sheet we are actually about to buy: a part that
      // will not fit it is dropped rather than buying a sheet it cannot use.
      const stillPossible = [];
      for (const instance of queue) {
        if (fitsSomewhere(instance, buyUsable.w, buyUsable.h)) {
          stillPossible.push(instance);
        } else {
          unplaceable.push({
            ...instance,
            reason: `does not fit an empty ${sheetLabel(buySpec)} sheet`,
          });
        }
      }
      queue = stillPossible;
      if (queue.length === 0) break;
    }

    const spec = openingToBuy ? buySpec : onHand[nextOnHand];
    if (!openingToBuy) nextOnHand += 1;

    const { plan, remaining } = fillSheet(
      spec,
      openingToBuy ? 'to-buy' : 'on-hand',
      sheets.length + 1,
      queue,
      params,
      system,
    );
    if (plan !== null) sheets.push(plan);
    queue = remaining;
  }

  const cutCount = sheets.reduce((sum, sheet) => sum + sheet.cuts.length, 0);
  const wasteArea = sheets.reduce((sum, sheet) => sum + sheet.wasteAreaIn2, 0);
  return {
    sheets,
    unplaceable,
    strategyUsed: strategy.id,
    cutCount,
    wasteArea,
    buySpec,
    onHandSheetCount: onHand.length,
  };
}

/**
 * Rank two packing results.
 *
 * Cut count outranks waste area on purpose: a layout that wastes another
 * square foot but takes three fewer passes at the saw is the better plan for
 * someone standing at the saw, and that is what "cuttability beats marginal
 * efficiency on ties" means here.
 */
function isBetter(candidate, incumbent) {
  if (candidate.unplaceable.length !== incumbent.unplaceable.length) {
    return candidate.unplaceable.length < incumbent.unplaceable.length;
  }
  if (candidate.sheets.length !== incumbent.sheets.length) {
    return candidate.sheets.length < incumbent.sheets.length;
  }
  if (candidate.cutCount !== incumbent.cutCount) {
    return candidate.cutCount < incumbent.cutCount;
  }
  if (Math.abs(candidate.wasteArea - incumbent.wasteArea) > 1e-9) {
    return candidate.wasteArea < incumbent.wasteArea;
  }
  return false; // Ties keep the earlier strategy.
}

/**
 * Pack one material group.
 *
 * Runs every ordering strategy and keeps the best result by the comparator
 * above. Purely deterministic: same input, same output, every time.
 */
export function packMaterial({ material, parts, params, system = 'imperial' }) {
  const expanded = expandParts(material, parts);

  // A part left with a blank or zero measurement never reaches the guillotine
  // tree: fitsSomewhere() and fits() treat a zero length as always fitting, so
  // without this guard such a part gets a real placement with a zero-length
  // side, and cutStepsFor turns that into a step like "crosscut at 0 in" that
  // breaks the numbered sequence at the saw. Rejecting it here, before any
  // strategy runs, means every strategy sees the same well-formed queue.
  const instances = [];
  const blankDimensionRejects = [];
  for (const instance of expanded) {
    if (gtz(instance.widthIn) && gtz(instance.lengthIn)) {
      instances.push(instance);
    } else {
      blankDimensionRejects.push({
        ...instance,
        reason: 'has a blank or zero width or length and cannot be cut',
      });
    }
  }

  const context = { material, instances, params, system };

  let best = null;
  for (const strategy of STRATEGIES) {
    const result = runStrategy(strategy, context);
    if (best === null || isBetter(result, best)) best = result;
  }
  return {
    ...best,
    unplaceable: [...blankDimensionRejects, ...best.unplaceable],
  };
}

export { STRATEGIES } from './strategies.js';
export { cutStepsFor } from './cutlist.js';
