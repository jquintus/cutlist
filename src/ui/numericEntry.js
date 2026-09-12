// Reading a number out of a box someone is still typing into.
//
// A measurement is typed one character at a time, and on the way to a real
// value the text passes through states that are not yet a number: "17." on
// the way to 17.75, "3 1/" on the way to 3 1/2, "" while the box is being
// cleared to retype it. Reading those with Number() alone turns 17.75 into 17
// and 0.125 into 0 mid-keystroke, and because the form is redrawn from the
// project after every keystroke, that wrong number is written straight back
// into the box. The plan then carries a dimension nobody entered.
//
// So: text that does not yet say a number leaves the last number that was
// actually entered in place. A blank box is a box being edited, not a
// measurement of zero.
//
// Woodworkers write measurements as fractions, and this app prints them that
// way too: formatLength emits "17 3/4 in". Retyping exactly what the app shows
// you has to work, so mixed numbers, bare fractions, and a trailing unit are
// all read as the number they mean.

// A unit typed after the number, echoing what the app prints. Stripped, never
// converted: the box already belongs to the project's display system, so the
// text is the same system it is read back into.
const TRAILING_UNIT = /\s*(?:inches|inch|in|mm|cm|")$/i;

// Everything a number can look like before it is finished: empty, a lone
// minus sign, a bare decimal point, digits with the point typed but no
// decimals after it yet, or a fraction whose denominator is not typed yet.
const PARTIAL_ENTRY = /^-?(?:\d+\.|\.|\d+\s+|(?:\d+\s+)?\d+\s*\/\s*)?$/;

const MIXED_FRACTION = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/;
const BARE_FRACTION = /^(\d+)\s*\/\s*(\d+)$/;

/** Strip a trailing unit and collapse inner runs of whitespace. */
function normalize(text) {
  return String(text ?? '')
    .trim()
    .replace(TRAILING_UNIT, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Is this text a number still being typed rather than a finished one? */
export function isPartialNumber(text) {
  return PARTIAL_ENTRY.test(normalize(text));
}

/**
 * The number this text means, or null if it does not say one.
 *
 * Accepts a decimal ("17.75"), a bare fraction ("3/4"), and a mixed number
 * ("17 3/4"), each with an optional trailing unit. A zero denominator is not a
 * measurement, so it reads as nothing rather than as infinity.
 */
export function parseMeasurement(text) {
  const trimmed = normalize(text);
  if (trimmed === '') return null;

  const mixed = trimmed.match(MIXED_FRACTION);
  if (mixed) {
    const denominator = Number(mixed[3]);
    if (denominator === 0) return null;
    return Number(mixed[1]) + Number(mixed[2]) / denominator;
  }

  const fraction = trimmed.match(BARE_FRACTION);
  if (fraction) {
    const denominator = Number(fraction[2]);
    if (denominator === 0) return null;
    return Number(fraction[1]) / denominator;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The number a field's text means right now.
 *
 * Half-typed text means the digits typed so far ("17." is 17 on its way to
 * 17.75, "3 1/" is 3 on its way to 3 1/2). Text that carries no digits at all,
 * and text that is not a measurement, means the value is unchanged:
 * `previousValue` comes back untouched.
 */
export function readNumericEntry(text, previousValue) {
  const fallback = Number.isFinite(previousValue) ? previousValue : 0;
  const trimmed = normalize(text);

  // A half-typed entry counts as the digits typed so far, so the value tracks
  // the keystrokes instead of jumping back to the previous measurement.
  const candidate = isPartialNumber(trimmed)
    ? trimmed.replace(/\s*\/\s*$/, '').replace(/\.$/, '').replace(/\s+\d*$/, '').trim()
    : trimmed;
  if (candidate === '' || candidate === '-') return fallback;

  const parsed = parseMeasurement(candidate);
  return parsed === null ? fallback : parsed;
}

/**
 * What a numeric box shows after the form is redrawn.
 *
 * The form is rebuilt from the project on every keystroke, so without this the
 * box being typed into is overwritten by whatever the project holds so far:
 * type the point in "17.75" and the box goes back to "17", and the next
 * keystroke lands on the wrong text. A box someone is typing in keeps their
 * characters; every other box shows the project's number.
 *
 * `typedText` is null for a box that is not being typed in.
 */
export function entryText(typedText, modelValue) {
  return typedText === null || typedText === undefined ? String(modelValue) : typedText;
}
