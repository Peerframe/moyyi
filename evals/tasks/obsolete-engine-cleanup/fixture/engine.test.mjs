import assert from 'node:assert/strict';
import test from 'node:test';
import { render } from './src/index.mjs';
test('current renderer keeps escaping and empty state', () => {
  assert.equal(render(['<one>', '&two']), '&lt;one&gt;|&amp;two');
  assert.equal(render([]), '(empty)');
});
