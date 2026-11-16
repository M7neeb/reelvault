import test from 'node:test';
import assert from 'node:assert/strict';

import { dayGoal, daysMet, reminderTimes, stepRemind, matchesQuote, parseGoals, quoteAsText, quoteOfDay, quoteSize, quotesOf, stepDaily, tidyQuote, yearGoal } from '../src/features/vault/books/bookGoals.ts';

const MIN = 60_000;
const at = (y, m, d, h = 12) => new Date(y, m, d, h).getTime();

test('goals are read back safely', () => {
  assert.deepEqual(parseGoals(null), { dailyMin: 0, yearBooks: 0, remindAt: 0 });
  assert.deepEqual(parseGoals('{"dailyMin":20,"yearBooks":12}'), { dailyMin: 20, yearBooks: 12, remindAt: 0 });
  assert.deepEqual(parseGoals('{"dailyMin":7,"yearBooks":-3}'), { dailyMin: 0, yearBooks: 0, remindAt: 0 });
  assert.deepEqual(parseGoals('{"dailyMin":"20","yearBooks":9999}'), { dailyMin: 0, yearBooks: 200, remindAt: 0 });
  assert.deepEqual(parseGoals('not json'), { dailyMin: 0, yearBooks: 0, remindAt: 0 });
  assert.equal(parseGoals('{"dailyMin":20,"remindAt":20}').remindAt, 20);
  assert.equal(parseGoals('{"dailyMin":20,"remindAt":3}').remindAt, 0);
});

test('the daily goal steps up and down and stops at the ends', () => {
  assert.equal(stepDaily(0, 1), 5);
  assert.equal(stepDaily(20, 1), 30);
  assert.equal(stepDaily(20, -1), 15);
  assert.equal(stepDaily(0, -1), 0);
  assert.equal(stepDaily(120, 1), 120);
});

test('today against the daily goal', () => {
  assert.equal(dayGoal(5 * MIN, 0), null);
  assert.deepEqual(dayGoal(0, 20), { min: 0, goal: 20, ratio: 0, met: false, line: '20 min to read today' });
  const part = dayGoal(12 * MIN + 59_000, 20);
  assert.equal(part.min, 12);
  assert.equal(part.ratio, 0.6);
  assert.equal(part.line, '12 of 20 min today · 8 to go');
  // Not rounded up to the goal.
  assert.equal(dayGoal(19 * MIN + 59_000, 20).met, false);
  const done = dayGoal(31 * MIN, 20);
  assert.equal(done.met, true);
  assert.equal(done.ratio, 1);
  assert.equal(done.line, '31 min today · goal reached');
});

test('days of the last week that reached the goal', () => {
  const now = at(2026, 10, 14, 20);
  const read = (d, min) => ({ bookId: 'a', startedAt: at(2026, 10, d, 9), endedAt: at(2026, 10, d, 10), ms: min * MIN, from: 0, to: 0.1 });
  const reads = [read(14, 25), read(13, 10), read(13, 12), read(12, 19), read(8, 40), read(7, 40)];
  assert.equal(daysMet(reads, 20, now), 3); // 14th, 13th (two sittings), 8th; the 7th is too old
  assert.equal(daysMet(reads, 0, now), 0);
});

test('the year goal knows the pace', () => {
  const fin = (m, d, y = 2026) => ({ finishedAt: at(y, m, d) });
  const mid = at(2026, 6, 2); // half the year gone
  assert.equal(yearGoal([fin(1, 1)], 0, mid), null);
  assert.equal(yearGoal([fin(1, 1), fin(2, 1), fin(3, 1), fin(0, 5, 2025)], 12, mid).line, '3 of 12 · 3 books behind');
  assert.equal(yearGoal(Array.from({ length: 6 }, () => fin(1, 1)), 12, mid).line, '6 of 12 · On pace');
  assert.equal(yearGoal(Array.from({ length: 7 }, () => fin(1, 1)), 12, mid).line, '7 of 12 · 1 book ahead');
  const done = yearGoal(Array.from({ length: 13 }, () => fin(1, 1)), 12, mid);
  assert.equal(done.line, '13 of 12 · Goal reached');
  assert.equal(done.ratio, 1);
  assert.equal(yearGoal([{ finishedAt: null }], 12, at(2026, 0, 3)).line, '0 of 12 · On pace');
});

const books = [
  { id: 'crime', title: 'Crime and Punishment', filename: 'cp.epub', author: 'Fyodor Dostoevsky' },
  { id: 'file', title: null, filename: 'the_idiot.epub', author: null },
];
const mark = (id, bookId, text, over = {}) => ({ id, bookId, kind: 'highlight', chapter: 1, block: 2, text, note: null, createdAt: id * 1000, ...over });

test('quotes are the highlights of books still on the shelf, newest first', () => {
  const qs = quotesOf(
    [mark(1, 'crime', ' Pain and suffering are always inevitable. '), mark(2, 'crime', null, { kind: 'bookmark' }), mark(3, 'gone', 'Lost'), mark(4, 'file', 'Beauty will save the world.', { note: ' Myshkin ' }), mark(5, 'crime', '   ')],
    books
  );
  assert.deepEqual(qs.map((q) => q.id), [4, 1]);
  assert.equal(qs[0].title, 'the idiot');
  assert.equal(qs[0].author, null);
  assert.equal(qs[0].note, 'Myshkin');
  assert.equal(qs[1].text, 'Pain and suffering are always inevitable.');
});

test('quotes are searched by their words, note, title and author', () => {
  const [q] = quotesOf([mark(1, 'crime', 'Pain and suffering are always inevitable.', { note: 'Part three' })], books);
  assert.equal(matchesQuote(q, ''), true);
  assert.equal(matchesQuote(q, 'suffering pain'), true);
  assert.equal(matchesQuote(q, 'dostoevsky three'), true);
  assert.equal(matchesQuote(q, 'tolstoy'), false);
});

test('the quote of the day holds all day and goes through every quote', () => {
  const qs = quotesOf([mark(1, 'crime', 'One'), mark(2, 'crime', 'Two'), mark(3, 'crime', 'Three')], books);
  assert.equal(quoteOfDay([], at(2026, 10, 14)), null);
  const morning = quoteOfDay(qs, at(2026, 10, 14, 1));
  assert.equal(quoteOfDay(qs, at(2026, 10, 14, 23)).id, morning.id);
  const three = new Set([14, 15, 16].map((d) => quoteOfDay(qs, at(2026, 10, d)).id));
  assert.equal(three.size, 3);
  assert.equal(quoteOfDay(qs, at(2026, 10, 17)).id, morning.id);
});

test('a quote is tidied and sized for its card', () => {
  assert.equal(tidyQuote('  "Hm … yes,\n  all is in a man’s hands."  '), 'Hm … yes, all is in a man’s hands.');
  assert.equal(tidyQuote('“Quoted”'), 'Quoted');
  assert.ok(quoteSize('Short.').size > quoteSize('x'.repeat(300)).size);
  assert.ok(quoteSize('x'.repeat(300)).size > quoteSize('x'.repeat(900)).size);
  assert.equal(quoteAsText({ text: '"Beauty will save the world."', title: 'The Idiot', author: 'Fyodor Dostoevsky' }), '“Beauty will save the world.”\nFyodor Dostoevsky, The Idiot');
  assert.equal(quoteAsText({ text: 'Beauty', title: 'The Idiot', author: null }), '“Beauty”\nThe Idiot');
});

test('the reading reminder: each evening at the chosen hour, but not today once the goal is met', () => {
  const now = new Date(2026, 10, 16, 15, 0).getTime();
  const at = (d, h) => new Date(2026, 10, d, h, 0).getTime();
  assert.deepEqual(reminderTimes({ dailyMin: 20, remindAt: 0 }, false, now), []);
  assert.deepEqual(reminderTimes({ dailyMin: 0, remindAt: 20 }, false, now), []);
  const all = reminderTimes({ dailyMin: 20, remindAt: 20 }, false, now);
  assert.equal(all.length, 7);
  assert.equal(all[0], at(16, 20));
  assert.equal(all[6], at(22, 20));
  // Goal reached today: starts tomorrow.
  assert.equal(reminderTimes({ dailyMin: 20, remindAt: 20 }, true, now)[0], at(17, 20));
  // Already past 20:00: starts tomorrow.
  assert.equal(reminderTimes({ dailyMin: 20, remindAt: 20 }, false, at(16, 21))[0], at(17, 20));
  assert.equal(stepRemind(0, 1), 18);
  assert.equal(stepRemind(18, -1), 0);
  assert.equal(stepRemind(22, 1), 22);
});
