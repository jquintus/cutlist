// One place that runs every invariant over a packed sheet. Every test that
// produces a layout goes through this rather than calling the validators
// itself, so adding an invariant later covers the whole suite at once.

import assert from 'node:assert/strict';
import { validateSheet } from '../../src/packer/invariants.js';

export function assertValidLayout(sheetPlan, params, parts, label = '') {
  const violations = validateSheet({
    sheet: sheetPlan,
    usable: sheetPlan.usable,
    placements: sheetPlan.placements,
    kerfIn: params.kerfIn,
    parts,
  });
  assert.deepEqual(violations, [], `${label || sheetPlan.label} violated: ${violations.join('; ')}`);
}
