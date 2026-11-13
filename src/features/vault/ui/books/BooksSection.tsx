/**
 * The Books mode of the Videos tab: the shelf, and the reader on top of it.
 * Presentational only (see the note at the top of types.ts).
 */

import { useState } from 'react';
import { View } from 'react-native';

import type { VideosMode } from '../overviewParts';
import BookReader from './BookReader';
import BooksScreen from './BooksScreen';
import type { BooksData } from './bookTypes';

export default function BooksSection({ data, onMode, dev }: { data: BooksData; onMode: (m: VideosMode) => void; dev?: { reader?: boolean } }) {
  const [openId, setOpenId] = useState<string | null>(dev?.reader ? (data.items[0]?.id ?? null) : null);
  const open = openId ? (data.items.find((b) => b.id === openId) ?? null) : null;
  return (
    <View style={{ flex: 1 }}>
      <BooksScreen items={data.items} loaded={data.loaded} status={data.status} busy={data.busy} actions={data.actions} onOpen={(b) => setOpenId(b.id)} onMode={onMode} />
      {open && (
        <BookReader
          key={open.id}
          book={open}
          actions={data.actions}
          prefs={data.reader}
          onPrefs={(p) => void data.actions.setReader(p).catch(() => undefined)}
          onClose={() => setOpenId(null)}
        />
      )}
    </View>
  );
}
