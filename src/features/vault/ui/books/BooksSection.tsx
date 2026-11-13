/**
 * The Books mode of the Videos tab: the shelf, a book's page, the reader on
 * top of them, and the reading stats with Books Wrapped. iOS shows one
 * full-screen page at a time, so one closes before the next opens.
 * Presentational only (see the note at the top of types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { shelfTags, type BookSort } from '../../books/bookLogic';
import type { VideosMode } from '../overviewParts';
import { afterModals } from '../screen';
import BookInfo from './BookInfo';
import BookReader from './BookReader';
import BooksDashboard from './BooksDashboard';
import BooksScreen from './BooksScreen';
import type { BooksData } from './bookTypes';

export type BooksDev = { reader?: boolean; dashboard?: boolean; info?: boolean; deleted?: boolean; panel?: string };

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
        initialDeleted={dev?.deleted}
      />
      {dash && (
        <BooksDashboard
          items={data.items.filter((b) => showPrivate || !b.isPrivate)}
          actions={data.actions}
          onOpen={(b) => {
            setDash(false);
            afterModals(() => setReading({ id: b.id }));
          }}
          onClose={() => setDash(false)}
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
