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

function finiteNonNegative(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
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
  if (version !== SCHEMA_VERSION) {
    return {
      field: 'schemaVersion',
      message: `That project uses schema ${version}, which this build no longer reads.`,
    };
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
    if (material.sheets !== undefined && !Array.isArray(material.sheets)) {
      return { field: 'materials', message: `Material group "${material.name}" has a sheet list that is not a list.` };
    }
    for (const sheet of material.sheets ?? []) {
      if (!isPlainObject(sheet)) {
        return { field: 'materials', message: `Material group "${material.name}" has a sheet entry that is not an object.` };
      }
      if (!finitePositive(sheet.widthIn) || !finitePositive(sheet.lengthIn)) {
        return { field: 'materials', message: `Material group "${material.name}" has a sheet with a width or length that is not a positive number.` };
      }
      if (!finiteNonNegative(sheet.qty)) {
        return { field: 'materials', message: `Material group "${material.name}" has a sheet quantity that is not a number. Use 0 for a sheet you still need to buy.` };
      }
    }
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
  materialsWellFormed,
  partsWellFormed,
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
