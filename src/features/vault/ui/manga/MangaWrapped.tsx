/**
 * The Wrapped tab of the Manga section: the picker (this week, the weeks
 * before, the months and years), and the Videos + Manga card for the Videos
 * section. The story itself (prologue, four chapters, epilogue, with the
 * pages of what you read behind the cards) is in ReadingStory.tsx.
 * Presentational only.
 */

import { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { fmtLength } from '../../audio/audioLogic';
import { type MangaRead } from '../../manga/mangaLogic';
import { mixNumbers, monthRangesOf, readingIn, readingYears, recentWeekRanges, yearRangeOf, type ReadRange } from '../../manga/mangaInsights';
import { success } from '../haptics';
import Icon from '../Icon';
import { Card } from '../insightParts';
import { GrowBar, GrowColumn } from '../storyKit';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import { RangeWrapped, type MixVideos } from './ReadingStory';
import type { MangaActions, MangaUiSeries } from './mangaTypes';

export { RangeWrapped, type MixVideos };

const orDash = (ms: number) => (ms ? fmtLength(ms) : '0 min');

/**
 * For the Videos section's Wrapped tab: a Videos + Manga Wrapped of this
 * week, this month or this year (reads load when you tap).
 */
export function MixWrappedCard({ manga, videos }: { manga: { items: MangaUiSeries[]; loadReads: () => Promise<MangaRead[]>; loadPages?: MangaActions['loadPages'] }; videos: MixVideos }) {
  const styles = useStyles(makeStyles);
  const [reads, setReads] = useState<MangaRead[] | null>(null);
  const [range, setRange] = useState<ReadRange | null>(null);
  const now = Date.now();
  // Private titles never appear in a Wrapped; one list, so the story is not rebuilt on every render.
  const shown = useMemo(() => manga.items.filter((s) => !s.isPrivate), [manga.items]);
  const choices: ReadRange[] = [recentWeekRanges(now, 1)[0], monthRangesOf(now)[0], yearRangeOf(new Date(now).getFullYear(), now)];
  const open = (r: ReadRange) => {
    success();
    if (reads) return setRange(r);
    manga
      .loadReads()
      .catch(() => [] as MangaRead[])
      .then((rs) => {
        setReads(rs);
        setRange(r);
      });
  };
  return (
    <View style={[styles.hero, { backgroundColor: '#22073A' }]}>
      <View style={[styles.heroGlow, { backgroundColor: '#BF5AF2' }]} />
      <Text style={styles.heroKicker}>VIDEOS + MANGA WRAPPED</Text>
      <Text style={styles.heroTitle}>Watching and reading, side by side</Text>
      <Text style={styles.heroSub}>Who won, your #1 of each, the days you did both.</Text>
      <View style={styles.mixChoices}>
        {choices.map((r) => (
          <TouchableOpacity key={r.kind} style={styles.heroBtn} onPress={() => open(r)}>
            <Icon name="play" size={11} color="#000" />
            <Text style={styles.heroBtnText}>{r.kind === 'week' ? 'This week' : r.kind === 'month' ? r.label : r.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {range && reads && <RangeWrapped items={shown} reads={reads} range={range} videos={videos} loadPages={manga.loadPages} onClose={() => setRange(null)} />}
    </View>
  );
}

/** The Wrapped tab: this week, the weeks and months before, and each year; Manga or Videos + Manga. */
export function WrappedPicker({ items, reads, videos, now, onOpen }: { items: MangaUiSeries[]; reads: MangaRead[]; videos?: MixVideos | null; now: number; onOpen: (r: ReadRange, mix: boolean) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [mix, setMix] = useState(false);
  const useMix = mix && !!videos;
  const weeks = useMemo(() => recentWeekRanges(now, 6), [now]);
  const months = useMemo(() => monthRangesOf(now), [now]);
  const years = useMemo(() => readingYears(items, reads, now).map((y) => yearRangeOf(y, now)), [items, reads, now]);
  const numbers = (r: ReadRange) => {
    const y = readingIn(items, reads, r.start, r.end);
    if (!useMix) return { y, line: y.chapters || y.ms ? `${y.chapters} ch. · ${orDash(y.ms)}` : 'Nothing read', ms: y.ms };
    const m = mixNumbers(videos!.plays, y, reads);
    return { y, line: m.totalMs || y.chapters ? `${orDash(m.watchMs)} watching · ${orDash(m.readMs)} reading` : 'Nothing yet', ms: m.totalMs };
  };
  const [thisWeek, ...pastWeeks] = weeks;
  const tw = numbers(thisWeek);
  const year = years[0];
  const yn = numbers(year);
  const maxMonth = Math.max(1, ...months.map((m) => numbers(m).ms));
  const open = (r: ReadRange) => {
    success();
    onOpen(r, useMix);
  };

  return (
    <View style={{ gap: 14 }}>
      {videos && (
        <View style={styles.modeRow}>
          {(
            [
              [false, 'Manga'],
              [true, 'Videos + Manga'],
            ] as const
          ).map(([k, label]) => (
            <TouchableOpacity key={label} style={[styles.modeBtn, mix === k && styles.modeBtnOn]} onPress={() => setMix(k)}>
              <Text style={[styles.modeText, mix === k && styles.modeTextOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <TouchableOpacity activeOpacity={0.85} style={[styles.hero, useMix && { backgroundColor: '#22073A' }]} onPress={() => open(year)} accessibilityLabel={`Open your ${year.label} Wrapped`}>
        <View style={[styles.heroGlow, useMix && { backgroundColor: '#BF5AF2' }]} />
        <Text style={styles.heroKicker}>{useMix ? 'VIDEOS + MANGA WRAPPED' : 'READING WRAPPED'}</Text>
        <Text style={styles.heroTitle}>Your {year.label}</Text>
        <Text style={styles.heroSub}>{yn.line}</Text>
        <View style={styles.heroBtn}>
          <Icon name="play" size={12} color="#000" />
          <Text style={styles.heroBtnText}>Play</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity activeOpacity={0.85} style={styles.weekCard} onPress={() => open(thisWeek)}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.cardKicker}>THIS WEEK</Text>
          <Text style={styles.cardTitle}>{tw.line}</Text>
          <Text style={styles.sub}>{tw.y.top[0] ? `#1 ${items.find((i) => i.id === tw.y.top[0].id)?.title ?? ''}` : 'Your week so far'}</Text>
        </View>
        <View style={styles.spark}>
          {tw.y.perDay.slice(0, 7).map((ms, n) => (
            <View key={n} style={styles.sparkCell}>
              <GrowColumn ratio={ms / Math.max(1, ...tw.y.perDay)} height={36} width={6} delay={n * 40} color={p.accent} radius={3} />
            </View>
          ))}
        </View>
      </TouchableOpacity>

      <Card index={1} title="Weeks before">
        {pastWeeks.map((w) => {
          const n = numbers(w);
          return (
            <TouchableOpacity key={w.start} style={styles.row} onPress={() => open(w)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{w.label}</Text>
                <Text style={styles.sub}>{n.line}</Text>
              </View>
              <Icon name="forward" size={13} color={p.textMuted} />
            </TouchableOpacity>
          );
        })}
      </Card>

      <Card index={2} title={`Months of ${new Date(now).getFullYear()}`}>
        {months.map((m) => {
          const n = numbers(m);
          return (
            <TouchableOpacity key={m.start} style={styles.row} onPress={() => open(m)}>
              <Text style={[styles.rowTitle, { width: 96 }]}>{m.label}</Text>
              <View style={{ flex: 1 }}>
                <GrowBar share={n.ms / maxMonth} color={useMix ? '#BF5AF2' : p.accent} track={p.elevated} height={8} />
              </View>
              <Text style={styles.sub}>{n.ms ? fmtLength(n.ms) : '-'}</Text>
            </TouchableOpacity>
          );
        })}
      </Card>

      {years.length > 1 && (
        <Card index={3} title="Years">
          {years.slice(1).map((y) => (
            <TouchableOpacity key={y.label} style={styles.row} onPress={() => open(y)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{y.label}</Text>
                <Text style={styles.sub}>{numbers(y).line}</Text>
              </View>
              <Icon name="forward" size={13} color={p.textMuted} />
            </TouchableOpacity>
          ))}
        </Card>
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    wRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 16, padding: 8 },
    wRank: { color: '#fff', fontSize: 24, fontWeight: '900', width: 24, textAlign: 'center' },
    wTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
    wSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '700' },
    thumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.3)' },
    thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
    daysRow: { flexDirection: 'row', alignItems: 'flex-end', height: 150, marginTop: 10 },
    dayCell: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
    count: { color: '#fff', fontSize: 84, fontWeight: '900', letterSpacing: -3 },
    quizGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginTop: 8 },
    quizCell: { borderRadius: 14, borderWidth: 3, borderColor: 'transparent' },
    quizRight: { borderColor: '#30D158' },
    quizWrong: { borderColor: '#FF453A' },
    quizBadge: { position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: '#30D158', alignItems: 'center', justifyContent: 'center' },
    quizResult: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' },
    hoursRow: { flexDirection: 'row', alignItems: 'flex-end', height: 120, marginTop: 14 },
    hoursAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
    axis: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700' },
    snapType: { color: '#FF375F', fontSize: 16, fontWeight: '900' },
    snap: { borderRadius: 26, padding: 22, gap: 10, backgroundColor: '#141416', alignItems: 'flex-start', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
    snapKicker: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '900', letterSpacing: 1.3 },
    snapHuge: { color: '#fff', fontSize: 56, fontWeight: '900', letterSpacing: -2 },
    snapLine: { color: 'rgba(255,255,255,0.92)', fontSize: 15, fontWeight: '700' },
    snapBrand: { color: 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '800', marginTop: 4 },
    share: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
    shareText: { color: '#000', fontSize: 15, fontWeight: '800' },

    modeRow: { flexDirection: 'row', backgroundColor: p.card, borderRadius: 12, padding: 3 },
    modeBtn: { flex: 1, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
    modeBtnOn: { backgroundColor: p.elevated },
    modeText: { color: p.textSecondary, fontWeight: '700', fontSize: 14 },
    modeTextOn: { color: p.text },
    hero: { borderRadius: 22, padding: 18, gap: 6, backgroundColor: '#3A0716', overflow: 'hidden' },
    heroGlow: { position: 'absolute', right: -60, top: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: '#FF375F', opacity: 0.45 },
    heroKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
    heroTitle: { color: '#fff', fontSize: 28, fontWeight: '900' },
    heroSub: { color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: '600' },
    heroBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginTop: 6 },
    heroBtnText: { color: '#000', fontSize: 14, fontWeight: '800' },
    mixChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    weekCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.card, borderRadius: 18, padding: 16 },
    cardKicker: { color: p.accent, fontSize: 12, fontWeight: '900', letterSpacing: 1 },
    cardTitle: { color: p.text, fontSize: 17, fontWeight: '800' },
    spark: { flexDirection: 'row', alignItems: 'flex-end', height: 40, width: 84 },
    sparkCell: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    rowTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    sub: { color: p.textSecondary, fontSize: 13, lineHeight: 18 },
  });
