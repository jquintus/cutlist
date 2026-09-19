// Copy reusable stock into a project without making the project depend on the
// library afterward. The copied dimensions are the plan's permanent snapshot;
// inventoryRef is only provenance for a future reconciliation workflow.

const EPS = 1e-9;

function stockFor(material) {
  return material.kind === 'board' ? material.boards : material.sheets;
}

function sameMaterial(left, right) {
  if (left.kind !== right.kind) return false;
  if (Math.abs(left.thicknessIn - right.thicknessIn) > EPS) return false;
  return left.kind !== 'board' || Math.abs(left.widthIn - right.widthIn) <= EPS;
}

export function compatibleMaterialIds(project, libraryMaterial) {
  return project.materials
    .filter((material) => sameMaterial(material, libraryMaterial))
    .map((material) => material.id);
}

export function libraryStockRows(library) {
  return library.materials.flatMap((material) => stockFor(material)
    .filter((stock) => stock.qty > 0)
    .map((stock) => ({ material, stock })));
}

export function hasLibraryStock(project, sourceFile, materialId, stockId) {
  return project.materials.some((material) => stockFor(material).some((stock) =>
    stock.inventoryRef?.file === sourceFile
    && stock.inventoryRef?.materialId === materialId
    && stock.inventoryRef?.stockId === stockId));
}

function uniqueId(prefix, used) {
  let suffix = 1;
  let candidate = `${prefix}${suffix}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${prefix}${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

function newMaterialFrom(source, id) {
  return {
    id,
    name: source.name,
    kind: source.kind,
    thicknessIn: source.thicknessIn,
    thicknessLabel: source.thicknessLabel,
    widthIn: source.kind === 'board' ? source.widthIn : 0,
    note: source.note,
    color: source.color,
    sheets: [],
    boards: [],
  };
}

/**
 * Copy selected physical stock from a library into `project`.
 *
 * `selected` contains `{ materialId, stockId }` pairs. `targets` maps each
 * library material id to a compatible project material id, or to an empty
 * string to create a new material. Quantity-zero entries are purchase sizes,
 * not physical inventory, and follow a newly created material automatically.
 */
export function mergeLibraryStock(project, library, selected, targets, {
  sourceFile = 'storage.json',
} = {}) {
  const result = structuredClone(project);
  const wanted = new Set(selected.map(({ materialId, stockId }) => `${materialId}\0${stockId}`));
  const usedMaterialIds = new Set(result.materials.map((material) => material.id));
  const usedStockIds = new Set(result.materials.flatMap((material) => stockFor(material).map((stock) => stock.id)));
  const created = new Map();
  let copied = 0;

  for (const sourceMaterial of library.materials) {
    const chosen = stockFor(sourceMaterial)
      .filter((stock) => stock.qty > 0 && wanted.has(`${sourceMaterial.id}\0${stock.id}`));
    if (chosen.length === 0) continue;
    const duplicate = chosen.find((stock) => hasLibraryStock(result, sourceFile, sourceMaterial.id, stock.id));
    if (duplicate !== undefined) {
      return { ok: false, message: `That ${sourceMaterial.kind} stock is already in this project.` };
    }

    const requestedTarget = targets[sourceMaterial.id] ?? '';
    let target = result.materials.find((material) => material.id === requestedTarget);
    if (requestedTarget !== '' && target === undefined) {
      return { ok: false, message: 'The selected destination material no longer exists.' };
    }
    if (target !== undefined && !sameMaterial(target, sourceMaterial)) {
      return { ok: false, message: `"${sourceMaterial.name}" cannot be added to that material group.` };
    }
    const purchaseSpecs = stockFor(sourceMaterial).filter((stock) => stock.qty === 0);
    if ((target === undefined || !stockFor(target).some((stock) => stock.qty === 0))
        && purchaseSpecs.length === 0) {
      return {
        ok: false,
        message: `"${sourceMaterial.name}" needs a quantity-zero purchase size before its offcuts can be imported.`,
      };
    }
    if (target === undefined) {
      target = created.get(sourceMaterial.id);
      if (target === undefined) {
        const id = uniqueId('m', usedMaterialIds);
        target = newMaterialFrom(sourceMaterial, id);
        result.materials.push(target);
        created.set(sourceMaterial.id, target);

        // A quantity-zero row is the declared size to buy when the imported
        // offcuts run out. Without it, the largest offcut becomes the buy size.
        const targetStock = stockFor(target);
        for (const spec of purchaseSpecs) {
          targetStock.push({ ...structuredClone(spec), id: uniqueId(`${target.id}${sourceMaterial.kind === 'board' ? 'b' : 's'}`, usedStockIds) });
        }
      }
    }

    const targetStock = stockFor(target);
    if (!targetStock.some((stock) => stock.qty === 0)) {
      for (const spec of stockFor(sourceMaterial).filter((stock) => stock.qty === 0)) {
        targetStock.push({ ...structuredClone(spec), id: uniqueId(`${target.id}${sourceMaterial.kind === 'board' ? 'b' : 's'}`, usedStockIds) });
      }
    }
    for (const sourceStock of chosen) {
      targetStock.push({
        ...structuredClone(sourceStock),
        id: uniqueId(`${target.id}${sourceMaterial.kind === 'board' ? 'b' : 's'}`, usedStockIds),
        inventoryRef: { file: sourceFile, materialId: sourceMaterial.id, stockId: sourceStock.id },
      });
      copied += sourceStock.qty;
    }
  }

  return copied === 0
    ? { ok: false, message: 'Select at least one stock item.' }
    : { ok: true, project: result, copied };
}
