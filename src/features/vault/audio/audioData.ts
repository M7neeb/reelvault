/**
 * The Audio section's data (native wiring): loads the library, imports from
 * Files, a folder, "Open in ReelVault" and Wi-Fi transfer, keeps Recently
 * Deleted, cleans up what is no longer needed, and gives the screens
 * everything as plain data and functions (see ui/audio/audioTypes.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Share } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

import { ReelVaultMedia } from '../../../../modules/reelvault-media';
import { stickyAsker } from '../dupMatch';
import { getSetting, setSetting } from '../library';
import type { AudioStatus } from './audioLogic';
import { DEFAULT_AUDIO_PREFS, displayTitle, parseAudioPrefs, type AudioPrefs } from './audioLogic';

const AUDIO_PREFS_KEY = 'audio.prefs';
import { addExtras, addTracks, importAudio, listExtras, removeExtra, type AudioDuplicateInfo, type AudioImportSummary, type PickedAudioFile } from './audioImport';
import {
  addAudioTag,
  addBookmark,
  addPlay,
  allAudioFolders,
  allPlays,
  deleteAudioRows,
  expiredAudio,
  listAudio,
  listBookmarks,
  markFinished,
  removeAudioTag,
  removeBookmark,
  resetPosition,
  restoreAudio,
  savePosition,
  trashAudio,
  updateAudio,
} from './audioStore';
import { audioRoot, BOOK_JSON, fileIn, fileUri, folderBytes, itemDir, openSink, openSource, readBookJson, readTextIn, removeFolder } from './audioFiles';
import { AUDIO_PICKER_TYPES, audioKindOf } from './formats';
import { zipWriter } from './zip';
import { strToU8 } from 'fflate';
import type { AudioData, AudioUiItem } from '../ui/audio/audioTypes';
import type { DuplicateAsk } from '../ui/types';
import type { AudioItem } from './audioLogic';
import { onIncomingAudio } from '../incoming';

function asUi(i: AudioItem): AudioUiItem {
  return {
    ...i,
    coverSource: i.cover ? fileUri(i.folder, i.cover) : null,
    trackUris: i.tracks.map((t) => fileUri(i.folder, t.file)),
  };
}

function describe(s: AudioImportSummary): string {
  const parts = [`Added ${s.imported}`];
  if (s.replaced.length) parts.push(`${s.replaced.length} replaced`);
  if (s.keptBoth.length) parts.push(`${s.keptBoth.length} kept as a second copy`);
  if (s.duplicates.length) parts.push(`${s.duplicates.length} already here, skipped`);
  if (s.unverified.length) parts.push(`${s.unverified.length} may not play`);
  if (s.failed.length) parts.push(`${s.failed.length} failed`);
  return parts.join(' · ');
}

/** Every file in a folder (and its sub-folders), as paths relative to it. */
function walkFiles(dir: Directory, prefix = '', depth = 0): { rel: string; file: File }[] {
  const out: { rel: string; file: File }[] = [];
  for (const e of dir.list()) {
    if (e instanceof Directory) {
      if (depth < 12) out.push(...walkFiles(e, `${prefix}${e.name}/`, depth + 1));
    } else out.push({ rel: `${prefix}${e.name}`, file: e });
  }
  return out;
}

/**
 * Folders under audio/ that no item points at (an import that stopped half
 * way, or the old folder of a Replace) are removed once they are 6 hours old.
 */
async function tidyAudio(): Promise<void> {
  if (!audioRoot?.exists) return;
  const known = new Set((await allAudioFolders()).map((r) => r.folder.split('/').pop()));
  const ages = ReelVaultMedia ? new Map((await ReelVaultMedia.entries(audioRoot.uri).catch(() => [])).map((e) => [e.name, e.modified])) : new Map<string, number>();
  for (const d of audioRoot.list()) {
    if (!(d instanceof Directory) || known.has(d.name)) continue;
    const age = Date.now() - (ages.get(d.name) ?? Date.now());
    if (age < 6 * 3_600_000) continue;
    try {
      d.delete();
      console.log(`[AUDIO] removed a leftover folder ${d.name}`);
    } catch (e) {
      console.log(`[AUDIO] leftover ${d.name} not removed: ${String(e)}`);
    }
  }
}

export function useAudioData(): AudioData {
  const [all, setAll] = useState<AudioItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [duplicateAsk, setDuplicateAsk] = useState<DuplicateAsk | null>(null);
  const [prefs, setPrefsState] = useState<AudioPrefs>(DEFAULT_AUDIO_PREFS);
  useEffect(() => {
    getSetting(AUDIO_PREFS_KEY)
      .then((j) => setPrefsState(parseAudioPrefs(j)))
      .catch(() => undefined);
  }, []);
  const allRef = useRef<AudioItem[]>([]);
  allRef.current = all;

  const refresh = useCallback(async () => {
    try {
      setAll(await listAudio());
    } catch (e) {
      console.log(`[AUDIO] load failed: ${String(e)}`);
    }
  }, []);

  // On start: load, empty what has been in Recently Deleted too long, then tidy up.
  useEffect(() => {
    (async () => {
      await refresh();
      try {
        const prefs = JSON.parse((await getSetting('vault.prefs')) ?? '{}');
        const days = [1, 3, 7, 14, 30].includes(prefs?.trashDays) ? prefs.trashDays : 30;
        const gone = await expiredAudio(Date.now(), days);
        if (gone.length) {
          for (const g of gone) removeFolder(g.folder);
          await deleteAudioRows(gone.map((g) => g.id));
          await refresh();
        }
      } catch (e) {
        console.log(`[AUDIO] purge failed: ${String(e)}`);
      }
      setTimeout(() => tidyAudio().catch((e) => console.log(`[AUDIO] tidy: ${String(e)}`)), 20_000);
    })();
  }, [refresh]);

  const runNow = useCallback(
    async (files: PickedAudioFile[], keepOriginals: boolean) => {
      if (!files.length) return;
      setBusy(true);
      try {
        const onDuplicate = stickyAsker<AudioDuplicateInfo>(
          (info) =>
            new Promise((resolve) => {
              const e = info.existing;
              setDuplicateAsk({
                kind: 'audio',
                name: info.name,
                size: info.size,
                durationMs: info.durationMs,
                existing: {
                  id: e.id,
                  title: e.isPrivate ? 'An item in Private' : displayTitle(e),
                  detail: e.author ?? e.filename,
                  thumb: e.isPrivate || !e.cover ? null : fileUri(e.folder, e.cover),
                  rating: e.isPrivate ? 0 : e.rating,
                  importedAt: e.importedAt,
                },
                exact: info.exact,
                reason: info.reason,
                remaining: info.remaining,
                answer: (choice, allToo) => {
                  setDuplicateAsk(null);
                  resolve({ choice, all: allToo });
                },
              });
            })
        );
        const summary = await importAudio(files, {
          keepOriginals,
          onStep: setStatus,
          onDuplicate,
          asBooks: (groups) =>
            new Promise((resolve) => {
              const list = groups.map((g) => `${g.album} (${g.count} files)`).join('\n');
              Alert.alert(
                groups.length === 1 ? 'One book?' : `${groups.length} books?`,
                `These files belong together:\n${list}\n\nAdd them as one book with a chapter per file?`,
                [
                  { text: 'Separate files', style: 'cancel', onPress: () => resolve([]) },
                  { text: groups.length === 1 ? 'One book' : 'One book each', onPress: () => resolve(groups.map((g) => g.album)) },
                ]
              );
            }),
        });
        await refresh();
        setStatus(describe(summary));
        if (summary.failed.length) Alert.alert('Some files were not added', summary.failed.map((f) => `${f.name}: ${f.reason}`).join('\n'));
      } catch (e) {
        console.log(`[AUDIO] import failed: ${String(e)}`);
        setStatus('Adding failed');
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );
  // One import at a time: a Wi-Fi transfer hands over each file on its own, and two waiting on
  // "already in your library" at once would hide the first question behind the second.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const run = useCallback(
    (files: PickedAudioFile[], keepOriginals: boolean) => {
      const next = queue.current.then(() => runNow(files, keepOriginals));
      queue.current = next.catch(() => undefined);
      return next;
    },
    [runNow]
  );

  // Audio and books sent from another app ("Open in ReelVault").
  useEffect(
    () =>
      onIncomingAudio((uris) => {
        setStatus(uris.length === 1 ? 'Adding what you sent…' : `Adding ${uris.length} files you sent…`);
        run(
          uris.map((uri) => {
            let name = uri.split('?')[0].split('/').pop() ?? 'audio';
            try {
              name = decodeURIComponent(name);
            } catch {
              // keep
            }
            return { uri, name };
          }),
          false
        ).catch(() => undefined);
      }),
    [run]
  );

  const byId = (id: string) => allRef.current.find((i) => i.id === id);

  const actions = useMemo<AudioData['actions']>(
    () => ({
      importFiles: async () => {
        const picked = await DocumentPicker.getDocumentAsync({ type: AUDIO_PICKER_TYPES, multiple: true, copyToCacheDirectory: true });
        if (picked.canceled) return;
        await run((picked.assets ?? []).map((a) => ({ uri: a.uri, name: a.name, size: a.size ?? undefined })), false);
      },
      importFolder: async () => {
        let dir: Directory;
        try {
          dir = await Directory.pickDirectoryAsync();
        } catch {
          return;
        }
        const files = walkFiles(dir)
          .filter((f) => audioKindOf(f.file.name))
          .map((f) => ({ uri: f.file.uri, name: f.file.name, size: f.file.size ?? 0 }));
        if (!files.length) {
          Alert.alert('No audio here', 'That folder has no audio files or EPUB books.');
          return;
        }
        await run(files, true);
      },
      update: async (ids, patch) => {
        await updateAudio(ids, patch);
        await refresh();
      },
      addTag: async (ids, name) => {
        for (const id of ids) await addAudioTag(id, name);
        await refresh();
      },
      removeTag: async (id, name) => {
        await removeAudioTag(id, name);
        await refresh();
      },
      trash: async (ids) => {
        await trashAudio(ids, Date.now());
        await refresh();
      },
      restore: async (ids) => {
        await restoreAudio(ids);
        await refresh();
      },
      purge: async (ids) => {
        for (const id of ids) {
          const it = byId(id);
          if (it) removeFolder(it.folder);
        }
        await deleteAudioRows(ids);
        await refresh();
      },
      savePosition: async (id, track, ms) => {
        await savePosition(id, track, ms, Date.now());
        // Only the one item changes: no full reload while playing.
        setAll((list) => list.map((i) => (i.id === id ? { ...i, positionTrack: track, positionMs: ms, lastPlayedAt: Date.now(), status: i.status === null || i.status === 'planned' ? 'listening' : i.status } : i)));
      },
      markFinished: async (id) => {
        await markFinished(id, Date.now());
        await refresh();
      },
      reset: async (id, st: AudioStatus | null) => {
        await resetPosition(id, st);
        await refresh();
      },
      addPlay: (id, startedAt, listenedMs, fromMs, toMs) => addPlay(id, startedAt, listenedMs, fromMs, toMs),
      loadPlays: allPlays,
      listBookmarks,
      addBookmark,
      removeBookmark,
      loadBook: async (id) => {
        const it = byId(id);
        if (!it || it.kind !== 'book') return null;
        const book = readBookJson(it.folder);
        if (!book) return null;
        return {
          book,
          chapterText: async (index: number) => {
            const ch = book.chapters[index];
            return ch ? readTextIn(it.folder, ch.href) : null;
          },
          uriOf: (path: string) => fileUri(it.folder, path),
        };
      },
      share: async (id) => {
        const it = byId(id);
        if (!it) return;
        if (it.kind !== 'book') {
          const t = it.tracks[0];
          if (t) await Share.share({ url: fileUri(it.folder, t.file) });
          return;
        }
        // The book again as an .epub, built a piece at a time in the temporary folder and removed after sharing.
        setBusy(true);
        setStatus('Making the .epub…');
        const out = new File(Paths.cache, `${(displayTitle(it) || 'book').replace(/[^\w\- ]+/g, '_').slice(0, 60)}.epub`);
        try {
          const sink = openSink(out);
          try {
            const w = zipWriter((b) => sink.write(b));
            const files = walkFiles(itemDir(it.folder)).filter((f) => f.rel !== BOOK_JSON && !/^cover-\d+\.jpg$/.test(f.rel));
            const mime = files.find((f) => f.rel === 'mimetype');
            w.addStored('mimetype', strToU8(mime ? (readTextIn(it.folder, 'mimetype') ?? 'application/epub+zip').trim() : 'application/epub+zip'));
            for (const f of files) {
              if (f.rel === 'mimetype') continue;
              await w.add(f.rel, async function* () {
                const src = openSource(f.file);
                try {
                  for (let o = 0; o < src.size; o += 512 * 1024) {
                    yield src.read(o, 512 * 1024);
                    await new Promise((r) => setTimeout(r, 0));
                  }
                } finally {
                  src.close();
                }
              });
            }
            w.finish();
          } finally {
            sink.close();
          }
          setStatus('');
          await Share.share({ url: out.uri });
        } catch (e) {
          console.log(`[AUDIO] epub not made: ${String(e)}`);
          Alert.alert('Could not make the .epub', String(e));
        } finally {
          try {
            if (out.exists) out.delete();
          } catch {
            // the clean-up at start removes it
          }
          setBusy(false);
        }
      },
      setCoverFromPhoto: async (id) => {
        const it = byId(id);
        if (!it) return;
        const picked = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true, multiple: false });
        if (picked.canceled || !picked.assets?.[0]) return;
        const name = `cover-${Date.now()}.jpg`;
        const dest = fileIn(it.folder, name);
        await new File(picked.assets[0].uri).move(dest);
        if (ReelVaultMedia) await ReelVaultMedia.shrinkImage(dest.uri, 720, 0.8).catch(() => -1);
        // The old cover goes, if it was one of ours (a book's own picture stays inside the book).
        if (it.cover && /^cover-\d+\.jpg$/.test(it.cover)) {
          try {
            const old = fileIn(it.folder, it.cover);
            if (old.exists) old.delete();
          } catch {
            // ignore
          }
        }
        await updateAudio([id], { cover: name });
        await refresh();
      },
      storageBytes: async () => {
        if (ReelVaultMedia && audioRoot?.exists) return ReelVaultMedia.dirSize(audioRoot.uri).catch(() => 0);
        return allRef.current.reduce((a, i) => a + folderBytes(i.folder), 0);
      },
      addTracks: async (id) => {
        const picked = await DocumentPicker.getDocumentAsync({ type: ['audio/*'], multiple: true, copyToCacheDirectory: true });
        if (picked.canceled) return 0;
        setBusy(true);
        try {
          const n = await addTracks(id, (picked.assets ?? []).map((a) => ({ uri: a.uri, name: a.name, size: a.size ?? undefined })));
          setStatus(n ? `Added ${n} ${n === 1 ? 'file' : 'files'}` : 'Those were not audio files');
          await refresh();
          return n;
        } finally {
          setBusy(false);
        }
      },
      listExtras: async (id) => {
        const it = byId(id);
        return it ? listExtras(it.folder) : [];
      },
      addExtras: async (id) => {
        const picked = await DocumentPicker.getDocumentAsync({ type: ['*/*'], multiple: true, copyToCacheDirectory: true });
        if (picked.canceled) return 0;
        const n = await addExtras(id, (picked.assets ?? []).map((a) => ({ uri: a.uri, name: a.name, size: a.size ?? undefined })));
        await refresh();
        return n;
      },
      openExtra: async (uri) => {
        await Share.share({ url: uri });
      },
      removeExtra: async (id, name) => {
        await removeExtra(id, name);
        await refresh();
      },
      setPrefs: async (next) => {
        setPrefsState(next);
        await setSetting(AUDIO_PREFS_KEY, JSON.stringify(next));
      },
    }),
    [refresh, run]
  );

  const items = useMemo(() => all.filter((i) => !i.deletedAt).map(asUi), [all]);
  const deleted = useMemo(() => all.filter((i) => i.deletedAt).map(asUi), [all]);
  return { items, deleted, busy, status, duplicateAsk, actions, prefs };
}
