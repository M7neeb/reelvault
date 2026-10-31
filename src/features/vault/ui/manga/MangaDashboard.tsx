/**
 * Manga insights, with the same pages as the Videos section: Dashboard (this
 * week day by day, time read, chapters and pages, streaks, a year of reading
 * days, your most read titles, when you read, your genres, your library by
 * status), History (what you read, by day), Memories (on this day, a month
 * ago, anniversaries, one to come back to), Wrapped (any week, month or year,
 * and Videos + Manga), Badges (the reading ones) and Storage (space per
 * title). Presentational only.
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fmtLength } from '../../audio/audioLogic';
import { achievements, readingFrom, TIER_NAMES } from '../../achievements';
import { historyFeed } from '../../manga/mangaFeed';
import { mangaMemories, spaceByTitle, yearRangeOf, type ReadRange } from '../../manga/mangaInsights';
import { MANGA_STATUSES, chapterLabel, fmtRating, type MangaRead } from '../../manga/mangaLogic';
import { mangaStats } from '../../manga/mangaStats';
import { tick } from '../haptics';
import { fmtSize } from '../format';
import Icon from '../Icon';
import type { IconName } from '../icons';
import { Card, Medallion } from '../insightParts';
import { Modal } from '../screen';
import { GrowBar, GrowColumn } from '../storyKit';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import { YearHeatCard } from '../yearHeatUI';
import MangaCover from './MangaCover';
import { RangeWrapped, WrappedPicker, type MixVideos } from './MangaWrapped';
import type { MangaActions, MangaUiSeries } from './mangaTypes';

const STATUS_COLOR: Record<string, string> = { reading: '#0A84FF', planned: '#8E8E93', completed: '#30D158', onHold: '#FF9F0A', dropped: '#FF453A', none: '#3A3A3C' };

export type MangaInsightsTab = 'dashboard' | 'history' | 'memories' | 'wrapped' | 'badges' | 'storage';

const TABS: { key: MangaInsightsTab; label: string; icon: IconName }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { key: 'history', label: 'History', icon: 'history' },
  { key: 'memories', label: 'Memories', icon: 'memories' },
  { key: 'wrapped', label: 'Wrapped', icon: 'sparkle' },
  { key: 'badges', label: 'Badges', icon: 'medal' },
  { key: 'storage', label: 'Storage', icon: 'storage' },
];

export default function MangaDashboard({
  items,
  actions,
  videos,
  initialTab = 'dashboard',
  onOpen,
  onClose,
}: {
  items: MangaUiSeries[];
  actions: MangaActions;
  /** Your videos, for the Videos + Manga Wrapped. */
  videos?: MixVideos | null;
  initialTab?: MangaInsightsTab;
  onOpen: (s: MangaUiSeries) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [reads, setReads] = useState<MangaRead[] | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [tab, setTab] = useState<MangaInsightsTab>(initialTab);
  const [story, setStory] = useState<{ range: ReadRange; mix: boolean } | null>(null);
  const [now] = useState(() => Date.now());
  // Private titles never appear in a Wrapped (their pages would show behind the cards).
  const wrappedItems = useMemo(() => items.filter((s) => !s.isPrivate), [items]);
  useEffect(() => {
    actions
      .loadReads()
      .then(setReads)
      .catch(() => setReads([]));
    actions
      .storageBytes()
      .then(setBytes)
      .catch(() => setBytes(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const st = useMemo(() => (reads ? mangaStats(items, reads, now) : null), [items, reads, now]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const weekMax = st ? Math.max(1, ...st.week.map((d) => d.ms)) : 1;
  const hourMax = st ? Math.max(1, ...st.hours) : 1;
  const year = new Date(now).getFullYear();
  const statusTotal = st ? Object.values(st.statuses).reduce((a, n) => a + n, 0) : 0;
  const history = useMemo(() => (tab === 'history' ? historyFeed(items, now) : []), [items, tab, now]);
  const dayTime = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of reads ?? []) {
      const d = new Date(r.startedAt);
      const k = String(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
      m.set(k, (m.get(k) ?? 0) + r.readMs);
    }
    return m;
  }, [reads]);
  const memories = useMemo(() => (reads && tab === 'memories' ? mangaMemories(items.filter((i) => !i.isPrivate), reads, now) : []), [items, reads, tab, now]);
  const badges = useMemo(() => {
    if (!reads || tab !== 'badges') return [];
    const reading = readingFrom(items, reads);
    return achievements({ videos: [], plays: [], bookmarks: 0, albums: 0, smartFilters: 0, series: 0, seriesFinished: 0, kept: 0, reading, now }).filter((a) => a.group === 'Reading');
  }, [items, reads, tab, now]);
  const space = useMemo(() => (tab === 'storage' ? spaceByTitle(items) : []), [items, tab]);
  const spaceMax = Math.max(1, ...space.map((x) => x.bytes));

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close">
            <Icon name="close" size={15} color={p.icon} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.title}>{TABS.find((t) => t.key === tab)?.label === 'Dashboard' ? 'Reading' : TABS.find((t) => t.key === tab)?.label}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={styles.tabs}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, tab === t.key && styles.tabOn]}
              onPress={() => {
                tick();
                setTab(t.key);
              }}>
              <Icon name={t.icon} size={14} color={tab === t.key ? '#fff' : p.textSoft} />
              <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {!st || !reads ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={p.textSecondary} />
        ) : tab !== 'dashboard' ? (
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
            {tab === 'history' &&
              (history.length ? (
                history.map((d) => (
                  <View key={d.key}>
                    <View style={styles.dayHead}>
                      <Text style={styles.day}>{d.label}</Text>
                      {!!dayTime.get(d.key) && <Text style={styles.sub}>{fmtLength(dayTime.get(d.key)!)}</Text>}
                    </View>
                    <View style={styles.list}>
                      {d.rows.map((r) => {
                        const ser = byId.get(r.seriesId);
                        return (
                          <TouchableOpacity key={`${r.seriesId}:${r.chapter.id}`} style={styles.listRow} onPress={() => ser && onOpen(ser)}>
                            {ser ? <MangaCover series={ser} width={34} radius={5} /> : null}
                            <View style={{ flex: 1, gap: 2 }}>
                              <Text style={styles.rowTitle} numberOfLines={1}>
                                {r.title}
                              </Text>
                              <Text style={styles.sub} numberOfLines={1}>
                                {chapterLabel(r.chapter, true)} · {new Date(r.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                              </Text>
                            </View>
                            <Icon name="forward" size={13} color={p.textMuted} />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))
              ) : (
                <Text style={styles.empty}>The chapters you read show here, newest first.</Text>
              ))}

            {tab === 'memories' &&
              (memories.length ? (
                memories.map((m, n) => {
                  const first = byId.get(m.seriesIds[0]);
                  return (
                    <Card key={m.key} index={n}>
                      <TouchableOpacity style={styles.memory} onPress={() => first && onOpen(first)}>
                        <View style={styles.memCovers}>
                          {m.seriesIds.slice(0, 3).map((id, k) => {
                            const ser = byId.get(id);
                            return ser ? (
                              <View key={id} style={[styles.memCover, { marginLeft: k ? -26 : 0, zIndex: 3 - k, transform: m.seriesIds.length > 1 ? [{ rotate: `${(k - 1) * 5}deg` }] : undefined }]}>
                                <MangaCover series={ser} width={64} radius={8} />
                              </View>
                            ) : null;
                          })}
                        </View>
                        <View style={{ flex: 1, gap: 3 }}>
                          <Text style={styles.memKicker}>{m.kicker.toUpperCase()}</Text>
                          <Text style={styles.memTitle} numberOfLines={2}>
                            {m.title}
                          </Text>
                          <Text style={styles.sub}>{m.sub}</Text>
                          <Text style={styles.sub}>{new Date(m.at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                        </View>
                      </TouchableOpacity>
                    </Card>
                  );
                })
              ) : (
                <Text style={styles.empty}>Memories show here as your reading builds up: what you read on this day in past years, a month ago, the day you started or finished a title, and favourites to come back to.</Text>
              ))}

            {tab === 'wrapped' && <WrappedPicker items={items} reads={reads} videos={videos} now={now} onOpen={(range, mix) => setStory({ range, mix })} />}

            {tab === 'badges' &&
              (badges.length ? (
                <>
                  <Card index={0} title="Reading badges" sub={`${badges.filter((b) => b.unlocked).length} of ${badges.length} earned`}>
                    <View style={styles.badgeGrid}>
                      {badges.map((b) => (
                        <View key={b.id} style={styles.badge}>
                          <Medallion icon={b.icon} tier={b.tier} unlocked={b.unlocked} size={62} progress={b.target ? b.current / b.target : 0} />
                          <Text style={styles.badgeTitle} numberOfLines={2}>
                            {b.secret && !b.unlocked ? '???' : b.title}
                          </Text>
                          <Text style={styles.badgeSub} numberOfLines={2}>
                            {b.unlocked ? `${TIER_NAMES[b.tier] ?? ''}${b.earnedAt ? ` · ${new Date(b.earnedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}` : `${Math.min(b.current, b.target).toLocaleString()} / ${b.target.toLocaleString()}${b.unit ? ` ${b.unit}` : ''}`}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </Card>
                  <Text style={styles.empty}>All your badges, videos and Simkl too, are in the Videos section's Insights.</Text>
                </>
              ) : (
                <Text style={styles.empty}>Read a chapter to start earning reading badges.</Text>
              ))}

            {tab === 'storage' && (
              <>
                <Card index={0} title="Space on this iPhone">
                  <Text style={styles.big}>{bytes === null ? '-' : fmtSize(bytes)}</Text>
                  <Text style={styles.sub}>Downloaded chapters and your own files. Removing a download keeps the chapter (readable online); Smaller pages in Browse settings saves about half.</Text>
                </Card>
                {space.length > 0 && (
                  <Card index={1} title="By title" sub={`${space.length} ${space.length === 1 ? 'title' : 'titles'} on the phone`}>
                    {space.map((x) => {
                      const ser = byId.get(x.id);
                      if (!ser) return null;
                      return (
                        <TouchableOpacity key={x.id} style={styles.spaceRow} onPress={() => onOpen(ser)}>
                          <MangaCover series={ser} width={34} radius={5} />
                          <View style={{ flex: 1, gap: 4 }}>
                            <View style={styles.spaceHead}>
                              <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={1}>
                                {ser.title}
                              </Text>
                              <Text style={styles.rowTitle}>{x.bytes ? fmtSize(x.bytes) : '-'}</Text>
                            </View>
                            <GrowBar share={x.bytes / spaceMax} color={p.accent} track={p.elevated} height={6} />
                            <Text style={styles.sub}>
                              {x.downloaded} of {x.chapters} chapters on the phone{x.read ? ` · ${x.read} already read` : ''}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </Card>
                )}
              </>
            )}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
            <Card index={0} title="This week" sub={st.todayMs ? `${fmtLength(st.todayMs)} today` : 'Nothing yet today'}>
              <Text style={styles.big}>{st.weekMs ? fmtLength(st.weekMs) : '-'}</Text>
              <Text style={styles.sub}>
                {st.chaptersWeek} {st.chaptersWeek === 1 ? 'chapter' : 'chapters'} finished this week
              </Text>
              <View style={styles.week}>
                {st.week.map((d, n) => (
                  <View key={d.label} style={styles.weekCell}>
                    <View style={styles.weekBox}>
                      <GrowColumn ratio={d.ms / weekMax} height={80} width={18} delay={n * 50} color={d.today ? p.accent : p.textMuted} />
                    </View>
                    <Text style={[styles.weekLabel, d.today && { color: p.accent }]}>{d.label}</Text>
                  </View>
                ))}
              </View>
            </Card>

            <View style={styles.tiles}>
              <View style={styles.tile}>
                <Text style={styles.tileNum}>{st.chapters.toLocaleString()}</Text>
                <Text style={styles.tileLabel}>Chapters read</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileNum}>
                  {st.streak} {st.streak === 1 ? 'day' : 'days'}
                </Text>
                <Text style={styles.tileLabel}>Streak · best {st.bestStreak}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileNum} numberOfLines={1} adjustsFontSizeToFit>
                  {fmtLength(st.totalMs) || '-'}
                </Text>
                <Text style={styles.tileLabel}>{st.pages ? `${st.pages.toLocaleString()} pages` : 'All time'}</Text>
              </View>
            </View>

            <TouchableOpacity activeOpacity={0.85} style={styles.wrapCard} onPress={() => setStory({ range: yearRangeOf(year, now), mix: false })} accessibilityLabel={`Open your ${year} Reading Wrapped`}>
              <View style={styles.wrapGlow} />
              <Text style={styles.wrapKicker}>READING WRAPPED</Text>
              <Text style={styles.wrapTitle}>Your {year} in manga</Text>
              <Text style={styles.wrapSub}>Your #1, your most read, your busiest month and genre. Weeks, months, all time and Videos + Manga are in Wrapped.</Text>
            </TouchableOpacity>

            <YearHeatCard
              index={1}
              plays={reads.map((r) => ({ videoId: r.seriesId, startedAt: r.startedAt, watchedMs: r.readMs }))}
              nameOf={(id) => byId.get(id)?.title ?? null}
              onOpen={(id) => {
                const s = byId.get(id);
                if (s) onOpen(s);
              }}
            />

            {st.top.length > 0 && (
              <Card index={2} title="Most read">
                {st.top.map((t) => {
                  const s = byId.get(t.id);
                  if (!s) return null;
                  return (
                    <TouchableOpacity key={t.id} style={styles.row} onPress={() => onOpen(s)}>
                      <MangaCover series={s} width={36} radius={6} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {s.title}
                        </Text>
                        <Text style={styles.sub}>{[t.chapters ? `${t.chapters} chapters read` : null, t.ms ? fmtLength(t.ms) : null].filter(Boolean).join(' · ')}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </Card>
            )}

            {st.totalMs > 0 && (
              <Card index={3} title="When you read">
                <View style={styles.hours}>
                  {st.hours.map((h, n) => (
                    <View key={n} style={styles.hourCell}>
                      <GrowColumn ratio={h / hourMax} height={60} width="80%" delay={n * 15} color={p.accent} radius={3} />
                    </View>
                  ))}
                </View>
                <View style={styles.hourLabels}>
                  {['0', '6', '12', '18', '24'].map((l) => (
                    <Text key={l} style={styles.sub}>
                      {l}
                    </Text>
                  ))}
                </View>
              </Card>
            )}

            {statusTotal > 0 && (
              <Card index={4} title="Your library" sub={`${statusTotal} ${statusTotal === 1 ? 'title' : 'titles'} · ${st.unread.toLocaleString()} unread chapters${st.averageRating !== null ? ` · average ★ ${fmtRating(st.averageRating)}` : ''}`}>
                <View style={styles.stack}>
                  {(['reading', 'planned', 'completed', 'onHold', 'dropped', 'none'] as const).map((k) =>
                    st.statuses[k] ? <View key={k} style={{ flex: st.statuses[k], backgroundColor: STATUS_COLOR[k] }} /> : null
                  )}
                </View>
                <View style={styles.legend}>
                  {(['reading', 'planned', 'completed', 'onHold', 'dropped', 'none'] as const).map((k) =>
                    st.statuses[k] ? (
                      <View key={k} style={styles.legendItem}>
                        <View style={[styles.dot, { backgroundColor: STATUS_COLOR[k] }]} />
                        <Text style={styles.sub}>
                          {k === 'none' ? 'No status' : MANGA_STATUSES.find((x) => x.key === k)?.label} {st.statuses[k]}
                        </Text>
                      </View>
                    ) : null
                  )}
                </View>
              </Card>
            )}

            {st.genres.length > 0 && (
              <Card index={5} title="Your genres">
                <View style={styles.chips}>
                  {st.genres.map((g) => (
                    <View key={g.name} style={styles.chip}>
                      <Text style={styles.chipText}>
                        {g.name} · {g.count}
                      </Text>
                    </View>
                  ))}
                </View>
              </Card>
            )}

            <Card index={6} title="Space on this iPhone">
              <Text style={styles.big}>{bytes === null ? '-' : fmtSize(bytes)}</Text>
              <Text style={styles.sub}>Downloaded chapters and your own files. Removing a download keeps the chapter (readable online); Smaller pages in Browse settings saves about half.</Text>
            </Card>
          </ScrollView>
        )}
      </View>
      {story && reads && <RangeWrapped items={wrappedItems} reads={reads} range={story.range} videos={story.mix ? videos : null} loadPages={actions.loadPages} onClose={() => setStory(null)} />}
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    circle: { width: 34, height: 34, borderRadius: 17, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    title: { color: p.text, fontSize: 26, fontWeight: '800', flex: 1 },
    body: { paddingHorizontal: 16, gap: 14, paddingTop: 6 },
    big: { color: p.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.8 },
    sub: { color: p.textSecondary, fontSize: 13, lineHeight: 18 },
    week: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
    weekCell: { flex: 1, alignItems: 'center', gap: 6 },
    weekBox: { height: 80, justifyContent: 'flex-end' },
    weekLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    tiles: { flexDirection: 'row', gap: 10 },
    tile: { flex: 1, backgroundColor: p.card, borderRadius: 16, padding: 12, gap: 2 },
    tileNum: { color: p.text, fontSize: 17, fontWeight: '800' },
    tileLabel: { color: p.textSecondary, fontSize: 12 },
    wrapCard: { borderRadius: 22, padding: 18, gap: 6, backgroundColor: '#3A0716', overflow: 'hidden' },
    wrapGlow: { position: 'absolute', right: -60, top: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: '#FF375F', opacity: 0.45 },
    wrapKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
    wrapTitle: { color: '#fff', fontSize: 24, fontWeight: '900' },
    wrapSub: { color: 'rgba(255,255,255,0.85)', fontSize: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    hours: { flexDirection: 'row', alignItems: 'flex-end', height: 64 },
    hourCell: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
    hourLabels: { flexDirection: 'row', justifyContent: 'space-between' },
    stack: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 },
    legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: { width: 9, height: 9, borderRadius: 5 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    chipText: { color: p.text, fontSize: 13, fontWeight: '700' },
    tabs: { gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
    tab: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
    tabOn: { backgroundColor: p.accent },
    tabText: { color: p.textSoft, fontSize: 14, fontWeight: '700' },
    tabTextOn: { color: '#fff' },
    empty: { color: p.textSecondary, fontSize: 14, lineHeight: 20, paddingVertical: 24, paddingHorizontal: 10, textAlign: 'center' },
    dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4, marginBottom: 6 },
    day: { color: p.textSecondary, fontSize: 13, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
    list: { backgroundColor: p.card, borderRadius: 14, overflow: 'hidden' },
    listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: p.separator },
    memory: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    memCovers: { flexDirection: 'row', alignItems: 'center', minWidth: 64 },
    memCover: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
    memKicker: { color: p.accent, fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    memTitle: { color: p.text, fontSize: 18, fontWeight: '800' },
    badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 },
    badge: { width: '33.33%', alignItems: 'center', gap: 5, paddingHorizontal: 4 },
    badgeTitle: { color: p.text, fontSize: 12, fontWeight: '800', textAlign: 'center' },
    badgeSub: { color: p.textSecondary, fontSize: 11, textAlign: 'center' },
    spaceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    spaceHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  });
