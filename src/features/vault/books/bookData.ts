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
import { getSetting, setSetting } from '../library';
import type { BookActions, BookUi, BooksData } from '../ui/books/bookTypes';
import { DEFAULT_READER, displayTitle, parseReaderPrefs, type BookItem, type ReaderPrefs } from './bookLogic';
import { deleteBook, findBookByKey, insertBook, listBooks, saveBookPlace, setBookFinished } from './bookStore';

const READER_KEY = 'books.reader';
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
  }, [refresh]);

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
        setItems((list) => list.map((b) => (b.id === id ? { ...b, ...place, readMs: b.readMs + addMs, lastReadAt: at } : b)));
        await saveBookPlace(id, place, addMs, at);
      },
      setFinished: async (id, finished) => {
        const at = finished ? Date.now() : null;
        setItems((list) => list.map((b) => (b.id === id ? { ...b, finishedAt: at } : b)));
        await setBookFinished(id, at);
      },
      remove: async (id) => {
        const b = itemsRef.current.find((x) => x.id === id);
        await deleteBook(id);
        if (b) removeFolder(b.folder);
        setItems((list) => list.filter((x) => x.id !== id));
        setStatus(b ? `Removed ${displayTitle(b)}` : '');
        setTimeout(() => setStatus(''), 4000);
      },
      setReader: async (prefs) => {
        setReaderState(prefs);
        await setSetting(READER_KEY, JSON.stringify(prefs));
      },
    }),
    [add]
  );

  const ui = useMemo(() => items.map(asUi), [items]);
  return useMemo(() => ({ items: ui, loaded, status, busy, reader, actions }), [ui, loaded, status, busy, reader, actions]);
}
