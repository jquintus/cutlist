// One-dimensional cutting-stock planner for final-width board stock.
//
// This deliberately shares no geometry with the sheet guillotine packer. A
// board has one usable dimension, every placement runs from the current end of
// the remaining board, and every non-exact placement is one real crosscut.

import { expandParts } from '../model.js';
import { EPS, fits, gtz } from '../geometry.js';
import { formatLength } from '../units.js';

function boardLabel(spec, system = 'imperial') {
  return spec.label || formatLength(spec.lengthIn, system);
}

/** The longest declared board is what this group buys when stock runs out. */
export function boardBuySpecFor(material, system = 'imperial') {
  const usable = (material.boards ?? []).filter((board) => gtz(board.lengthIn));
  if (usable.length === 0) return null;
  const longest = usable.reduce((best, board) =>
    (board.lengthIn > best.lengthIn + EPS ? board : best));
  return { ...longest, label: boardLabel(longest, system) };
}

function onHandSpecs(material, system) {
  const specs = [];
  for (const board of material.boards ?? []) {
    if (!gtz(board.lengthIn)) continue;
    for (let copy = 0; copy < board.qty; copy += 1) {
      specs.push({ ...board, label: boardLabel(board, system) });
    }
  }
  return specs;
}

function usableFor(spec) {
  // edgeTrimIn is a sheet-only parameter. Applying it here would silently
  // remove both board ends without emitting the two real crosscuts required
  // to make those trims.
  return { startIn: 0, lengthIn: spec.lengthIn };
}

function makeBin(spec, source) {
  const usable = usableFor(spec);
  return {
    spec,
    source,
    usable,
    cursorIn: usable.startIn,
    remainingIn: usable.lengthIn,
    placements: [],
    cuts: [],
  };
}

function place(bin, instance, kerfIn, system) {
  const startIn = bin.cursorIn;
  const endIn = startIn + instance.lengthIn;
  const remainderBeforeCut = Math.max(0, bin.remainingIn - instance.lengthIn);
  const needsCut = remainderBeforeCut > EPS;
  // A cut close to the stock's end can consume less than a full kerf within
  // the board: the rest of the blade is already beyond the end of the stock.
  const kerfConsumedIn = needsCut ? Math.min(Math.max(0, kerfIn), remainderBeforeCut) : 0;

  bin.placements.push({
    partId: instance.partId,
    label: instance.label,
    name: instance.name,
    startIn,
    lengthIn: instance.lengthIn,
    widthIn: instance.widthIn,
    grainLocked: instance.grainLocked,
  });

  if (needsCut) {
    const seq = bin.cuts.length + 1;
    const instruction = `${formatLength(instance.lengthIn, system)} from the left edge.`;
    const frees = `Frees ${instance.label} ${instance.name}.`.replace(/\s+\.$/, '.');
    bin.cuts.push({
      seq,
      kind: 'crosscut',
      atIn: instance.lengthIn,
      lineIn: endIn,
      referenceEdge: 'left',
      kerfConsumedIn,
      partLabel: instance.label,
      instruction,
      frees,
      note: `${instruction} ${frees}`,
    });
  }

  bin.cursorIn = endIn + kerfConsumedIn;
  bin.remainingIn = Math.max(0, remainderBeforeCut - kerfConsumedIn);
}

function finishBin(bin, number, materialWidthIn, system) {
  const offcuts = bin.remainingIn > EPS
    ? [{ startIn: bin.cursorIn, lengthIn: bin.remainingIn }]
    : [];
  return {
    boardSpecId: bin.spec.id ?? bin.spec.label,
    label: `Board ${number}: ${boardLabel(bin.spec, system)}`,
    source: bin.source,
    widthIn: materialWidthIn,
    lengthIn: bin.spec.lengthIn,
    usable: bin.usable,
    placements: bin.placements,
    offcuts,
    cuts: bin.cuts,
    wasteLengthIn: bin.remainingIn,
  };
}

/**
 * Pack a final-width board material with stable first-fit decreasing.
 *
 * On-hand bins are always searched before bought bins. Equal-length parts keep
 * their expanded project order, making the whole result deterministic.
 */
export function packBoardMaterial({ material, parts, params, system = 'imperial' }) {
  const expanded = expandParts(material, parts);
  const unplaceable = [];
  const candidates = [];

  for (const [index, instance] of expanded.entries()) {
    if (!gtz(instance.lengthIn)) {
      unplaceable.push({ ...instance, reason: 'has a blank or zero length and cannot be cut' });
    } else if (!gtz(instance.widthIn)) {
      unplaceable.push({ ...instance, reason: 'has a blank or zero width and cannot be cut' });
    } else if (Math.abs(instance.widthIn - material.widthIn) > EPS) {
      unplaceable.push({
        ...instance,
        reason: `is ${instance.widthIn} in wide but this final-width board stock is ${material.widthIn} in wide`,
      });
    } else {
      candidates.push({ instance, index });
    }
  }

  const buySpec = boardBuySpecFor(material, system);
  const onHand = onHandSpecs(material, system);
  const bins = onHand.map((spec) => makeBin(spec, 'on-hand'));

  const queue = candidates
    .sort((a, b) => b.instance.lengthIn - a.instance.lengthIn || a.index - b.index)
    .map(({ instance }) => instance);

  if (buySpec === null) {
    for (const instance of queue) {
      unplaceable.push({ ...instance, reason: 'has no valid board length declared for this material' });
    }
  } else {
    const buyUsable = usableFor(buySpec);
    for (const instance of queue) {
      let bin = bins.find((candidate) => fits(instance.lengthIn, candidate.remainingIn));
      if (bin === undefined) {
        if (!fits(instance.lengthIn, buyUsable.lengthIn)) {
          unplaceable.push({
            ...instance,
            reason: `does not fit an empty ${boardLabel(buySpec, system)} board`,
          });
          continue;
        }
        bin = makeBin(buySpec, 'to-buy');
        bins.push(bin);
      }
      place(bin, instance, params.kerfIn, system);
    }
  }

  const usedBins = bins.filter((bin) => bin.placements.length > 0);
  return {
    boards: usedBins.map((bin, index) => finishBin(bin, index + 1, material.widthIn, system)),
    unplaceable,
    strategyUsed: 'first-fit-decreasing',
    buySpec,
    onHandBoardCount: onHand.length,
  };
}
