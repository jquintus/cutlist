// Validation chain.
//
// One ordered list of small checks, each of which either passes or names the
// first thing wrong. File import, share-link restore and the in-repo project
// fetch all run this same chain, so a payload that would be rejected from one
// direction is rejected from all three.

import { SCHEMA_VERSION, normalizeProject } from '../model.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finitePositive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0;
}

function finiteNonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0;
}

function safeHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function hasObjectShape(raw) {
  if (!isPlainObject(raw)) {
    return { field: 'project', message: 'That file is not a cutlist project.' };
  }
  return null;
}

function schemaVersionSupported(raw) {
  const version = Number(raw.schemaVersion);
  if (!Number.isFinite(version)) {
    return { field: 'schemaVersion', message: 'That project has no schema version, so it cannot be read safely.' };
  }
  if (version > SCHEMA_VERSION) {
    return {
      field: 'schemaVersion',
      message: `That project was saved by a newer version of cutlist (schema ${version}, this build reads ${SCHEMA_VERSION}).`,
    };
  }
  if (![1, 2, SCHEMA_VERSION].includes(version)) {
    return {
      field: 'schemaVersion',
      message: `That project uses schema ${version}, which this build no longer reads.`,
    };
  }
  return null;
}

function inventoryRefWellFormed(stock, materialName) {
  if (stock.inventoryRef === undefined) return null;
  if (!isPlainObject(stock.inventoryRef)
      || typeof stock.inventoryRef.file !== 'string'
      || stock.inventoryRef.file.trim() === ''
      || typeof stock.inventoryRef.materialId !== 'string'
      || stock.inventoryRef.materialId.trim() === ''
      || typeof stock.inventoryRef.stockId !== 'string'
      || stock.inventoryRef.stockId.trim() === '') {
    return { field: 'materials', message: `Material group "${materialName}" has stock with a damaged library reference.` };
  }
  return null;
}

function materialsWellFormed(raw) {
  if (raw.materials !== undefined && !Array.isArray(raw.materials)) {
    return { field: 'materials', message: 'The material groups are not a list.' };
  }
  for (const material of raw.materials ?? []) {
    if (!isPlainObject(material)) {
      return { field: 'materials', message: 'One of the material groups is not an object.' };
    }
    if (material.kind !== undefined && material.kind !== 'sheet' && material.kind !== 'board') {
      return { field: 'materials', message: `Material group "${material.name}" has an unknown kind.` };
    }
    if (material.kind === 'board' && !finitePositive(material.widthIn)) {
      return { field: 'materials', message: `Board material group "${material.name}" has a width that is not a positive number.` };
    }
    if (material.sheets !== undefined && !Array.isArray(material.sheets)) {
      return { field: 'materials', message: `Material group "${material.name}" has a sheet list that is not a list.` };
    }
    if (material.boards !== undefined && !Array.isArray(material.boards)) {
      return { field: 'materials', message: `Material group "${material.name}" has a board list that is not a list.` };
    }
    if (material.kind === 'board' && (material.sheets?.length ?? 0) > 0) {
      return { field: 'materials', message: `Board material group "${material.name}" also contains sheet stock. Split it into separate material groups.` };
    }
    if (material.kind !== 'board' && (material.boards?.length ?? 0) > 0) {
      return { field: 'materials', message: `Sheet material group "${material.name}" also contains board stock. Mark it as a board or split the stock into separate groups.` };
    }
    for (const sheet of material.sheets ?? []) {
      if (!isPlainObject(sheet)) {
        return { field: 'materials', message: `Material group "${material.name}" has a sheet entry that is not an object.` };
      }
      if (!finitePositive(sheet.widthIn) || !finitePositive(sheet.lengthIn)) {
        return { field: 'materials', message: `Material group "${material.name}" has a sheet with a width or length that is not a positive number.` };
      }
      if (!nonNegativeInteger(sheet.qty)) {
        return { field: 'materials', message: `Material group "${material.name}" has a sheet quantity that is not a whole number. Use 0 for a sheet you still need to buy.` };
      }
      const refError = inventoryRefWellFormed(sheet, material.name);
      if (refError !== null) return refError;
    }
    for (const board of material.boards ?? []) {
      if (!isPlainObject(board)) {
        return { field: 'materials', message: `Material group "${material.name}" has a board entry that is not an object.` };
      }
      if (!finitePositive(board.lengthIn)) {
        return { field: 'materials', message: `Material group "${material.name}" has a board with a length that is not a positive number.` };
      }
      if (!nonNegativeInteger(board.qty)) {
        return { field: 'materials', message: `Material group "${material.name}" has a board quantity that is not a whole number. Use 0 for a board you still need to buy.` };
      }
      const refError = inventoryRefWellFormed(board, material.name);
      if (refError !== null) return refError;
    }
  }
  return null;
}

function libraryWellFormed(raw) {
  if (raw.library !== undefined && typeof raw.library !== 'boolean') {
    return { field: 'library', message: 'The library flag is not true or false.' };
  }
  return null;
}

/**
 * How a message points at a part.
 *
 * A part typed in but not named yet is ordinary, and these messages are read
 * by whoever is about to fix the project, so an unnamed part has to be
 * described rather than quoted as an empty pair of quotes.
 */
function partNamed(part) {
  const name = typeof part.name === 'string' ? part.name.trim() : '';
  return name === '' ? 'A part with no name yet' : `Part "${name}"`;
}

function partsWellFormed(raw) {
  if (raw.parts !== undefined && !Array.isArray(raw.parts)) {
    return { field: 'parts', message: 'The parts list is not a list.' };
  }
  const declared = new Set((raw.materials ?? []).map((material) => material?.id));
  for (const part of raw.parts ?? []) {
    if (!isPlainObject(part)) {
      return { field: 'parts', message: 'One of the parts is not an object.' };
    }
    if (!finitePositive(part.widthIn) || !finitePositive(part.lengthIn)) {
      return { field: 'parts', message: `${partNamed(part)} has a width or length that is not a positive number.` };
    }
    if (!finiteNonNegative(part.qty)) {
      return { field: 'parts', message: `${partNamed(part)} has a quantity that is not a number.` };
    }
    // Told apart on purpose. A part that names a group this project has never
    // heard of is a broken file; a part that names no group at all is the
    // ordinary case of adding a part before there is a group to put it in, and
    // saying so is what tells someone which of the two to fix.
    if (part.materialId === undefined || part.materialId === null || String(part.materialId).trim() === '') {
      return { field: 'parts', message: `${partNamed(part)} is not in any material group. Add a material group and assign it.` };
    }
    if (!declared.has(part.materialId)) {
      return { field: 'parts', message: `${partNamed(part)} is assigned to material group "${part.materialId}", which this project does not declare.` };
    }
  }
  return null;
}

function unplannedWellFormed(raw) {
  if (raw.unplanned !== undefined && !Array.isArray(raw.unplanned)) {
    return { field: 'unplanned', message: 'The not-planned list is not a list.' };
  }
  for (const item of raw.unplanned ?? []) {
    if (!isPlainObject(item)) {
      return { field: 'unplanned', message: 'One of the not-planned items is not an object.' };
    }
    if (typeof item.name !== 'string' || item.name.trim() === '') {
      return { field: 'unplanned', message: 'A not-planned item has no name.' };
    }
  }
  return null;
}

function suppliesWellFormed(raw) {
  if (raw.supplies !== undefined && !Array.isArray(raw.supplies)) {
    return { field: 'supplies', message: 'The supplies are not a list.' };
  }
  const ids = new Set();
  for (const supply of raw.supplies ?? []) {
    if (!isPlainObject(supply)) {
      return { field: 'supplies', message: 'One of the supplies is not an object.' };
    }
    if (supply.name !== undefined && typeof supply.name !== 'string') {
      return { field: 'supplies', message: 'A supply has a name that is not text.' };
    }
    const label = supply.name?.trim() || 'Unnamed';
    if (supply.qty !== undefined && !positiveInteger(supply.qty)) {
      return { field: 'supplies', message: `Supply "${label}" needs a positive whole-number quantity.` };
    }
    if (supply.packQty !== undefined && !positiveInteger(supply.packQty)) {
      return { field: 'supplies', message: `Supply "${label}" needs a positive whole-number per-pack quantity.` };
    }
    for (const field of ['unit', 'price', 'note', 'url']) {
      if (supply[field] !== undefined && typeof supply[field] !== 'string') {
        return { field: 'supplies', message: `Supply "${label}" has a ${field} that is not text.` };
      }
    }
    if (supply.onHand !== undefined && typeof supply.onHand !== 'boolean') {
      return { field: 'supplies', message: `Supply "${label}" has an on-hand value that is not true or false.` };
    }
    if (supply.url !== undefined && supply.url !== '' && !safeHttpUrl(supply.url)) {
      return { field: 'supplies', message: `Supply "${label}" has a link that is not an http or https URL.` };
    }
    const id = supply.id === undefined || supply.id === null ? '' : String(supply.id);
    if (id !== '' && ids.has(id)) {
      return { field: 'supplies', message: `More than one supply uses the id "${id}".` };
    }
    if (id !== '') ids.add(id);
  }
  return null;
}

function paramsWellFormed(raw) {
  if (raw.params === undefined) return null;
  if (!isPlainObject(raw.params)) {
    return { field: 'params', message: 'The cutting parameters are not an object.' };
  }
  if (raw.params.kerfIn !== undefined && !finiteNonNegative(raw.params.kerfIn)) {
    return { field: 'params', message: 'The kerf must be zero or a positive number of inches.' };
  }
  if (raw.params.edgeTrimIn !== undefined && !finiteNonNegative(raw.params.edgeTrimIn)) {
    return { field: 'params', message: 'The edge trim must be zero or a positive number of inches.' };
  }
  return null;
}

/** Ordered. The first check that fails is the one reported. */
export const VALIDATORS = Object.freeze([
  hasObjectShape,
  schemaVersionSupported,
  libraryWellFormed,
  materialsWellFormed,
  partsWellFormed,
  suppliesWellFormed,
  unplannedWellFormed,
  paramsWellFormed,
]);

/**
 * Run the chain.
 *
 * Returns { ok: true, project } with a normalized project, or
 * { ok: false, field, message }. Never throws and never touches live state.
 */
export function validateProject(raw) {
  for (const validator of VALIDATORS) {
    const failure = validator(raw);
    if (failure !== null) return { ok: false, ...failure };
  }
  return { ok: true, project: normalizeProject(raw) };
}
