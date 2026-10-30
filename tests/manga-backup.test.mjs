// Run with `npm test`. Tachimanga / Tachiyomi backups, reading stats, and the .cbz info file.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync, zipSync, strToU8 } from 'fflate';

import { decodeTachiBackup, newTitles, planTachiImport, protoFields, readTachiBackup, tachiSourceOf } from '../src/features/vault/manga/mangaBackup.ts';
import { mangaStats, readingYear } from '../src/features/vault/manga/mangaStats.ts';
import { cbzName, comicInfoXml, parseComicInfo, safeFileName } from '../src/features/vault/manga/mangaLogic.ts';

/* A tiny protocol-buffers writer, the same layout Mihon writes. */
const varint = (v) => {
  let n = BigInt(v);
  if (n < 0n) n = BigInt.asUintN(64, n);
  const out = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
};
const key = (n, wt) => varint((BigInt(n) << 3n) | BigInt(wt));
const vInt = (n, v) => [...key(n, 0), ...varint(v)];
const vStr = (n, s) => {
  const b = strToU8(s);
  return [...key(n, 2), ...varint(b.length), ...b];
};
const vMsg = (n, bytes) => [...key(n, 2), ...varint(bytes.length), ...bytes];
const vFloat = (n, f) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, f, true);
  return [...key(n, 5), ...b];
};
const msg = (...parts) => parts.flat();

const MD_SOURCE = '2499283573021220255';
const OTHER_SOURCE = '-1234567890123456789';
const chapter = (url, name, num, order, read, lastPage = 0) => msg(vStr(1, url), vStr(2, name), vStr(3, 'Group'), vInt(4, read ? 1 : 0), vInt(6, lastPage), vInt(7, 1700000000000), vInt(8, 1690000000000), vFloat(9, num), vInt(10, order));

function sampleBackup() {
  const mangadex = msg(
    vInt(1, MD_SOURCE),
    vStr(2, '/manga/b0b721ff-c388-4486-aa0f-c2b0bb321512'),
    vStr(3, 'Sousou no Frieren'),
    vStr(4, 'Abe Tsukasa'),
    vStr(5, 'Yamada Kanehito'),
    vStr(6, 'An elf mage.'),
    vStr(7, 'Fantasy, Adventure'),
    vInt(8, 1),
    vStr(9, 'https://uploads.mangadex.org/covers/x/y.jpg'),
    vInt(13, 1600000000000),
    vMsg(16, chapter('/chapter/11111111-2222-3333-4444-555555555555', 'Ch. 2', 2, 0, false, 7)),
    vMsg(16, chapter('/chapter/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'Ch. 1', 1, 1, true)),
    vInt(17, 1),
    vMsg(18, msg(vInt(1, 2), vStr(5, 'Frieren'), vFloat(8, 92), vInt(9, 1))),
    vMsg(104, msg(vStr(1, '/chapter/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'), vInt(2, 1710000000000), vInt(3, 600000))),
    vStr(110, 'Best elf')
  );
  const other = msg(vInt(1, OTHER_SOURCE), vStr(2, '/series/one-punch'), vStr(3, 'One Punch-Man'), vInt(8, 2), vMsg(16, chapter('/c/1', 'Chapter 1', 1, 0, true)), vMsg(17, varint(0).concat(varint(1))));
  const notInLibrary = msg(vInt(1, OTHER_SOURCE), vStr(2, '/series/x'), vStr(3, 'Just looked at it'), vInt(100, 0));
  return new Uint8Array(
    msg(
      vMsg(1, mangadex),
      vMsg(1, other),
      vMsg(1, notInLibrary),
      vMsg(2, msg(vStr(1, 'Default'), vInt(2, 0))),
      vMsg(2, msg(vStr(1, 'Favourites'), vInt(2, 1), vInt(3, 9))),
      vMsg(101, msg(vStr(1, 'MangaDex'), vInt(2, MD_SOURCE))),
      vMsg(101, msg(vStr(1, 'Some Site'), vInt(2, OTHER_SOURCE)))
    )
  );
}

test('the protocol-buffers reader reads numbers, text, floats and nested messages', () => {
  const f = protoFields(new Uint8Array(msg(vInt(1, 300), vStr(2, 'hé'), vFloat(3, 1.5), vMsg(4, vInt(1, 7)))));
  assert.equal(Number(f[0].int), 300);
  assert.equal(new TextDecoder().decode(f[1].bytes), 'hé');
  assert.equal(f[2].f32, 1.5);
  assert.equal(Number(protoFields(f[3].bytes)[0].int), 7);
});

test('a backup is decoded: titles, chapters, categories, tracking, history, sources (big ids exact)', () => {
  const b = decodeTachiBackup(sampleBackup());
  assert.equal(b.mangas.length, 3);
  assert.equal(b.sources[0].id, MD_SOURCE);
  assert.equal(b.mangas[1].source, OTHER_SOURCE);
  const m = b.mangas[0];
  assert.equal(m.title, 'Sousou no Frieren');
  assert.deepEqual(m.genres, ['Fantasy', 'Adventure']);
  assert.equal(m.chapters.length, 2);
  assert.equal(m.chapters[0].lastPageRead, 7);
  assert.equal(m.chapters[1].read, true);
  assert.equal(m.tracking[0].score, 92);
  assert.equal(m.favorite, true);
  assert.equal(b.mangas[2].favorite, false);
  assert.deepEqual(b.mangas[1].categories, [0, 1], 'packed category numbers');
  assert.equal(m.notes, 'Best elf');
});

test('the plan: library titles only, MangaDex linked, read marks, status and score, categories as keywords', () => {
  const plan = planTachiImport(decodeTachiBackup(sampleBackup()), 1800000000000);
  assert.equal(plan.length, 2, 'titles not in the library are left out');
  const md = plan[0];
  assert.equal(md.sourceId, 'mangadex');
  assert.equal(md.sourceKey, 'b0b721ff-c388-4486-aa0f-c2b0bb321512');
  assert.deepEqual(md.chapters.map((c) => [c.key, c.number]), [['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 1], ['11111111-2222-3333-4444-555555555555', 2]], 'first chapter first');
  assert.equal(md.chapters[0].readAt, 1710000000000, 'read time from the history');
  assert.equal(md.chapters[1].readAt, null);
  assert.equal(md.chapters[1].lastPage, 7);
  assert.equal(md.status, 'reading', 'from the tracker');
  assert.equal(md.rating, 9.2, 'a 0-100 score becomes 0-10');
  assert.deepEqual(md.categories, ['Favourites']);
  assert.equal(md.pubStatus, 'ongoing');
  assert.equal(md.notes, 'Best elf');
  const other = plan[1];
  assert.equal(other.sourceId, `tachi:${OTHER_SOURCE}:Some Site`);
  assert.deepEqual(tachiSourceOf(other.sourceId), { id: OTHER_SOURCE, name: 'Some Site' });
  assert.equal(other.status, 'completed', 'all read and the series is finished');
  assert.deepEqual(other.categories, ['Default', 'Favourites']);
  assert.deepEqual(newTitles(plan, ['ONE PUNCH MAN']).map((t) => t.title), ['Sousou no Frieren']);
  assert.equal(tachiSourceOf('mangadex'), null);
});

test('backup files: gzip, plain, inside a ZIP; old JSON and other files explained', async () => {
  const raw = sampleBackup();
  assert.equal((await readTachiBackup(gzipSync(raw))).mangas.length, 3);
  assert.equal((await readTachiBackup(raw)).mangas.length, 3);
  assert.equal((await readTachiBackup(zipSync({ 'tachimanga_2026-10-23.tachibk': gzipSync(raw) }))).mangas.length, 3);
  await assert.rejects(() => readTachiBackup(strToU8('{"version":2}')), /old JSON backup/);
  await assert.rejects(() => readTachiBackup(strToU8('hello there, not a backup')), /not a Tachimanga/);
});

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 21, 15).getTime(); // a Wednesday afternoon
const ch = (id, readAt) => ({ id, number: 1, volume: null, title: null, filename: null, readAt, lastPage: 0, folder: null, pages: [], pageCount: 20, position: 0 });
const series = (id, extra = {}) => ({ id, title: id, tags: [], rating: 0, status: null, deletedAt: null, finishedAt: null, chapters: [], ...extra });

test('reading stats: week, streak, chapters, top titles, statuses, genres', () => {
  const items = [
    series('a', { status: 'reading', rating: 9, tags: ['Action'], chapters: [ch('a1', NOW - DAY), ch('a2', NOW), ch('a3', null)] }),
    series('b', { status: 'completed', rating: 7, tags: ['Action', 'Drama'], chapters: [ch('b1', NOW - 2 * DAY)] }),
    series('c', { deletedAt: 1, chapters: [ch('c1', NOW)] }),
  ];
  const reads = [
    { seriesId: 'a', chapterId: 'a1', startedAt: NOW - DAY, readMs: 20 * 60_000, pages: 30 },
    { seriesId: 'a', chapterId: 'a2', startedAt: NOW - 3_600_000, readMs: 10 * 60_000, pages: 20 },
    { seriesId: 'b', chapterId: 'b1', startedAt: NOW - 2 * DAY, readMs: 5 * 60_000, pages: 10 },
    { seriesId: 'c', chapterId: 'c1', startedAt: NOW, readMs: 99 * 60_000, pages: 99 },
  ];
  const st = mangaStats(items, reads, NOW);
  assert.equal(st.totalMs, 35 * 60_000, 'deleted titles are left out');
  assert.equal(st.todayMs, 10 * 60_000);
  assert.equal(st.chapters, 3);
  assert.equal(st.pages, 60);
  assert.equal(st.streak, 3);
  assert.equal(st.top[0].id, 'a');
  assert.equal(st.statuses.reading, 1);
  assert.equal(st.statuses.completed, 1);
  assert.equal(st.genres[0].name, 'Action');
  assert.equal(st.averageRating, 8);
  assert.equal(st.unread, 1);
  assert.equal(st.week.length, 7);
  assert.equal(st.week.find((d) => d.today).label, 'Wed');
});

test('a year of reading for Wrapped', () => {
  const items = [series('a', { status: 'completed', finishedAt: new Date(2026, 5, 1).getTime(), tags: ['Romance'], chapters: [ch('a1', new Date(2026, 2, 3).getTime()), ch('a2', new Date(2025, 2, 3).getTime())] })];
  const reads = [
    { seriesId: 'a', chapterId: 'a1', startedAt: new Date(2026, 2, 3).getTime(), readMs: 30 * 60_000, pages: 25 },
    { seriesId: 'a', chapterId: 'a2', startedAt: new Date(2025, 2, 3).getTime(), readMs: 30 * 60_000, pages: 25 },
  ];
  const y = readingYear(items, reads, 2026);
  assert.equal(y.chapters, 1);
  assert.equal(y.ms, 30 * 60_000);
  assert.equal(y.busiestMonth.month, 2);
  assert.deepEqual(y.completed, ['a']);
  assert.equal(y.genre, 'Romance');
  assert.deepEqual(y.started, [], 'it was started in 2025');
});

test('.cbz files: ComicInfo.xml another reader understands, names that sort and are safe', () => {
  const s = { title: 'Berserk & <Friends>', author: 'Miura', artist: null, description: 'Dark.', tags: ['Action', 'Fantasy'], sourceUrl: 'https://mangadex.org/title/x', kind: 'manga', readingMode: null };
  const c = { number: 12, volume: 2, title: 'The Hawk', scanlator: 'Group', pageCount: 21, uploadedAt: Date.UTC(2021, 0, 1) };
  const xml = comicInfoXml(s, c);
  const back = parseComicInfo(xml);
  assert.equal(back.series, 'Berserk & <Friends>');
  assert.equal(back.number, 12);
  assert.equal(back.volume, 2);
  assert.equal(back.writer, 'Miura');
  assert.equal(back.rightToLeft, true);
  assert.deepEqual(back.genres, ['Action', 'Fantasy']);
  assert.equal(back.pageCount, 21);
  assert.equal(cbzName('One Piece', { number: 7, volume: null, title: null, filename: null }), 'One Piece - Ch. 007.cbz');
  assert.equal(cbzName('One Piece', { number: 7.5, volume: 2, title: null, filename: null }), 'One Piece - Vol. 2 Ch. 007.5.cbz');
  assert.equal(cbzName('A/B: C?', { number: null, volume: null, title: 'Extra', filename: null }), 'A B C - Extra.cbz');
  assert.equal(safeFileName('  ...  '), 'Untitled');
});

test('same title across sources: case, accents, punctuation and other titles', async () => {
  const { sameTitle } = await import('../src/features/vault/manga/mangaBackup.ts');
  assert.equal(sameTitle('Chainsaw Man', 'chainsaw man', []), true);
  assert.equal(sameTitle('Kaguya-sama: Love Is War', 'Kaguya sama Love is War', []), true);
  assert.equal(sameTitle('Shingeki no Kyojin', 'Attack on Titan', ['Shingeki no Kyojin']), true);
  assert.equal(sameTitle('One Piece', 'One Punch-Man', []), false);
  assert.equal(sameTitle('', '', []), false);
});
