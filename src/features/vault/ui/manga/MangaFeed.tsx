/**
 * Updates (new chapters from your sources, newest first) and History (what
 * you read, by day). Tap a chapter to read it. Presentational only.
 */

import { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import { historyFeed, updatesFeed, type FeedDay } from '../../manga/mangaFeed';
import { chapterLabel, type MangaChapter } from '../../manga/mangaLogic';
import { tick } from '../haptics';
import Icon from '../Icon';
import { SheetFrame } from '../sheets';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { MangaUiSeries } from './mangaTypes';

export type FeedTab = 'updates' | 'history';

export default function MangaFeed({
  items,
  initialTab = 'updates',
  onRead,
  onClose,
}: {
  items: MangaUiSeries[];
  initialTab?: FeedTab;
  onRead: (seriesId: string, chapter: MangaChapter) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [tab, setTab] = useState<FeedTab>(initialTab);
  const now = Date.now();
  const days: FeedDay[] = useMemo(() => (tab === 'updates' ? updatesFeed(items, now) : historyFeed(items, now)), [items, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const covers = useMemo(() => new Map(items.map((s) => [s.id, s.coverSource])), [items]);

  return (
    <SheetFrame title={tab === 'updates' ? 'Updates' : 'History'} onClose={onClose}>
      <View style={styles.tabs}>
        {(['updates', 'history'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabOn]}
            onPress={() => {
              tick();
              setTab(t);
            }}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === 'updates' ? 'Updates' : 'History'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!days.length ? (
        <Text style={styles.empty}>
          {tab === 'updates'
            ? 'New chapters of titles from your sources show here when they come out. ReelVault checks when the app opens (at most every 6 hours), or tap Check for new chapters in the Manga menu.'
            : 'The chapters you read show here, newest first.'}
        </Text>
      ) : (
        days.map((d) => (
          <View key={d.key}>
            <Text style={styles.day}>{d.label}</Text>
            <View style={styles.list}>
              {d.rows.map((r) => {
                const cover = covers.get(r.seriesId);
                const unread = !r.chapter.readAt;
                return (
                  <TouchableOpacity
                    key={`${r.seriesId}:${r.chapter.id}`}
                    style={styles.row}
                    accessibilityLabel={`${r.title}, ${chapterLabel(r.chapter, true)}`}
                    onPress={() => {
                      tick();
                      onRead(r.seriesId, r.chapter);
                    }}>
                    <View style={styles.cover}>{cover ? <Image source={cover} style={styles.coverImg} contentFit="cover" /> : <Icon name="bookOpen" size={16} color={p.textMuted} />}</View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.title} numberOfLines={1}>
                        {r.title}
                      </Text>
                      <Text style={[styles.meta, tab === 'updates' && unread && { color: p.text }]} numberOfLines={1}>
                        {chapterLabel(r.chapter, true)}
                        {r.chapter.scanlator ? ` · ${r.chapter.scanlator}` : ''}
                      </Text>
                    </View>
                    {tab === 'updates' && unread && <View style={[styles.dot, { backgroundColor: p.accent }]} />}
                    {r.chapter.folder && <Icon name="checkCircle" size={14} color={p.textMuted} />}
                    <Icon name={tab === 'history' ? 'bookOpen' : 'forward'} size={13} color={p.textMuted} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))
      )}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    tabs: { flexDirection: 'row', gap: 6, backgroundColor: p.card, borderRadius: 12, padding: 3, marginBottom: 6 },
    tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
    tabOn: { backgroundColor: p.elevated },
    tabText: { color: p.textSecondary, fontSize: 14, fontWeight: '700' },
    tabTextOn: { color: p.text },
    empty: { color: p.textSecondary, fontSize: 14, lineHeight: 20, paddingVertical: 24, textAlign: 'center' },
    day: { color: p.textSecondary, fontSize: 13, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 16, marginBottom: 6 },
    list: { backgroundColor: p.card, borderRadius: 14, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: p.separator },
    cover: { width: 38, height: 54, borderRadius: 6, overflow: 'hidden', backgroundColor: p.elevated, alignItems: 'center', justifyContent: 'center' },
    coverImg: { width: 38, height: 54 },
    title: { color: p.text, fontSize: 15, fontWeight: '600' },
    meta: { color: p.textSecondary, fontSize: 13 },
    dot: { width: 8, height: 8, borderRadius: 4 },
  });
