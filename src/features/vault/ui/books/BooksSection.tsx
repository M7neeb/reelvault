/**
 * The Books mode of the Videos tab: the shelf, a book's page, the reader on
 * top of them, and the reading stats with Books Wrapped. iOS shows one
 * full-screen page at a time, so one closes before the next opens.
 * Presentational only (see the note at the top of types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { AppState, View } from 'react-native';

import { audioOf, listenAlongFrom, newAudio, suggestAudio } from '../../books/bookAudio';
import { chaptersOf } from '../../audio/audioLogic';
import { dayGoal, quoteOfDay, quotesOf } from '../../books/bookGoals';
import { chapterLabel, progressOf, shelfTags, type BookMark, type BookRead, type BookSort } from '../../books/bookLogic';
import { pushJump } from '../../jump';
import { AudioPlayerScreen, MiniPlayer } from '../audio/AudioPlayer';
import type { AudioData, AudioUiItem } from '../audio/audioTypes';
import { useAudioPlaybackOptional } from '../audio/playback';
import { useTabBarSpace } from '../chrome';
import { bookStats, todayByBook } from '../../books/bookStats';
import type { VideosMode } from '../overviewParts';
import { afterModals } from '../screen';
import BookInfo from './BookInfo';
import BookQuotes from './BookQuotes';
import BookReader from './BookReader';
import BooksDashboard from './BooksDashboard';
import BooksScreen from './BooksScreen';
import type { BooksData, BookUi } from './bookTypes';

export type BooksDev = { reader?: boolean; dashboard?: boolean; info?: boolean; deleted?: boolean; quotes?: boolean; quote?: boolean; panel?: string };

export default function BooksSection({
  data,
  audio,
  onMode,
  showPrivate,
  onUnlockPrivate,
  openRequest,
  onOpenHandled,
  dev,
}: {
  data: BooksData;
  /** The Audio section's library: a book's audiobook is one of its items. */
  audio?: AudioData | null;
  onMode: (m: VideosMode) => void;
  showPrivate: boolean;
  onUnlockPrivate?: () => void;
  /** From the Search tab: open a book in the reader. */
  openRequest?: { id: string } | null;
  onOpenHandled?: () => void;
  dev?: BooksDev;
}) {
  const [reading, setReading] = useState<{ id: string; at?: { chapter: number; block: number } } | null>(dev?.reader && data.items[0] ? { id: data.items[0].id } : null);
  const [infoId, setInfoId] = useState<string | null>(dev?.info ? (data.items[0]?.id ?? null) : null);
  const [dash, setDash] = useState(dev?.dashboard ?? false);
  const open = reading ? (data.items.find((b) => b.id === reading.id) ?? null) : null;
  const info = infoId ? (data.items.find((b) => b.id === infoId) ?? null) : null;
  const tags = useMemo(() => shelfTags(data.items).map((t) => t.name), [data.items]);
  const [quotesOpen, setQuotesOpen] = useState(dev?.quotes || dev?.quote || false);
  const [marks, setMarks] = useState<BookMark[]>([]);
  const [reads, setReads] = useState<BookRead[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Highlights and reading time change inside the reader and a book's page: read them again once those close.
  const away = !!reading || !!infoId || dash;
  // Back in the app (maybe the next morning): "today" has to be worked out again.
  const [woke, setWoke] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => st === 'active' && setWoke((n) => n + 1));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (away || !data.loaded) return;
    let alive = true;
    setNow(Date.now());
    data.actions
      .loadAllMarks()
      .then((m) => alive && setMarks(m))
      .catch(() => undefined);
    data.actions
      .loadReads()
      .then((r) => alive && setReads(r))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [away, woke, data.loaded, data.actions]);

  // ---- audiobooks: linked from the Audio section, played with its player
  const pb = useAudioPlaybackOptional();
  const tabSpace = useTabBarSpace();
  const [player, setPlayer] = useState(false);
  const [pendingLink, setPendingLink] = useState<{ bookId: string; before: Set<string> } | null>(null);
  const audioItems = useMemo(() => (audio?.items ?? []).filter((a) => showPrivate || !a.isPrivate), [audio?.items, showPrivate]);
  const audiobookOf = (bookId: string): AudioUiItem | null => audioOf(data.audioLinks, bookId, audioItems);
  const linkedIds = useMemo(() => new Set(Object.values(data.audioLinks)), [data.audioLinks]);
  const playingLinked = !!pb?.item && linkedIds.has(pb.item.id);

  const startListening = (book: BookUi, from: 'audio' | 'book' | 'auto') => {
    const item = audiobookOf(book.id);
    if (!pb || !item) return false;
    if (from === 'auto' && pb.item?.id === item.id) {
      if (!pb.playing) pb.resume();
      return true;
    }
    if (from === 'audio') {
      pb.open(item, { autoplay: true });
      return true;
    }
    // Chapter names line the text up with the audio; the book is opened for them.
    data.actions
      .open(book.id)
      .catch(() => null)
      .then((opened) => {
        const titles = opened ? opened.chapters.map((c, i) => chapterLabel(opened.toc, i, book.title, c.title)) : [];
        const at = listenAlongFrom(item, chaptersOf(item), { titles, chapter: book.chapter, chapterFrac: book.chapterFrac, frac: progressOf(book) });
        pb.open(item, at ? { track: at.track, ms: at.ms, autoplay: true } : { autoplay: true });
      });
    return true;
  };

  const importAudioFor = (bookId: string) => {
    if (!audio) return;
    const marker = { bookId, before: new Set(audio.items.map((a) => a.id)) };
    setPendingLink(marker);
    audio.actions
      .importFiles()
      .catch(() => undefined)
      // Nothing new (cancelled, or already in Audio): stop waiting after a while.
      .finally(() => setTimeout(() => setPendingLink((p) => (p === marker ? null : p)), 4000));
  };

  // What was just imported for a book becomes its audiobook.
  useEffect(() => {
    if (!pendingLink || !audio) return;
    const added = newAudio(pendingLink.before, audio.items);
    if (!added.length) return;
    const book = data.items.find((b) => b.id === pendingLink.bookId);
    const pick = (book && suggestAudio(book, added, {})) ?? added[0];
    setPendingLink(null);
    void data.actions.setAudio(pendingLink.bookId, pick.id).catch(() => undefined);
  }, [pendingLink, audio?.items]); // eslint-disable-line react-hooks/exhaustive-deps

  const seen = useMemo(() => data.items.filter((b) => showPrivate || !b.isPrivate), [data.items, showPrivate]);
  const quotes = useMemo(() => quotesOf(marks, seen), [marks, seen]);
  const quote = useMemo(() => quoteOfDay(quotes, now), [quotes, now]);
  const today = useMemo(() => dayGoal(bookStats(seen, reads, now).todayMs, data.goals.dailyMin), [seen, reads, now, data.goals.dailyMin]);
  const readToday = useMemo(() => todayByBook(reads, now), [reads, now]);

  useEffect(() => {
    if (!openRequest) return;
    // Not loaded yet: wait for the shelf.
    if (!data.loaded) return;
    onOpenHandled?.();
    const b = data.items.find((x) => x.id === openRequest.id);
    if (b && (showPrivate || !b.isPrivate)) setReading({ id: b.id });
  }, [openRequest, data.loaded, data.items]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ flex: 1 }}>
      <BooksScreen
        items={data.items}
        deleted={data.deleted}
        trashDays={data.trashDays}
        loaded={data.loaded}
        status={data.status}
        busy={data.busy}
        actions={data.actions}
        showPrivate={showPrivate}
        onUnlockPrivate={onUnlockPrivate}
        sort={data.sort}
        onSort={(s: BookSort) => void data.actions.setSort(s).catch(() => undefined)}
        onOpen={(b) => setReading({ id: b.id })}
        onInfo={(b) => setInfoId(b.id)}
        onMode={onMode}
        onDashboard={() => setDash(true)}
        onQuotes={() => setQuotesOpen(true)}
        quote={quote}
        quoteCount={quotes.length}
        today={today}
        readToday={readToday}
        listenable={linkedIds.size ? new Set(data.items.filter((b) => audiobookOf(b.id)).map((b) => b.id)) : undefined}
        onListen={(b) => {
          if (startListening(b, 'auto')) setPlayer(true);
        }}
        bottomSpace={playingLinked ? 72 : 0}
        initialDeleted={dev?.deleted}
      />
      {dash && (
        <BooksDashboard
          items={data.items.filter((b) => showPrivate || !b.isPrivate)}
          actions={data.actions}
          goals={data.goals}
          onOpen={(b) => {
            setDash(false);
            afterModals(() => setReading({ id: b.id }));
          }}
          onClose={() => setDash(false)}
        />
      )}
      {playingLinked && !player && !open && !info && !dash && !quotesOpen && <MiniPlayer bottom={tabSpace + 8} onExpand={() => setPlayer(true)} />}
      {player && pb?.item && audio && (
        <AudioPlayerScreen
          actions={audio.actions}
          prefs={audio.prefs}
          onInfo={(i) => {
            setPlayer(false);
            afterModals(() => pushJump({ kind: 'audio', id: i.id, play: false }));
          }}
          onClose={() => setPlayer(false)}
        />
      )}
      {quotesOpen && (!dev?.quote || quotes.length > 0) && (
        <BookQuotes
          quotes={quotes}
          paper={data.reader.theme}
          initialOpen={dev?.quote ? (quotes[0]?.id ?? null) : null}
          onRead={(q) => {
            setQuotesOpen(false);
            afterModals(() => setReading({ id: q.bookId, at: { chapter: q.chapter, block: q.block } }));
          }}
          onRemove={(q) => {
            setMarks((l) => l.filter((m) => m.id !== q.id));
            data.actions.deleteMark(q.id).catch(() => undefined);
          }}
          onClose={() => setQuotesOpen(false)}
        />
      )}
      {info && (
        <BookInfo
          book={info}
          actions={data.actions}
          tags={tags}
          audiobook={audiobookOf(info.id)}
          audioSuggestion={audio && !audiobookOf(info.id) ? suggestAudio(info, audioItems, data.audioLinks) : null}
          audioChoices={audioItems}
          audioPlaying={!!pb?.playing && !!pb.item && pb.item.id === audiobookOf(info.id)?.id}
          audioImporting={pendingLink?.bookId === info.id}
          onListen={
            audio && pb
              ? (from) => {
                  const book = info;
                  setInfoId(null);
                  afterModals(() => {
                    if (startListening(book, from)) setPlayer(true);
                  });
                }
              : undefined
          }
          onLinkAudio={audio ? (id) => void data.actions.setAudio(info.id, id).catch(() => undefined) : undefined}
          onImportAudio={audio ? () => importAudioFor(info.id) : undefined}
          onRead={(at) => {
            setInfoId(null);
            afterModals(() => setReading({ id: info.id, at }));
          }}
          onClose={() => setInfoId(null)}
        />
      )}
      {open && (
        <BookReader
          key={`${open.id}:${reading?.at ? `${reading.at.chapter}.${reading.at.block}` : ''}`}
          book={open}
          actions={data.actions}
          prefs={data.reader}
          audiobook={audiobookOf(open.id)}
          audio={audio ?? null}
          startAt={reading?.at ?? null}
          onPrefs={(p) => void data.actions.setReader(p).catch(() => undefined)}
          onClose={() => setReading(null)}
        />
      )}
    </View>
  );
}
