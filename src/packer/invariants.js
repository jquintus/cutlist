// Layout validators.
//
// These take only the finished rectangles. They deliberately know nothing
// about the tree the packer used to produce them, so a test that runs these
// over a packed sheet is checking the layout rather than restating the data
// structure that built it. Runtime and the test suite share this one file.
//
// Each validator returns an array of human-readable violations. Empty means
// valid.

import { EPS } from '../geometry.js';

function overlap1d(aStart, aSize, bStart, bSize) {
  return Math.min(aStart + aSize, bStart + bSize) - Math.max(aStart, bStart);
}

function gap1d(aStart, aSize, bStart, bSize) {
  return Math.max(aStart, bStart) - Math.min(aStart + aSize, bStart + bSize);
}

/** No two placements may occupy the same material. */
export function checkNoOverlap({ placements }) {
  const violations = [];
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      const dx = overlap1d(a.x, a.w, b.x, b.w);
      const dy = overlap1d(a.y, a.h, b.y, b.h);
      if (dx > EPS && dy > EPS) {
        violations.push(`${a.label} and ${b.label} overlap by ${dx.toFixed(4)} x ${dy.toFixed(4)} in`);
      }
    }
  }
  return violations;
}

/** Every placement sits inside the trimmed usable region of the sheet. */
export function checkInBounds({ usable, placements }) {
  const violations = [];
  for (const p of placements) {
    if (p.x < usable.x - EPS
      || p.y < usable.y - EPS
      || p.x + p.w > usable.x + usable.w + EPS
      || p.y + p.h > usable.y + usable.h + EPS) {
      violations.push(`${p.label} is outside the usable area of the sheet`);
    }
  }
  return violations;
}

/**
 * Neighbors must be a blade apart.
 *
 * Two placements that overlap on one axis have to be separated by at least
 * the kerf on the other, because the blade has to pass between them. With a
 * nonzero kerf, touching is a violation.
 */
export function checkKerf({ placements, kerfIn }) {
  const violations = [];
  if (!(kerfIn > EPS)) return violations;
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      if (overlap1d(a.x, a.w, b.x, b.w) > EPS) {
        const gap = gap1d(a.y, a.h, b.y, b.h);
        if (gap < kerfIn - EPS) {
          violations.push(`${a.label} and ${b.label} are ${gap.toFixed(4)} in apart vertically, less than the ${kerfIn} in kerf`);
        }
      }
      if (overlap1d(a.y, a.h, b.y, b.h) > EPS) {
        const gap = gap1d(a.x, a.w, b.x, b.w);
        if (gap < kerfIn - EPS) {
          violations.push(`${a.label} and ${b.label} are ${gap.toFixed(4)} in apart horizontally, less than the ${kerfIn} in kerf`);
        }
      }
    }
  }
  return violations;
}

/** The position field and size field a rectangle uses along one axis. */
function axisKeys(axis) {
  return axis === 'x' ? { key: 'x', size: 'w' } : { key: 'y', size: 'h' };
}

/** Candidate separator positions along one axis: the far edges of the rectangles. */
function candidateLines(rects, axis) {
  const { key, size } = axisKeys(axis);
  const values = new Set();
  for (const r of rects) values.add(r[key] + r[size]);
  return [...values].sort((a, b) => a - b);
}

/**
 * Can these rectangles be separated by full edge-to-edge cuts?
 *
 * Tries every candidate line on both axes and recurses on both sides, so a
 * layout that needs an unobvious first cut is still recognized. Rectangle
 * counts per sheet are in the tens, so the backtracking is cheap.
 */
function separable(rects, region) {
  if (rects.length <= 1) return true;

  for (const axis of ['x', 'y']) {
    const { key, size } = axisKeys(axis);
    const regionStart = region[key];
    const regionSize = region[size];
    for (const line of candidateLines(rects, axis)) {
      if (line <= regionStart + EPS || line >= regionStart + regionSize - EPS) continue;
      const straddles = rects.some((r) => r[key] < line - EPS && r[key] + r[size] > line + EPS);
      if (straddles) continue;
      const near = rects.filter((r) => r[key] + r[size] <= line + EPS);
      const far = rects.filter((r) => r[key] >= line - EPS);
      if (near.length === 0 || far.length === 0) continue;
      if (near.length + far.length !== rects.length) continue;

      const nearRegion = { ...region, [key]: regionStart, [size]: line - regionStart };
      const farRegion = { ...region, [key]: line, [size]: regionStart + regionSize - line };
      if (separable(near, nearRegion) && separable(far, farRegion)) return true;
    }
  }
  return false;
}

/**
 * The layout must be reachable with edge-to-edge cuts only.
 *
 * Re-derived from the placement rectangles alone. Being independent of the
 * structure that produced the layout is the entire point of this validator,
 * so it must never be rewritten to read the packer's own tree.
 */
export function checkGuillotine({ usable, placements }) {
  const rects = placements.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
  if (separable(rects, { ...usable })) return [];
  return ['this sheet cannot be cut with edge-to-edge cuts alone'];
}

/** A part whose grain direction is locked must never be laid out rotated. */
export function checkGrainLock({ placements, parts }) {
  const violations = [];
  const lockedById = new Map();
  for (const part of parts ?? []) lockedById.set(part.id, part.grainLocked === true);
  for (const p of placements) {
    const locked = p.grainLocked === true || lockedById.get(p.partId) === true;
    if (locked && p.rotated === true) {
      violations.push(`${p.label} (${p.name}) is grain locked but was rotated`);
    }
  }
  return violations;
}

/** Board placements occupy distinct intervals inside the trimmed stock. */
export function checkBoardNoOverlap({ placements }) {
  const violations = [];
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      if (overlap1d(a.startIn, a.lengthIn, b.startIn, b.lengthIn) > EPS) {
        violations.push(`${a.label} and ${b.label} overlap on the board`);
      }
    }
  }
  return violations;
}

/** Every board placement lies inside its trimmed usable interval. */
export function checkBoardInBounds({ usable, placements }) {
  const violations = [];
  for (const placement of placements) {
    if (placement.startIn < usable.startIn - EPS
      || placement.startIn + placement.lengthIn > usable.startIn + usable.lengthIn + EPS) {
      violations.push(`${placement.label} is outside the usable length of the board`);
    }
  }
  return violations;
}

/** Adjacent board parts must leave the full blade width between them. */
export function checkBoardKerf({ placements, kerfIn }) {
  if (!(kerfIn > EPS)) return [];
  const ordered = [...placements].sort((a, b) => a.startIn - b.startIn);
  const violations = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const gap = current.startIn - (previous.startIn + previous.lengthIn);
    if (gap < kerfIn - EPS) {
      violations.push(`${previous.label} and ${current.label} are ${gap.toFixed(4)} in apart, less than the ${kerfIn} in kerf`);
    }
  }
  return violations;
}

/** Board stock is final width; this planner never implies an unlisted rip. */
export function checkBoardWidth({ placements, materialWidthIn }) {
  const violations = [];
  for (const placement of placements) {
    if (Math.abs(placement.widthIn - materialWidthIn) > EPS) {
      violations.push(`${placement.label} is ${placement.widthIn} in wide on ${materialWidthIn} in final-width stock`);
    }
  }
  return violations;
}

/** Parts, blade loss and named offcuts account for the entire usable board. */
export function checkBoardConservation({ board }) {
  const parts = board.placements.reduce((sum, placement) => sum + placement.lengthIn, 0);
  const kerfs = board.cuts.reduce((sum, cut) => sum + cut.kerfConsumedIn, 0);
  const offcuts = board.offcuts.reduce((sum, offcut) => sum + offcut.lengthIn, 0);
  const accounted = parts + kerfs + offcuts;
  if (Math.abs(accounted - board.usable.lengthIn) <= EPS) return [];
  return [`parts, kerfs and offcuts account for ${accounted.toFixed(4)} in of ${board.usable.lengthIn.toFixed(4)} usable inches`];
}

/** Cut numbering is gapless and every crosscut lands within the usable board. */
export function checkBoardCuts({ board }) {
  const violations = [];
  const start = board.usable.startIn;
  const end = start + board.usable.lengthIn;
  const cutsByPart = new Map();
  for (const [index, cut] of board.cuts.entries()) {
    if (cut.seq !== index + 1) violations.push(`cut ${cut.seq} is out of sequence`);
    if (cut.kind !== 'crosscut') violations.push(`cut ${cut.seq} is not a crosscut`);
    if (!(cut.atIn > EPS)) violations.push(`cut ${cut.seq} has no positive measurement`);
    if (cut.lineIn <= start + EPS || cut.lineIn >= end - EPS) {
      violations.push(`cut ${cut.seq} lands outside the usable board`);
    }
    const placement = board.placements.find((part) => part.label === cut.partLabel);
    if (placement === undefined) {
      violations.push(`cut ${cut.seq} does not identify the part it frees`);
    } else {
      if (Math.abs(cut.atIn - placement.lengthIn) > EPS) {
        violations.push(`cut ${cut.seq} does not use ${placement.label}'s length as its measurement`);
      }
      if (Math.abs(cut.lineIn - (placement.startIn + placement.lengthIn)) > EPS) {
        violations.push(`cut ${cut.seq} is not drawn at the end of ${placement.label}`);
      }
      cutsByPart.set(placement.label, (cutsByPart.get(placement.label) ?? 0) + 1);
    }
  }
  for (const placement of board.placements) {
    const needsCut = placement.startIn + placement.lengthIn < end - EPS;
    const count = cutsByPart.get(placement.label) ?? 0;
    if (needsCut && count !== 1) {
      violations.push(`${placement.label} requires one crosscut but has ${count}`);
    }
    if (!needsCut && count !== 0) {
      violations.push(`${placement.label} ends with the board but has an unnecessary crosscut`);
    }
  }
  return violations;
}

export const BOARD_VALIDATORS = Object.freeze([
  checkBoardNoOverlap,
  checkBoardInBounds,
  checkBoardKerf,
  checkBoardWidth,
  checkBoardConservation,
  checkBoardCuts,
]);

/** Run every one-dimensional validator over one board layout. */
export function validateBoard(context) {
  return BOARD_VALIDATORS.flatMap((validator) => validator(context));
}

export const VALIDATORS = Object.freeze([
  checkNoOverlap,
  checkInBounds,
  checkKerf,
  checkGuillotine,
  checkGrainLock,
]);

/** Run every validator over one sheet layout. */
export function validateSheet(context) {
  return VALIDATORS.flatMap((validator) => validator(context));
}

/** Run every validator over every sheet of a finished plan. */
export function validatePlan(plan) {
  const violations = [];
  for (const materialPlan of plan.materials ?? []) {
    if (materialPlan.kind === 'board') {
      for (const board of materialPlan.boards ?? []) {
        const boardViolations = validateBoard({
          board,
          usable: board.usable,
          placements: board.placements,
          kerfIn: plan.params.kerfIn,
          materialWidthIn: materialPlan.widthIn,
        });
        for (const violation of boardViolations) {
          violations.push(`${materialPlan.name} / ${board.label}: ${violation}`);
        }
      }
      continue;
    }
    for (const sheet of materialPlan.sheets ?? []) {
      const sheetViolations = validateSheet({
        sheet,
        usable: sheet.usable,
        placements: sheet.placements,
        kerfIn: plan.params.kerfIn,
        parts: materialPlan.parts,
      });
      for (const violation of sheetViolations) {
        violations.push(`${materialPlan.name} / ${sheet.label}: ${violation}`);
      }
    }
  }
  return violations;
}
