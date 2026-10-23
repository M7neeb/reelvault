/**
 * The Manga mode of the Videos tab: the library, a series' page and the
 * reader, put together. Presentational only (see the note at the top of types.ts).
 */

import { useState } from 'react';
import { View } from 'react-native';

import { nextChapter, type MangaChapter } from '../../manga/mangaLogic';
import type { VideosMode } from '../overviewParts';
import { sheet, useStyles, type Palette } from '../theme';
import MangaDetail from './MangaDetail';
import MangaReader from './MangaReader';
import MangaScreen from './MangaScreen';
import type { MangaData } from './mangaTypes';

export type MangaDev = { detail?: boolean; reader?: boolean; deleted?: boolean; /** Which series the reader opens (default: the first). */ seriesId?: string };

export default function MangaSection({
  data,
  onMode,
  showPrivate,
  onUnlockPrivate,
  dev,
}: {
  data: MangaData;
  onMode: (m: VideosMode) => void;
  showPrivate: boolean;
  onUnlockPrivate?: () => void;
  /** The browser preview opens one surface at once. */
  dev?: MangaDev;
}) {
  const styles = useStyles(makeStyles);
  const first = (dev?.seriesId ? data.items.find((s) => s.id === dev.seriesId) : null) ?? data.items[0];
  const [detailId, setDetailId] = useState<string | null>(dev?.detail || dev?.reader ? (first?.id ?? null) : null);
  const [reading, setReading] = useState<{ seriesId: string; chapterId: string; fromStart: boolean } | null>(() => {
    if (!dev?.reader || !first) return null;
    const c = nextChapter(first) ?? first.chapters[0];
    return c ? { seriesId: first.id, chapterId: c.id, fromStart: false } : null;
  });
  const detail = detailId ? (data.items.find((s) => s.id === detailId) ?? null) : null;
  const readSeries = reading ? (data.items.find((s) => s.id === reading.seriesId) ?? null) : null;
  const readChapter = readSeries?.chapters.find((c) => c.id === reading?.chapterId) ?? null;

  const read = (seriesId: string, c: MangaChapter, fromStart = false) => setReading({ seriesId, chapterId: c.id, fromStart });

  return (
    <View style={styles.fill}>
      <MangaScreen
        items={data.items}
        deleted={data.deleted}
        status={data.status}
        busy={data.busy}
        showPrivate={showPrivate}
        onUnlockPrivate={onUnlockPrivate}
        actions={data.actions}
        onOpen={(s) => setDetailId(s.id)}
        onContinue={(s) => {
          const c = nextChapter(s) ?? s.chapters[0];
          if (c) read(s.id, c);
          else setDetailId(s.id);
        }}
        onMode={onMode}
        initialDeleted={dev?.deleted}
      />
      {detail && <MangaDetail series={detail} actions={data.actions} onRead={(c, fromStart) => read(detail.id, c, fromStart)} onClose={() => setDetailId(null)} />}
      {readSeries && readChapter && (
        <MangaReader key={`${readSeries.id}:${reading?.fromStart}`} series={readSeries} chapter={readChapter} fromStart={reading?.fromStart} actions={data.actions} onClose={() => setReading(null)} />
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: p.bg },
  });
