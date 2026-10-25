import assert from 'node:assert/strict';
import test from 'node:test';
import { slug, apiVersion } from './slug.mjs';
test('regression: collapse all whitespace', () => {
  assert.equal(slug('  A   B\tC  '), 'a-b-c');
  assert.equal(slug('A\nB'), 'a-b');
  assert.equal(slug('  '), '');
});
test('retain the new API version', () => assert.equal(apiVersion, 2));
