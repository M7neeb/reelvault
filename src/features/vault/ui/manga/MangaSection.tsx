/**
 * The Manga mode of the Videos tab: the library, a series' page and the
 * reader, put together. Presentational only (see the note at the top of types.ts).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { nextChapter, type MangaChapter } from '../../manga/mangaLogic';
import type { VideosMode } from '../overviewParts';
import { sheet, useStyles, type Palette } from '../theme';
import BrowseScreen from './BrowseScreen';
import DownloadsSheet from './DownloadsSheet';
import MangaDashboard from './MangaDashboard';
import MangaFeed, { type FeedTab } from './MangaFeed';
import MangaDetail from './MangaDetail';
import MangaReader from './MangaReader';
import MangaScreen from './MangaScreen';
import type { MangaData } from './mangaTypes';

export type MangaDev = { feed?: FeedTab; dashboard?: boolean; downloadsOpen?: boolean; detail?: boolean; reader?: boolean; deleted?: boolean; browse?: 'sources' | 'extensions'; source?: string; openKey?: string; form?: 'server' | 'repo' | 'languages'; /** Which series the reader opens (default: the first). */ seriesId?: string };

export default function MangaSection({
  data,
  onMode,
  showPrivate,
  onUnlockPrivate,
  openRequest,
  onOpenHandled,
  dev,
}: {
  data: MangaData;
  onMode: (m: VideosMode) => void;
  showPrivate: boolean;
  onUnlockPrivate?: () => void;
  /** From the Search tab: carry on reading a series, or show its page. */
  openRequest?: { id: string; read: boolean } | null;
  onOpenHandled?: () => void;
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
  const [browseOpen, setBrowseOpen] = useState(!!dev?.browse);
  const [dashOpen, setDashOpen] = useState(!!dev?.dashboard);
  const [feed, setFeed] = useState<FeedTab | null>(dev?.feed ?? null);
  const [dlOpen, setDlOpen] = useState(!!dev?.downloadsOpen);

  useEffect(() => {
    if (!openRequest) return;
    const s = data.items.find((x) => x.id === openRequest.id);
    // Not loaded yet: wait for the library.
    if (!s && !data.items.length) return;
    onOpenHandled?.();
    if (!s) return;
    setBrowseOpen(false);
    setDashOpen(false);
    setDlOpen(false);
    setDetailId(s.id);
    const c = openRequest.read ? (nextChapter(s) ?? null) : null;
    if (c) read(s.id, c);
  }, [openRequest, data.items]); // eslint-disable-line react-hooks/exhaustive-deps

  // Titles from sources already in the library, so Browse can mark them.
  const index = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of data.items) if (x.sourceId && x.sourceKey) m.set(`${x.sourceId}|${x.sourceKey}`, x.id);
    return m;
  }, [data.items]);
  const libraryIdOf = useCallback((sourceId: string, key: string) => index.get(`${sourceId}|${key}`) ?? null, [index]);

  const reader =
    readSeries && readChapter ? (
      <MangaReader
        key={`${readSeries.id}:${reading?.fromStart}`}
        series={readSeries}
        chapter={readChapter}
        fromStart={reading?.fromStart}
        actions={data.actions}
        prefs={data.browse.prefs.reader}
        onPrefs={(patch) => void data.browse.actions.setReader(patch).catch(() => undefined)}
        onOpenUrl={data.browse.actions.openUrl}
        onClose={() => setReading(null)}
      />
    ) : null;

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
        onBrowse={() => setBrowseOpen(true)}
        onDashboard={() => setDashOpen(true)}
        onFeed={setFeed}
        onDownloads={() => setDlOpen(true)}
        downloads={data.downloads}
        initialDeleted={dev?.deleted}
      />
      {/* One full-screen window at a time on the iPhone: the reader opens inside the series page when it is open. */}
      {detail ? (
        <MangaDetail
          series={detail}
          actions={data.actions}
          downloads={data.downloads}
          browse={data.browse.actions}
          anilist={data.anilist}
          onRead={(c, fromStart) => read(detail.id, c, fromStart)}
          onOpenUrl={data.browse.actions.openUrl}
          onClose={() => setDetailId(null)}>
          {reader}
        </MangaDetail>
      ) : (
        reader
      )}
      {feed && !detail && (
        <MangaFeed
          items={data.items.filter((s) => showPrivate || !s.isPrivate)}
          initialTab={feed}
          onRead={(seriesId, c) => {
            setFeed(null);
            setDetailId(seriesId);
            read(seriesId, c);
          }}
          onClose={() => setFeed(null)}
        />
      )}
      {dashOpen && !detail && (
        <MangaDashboard
          items={data.items.filter((s) => showPrivate || !s.isPrivate)}
          actions={data.actions}
          onOpen={(s) => {
            setDashOpen(false);
            setDetailId(s.id);
          }}
          onClose={() => setDashOpen(false)}
        />
      )}
      {dlOpen && !detail && <DownloadsSheet downloads={data.downloads} items={data.items} actions={data.actions} onClose={() => setDlOpen(false)} />}
      {browseOpen && !detail && (
        <BrowseScreen
          browse={data.browse}
          libraryIdOf={libraryIdOf}
          initialTab={dev?.browse}
          initialSourceId={dev?.source ?? null}
          initialOpenKey={dev?.openKey ?? null}
          initialForm={dev?.form ?? null}
          onOpenInLibrary={(id) => {
            setBrowseOpen(false);
            setDetailId(id);
          }}
          onClose={() => setBrowseOpen(false)}
        />
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: p.bg },
  });
