// The one entry point the UI calls.
//
// planProject returns plain data. Nothing downstream re-derives a layout, so
// the color diagram and the black and white print table are looking at the
// same numbers by construction rather than by agreement.

import { packMaterial } from './packer/index.js';

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

  const materials = project.materials.map((material) => {
    if ((material.sheets ?? []).length === 0) {
      warnings.push(`Material group "${material.name}" lists no sheet size, so 48 x 96 was assumed for anything you need to buy.`);
    }
    const result = packMaterial({
      material,
      parts: project.parts,
      params: project.params,
      system: project.displaySystem,
    });
    const { buySpec } = result;

    return {
      materialId: material.id,
      name: material.name,
      thicknessIn: material.thicknessIn,
      thicknessLabel: material.thicknessLabel,
      note: material.note,
      color: material.color,
      sheets: result.sheets,
      onHandSheetCount: result.onHandSheetCount,
      // A shopping list, not an error. These sheets are packed and drawn
      // exactly like the ones already in the shop; only `source` differs.
      extraSheetsNeeded: result.sheets.filter((sheet) => sheet.source === 'to-buy').length,
      buySpec: { widthIn: buySpec.widthIn, lengthIn: buySpec.lengthIn, label: buySpec.label },
      unplaceable: result.unplaceable,
      strategyUsed: result.strategyUsed,
      // Carried so the invariant validators can cross check grain locks.
      parts: project.parts.filter((part) => part.materialId === material.id),
    };
  });

  for (const materialPlan of materials) {
    for (const instance of materialPlan.unplaceable) {
      warnings.push(`"${instance.name}" (${instance.label}) could not be laid out: it ${instance.reason}.`);
    }
  }

  return {
    projectName: project.name,
    date: project.date,
    notes: project.notes,
    displaySystem: project.displaySystem,
    params: project.params,
    materials,
    // Out of scope stock passes straight through. The packer is never handed
    // this array, which is why these items cannot end up on a sheet.
    unplanned: project.unplanned,
    warnings,
  };
}
