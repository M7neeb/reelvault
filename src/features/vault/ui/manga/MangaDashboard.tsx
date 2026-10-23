/**
 * The Manga dashboard: this week day by day, time read, chapters and pages,
 * streaks, a year of reading days, your most read titles, when you read,
 * your genres, your library by status, what's unread and the space on the
 * phone, plus Reading Wrapped: your year as a story. Presentational only.
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fmtLength } from '../../audio/audioLogic';
import { MANGA_STATUSES, fmtRating, type MangaRead } from '../../manga/mangaLogic';
import { mangaStats, readingYear } from '../../manga/mangaStats';
import { fmtSize } from '../format';
import Icon from '../Icon';
import { Card } from '../insightParts';
import { Modal } from '../screen';
import { StoryDeck, useStoryText, type DeckCard } from '../storyDeck';
import { Confetti, CoverWall, GrowColumn, Rays } from '../storyKit';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import { YearHeatCard } from '../yearHeatUI';
import MangaCover from './MangaCover';
import type { MangaActions, MangaUiSeries } from './mangaTypes';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS_COLOR: Record<string, string> = { reading: '#0A84FF', planned: '#8E8E93', completed: '#30D158', onHold: '#FF9F0A', dropped: '#FF453A', none: '#3A3A3C' };

function ReadingWrapped({ items, reads, year, onClose }: { items: MangaUiSeries[]; reads: MangaRead[]; year: number; onClose: () => void }) {
  const s = useStoryText();
  const styles = useStyles(makeStyles);
  const cards = useMemo<DeckCard[]>(() => {
    const y = readingYear(items, reads, year);
    const byId = new Map(items.map((i) => [i.id, i]));
    const covers = items.map((i) => (typeof i.coverSource === 'string' ? i.coverSource : undefined)).filter(Boolean) as string[];
    const top = y.top.map((t) => ({ ...t, s: byId.get(t.id) })).filter((t) => t.s);
    const out: DeckCard[] = [
      {
        key: 'intro',
        colors: ['#FF375F', '#2B0612'],
        ms: 5000,
        backdrop: covers.length ? <CoverWall sources={covers} opacity={0.5} /> : undefined,
        body: (
          <>
            {s.kicker('YOUR READING WRAPPED', 0)}
            {s.big(String(year), 1)}
            {s.line(y.chapters || y.ms ? `${y.chapters} ${y.chapters === 1 ? 'chapter' : 'chapters'}${y.ms ? `, ${fmtLength(y.ms)} of reading` : ''}, on ${y.days} ${y.days === 1 ? 'day' : 'days'}.` : 'Nothing read yet this year.', 2)}
          </>
        ),
      },
    ];
    if (!y.chapters && !y.ms) return out;
    if (top[0]?.s) {
      out.push({
        key: 'top1',
        colors: ['#FFD60A', '#2E2400'],
        ms: 6000,
        cheer: true,
        backdrop: <Rays size={1000} color="#FFD60A" />,
        body: (
          <>
            {s.kicker('YOUR #1', 0)}
            <MangaCover series={top[0].s} width={150} radius={14} />
            {s.big(top[0].s.title, 2)}
            {s.line(`${top[0].chapters ? `${top[0].chapters} ${top[0].chapters === 1 ? 'chapter' : 'chapters'}` : ''}${top[0].ms ? `${top[0].chapters ? ', ' : ''}${fmtLength(top[0].ms)}` : ''}${top[0].s.rating ? `, rated ${fmtRating(top[0].s.rating)}` : ''}.`, 3)}
            <Confetti />
          </>
        ),
      });
    }
    if (top.length > 1) {
      out.push({
        key: 'top5',
        colors: ['#5E5CE6', '#0D0B2E'],
        ms: 7000,
        body: (
          <>
            {s.kicker('MOST READ', 0)}
            <View style={{ gap: 8, marginTop: 6 }}>
              {top.map((t, n) => (
                <View key={t.id} style={styles.wRow}>
                  <Text style={styles.wRank}>{n + 1}</Text>
                  <MangaCover series={t.s!} width={36} radius={6} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.wTitle} numberOfLines={1}>
                      {t.s!.title}
                    </Text>
                    <Text style={styles.wSub}>{[t.chapters ? `${t.chapters} ch.` : null, t.ms ? fmtLength(t.ms) : null].filter(Boolean).join(' · ')}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ),
      });
    }
    if (y.busiestMonth) {
      out.push({
        key: 'month',
        colors: ['#30D158', '#05210E'],
        ms: 5000,
        body: (
          <>
            {s.kicker('YOUR BUSIEST MONTH', 0)}
            {s.big(MONTHS[y.busiestMonth.month], 1)}
            {s.line(`${fmtLength(y.busiestMonth.ms)} of reading.`, 2)}
          </>
        ),
      });
    }
    if (y.genre) {
      out.push({
        key: 'genre',
        colors: ['#FF9F0A', '#2B1500'],
        ms: 5000,
        body: (
          <>
            {s.kicker('YOUR GENRE', 0)}
            {s.big(y.genre, 1)}
            {s.line('More of what you read had it than anything else.', 2)}
          </>
        ),
      });
    }
    if (y.started.length || y.completed.length) {
      const first = byId.get(y.completed[0] ?? y.started[0]);
      out.push({
        key: 'new',
        colors: ['#64D2FF', '#03202B'],
        ms: 5500,
        body: (
          <>
            {s.kicker(y.completed.length ? 'YOU COMPLETED' : 'YOU STARTED', 0)}
            {s.huge(String(y.completed.length || y.started.length), 1)}
            {s.line(`${y.completed.length ? (y.completed.length === 1 ? 'title' : 'titles') : y.started.length === 1 ? 'new title' : 'new titles'}${first ? `, like ${first.title}` : ''}${y.completed.length && y.started.length ? `, and started ${y.started.length}` : ''}.`, 2)}
          </>
        ),
      });
    }
    out.push({
      key: 'end',
      colors: ['#1C1C1E', '#000000'],
      ms: 8000,
      body: (
        <>
          {s.kicker(`READING ${year}`, 0)}
          {s.huge(String(y.chapters), 1)}
          {s.line(`chapters · ${y.pages ? `${y.pages.toLocaleString()} pages · ` : ''}${y.titles} ${y.titles === 1 ? 'title' : 'titles'} · ${y.days} days`, 2)}
        </>
      ),
    });
    return out;
  }, [items, reads, year]); // eslint-disable-line react-hooks/exhaustive-deps
  return <StoryDeck cards={cards} onClose={onClose} />;
}

export default function MangaDashboard({ items, actions, onOpen, onClose }: { items: MangaUiSeries[]; actions: MangaActions; onOpen: (s: MangaUiSeries) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [reads, setReads] = useState<MangaRead[] | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [wrapped, setWrapped] = useState(false);
  const [now] = useState(() => Date.now());
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

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close">
            <Icon name="close" size={15} color={p.icon} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.title}>Reading</Text>
        </View>
        {!st || !reads ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={p.textSecondary} />
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

            <TouchableOpacity activeOpacity={0.85} style={styles.wrapCard} onPress={() => setWrapped(true)} accessibilityLabel={`Open your ${year} Reading Wrapped`}>
              <View style={styles.wrapGlow} />
              <Text style={styles.wrapKicker}>READING WRAPPED</Text>
              <Text style={styles.wrapTitle}>Your {year} in manga</Text>
              <Text style={styles.wrapSub}>Your #1, your most read, your busiest month and genre.</Text>
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
      {wrapped && reads && <ReadingWrapped items={items} reads={reads} year={year} onClose={() => setWrapped(false)} />}
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
    wRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 16, padding: 8 },
    wRank: { color: '#fff', fontSize: 24, fontWeight: '900', width: 24, textAlign: 'center' },
    wTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
    wSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '700' },
  });
