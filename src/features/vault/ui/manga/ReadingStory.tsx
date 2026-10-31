/**
 * The reading Wrapped, told like a manga volume: a prologue, four chapters
 * and an epilogue, each opening with its own title page. Behind every card:
 * your pages and covers, in one of eighteen layouts that change from card to card
 * (pageScenes.tsx).
 *
 * - Prologue: quick cuts through the panels of what you read, then the year
 *   (or month, or week).
 * - Chapter 1, The Numbers: guess your hours, your time counted up against the
 *   time before, the pages you turned as a stack of paper, what it all adds up
 *   to (films, days, printed volumes), and how far your thumb scrolled long
 *   strips, against the Eiffel Tower and friends.
 * - Chapter 2, Your Stories: guess your #1, the top five counted down with each
 *   title's own pages behind it, the #1 with confetti, how you met it and your
 *   binge day with it, name that panel (a page up close: which title?), your
 *   favourite, a hidden gem and a throwback.
 * - Chapter 3, Your Habits: every day of the range as a calendar, the year
 *   month by month, a page a month (what you read most in each), your biggest
 *   day, a guess and a 24-hour clock of when you read, your longest sitting,
 *   your streak in flames, how your pages turned, and your speed, with pages
 *   turning behind it at your own pace.
 * - Chapter 4, Your Taste: manga or manhwa or comics, genres, your author,
 *   your ratings and the harshest one, what you started (a fan of covers),
 *   finished (a shelf), dropped, and your first and last chapter.
 * - Epilogue: then vs now, your badges, the kind of reader you are, the very
 *   page you stopped on, "to be continued" with the chapters waiting for you,
 *   and a card to share.
 * A Videos + Manga Wrapped adds who won, your #1 video and mornings vs nights.
 * Presentational only.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { Image } from 'expo-image';

import { fmtLength } from '../../audio/audioLogic';
import { chapterLabel, fmtRating, type MangaChapter, type MangaRead } from '../../manga/mangaLogic';
import { kindLabel, mixNumbers, type MixPlay, type ReadRange } from '../../manga/mangaInsights';
import { chapterToShow, MODE_LABEL, wrappedStory } from '../../manga/mangaWrapped';
import { scrollCompare } from '../../manga/pageDirector';
import type { ImageRef } from '../../manga/sources/types';
import { canSnap, shareSnap } from '../../snap';
import { success, warn } from '../haptics';
import Icon from '../Icon';
import { StoryDeck, useStoryText, type DeckCard } from '../storyDeck';
import { Confetti, CountUp, GrowBar, GrowColumn, Rays, Tilt } from '../storyKit';
import { sheet, useStyles } from '../theme';
import type { ThumbSource } from '../types';
import MangaCover from './MangaCover';
import { SfxSet } from '../scenes';
import { BadgeGrid, cachedLoader, ChapterArt, ClockDial, CoverFan, GiantRank, Heatmap, PageStack, RatingBars, Shelf, StreakChain, TextQuiz, TitleChip, type PageLoader } from './mangaKit';
import { BankMontage, PageBankProvider, PageScene, useBankLoader } from './pageScenes';
import { PageTimeline, PanelQuiz, RacingStrip, SpeedFlip, StopPage } from './readingExtras';
import type { MangaUiSeries } from './mangaTypes';

/** Your videos, for a Videos + Manga Wrapped. */
export type MixVideos = { plays: MixPlay[]; nameOf: (id: string) => string | null; thumbOf: (id: string) => ThumbSource | null };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hourLabel = (h: number) => new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
const longDay = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const monthYear = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const orDash = (ms: number) => (ms ? fmtLength(ms) : '0 min');
const bigTime = (ms: number) => (ms >= 36_000_000 ? `${Math.round(ms / 3_600_000)} h` : orDash(ms));
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const PART = {
  morning: { name: 'A morning reader', line: 'Most of your pages turned before noon.' },
  afternoon: { name: 'An afternoon reader', line: 'Afternoons belonged to manga.' },
  evening: { name: 'An evening reader', line: 'Evenings were your reading time.' },
  night: { name: 'A night owl', line: 'More of your reading happened after 10 pm than at any other time.' },
} as const;
const TYPE_COLORS: Record<string, [string, string]> = {
  binger: ['#FF453A', '#2B0705'],
  night: ['#5E5CE6', '#0B0A26'],
  explorer: ['#30D158', '#05210E'],
  devotee: ['#FF375F', '#2B0612'],
  finisher: ['#FFD60A', '#2E2400'],
  steady: ['#64D2FF', '#03202B'],
};

/** Guess your #1: four covers, tap one. */
function CoverQuiz({ options, answer }: { options: MangaUiSeries[]; answer: string }) {
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
                if (isAnswer) success();
                else warn();
              }}
              accessibilityLabel={o.title}>
              <MangaCover series={o} width={118} radius={12} />
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
          {picked === answer ? 'You know yourself. That is your #1.' : `Not quite. It was ${right?.title ?? 'another one'}.`}
        </Animated.Text>
      )}
    </View>
  );
}

export function RangeWrapped({
  items,
  reads,
  range,
  videos,
  loadPages,
  onClose,
}: {
  items: MangaUiSeries[];
  reads: MangaRead[];
  range: ReadRange;
  /** Given: a Videos + Manga Wrapped. */
  videos?: MixVideos | null;
  /** The pages of a chapter, to show behind the cards about a title. */
  loadPages?: (series: MangaUiSeries, chapter: MangaChapter) => Promise<ImageRef[]>;
  onClose: () => void;
}) {
  const s = useStoryText();
  const styles = useStyles(makeStyles);
  const snapRef = useRef<View>(null);
  const [now] = useState(() => Date.now());

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  // Each title's pages: a chapter on the phone if there is one, else one you read.
  const load = useMemo<PageLoader | null>(() => {
    if (!loadPages) return null;
    return cachedLoader(async (id) => {
      const ser = byId.get(id);
      if (!ser) return [];
      const cid = chapterToShow(ser, range.start, range.end);
      const ch = ser.chapters.find((c) => c.id === cid);
      if (!ch || !reachable(ser, ch)) return [];
      return loadPages(ser, ch);
    });
  }, [loadPages, byId, range.start, range.end]);

  // Pages of your top titles, for the living backgrounds of every card.
  // The period before: last week's Monday, last month's 1st, last year's 1 January (compared over the same length of time).
  const prevStart = useMemo(() => {
    const d = new Date(range.start);
    if (range.kind === 'year') return new Date(d.getFullYear() - 1, 0, 1).getTime();
    if (range.kind === 'month') return new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    if (range.kind === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7).getTime();
    return undefined;
  }, [range.start, range.kind]);
  // All the numbers, worked out once.
  const st = useMemo(() => wrappedStory(items, reads, range.start, range.end, now, prevStart), [items, reads, range.start, range.end, now, prevStart]);
  const topIds = useMemo(() => st.titles.map((t) => t.id), [st]);
  const coverPool = useMemo(
    () => [...topIds.map((id) => byId.get(id)?.coverSource), ...items.filter((i) => i.lastReadAt).map((i) => i.coverSource)].filter(Boolean).slice(0, 18) as ThumbSource[],
    [topIds, items, byId]
  );
  // Pages for every card: your top titles first, then everything else you read in the range
  // (latest first), then titles with chapters on the phone, so there are many to choose from.
  const bankIds = useMemo(() => {
    const inRange = (t: number | null | undefined) => typeof t === 'number' && t >= range.start && t < range.end;
    const readNow = items.filter((i) => inRange(i.lastReadAt) || i.chapters.some((c) => inRange(c.readAt))).sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0));
    const onPhone = items.filter((i) => i.chapters.some((c) => c.folder && c.pages.length > 2));
    const out: string[] = [];
    for (const id of [...topIds, ...readNow.map((i) => i.id), ...onPhone.map((i) => i.id)]) if (!out.includes(id)) out.push(id);
    return out.slice(0, 18);
  }, [topIds, items, range.start, range.end]);
  const bank = useBankLoader(load, bankIds, coverPool);
  // Behind every card: your manga itself (see pageScenes.tsx), never a plain colour.
  const ambient = useCallback((_card: DeckCard, i: number) => <PageScene i={i} />, []);

  const cards = useMemo<DeckCard[]>(() => {
    const { y, w } = st;
    const mix = videos ? mixNumbers(videos.plays, y, reads) : null;
    const get = (id: string | null | undefined) => (id ? byId.get(id) : undefined);
    const top = st.titles.map((t) => ({ ...t, s: get(t.id)! })).filter((t) => t.s);
    const isYear = range.kind === 'year';
    const isAll = range.kind === 'all';
    const sameBefore = isYear ? 'this time last year' : range.kind === 'month' ? 'the same days last month' : range.kind === 'week' ? 'the same days last week' : 'the time before';
    const span = isYear ? 'year' : range.kind === 'month' ? 'month' : range.kind === 'week' ? 'week' : 'time';
    const when = isAll ? `since ${monthYear(range.start)}` : isYear || range.kind === 'month' ? `in ${range.label}` : range.label === 'This week' ? 'this week' : range.label === 'Last week' ? 'last week' : `from ${range.label}`;
    const nothing = !y.chapters && !y.ms && !(mix && mix.watchMs);
    const out: DeckCard[] = [];

    /** The range's name, as big as it fits (2026 is huge, "Sep 28 – Oct 4" is smaller). */
    const rangeTitle = (label: string) => (
      <Animated.Text entering={s.enter(1)} style={[styles.rangeTitle, { fontSize: label.length <= 6 ? 88 : label.length <= 10 ? 62 : 46, lineHeight: label.length <= 6 ? 92 : label.length <= 10 ? 66 : 50 }]} numberOfLines={2}>
        {label}
      </Animated.Text>
    );

    /** A chapter's title page, like the first page of a new chapter in a volume. */
    const chapter = (n: number, name: string, line: string, colors: [string, string]) =>
      out.push({
        key: `ch${n}`,
        colors,
        ms: 3200,
        backdrop: (
          <>
            <Rays size={1400} count={56} opacity={0.12} />
            <ChapterArt seed={n} />
          </>
        ),
        body: (
          <View style={{ gap: 10, marginTop: '-55%' }}>
            {s.kicker(`CHAPTER ${n}`, 0)}
            <Text style={styles.chapterJp}>{`第${n}話`}</Text>
            {s.big(name, 1)}
            <View style={styles.rule} />
            {s.line(line, 3)}
          </View>
        ),
      });

    /* ----------------------------------------------------------- prologue */
    const montageIds = top.map((t) => t.id);
    if (!nothing && load && montageIds.length) {
      out.push({
        key: 'cold',
        colors: ['#000000', '#000000'],
        ms: 3400,
        solid: true,
        backdrop: <BankMontage />,
        body: (
          <View style={{ alignItems: 'center', gap: 8 }}>
            {s.kicker(mix ? 'VIDEOS + MANGA' : 'PREVIOUSLY, ON YOUR READING…', 0)}
            {rangeTitle(range.label)}
          </View>
        ),
      });
    }
    out.push({
      key: 'intro',
      colors: mix ? ['#BF5AF2', '#16052B'] : ['#FF375F', '#2B0612'],
      ms: 5200,
      body: (
        <>
          {s.kicker(mix ? 'VIDEOS + MANGA WRAPPED' : 'YOUR READING WRAPPED', 0)}
          {rangeTitle(range.label)}
          {s.line(
            nothing
              ? `Nothing ${mix ? 'watched or read' : 'read'} ${when} yet. Open a chapter and come back.`
              : mix
                ? `${orDash(mix.totalMs)} of videos and manga ${when}, on ${plural(mix.days, 'day')}.`
                : `${plural(y.chapters, 'chapter')}${y.ms ? `, ${fmtLength(y.ms)}` : ''}, ${plural(y.titles, 'title')}${isAll ? ` since ${monthYear(range.start)}. Your whole reading story` : `. Let's look back`}.`,
            2
          )}
        </>
      ),
    });
    if (nothing) return out;

    /* ---------------------------------------------------- 1 · the numbers */
    chapter(1, 'The Numbers', `Every minute and every page, ${when}.`, ['#0A84FF', '#020B1C']);

    const hoursQuiz = st.quizzes.find((q) => q.key === 'hours');
    if (hoursQuiz && !mix) {
      out.push({
        key: 'q-hours',
        backdrop: <SfxSet kind="question" />,
        colors: ['#5E5CE6', '#0D0B2E'],
        ms: 15000,
        interactive: true,
        body: (
          <>
            {s.kicker('QUICK QUESTION', 0)}
            {s.big(hoursQuiz.question, 1)}
            <TextQuiz options={hoursQuiz.options} answer={hoursQuiz.answer} reveal={(r) => (r ? 'Spot on.' : `It was ${hoursQuiz.options[hoursQuiz.answer]}.`)} />
          </>
        ),
      });
    }

    if (!mix && y.ms > 0) {
      const change = w.prev.ms > 0 ? Math.round(((y.ms - w.prev.ms) / w.prev.ms) * 100) : null;
      out.push({
        key: 'time',
        colors: ['#0A84FF', '#03142B'],
        ms: 6500,
        solid: !!top[0],
        backdrop: top[0] ? <PageScene i={out.length} focus={top[0].s} dim={0.32} /> : undefined,
        body: (
          <>
            {s.kicker('YOU READ FOR', 0)}
            <CountUp to={y.ms / 60_000} format={(m) => (m >= 120 ? `${Math.round(m / 60)} h` : `${Math.round(m)} min`)} style={styles.count} delay={300} ms={1600} />
            {s.line(`${plural(y.days, 'day')} of reading, ${plural(st.sessions.count, 'sitting')}${st.sessions.averageMs >= 60_000 ? ` of about ${fmtLength(st.sessions.averageMs)}` : ''}.`, 2)}
            {change !== null &&
              s.line(change === 0 ? `Just like ${sameBefore}.` : change > 0 ? `That's ${change}% more than ${sameBefore}. ↑` : `${-change}% less than ${sameBefore}.`, 3)}
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
            {mix.bothDays > 0 && s.line(`${plural(mix.bothDays, 'day')} you did both.`, 5)}
          </>
        ),
      });
    }

    const pageCount = y.pages || y.chapters * 20;
    if (pageCount >= 20) {
      out.push({
        key: 'pages',
        colors: ['#FF9F0A', '#2B1500'],
        ms: 6000,
        body: (
          <>
            {s.kicker('PAGES TURNED', 0)}
            <CountUp to={pageCount} format={(n) => Math.round(n).toLocaleString()} style={styles.count} delay={200} ms={1500} />
            <PageStack sheets={Math.max(5, Math.min(16, Math.round(Math.log2(pageCount) * 1.4)))} />
            {s.line(
              st.adds.stackCm >= 1
                ? `Printed and stacked, that's a pile ${st.adds.stackCm >= 100 ? `${(st.adds.stackCm / 100).toFixed(1)} m` : `${Math.round(st.adds.stackCm)} cm`} high.${y.pages ? '' : ' (About 20 pages a chapter.)'}`
                : 'A first little pile.',
              3
            )}
          </>
        ),
      });
    }

    const volumes = Math.round(y.chapters / 9);
    if (!mix && (st.adds.movies >= 1 || volumes >= 2)) {
      const rows: { icon: 'film' | 'sun' | 'book'; text: string }[] = [];
      if (st.adds.movies >= 1) rows.push({ icon: 'film', text: `${st.adds.movies >= 10 ? Math.round(st.adds.movies) : st.adds.movies} films back to back` });
      if (st.adds.fullDays >= 1) rows.push({ icon: 'sun', text: `${st.adds.fullDays} full ${st.adds.fullDays === 1 ? 'day and night' : 'days and nights'} without stopping` });
      // A printed volume holds about nine chapters.
      if (volumes >= 2) rows.push({ icon: 'book', text: `about ${volumes.toLocaleString()} printed volumes on a shelf` });
      out.push({
        key: 'adds',
        colors: ['#30D158', '#05210E'],
        ms: 6000,
        body: (
          <>
            {s.kicker('THAT ADDS UP TO', 0)}
            <View style={{ gap: 14, marginTop: 6 }}>
              {rows.map((r, i) => (
                <Animated.View key={r.text} entering={s.enter(1 + i * 2)} style={styles.addRow}>
                  <View style={styles.addIcon}>
                    <Icon name={r.icon} size={22} color="#fff" />
                  </View>
                  <Text style={styles.addText}>{r.text}</Text>
                </Animated.View>
              ))}
            </View>
          </>
        ),
      });
    }

    // How far your thumb scrolled long strips, against things you could climb.
    const metres = Math.round(st.adds.stripKm * 1000);
    const vs = scrollCompare(metres);
    if (!mix && vs && metres >= 50) {
      out.push({
        key: 'scroll',
        colors: ['#64D2FF', '#03202B'],
        ms: 6500,
        solid: true,
        backdrop: (
          <>
            <RacingStrip />
            <SfxSet kind="rush" color="#64D2FF" />
          </>
        ),
        body: (
          <>
            {s.kicker('YOUR THUMB SCROLLED', 0)}
            <CountUp to={metres} format={(m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`)} style={styles.count} delay={200} ms={1700} />
            {s.line(`of long strip. That's ${vs.times >= 1.05 ? `${vs.times}× ` : ''}${vs.name}${vs.times < 0.95 ? `, ${Math.round(vs.times * 100)}% of the way` : ''}.`, 2)}
            {s.line('(A long-strip chapter is about 4 m of scrolling.)', 4)}
          </>
        ),
      });
    }

    /* -------------------------------------------------- 2 · your stories */
    if (top.length) chapter(2, 'Your Stories', 'The titles that kept you turning pages.', ['#FF375F', '#1E0410']);

    const quizIds = w.quiz?.options ?? [];
    const quizOptions = quizIds.map((id) => get(id)).filter((x): x is MangaUiSeries => !!x);
    if (w.quiz && quizOptions.length >= 3 && top[0]) {
      out.push({
        key: 'q-top',
        backdrop: <SfxSet kind="question" />,
        colors: ['#BF5AF2', '#1C0533'],
        ms: 15000,
        interactive: true,
        body: (
          <>
            {s.kicker('BEFORE THE COUNTDOWN', 0)}
            {s.big('Which one did you read the most?', 1)}
            <CoverQuiz options={quizOptions} answer={w.quiz.answer} />
          </>
        ),
      });
    }

    // The countdown: one card each for #5 to #2, the title's own pages behind it.
    const rankColors: [string, string][] = [
      ['#64D2FF', '#03202B'],
      ['#30D158', '#05210E'],
      ['#FF9F0A', '#2B1500'],
      ['#BF5AF2', '#1C0533'],
    ];
    for (let r = Math.min(top.length, 5); r >= 2; r--) {
      const t = top[r - 1];
      out.push({
        key: `rank${r}`,
        colors: rankColors[(5 - r) % rankColors.length],
        ms: 4800,
        solid: true,
        backdrop: (
          <>
            <PageScene i={out.length} focus={t.s} dim={0.2} />
            {r === 2 && <SfxSet kind="menace" />}
          </>
        ),
        body: (
          <>
            <GiantRank n={r} />
            {s.kicker(`NUMBER ${r}`, 0)}
            <Tilt rotate={r % 2 ? -4 : 4} delay={150}>
              <MangaCover series={t.s} width={128} radius={12} />
            </Tilt>
            {s.big(t.s.title, 2)}
            {s.line([t.chapters ? plural(t.chapters, 'chapter') : null, t.ms ? fmtLength(t.ms) : null, t.s.rating ? `★ ${fmtRating(t.s.rating)}` : null].filter(Boolean).join(' · '), 3)}
          </>
        ),
      });
    }

    const one = top[0];
    if (one) {
      out.push({
        key: 'top1',
        colors: ['#FFD60A', '#2E2400'],
        ms: 7000,
        cheer: true,
        solid: true,
        backdrop: (
          <>
            <PageScene i={out.length} focus={one.s} dim={0.1} />
            <SfxSet kind="impact" color="#FFD60A" />
            <View style={{ position: 'absolute', alignSelf: 'center', top: '20%' }}>
              <Rays size={1000} color="#FFD60A" opacity={0.18} />
            </View>
          </>
        ),
        body: (
          <>
            {s.kicker(mix ? 'YOUR #1 MANGA' : isAll ? 'YOUR #1 OF ALL TIME' : `YOUR #1 OF THE ${span.toUpperCase()}`, 0)}
            <Tilt rotate={-3} delay={200}>
              <MangaCover series={one.s} width={160} radius={14} />
            </Tilt>
            {s.big(one.s.title, 2)}
            {s.line(
              `${[one.chapters ? plural(one.chapters, 'chapter') : null, one.ms ? fmtLength(one.ms) : null].filter(Boolean).join(', ')}: ${Math.round(one.share * 100)}% of all your reading.`,
              3
            )}
            <Confetti />
          </>
        ),
      });

      // How you met your #1, and your binge day with it.
      if (one.metAt || one.binge) {
        out.push({
          key: 'top1-story',
          colors: ['#FF9F0A', '#2B1500'],
          ms: 6500,
          solid: true,
          backdrop: <PageScene i={out.length} focus={one.s} dim={0.28} />,
          body: (
            <>
              {s.kicker('YOU AND YOUR #1', 0)}
              <TitleChip series={one.s} sub={one.s.author ?? undefined} />
              {one.metAt && s.big(one.metAt < range.start ? `Since ${monthYear(one.metAt)}` : `Met on ${new Date(one.metAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`, 2)}
              {one.metAt && s.line(isAll ? 'The story you gave the most of your time to, ever.' : one.metAt < range.start ? 'An old friend you kept coming back to.' : `A new story that became your favourite of the ${span}.`, 3)}
              {one.binge && s.line(`Your binge: ${plural(one.binge.chapters, 'chapter')} in one day, ${longDay(one.binge.day)}.`, 4)}
              {one.sessions > 1 && s.line(`${plural(one.sessions, 'sitting')}, from ${new Date(one.firstAt!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} to ${new Date(one.lastAt!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}.`, 5)}
            </>
          ),
        });
      }
    }

    // Name that panel: a page from one of your titles, up close.
    if (top.length >= 3) {
      const opts = [...top.slice(1, 4).map((t) => t.s), top[0].s];
      out.push({
        key: 'q-panel',
        backdrop: <SfxSet kind="question" />,
        colors: ['#FF375F', '#2B0612'],
        ms: 16000,
        interactive: true,
        body: (
          <>
            {s.kicker('NAME THAT PANEL', 0)}
            {s.big('Which title is this from?', 1)}
            <PanelQuiz options={opts} seed={y.chapters + top.length} />
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
            {s.line(`${fmtLength(mix.topVideo.ms)}, ${plural(mix.topVideo.plays, 'play')}.${mix.videos > 1 ? ` One of ${mix.videos} videos you watched.` : ''}`, 3)}
          </>
        ),
      });
    }

    const fav = get(w.favourite?.id);
    if (fav && fav.id !== one?.s.id) {
      out.push({
        key: 'favourite',
        colors: ['#FFD60A', '#2E2400'],
        ms: 5800,
        solid: true,
        backdrop: (
          <>
            <PageScene i={out.length} focus={fav} dim={0.22} />
            <SfxSet kind="heart" color="#FF375F" />
          </>
        ),
        body: (
          <>
            {s.kicker('YOUR FAVOURITE', 0)}
            <Tilt rotate={3} delay={150}>
              <MangaCover series={fav} width={130} radius={14} />
            </Tilt>
            {s.big(fav.title, 2)}
            {s.line(`★ ${fmtRating(fav.rating)}. Not your most read, but your best.`, 3)}
          </>
        ),
      });
    }

    const gem = get(st.gem?.id);
    if (gem && st.gem && gem.id !== fav?.id) {
      out.push({
        key: 'gem',
        colors: ['#64D2FF', '#03202B'],
        ms: 5500,
        solid: true,
        backdrop: <PageScene i={out.length} focus={gem} dim={0.25} />,
        body: (
          <>
            {s.kicker('A HIDDEN GEM', 0)}
            <MangaCover series={gem} width={120} radius={12} />
            {s.big(gem.title, 2)}
            {s.line(`You rated it ${fmtRating(st.gem.rating)} after just ${plural(Math.max(1, st.gem.chapters), 'chapter')}. Worth more of your time?`, 3)}
          </>
        ),
      });
    }

    const back = get(w.throwback?.id);
    if (back && w.throwback) {
      out.push({
        key: 'throwback',
        colors: ['#AC8E68', '#1E160C'],
        ms: 5500,
        solid: true,
        backdrop: <PageScene i={out.length} focus={back} dim={0.22} />,
        body: (
          <>
            {s.kicker('A THROWBACK', 0)}
            <Tilt rotate={-5} delay={150}>
              <MangaCover series={back} width={120} radius={12} />
            </Tilt>
            {s.big(back.title, 2)}
            {s.line(`You first read it in ${monthYear(w.throwback.since)}, and came back to it.`, 3)}
          </>
        ),
      });
    }

    /* --------------------------------------------------- 3 · your habits */
    chapter(3, 'Your Habits', 'When, how long and how often.', ['#5E5CE6', '#090820']);

    if (isAll && st.periods.length >= 2) {
      // Years side by side (a calendar of every day would be far too long).
      const readDays = st.calendar.filter((c) => c.v > 0).length;
      const most = Math.max(1, ...st.periods.map((p) => p.weight));
      const best = st.periods.reduce((b, p) => (p.weight > b.weight ? p : b), st.periods[0]);
      out.push({
        key: 'years',
        colors: ['#30D158', '#041A0B'],
        ms: 7000,
        body: (
          <>
            {s.kicker('YEAR BY YEAR', 0)}
            {s.big(`${best.label} was your year`, 1)}
            {s.bars(
              st.periods.map((p) => ({ label: p.label, share: p.weight / most, sub: p.weight ? fmtLength(p.weight) : '-' })),
              2
            )}
            {s.line(`${plural(readDays, 'day')} with manga out of ${plural(st.calendar.length, 'day')} since you started.`, 4)}
          </>
        ),
      });
    } else if (st.calendar.length >= 7) {
      const readDays = st.calendar.filter((c) => c.v > 0).length;
      out.push({
        key: 'calendar',
        colors: ['#30D158', '#041A0B'],
        ms: 6500,
        body: (
          <>
            {s.kicker(isYear ? 'YOUR YEAR, DAY BY DAY' : range.kind === 'month' ? 'YOUR MONTH, DAY BY DAY' : 'DAY BY DAY', 0)}
            {s.big(`${readDays} of ${st.calendar.length} days`, 1)}
            <Heatmap calendar={st.calendar} year={st.calendar.length > 45} />
            {s.line(st.dayShare >= 0.5 ? 'More days with manga than without.' : st.dayShare >= 0.25 ? 'A habit taking shape.' : 'Every page counts.', 3)}
          </>
        ),
      });
    }

    if (isYear) {
      const vals = st.months.map((m) => m.ms || m.chapters * 300_000);
      const max = Math.max(1, ...vals);
      const best = vals.indexOf(Math.max(...vals));
      const monthQuiz = st.quizzes.find((q) => q.key === 'month');
      if (monthQuiz) {
        out.push({
          key: 'q-month',
        backdrop: <SfxSet kind="question" />,
          colors: ['#FF9F0A', '#2B1500'],
          ms: 14000,
          interactive: true,
          body: (
            <>
              {s.kicker('QUICK QUESTION', 0)}
              {s.big(monthQuiz.question, 1)}
              <TextQuiz options={monthQuiz.options} answer={monthQuiz.answer} reveal={(r) => (r ? 'Right!' : `It was ${monthQuiz.options[monthQuiz.answer]}.`)} />
            </>
          ),
        });
      }
      if (vals.some((v) => v > 0)) {
        out.push({
          key: 'months',
          colors: ['#30D158', '#05210E'],
          ms: 6000,
          body: (
            <>
              {s.kicker('MONTH BY MONTH', 0)}
              {s.big(`${MONTHS[best]} was your month`, 1)}
              <View style={styles.monthsRow}>
                {vals.map((v, m) => (
                  <View key={m} style={styles.monthCell}>
                    <GrowColumn ratio={v / max} height={150} width="72%" delay={200 + m * 60} color={m === best ? '#FFD60A' : '#fff'} radius={4} />
                    <Text style={[styles.monthLabel, m === best && { color: '#FFD60A' }]}>{MONTHS[m][0]}</Text>
                  </View>
                ))}
              </View>
              {vals[best] > 0 && s.line(`${st.months[best].ms ? fmtLength(st.months[best].ms) : plural(st.months[best].chapters, 'chapter')} of reading in ${MONTHS[best]}.`, 3)}
            </>
          ),
        });
      }
    }

    // A page for each part of the range: what you were reading month by month (or week, or day).
    const parts = st.periods.filter((p) => p.seriesId).length;
    if (parts >= 3) {
      const unit = isAll ? 'year' : isYear ? 'month' : range.kind === 'month' ? 'week' : 'day';
      const stories = new Set(st.periods.map((p) => p.seriesId).filter(Boolean)).size;
      out.push({
        key: 'timeline',
        colors: ['#BF5AF2', '#1C0533'],
        ms: 8000,
        body: (
          <>
            {s.kicker(`A PAGE A ${unit.toUpperCase()}`, 0)}
            {s.big(stories === 1 ? `One story, every ${unit}` : `${stories} stories, ${unit} by ${unit}`, 1)}
            <PageTimeline periods={st.periods} byId={byId} />
            {s.line(`What you were reading most, each ${unit} ${when}.`, 3)}
          </>
        ),
      });
    }

    if (y.busiestDay && (y.busiestDay.ms || y.busiestDay.chapters > 1)) {
      const b = y.busiestDay;
      out.push({
        key: 'bigday',
        colors: ['#FF453A', '#2B0705'],
        ms: 5500,
        body: (
          <>
            {s.kicker('YOUR BIGGEST DAY', 0)}
            {s.big(longDay(b.day), 1)}
            {s.line([b.ms ? fmtLength(b.ms) : null, b.chapters ? plural(b.chapters, 'chapter') : null].filter(Boolean).join(' and ') + ' in one day.', 2)}
          </>
        ),
      });
    }

    const whenQuiz = st.quizzes.find((q) => q.key === 'when');
    if (whenQuiz && !mix) {
      out.push({
        key: 'q-when',
        backdrop: <SfxSet kind="question" />,
        colors: ['#0A84FF', '#03142B'],
        ms: 13000,
        interactive: true,
        body: (
          <>
            {s.kicker('QUICK QUESTION', 0)}
            {s.big(whenQuiz.question, 1)}
            <TextQuiz options={whenQuiz.options} answer={whenQuiz.answer} reveal={(r) => (r ? 'You know your habits.' : `Mostly in the ${whenQuiz.options[whenQuiz.answer].toLowerCase()}.`)} />
          </>
        ),
      });
    }

    if (w.partOfDay && y.ms > 0) {
      out.push({
        key: 'clock',
        colors: w.partOfDay === 'night' ? ['#1C1A4A', '#04030F'] : ['#FF9F0A', '#2B1500'],
        ms: 7000,
        body: (
          <>
            {s.kicker('WHEN YOU READ', 0)}
            {s.big(PART[w.partOfDay].name, 1)}
            <View style={{ marginVertical: 18 }}>
              <ClockDial hours={y.hours} peak={w.peakHour} size={240} />
            </View>
            {w.peakHour !== null && s.line(`Peak hour: around ${hourLabel(w.peakHour)}.${w.weekday ? ` ${WEEKDAYS[w.weekday.day]}s were your day.` : ''}`, 3)}
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

    const sitTitle = get(w.longest?.seriesId);
    if (w.longest && w.longest.ms >= 10 * 60_000) {
      out.push({
        key: 'sitting',
        colors: ['#FF453A', '#2B0705'],
        ms: 6000,
        solid: !!sitTitle,
        backdrop: (
          <>
            {sitTitle && <PageScene i={out.length} focus={sitTitle} dim={0.26} />}
            <SfxSet kind="menace" color="#FF453A" />
          </>
        ),
        body: (
          <>
            {s.kicker('YOUR LONGEST SITTING', 0)}
            {s.huge(fmtLength(w.longest.ms), 1)}
            {sitTitle && <TitleChip series={sitTitle} sub={longDay(w.longest.at)} />}
            {!sitTitle && s.line(longDay(w.longest.at), 2)}
            {s.line(w.longest.ms >= 3 * 3_600_000 ? 'You did not put the phone down.' : w.longest.ms >= 3_600_000 ? 'Just one more chapter, again and again.' : 'One good long read.', 3)}
          </>
        ),
      });
    }

    if (w.streak >= 2) {
      out.push({
        key: 'streak',
        backdrop: <SfxSet kind="rush" color="#FFD60A" />,
        colors: ['#FF9F0A', '#2B1100'],
        ms: 5800,
        body: (
          <>
            {s.kicker('YOUR LONGEST STREAK', 0)}
            {s.huge(`${w.streak} days`, 1)}
            {s.line('in a row, without missing one.', 2)}
            <StreakChain days={w.streak} />
          </>
        ),
      });
    }

    if (st.directions.length) {
      const d0 = st.directions[0];
      out.push({
        key: 'directions',
        colors: ['#64D2FF', '#03202B'],
        ms: 6000,
        body: (
          <>
            {s.kicker('HOW YOUR PAGES TURNED', 0)}
            {s.big(d0.mode === 'webtoon' ? 'Mostly scrolling down' : d0.mode === 'rtl' ? 'Mostly right to left' : d0.mode === 'ltr' ? 'Mostly left to right' : 'Mostly page by page', 1)}
            {s.bars(
              st.directions.map((d) => ({ label: MODE_LABEL[d.mode], share: d.share, sub: plural(d.chapters, 'chapter') })),
              2
            )}
            {st.secondsPerPage !== null && s.line(`About a page every ${st.secondsPerPage} seconds.${st.secondsPerPage <= 6 ? ' Fast!' : ''}`, 4)}
          </>
        ),
      });
    }

    if (st.secondsPerPage !== null && st.secondsPerPage > 0) {
      const spp = st.secondsPerPage;
      out.push({
        key: 'speed',
        colors: ['#FF9F0A', '#2B1500'],
        ms: 7000,
        solid: true,
        backdrop: <SpeedFlip secondsPerPage={spp} />,
        body: (
          <>
            {s.kicker('YOUR READING SPEED', 0)}
            {s.huge(`${spp} s`, 1)}
            {s.line(`a page. Behind this card, pages turn at your pace${spp < 1 ? ' (slowed down so you can see them)' : ''}.`, 2)}
            {s.line(`That's about ${Math.round(3600 / spp).toLocaleString()} pages an hour.${spp <= 4 ? ' Blink and you miss it.' : spp >= 15 ? ' You take in every panel.' : ''}`, 3)}
          </>
        ),
      });
    }

    /* ---------------------------------------------------- 4 · your taste */
    const tasteCount = [w.kinds.length > 1, w.genres.length > 0, !!w.author, st.ratings.rated >= 3, y.started.length > 0, y.completed.length > 0].filter(Boolean).length;
    if (tasteCount >= 2) chapter(4, 'Your Taste', 'What you love, and how you judge it.', ['#FF9F0A', '#1F0E00']);

    if (w.kinds.length > 1) {
      out.push({
        key: 'kinds',
        colors: ['#0A84FF', '#03142B'],
        ms: 5500,
        body: (
          <>
            {s.kicker('WHAT YOU READ', 0)}
            {s.big(`Mostly ${kindLabel(w.kinds[0].kind).toLowerCase()}`, 1)}
            {s.bars(
              w.kinds.map((k) => ({ label: kindLabel(k.kind), share: k.share, sub: `${Math.round(k.share * 100)}%` })),
              2
            )}
          </>
        ),
      });
    }

    if (w.genres.length) {
      const most = Math.max(1, ...w.genres.map((g) => g.titles));
      out.push({
        key: 'genres',
        colors: ['#BF5AF2', '#1C0533'],
        ms: 5800,
        body: (
          <>
            {s.kicker(w.genres.length > 1 ? 'YOUR TOP GENRES' : 'YOUR GENRE', 0)}
            {s.huge(w.genres[0].name, 1)}
            {w.genres.length > 1 &&
              s.bars(
                w.genres.map((g, i) => ({ label: `${i + 1}. ${g.name}`, share: g.titles / most, sub: plural(g.titles, 'title') })),
                2
              )}
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
            {s.line(`${plural(w.author.chapters, 'chapter')}${w.author.titles > 1 ? ` across ${w.author.titles} of their titles` : ''}.`, 2)}
            <CoverFan list={items.filter((i) => i.author?.trim() === w.author!.name && i.chapters.some((c) => c.readAt))} width={88} />
          </>
        ),
      });
    }

    if (st.ratings.rated >= 3) {
      const harsh = get(st.ratings.harshest?.id);
      out.push({
        key: 'ratings',
        colors: ['#FFD60A', '#2E2400'],
        ms: 6500,
        body: (
          <>
            {s.kicker('YOUR RATINGS', 0)}
            {s.big(`★ ${st.ratings.average} on average`, 1)}
            <RatingBars histogram={st.ratings.histogram} />
            {harsh && st.ratings.harshest && s.line(`Harshest: ${harsh.title}, ★ ${fmtRating(st.ratings.harshest.rating)}.`, 4)}
          </>
        ),
      });
    }

    const started = y.started.map((id) => get(id)).filter((x): x is MangaUiSeries => !!x);
    if (started.length) {
      out.push({
        key: 'started',
        colors: ['#64D2FF', '#03202B'],
        ms: 6000,
        body: (
          <>
            {s.kicker('NEW STORIES', 0)}
            {s.huge(String(started.length), 1)}
            {s.line(`${started.length === 1 ? 'title' : 'titles'} you opened for the first time ${when}.`, 2)}
            <CoverFan list={started} />
          </>
        ),
      });
    }

    const completed = y.completed.map((id) => get(id)).filter((x): x is MangaUiSeries => !!x);
    if (completed.length) {
      out.push({
        key: 'completed',
        backdrop: <SfxSet kind="sparkle" color="#FFD60A" />,
        colors: ['#30D158', '#05210E'],
        ms: 6000,
        cheer: completed.length >= 3,
        body: (
          <>
            {s.kicker('SEEN THROUGH TO THE END', 0)}
            {s.big(`${plural(completed.length, 'title')} completed`, 1)}
            <Shelf list={completed} />
          </>
        ),
      });
    }

    const dropped = st.dropped.map((id) => get(id)).filter((x): x is MangaUiSeries => !!x);
    if (dropped.length) {
      out.push({
        key: 'dropped',
        colors: ['#636366', '#0C0C0E'],
        ms: 5000,
        body: (
          <>
            {s.kicker('THE ONES THAT DID NOT MAKE IT', 0)}
            {s.big(`${plural(dropped.length, 'title')} dropped`, 1)}
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              {dropped.slice(0, 5).map((d) => (
                <View key={d.id} style={{ opacity: 0.55 }}>
                  <MangaCover series={d} width={62} radius={8} />
                </View>
              ))}
            </View>
            {s.line('Life is too short for the wrong story.', 3)}
          </>
        ),
      });
    }

    const firstS = get(st.firstChapter?.seriesId);
    const lastS = get(st.lastChapter?.seriesId);
    if (firstS && st.firstChapter && (isYear || range.kind === 'month' || isAll)) {
      const fc = firstS.chapters.find((c) => c.id === st.firstChapter!.chapterId);
      const lc = lastS?.chapters.find((c) => c.id === st.lastChapter?.chapterId);
      out.push({
        key: 'firstlast',
        colors: ['#AC8E68', '#1E160C'],
        ms: 6000,
        body: (
          <>
            {s.kicker(isAll ? 'WHERE IT ALL BEGAN' : 'FIRST AND LAST', 0)}
            {s.line(isAll ? 'Your very first chapter' : `Your ${span} opened with`, 1)}
            <TitleChip series={firstS} sub={`${fc ? chapterLabel(fc, true) : 'a chapter'} · ${new Date(st.firstChapter.at).toLocaleDateString(undefined, isAll ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' })}`} />
            {lastS && st.lastChapter && (
              <>
                {s.line(isAll ? (lastS.id === firstS.id ? '…and your latest is still the same story' : 'and your latest') : lastS.id === firstS.id ? '…and, all this time later, it is still' : 'and so far it ends with', 3)}
                <TitleChip series={lastS} sub={`${lc ? chapterLabel(lc, true) : 'a chapter'} · ${new Date(st.lastChapter.at).toLocaleDateString(undefined, isAll ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' })}`} />
              </>
            )}
          </>
        ),
      });
    }

    // Milestones: your 1st, 50th, 100th, 1,000th chapter (all time, or a year).
    const marks = st.milestones.filter((m) => m.n === 1 || m.n >= 50);
    if ((isAll || isYear) && marks.length >= 2) {
      const shown = [marks[0], ...marks.slice(1).slice(-4)];
      const lastMark = shown[shown.length - 1];
      out.push({
        key: 'milestones',
        colors: ['#FFD60A', '#2E2400'],
        ms: 8000,
        cheer: lastMark.n >= 1000,
        backdrop: <SfxSet kind="sparkle" color="#FFD60A" />,
        body: (
          <>
            {s.kicker('MILESTONES', 0)}
            {s.big(`Chapter ${lastMark.n.toLocaleString()}`, 1)}
            <View style={{ gap: 10, marginTop: 6 }}>
              {shown.map((m, k) => {
                const ser = get(m.seriesId);
                return (
                  <Animated.View key={m.n} entering={s.enter(2 + k)} style={styles.mileRow}>
                    <Text style={styles.mileN}>{m.n === 1 ? '1st' : m.n.toLocaleString()}</Text>
                    {ser && <MangaCover series={ser} width={30} radius={5} />}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.mileTitle} numberOfLines={1}>
                        {ser?.title ?? 'A chapter'}
                      </Text>
                      <Text style={styles.mileDate}>{new Date(m.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                    </View>
                  </Animated.View>
                );
              })}
            </View>
          </>
        ),
      });
    }

    /* ------------------------------------------------------------ epilogue */
    if (!mix && (w.prev.ms > 0 || w.prev.chapters > 0) && range.kind !== 'custom' && !isAll) {
      const rows = [
        { label: 'Time', now: y.ms, then: w.prev.ms, fmt: orDash },
        { label: 'Chapters', now: y.chapters, then: w.prev.chapters, fmt: (v: number) => v.toLocaleString() },
        { label: 'Titles', now: y.titles, then: w.prev.titles, fmt: String },
      ];
      out.push({
        key: 'thenvsnow',
        colors: ['#0A84FF', '#03142B'],
        ms: 6500,
        body: (
          <>
            {s.kicker(`${range.label.toUpperCase()} VS ${sameBefore.toUpperCase()}`, 0)}
            {s.big((y.ms || w.prev.ms ? y.ms >= w.prev.ms : y.chapters >= w.prev.chapters) ? 'You read more' : 'A quieter stretch', 1)}
            <View style={{ gap: 14, marginTop: 8 }}>
              {rows.map((r, i) => {
                const most = Math.max(1, r.now, r.then);
                const up = r.now >= r.then;
                return (
                  <Animated.View key={r.label} entering={s.enter(2 + i)} style={{ gap: 5 }}>
                    <View style={styles.vsHead}>
                      <Text style={styles.vsLabel}>{r.label}</Text>
                      <Text style={[styles.vsValue, { color: up ? '#30D158' : '#FF9F0A' }]}>
                        {r.fmt(r.then)} → {r.fmt(r.now)}
                      </Text>
                    </View>
                    <GrowBar share={r.then / most} color="rgba(255,255,255,0.45)" height={7} delay={300 + i * 150} />
                    <GrowBar share={r.now / most} color="#fff" height={7} delay={420 + i * 150} />
                  </Animated.View>
                );
              })}
            </View>
          </>
        ),
      });
    }

    if (st.badges.length) {
      out.push({
        key: 'badges',
        backdrop: <SfxSet kind="sparkle" />,
        colors: ['#FFD60A', '#231B00'],
        ms: 7000,
        cheer: true,
        body: (
          <>
            {s.kicker('BADGES EARNED', 0)}
            {s.big(st.badges.length === 1 ? 'One badge' : `${st.badges.length} badges`, 1)}
            <BadgeGrid badges={st.badges} />
          </>
        ),
      });
    }

    out.push({
      key: 'type',
      colors: TYPE_COLORS[w.type.key] ?? ['#FF375F', '#2B0612'],
      ms: 6500,
      cheer: true,
      backdrop: (
        <>
          <View style={{ position: 'absolute', alignSelf: 'center', top: '18%' }}>
            <Rays size={1100} color="#ffffff" opacity={0.14} />
          </View>
          <SfxSet kind="sparkle" color="#FFD60A" />
        </>
      ),
      body: (
        <>
          {s.kicker('ALL OF THAT MAKES YOU', 0)}
          <Animated.Text entering={ZoomIn.delay(250).springify().damping(12)} style={styles.typeName}>
            {w.type.name}
          </Animated.Text>
          {s.line(w.type.line, 2)}
          {st.badges.length > 0 && s.line(`With a touch of ${st.badges.slice(0, 2).map((b) => b.name).join(' and ')}.`, 3)}
        </>
      ),
    });

    const stopS = get(st.lastStop?.seriesId);
    const stopC = stopS?.chapters.find((c) => c.id === st.lastStop?.chapterId);
    if (stopS && stopC && st.lastStop && loadPages && reachable(stopS, stopC)) {
      const ls = st.lastStop;
      out.push({
        key: 'stop',
        colors: ['#FF375F', '#2B0612'],
        ms: 7000,
        solid: true,
        backdrop: <PageScene i={out.length} focus={stopS} dim={0.35} />,
        body: (
          <>
            {s.kicker('WHERE YOU LEFT OFF', 0)}
            {s.big(stopS.title, 1)}
            <StopPage series={stopS} chapter={stopC} page={ls.page} loadPages={loadPages} />
            {s.line(`${chapterLabel(stopC, true)}, page ${ls.page + 1} of ${ls.pages}. It's waiting right there.`, 3)}
          </>
        ),
      });
    }

    const next = get(st.waiting.most?.id);
    if (next && st.waiting.most) {
      out.push({
        key: 'continued',
        colors: ['#000000', '#000000'],
        ms: 6000,
        solid: true,
        backdrop: <PageScene i={out.length} focus={next} dim={0.3} />,
        body: (
          <>
            <Text style={styles.tbc}>To be continued…</Text>
            {s.line(`${plural(st.waiting.chapters, 'chapter')} waiting for you in ${plural(st.waiting.titles, 'title')}.`, 1)}
            <TitleChip series={next} sub={`${plural(st.waiting.most.unread, 'unread chapter')}`} />
          </>
        ),
      });
    }

    const summary = mix
      ? `Videos + Manga Wrapped · ${range.label}: ${orDash(mix.watchMs)} watching, ${orDash(mix.readMs)} reading, ${y.chapters} chapters.${one ? ` #1 manga: ${one.s.title}.` : ''}`
      : `Reading Wrapped · ${range.label}: ${plural(y.chapters, 'chapter')}, ${orDash(y.ms)}, ${plural(y.titles, 'title')}. ${w.type.name}.${one ? ` #1: ${one.s.title}.` : ''}`;
    const collage = top.slice(0, 4).map((t) => t.s);
    out.push({
      key: 'end',
      colors: ['#1C1C1E', '#000000'],
      ms: 12000,
      interactive: true,
      body: (
        <>
          <View ref={snapRef} collapsable={false} style={styles.snap}>
            <View style={styles.snapGlow} />
            <Text style={styles.snapKicker}>{mix ? 'VIDEOS + MANGA' : 'READING WRAPPED'} · {range.label.toUpperCase()}</Text>
            <View style={styles.collage}>
              {collage.map((c, i) => (
                <View key={c.id} style={{ transform: [{ rotate: `${(i - 1.5) * 4}deg` }], marginLeft: i ? -18 : 0 }}>
                  <MangaCover series={c} width={collage.length > 2 ? 72 : 90} radius={8} />
                </View>
              ))}
            </View>
            <View style={styles.grid}>
              {[
                { v: mix ? bigTime(mix.totalMs) : bigTime(y.ms), l: mix ? 'videos + manga' : 'reading' },
                { v: y.chapters.toLocaleString(), l: 'chapters' },
                { v: String(y.titles), l: 'titles' },
                { v: String(st.calendar.filter((c) => c.v > 0).length || y.days), l: 'days' },
              ].map((g) => (
                <View key={g.l} style={styles.gridCell}>
                  <Text style={styles.gridValue} numberOfLines={1} adjustsFontSizeToFit>
                    {g.v}
                  </Text>
                  <Text style={styles.gridLabel}>{g.l}</Text>
                </View>
              ))}
            </View>
            {mix && <GrowBar share={mix.readShare} track="rgba(255,255,255,0.25)" color="#FF375F" />}
            {one && <Text style={styles.snapLine} numberOfLines={1}>#1 {one.s.title}</Text>}
            {w.genres[0] && <Text style={styles.snapLine2}>Top genre: {w.genres[0].name}</Text>}
            {!mix && <Text style={styles.snapType}>{w.type.name}</Text>}
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
  }, [st, items, reads, range, videos, load, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <PageBankProvider value={bank}>
      <StoryDeck cards={cards} onClose={onClose} ambient={ambient} />
    </PageBankProvider>
  );
}

/** Whether a chapter's pages can be shown without changing the library: on the phone, or from a source that serves them as is. */
function reachable(ser: MangaUiSeries, ch: MangaChapter): boolean {
  if (ch.folder && ch.pages.length) return true;
  // A title from a backup, or a server title that needs repairing first: the cover is all there is.
  if (!ser.sourceId || ser.sourceId.startsWith('tachi:')) return false;
  if (/^server:.*:library$/.test(ser.sourceId) && !/^\d+$/.test(ch.sourceKey ?? '')) return false;
  return true;
}

const makeStyles = () =>
  sheet({
    chapterJp: { color: 'rgba(255,255,255,0.35)', fontSize: 64, fontWeight: '900', letterSpacing: 4, marginVertical: -4 },
    rule: { height: 3, width: 64, backgroundColor: '#fff', borderRadius: 2, marginVertical: 4 },
    count: { color: '#fff', fontSize: 96, fontWeight: '900', letterSpacing: -4, lineHeight: 100 },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 18, padding: 12 },
    addIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
    addText: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '800', lineHeight: 23 },
    quizGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginTop: 8 },
    quizCell: { borderRadius: 14, borderWidth: 3, borderColor: 'transparent' },
    quizRight: { borderColor: '#30D158' },
    quizWrong: { borderColor: '#FF453A' },
    quizBadge: { position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: '#30D158', alignItems: 'center', justifyContent: 'center' },
    quizResult: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' },
    monthsRow: { flexDirection: 'row', alignItems: 'flex-end', height: 180, marginTop: 14 },
    monthCell: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
    monthLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '900' },
    vsHead: { flexDirection: 'row', justifyContent: 'space-between' },
    mileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 14, padding: 8, paddingRight: 12 },
    mileN: { color: '#FFD60A', fontSize: 20, fontWeight: '900', minWidth: 62 },
    mileTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
    mileDate: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
    vsLabel: { color: '#fff', fontSize: 17, fontWeight: '800' },
    vsValue: { fontSize: 15, fontWeight: '900' },
    rangeTitle: { color: '#fff', fontWeight: '900', letterSpacing: -2 },
    typeName: { color: '#fff', fontSize: 54, fontWeight: '900', letterSpacing: -2, lineHeight: 58 },
    tbc: { color: '#fff', fontSize: 46, fontWeight: '900', fontStyle: 'italic', letterSpacing: -1.5, lineHeight: 50 },
    thumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.3)' },
    thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
    snap: { borderRadius: 28, padding: 20, gap: 12, backgroundColor: '#141416', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
    snapGlow: { position: 'absolute', right: -80, top: -80, width: 240, height: 240, borderRadius: 120, backgroundColor: '#FF375F', opacity: 0.35 },
    snapKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '900', letterSpacing: 1.3 },
    collage: { flexDirection: 'row', alignItems: 'center', paddingLeft: 6, marginVertical: 4 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    gridCell: { width: '48%', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: 10 },
    gridValue: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: -1 },
    gridLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '800' },
    snapLine: { color: '#fff', fontSize: 16, fontWeight: '800' },
    snapLine2: { color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '700', marginTop: -6 },
    snapType: { color: '#FF375F', fontSize: 18, fontWeight: '900' },
    snapBrand: { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '800' },
    share: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
    shareText: { color: '#000', fontSize: 15, fontWeight: '800' },
  });
