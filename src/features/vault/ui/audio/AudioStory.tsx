/**
 * The Audio Wrapped, told like an album: "now playing", then Side A (the
 * numbers), Side B (your favourites) and the bonus tracks (your habits), each
 * side opening with its track list like the back of a record sleeve.
 *
 * - Side A: guess your hours, your time counted up against the year before,
 *   what it adds up to (films, kilometres walked, full days, ten-hour books),
 *   your year day by day, month by month (and a guess).
 * - Side B: guess your #1, the top five counted down with each one spinning
 *   on a record, your #1, your author, the voice you heard most, genres, and
 *   audiobooks against everything else.
 * - Bonus tracks: a 24-hour clock of when you listen, your longest sitting,
 *   your streak, your biggest day, what was new to you, what you finished,
 *   your ratings, then vs now, badges, the kind of listener you are, and a
 *   card to share.
 * Behind every card a record spins or your covers flow (see scenes.tsx).
 * Presentational only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useVideoPlayer } from 'expo-video';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { displayTitle, fmtLength, fmtRating, type AudioPlay } from '../../audio/audioLogic';
import { audioWrapped } from '../../audio/audioWrapped';
import { canSnap, shareSnap } from '../../snap';
import { success, warn } from '../haptics';
import Icon from '../Icon';
import { BadgeGrid, ClockDial, GiantRank, Heatmap, RatingBars, StreakChain, TextQuiz } from '../manga/mangaKit';
import { Equalizer, ImageRiver, Tint, Vinyl } from '../scenes';
import { StoryDeck, useStoryText, type DeckCard } from '../storyDeck';
import { Backdrop } from '../frame';
import { Confetti, CountUp, CoverWall, GrowBar, GrowColumn, KenBurns, Rays, Tilt } from '../storyKit';
import { sheet, useStyles } from '../theme';
import AudioCover from './AudioCover';
import { useAudioPlaybackOptional } from './playback';
import type { AudioUiItem } from './audioTypes';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const hourLabel = (h: number) => new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
const longDay = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const bigTime = (ms: number) => (ms >= 36_000_000 ? `${Math.round(ms / 3_600_000)} h` : fmtLength(ms));
const PART = {
  morning: { name: 'A morning listener', line: 'Your day starts with a story.' },
  afternoon: { name: 'An afternoon listener', line: 'Afternoons were for listening.' },
  evening: { name: 'An evening listener', line: 'Evenings were your time to listen.' },
  night: { name: 'A night listener', line: 'More after 10 pm than at any other time.' },
} as const;
const TYPE_COLORS: Record<string, [string, string]> = {
  marathon: ['#FF453A', '#2B0705'],
  night: ['#5E5CE6', '#0B0A26'],
  commuter: ['#30D158', '#05210E'],
  devoted: ['#FF375F', '#2B0612'],
  finisher: ['#FFD60A', '#2E2400'],
  collector: ['#64D2FF', '#03202B'],
  steady: ['#BF5AF2', '#1C0533'],
};

/** Guess your #1: four covers, tap one. */
function CoverQuiz({ options, answer }: { options: AudioUiItem[]; answer: string }) {
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
              accessibilityLabel={displayTitle(o)}>
              <AudioCover item={o} size={118} radius={14} />
            </TouchableOpacity>
          );
        })}
      </View>
      {picked !== null && (
        <Animated.Text entering={ZoomIn} style={styles.quizResult}>
          {picked === answer ? 'Right. That one was on repeat.' : `Not quite. It was ${right ? displayTitle(right) : 'another one'}.`}
        </Animated.Text>
      )}
    </View>
  );
}

export function AudioWrapped({ items, plays, year, onClose }: { items: AudioUiItem[]; plays: AudioPlay[]; year: number; onClose: () => void }) {
  const s = useStoryText();
  const styles = useStyles(makeStyles);
  const snapRef = useRef<View>(null);
  const [now] = useState(() => Date.now());
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const data = useMemo(() => audioWrapped(items, plays, start, end, now, new Date(year - 1, 0, 1).getTime()), [items, plays, start, end, now, year]);

  // Behind every card: a record spinning with one of your top covers as its label, or your covers flowing past.
  const sceneCovers = useMemo(() => {
    const ranked = data.top.map((t) => byId.get(t.id)?.coverSource).filter(Boolean);
    const rest = items.map((i) => i.coverSource).filter(Boolean);
    return [...new Set([...ranked, ...rest])].slice(0, 18) as NonNullable<AudioUiItem['coverSource']>[];
  }, [data, items, byId]);
  const labels = useMemo(() => data.top.map((t) => (byId.get(t.id)?.title ?? '♪').trim()[0]?.toUpperCase() ?? '♪'), [data, byId]);
  // Behind every card: your covers themselves, never a plain colour. A cover whole over a blurred copy
  // of itself, a record spinning with the cover as its label (over the same cover, blurred), or your
  // covers flowing by over an equaliser.
  const ambient = useCallback(
    (card: DeckCard, i: number) => {
      const cover = sceneCovers.length ? sceneCovers[i % Math.min(6, sceneCovers.length)] : undefined;
      const v = i % 3;
      if (v === 1 && sceneCovers.length >= 3)
        return (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
            <ImageRiver sources={sceneCovers} columns={3} aspect={1} tilt={-10} speed={0.9} />
            <Equalizer color="#fff" />
          </View>
        );
      if (v === 0 && cover) return <KenBurns source={cover} ms={9000} seed={i} />;
      return (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
          {cover && <Backdrop source={cover} dim={0.2} />}
          <Vinyl cover={cover} label={labels[i % Math.max(1, labels.length)] ?? '♪'} accent={card.colors[0]} />
        </View>
      );
    },
    [sceneCovers, labels]
  );

  // A random part of your top titles plays behind the cards (a different one every card), fading in.
  const [muted, setMuted] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.volume = 0;
  });
  useEffect(() => {
    const top = data.top.map((t) => byId.get(t.id)).filter((x): x is AudioUiItem => !!x && x.trackUris.length > 0);
    if (!top.length) return;
    const it = top[cardIndex % top.length];
    const track = it.trackUris.length > 1 ? (cardIndex * 7) % it.trackUris.length : 0;
    const frac = 0.15 + ((cardIndex * 37) % 60) / 100;
    let live = true;
    let fade: ReturnType<typeof setInterval> | null = null;
    player.volume = 0;
    player
      .replaceAsync({ uri: it.trackUris[track] })
      .then(() => {
        if (!live) return;
        if (player.duration > 0) player.currentTime = player.duration * frac;
        player.play();
        let v = 0;
        fade = setInterval(() => {
          v = Math.min(0.85, v + 0.08);
          player.volume = v;
          if (v >= 0.85 && fade) clearInterval(fade);
        }, 50);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (fade) clearInterval(fade);
    };
  }, [cardIndex, data, byId, player]);
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);
  // Your own audiobook pauses while the story plays its snippets, and carries on when the story closes.
  const app = useAudioPlaybackOptional();
  const appRef = useRef(app);
  appRef.current = app;
  useEffect(() => {
    const was = appRef.current?.playing ?? false;
    if (was) appRef.current?.pause();
    return () => {
      if (was) appRef.current?.resume();
    };
  }, []);
  // Holding the screen pauses the story: the snippet pauses with it.
  const onPaused = useCallback(
    (p: boolean) => {
      try {
        if (p) player.pause();
        else player.play();
      } catch {
        // released while closing
      }
    },
    [player]
  );


  const cards = useMemo<DeckCard[]>(() => {
    const w = data;
    const get = (id: string | null | undefined) => (id ? byId.get(id) : undefined);
    const top = w.top.map((t) => ({ ...t, item: get(t.id)! })).filter((t) => t.item);
    const covers = items.map((i) => i.coverSource ?? undefined).filter(Boolean) as string[];
    const out: DeckCard[] = [];

    /** A side's title page: its track list, like the back of a record sleeve. */
    const side = (name: string, title: string, tracks: string[], colors: [string, string]) =>
      out.push({
        key: `side-${name}`,
        colors,
        ms: 4200,
        backdrop: <Rays size={1300} count={40} opacity={0.08} />,
        body: (
          <>
            {s.kicker(name, 0)}
            {s.big(title, 1)}
            <View style={styles.tracks}>
              {tracks.map((t, n) => (
                <Animated.View key={t} entering={s.enter(2 + n)} style={styles.track}>
                  <Text style={styles.trackNo}>{String(n + 1).padStart(2, '0')}</Text>
                  <Text style={styles.trackName} numberOfLines={1}>
                    {t}
                  </Text>
                  <View style={styles.trackDots} />
                </Animated.View>
              ))}
            </View>
          </>
        ),
      });

    out.push({
      key: 'intro',
      colors: ['#BF5AF2', '#1E0730'],
      ms: 5200,
      backdrop: covers.length ? <CoverWall sources={covers} opacity={0.45} /> : undefined,
      body: (
        <>
          <View style={styles.nowPlaying}>
            <View style={styles.liveDot} />
            <Text style={styles.nowText}>NOW PLAYING</Text>
          </View>
          <Text style={styles.yearTitle}>{year}</Text>
          {s.line(w.ms ? `Your year in listening: ${fmtLength(w.ms)}, ${plural(w.titles, 'title')}, ${plural(w.days, 'day')}.` : 'Nothing listened to yet this year. Press play and come back.', 2)}
        </>
      ),
    });
    if (!w.ms) return out;

    /* ------------------------------------------------------------- side A */
    side('SIDE A', 'The Numbers', ['How long', 'What it adds up to', 'Day by day', 'Month by month'], ['#0A84FF', '#020B1C']);

    const hq = w.quizzes.find((q) => q.key === 'hours');
    if (hq) {
      out.push({
        key: 'q-hours',
        colors: ['#5E5CE6', '#0D0B2E'],
        ms: 15000,
        interactive: true,
        body: (
          <>
            {s.kicker('QUICK QUESTION', 0)}
            {s.big(hq.question, 1)}
            <TextQuiz options={hq.options} answer={hq.answer} reveal={(r) => (r ? 'Spot on.' : `It was ${hq.options[hq.answer]}.`)} />
          </>
        ),
      });
    }

    const change = w.prev.ms > 0 ? Math.round(((w.ms - w.prev.ms) / w.prev.ms) * 100) : null;
    out.push({
      key: 'time',
      colors: ['#0A84FF', '#03142B'],
      ms: 6500,
      body: (
        <>
          {s.kicker('YOU LISTENED FOR', 0)}
          <CountUp to={w.ms / 60_000} format={(m) => (m >= 120 ? `${Math.round(m / 60)} h` : `${Math.round(m)} min`)} style={styles.count} delay={300} ms={1600} />
          {s.line(`${plural(w.days, 'day')}, ${plural(w.sessions, 'sitting')}${w.averageSessionMs >= 60_000 ? ` of about ${fmtLength(w.averageSessionMs)}` : ''}.`, 2)}
          {change !== null && s.line(change === 0 ? 'Just like the year before.' : change > 0 ? `${change}% more than the year before. ↑` : `${-change}% less than the year before.`, 3)}
        </>
      ),
    });

    const rows: { icon: 'film' | 'person' | 'sun' | 'book'; text: string }[] = [];
    if (w.adds.films >= 1) rows.push({ icon: 'film', text: `${w.adds.films >= 10 ? Math.round(w.adds.films) : w.adds.films} films back to back` });
    if (w.adds.walkKm >= 2) rows.push({ icon: 'person', text: `${w.adds.walkKm} km, if you walked while you listened` });
    if (w.adds.fullDays >= 1) rows.push({ icon: 'sun', text: `${w.adds.fullDays} days and nights without a break` });
    if (w.adds.booksOf10h >= 1) rows.push({ icon: 'book', text: `${w.adds.booksOf10h} ten-hour audiobooks` });
    if (rows.length) {
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

    if (w.calendar.length >= 7) {
      out.push({
        key: 'calendar',
        colors: ['#30D158', '#041A0B'],
        ms: 6500,
        body: (
          <>
            {s.kicker('YOUR YEAR, DAY BY DAY', 0)}
            {s.big(`${w.days} of ${w.calendar.length} days`, 1)}
            <Heatmap calendar={w.calendar} year={w.calendar.length > 45} color="#64D2FF" />
            {s.line(w.days / w.calendar.length >= 0.5 ? 'More days with a story than without.' : 'Every minute counts.', 3)}
          </>
        ),
      });
    }

    const mq = w.quizzes.find((q) => q.key === 'month');
    if (mq) {
      out.push({
        key: 'q-month',
        colors: ['#FF9F0A', '#2B1500'],
        ms: 14000,
        interactive: true,
        body: (
          <>
            {s.kicker('QUICK QUESTION', 0)}
            {s.big(mq.question, 1)}
            <TextQuiz options={mq.options} answer={mq.answer} reveal={(r) => (r ? 'Right!' : `It was ${mq.options[mq.answer]}.`)} />
          </>
        ),
      });
    }
    if (w.months.some((v) => v > 0)) {
      const max = Math.max(1, ...w.months);
      const best = w.months.indexOf(Math.max(...w.months));
      out.push({
        key: 'months',
        colors: ['#30D158', '#05210E'],
        ms: 6000,
        body: (
          <>
            {s.kicker('MONTH BY MONTH', 0)}
            {s.big(`${MONTHS[best]} was loudest`, 1)}
            <View style={styles.monthsRow}>
              {w.months.map((v, m) => (
                <View key={m} style={styles.monthCell}>
                  <GrowColumn ratio={v / max} height={150} width="72%" delay={200 + m * 60} color={m === best ? '#FFD60A' : '#fff'} radius={4} />
                  <Text style={[styles.monthLabel, m === best && { color: '#FFD60A' }]}>{MONTHS[m][0]}</Text>
                </View>
              ))}
            </View>
            {s.line(`${fmtLength(w.months[best])} in ${MONTHS[best]}.`, 3)}
          </>
        ),
      });
    }

    /* ------------------------------------------------------------- side B */
    if (top.length) side('SIDE B', 'Your Favourites', ['Guess your #1', 'The countdown', 'Your #1', 'The people behind it'], ['#FF375F', '#1E0410']);

    const pool = top.map((t) => t.item);
    if (pool.length >= 3) {
      const opts = [...pool.slice(0, 4)].sort((a, b) => a.id.localeCompare(b.id));
      out.push({
        key: 'q-top',
        colors: ['#BF5AF2', '#1C0533'],
        ms: 15000,
        interactive: true,
        body: (
          <>
            {s.kicker('BEFORE THE COUNTDOWN', 0)}
            {s.big('Which one did you play the most?', 1)}
            <CoverQuiz options={opts} answer={top[0].id} />
          </>
        ),
      });
    }

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
            {/* Its own cover behind it (blurred), its record spinning: no colour wash. */}
            <Backdrop source={t.item.coverSource ?? undefined} dim={0.25} />
            <Vinyl cover={t.item.coverSource ?? undefined} label={(t.item.title ?? '♪').trim()[0]?.toUpperCase()} accent={rankColors[(5 - r) % rankColors.length][0]} />
          </>
        ),
        body: (
          <>
            <GiantRank n={r} />
            {s.kicker(`NUMBER ${r}`, 0)}
            <Tilt rotate={r % 2 ? -4 : 4} delay={150}>
              <AudioCover item={t.item} size={140} radius={16} />
            </Tilt>
            {s.big(displayTitle(t.item), 2)}
            {s.line([t.item.author, fmtLength(t.ms), plural(t.sessions, 'sitting')].filter(Boolean).join(' · '), 3)}
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
            <Backdrop source={one.item.coverSource ?? undefined} dim={0.25} />
            <Vinyl cover={one.item.coverSource ?? undefined} label={(one.item.title ?? '♪').trim()[0]?.toUpperCase()} accent="#FFD60A" />
            <View style={{ position: 'absolute', alignSelf: 'center', top: '18%' }}>
              <Rays size={1000} color="#FFD60A" opacity={0.18} />
            </View>
          </>
        ),
        body: (
          <>
            {s.kicker(`YOUR #1 OF ${year}`, 0)}
            <Tilt rotate={-3} delay={200}>
              <AudioCover item={one.item} size={190} radius={20} />
            </Tilt>
            {s.big(displayTitle(one.item), 2)}
            {s.line(`${fmtLength(one.ms)}: ${Math.round(one.share * 100)}% of all your listening${one.item.rating ? `, rated ${fmtRating(one.item.rating)}` : ''}.`, 3)}
            {one.bestDay && one.bestDay.ms >= 30 * 60_000 && s.line(`Your big day with it: ${fmtLength(one.bestDay.ms)} on ${longDay(one.bestDay.day)}.`, 4)}
            <Confetti />
          </>
        ),
      });
    }

    if (w.author) {
      out.push({
        key: 'author',
        colors: ['#FF9F0A', '#2B1500'],
        ms: 5500,
        body: (
          <>
            {s.kicker('YOUR AUTHOR', 0)}
            {s.big(w.author.name, 1)}
            {s.line(`${fmtLength(w.author.ms)}${w.author.titles > 1 ? ` across ${w.author.titles} of their titles` : ''}.`, 2)}
          </>
        ),
      });
    }
    if (w.narrator) {
      out.push({
        key: 'narrator',
        colors: ['#64D2FF', '#03202B'],
        ms: 5500,
        body: (
          <>
            {s.kicker('THE VOICE IN YOUR EARS', 0)}
            {s.big(w.narrator.name, 1)}
            {s.line(`You heard them for ${fmtLength(w.narrator.ms)}${w.narrator.titles > 1 ? `, in ${w.narrator.titles} titles` : ''}.`, 2)}
            <View style={{ height: 70, marginTop: 10 }}>
              <Equalizer color="#fff" bars={22} />
            </View>
          </>
        ),
      });
    }
    if (w.genres.length) {
      const most = Math.max(1, ...w.genres.map((g) => g.ms));
      out.push({
        key: 'genres',
        colors: ['#BF5AF2', '#1C0533'],
        ms: 5800,
        body: (
          <>
            {s.kicker(w.genres.length > 1 ? 'YOUR TOP GENRES' : 'YOUR GENRE', 0)}
            {s.big(w.genres[0].name, 1)}
            {w.genres.length > 1 && s.bars(w.genres.map((g, i) => ({ label: `${i + 1}. ${g.name}`, share: g.ms / most, sub: fmtLength(g.ms) })), 2)}
          </>
        ),
      });
    }
    if (w.books.ms > 0 && w.books.share < 0.999) {
      out.push({
        key: 'books',
        colors: ['#0A84FF', '#03142B'],
        ms: 5000,
        body: (
          <>
            {s.kicker('BOOKS OR EVERYTHING ELSE', 0)}
            {s.big(w.books.share >= 0.5 ? 'Mostly audiobooks' : 'Mostly other audio', 1)}
            {s.bars(
              [
                { label: 'Audiobooks', share: w.books.share, sub: fmtLength(w.books.ms) },
                { label: 'Everything else', share: 1 - w.books.share, sub: fmtLength(w.ms - w.books.ms) },
              ],
              2
            )}
          </>
        ),
      });
    }

    /* ------------------------------------------------------- bonus tracks */
    side('BONUS TRACKS', 'Your Habits', ['When you listen', 'Your longest sitting', 'Your streak', 'What you finished'], ['#5E5CE6', '#090820']);

    if (w.partOfDay) {
      out.push({
        key: 'clock',
        colors: w.partOfDay === 'night' ? ['#1C1A4A', '#04030F'] : ['#FF9F0A', '#2B1500'],
        ms: 7000,
        body: (
          <>
            {s.kicker('WHEN YOU LISTEN', 0)}
            {s.big(PART[w.partOfDay].name, 1)}
            <View style={{ marginVertical: 18 }}>
              <ClockDial hours={w.hours} peak={w.peakHour} size={240} />
            </View>
            {w.peakHour !== null && s.line(`Peak hour: around ${hourLabel(w.peakHour)}.${w.weekday ? ` ${WEEKDAYS[w.weekday.day]}s were your day.` : ''}`, 3)}
          </>
        ),
      });
    }
    const longItem = get(w.longest?.id);
    if (w.longest && w.longest.ms >= 15 * 60_000) {
      out.push({
        key: 'sitting',
        colors: ['#FF453A', '#2B0705'],
        ms: 6000,
        body: (
          <>
            {s.kicker('YOUR LONGEST SITTING', 0)}
            {s.huge(fmtLength(w.longest.ms), 1)}
            {longItem && (
              <View style={styles.chip}>
                <AudioCover item={longItem} size={40} radius={8} />
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.chipTitle} numberOfLines={1}>
                    {displayTitle(longItem)}
                  </Text>
                  <Text style={styles.chipSub}>{longDay(w.longest.at)}</Text>
                </View>
              </View>
            )}
            {s.line(w.longest.ms >= 3 * 3_600_000 ? 'You never pressed pause.' : w.longest.ms >= 3_600_000 ? 'One more chapter. And another.' : 'A good long listen.', 3)}
          </>
        ),
      });
    }
    if (w.streak >= 2) {
      out.push({
        key: 'streak',
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
    if (w.biggestDay && w.biggestDay.ms >= 30 * 60_000) {
      out.push({
        key: 'bigday',
        colors: ['#FF375F', '#2B0612'],
        ms: 5000,
        body: (
          <>
            {s.kicker('YOUR BIGGEST DAY', 0)}
            {s.big(longDay(w.biggestDay.day), 1)}
            {s.line(`${fmtLength(w.biggestDay.ms)} of listening in one day.`, 2)}
          </>
        ),
      });
    }
    const started = w.started.map((id) => get(id)).filter((x): x is AudioUiItem => !!x);
    if (started.length) {
      out.push({
        key: 'started',
        colors: ['#64D2FF', '#03202B'],
        ms: 6000,
        body: (
          <>
            {s.kicker('NEW TO YOU', 0)}
            {s.huge(String(started.length), 1)}
            {s.line(`${started.length === 1 ? 'title' : 'titles'} you pressed play on for the first time.`, 2)}
            <View style={styles.fan}>
              {started.slice(0, 6).map((it, i, arr) => (
                <View key={it.id} style={{ position: 'absolute', transform: [{ translateX: (i - (arr.length - 1) / 2) * 44 }] }}>
                  <Tilt rotate={(i - (arr.length - 1) / 2) * 7} delay={150 + i * 110}>
                    <AudioCover item={it} size={96} radius={12} />
                  </Tilt>
                </View>
              ))}
            </View>
          </>
        ),
      });
    }
    const finished = w.finished.map((id) => get(id)).filter((x): x is AudioUiItem => !!x);
    if (finished.length) {
      out.push({
        key: 'finished',
        colors: ['#30D158', '#05210E'],
        ms: 6000,
        cheer: finished.length >= 3,
        body: (
          <>
            {s.kicker('HEARD TO THE LAST WORD', 0)}
            {s.big(`${plural(finished.length, 'title')} finished`, 1)}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              {finished.slice(0, 8).map((it, i) => (
                <Animated.View key={it.id} entering={ZoomIn.delay(200 + i * 120).springify()}>
                  <AudioCover item={it} size={70} radius={10} />
                  <View style={styles.tick}>
                    <Icon name="check" size={12} color="#fff" weight="bold" />
                  </View>
                </Animated.View>
              ))}
            </View>
          </>
        ),
      });
    }
    if (w.ratings.rated >= 3) {
      out.push({
        key: 'ratings',
        colors: ['#FFD60A', '#2E2400'],
        ms: 6000,
        body: (
          <>
            {s.kicker('YOUR RATINGS', 0)}
            {s.big(`★ ${w.ratings.average} on average`, 1)}
            <RatingBars histogram={w.ratings.histogram} />
          </>
        ),
      });
    }
    if (w.prev.ms > 0) {
      const rowsV = [
        { label: 'Time', now: w.ms, then: w.prev.ms, fmt: (v: number) => (v ? fmtLength(v) : '0 min') },
        { label: 'Days', now: w.days, then: w.prev.days, fmt: String },
        { label: 'Titles', now: w.titles, then: w.prev.titles, fmt: String },
      ];
      out.push({
        key: 'thenvsnow',
        colors: ['#0A84FF', '#03142B'],
        ms: 6500,
        body: (
          <>
            {s.kicker(`${year} VS THIS TIME IN ${year - 1}`, 0)}
            {s.big(w.ms >= w.prev.ms ? 'You listened more' : 'A quieter year', 1)}
            <View style={{ gap: 14, marginTop: 8 }}>
              {rowsV.map((r, i) => {
                const most = Math.max(1, r.now, r.then);
                return (
                  <Animated.View key={r.label} entering={s.enter(2 + i)} style={{ gap: 5 }}>
                    <View style={styles.vsHead}>
                      <Text style={styles.vsLabel}>{r.label}</Text>
                      <Text style={[styles.vsValue, { color: r.now >= r.then ? '#30D158' : '#FF9F0A' }]}>
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
    if (w.badges.length) {
      out.push({
        key: 'badges',
        colors: ['#FFD60A', '#231B00'],
        ms: 7000,
        cheer: true,
        body: (
          <>
            {s.kicker('BADGES EARNED', 0)}
            {s.big(w.badges.length === 1 ? 'One badge' : `${w.badges.length} badges`, 1)}
            <BadgeGrid badges={w.badges} />
          </>
        ),
      });
    }
    out.push({
      key: 'type',
      colors: TYPE_COLORS[w.type.key] ?? ['#BF5AF2', '#1C0533'],
      ms: 6500,
      cheer: true,
      backdrop: (
        <View style={{ position: 'absolute', alignSelf: 'center', top: '18%' }}>
          <Rays size={1100} color="#ffffff" opacity={0.14} />
        </View>
      ),
      body: (
        <>
          {s.kicker('ALL OF THAT MAKES YOU', 0)}
          <Animated.Text entering={ZoomIn.delay(250).springify().damping(12)} style={styles.typeName}>
            {w.type.name}
          </Animated.Text>
          {s.line(w.type.line, 2)}
          {w.badges.length > 0 && s.line(`With a touch of ${w.badges.slice(0, 2).map((b) => b.name).join(' and ')}.`, 3)}
        </>
      ),
    });

    const summary = `Audio Wrapped ${year}: ${fmtLength(w.ms)}, ${w.titles} titles, ${w.days} days. ${w.type.name}.${one ? ` #1: ${displayTitle(one.item)}.` : ''}`;
    out.push({
      key: 'end',
      colors: ['#1C1C1E', '#000000'],
      ms: 12000,
      interactive: true,
      body: (
        <>
          <View ref={snapRef} collapsable={false} style={styles.snap}>
            <View style={styles.snapGlow} />
            <Text style={styles.snapKicker}>AUDIO WRAPPED · {year}</Text>
            <View style={styles.collage}>
              {top.slice(0, 4).map((t, i) => (
                <View key={t.id} style={{ transform: [{ rotate: `${(i - 1.5) * 4}deg` }], marginLeft: i ? -16 : 0 }}>
                  <AudioCover item={t.item} size={72} radius={10} />
                </View>
              ))}
            </View>
            <View style={styles.grid}>
              {[
                { v: bigTime(w.ms), l: 'listening' },
                { v: String(w.titles), l: 'titles' },
                { v: String(w.days), l: 'days' },
                { v: String(w.finished.length), l: 'finished' },
              ].map((g) => (
                <View key={g.l} style={styles.gridCell}>
                  <Text style={styles.gridValue} numberOfLines={1} adjustsFontSizeToFit>
                    {g.v}
                  </Text>
                  <Text style={styles.gridLabel}>{g.l}</Text>
                </View>
              ))}
            </View>
            {one && (
              <Text style={styles.snapLine} numberOfLines={1}>
                #1 {displayTitle(one.item)}
              </Text>
            )}
            <Text style={styles.snapType}>{w.type.name}</Text>
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
  }, [data, items, byId, year]); // eslint-disable-line react-hooks/exhaustive-deps

  return <StoryDeck cards={cards} onClose={onClose} ambient={ambient} onIndex={setCardIndex} onPaused={onPaused} sound={{ muted, onToggle: () => setMuted((m) => !m) }} />;
}

const makeStyles = () =>
  sheet({
    nowPlaying: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#30D158' },
    nowText: { color: '#fff', fontSize: 12, fontWeight: '900', letterSpacing: 1.4 },
    yearTitle: { color: '#fff', fontSize: 96, fontWeight: '900', letterSpacing: -4, lineHeight: 100 },
    count: { color: '#fff', fontSize: 96, fontWeight: '900', letterSpacing: -4, lineHeight: 100 },
    tracks: { gap: 4, marginTop: 10, backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 18, padding: 14 },
    track: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
    trackNo: { color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: '900', fontVariant: ['tabular-nums'], width: 26 },
    trackName: { color: '#fff', fontSize: 18, fontWeight: '800', flexShrink: 1 },
    trackDots: { flex: 1, height: 1, borderBottomWidth: 1, borderStyle: 'dotted', borderColor: 'rgba(255,255,255,0.35)' },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 18, padding: 12 },
    addIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
    addText: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '800', lineHeight: 23 },
    monthsRow: { flexDirection: 'row', alignItems: 'flex-end', height: 180, marginTop: 14 },
    monthCell: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
    monthLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '900' },
    quizGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginTop: 8 },
    quizCell: { borderRadius: 16, borderWidth: 3, borderColor: 'transparent' },
    quizRight: { borderColor: '#30D158' },
    quizWrong: { borderColor: '#FF453A' },
    quizResult: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 14, padding: 6, paddingRight: 14, alignSelf: 'flex-start' },
    chipTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
    chipSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '700' },
    fan: { height: 150, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
    tick: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: '#30D158', alignItems: 'center', justifyContent: 'center' },
    vsHead: { flexDirection: 'row', justifyContent: 'space-between' },
    vsLabel: { color: '#fff', fontSize: 17, fontWeight: '800' },
    vsValue: { fontSize: 15, fontWeight: '900' },
    typeName: { color: '#fff', fontSize: 52, fontWeight: '900', letterSpacing: -2, lineHeight: 56 },
    snap: { borderRadius: 28, padding: 20, gap: 12, backgroundColor: '#141416', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
    snapGlow: { position: 'absolute', right: -80, top: -80, width: 240, height: 240, borderRadius: 120, backgroundColor: '#BF5AF2', opacity: 0.35 },
    snapKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '900', letterSpacing: 1.3 },
    collage: { flexDirection: 'row', alignItems: 'center', paddingLeft: 6, marginVertical: 4 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    gridCell: { width: '48%', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: 10 },
    gridValue: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: -1 },
    gridLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '800' },
    snapLine: { color: '#fff', fontSize: 16, fontWeight: '800' },
    snapType: { color: '#BF5AF2', fontSize: 18, fontWeight: '900' },
    snapBrand: { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '800' },
    share: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
    shareText: { color: '#000', fontSize: 15, fontWeight: '800' },
  });
