// Normalizer: imperial fractions, metric millimeters and arbitrary custom
// values all arrive at the rest of the app as the same thing, a float number
// of inches. A custom value is not a separate code path; entry builds a
// preset-shaped object for it so everything downstream sees one shape.

const MM_PER_INCH = 25.4;

/** Units accepted at the entry boundary. */
export const UNITS = Object.freeze(['in', 'mm']);

/**
 * Convert an entered value to inches.
 * Throws on an unknown unit rather than guessing, because a silently wrong
 * unit here becomes a wrongly sized part at the saw.
 */
export function toInches(value, unit) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`toInches: value is not a finite number: ${value}`);
  }
  if (unit === 'in') return numeric;
  if (unit === 'mm') return numeric / MM_PER_INCH;
  throw new RangeError(`toInches: unknown unit "${unit}" (expected one of ${UNITS.join(', ')})`);
}

function imperialThickness(sixteenths) {
  const inches = sixteenths / 16;
  return {
    id: `in-${sixteenths}-16`,
    label: formatLength(inches, 'imperial'),
    inches,
    system: 'imperial',
  };
}

function metricThickness(mm) {
  return {
    id: `mm-${mm}`,
    label: `${mm} mm`,
    inches: mm / MM_PER_INCH,
    system: 'metric',
  };
}

/** 1/8 in through 1 in in 1/8 steps, then the common metric sheet thicknesses. */
export const THICKNESS_PRESETS = Object.freeze([
  ...[2, 4, 6, 8, 10, 12, 14, 16].map(imperialThickness),
  ...[3, 4, 6, 9, 12, 15, 18, 25].map(metricThickness),
]);

/** Stock sheet sizes offered in the sheet picker. Custom sizes bypass this list. */
export const SHEET_PRESETS = Object.freeze([
  { id: '48x96', label: '48 x 96', widthIn: 48, lengthIn: 96 },
  { id: '48x48', label: '48 x 48', widthIn: 48, lengthIn: 48 },
  { id: '24x48', label: '24 x 48', widthIn: 24, lengthIn: 48 },
  { id: '60x60', label: '60 x 60 (Baltic birch)', widthIn: 60, lengthIn: 60 },
]);

/** Which display system a unit's values render in. */
function systemFor(unit) {
  return unit === 'mm' ? 'metric' : 'imperial';
}

/** Build a preset-shaped thickness from a value the user typed in. */
export function customThickness(value, unit) {
  const inches = toInches(value, unit);
  const system = systemFor(unit);
  return {
    id: `custom-${unit}-${value}`,
    label: formatLength(inches, system),
    inches,
    system,
  };
}

/**
 * What a thickness is called everywhere the project talks about it.
 *
 * Headings and the shopping list read a material's thickness label, never its
 * number of inches, so a thickness typed in by hand has to bring its own label
 * with it. Left to the preset's old label, the whole project goes on saying
 * 3/4 in over sheets that are something else, and the shopping list buys the
 * wrong plywood for every group. A thickness nobody has entered yet has no
 * label rather than a label reading zero.
 */
export function thicknessLabelFor(inches, system = 'imperial') {
  return Number.isFinite(inches) && inches > 0 ? formatLength(inches, system) : '';
}

/** Build a preset-shaped sheet size from values the user typed in. */
export function customSheet(widthValue, lengthValue, unit) {
  const widthIn = toInches(widthValue, unit);
  const lengthIn = toInches(lengthValue, unit);
  const system = systemFor(unit);
  return {
    id: `custom-${widthIn}x${lengthIn}`,
    label: `${formatLength(widthIn, system)} x ${formatLength(lengthIn, system)}`,
    widthIn,
    lengthIn,
  };
}

/**
 * Render a length for a human at the saw.
 * Imperial is a mixed fraction to the nearest 1/16, which is what a tape
 * measure actually reads. Metric is one decimal millimeter.
 */
export function formatLength(inches, system = 'imperial') {
  if (!Number.isFinite(inches)) {
    throw new TypeError(`formatLength: not a finite number: ${inches}`);
  }
  if (system === 'metric') {
    return `${(inches * MM_PER_INCH).toFixed(1)} mm`;
  }
  const sign = inches < 0 ? '-' : '';
  const sixteenths = Math.round(Math.abs(inches) * 16);
  const whole = Math.floor(sixteenths / 16);
  let numerator = sixteenths % 16;
  let denominator = 16;
  while (numerator !== 0 && numerator % 2 === 0) {
    numerator /= 2;
    denominator /= 2;
  }
  if (numerator === 0) return `${sign}${whole} in`;
  if (whole === 0) return `${sign}${numerator}/${denominator} in`;
  return `${sign}${whole} ${numerator}/${denominator} in`;
}
