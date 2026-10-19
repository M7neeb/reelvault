// Run with `npm test`. The badge road: earned in order, then the next ones.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { badgeRoad } from '../src/features/vault/badgeRoad.ts';

const badge = (id, over = {}) => ({ id, family: id, kind: 'once', group: 'Watching', icon: 'star', title: id, detail: '', current: 0, target: 10, unlocked: false, tier: 1, earnedAt: null, videoId: null, ...over });
const at = (m, d) => new Date(2026, m, d).getTime();

test('earned in order with month marks, then the closest ones ahead', () => {
  const list = [
    badge('b', { unlocked: true, earnedAt: at(9, 2), current: 10 }),
    badge('a', { unlocked: true, earnedAt: at(8, 20), current: 10 }),
    badge('c', { unlocked: true, earnedAt: at(9, 5), current: 10 }),
    badge('far', { current: 1 }),
    badge('close', { current: 9 }),
    badge('mid', { current: 5 }),
    badge('secret', { current: 9.5, secret: true }),
    badge('week', { kind: 'weekly', unlocked: true, earnedAt: at(9, 6) }),
  ];
  const r = badgeRoad(list, { ahead: 2 });
  assert.deepEqual(r.stops.map((s) => `${s.a.id}:${s.state}`), ['a:earned', 'b:earned', 'c:earned', 'close:next', 'mid:ahead']);
  // A month mark where a new month starts (September's spelling depends on the system).
  assert.match(r.stops[0].month, /^Sept? 2026$/);
  assert.deepEqual(r.stops.slice(1).map((s) => s.month), ['Oct 2026', null, null, null]);
  assert.equal(r.earned, 3);
  // Only the latest earned ones, with how many are left out.
  const short = badgeRoad(list, { earnedMax: 2, ahead: 1 });
  assert.deepEqual(short.stops.map((s) => s.a.id), ['b', 'c', 'close']);
  assert.equal(short.hidden, 1);
});
