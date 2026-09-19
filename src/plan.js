// The one entry point the UI calls.
//
// planProject returns plain data. Nothing downstream re-derives a layout, so
// the color diagram and the black and white print table are looking at the
// same numbers by construction rather than by agreement.

import { packMaterial } from './packer/index.js';
import { packBoardMaterial } from './packer/boards.js';

/**
 * Plan a whole project.
 *
 * Never throws. Conditions that a person should know about but that do not
 * stop the plan (a group with no sheet entry, a part pointing at a material
 * that is not declared) come back in `warnings` for the UI to show.
 */
export function planProject(project) {
  const warnings = [];
  const declaredIds = new Set(project.materials.map((material) => material.id));

  for (const part of project.parts) {
    if (!declaredIds.has(part.materialId)) {
      warnings.push(`Part "${part.name}" is assigned to a material group that does not exist, so it was not laid out.`);
    }
  }

  const materials = project.materials.map((material, materialIndex) => {
    const isBoard = material.kind === 'board';
    const result = (isBoard ? packBoardMaterial : packMaterial)({
      material,
      parts: project.parts,
      params: project.params,
      system: project.displaySystem,
    });
    const { buySpec } = result;

    const common = {
      materialId: material.id,
      kind: isBoard ? 'board' : 'sheet',
      // The repack control sits beside the diagram, and the action that swaps a
      // sheet's width and length addresses the group by position, so the plan
      // has to carry that position back out.
      materialIndex,
      name: material.name,
      thicknessIn: material.thicknessIn,
      thicknessLabel: material.thicknessLabel,
      note: material.note,
      color: material.color,
      unplaceable: result.unplaceable,
      strategyUsed: result.strategyUsed,
      // Carried so the invariant validators can cross check grain locks.
      parts: project.parts.filter((part) => part.materialId === material.id),
    };

    if (isBoard) {
      return {
        ...common,
        widthIn: material.widthIn,
        sheets: [],
        boards: result.boards,
        onHandBoardCount: result.onHandBoardCount,
        extraBoardsNeeded: result.boards.filter((board) => board.source === 'to-buy').length,
        buySpec: buySpec === null
          ? null
          : { widthIn: material.widthIn, lengthIn: buySpec.lengthIn, label: buySpec.label },
      };
    }

    return {
      ...common,
      sheets: result.sheets,
      boards: [],
      onHandSheetCount: result.onHandSheetCount,
      // A shopping list, not an error. These sheets are packed and drawn
      // exactly like the ones already in the shop; only `source` differs.
      extraSheetsNeeded: result.sheets.filter((sheet) => sheet.source === 'to-buy').length,
      buySpec: { widthIn: buySpec.widthIn, lengthIn: buySpec.lengthIn, label: buySpec.label },
    };
  });

  for (const materialPlan of materials) {
    for (const instance of materialPlan.unplaceable) {
      warnings.push(`"${instance.name}" (${instance.label}) could not be laid out: it ${instance.reason}.`);
    }
  }

  // Derived here, with the layout, not in a renderer: nothing downstream
  // re-derives a layout, and what to buy is part of the layout's result. One
  // entry per group that ran short, followed by the project's non-cut supplies.
  // That makes it a single list for the whole project rather than a banner per
  // group or a separate hardware list.
  const materialShoppingList = materials.flatMap((materialPlan) => {
    const qty = materialPlan.kind === 'board'
      ? materialPlan.extraBoardsNeeded
      : materialPlan.extraSheetsNeeded;
    if (!(qty > 0) || materialPlan.buySpec === null) return [];
    return [{
      kind: materialPlan.kind,
      materialId: materialPlan.materialId,
      name: materialPlan.name,
      thicknessLabel: materialPlan.thicknessLabel,
      qty,
      widthIn: materialPlan.buySpec.widthIn,
      lengthIn: materialPlan.buySpec.lengthIn,
      label: materialPlan.buySpec.label,
    }];
  });

  const supplyShoppingList = project.supplies
    .filter((supply) => !supply.onHand)
    .map((supply) => ({
      kind: 'supply',
      ...supply,
      buyQty: Math.ceil(supply.qty / supply.packQty),
    }));

  const shoppingList = [...materialShoppingList, ...supplyShoppingList];

  return {
    projectName: project.name,
    date: project.date,
    notes: project.notes,
    displaySystem: project.displaySystem,
    params: project.params,
    // The widest sheet in the project. Every diagram is drawn to the same
    // inches per pixel against it, so 25 in is the same length of line on every
    // picture: two sheets at different scales made comparing them a trap.
    widestSheetIn: Math.max(
      1,
      ...materials.flatMap((materialPlan) => (materialPlan.sheets ?? []).map((sheet) => sheet.widthIn)),
    ),
    // Board bars use a separate longitudinal scale. Comparing a board's length
    // with a sheet's width would make both diagrams less useful.
    widestBoardIn: Math.max(
      1,
      ...materials.flatMap((materialPlan) => (materialPlan.boards ?? []).map((board) => board.lengthIn)),
    ),
    materials,
    shoppingList,
    // Out of scope stock passes straight through. The packer is never handed
    // this array, which is why these items cannot end up on a sheet.
    unplanned: project.unplanned,
    warnings,
  };
}
