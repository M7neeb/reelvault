/**
 * The Books mode of the Videos tab: the shelf, a book's page, the reader on
 * top of them, and the reading stats with Books Wrapped. iOS shows one
 * full-screen page at a time, so one closes before the next opens.
 * Presentational only (see the note at the top of types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { dayGoal, quoteOfDay, quotesOf } from '../../books/bookGoals';
import { shelfTags, type BookMark, type BookRead, type BookSort } from '../../books/bookLogic';
import { bookStats } from '../../books/bookStats';
import type { VideosMode } from '../overviewParts';
import { afterModals } from '../screen';
import BookInfo from './BookInfo';
import BookQuotes from './BookQuotes';
import BookReader from './BookReader';
import BooksDashboard from './BooksDashboard';
import BooksScreen from './BooksScreen';
import type { BooksData } from './bookTypes';

export type BooksDev = { reader?: boolean; dashboard?: boolean; info?: boolean; deleted?: boolean; quotes?: boolean; quote?: boolean; panel?: string };

export default function BooksSection({
  data,
  onMode,
  showPrivate,
  onUnlockPrivate,
  openRequest,
  onOpenHandled,
  dev,
}: {
  data: BooksData;
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
  }, [away, data.loaded, data.actions]);

  const seen = useMemo(() => data.items.filter((b) => showPrivate || !b.isPrivate), [data.items, showPrivate]);
  const quotes = useMemo(() => quotesOf(marks, seen), [marks, seen]);
  const quote = useMemo(() => quoteOfDay(quotes, now), [quotes, now]);
  const today = useMemo(() => dayGoal(bookStats(seen, reads, now).todayMs, data.goals.dailyMin), [seen, reads, now, data.goals.dailyMin]);

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
          startAt={reading?.at ?? null}
          onPrefs={(p) => void data.actions.setReader(p).catch(() => undefined)}
          onClose={() => setReading(null)}
        />
      )}
    </View>
  );
}
