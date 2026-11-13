/**
 * Books Wrapped: a story of a year (or any stretch) of reading. Behind every
 * card is your book itself: its own sentences set large and drifting past,
 * or its cover. Cards: the year, time spent, month by month, the book of
 * the year, the rest of the top, finished books, books' worth, the longest
 * sitting, when you read, your best run of days, what kind of reader you
 * are, and what comes next.
 * Presentational only (see the note at the top of types.ts).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { displayTitle, fmtProgress, progressOf, type BookRead } from '../../books/bookLogic';
import { bookWrapped, fmtTime, readerKind, type PartOfDay } from '../../books/bookStats';
import { ClockDial, StreakChain } from '../manga/mangaKit';
import { useReducedMotion } from '../motion';
import { useWindowDimensions } from '../screen';
import { StoryDeck, useStoryText, type DeckCard } from '../storyDeck';
import { CountUp, GrowColumn, Tilt } from '../storyKit';
import type { BookUi } from './bookTypes';

const SERIF = Platform.select({ ios: 'Charter', web: 'Charter, Georgia, serif', default: 'serif' });

/** Deep inks, one per card in turn: oxblood, ink blue, bottle green, walnut, plum. */
const INKS: [string, string][] = [
  ['#7A2A1E', '#1A0907'],
  ['#1E3A57', '#060E17'],
  ['#1F4A35', '#06130D'],
  ['#5C4126', '#140D06'],
  ['#4D2447', '#12060F'],
];

const PART_WORDS: Record<PartOfDay, string> = { morning: 'in the morning', afternoon: 'in the afternoon', evening: 'in the evening', night: 'late at night' };
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** The book's own sentences, set large and drifting slowly up the card. */
function PassageScene({ paras, ink, seed }: { paras: string[]; ink: [string, string]; seed: number }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    y.value = withRepeat(withTiming(-height * 0.5, { duration: 26_000, easing: Easing.linear }), -1, true);
  }, [reduce, height]); // eslint-disable-line react-hooks/exhaustive-deps
  const drift = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const text = paras.length ? [...paras.slice(seed % paras.length), ...paras.slice(0, seed % paras.length)].join('  ') : '';
  const size = 30 + (seed % 3) * 6;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: ink[1], overflow: 'hidden' }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: ink[0], opacity: 0.55 }]} />
      {!!text && (
        <Animated.Text
          style={[
            { position: 'absolute', top: height * 0.08, left: -width * 0.04, width: width * 1.08, color: 'rgba(255,255,255,0.11)', fontFamily: SERIF, fontSize: size, lineHeight: Math.round(size * 1.32) },
            seed % 2 ? { fontStyle: 'italic' } : null,
            drift,
          ]}>
          {text}
        </Animated.Text>
      )}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.28)' }]} />
    </View>
  );
}

/** A cover, large and slightly turned, over the book's text. */
function CoverScene({ book, paras, ink, seed }: { book: BookUi; paras: string[]; ink: [string, string]; seed: number }) {
  const { width } = useWindowDimensions();
  const w = Math.min(260, width * 0.62);
  return (
    <View style={StyleSheet.absoluteFill}>
      <PassageScene paras={paras} ink={ink} seed={seed} />
      {book.coverUri && (
        <View style={{ position: 'absolute', right: -w * 0.18, top: '12%', opacity: 0.85 }}>
          <Tilt rotate={6}>
            <Image source={{ uri: book.coverUri }} style={{ width: w, height: w * 1.5, borderRadius: 4 }} contentFit="cover" />
          </Tilt>
        </View>
      )}
    </View>
  );
}

export default function BookWrapped({
  books: shelf,
  reads,
  start,
  end,
  label,
  prevStart,
  passage,
  onClose,
}: {
  books: BookUi[];
  reads: BookRead[];
  start: number;
  end: number;
  /** "2026", "November", "This week". */
  label: string;
  prevStart?: number;
  passage: (id: string) => Promise<string[]>;
  onClose: () => void;
}) {
  const s = useStoryText();
  // Private books never appear in a Wrapped, unlocked or not.
  const books = useMemo(() => shelf.filter((b) => !b.isPrivate), [shelf]);
  const byId = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const w = useMemo(() => bookWrapped(books, reads, start, end, prevStart), [books, reads, start, end, prevStart]);
  const topBook = w.top[0] ? byId.get(w.top[0].id) : undefined;

  // Sentences from the book you read most (else the one you are reading) for the backgrounds.
  const [paras, setParas] = useState<string[]>([]);
  const source = topBook ?? books.find((b) => b.lastReadAt && !b.finishedAt) ?? books[0];
  useEffect(() => {
    if (!source) return;
    let live = true;
    passage(source.id)
      .then((p) => live && setParas(p))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [source?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ambient = useCallback(
    (card: DeckCard, i: number) => {
      const ink = card.colors;
      // Every third card shows a cover you read, when there is one.
      const withCover = w.top.map((t) => byId.get(t.id)).filter((b): b is BookUi => !!b?.coverUri);
      if (i % 3 === 1 && withCover.length) return <CoverScene book={withCover[i % withCover.length]} paras={paras} ink={ink} seed={i} />;
      return <PassageScene paras={paras} ink={ink} seed={i} />;
    },
    [paras, w, byId]
  );

  const cards = useMemo<DeckCard[]>(() => {
    const out: DeckCard[] = [];
    let n = 0;
    const ink = () => INKS[n++ % INKS.length];
    const yearLike = /^\d{4}$/.test(label);
    const span = yearLike ? 'this year' : label === 'All time' ? 'so far' : `in ${label.toLowerCase().startsWith('this') || label.toLowerCase().startsWith('last') ? label.toLowerCase() : label}`;

    out.push({
      key: 'intro',
      colors: ink(),
      ms: 5200,
      body: (
        <>
          {s.kicker('BOOKS WRAPPED', 0)}
          {s.huge(label, 1)}
          {s.line(w.ms ? `${fmtTime(w.ms)} of reading, ${plural(w.top.length, 'book')}, ${plural(w.days, 'day')}.` : 'No reading here yet. Open a book and come back.', 2)}
        </>
      ),
    });
    if (!w.ms) return out;

    const change = w.prevMs > 0 ? Math.round(((w.ms - w.prevMs) / w.prevMs) * 100) : null;
    const before = yearLike ? 'last year' : end - start > 40 * 86_400_000 ? 'before' : end - start > 8 * 86_400_000 ? 'last month' : 'last week';
    out.push({
      key: 'time',
      colors: ink(),
      ms: 6500,
      body: (
        <>
          {s.kicker('YOU READ FOR', 0)}
          <CountUp to={w.ms / 60_000} format={(m) => (m >= 120 ? `${Math.round(m / 60)} h` : `${Math.round(m)} min`)} style={styles.count} delay={300} ms={1600} />
          {s.line(`Over ${plural(w.days, 'day')}, in ${plural(w.sessions, 'sitting')}${w.averageSessionMs >= 60_000 ? ` of about ${fmtTime(w.averageSessionMs)}` : ''}.`, 2)}
          {change !== null && s.line(change === 0 ? `Exactly as much as ${before}.` : change > 0 ? `${change}% more than ${before}.` : `${-change}% less than ${before}.`, 3)}
        </>
      ),
    });

    const barMax = Math.max(1, ...w.bars.map((b) => b.ms));
    if (w.bars.filter((b) => b.ms > 0).length >= 2) {
      const best = w.bars.reduce((a, b) => (b.ms > a.ms ? b : a));
      out.push({
        key: 'bars',
        colors: ink(),
        ms: 6500,
        body: (
          <>
            {s.kicker(w.bars.length > 7 ? 'MONTH BY MONTH' : 'DAY BY DAY', 0)}
            {s.big(w.bars.length > 7 ? `${best.label} was your biggest month.` : 'Your week, day by day.', 1)}
            <View style={styles.cols}>
              {w.bars.map((b, i) => (
                <View key={`${b.label}${i}`} style={styles.col}>
                  <View style={styles.colBox}>
                    <GrowColumn ratio={b.ms / barMax} height={150} width="70%" delay={300 + i * 60} color={b === best ? '#fff' : 'rgba(255,255,255,0.45)'} radius={3} />
                  </View>
                  <Text style={styles.colLabel}>{b.label.slice(0, 1)}</Text>
                </View>
              ))}
            </View>
          </>
        ),
      });
    }

    if (topBook && w.top[0]) {
      const t = w.top[0];
      out.push({
        key: 'top1',
        colors: ink(),
        ms: 7500,
        cheer: true,
        body: (
          <>
            {s.kicker(yearLike ? 'YOUR BOOK OF THE YEAR' : 'YOUR BOOK', 0)}
            <Text style={styles.bookTitle}>{displayTitle(topBook)}</Text>
            {!!topBook.author && s.line(topBook.author, 2)}
            {s.line(`${fmtTime(t.ms)} with it ${span}${t.gained >= 0.02 ? `, ${Math.round(t.gained * 100)}% of the book` : ''}.`, 3)}
            {s.line(topBook.finishedAt ? 'Finished.' : `${fmtProgress(progressOf(topBook), true)} of the way through now.`, 4)}
          </>
        ),
      });
    }

    if (w.top.length > 1) {
      const max = w.top[0].ms;
      out.push({
        key: 'top',
        colors: ink(),
        ms: 7000,
        body: (
          <>
            {s.kicker('MOST READ', 0)}
            {s.bars(
              w.top.map((t) => ({ label: byId.get(t.id) ? displayTitle(byId.get(t.id)!) : 'A book', share: t.ms / max, sub: fmtTime(t.ms) })),
              1
            )}
          </>
        ),
      });
    }

    if (w.finished.length) {
      out.push({
        key: 'finished',
        colors: ink(),
        ms: 7000,
        cheer: true,
        body: (
          <>
            {s.kicker(w.finished.length === 1 ? 'YOU FINISHED' : `YOU FINISHED ${w.finished.length} BOOKS`, 0)}
            {w.finished.slice(0, 6).map((f, i) => {
              const b = byId.get(f.id);
              return s.line(`${b ? displayTitle(b) : 'A book'}, ${new Date(f.at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`, 1 + i);
            })}
          </>
        ),
      });
    } else {
      const now = books.find((b) => b.lastReadAt && !b.finishedAt);
      if (now)
        out.push({
          key: 'unfinished',
          colors: ink(),
          ms: 6000,
          body: (
            <>
              {s.kicker('STILL TURNING PAGES', 0)}
              {s.big(`${fmtProgress(progressOf(now), true)} into ${displayTitle(now)}.`, 1)}
              {s.line('No book finished here yet. The last page will keep.', 2)}
            </>
          ),
        });
    }

    if (w.booksWorth >= 0.3) {
      out.push({
        key: 'worth',
        colors: ink(),
        ms: 6000,
        body: (
          <>
            {s.kicker('ADDED UP', 0)}
            {s.big(w.booksWorth >= 1.05 ? `That's ${w.booksWorth} books' worth of pages.` : `That's ${Math.round(w.booksWorth * 100)}% of a whole book.`, 1)}
            {s.line('Counting every part of every book you got through.', 2)}
          </>
        ),
      });
    }

    if (w.longest && w.longest.ms >= 10 * 60_000) {
      const b = byId.get(w.longest.bookId);
      out.push({
        key: 'longest',
        colors: ink(),
        ms: 6000,
        body: (
          <>
            {s.kicker('YOUR LONGEST SITTING', 0)}
            {s.huge(fmtTime(w.longest.ms), 1)}
            {s.line(`${b ? displayTitle(b) : 'A book'}, on ${new Date(w.longest.at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}.`, 2)}
          </>
        ),
      });
    }

    if (w.partOfDay) {
      out.push({
        key: 'when',
        colors: ink(),
        ms: 7000,
        body: (
          <>
            {s.kicker('WHEN YOU READ', 0)}
            {s.big(`Mostly ${PART_WORDS[w.partOfDay]}.`, 1)}
            <View style={{ alignItems: 'center', marginTop: 16 }}>
              <ClockDial hours={w.hours} peak={w.peakHour} size={230} />
            </View>
          </>
        ),
      });
    }

    if (w.bestStreak >= 2) {
      out.push({
        key: 'streak',
        colors: ink(),
        ms: 6000,
        body: (
          <>
            {s.kicker('YOUR BEST RUN', 0)}
            {s.big(`${w.bestStreak} days in a row with a book.`, 1)}
            <StreakChain days={w.bestStreak} />
            {w.busiestDay && s.line(`Biggest day: ${new Date(w.busiestDay.at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}, ${fmtTime(w.busiestDay.ms)}.`, 3)}
          </>
        ),
      });
    }

    const kind = readerKind(w);
    out.push({
      key: 'kind',
      colors: ink(),
      ms: 6000,
      body: (
        <>
          {s.kicker('YOU ARE A', 0)}
          {s.big(kind.name, 1)}
          {s.line(kind.line, 2)}
        </>
      ),
    });

    const next = books.find((b) => b.lastReadAt && !b.finishedAt) ?? books.find((b) => !b.lastReadAt);
    out.push({
      key: 'next',
      colors: ink(),
      ms: 5500,
      body: (
        <>
          {s.kicker('NEXT', 0)}
          {s.big(next ? displayTitle(next) : 'A new book', 1)}
          {s.line(next ? (next.lastReadAt ? `${fmtProgress(progressOf(next), true)} read. It's where you left it.` : 'Waiting on your shelf.') : 'Add one in Books when you are ready.', 2)}
        </>
      ),
    });
    return out;
  }, [w, byId, books, topBook, label, s]);

  return <StoryDeck cards={cards} onClose={onClose} ambient={ambient} />;
}

const styles = StyleSheet.create({
  count: { color: '#fff', fontSize: 92, fontWeight: '900', letterSpacing: -4, lineHeight: 98 },
  bookTitle: { color: '#fff', fontFamily: SERIF, fontSize: 40, lineHeight: 46, fontWeight: '700', marginVertical: 6 },
  cols: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 22, height: 176 },
  col: { flex: 1, alignItems: 'center', gap: 6 },
  colBox: { height: 150, width: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  colLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
});
