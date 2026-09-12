// Float length helpers. Every length in this project is a float number of
// inches, so every comparison has to go through these. Without the epsilon a
// 48.0 in part gets rejected from a 48.0 in sheet by accumulated float error.

export const EPS = 1e-6;

/** True when `need` fits inside `avail`, tolerating float drift. */
export function fits(need, avail) {
  return need <= avail + EPS;
}

/** True when a dimension is meaningfully greater than zero. */
export function gtz(value) {
  return value > EPS;
}

/**
 * Canonical string form of a coordinate or dimension.
 *
 * Both renderers use this so the SVG's data- attributes and the print table's
 * rows are byte-identical strings, which is what makes the parity test a plain
 * deep equal instead of a float comparison.
 */
export function coordStr(value) {
  return value.toFixed(4);
}
