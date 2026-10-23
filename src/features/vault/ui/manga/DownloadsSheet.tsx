/**
 * The download queue: what is downloading now (with its pages), what waits,
 * and what failed with the reason. Pause, carry on, retry the failed ones,
 * cancel one or all. Downloads run while ReelVault is open (iOS stops apps
 * in the background) and carry on when you come back. Presentational only.
 */

import { Text, TouchableOpacity, View } from 'react-native';

import { chapterLabel } from '../../manga/mangaLogic';
import Icon from '../Icon';
import { SheetFrame } from '../sheets';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { DownloadState, MangaActions, MangaUiSeries } from './mangaTypes';

export default function DownloadsSheet({ downloads, items, actions, onClose }: { downloads: DownloadState; items: MangaUiSeries[]; actions: MangaActions; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const byId = new Map(items.map((s) => [s.id, s]));
  const label = (seriesId: string, chapterId: string) => {
    const s = byId.get(seriesId);
    const c = s?.chapters.find((x) => x.id === chapterId);
    return { title: s?.title ?? 'A title', chapter: c ? chapterLabel(c, true) : 'Chapter' };
  };
  const queued = downloads.queue.filter((q) => q.state === 'queued');
  const failed = downloads.queue.filter((q) => q.state === 'failed');
  const cur = downloads.current;
  const now = cur ? label(cur.seriesId, cur.chapterId) : null;

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
              <TouchableOpacity style={styles.btn} onPress={() => actions.retryDownloads().catch(() => undefined)}>
                <Icon name="repeat" size={14} color={p.text} />
                <Text style={styles.btnText}>Retry {failed.length}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.btn} onPress={() => actions.cancelDownloads(null).catch(() => undefined)}>
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
          {downloads.paused && <Text style={styles.paused}>Paused</Text>}

          {queued.length > 0 && (
            <>
              <Text style={styles.section}>Waiting · {queued.length}</Text>
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
                        <TouchableOpacity hitSlop={10} onPress={() => actions.cancelDownloads([q.chapterId]).catch(() => undefined)} accessibilityLabel={`Cancel ${l.title} ${l.chapter}`}>
                          <Icon name="close" size={13} color={p.textSecondary} />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
                {queued.length > 60 && <Text style={[styles.meta, { padding: 12 }]}>And {queued.length - 60} more.</Text>}
              </View>
            </>
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
    note: { color: p.textMuted, fontSize: 12, lineHeight: 17 },
    card: { backgroundColor: p.card, borderRadius: 14, padding: 14, gap: 4 },
    section: { color: p.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 6 },
    title: { color: p.text, fontSize: 16, fontWeight: '800' },
    meta: { color: p.textSecondary, fontSize: 12, lineHeight: 16 },
    bar: { height: 5, borderRadius: 3, backgroundColor: p.elevated, overflow: 'hidden', marginTop: 6 },
    fill: { height: 5, borderRadius: 3, backgroundColor: p.accent },
    paused: { color: p.rating, fontSize: 13, fontWeight: '800' },
    list: { backgroundColor: p.card, borderRadius: 14, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: p.separator },
    rowTitle: { color: p.text, fontSize: 14, fontWeight: '700' },
  });
