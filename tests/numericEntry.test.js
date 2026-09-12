import test from 'node:test';
import assert from 'node:assert/strict';
import { isPartialNumber, readNumericEntry, entryText } from '../src/ui/numericEntry.js';

// Every keystroke of a measurement, in order, is what this has to survive.
function typeOut(text, startingValue) {
  const seen = [];
  let value = startingValue;
  for (let length = 1; length <= text.length; length += 1) {
    value = readNumericEntry(text.slice(0, length), value);
    seen.push(value);
  }
  return { value, seen };
}

test('a decimal inch survives every keystroke on the way to it', () => {
  const { value, seen } = typeOut('17.75', 48);
  assert.equal(value, 17.75);
  // The keystroke that types the point must not turn 17.75 into 17 and write
  // that back into the box.
  assert.deepEqual(seen, [1, 17, 17, 17.7, 17.75]);
});

test('a decimal kerf survives the point and does not collapse to zero', () => {
  const { value, seen } = typeOut('0.125', 0.125);
  assert.equal(value, 0.125);
  assert.deepEqual(seen, [0, 0, 0.1, 0.12, 0.125]);
});

test('a kerf typed without a leading zero still reads as a fraction', () => {
  assert.equal(readNumericEntry('.', 0.125), 0.125, 'a bare point keeps the last real value');
  assert.equal(readNumericEntry('.125', 0.125), 0.125);
});

test('clearing the box keeps the last number entered instead of snapping to zero', () => {
  assert.equal(readNumericEntry('', 30), 30);
  assert.equal(readNumericEntry('   ', 30), 30);
  assert.equal(readNumericEntry('-', 30), 30);
});

test('text that is not a number leaves the value alone', () => {
  assert.equal(readNumericEntry('abc', 30), 30);
  assert.equal(readNumericEntry('1/0', 30), 30, 'a zero denominator is not a measurement');
});

// The app prints measurements as mixed fractions, so retyping exactly what it
// shows has to land the same number. Reading these as unparseable would keep
// the previous dimension with nothing on screen to say the entry was ignored.
test('a fraction reads as the number it means', () => {
  assert.equal(readNumericEntry('3 1/2', 30), 3.5, 'a mixed number');
  assert.equal(readNumericEntry('17 3/4', 30), 17.75);
  assert.equal(readNumericEntry('3/4', 30), 0.75, 'a bare fraction');
  assert.equal(readNumericEntry('1/8', 30), 0.125);
});

// formatLength emits "17 3/4 in", and a phone keyboard makes the quote easy to
// hit, so the unit rides along with the number more often than not.
test('a trailing unit is stripped rather than rejected', () => {
  assert.equal(readNumericEntry('17 3/4 in', 30), 17.75);
  assert.equal(readNumericEntry('48"', 30), 48);
  assert.equal(readNumericEntry('450.8 mm', 30), 450.8);
  assert.equal(readNumericEntry('12 inches', 30), 12);
});

// A fraction is typed one character at a time like everything else, and the
// form is redrawn on each keystroke, so every intermediate state has to hold.
test('a fraction survives being typed one keystroke at a time', () => {
  let value = 0;
  for (let length = 1; length <= '17 3/4'.length; length += 1) {
    value = readNumericEntry('17 3/4'.slice(0, length), value);
  }
  assert.equal(value, 17.75);
});

test('a finished number replaces the previous one, zero included', () => {
  assert.equal(readNumericEntry('0', 30), 0, 'a typed zero is a real answer');
  assert.equal(readNumericEntry('96', 48), 96);
  assert.equal(readNumericEntry(' 23.5 ', 48), 23.5);
});

test('a missing previous value falls back to zero rather than NaN', () => {
  assert.equal(readNumericEntry('', undefined), 0);
  assert.equal(readNumericEntry('abc', Number.NaN), 0);
});

test('only half-typed text counts as partial', () => {
  for (const partial of ['', '  ', '-', '.', '-.', '17.', '-17.', '3 1/', '1/']) {
    assert.equal(isPartialNumber(partial), true, `${JSON.stringify(partial)} is still being typed`);
  }
  for (const finished of ['0', '17', '17.75', '.125', '-3.5', '3 1/2', '3/4']) {
    assert.equal(isPartialNumber(finished), false, `${JSON.stringify(finished)} is a finished number`);
  }
});

// The real loop: a keystroke lands on whatever the box currently shows, the
// project is read from that text, and then the whole form is redrawn. What
// the redraw puts back in the box decides whether the next keystroke lands on
// the right text.
function typeIntoTheForm(text, startingValue) {
  let modelValue = startingValue;
  let box = '';
  for (const character of text) {
    box += character;
    modelValue = readNumericEntry(box, modelValue);
    box = entryText(box, modelValue);
  }
  return { modelValue, box };
}

test('typing a decimal inch through the redraw loop lands the number that was typed', () => {
  const result = typeIntoTheForm('17.75', 48);
  assert.equal(result.modelValue, 17.75);
  assert.equal(result.box, '17.75', 'the box shows what was typed, not what the project rounded to');
});

test('typing a decimal kerf through the redraw loop lands the number that was typed', () => {
  assert.equal(typeIntoTheForm('0.125', 0.125).modelValue, 0.125);
  assert.equal(typeIntoTheForm('.0625', 0.125).modelValue, 0.0625);
});

test('a redraw overwriting the typed text is what corrupts the entry', () => {
  // Same loop, except the redraw puts the project's number back in the box.
  // This is the behavior being fixed, kept here so the test above cannot pass
  // by accident.
  let modelValue = 48;
  let box = '';
  for (const character of '17.75') {
    box += character;
    modelValue = readNumericEntry(box, modelValue);
    box = String(modelValue);
  }
  assert.notEqual(modelValue, 17.75);
});

test('a box that is not being typed in shows the project number', () => {
  assert.equal(entryText(null, 17.75), '17.75');
  assert.equal(entryText(undefined, 0), '0');
});
