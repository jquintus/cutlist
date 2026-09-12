// debounce() is what stops app.js re-encoding and re-writing the share hash
// on every keystroke: this proves the collapsing and flush behavior in
// isolation, with mocked timers, since debounce.js itself touches no DOM.

import test from 'node:test';
import assert from 'node:assert/strict';
import { debounce } from '../src/ui/debounce.js';

test('a burst of calls runs the wrapped function only once, with the last arguments', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const wrapped = debounce((value) => calls.push(value), 400);

  wrapped('a minute of steady typing: 1');
  t.mock.timers.tick(100);
  wrapped('...2');
  t.mock.timers.tick(100);
  wrapped('...final');

  assert.deepEqual(calls, [], 'nothing should run before the debounce window closes');
  t.mock.timers.tick(400);
  assert.deepEqual(calls, ['...final']);
});

test('flush runs a pending call immediately, without waiting for the window', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const wrapped = debounce((value) => calls.push(value), 400);

  wrapped('typed just now');
  wrapped.flush();

  assert.deepEqual(calls, ['typed just now']);
  // The timer it flushed must not also fire on its own afterward.
  t.mock.timers.tick(400);
  assert.deepEqual(calls, ['typed just now']);
});

test('flush with nothing pending does nothing', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const wrapped = debounce((value) => calls.push(value), 400);

  wrapped.flush();

  assert.deepEqual(calls, []);
});
