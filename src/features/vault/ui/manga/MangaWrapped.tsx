/**
 * Manga Wrapped, like the Videos one: a story for this week, any week, any
 * month or any year of reading, and a Videos + Manga Wrapped that puts your
 * watching and your reading side by side (who won, your #1 of each, the days
 * you did both, mornings and nights). The last card can be shared as a
 * picture. The picker lists the weeks, months and years. Presentational only.
 */

import { useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import { fmtLength } from '../../audio/audioLogic';
import { fmtRating, type MangaRead } from '../../manga/mangaLogic';
import { mixNumbers, monthRangesOf, readingIn, readingYears, recentWeekRanges, yearRangeOf, type MixPlay, type ReadRange } from '../../manga/mangaInsights';
import { canSnap, shareSnap } from '../../snap';
import { success } from '../haptics';
import Icon from '../Icon';
import { Card } from '../insightParts';
import { StoryDeck, useStoryText, type DeckCard } from '../storyDeck';
import { Confetti, CoverWall, GrowBar, GrowColumn, Rays } from '../storyKit';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { ThumbSource } from '../types';
import MangaCover from './MangaCover';
import type { MangaUiSeries } from './mangaTypes';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Your videos, for a Videos + Manga Wrapped. */
export type MixVideos = { plays: MixPlay[]; nameOf: (id: string) => string | null; thumbOf: (id: string) => ThumbSource | null };

const longDay = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const orDash = (ms: number) => (ms ? fmtLength(ms) : '0 min');
/** Short enough for the big number: "73 h" once it is 10 hours or more. */
const bigTime = (ms: number) => (ms >= 36_000_000 ? `${Math.round(ms / 3_600_000)} h` : orDash(ms));

export function RangeWrapped({
  items,
  reads,
  range,
  videos,
  onClose,
}: {
  items: MangaUiSeries[];
  reads: MangaRead[];
  range: ReadRange;
  /** Given: a Videos + Manga Wrapped. */
  videos?: MixVideos | null;
  onClose: () => void;
}) {
  const s = useStoryText();
  const styles = useStyles(makeStyles);
  const snapRef = useRef<View>(null);
  const cards = useMemo<DeckCard[]>(() => {
    const y = readingIn(items, reads, range.start, range.end);
    const mix = videos ? mixNumbers(videos.plays, y, reads) : null;
    const byId = new Map(items.map((i) => [i.id, i]));
    const covers = items.map((i) => i.coverSource ?? undefined);
    const top = y.top.map((t) => ({ ...t, s: byId.get(t.id) })).filter((t) => t.s);
    const when = range.kind === 'year' ? `in ${range.label}` : range.kind === 'month' ? `in ${range.label}` : range.label === 'This week' ? 'this week' : range.label === 'Last week' ? 'last week' : `from ${range.label}`;
    const title = mix ? 'VIDEOS + MANGA WRAPPED' : 'YOUR READING WRAPPED';
    const nothing = !y.chapters && !y.ms && !(mix && mix.watchMs);
    const out: DeckCard[] = [
      {
        key: 'intro',
        colors: mix ? ['#BF5AF2', '#16052B'] : ['#FF375F', '#2B0612'],
        ms: 5000,
        backdrop: covers.some(Boolean) ? <CoverWall sources={covers} opacity={0.45} /> : undefined,
        body: (
          <>
            {s.kicker(title, 0)}
            {s.big(range.label, 1)}
            {s.line(
              nothing
                ? `Nothing ${mix ? 'watched or read' : 'read'} ${when} yet.`
                : mix
                  ? `${orDash(mix.totalMs)} of videos and manga ${when}, on ${mix.days} ${mix.days === 1 ? 'day' : 'days'}.`
                  : `${y.chapters} ${y.chapters === 1 ? 'chapter' : 'chapters'}${y.ms ? `, ${fmtLength(y.ms)} of reading` : ''}, on ${y.days} ${y.days === 1 ? 'day' : 'days'}.`,
              2
            )}
          </>
        ),
      },
    ];
    if (nothing) return out;

    if (mix && mix.totalMs > 0) {
      const readPct = Math.round(mix.readShare * 100);
      out.push({
        key: 'split',
        colors: ['#0A84FF', '#03142B'],
        ms: 6500,
        body: (
          <>
            {s.kicker('WATCHING VS READING', 0)}
            {s.huge(readPct >= 50 ? `${readPct}%` : `${100 - readPct}%`, 1)}
            {s.line(readPct >= 50 ? 'of your time went to manga. Reading won.' : 'of your time went to videos. Watching won.', 2)}
            {s.bars(
              [
                { label: 'Watching', share: 1 - mix.readShare, sub: orDash(mix.watchMs) },
                { label: 'Reading', share: mix.readShare, sub: orDash(mix.readMs) },
              ],
              3
            )}
            {mix.bothDays > 0 && s.line(`${mix.bothDays} ${mix.bothDays === 1 ? 'day' : 'days'} you did both.`, 5)}
          </>
        ),
      });
    }

    if (top[0]?.s) {
      out.push({
        key: 'top1',
        colors: ['#FFD60A', '#2E2400'],
        ms: 6000,
        cheer: true,
        backdrop: <Rays size={1000} color="#FFD60A" />,
        body: (
          <>
            {s.kicker(mix ? 'YOUR #1 MANGA' : 'YOUR #1', 0)}
            <MangaCover series={top[0].s} width={150} radius={14} />
            {s.big(top[0].s.title, 2)}
            {s.line(
              `${[top[0].chapters ? `${top[0].chapters} ${top[0].chapters === 1 ? 'chapter' : 'chapters'}` : null, top[0].ms ? fmtLength(top[0].ms) : null, top[0].s.rating ? `rated ${fmtRating(top[0].s.rating)}` : null]
                .filter(Boolean)
                .join(', ')}.`,
              3
            )}
            <Confetti />
          </>
        ),
      });
    }

    if (mix?.topVideo && videos) {
      const thumb = videos.thumbOf(mix.topVideo.id);
      out.push({
        key: 'topVideo',
        colors: ['#FF9F0A', '#2B1500'],
        ms: 6000,
        body: (
          <>
            {s.kicker('YOUR #1 VIDEO', 0)}
            {thumb ? <Image source={thumb} style={styles.thumb} contentFit="cover" /> : <View style={[styles.thumb, styles.thumbEmpty]}><Icon name="film" size={40} color="#fff" /></View>}
            {s.big(videos.nameOf(mix.topVideo.id) ?? 'A video', 2)}
            {s.line(`${fmtLength(mix.topVideo.ms)}, ${mix.topVideo.plays} ${mix.topVideo.plays === 1 ? 'play' : 'plays'}.${mix.videos > 1 ? ` One of ${mix.videos} videos you watched.` : ''}`, 3)}
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

    if (range.kind === 'year' && y.busiestMonth) {
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
    } else if (mix?.busiestDay && mix.busiestDay.watchMs + mix.busiestDay.readMs > 0) {
      const b = mix.busiestDay;
      out.push({
        key: 'day',
        colors: ['#30D158', '#05210E'],
        ms: 5500,
        body: (
          <>
            {s.kicker('YOUR BIGGEST DAY', 0)}
            {s.big(longDay(b.day), 1)}
            {s.line([b.watchMs ? `${fmtLength(b.watchMs)} watching` : null, b.readMs ? `${fmtLength(b.readMs)} reading` : null].filter(Boolean).join(' and ') + '.', 2)}
          </>
        ),
      });
    } else if (y.busiestDay && (y.busiestDay.ms || y.busiestDay.chapters > 1)) {
      const b = y.busiestDay;
      out.push({
        key: 'day',
        colors: ['#30D158', '#05210E'],
        ms: 5000,
        body: (
          <>
            {s.kicker('YOUR BIGGEST DAY', 0)}
            {s.big(longDay(b.day), 1)}
            {s.line([b.ms ? fmtLength(b.ms) : null, b.chapters ? `${b.chapters} ${b.chapters === 1 ? 'chapter' : 'chapters'}` : null].filter(Boolean).join(', ') + '.', 2)}
          </>
        ),
      });
    }

    if (range.kind !== 'year' && y.perDay.length > 1 && y.perDay.length <= 31 && y.ms) {
      const max = Math.max(1, ...y.perDay);
      out.push({
        key: 'days',
        colors: ['#64D2FF', '#03202B'],
        ms: 5000,
        body: (
          <>
            {s.kicker('DAY BY DAY', 0)}
            {s.big(`${y.days} ${y.days === 1 ? 'day' : 'days'} of reading`, 1)}
            <View style={styles.daysRow}>
              {y.perDay.map((ms, n) => (
                <View key={n} style={styles.dayCell}>
                  <GrowColumn ratio={ms / max} height={140} width="70%" delay={200 + n * 40} color="#fff" radius={4} />
                </View>
              ))}
            </View>
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

    if (mix && (mix.morning || mix.night) && mix.watchMs && mix.readMs) {
      out.push({
        key: 'habits',
        colors: ['#FF375F', '#2B0612'],
        ms: 5500,
        body: (
          <>
            {s.kicker('YOUR HABITS', 0)}
            {s.big(mix.night === 'read' ? 'A night reader' : mix.night === 'watch' ? 'A night watcher' : mix.morning === 'read' ? 'A morning reader' : 'A morning watcher', 1)}
            {mix.morning && s.line(`Mornings were for ${mix.morning === 'read' ? 'manga' : 'videos'}.`, 2)}
            {mix.night && s.line(`Late nights were for ${mix.night === 'read' ? 'manga' : 'videos'}.`, 3)}
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

    const summary = mix
      ? `${title.replace(' WRAPPED', ' Wrapped').replace('VIDEOS + MANGA', 'Videos + Manga')} · ${range.label}: ${orDash(mix.watchMs)} watching, ${orDash(mix.readMs)} reading, ${y.chapters} chapters.${top[0]?.s ? ` #1 manga: ${top[0].s.title}.` : ''}`
      : `Reading Wrapped · ${range.label}: ${y.chapters} chapters, ${orDash(y.ms)}, ${y.titles} titles.${top[0]?.s ? ` #1: ${top[0].s.title}.` : ''}`;
    out.push({
      key: 'end',
      colors: ['#1C1C1E', '#000000'],
      ms: 9000,
      interactive: true,
      body: (
        <>
          <View ref={snapRef} collapsable={false} style={styles.snap}>
            <Text style={styles.snapKicker}>{mix ? 'VIDEOS + MANGA' : 'READING'} · {range.label.toUpperCase()}</Text>
            {top[0]?.s && <MangaCover series={top[0].s} width={88} radius={10} />}
            <Text style={styles.snapHuge} numberOfLines={1} adjustsFontSizeToFit>{mix ? bigTime(mix.totalMs) : String(y.chapters)}</Text>
            <Text style={styles.snapLine}>
              {mix
                ? `${orDash(mix.watchMs)} watching · ${orDash(mix.readMs)} reading · ${y.chapters} chapters`
                : `chapters · ${y.pages ? `${y.pages.toLocaleString()} pages · ` : ''}${y.titles} ${y.titles === 1 ? 'title' : 'titles'} · ${y.days} days`}
            </Text>
            {mix && <GrowBar share={mix.readShare} track="rgba(255,255,255,0.25)" color="#FF375F" />}
            {top[0]?.s && <Text style={styles.snapLine}>#1 {top[0].s.title}</Text>}
            <Text style={styles.snapBrand}>ReelVault</Text>
          </View>
          <TouchableOpacity
            style={styles.share}
            onPress={() => {
              success();
              void shareSnap(snapRef.current, summary).catch(() => undefined);
            }}>
            <Icon name="share" size={16} color="#000" />
            <Text style={styles.shareText}>{canSnap ? 'Share as a picture' : 'Share'}</Text>
          </TouchableOpacity>
        </>
      ),
    });
    return out;
  }, [items, reads, range, videos]); // eslint-disable-line react-hooks/exhaustive-deps
  return <StoryDeck cards={cards} onClose={onClose} />;
}

/**
 * For the Videos section's Wrapped tab: a Videos + Manga Wrapped of this
 * week, this month or this year (reads load when you tap).
 */
export function MixWrappedCard({ manga, videos }: { manga: { items: MangaUiSeries[]; loadReads: () => Promise<MangaRead[]> }; videos: MixVideos }) {
  const styles = useStyles(makeStyles);
  const [reads, setReads] = useState<MangaRead[] | null>(null);
  const [range, setRange] = useState<ReadRange | null>(null);
  const now = Date.now();
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
      {range && reads && <RangeWrapped items={manga.items.filter((s) => !s.isPrivate)} reads={reads} range={range} videos={videos} onClose={() => setRange(null)} />}
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
