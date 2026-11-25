import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createLog, reportText } from '../src/features/vault/errorLog.ts';

test('the log keeps only the newest lines, with the time', () => {
  const log = createLog(3);
  for (let i = 1; i <= 5; i++) log.add('log', [`line ${i}`], 1_000 * i);
  const lines = log.lines();
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes('line 3'));
  assert.ok(lines[2].includes('line 5'));
});

test('errors and objects are written out readably', () => {
  const log = createLog(10);
  log.add('error', [new Error('boom'), { a: 1 }], 0);
  const line = log.lines()[0];
  assert.ok(line.includes('ERROR'));
  assert.ok(line.includes('boom'));
  assert.ok(line.includes('{"a":1}'));
});

test('a circular object does not break the log', () => {
  const log = createLog(10);
  const o = {};
  o.self = o;
  log.add('warn', [o], 0);
  assert.equal(log.lines().length, 1);
});

test('the report has the note, the app facts and the log', () => {
  const text = reportText({ note: 'Covers went black', facts: { App: '1.12.0', Update: 'abc' }, lines: ['x', 'y'], at: Date.UTC(2026, 10, 25, 12) });
  assert.ok(text.startsWith('ReelVault problem report'));
  assert.ok(text.includes('Covers went black'));
  assert.ok(text.includes('App: 1.12.0'));
  assert.ok(text.trimEnd().endsWith('y'));
});
