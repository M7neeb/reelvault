/**
 * The download queue: what is downloading now (with its pages), what waits,
 * and what failed with the reason. Pause, carry on, retry the failed ones,
 * cancel one or all. Downloads run while ReelVault is open (iOS stops apps
 * in the background) and carry on when you come back. "Titles" groups the
 * queue by title: small titles first, pick titles to download first, or keep
 * only the next few chapters of the long ones. Presentational only.
 */

import { Paths } from 'expo-file-system';
import { useMemo, useState } from 'react';
import { Alert, Text, TouchableOpacity, View, type AlertButton } from 'react-native';

import { beyondNext, chapterLabel, downloadSizeLeft, queueByTitle, queueWithFirst, type QueueTitle } from '../../manga/mangaLogic';
import { fmtBytes } from '../../stats';
import Icon from '../Icon';
import { SheetFrame } from '../sheets';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { DownloadState, MangaActions, MangaUiSeries } from './mangaTypes';
import { showFailure } from '../oops';

type TitleSort = 'fewest' | 'most' | 'reading' | 'queue';
const SORTS: { key: TitleSort; label: string }[] = [
  { key: 'fewest', label: 'Fewest chapters' },
  { key: 'most', label: 'Most' },
  { key: 'reading', label: 'Reading now' },
  { key: 'queue', label: 'Download order' },
];
/** A title with more waiting chapters than this counts as long. */
const BIG = 20;
const SHOWN = 200;

function sortTitles(list: QueueTitle[], sort: TitleSort): QueueTitle[] {
  if (sort === 'queue') return list;
  const n = (t: QueueTitle) => t.chapterIds.length;
  return [...list].sort((a, b) => {
    if (sort === 'reading' && a.reading !== b.reading) return a.reading ? -1 : 1;
    return (sort === 'most' ? n(b) - n(a) : n(a) - n(b)) || a.title.localeCompare(b.title);
  });
}

function sizeOf(list: QueueTitle[]): string | null {
  const known = list.filter((t) => t.bytes !== null);
  return known.length ? fmtBytes(known.reduce((n, t) => n + (t.bytes ?? 0), 0)) : null;
}

export default function DownloadsSheet({ downloads, items, actions, onClose }: { downloads: DownloadState; items: MangaUiSeries[]; actions: MangaActions; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const byId = new Map(items.map((s) => [s.id, s]));
  const label = (seriesId: string, chapterId: string) => {
    const s = byId.get(seriesId);
    const c = s?.chapters.find((x) => x.id === chapterId);
    return { title: s?.title ?? 'A title', chapter: c ? chapterLabel(c, true) : 'Chapter' };
  };
  const queued = useMemo(() => downloads.queue.filter((q) => q.state === 'queued'), [downloads.queue]);
  const failed = downloads.queue.filter((q) => q.state === 'failed');
  const cur = downloads.current;
  const now = cur ? label(cur.seriesId, cur.chapterId) : null;
  const sizeLeft = useMemo(() => downloadSizeLeft(items, queued), [items, queued]);
  let free: number | null = null;
  try {
    free = Paths.availableDiskSpace;
  } catch {
    // unknown
  }

  const [view, setView] = useState<'titles' | 'chapters'>('titles');
  const [sort, setSort] = useState<TitleSort>('fewest');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const allTitles = useMemo(() => queueByTitle(items, queued), [items, queued]);
  const titles = useMemo(() => sortTitles(allTitles, sort), [allTitles, sort]);
  const pickedTitles = titles.filter((t) => picked.has(t.seriesId));
  const big = titles.filter((t) => t.chapterIds.length > BIG);
  const clearPicks = () => setPicked(new Set());
  const toggle = (id: string) =>
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** The whole queue, smallest titles first. */
  const smallFirst = () => {
    const order = [...allTitles].sort((a, b) => a.chapterIds.length - b.chapterIds.length || a.title.localeCompare(b.title)).map((t) => t.seriesId);
    actions.orderDownloads(queueWithFirst(queued, order)).catch(showFailure);
  };
  const downloadFirst = (list: QueueTitle[]) => {
    actions
      .orderDownloads(queueWithFirst(queued, list.map((t) => t.seriesId)))
      .then(clearPicks)
      .catch(showFailure);
  };
  /** Keeps only the next few chapters (from where you are) of these titles; asks how many first. */
  const keepNext = (list: QueueTitle[], what: string) => {
    if (!list.length) return;
    const run = (keep: number) => {
      const drop = beyondNext(
        items,
        queued,
        list.map((t) => t.seriesId),
        keep
      );
      if (!drop.length) {
        Alert.alert('Nothing to take out', `${what}: no more than ${keep} chapters wait already.`);
        return;
      }
      actions.cancelDownloads(drop).then(clearPicks).catch(showFailure);
    };
    const buttons: AlertButton[] = [3, 5, 10].map((n) => ({ text: `Next ${n}`, onPress: () => run(n) }));
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Only the next chapters', `${what}: keep only the chapters you will read next (from where you are, or from the start) and take the rest out of the queue. You can download more later.`, buttons);
  };
  const takeOut = (list: QueueTitle[]) => {
    const ids = list.flatMap((t) => t.chapterIds);
    Alert.alert(list.length === 1 ? 'Take this title out?' : `Take ${list.length} titles out?`, `${ids.length} ${ids.length === 1 ? 'chapter' : 'chapters'} will not be downloaded.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Take out', style: 'destructive', onPress: () => actions.cancelDownloads(ids).then(clearPicks).catch(showFailure) },
    ]);
  };

  const pickedChapters = pickedTitles.reduce((n, t) => n + t.chapterIds.length, 0);
  const pickedSize = sizeOf(pickedTitles);

  return (
    <SheetFrame title="Downloads" onClose={onClose}>
      {!downloads.queue.length && !cur ? (
        <Text style={styles.empty}>Nothing to download. Open a title and tap Download, or choose Download everything in the Manga menu.</Text>
      ) : (
        <>
          <View style={styles.buttons}>
            <TouchableOpacity style={styles.btn} onPress={() => actions.pauseDownloads(!downloads.paused)}>
              <Icon name={downloads.paused ? 'play' : 'pause'} size={14} color={p.text} />
              <Text style={styles.btnText}>{downloads.paused ? 'Carry on' : 'Pause'}</Text>
            </TouchableOpacity>
            {failed.length > 0 && (
              <TouchableOpacity style={styles.btn} onPress={() => actions.retryDownloads().catch(showFailure)}>
                <Icon name="repeat" size={14} color={p.text} />
                <Text style={styles.btnText}>Retry {failed.length}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.btn} onPress={() => actions.cancelDownloads(null).catch(showFailure)}>
              <Icon name="close" size={13} color={p.danger} />
              <Text style={[styles.btnText, { color: p.danger }]}>Cancel all</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.note}>Downloads run while ReelVault is open and carry on by themselves when you come back to it.</Text>

          {cur && now && (
            <View style={styles.card}>
              <Text style={styles.section}>Downloading</Text>
              <Text style={styles.title} numberOfLines={1}>
                {now.title}
              </Text>
              <Text style={styles.meta}>
                {now.chapter} · page {cur.done} of {cur.total}
              </Text>
              <View style={styles.bar}>
                <View style={[styles.fill, { width: `${Math.round((cur.done / Math.max(1, cur.total)) * 100)}%` }]} />
              </View>
            </View>
          )}
          {queued.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.section}>Left to download</Text>
              <Text style={styles.title}>{sizeLeft !== null ? `About ${fmtBytes(sizeLeft)}` : 'Size not known yet'}</Text>
              <Text style={styles.meta}>
                {queued.length} {queued.length === 1 ? 'chapter' : 'chapters'}
                {sizeLeft !== null ? ' · estimated from the chapters already on your iPhone' : ' · shown once the first chapter is done'}
              </Text>
              {free !== null && free > 0 && free !== Infinity && (
                <Text style={[styles.meta, sizeLeft !== null && sizeLeft > free ? { color: p.danger, fontWeight: '700' } : null]}>
                  {fmtBytes(free)} free on your iPhone{sizeLeft !== null && sizeLeft > free ? ' · not enough for all of it' : ''}
                </Text>
              )}
            </View>
          )}
          {downloads.paused && <Text style={styles.paused}>Paused</Text>}
          {!downloads.paused && downloads.waitingWifi && <Text style={styles.paused}>Waiting for Wi-Fi (Browse › Download on Wi-Fi only)</Text>}

          {queued.length > 0 && (
            <View style={styles.tabs}>
              {(['titles', 'chapters'] as const).map((v) => (
                <TouchableOpacity key={v} style={[styles.tab, view === v && styles.tabOn]} onPress={() => setView(v)}>
                  <Text style={[styles.tabText, view === v && styles.tabTextOn]}>{v === 'titles' ? `Titles · ${titles.length}` : `Chapters · ${queued.length}`}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {queued.length > 0 && view === 'titles' && (
            <>
              <View style={styles.buttons}>
                <TouchableOpacity style={styles.btn} onPress={smallFirst}>
                  <Icon name="play" size={12} color={p.text} />
                  <Text style={styles.btnText}>Small titles first</Text>
                </TouchableOpacity>
                {big.length > 0 && (
                  <TouchableOpacity style={styles.btn} onPress={() => keepNext(big, `${big.length} long ${big.length === 1 ? 'title' : 'titles'} (over ${BIG} chapters waiting)`)}>
                    <Icon name="close" size={12} color={p.text} />
                    <Text style={styles.btnText}>Long titles: next few only</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.buttons}>
                {SORTS.map((o) => (
                  <TouchableOpacity key={o.key} style={[styles.chip, sort === o.key && styles.chipOn]} onPress={() => setSort(o.key)}>
                    <Text style={[styles.chipText, sort === o.key && styles.chipTextOn]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {pickedTitles.length > 0 ? (
                <View style={styles.card}>
                  <Text style={styles.title}>
                    {pickedTitles.length} {pickedTitles.length === 1 ? 'title' : 'titles'} picked
                  </Text>
                  <Text style={styles.meta}>
                    {pickedChapters} {pickedChapters === 1 ? 'chapter' : 'chapters'}
                    {pickedSize ? ` · about ${pickedSize}` : ''}
                  </Text>
                  <View style={[styles.buttons, { marginTop: 8 }]}>
                    <TouchableOpacity style={styles.btnOn} onPress={() => downloadFirst(pickedTitles)}>
                      <Text style={styles.btnOnText}>Download first</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.btnDark} onPress={() => keepNext(pickedTitles, pickedTitles.length === 1 ? pickedTitles[0].title : `${pickedTitles.length} titles`)}>
                      <Text style={styles.btnText}>Next few only</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.btnDark} onPress={() => takeOut(pickedTitles)}>
                      <Text style={[styles.btnText, { color: p.danger }]}>Take out</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.btnDark} onPress={clearPicks}>
                      <Text style={styles.btnText}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <Text style={styles.note}>Tap titles to pick them. Then download them first, keep only the next few chapters, or take them out of the queue.</Text>
              )}

              <View style={styles.list}>
                {titles.slice(0, SHOWN).map((t) => {
                  const on = picked.has(t.seriesId);
                  const n = t.chapterIds.length;
                  return (
                    <TouchableOpacity key={t.seriesId} style={styles.row} onPress={() => toggle(t.seriesId)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                      <Icon name={on ? 'checkCircle' : 'circle'} size={20} color={on ? p.accent : p.textMuted} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {t.title}
                        </Text>
                        <Text style={styles.meta} numberOfLines={1}>
                          {n} {n === 1 ? 'chapter' : 'chapters'}
                          {t.chapterCount > n ? ` of ${t.chapterCount}` : ''}
                          {t.bytes !== null ? ` · about ${fmtBytes(t.bytes)}` : ''}
                        </Text>
                      </View>
                      {cur?.seriesId === t.seriesId ? <Text style={styles.tagNow}>Now</Text> : t.reading ? <Text style={styles.tag}>Reading</Text> : null}
                    </TouchableOpacity>
                  );
                })}
                {titles.length > SHOWN && <Text style={[styles.meta, { padding: 12 }]}>And {titles.length - SHOWN} more titles.</Text>}
              </View>
            </>
          )}

          {queued.length > 0 && view === 'chapters' && (
            <View style={styles.list}>
              {queued.slice(0, 60).map((q) => {
                const l = label(q.seriesId, q.chapterId);
                return (
                  <View key={q.chapterId} style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {l.title}
                      </Text>
                      <Text style={styles.meta}>{l.chapter}</Text>
                    </View>
                    {cur?.chapterId !== q.chapterId && (
                      <TouchableOpacity hitSlop={10} onPress={() => actions.cancelDownloads([q.chapterId]).catch(showFailure)} accessibilityLabel={`Cancel ${l.title} ${l.chapter}`}>
                        <Icon name="close" size={13} color={p.textSecondary} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
              {queued.length > 60 && <Text style={[styles.meta, { padding: 12 }]}>And {queued.length - 60} more.</Text>}
            </View>
          )}

          {failed.length > 0 && (
            <>
              <Text style={styles.section}>Failed · {failed.length}</Text>
              <View style={styles.list}>
                {failed.slice(0, 30).map((q) => {
                  const l = label(q.seriesId, q.chapterId);
                  return (
                    <View key={q.chapterId} style={styles.row}>
                      <Icon name="info" size={15} color={p.danger} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {l.title} · {l.chapter}
                        </Text>
                        <Text style={styles.meta} numberOfLines={2}>
                          {q.error}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </>
      )}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    empty: { color: p.textSecondary, fontSize: 15, lineHeight: 21 },
    buttons: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    btn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    btnText: { color: p.text, fontSize: 14, fontWeight: '700' },
    btnOn: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    btnOnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    btnDark: { backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    note: { color: p.textMuted, fontSize: 12, lineHeight: 17 },
    card: { backgroundColor: p.card, borderRadius: 14, padding: 14, gap: 4 },
    section: { color: p.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 6 },
    title: { color: p.text, fontSize: 16, fontWeight: '800' },
    meta: { color: p.textSecondary, fontSize: 12, lineHeight: 16 },
    bar: { height: 5, borderRadius: 3, backgroundColor: p.elevated, overflow: 'hidden', marginTop: 6 },
    fill: { height: 5, borderRadius: 3, backgroundColor: p.accent },
    paused: { color: p.rating, fontSize: 13, fontWeight: '800' },
    tabs: { flexDirection: 'row', backgroundColor: p.card, borderRadius: 10, padding: 3, marginTop: 6 },
    tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
    tabOn: { backgroundColor: p.elevated },
    tabText: { color: p.textSecondary, fontSize: 13, fontWeight: '700' },
    tabTextOn: { color: p.text },
    chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: p.card },
    chipOn: { backgroundColor: p.accent },
    chipText: { color: p.textSecondary, fontSize: 13, fontWeight: '700' },
    chipTextOn: { color: '#fff' },
    list: { backgroundColor: p.card, borderRadius: 14, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: p.separator },
    rowTitle: { color: p.text, fontSize: 14, fontWeight: '700' },
    tag: { color: p.accent, fontSize: 12, fontWeight: '800' },
    tagNow: { color: p.success, fontSize: 12, fontWeight: '800' },
  });
