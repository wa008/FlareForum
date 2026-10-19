import test from 'node:test';
import assert from 'node:assert/strict';
import { ageHoursFromNow, hotRank } from '../src/rank.js';

test('hotRank decreases with age', () => {
  const newer = hotRank(10, 1);
  const older = hotRank(10, 5);
  assert.ok(newer > older);
});

test('hotRank increases with score', () => {
  const low = hotRank(3, 2);
  const high = hotRank(12, 2);
  assert.ok(high > low);
});

test('ageHoursFromNow handles invalid timestamps', () => {
  assert.equal(ageHoursFromNow('invalid-date'), 0);
});
