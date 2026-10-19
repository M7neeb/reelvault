/**
 * Audio stats: this week by day, today and all time, your streak, your year
 * in days, what you listened to most, when you listen, finished and in
 * progress, your average rating, how much space the Audio section takes
 * (it never grows as you listen), and your Audio Wrapped (a story of the
 * year). Presentational only (see the note at the top of types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { audioStats, authorsOf, displayTitle, fmtLength, fmtRating, type AudioPlay } from '../../audio/audioLogic';
import { fmtSize } from '../format';
import Icon from '../Icon';
import { Card } from '../insightParts';
import { Modal } from '../screen';
import { StoryDeck, useStoryText, type DeckCard } from '../storyDeck';
import { Confetti, CoverWall, GrowColumn, Rays } from '../storyKit';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import { YearHeatCard } from '../yearHeatUI';
import AudioCover from './AudioCover';
import type { AudioActions, AudioUiItem } from './audioTypes';

function AudioWrapped({ items, plays, year, onClose }: { items: AudioUiItem[]; plays: AudioPlay[]; year: number; onClose: () => void }) {
  const s = useStoryText();
  const styles = useStyles(makeStyles);
  const cards = useMemo<DeckCard[]>(() => {
    const start = new Date(year, 0, 1).getTime();
    const end = new Date(year + 1, 0, 1).getTime();
    const ps = plays.filter((x) => x.startedAt >= start && x.startedAt < end);
    const byId = new Map(items.map((i) => [i.id, i]));
    const per = new Map<string, number>();
    for (const x of ps) per.set(x.itemId, (per.get(x.itemId) ?? 0) + x.listenedMs);
    const top = [...per.entries()].filter(([id]) => byId.has(id)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, ms]) => ({ item: byId.get(id)!, ms }));
    const total = ps.reduce((a, x) => a + x.listenedMs, 0);
    const days = new Set(ps.map((x) => new Date(x.startedAt).toDateString())).size;
    const listened = top.map((t) => t.item);
    const author = authorsOf(listened.length ? [...per.keys()].map((id) => byId.get(id)).filter((x): x is AudioUiItem => !!x) : [])[0];
    const finished = items.filter((i) => i.finishedAt && i.finishedAt >= start && i.finishedAt < end);
    const covers = items.map((i) => i.coverSource ?? undefined).filter(Boolean) as string[];
    const out: DeckCard[] = [
      {
        key: 'intro',
        colors: ['#BF5AF2', '#1E0730'],
        ms: 5000,
        backdrop: covers.length ? <CoverWall sources={covers} opacity={0.5} /> : undefined,
        body: (
          <>
            {s.kicker('YOUR AUDIO WRAPPED', 0)}
            {s.big(String(year), 1)}
            {s.line(total ? `${fmtLength(total)} of listening, on ${days} ${days === 1 ? 'day' : 'days'}.` : 'Nothing listened to yet this year.', 2)}
          </>
        ),
      },
    ];
    if (!total) return out;
    if (top[0]) {
      out.push({
        key: 'top1',
        colors: ['#FFD60A', '#2E2400'],
        ms: 6000,
        cheer: true,
        backdrop: <Rays size={1000} color="#FFD60A" />,
        body: (
          <>
            {s.kicker('YOUR #1', 0)}
            <AudioCover item={top[0].item} size={200} radius={20} />
            {s.big(displayTitle(top[0].item), 2)}
            {s.line(`${fmtLength(top[0].ms)} of it${top[0].item.rating ? `, and you rated it ${fmtRating(top[0].item.rating)}` : ''}.`, 3)}
            <Confetti />
          </>
        ),
      });
    }
    if (top.length > 1) {
      out.push({
        key: 'top5',
        colors: ['#30D158', '#05210E'],
        ms: 7000,
        body: (
          <>
            {s.kicker('MOST LISTENED', 0)}
            <View style={{ gap: 8, marginTop: 6 }}>
              {top.map((t, n) => (
                <View key={t.item.id} style={styles.wRow}>
                  <Text style={styles.wRank}>{n + 1}</Text>
                  <AudioCover item={t.item} size={48} radius={10} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.wTitle} numberOfLines={1}>
                      {displayTitle(t.item)}
                    </Text>
                    <Text style={styles.wSub}>{fmtLength(t.ms)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ),
      });
    }
    if (author) {
      out.push({
        key: 'author',
        colors: ['#FF9F0A', '#2B1500'],
        ms: 5500,
        body: (
          <>
            {s.kicker('YOUR AUTHOR', 0)}
            {s.big(author.name, 1)}
            {s.line(`${author.count} ${author.count === 1 ? 'item' : 'items'} of theirs.`, 2)}
          </>
        ),
      });
    }
    if (finished.length) {
      out.push({
        key: 'finished',
        colors: ['#64D2FF', '#03202B'],
        ms: 5500,
        body: (
          <>
            {s.kicker('YOU FINISHED', 0)}
            {s.huge(String(finished.length), 1)}
            {s.line(finished.length === 1 ? `${displayTitle(finished[0])}.` : `including ${displayTitle(finished[0])} and ${displayTitle(finished[1])}.`, 2)}
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
          {s.kicker(`AUDIO ${year}`, 0)}
          {s.huge(fmtLength(total), 1)}
          {s.line(`${days} days of listening · ${per.size} ${per.size === 1 ? 'item' : 'items'} · ${finished.length} finished`, 2)}
        </>
      ),
    });
    return out;
  }, [items, plays, year]); // eslint-disable-line react-hooks/exhaustive-deps
  return <StoryDeck cards={cards} onClose={onClose} />;
}

export default function AudioDashboard({ items, actions, onOpen, onClose }: { items: AudioUiItem[]; actions: AudioActions; onOpen: (item: AudioUiItem) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [plays, setPlays] = useState<AudioPlay[] | null>(null);
  const [bytes, setBytes] = useState<number | null>(null);
  const [wrapped, setWrapped] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    actions
      .loadPlays()
      .then(setPlays)
      .catch(() => setPlays([]));
    actions
      .storageBytes()
      .then(setBytes)
      .catch(() => setBytes(null));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const st = useMemo(() => (plays ? audioStats(items, plays, now) : null), [items, plays, now]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const weekMax = st ? Math.max(1, ...st.week.map((d) => d.ms)) : 1;
  const hourMax = st ? Math.max(1, ...st.hours) : 1;
  const year = new Date(now).getFullYear();

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close">
            <Icon name="close" size={15} color={p.icon} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.title}>Listening</Text>
        </View>
        {!st || !plays ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={p.textSecondary} />
        ) : (
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
            <Card index={0} title="This week" sub={st.todayMs ? `${fmtLength(st.todayMs)} today` : 'Nothing yet today'}>
              <Text style={styles.big}>{st.weekMs ? fmtLength(st.weekMs) : '-'}</Text>
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
                <Text style={styles.tileNum} numberOfLines={1} adjustsFontSizeToFit>
                  {fmtLength(st.totalMs) || '-'}
                </Text>
                <Text style={styles.tileLabel}>All time</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileNum}>
                  {st.streak} {st.streak === 1 ? 'day' : 'days'}
                </Text>
                <Text style={styles.tileLabel}>Streak · best {st.bestStreak}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileNum}>{st.averageRating !== null ? `★ ${fmtRating(st.averageRating)}` : '-'}</Text>
                <Text style={styles.tileLabel}>Average rating</Text>
              </View>
            </View>

            <TouchableOpacity activeOpacity={0.85} style={styles.wrapCard} onPress={() => setWrapped(true)} accessibilityLabel={`Open your ${year} Audio Wrapped`}>
              <View style={styles.wrapGlow} />
              <Text style={styles.wrapKicker}>AUDIO WRAPPED</Text>
              <Text style={styles.wrapTitle}>Your {year} in listening</Text>
              <Text style={styles.wrapSub}>Your #1, your most listened, your author and what you finished.</Text>
            </TouchableOpacity>

            <YearHeatCard
              index={1}
              plays={plays.map((x) => ({ videoId: x.itemId, startedAt: x.startedAt, watchedMs: x.listenedMs }))}
              nameOf={(id) => (byId.get(id) ? displayTitle(byId.get(id)!) : null)}
              onOpen={(id) => {
                const it = byId.get(id);
                if (it) onOpen(it);
              }}
            />

            {st.top.length > 0 && (
              <Card index={2} title="Most listened">
                {st.top.map((t) => {
                  const it = byId.get(t.id);
                  if (!it) return null;
                  return (
                    <TouchableOpacity key={t.id} style={styles.row} onPress={() => onOpen(it)}>
                      <AudioCover item={it} size={44} radius={9} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {displayTitle(it)}
                        </Text>
                        <Text style={styles.sub}>{fmtLength(t.ms)}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </Card>
            )}

            {st.totalMs > 0 && (
              <Card index={3} title="When you listen">
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

            <Card index={4} title="Your library">
              <Text style={styles.sub}>
                {items.length} {items.length === 1 ? 'item' : 'items'} · {fmtLength(st.libraryMs) || 'length unknown'} · {st.finished} finished · {st.inProgress} in progress
              </Text>
            </Card>

            <Card index={5} title="Space on this iPhone">
              <Text style={styles.big}>{bytes === null ? '-' : fmtSize(bytes)}</Text>
              <Text style={styles.sub}>
                That is all the Audio section takes, and it doesn't grow as you listen or read: books are unpacked once when you add them, nothing is cached, and covers are kept small. Deleting an item frees its space after Recently Deleted.
              </Text>
            </Card>
          </ScrollView>
        )}
      </View>
      {wrapped && plays && <AudioWrapped items={items} plays={plays} year={year} onClose={() => setWrapped(false)} />}
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
    wrapCard: { borderRadius: 22, padding: 18, gap: 6, backgroundColor: '#25093A', overflow: 'hidden' },
    wrapGlow: { position: 'absolute', right: -60, top: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: '#BF5AF2', opacity: 0.45 },
    wrapKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
    wrapTitle: { color: '#fff', fontSize: 24, fontWeight: '900' },
    wrapSub: { color: 'rgba(255,255,255,0.85)', fontSize: 14 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    hours: { flexDirection: 'row', alignItems: 'flex-end', height: 64 },
    hourCell: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
    hourLabels: { flexDirection: 'row', justifyContent: 'space-between' },
    wRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 16, padding: 8 },
    wRank: { color: '#fff', fontSize: 24, fontWeight: '900', width: 24, textAlign: 'center' },
    wTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
    wSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '700' },
  });
