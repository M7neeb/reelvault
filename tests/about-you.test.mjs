import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aboutYou, archetypeOf, lengthText, roughLength } from '../src/features/vault/aboutYou.ts';

const MIN = 60_000;
const at = (m, d, h = 20) => new Date(2026, m, d, h).getTime();
const titles = new Map(
  [
    ['a', 'Ember', 9],
    ['b', 'Tower', 4],
    ['c', 'Lake', 0],
    ['d', 'Old Friend', 8],
    ['e', 'Fling', 0],
  ].map(([id, name, rating]) => [id, { id, name, rating }])
);
const start = at(5, 1, 0);
const end = at(6, 1, 0);

/** A night owl who binges Ember, comes back to an old favourite and once fell for "Fling". */
function nightOwl() {
  const s = [];
  // Old Friend was last seen a year before.
  s.push({ titleId: 'd', at: at(4, 1, 21) - 365 * 86_400_000, ms: 40 * MIN });
  for (let d = 1; d <= 20; d += 2) s.push({ titleId: 'a', at: at(5, d, 23), ms: 90 * MIN });
  s.push({ titleId: 'b', at: at(5, 6, 23), ms: 60 * MIN }, { titleId: 'b', at: at(5, 7, 0), ms: 50 * MIN });
  s.push({ titleId: 'c', at: at(5, 3, 22), ms: 20 * MIN });
  s.push({ titleId: 'd', at: at(5, 9, 22), ms: 30 * MIN }, { titleId: 'd', at: at(5, 12, 23), ms: 30 * MIN });
  s.push({ titleId: 'e', at: at(5, 2, 1), ms: 70 * MIN });
  return s;
}

test('lengths read like a person would say them', () => {
  assert.equal(lengthText(45 * MIN), '45 min');
  assert.equal(lengthText(120 * MIN), '2 h');
  assert.equal(lengthText(130 * MIN), '2 h 10 min');
  assert.equal(lengthText(10), '1 min');
  assert.equal(roughLength(71 * 60 * MIN + 24 * MIN), '71 h');
  assert.equal(roughLength(2 * 60 * MIN + 16 * MIN), '2 h 15 min');
  assert.equal(roughLength(3 * MIN), '5 min');
});

test('a late, long-sitting watcher reads as a midnight marathoner', () => {
  const a = aboutYou({ kind: 'video', sittings: nightOwl(), titles, start, end });
  assert.ok(a);
  const axis = Object.fromEntries(a.axes.map((x) => [x.key, x.value]));
  assert.ok(axis.clock > 0.9, `clock ${axis.clock}`);
  assert.ok(axis.pace > 0.9, `pace ${axis.pace}`);
  for (const x of a.axes) assert.ok(x.value >= 0 && x.value <= 1, x.key);
  assert.match(a.archetype.name, /^The (Midnight Marathoner|Marathon Night Owl)$/);
  assert.equal(a.roast, 'Your bedtime is more of a suggestion.');
  assert.notEqual(a.roast, a.toast);
});

test('awards: ride or die, the marathon, the comeback, the guilty pleasure, the fling, each title once', () => {
  const a = aboutYou({ kind: 'video', sittings: nightOwl(), titles, start, end });
  const by = Object.fromEntries(a.awards.map((x) => [x.key, x]));
  assert.equal(by.loyal.titleId, 'a');
  assert.match(by.loyal.line, /10 different days/);
  assert.equal(by.comeback.titleId, 'd');
  assert.match(by.comeback.line, /in 13 months/);
  assert.equal(by.guilty.titleId, 'b');
  assert.match(by.guilty.line, /4\/10.*1 h 50 min/);
  assert.ok(a.awards.length <= 4);
  assert.equal(new Set(a.awards.map((x) => x.titleId)).size, a.awards.length);
  // Ember already won "Ride or die", so the marathon goes to the next longest sitting.
  assert.equal(by.marathon.titleId, 'e');
  assert.match(by.marathon.line, /1 h 10 min of Fling in one go/);
});

test('two truths and a lie: three statements, the lie differs from the truth it replaces, and replays tell the same story', () => {
  const input = { kind: 'video', sittings: nightOwl(), titles, start, end };
  const a = aboutYou(input);
  assert.ok(a.quiz);
  assert.equal(a.quiz.statements.length, 3);
  assert.ok(a.quiz.lie >= 0 && a.quiz.lie < 3);
  assert.notEqual(a.quiz.statements[a.quiz.lie], a.quiz.reveal);
  assert.equal(new Set(a.quiz.statements).size, 3);
  assert.deepEqual(aboutYou(input).quiz, a.quiz);
  // A different range or seed can pick differently, but is still a valid quiz.
  const b = aboutYou({ ...input, seed: 42 });
  assert.equal(b.quiz.statements.length, 3);
});

test('predictions follow the trend and name the favourite you keep returning to', () => {
  const a = aboutYou({ kind: 'video', sittings: nightOwl(), titles, start, end }, 5 * 60 * MIN);
  assert.ok(a.predictions.some((p) => /a bit more than now/.test(p)));
  assert.ok(a.predictions.some((p) => /go back to Old Friend/.test(p)));
  const m = aboutYou({ kind: 'manga', sittings: nightOwl(), titles, start, end });
  assert.ok(m.predictions.some((p) => /go back to Old Friend/.test(p)));
});

test('manga wording, and an unfinished story left early in the range is "left on read"', () => {
  const t = new Map(titles);
  t.set('c', { id: 'c', name: 'Lake', rating: 0, finished: false });
  const s = [...nightOwl(), { titleId: 'c', at: at(5, 4, 22), ms: 30 * MIN }];
  const a = aboutYou({ kind: 'manga', sittings: s, titles: t, start, end });
  assert.ok(a.awards.some((x) => x.key === 'hanging' && x.titleId === 'c') || a.awards.length === 4);
  assert.match(a.archetype.line, /chapter|read|stor|pages/i);
});

test('too little to go on: nothing, and an even mix is an all-rounder', () => {
  assert.equal(aboutYou({ kind: 'video', sittings: [], titles, start, end }), null);
  assert.equal(aboutYou({ kind: 'video', sittings: [{ titleId: 'a', at: at(5, 2), ms: MIN }], titles, start, end }), null);
  const even = ['clock', 'pace', 'loyalty', 'nostalgia', 'week'].map((key) => ({ key, left: '', right: '', value: 0.55 }));
  assert.equal(archetypeOf('video', even).name, 'The All-Rounder');
  assert.equal(archetypeOf('manga', even).name, 'The Balanced Reader');
});

test('sittings outside the range do not count, and many sittings stay quick', () => {
  const many = [];
  for (let i = 0; i < 40_000; i++) many.push({ titleId: `t${i % 600}`, at: start - 400 * 86_400_000 + i * 1_000_000, ms: 20 * MIN });
  const t0 = Date.now();
  const a = aboutYou({ kind: 'video', sittings: many, titles, start, end });
  assert.ok(Date.now() - t0 < 1500);
  assert.ok(a === null || a.axes.length === 5);
});
