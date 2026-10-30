/**
 * The download queue: what is downloading now (with its pages), what waits,
 * and what failed with the reason. Pause, carry on, retry the failed ones,
 * cancel one or all. Downloads run while ReelVault is open (iOS stops apps
 * in the background) and carry on when you come back.
 *
 * "Titles" groups the queue by title, with each title's whole size (all its
 * chapters left). A size limit downloads the small titles and puts the
 * bigger ones on hold, where you choose later which to download. The list
 * keeps its order while you pick (finished titles stay in place, marked
 * done). Presentational only.
 */

import { Paths } from 'expo-file-system';
import { useMemo, useRef, useState } from 'react';
import { Alert, Text, TouchableOpacity, View, type AlertButton } from 'react-native';

import { beyondNext, chapterLabel, downloadSizeLeft, queueByTitle, queueWithFirst, type QueueTitle } from '../../manga/mangaLogic';
import { fmtBytes } from '../../stats';
import Icon from '../Icon';
import { SheetFrame } from '../sheets';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { DownloadState, MangaActions, MangaUiSeries } from './mangaTypes';
import { showFailure } from '../oops';

type TitleSort = 'smallest' | 'biggest' | 'reading' | 'queue';
const SORTS: { key: TitleSort; label: string }[] = [
  { key: 'smallest', label: 'Smallest' },
  { key: 'biggest', label: 'Biggest' },
  { key: 'reading', label: 'Reading now' },
  { key: 'queue', label: 'Download order' },
];
const MB = 1e6;
const LIMITS = [50 * MB, 100 * MB, 200 * MB, 500 * MB, 1000 * MB];
const SHOWN = 250;

type Row = QueueTitle & { done?: boolean };

/** A title's size for sorting: the estimate, else its chapter count (so unknown sizes still sort sensibly). */
const weight = (t: QueueTitle) => t.bytes ?? t.chapterIds.length * MB;

function sortTitles(list: QueueTitle[], sort: TitleSort): QueueTitle[] {
  if (sort === 'queue') return list;
  return [...list].sort((a, b) => {
    if (sort === 'reading' && a.reading !== b.reading) return a.reading ? -1 : 1;
    return (sort === 'biggest' ? weight(b) - weight(a) : weight(a) - weight(b)) || a.title.localeCompare(b.title);
  });
}

function bytesOf(list: QueueTitle[]): string | null {
  const known = list.filter((t) => t.bytes !== null);
  return known.length ? fmtBytes(known.reduce((n, t) => n + (t.bytes ?? 0), 0)) : null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The list in the order it had when you opened it (or changed the sort):
 * new titles join at the end, finished ones stay in their place marked done,
 * so nothing moves under your finger while downloads go on.
 */
function useSteadyList(list: QueueTitle[], key: string): Row[] {
  const ref = useRef<{ key: string; ids: string[]; last: Map<string, QueueTitle> }>({ key: '', ids: [], last: new Map() });
  return useMemo(() => {
    const r = ref.current;
    const current = new Map(list.map((t) => [t.seriesId, t]));
    if (r.key !== key) {
      r.key = key;
      r.ids = list.map((t) => t.seriesId);
      r.last = new Map();
    } else {
      const known = new Set(r.ids);
      for (const t of list) if (!known.has(t.seriesId)) r.ids.push(t.seriesId);
    }
    for (const t of list) r.last.set(t.seriesId, t);
    const out: Row[] = [];
    for (const id of r.ids) {
      const t = current.get(id);
      if (t) out.push(t);
      else {
        const was = r.last.get(id);
        if (was) out.push({ ...was, chapterIds: [], bytes: 0, done: true });
      }
    }
    return out;
  }, [list, key]);
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
  const held = useMemo(() => downloads.queue.filter((q) => q.state === 'held'), [downloads.queue]);
  const failed = downloads.queue.filter((q) => q.state === 'failed');
  const cur = downloads.current;
  const now = cur ? label(cur.seriesId, cur.chapterId) : null;
  const sizeLeft = useMemo(() => downloadSizeLeft(items, queued), [items, queued]);
  const heldSize = useMemo(() => downloadSizeLeft(items, held), [items, held]);
  let free: number | null = null;
  try {
    free = Paths.availableDiskSpace;
  } catch {
    // unknown
  }

  const [view, setView] = useState<'titles' | 'chapters'>('titles');
  const [list, setList] = useState<'queued' | 'held'>('queued');
  const [sort, setSort] = useState<TitleSort>('smallest');
  const [limit, setLimit] = useState(200 * MB);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Bumped after each change you make, so the list sorts itself again then (and only then). */
  const [round, setRound] = useState(0);

  const queuedTitles = useMemo(() => queueByTitle(items, queued), [items, queued]);
  const heldTitles = useMemo(() => queueByTitle(items, held), [items, held]);
  const source = list === 'held' ? heldTitles : queuedTitles;
  const sorted = useMemo(() => sortTitles(source, sort), [source, sort]);
  const rows = useSteadyList(sorted, `${list}|${sort}|${round}`);
  const pickedTitles = source.filter((t) => picked.has(t.seriesId));
  const known = source.some((t) => t.bytes !== null);
  const under = source.filter((t) => t.bytes !== null && t.bytes <= limit);
  const over = source.filter((t) => t.bytes !== null && t.bytes > limit);

  const settled = () => {
    setPicked(new Set());
    setRound((n) => n + 1);
  };
  const toggle = (id: string) =>
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const switchList = (l: 'queued' | 'held') => {
    setList(l);
    setPicked(new Set());
  };

  const chaptersOf = (ts: QueueTitle[]) => ts.flatMap((t) => t.chapterIds);
  const smallestFirst = (ts: QueueTitle[]) => [...ts].sort((a, b) => weight(a) - weight(b)).map((t) => t.seriesId);

  /** Downloads only the titles under the limit (smallest first); the bigger ones go on hold. */
  const applyLimit = () => {
    if (!over.length) {
      actions.orderDownloads(queueWithFirst(queued, smallestFirst(under))).then(settled).catch(showFailure);
      return;
    }
    Alert.alert(
      `Only titles under ${fmtBytes(limit)}?`,
      `${plural(under.length, 'title')} (about ${bytesOf(under) ?? '?'}) download, smallest first. ${plural(over.length, 'bigger title')} (about ${bytesOf(over) ?? '?'}) go on hold: they stay under "On hold", where you choose which to download later.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Do it',
          onPress: async () => {
            try {
              await actions.holdDownloads(chaptersOf(over), true);
              await actions.orderDownloads(queueWithFirst(queued, smallestFirst(under)));
              settled();
            } catch (e) {
              showFailure(e);
            }
          },
        },
      ]
    );
  };
  /** Lets the held titles under the limit download. */
  const releaseUnder = () => {
    if (!under.length) return;
    actions.holdDownloads(chaptersOf(under), false).then(settled).catch(showFailure);
  };
  const downloadFirst = (ts: QueueTitle[]) => {
    actions.orderDownloads(queueWithFirst(queued, ts.map((t) => t.seriesId))).then(settled).catch(showFailure);
  };
  const hold = (ts: QueueTitle[], on: boolean) => {
    actions.holdDownloads(chaptersOf(ts), on).then(settled).catch(showFailure);
  };
  /** Keeps only the next few chapters (from where you are) of these titles; asks how many first. */
  const keepNext = (ts: QueueTitle[]) => {
    if (!ts.length) return;
    const pool = list === 'held' ? held : queued;
    const run = (keep: number) => {
      const drop = beyondNext(
        items,
        pool,
        ts.map((t) => t.seriesId),
        keep
      );
      if (!drop.length) {
        Alert.alert('Nothing to take out', `No more than ${keep} chapters wait already.`);
        return;
      }
      actions.cancelDownloads(drop).then(settled).catch(showFailure);
    };
    const buttons: AlertButton[] = [3, 5, 10].map((n) => ({ text: `Next ${n}`, onPress: () => run(n) }));
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Only the next chapters', 'Keep only the chapters you will read next (from where you are, or from the start) and take the rest out of the list. You can download more later from the title.', buttons);
  };
  const takeOut = (ts: QueueTitle[]) => {
    const ids = chaptersOf(ts);
    Alert.alert(ts.length === 1 ? 'Take this title out?' : `Take ${ts.length} titles out?`, `${plural(ids.length, 'chapter')} will not be downloaded.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Take out', style: 'destructive', onPress: () => actions.cancelDownloads(ids).then(settled).catch(showFailure) },
    ]);
  };

  const pickedChapters = pickedTitles.reduce((n, t) => n + t.chapterIds.length, 0);
  const pickedSize = bytesOf(pickedTitles);
  const anyWaiting = queued.length > 0 || held.length > 0;

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

          {/* Always the same height, so the list below does not jump between chapters. */}
          {(cur || queued.length > 0) && (
            <View style={styles.card}>
              <Text style={styles.section}>Downloading</Text>
              <Text style={styles.title} numberOfLines={1}>
                {now ? now.title : downloads.paused ? 'Paused' : 'Starting the next chapter…'}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {cur && now ? `${now.chapter} · page ${cur.done} of ${cur.total}` : ' '}
              </Text>
              <View style={styles.bar}>
                <View style={[styles.fill, { width: cur ? `${Math.round((cur.done / Math.max(1, cur.total)) * 100)}%` : '0%' }]} />
              </View>
            </View>
          )}
          {anyWaiting && (
            <View style={styles.card}>
              <Text style={styles.section}>Left to download</Text>
              <Text style={styles.title}>{sizeLeft !== null ? `About ${fmtBytes(sizeLeft)}` : queued.length ? 'Size not known yet' : 'Nothing, the rest is on hold'}</Text>
              <Text style={styles.meta}>
                {plural(queued.length, 'chapter')}
                {sizeLeft !== null ? ' · estimated from the chapters already on your iPhone' : queued.length ? ' · shown once the first chapter is done' : ''}
              </Text>
              {held.length > 0 && (
                <Text style={styles.meta}>
                  On hold: {plural(held.length, 'chapter')}
                  {heldSize !== null ? ` · about ${fmtBytes(heldSize)}` : ''}
                </Text>
              )}
              {free !== null && free > 0 && free !== Infinity && (
                <Text style={[styles.meta, sizeLeft !== null && sizeLeft > free ? { color: p.danger, fontWeight: '700' } : null]}>
                  {fmtBytes(free)} free on your iPhone{sizeLeft !== null && sizeLeft > free ? ' · not enough for all of it' : ''}
                </Text>
              )}
            </View>
          )}
          {!downloads.paused && downloads.waitingWifi && <Text style={styles.paused}>Waiting for Wi-Fi (Browse › Download on Wi-Fi only)</Text>}

          {anyWaiting && (
            <View style={styles.tabs}>
              {(['titles', 'chapters'] as const).map((v) => (
                <TouchableOpacity key={v} style={[styles.tab, view === v && styles.tabOn]} onPress={() => setView(v)}>
                  <Text style={[styles.tabText, view === v && styles.tabTextOn]}>{v === 'titles' ? 'Titles' : 'Chapters'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {anyWaiting && view === 'titles' && (
            <>
              <View style={styles.buttons}>
                <TouchableOpacity style={[styles.chip, list === 'queued' && styles.chipOn]} onPress={() => switchList('queued')}>
                  <Text style={[styles.chipText, list === 'queued' && styles.chipTextOn]}>Downloading · {queuedTitles.length}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.chip, list === 'held' && styles.chipOn]} onPress={() => switchList('held')}>
                  <Text style={[styles.chipText, list === 'held' && styles.chipTextOn]}>On hold · {heldTitles.length}</Text>
                </TouchableOpacity>
              </View>

              {/* Download by the size of the whole title (all its chapters left), not of one chapter. */}
              {source.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.section}>{list === 'held' ? 'Let the smaller ones download' : 'Download by title size'}</Text>
                  {known ? (
                    <>
                      <View style={[styles.buttons, { marginTop: 4 }]}>
                        {LIMITS.map((l) => (
                          <TouchableOpacity key={l} style={[styles.chipDark, limit === l && styles.chipOn]} onPress={() => setLimit(l)}>
                            <Text style={[styles.chipText, limit === l && styles.chipTextOn]}>{fmtBytes(l)}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <Text style={[styles.meta, { marginTop: 6 }]}>
                        Under {fmtBytes(limit)}: {plural(under.length, 'title')}
                        {under.length ? ` · about ${bytesOf(under)}` : ''}
                      </Text>
                      <Text style={styles.meta}>
                        Over {fmtBytes(limit)}: {plural(over.length, 'title')}
                        {over.length ? ` · about ${bytesOf(over)}` : ''}
                      </Text>
                      {list === 'queued' ? (
                        <TouchableOpacity style={[styles.btnOn, styles.wide, !under.length && styles.off]} disabled={!under.length} onPress={applyLimit}>
                          <Text style={styles.btnOnText}>Only download titles under {fmtBytes(limit)}</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity style={[styles.btnOn, styles.wide, !under.length && styles.off]} disabled={!under.length} onPress={releaseUnder}>
                          <Text style={styles.btnOnText}>Download the ones under {fmtBytes(limit)}</Text>
                        </TouchableOpacity>
                      )}
                      <Text style={styles.note}>
                        {list === 'queued'
                          ? 'Sizes are for the whole title (all its chapters left), estimated from what is on your iPhone. The bigger titles go on hold, and you pick which of them to download later.'
                          : 'Or tap titles below and choose Download these.'}
                      </Text>
                    </>
                  ) : (
                    <Text style={styles.meta}>Sizes show once the first chapter has downloaded.</Text>
                  )}
                </View>
              )}

              <View style={styles.buttons}>
                {SORTS.map((o) => (
                  <TouchableOpacity key={o.key} style={[styles.chip, sort === o.key && styles.chipOn]} onPress={() => setSort(o.key)}>
                    <Text style={[styles.chipText, sort === o.key && styles.chipTextOn]}>{o.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {pickedTitles.length > 0 && (
                <View style={styles.card}>
                  <Text style={styles.title}>{plural(pickedTitles.length, 'title')} picked</Text>
                  <Text style={styles.meta}>
                    {plural(pickedChapters, 'chapter')}
                    {pickedSize ? ` · about ${pickedSize}` : ''}
                  </Text>
                  <View style={[styles.buttons, { marginTop: 8 }]}>
                    {list === 'queued' ? (
                      <>
                        <TouchableOpacity style={styles.btnOn} onPress={() => downloadFirst(pickedTitles)}>
                          <Text style={styles.btnOnText}>Download first</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.btnDark} onPress={() => hold(pickedTitles, true)}>
                          <Text style={styles.btnText}>Put on hold</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity style={styles.btnOn} onPress={() => hold(pickedTitles, false)}>
                        <Text style={styles.btnOnText}>Download these</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.btnDark} onPress={() => keepNext(pickedTitles)}>
                      <Text style={styles.btnText}>Next few only</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.btnDark} onPress={() => takeOut(pickedTitles)}>
                      <Text style={[styles.btnText, { color: p.danger }]}>Take out</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.btnDark} onPress={() => setPicked(new Set())}>
                      <Text style={styles.btnText}>Clear</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {rows.length === 0 ? (
                <Text style={styles.note}>{list === 'held' ? 'Nothing on hold.' : 'Nothing waiting to download. Titles on hold are under On hold.'}</Text>
              ) : (
                <View style={styles.list}>
                  {rows.slice(0, SHOWN).map((t) => {
                    const on = picked.has(t.seriesId);
                    const n = t.chapterIds.length;
                    if (t.done)
                      return (
                        <View key={t.seriesId} style={[styles.row, styles.doneRow]}>
                          <Icon name="checkCircle" size={20} color={p.success} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle} numberOfLines={1}>
                              {t.title}
                            </Text>
                            <Text style={styles.meta} numberOfLines={1}>
                              {list === 'held' ? 'Downloading now' : 'Done'}
                            </Text>
                          </View>
                        </View>
                      );
                    return (
                      <TouchableOpacity key={t.seriesId} style={styles.row} onPress={() => toggle(t.seriesId)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                        <Icon name={on ? 'checkCircle' : 'circle'} size={20} color={on ? p.accent : p.textMuted} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {t.title}
                          </Text>
                          <Text style={styles.meta} numberOfLines={1}>
                            {t.bytes !== null ? `about ${fmtBytes(t.bytes)} · ` : ''}
                            {plural(n, 'chapter')}
                            {t.chapterCount > n ? ` of ${t.chapterCount}` : ''}
                          </Text>
                        </View>
                        {cur?.seriesId === t.seriesId ? <Text style={styles.tagNow}>Now</Text> : t.reading ? <Text style={styles.tag}>Reading</Text> : null}
                      </TouchableOpacity>
                    );
                  })}
                  {rows.length > SHOWN && <Text style={[styles.meta, { padding: 12 }]}>And {rows.length - SHOWN} more titles.</Text>}
                </View>
              )}
            </>
          )}

          {anyWaiting && view === 'chapters' && (
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
              {held.length > 0 && <Text style={[styles.meta, { padding: 12 }]}>{plural(held.length, 'chapter')} on hold (Titles › On hold).</Text>}
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
    btnOn: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, alignItems: 'center' },
    btnOnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    btnDark: { backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    wide: { marginTop: 10, paddingVertical: 11 },
    off: { opacity: 0.4 },
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
    chipDark: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: p.elevated },
    chipOn: { backgroundColor: p.accent },
    chipText: { color: p.textSecondary, fontSize: 13, fontWeight: '700' },
    chipTextOn: { color: '#fff' },
    list: { backgroundColor: p.card, borderRadius: 14, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: p.separator },
    doneRow: { opacity: 0.5 },
    rowTitle: { color: p.text, fontSize: 14, fontWeight: '700' },
    tag: { color: p.accent, fontSize: 12, fontWeight: '800' },
    tagNow: { color: p.success, fontSize: 12, fontWeight: '800' },
  });
