/**
 * Books (native wiring): the shelf from the database, adding .epub files
 * (from Files or sent from another app), opening a book's chapters, and
 * saving where you are. Each book is unpacked once into Documents/books/<id>/
 * and read from there, so it works with no connection at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { unpackBook } from '../audio/audioImport';
import { fileIn, fileUri, readBookJson, readTextIn, removeFolder } from '../audio/audioFiles';
import { contentKeyOf } from '../contentKey';
import { onIncomingBook } from '../incoming';
import { onBooksChanged } from './bookEvents';
import { getSetting, setSetting } from '../library';
import type { BookActions, BookUi, BooksData } from '../ui/books/bookTypes';
import { chapterBlocks } from '../audio/epub';
import { BOOK_SORTS, cleanTag, DEFAULT_READER, displayTitle, parseReaderPrefs, progressAt, type BookItem, type BookSort, type ReaderPrefs } from './bookLogic';
import { ReelVaultMedia } from '../../../../modules/reelvault-media';
import {
  addBookMark,
  addBookTag,
  deleteBook,
  deleteBookMark,
  expiredBooks,
  findBookByKey,
  insertBook,
  listBookMarks,
  listBookReads,
  listBooks,
  logBookRead,
  removeBookTag,
  saveBookPlace,
  setBookCover,
  setBookFinished,
  setBookMarkNote,
  setBookNotes,
  setBooksField,
  setBookText,
} from './bookStore';

const READER_KEY = 'books.reader';
const SORT_KEY = 'books.sort';
const onPhone = Platform.OS !== 'web';

const asUi = (b: BookItem): BookUi => ({ ...b, coverUri: b.cover ? fileUri(b.folder, b.cover) : null });

function removeQuietly(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // a copy iOS keeps for itself
  }
}

/** Unpacks one .epub into its own folder and adds it to the shelf. Null when it was already there. */
async function addBook(uri: string, name: string, onStep: (t: string) => void): Promise<BookItem | null> {
  const key = await contentKeyOf(uri).catch(() => null);
  if (key && (await findBookByKey(key))) return null;
  const id = Crypto.randomUUID();
  const folder = `books/${id}`;
  try {
    const book = await unpackBook(new File(uri), folder, onStep);
    if (!book.chapters.length) throw new Error('This book has no pages to read');
    const item: BookItem = {
      id,
      folder,
      filename: name,
      size: new File(uri).size ?? 0,
      title: book.title,
      author: book.authors.join(', ') || null,
      language: book.language,
      description: book.description,
      cover: book.cover,
      chapterSizes: book.chapters.map((c) => {
        try {
          return fileIn(folder, c.href).size || 1;
        } catch {
          return 1;
        }
      }),
      chapter: 0,
      block: 0,
      chapterFrac: 0,
      readMs: 0,
      lastReadAt: null,
      finishedAt: null,
      addedAt: Date.now(),
      rating: 0,
      status: null,
      notes: null,
      isPrivate: false,
      deletedAt: null,
      tags: [],
    };
    await insertBook(item, key);
    return item;
  } catch (e) {
    removeFolder(folder);
    throw e;
  }
}

export function useBooksData(): BooksData {
  const [items, setItems] = useState<BookItem[]>([]);
  const [loaded, setLoaded] = useState(!onPhone);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [reader, setReaderState] = useState<ReaderPrefs>(DEFAULT_READER);
  const [trashDays, setTrashDays] = useState(30);
  const [sort, setSortState] = useState<BookSort>('shelf');
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const refresh = useCallback(async () => {
    if (!onPhone) return;
    try {
      setItems(await listBooks());
    } catch (e) {
      console.log(`[BOOKS] load failed: ${String(e)}`);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!onPhone) return;
    getSetting(READER_KEY)
      .then((j) => setReaderState(parseReaderPrefs(j)))
      .catch(() => undefined);
    getSetting(SORT_KEY)
      .then((v) => {
        if (v && BOOK_SORTS.some((x) => x.key === v)) setSortState(v as BookSort);
      })
      .catch(() => undefined);
    // Recently Deleted keeps books as long as videos (Settings), then they go for good.
    (async () => {
      const prefs = JSON.parse((await getSetting('vault.prefs')) ?? '{}');
      const days = [1, 3, 7, 14, 30].includes(prefs?.trashDays) ? prefs.trashDays : 30;
      setTrashDays(days);
      const gone = await expiredBooks(days, Date.now());
      for (const g of gone) {
        await deleteBook(g.id);
        removeFolder(g.folder);
      }
      if (gone.length) await refresh();
    })().catch((e) => console.log(`[BOOKS] purge failed: ${String(e)}`));
  }, [refresh]);

  const patch = useCallback((ids: string[], change: (b: BookItem) => BookItem) => {
    const set = new Set(ids);
    setItems((list) => list.map((b) => (set.has(b.id) ? change(b) : b)));
  }, []);

  const add = useCallback(
    async (files: { uri: string; name: string }[]) => {
      if (!files.length) return;
      setBusy(true);
      let added = 0;
      let already = 0;
      const failed: string[] = [];
      try {
        for (const [n, f] of files.entries()) {
          const label = files.length > 1 ? `${n + 1} of ${files.length}: ` : '';
          setStatus(`Adding ${label}${f.name}`);
          try {
            const b = await addBook(f.uri, f.name, (t) => setStatus(`${label}${t}`));
            if (b) added++;
            else already++;
          } catch (e) {
            console.log(`[BOOKS] ${f.name} not added: ${String(e)}`);
            failed.push(`${f.name}: ${String(e).replace(/^Error:\s*/, '')}`);
          } finally {
            removeQuietly(f.uri);
          }
        }
        await refresh();
        const parts = [];
        if (added) parts.push(added === 1 ? 'Book added' : `${added} books added`);
        if (already) parts.push(already === 1 ? 'already on your shelf' : `${already} already on your shelf`);
        if (failed.length) parts.push(failed.length === 1 ? `could not open ${failed[0]}` : `${failed.length} could not be opened`);
        setStatus(parts.join(' · '));
        setTimeout(() => setStatus(''), failed.length ? 12_000 : 5_000);
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  useEffect(() => onBooksChanged(() => void refresh()), [refresh]);

  // Books sent from another app ("Open in ReelVault" on an .epub).
  useEffect(
    () =>
      onIncomingBook((uris) => {
        void add(
          uris.map((uri) => {
            let name = uri.split('?')[0].split('/').pop() ?? 'book.epub';
            try {
              name = decodeURIComponent(name);
            } catch {
              // keep
            }
            return { uri, name };
          })
        );
      }),
    [add]
  );

  const actions = useMemo<BookActions>(
    () => ({
      importFiles: async () => {
        const picked = await DocumentPicker.getDocumentAsync({ type: ['application/epub+zip'], multiple: true, copyToCacheDirectory: true });
        if (picked.canceled) return;
        await add((picked.assets ?? []).map((a) => ({ uri: a.uri, name: a.name })));
      },
      open: async (id) => {
        const b = itemsRef.current.find((x) => x.id === id);
        if (!b) return null;
        const book = readBookJson(b.folder);
        if (!book) return null;
        return {
          chapters: book.chapters.map((c) => ({ title: c.title, href: c.href })),
          toc: book.toc,
          chapterText: async (i) => {
            const ch = book.chapters[i];
            return ch ? readTextIn(b.folder, ch.href) : null;
          },
          uriOf: (path) => fileUri(b.folder, path),
        };
      },
      savePlace: async (id, place, addMs) => {
        const at = Date.now();
        const was = itemsRef.current.find((b) => b.id === id);
        if (was && addMs > 0) {
          const before = progressAt(was.chapterSizes, was.chapter, was.chapterFrac);
          logBookRead(id, at, addMs, before, progressAt(was.chapterSizes, place.chapter, place.chapterFrac)).catch((e) => console.log(`[BOOKS] session not saved: ${String(e)}`));
        }
        setItems((list) => list.map((b) => (b.id === id ? { ...b, ...place, readMs: b.readMs + addMs, lastReadAt: at } : b)));
        await saveBookPlace(id, place, addMs, at);
      },
      setFinished: async (id, finished) => {
        const at = finished ? Date.now() : null;
        setItems((list) => list.map((b) => (b.id === id ? { ...b, finishedAt: at } : b)));
        await setBookFinished(id, at);
      },
      rate: async (ids, rating) => {
        patch(ids, (b) => ({ ...b, rating }));
        await setBooksField(ids, 'rating', rating);
      },
      setStatus: async (ids, st) => {
        patch(ids, (b) => ({ ...b, status: st }));
        await setBooksField(ids, 'status', st);
      },
      addTag: async (ids, name) => {
        const t = cleanTag(name);
        if (!t) return;
        patch(ids, (b) => (b.tags.some((x) => x.toLowerCase() === t.toLowerCase()) ? b : { ...b, tags: [...b.tags, t].sort((x, y) => x.localeCompare(y)) }));
        await addBookTag(ids, t);
      },
      removeTag: async (ids, name) => {
        patch(ids, (b) => ({ ...b, tags: b.tags.filter((x) => x.toLowerCase() !== name.toLowerCase()) }));
        await removeBookTag(ids, name);
      },
      setPrivate: async (ids, value) => {
        patch(ids, (b) => ({ ...b, isPrivate: value }));
        await setBooksField(ids, 'is_private', value ? 1 : 0);
      },
      trash: async (ids) => {
        const at = Date.now();
        patch(ids, (b) => ({ ...b, deletedAt: at }));
        await setBooksField(ids, 'deleted_at', at);
        setStatus(ids.length === 1 ? 'Moved to Recently Deleted' : `${ids.length} books moved to Recently Deleted`);
        setTimeout(() => setStatus(''), 4000);
      },
      restore: async (ids) => {
        patch(ids, (b) => ({ ...b, deletedAt: null }));
        await setBooksField(ids, 'deleted_at', null);
      },
      purge: async (ids) => {
        for (const id of ids) {
          const b = itemsRef.current.find((x) => x.id === id);
          await deleteBook(id);
          if (b) removeFolder(b.folder);
        }
        const set = new Set(ids);
        setItems((list) => list.filter((x) => !set.has(x.id)));
      },
      edit: async (id, title, author) => {
        const t = title?.trim() || null;
        const a = author?.trim() || null;
        patch([id], (b) => ({ ...b, title: t, author: a }));
        await setBookText(id, t, a);
      },
      setNotes: async (id, notes) => {
        const n = notes?.trim() ? notes : null;
        patch([id], (b) => ({ ...b, notes: n }));
        await setBookNotes(id, n);
      },
      setCover: async (id, own) => {
        const b = itemsRef.current.find((x) => x.id === id);
        if (!b) return;
        let next: string | null;
        if (own) {
          next = readBookJson(b.folder)?.cover ?? null;
        } else {
          const picked = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
          if (picked.canceled || !picked.assets?.[0]) return;
          next = `.cover-${Date.now()}.jpg`;
          const dest = fileIn(b.folder, next);
          await new File(picked.assets[0].uri).move(dest);
          if (ReelVaultMedia) await ReelVaultMedia.shrinkImage(dest.uri, 900, 0.85).catch(() => -1);
        }
        // A cover you picked before goes; the book's own picture stays inside the book.
        if (b.cover && /^\.cover-\d+\.jpg$/.test(b.cover) && b.cover !== next) {
          try {
            const old = fileIn(b.folder, b.cover);
            if (old.exists) old.delete();
          } catch {
            // ignore
          }
        }
        patch([id], (x) => ({ ...x, cover: next }));
        await setBookCover(id, next);
      },
      loadMarks: async (id) => (onPhone ? listBookMarks(id) : []),
      addMark: async (m) => {
        const id = await addBookMark(m);
        return { ...m, id };
      },
      setMarkNote: async (id, note) => setBookMarkNote(id, note?.trim() ? note : null),
      deleteMark: async (id) => deleteBookMark(id),
      loadReads: async () => (onPhone ? listBookReads() : []),
      passage: async (id) => {
        const b = itemsRef.current.find((x) => x.id === id);
        const book = b ? readBookJson(b.folder) : null;
        if (!b || !book) return [];
        // Where you are, else the first chapter with real paragraphs in it.
        const order = [b.chapter, ...book.chapters.map((_, i) => i).filter((i) => i > 2 && i !== b.chapter)].slice(0, 6);
        for (const c of order) {
          const ch = book.chapters[c];
          const xhtml = ch ? readTextIn(b.folder, ch.href) : null;
          if (!xhtml) continue;
          const paras = chapterBlocks(xhtml, ch.href)
            .blocks.filter((x) => x.k === 'p')
            .map((x) => ('runs' in x ? x.runs.map((r) => r.t).join('') : ''))
            .filter((t) => t.length > 80);
          if (paras.length) return paras.slice(Math.max(0, Math.min(b.block, paras.length - 6)), Math.max(0, Math.min(b.block, paras.length - 6)) + 6);
        }
        return [];
      },
      setSort: async (s) => {
        setSortState(s);
        await setSetting(SORT_KEY, s);
      },
      setReader: async (prefs) => {
        setReaderState(prefs);
        await setSetting(READER_KEY, JSON.stringify(prefs));
      },
    }),
    [add, patch]
  );

  const ui = useMemo(() => items.map(asUi), [items]);
  const live = useMemo(() => ui.filter((b) => !b.deletedAt), [ui]);
  const deleted = useMemo(() => ui.filter((b) => b.deletedAt), [ui]);
  return useMemo(() => ({ items: live, deleted, trashDays, loaded, status, busy, reader, sort, actions }), [live, deleted, trashDays, loaded, status, busy, reader, sort, actions]);
}
