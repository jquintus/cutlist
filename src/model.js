// The canonical project shape. Everything downstream computes over this and
// nothing else re-parses raw user input.

export const SCHEMA_VERSION = 1;

export const DEFAULT_KERF_IN = 0.125;
export const DEFAULT_EDGE_TRIM_IN = 0;

/** Fallback group colors, cycled in material order so a project looks the same on every load. */
const MATERIAL_COLORS = Object.freeze([
  '#2f6f9f', '#b1591f', '#3f7f4f', '#8a4f9e', '#a03b4f', '#4f5f8f',
]);

/**
 * A project with nothing in it.
 * `unplanned` exists from the start so out-of-scope stock always has somewhere
 * to live that the packer is never handed.
 */
export function newProject({ now = () => new Date() } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: '',
    // Today, because the machine already knows it and a blank date is one more
    // field to fill in for something nobody wants to type.
    date: now().toISOString().slice(0, 10),
    notes: '',
    displaySystem: 'imperial',
    params: { kerfIn: DEFAULT_KERF_IN, edgeTrimIn: DEFAULT_EDGE_TRIM_IN },
    materials: [],
    parts: [],
    unplanned: [],
  };
}

function str(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function num(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function intAtLeast(value, minimum, fallback) {
  const parsed = Math.trunc(num(value, fallback));
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * Fill defaults, assign missing ids, and coerce numeric strings.
 *
 * Ids are assigned from positional counters rather than anything random, so
 * normalizing the same input twice gives the same ids and the packer stays
 * reproducible.
 *
 * Never mutates `raw`.
 */
export function normalizeProject(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rawParams = source.params && typeof source.params === 'object' ? source.params : {};

  const materials = arr(source.materials).map((rawMaterial, materialIndex) => {
    const material = rawMaterial && typeof rawMaterial === 'object' ? rawMaterial : {};
    const materialId = str(material.id) || `m${materialIndex + 1}`;
    return {
      id: materialId,
      name: str(material.name, `Material ${materialIndex + 1}`),
      thicknessIn: num(material.thicknessIn, 0),
      thicknessLabel: str(material.thicknessLabel),
      color: str(material.color) || MATERIAL_COLORS[materialIndex % MATERIAL_COLORS.length],
      sheets: arr(material.sheets).map((rawSheet, sheetIndex) => {
        const sheet = rawSheet && typeof rawSheet === 'object' ? rawSheet : {};
        return {
          id: str(sheet.id) || `${materialId}s${sheetIndex + 1}`,
          label: str(sheet.label),
          widthIn: num(sheet.widthIn, 0),
          lengthIn: num(sheet.lengthIn, 0),
          qty: intAtLeast(sheet.qty, 0, 0),
          note: str(sheet.note),
        };
      }),
    };
  });

  const parts = arr(source.parts).map((rawPart, partIndex) => {
    const part = rawPart && typeof rawPart === 'object' ? rawPart : {};
    return {
      id: str(part.id) || `p${partIndex + 1}`,
      name: str(part.name, `Part ${partIndex + 1}`),
      qty: intAtLeast(part.qty, 0, 1),
      widthIn: num(part.widthIn, 0),
      lengthIn: num(part.lengthIn, 0),
      materialId: str(part.materialId),
      grainLocked: part.grainLocked === true,
    };
  });

  const unplanned = arr(source.unplanned).map((rawItem) => {
    const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
    return {
      name: str(item.name, 'Unplanned item'),
      qty: intAtLeast(item.qty, 0, 1),
      note: str(item.note),
    };
  });

  return {
    schemaVersion: num(source.schemaVersion, SCHEMA_VERSION),
    name: str(source.name),
    date: str(source.date),
    notes: str(source.notes),
    displaySystem: source.displaySystem === 'metric' ? 'metric' : 'imperial',
    params: {
      kerfIn: num(rawParams.kerfIn, DEFAULT_KERF_IN),
      edgeTrimIn: num(rawParams.edgeTrimIn, DEFAULT_EDGE_TRIM_IN),
    },
    materials,
    parts,
    unplanned,
  };
}

/**
 * Stamp the metadata every saved copy of a project carries: the schema
 * version it was written under, and the date it was first saved (never
 * overwritten once set). Every path that turns a live project into a stored
 * one goes through this, so a project saved by the one-click Direct Upload
 * button shows up in the shared project list dated exactly like one saved
 * through a manual export.
 *
 * `now` is injectable so a test gets a fixed date instead of today's.
 */
export function stampForSave(project, { now = () => new Date() } = {}) {
  return {
    ...project,
    schemaVersion: SCHEMA_VERSION,
    date: project.date || now().toISOString().slice(0, 10),
  };
}

/** A, B, ... Z, AA, AB, ... so a group with more than 26 part types still gets unique labels. */
export function letterFor(index) {
  let remaining = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
}

/**
 * Turn the parts belonging to one material group into individual instances.
 *
 * Labels restart per material group and are stable for a given project, so
 * the letter on the diagram matches the letter on the printed cut list.
 */
export function expandParts(material, parts) {
  const mine = arr(parts).filter((part) => part.materialId === material.id);
  const instances = [];
  mine.forEach((part, partIndex) => {
    const letter = letterFor(partIndex);
    for (let copy = 1; copy <= part.qty; copy += 1) {
      instances.push({
        partId: part.id,
        label: `${letter}${copy}`,
        name: part.name,
        widthIn: part.widthIn,
        lengthIn: part.lengthIn,
        grainLocked: part.grainLocked,
        materialId: part.materialId,
      });
    }
  });
  return instances;
}
