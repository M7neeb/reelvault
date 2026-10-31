/**
 * Manga Wrapped, like the Videos one: a story for this week, any week, any
 * month or any year of reading, and a Videos + Manga Wrapped that puts your
 * watching and your reading side by side (who won, your #1 of each, the days
 * you did both, mornings and nights). Cards: your time (counted up, against
 * the time before), guess your #1, your #1 and a top five counted down, your
 * biggest day or month, day by day, when you read (part of the day, peak hour,
 * weekday), your longest sitting and streak, manga vs manhwa vs comics, your
 * genres, your author, your favourite, a throwback, what you started and
 * finished, then vs now, and what kind of reader that makes you. The last card
 * can be shared as a picture. The picker lists the weeks, months and years.
 * Presentational only.
 */

import { useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { Image } from 'expo-image';

import { fmtLength } from '../../audio/audioLogic';
import { fmtRating, type MangaRead } from '../../manga/mangaLogic';
import { kindLabel, mixNumbers, monthRangesOf, readingIn, wrappedMore, readingYears, recentWeekRanges, yearRangeOf, type MixPlay, type ReadRange } from '../../manga/mangaInsights';
import { canSnap, shareSnap } from '../../snap';
import { success, warn } from '../haptics';
import Icon from '../Icon';
import { Card } from '../insightParts';
import { StoryDeck, useStoryText, type DeckCard } from '../storyDeck';
import { Confetti, CountUp, CoverWall, GrowBar, GrowColumn, Rays } from '../storyKit';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { ThumbSource } from '../types';
import MangaCover from './MangaCover';
import type { MangaUiSeries } from './mangaTypes';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Your videos, for a Videos + Manga Wrapped. */
export type MixVideos = { plays: MixPlay[]; nameOf: (id: string) => string | null; thumbOf: (id: string) => ThumbSource | null };

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hourLabel = (h: number) => new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
const PART = {
  morning: { name: 'A morning reader', line: 'Most of your reading happened before noon.' },
  afternoon: { name: 'An afternoon reader', line: 'Afternoons were for manga.' },
  evening: { name: 'An evening reader', line: 'Evenings were your reading time.' },
  night: { name: 'A night owl', line: 'Most of your reading happened after 10 at night.' },
} as const;

/** Guess your #1: four covers, tap one. */
function CoverQuiz({ options, answer, onAnswer }: { options: MangaUiSeries[]; answer: string; onAnswer?: (right: boolean) => void }) {
  const styles = useStyles(makeStyles);
  const [picked, setPicked] = useState<string | null>(null);
  const right = options.find((o) => o.id === answer);
  return (
    <View style={{ gap: 12 }}>
      <View style={styles.quizGrid}>
        {options.map((o) => {
          const isAnswer = o.id === answer;
          const show = picked !== null;
          return (
            <TouchableOpacity
              key={o.id}
              disabled={show}
              style={[styles.quizCell, show && isAnswer && styles.quizRight, show && picked === o.id && !isAnswer && styles.quizWrong, show && !isAnswer && picked !== o.id && { opacity: 0.4 }]}
              onPress={() => {
                setPicked(o.id);
                if (o.id === answer) success();
                else warn();
                onAnswer?.(o.id === answer);
              }}
              accessibilityLabel={o.title}>
              <MangaCover series={o} width={120} radius={12} />
              {show && isAnswer && (
                <Animated.View entering={ZoomIn} style={styles.quizBadge}>
                  <Icon name="check" size={16} color="#fff" weight="bold" />
                </Animated.View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
      {picked !== null && (
        <Animated.Text entering={ZoomIn} style={styles.quizResult}>
          {picked === answer ? 'You know yourself. That is your #1.' : `Not quite: it was ${right?.title ?? 'another one'}.`}
        </Animated.Text>
      )}
    </View>
  );
}

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
    const w = wrappedMore(items, reads, range.start, range.end);
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

    // Your time, counted up, against the same stretch before.
    if (!mix && y.ms > 0) {
      const change = w.prev.ms > 0 ? Math.round(((y.ms - w.prev.ms) / w.prev.ms) * 100) : null;
      const before = range.kind === 'year' ? 'the year before' : range.kind === 'month' ? 'the month before' : range.kind === 'week' ? 'the week before' : 'the time before';
      out.push({
        key: 'time',
        colors: ['#0A84FF', '#03142B'],
        ms: 6000,
        body: (
          <>
            {s.kicker('YOU READ FOR', 0)}
            <CountUp to={y.ms / 60_000} format={(m) => (m >= 120 ? `${Math.round(m / 60)} h` : `${Math.round(m)} min`)} style={styles.count} delay={300} />
            {s.line(
              `${y.days} ${y.days === 1 ? 'day' : 'days'}, ${y.chapters} ${y.chapters === 1 ? 'chapter' : 'chapters'}${y.pages ? `, ${y.pages.toLocaleString()} pages` : ''}.`,
              2
            )}
            {change !== null && s.line(change === 0 ? `Just like ${before}.` : change > 0 ? `${change}% more than ${before}.` : `${-change}% less than ${before}.`, 3)}
          </>
        ),
      });
    }

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

    const quizOptions = w.quiz ? w.quiz.options.map((id) => byId.get(id)).filter((x): x is MangaUiSeries => !!x) : [];
    if (w.quiz && quizOptions.length >= 3 && top[0]?.s) {
      out.push({
        key: 'quiz',
        colors: ['#BF5AF2', '#1C0533'],
        ms: 15000,
        interactive: true,
        body: (
          <>
            {s.kicker('QUICK QUESTION', 0)}
            {s.big('Which one did you read the most?', 1)}
            <CoverQuiz options={quizOptions} answer={w.quiz.answer} />
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
            {s.kicker('YOUR TOP ' + top.length, 0)}
            <View style={{ gap: 8, marginTop: 6 }}>
              {top.map((t, n) => (
                // Counted down: the last place shows first, your #1 last.
                <Animated.View key={t.id} entering={s.enter(1 + (top.length - n) * 2)} style={styles.wRow}>
                  <Text style={styles.wRank}>{n + 1}</Text>
                  <MangaCover series={t.s!} width={36} radius={6} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.wTitle} numberOfLines={1}>
                      {t.s!.title}
                    </Text>
                    <Text style={styles.wSub}>{[t.chapters ? `${t.chapters} ch.` : null, t.ms ? fmtLength(t.ms) : null].filter(Boolean).join(' · ')}</Text>
                  </View>
                </Animated.View>
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

    // When you read: part of the day, peak hour, weekday.
    if (w.partOfDay && y.ms > 0) {
      const max = Math.max(1, ...y.hours);
      out.push({
        key: 'when',
        colors: ['#5E5CE6', '#0D0B2E'],
        ms: 6500,
        body: (
          <>
            {s.kicker('WHEN YOU READ', 0)}
            {s.big(PART[w.partOfDay].name, 1)}
            {s.line(PART[w.partOfDay].line, 2)}
            <View style={styles.hoursRow}>
              {y.hours.map((ms, h) => (
                <View key={h} style={styles.dayCell}>
                  <GrowColumn ratio={ms / max} height={110} width="70%" delay={200 + h * 25} color={h === w.peakHour ? '#FFD60A' : '#fff'} radius={3} />
                </View>
              ))}
            </View>
            <View style={styles.hoursAxis}>
              {['12 am', '6 am', '12 pm', '6 pm'].map((l) => (
                <Text key={l} style={styles.axis}>
                  {l}
                </Text>
              ))}
            </View>
            {w.peakHour !== null && s.line(`Your peak: around ${hourLabel(w.peakHour)}${w.weekday ? `, and ${WEEKDAYS[w.weekday.day]}s were your day` : ''}.`, 4)}
          </>
        ),
      });
    }

    // Your longest sitting and your streak.
    if ((w.longest && w.longest.ms >= 10 * 60_000) || w.streak >= 3) {
      const t = w.longest?.seriesId ? byId.get(w.longest.seriesId) : undefined;
      out.push({
        key: 'sitting',
        colors: ['#FF453A', '#2B0705'],
        ms: 6000,
        body: (
          <>
            {w.longest && w.longest.ms >= 10 * 60_000 ? (
              <>
                {s.kicker('YOUR LONGEST SITTING', 0)}
                {s.huge(fmtLength(w.longest.ms), 1)}
                {s.line(`${t ? `${t.title}, ` : ''}${longDay(w.longest.at)}.`, 2)}
              </>
            ) : null}
            {w.streak >= 3 && (
              <>
                {s.kicker('YOUR LONGEST STREAK', 3)}
                {s.big(`${w.streak} days in a row`, 4)}
              </>
            )}
          </>
        ),
      });
    }

    // Manga, manhwa or comics.
    if (w.kinds.length > 1) {
      out.push({
        key: 'kinds',
        colors: ['#64D2FF', '#03202B'],
        ms: 5500,
        body: (
          <>
            {s.kicker('WHAT YOU READ', 0)}
            {s.big(`Mostly ${kindLabel(w.kinds[0].kind).toLowerCase()}`, 1)}
            {s.bars(
              w.kinds.map((k) => ({ label: kindLabel(k.kind), share: k.share, sub: `${k.chapters} ch.` })),
              2
            )}
          </>
        ),
      });
    }

    if (w.genres.length) {
      const most = Math.max(1, ...w.genres.map((g) => g.titles));
      out.push({
        key: 'genre',
        colors: ['#FF9F0A', '#2B1500'],
        ms: 5500,
        body: (
          <>
            {s.kicker(w.genres.length > 1 ? 'YOUR GENRES' : 'YOUR GENRE', 0)}
            {s.big(w.genres[0].name, 1)}
            {w.genres.length > 1
              ? s.bars(
                  w.genres.map((g) => ({ label: g.name, share: g.titles / most, sub: `${g.titles} ${g.titles === 1 ? 'title' : 'titles'}` })),
                  2
                )
              : s.line('More of what you read had it than anything else.', 2)}
          </>
        ),
      });
    }

    if (w.author) {
      out.push({
        key: 'author',
        colors: ['#30D158', '#05210E'],
        ms: 5000,
        body: (
          <>
            {s.kicker('YOUR AUTHOR', 0)}
            {s.big(w.author.name, 1)}
            {s.line(`${w.author.chapters} chapters${w.author.titles > 1 ? ` across ${w.author.titles} titles` : ''}.`, 2)}
          </>
        ),
      });
    }

    const fav = w.favourite ? byId.get(w.favourite.id) : undefined;
    if (fav && fav.id !== top[0]?.s?.id) {
      out.push({
        key: 'favourite',
        colors: ['#FFD60A', '#2E2400'],
        ms: 5500,
        body: (
          <>
            {s.kicker('YOUR FAVOURITE', 0)}
            <MangaCover series={fav} width={130} radius={14} />
            {s.big(fav.title, 2)}
            {s.line(`You rated it ${fmtRating(fav.rating)}. Not your most read, but your best.`, 3)}
          </>
        ),
      });
    }

    const back = w.throwback ? byId.get(w.throwback.id) : undefined;
    if (back && w.throwback) {
      out.push({
        key: 'throwback',
        colors: ['#AC8E68', '#1E160C'],
        ms: 5500,
        body: (
          <>
            {s.kicker('A THROWBACK', 0)}
            <MangaCover series={back} width={120} radius={14} />
            {s.big(back.title, 2)}
            {s.line(`You first read it ${new Date(w.throwback.since).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}, and came back to it.`, 3)}
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

    // Then vs now.
    if (!mix && (w.prev.ms > 0 || w.prev.chapters > 0) && range.kind !== 'custom') {
      const rows = [
        { label: 'Time', now: y.ms, then: w.prev.ms, fmt: (v: number) => (v ? fmtLength(v) : '0 min') },
        { label: 'Chapters', now: y.chapters, then: w.prev.chapters, fmt: String },
        { label: 'Titles', now: y.titles, then: w.prev.titles, fmt: String },
      ];
      out.push({
        key: 'thenvsnow',
        colors: ['#0A84FF', '#03142B'],
        ms: 6000,
        body: (
          <>
            {s.kicker('THEN VS NOW', 0)}
            {s.big(y.ms >= w.prev.ms ? 'You read more' : 'A quieter stretch', 1)}
            {s.bars(
              rows.flatMap((r) => {
                const most = Math.max(1, r.now, r.then);
                return [
                  { label: `${r.label} · before`, share: r.then / most, sub: r.fmt(r.then) },
                  { label: `${r.label} · now`, share: r.now / most, sub: r.fmt(r.now) },
                ];
              }),
              2
            )}
          </>
        ),
      });
    }

    // What kind of reader that makes you.
    out.push({
      key: 'type',
      colors: ['#FF375F', '#2B0612'],
      ms: 6000,
      cheer: true,
      backdrop: <Rays size={1000} color="#FF375F" />,
      body: (
        <>
          {s.kicker('WHICH MAKES YOU', 0)}
          {s.big(w.type.name, 1)}
          {s.line(w.type.line, 2)}
        </>
      ),
    });

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
            {!mix && <Text style={styles.snapType}>{w.type.name}</Text>}
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
