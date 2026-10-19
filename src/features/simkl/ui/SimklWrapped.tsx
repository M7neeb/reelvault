/**
 * Simkl Wrapped: a story of a year (or a month) of movies, shows and anime.
 * Your time, the split between shows, anime and movies, a guess-your-#1 quiz,
 * your top five counted down, your #1, your genres, your biggest binge, your
 * busiest month, your habits, your longest streak, what you discovered and
 * finished, your best rated, the kind of watcher that makes you, and a
 * summary you can share. Cards with nothing to say are left out.
 * Presentational only (see simkl/ui/types.ts).
 */

import { useMemo, useState } from 'react';
import { Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { StoryDeck, useStoryText, type DeckCard } from '@/features/vault/ui/storyDeck';
import { Confetti, CoverWall, GrowColumn, Rays, Tilt } from '@/features/vault/ui/storyKit';
import { success, warn } from '@/features/vault/ui/haptics';
import { sheet, useStyles } from '@/features/vault/ui/theme';

import { fmtRating } from '../insights';
import { posterUrl } from '../logic';
import { fmtInt, fmtMinutesLong, topQuiz, WATCHER, type SimklWrap } from '../simklWrapped';

const TYPE_LABEL = { show: 'Shows', anime: 'Anime', movie: 'Movies' } as const;
const poster = (path: string | null) => ({ uri: posterUrl(path, '_m') });
const hourLabel = (h: number) => (h === 0 ? 'midnight' : h === 12 ? 'noon' : h < 12 ? `${h} am` : `${h - 12} pm`);

function Quiz({ wrap, onDone }: { wrap: SimklWrap; onDone: () => void }) {
  const styles = useStyles(makeStyles);
  const q = useMemo(() => topQuiz(wrap.top, wrap.range.start), [wrap]);
  const [picked, setPicked] = useState<number | null>(null);
  if (!q) return null;
  return (
    <View style={styles.quiz}>
      {q.options.map((o) => {
        const right = picked !== null && o.simklId === q.answer;
        const wrong = picked === o.simklId && o.simklId !== q.answer;
        return (
          <TouchableOpacity
            key={o.simklId}
            disabled={picked !== null}
            style={[styles.quizOpt, right && styles.quizRight, wrong && styles.quizWrong]}
            onPress={() => {
              setPicked(o.simklId);
              if (o.simklId === q.answer) success();
              else warn();
              setTimeout(onDone, 1400);
            }}
            accessibilityLabel={o.title}>
            <Image source={poster(o.poster)} style={styles.quizImg} contentFit="cover" />
            <Text style={styles.quizLabel} numberOfLines={1}>
              {o.title}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function SimklWrapped({ wrap, onClose }: { wrap: SimklWrap; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const s = useStoryText();
  const [quizDone, setQuizDone] = useState(false);

  const cards = useMemo<DeckCard[]>(() => {
    const w = wrap;
    const out: DeckCard[] = [];
    const posters = [...w.top, ...w.discoveries].map((t) => poster(t.poster));
    const change = w.previousMinutes > 0 ? Math.round(((w.minutes - w.previousMinutes) / w.previousMinutes) * 100) : null;
    const before = w.range.kind === 'year' ? 'the year before' : 'the month before';

    out.push({
      key: 'intro',
      colors: ['#FF375F', '#2A0614'],
      ms: 5500,
      backdrop: posters.length ? <CoverWall sources={posters} opacity={0.55} /> : undefined,
      body: (
        <>
          {s.kicker('YOUR SIMKL WRAPPED', 0)}
          {s.big(w.range.label, 1)}
          {s.line(w.minutes ? `${fmtMinutesLong(w.minutes)} of movies, shows and anime. Here is how it went.` : 'Nothing watched yet in this time.', 2)}
        </>
      ),
    });
    if (!w.minutes) return out;

    out.push({
      key: 'time',
      colors: ['#0A84FF', '#04172E'],
      ms: 6000,
      backdrop: <Rays size={900} />,
      body: (
        <>
          {s.kicker('YOU WATCHED FOR', 0)}
          {s.huge(fmtInt(w.minutes / 60), 1)}
          {s.line(`hours. That's ${fmtInt(w.minutes)} minutes, on ${w.activeDays} ${w.activeDays === 1 ? 'day' : 'days'}.`, 2)}
          {s.line(`${fmtInt(w.episodes)} ${w.episodes === 1 ? 'episode' : 'episodes'} and ${fmtInt(w.movies)} ${w.movies === 1 ? 'movie' : 'movies'}${w.rewatches ? `, ${w.rewatches} of them rewatches` : ''}.`, 3)}
          {change !== null &&
            s.line(
              change >= 100
                ? `${(w.minutes / w.previousMinutes).toFixed(w.minutes / w.previousMinutes < 10 ? 1 : 0).replace(/\.0$/, '')} times as much as ${before}.`
                : change >= 0
                  ? `${change}% more than ${before}.`
                  : `${-change}% less than ${before}.`,
              4
            )}
        </>
      ),
    });

    if (w.byType.length > 1) {
      const max = Math.max(...w.byType.map((t) => t.minutes));
      out.push({
        key: 'types',
        colors: ['#5E5CE6', '#120C3D'],
        ms: 6000,
        body: (
          <>
            {s.kicker('WHAT YOU WATCHED', 0)}
            {s.big(`Mostly ${TYPE_LABEL[w.byType.slice().sort((a, b) => b.minutes - a.minutes)[0].type].toLowerCase()}`, 1)}
            {s.bars(w.byType.map((t) => ({ label: TYPE_LABEL[t.type], share: t.minutes / max, sub: fmtMinutesLong(t.minutes) })), 2)}
          </>
        ),
      });
    }

    if (w.top.length >= 3) {
      out.push({
        key: 'quiz',
        colors: ['#FF9F0A', '#331A00'],
        ms: quizDone ? 4000 : 20000,
        interactive: true,
        body: (
          <>
            {s.kicker('QUICK GUESS', 0)}
            {s.big('Which one did you watch the most?', 1)}
            <Quiz wrap={w} onDone={() => setQuizDone(true)} />
          </>
        ),
      });
    }

    if (w.top.length) {
      out.push({
        key: 'top5',
        colors: ['#30D158', '#05210E'],
        ms: 7500,
        body: (
          <>
            {s.kicker('YOUR TOP TITLES', 0)}
            <View style={{ gap: 8, marginTop: 6 }}>
              {[...w.top].reverse().map((t, n) => (
                <Animated.View key={t.simklId} entering={s.enter(1 + n)} style={styles.row}>
                  <Text style={styles.rank}>{w.top.length - n}</Text>
                  <Image source={poster(t.poster)} style={styles.rowImg} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {t.title}
                    </Text>
                    <Text style={styles.rowSub}>
                      {t.type === 'movie' ? fmtMinutesLong(t.minutes) : `${t.count} ${t.count === 1 ? 'episode' : 'episodes'} · ${fmtMinutesLong(t.minutes)}`}
                    </Text>
                  </View>
                </Animated.View>
              ))}
            </View>
          </>
        ),
      });
      const one = w.top[0];
      out.push({
        key: 'top1',
        colors: ['#FFD60A', '#2E2400'],
        ms: 6500,
        cheer: true,
        backdrop: <Rays size={1000} color="#FFD60A" />,
        body: (
          <>
            {s.kicker('YOUR #1', 0)}
            <Tilt rotate={-4} delay={150}>
              <Image source={poster(one.poster)} style={styles.hero} contentFit="cover" />
            </Tilt>
            {s.big(one.title, 2)}
            {s.line(`${one.type === 'movie' ? 'Watched' : `${one.count} ${one.count === 1 ? 'episode' : 'episodes'},`} ${fmtMinutesLong(one.minutes)}${one.rating ? `. You rated it ${fmtRating(one.rating)}` : ''}.`, 3)}
            <Confetti />
          </>
        ),
      });
    }

    if (w.topGenres.length) {
      out.push({
        key: 'genres',
        colors: ['#BF5AF2', '#22082E'],
        ms: 6000,
        body: (
          <>
            {s.kicker('YOUR GENRES', 0)}
            {s.big(w.topGenres[0].genre, 1)}
            {s.line(`${Math.round(w.topGenres[0].share * 100)}% of your time.`, 2)}
            {s.bars(w.topGenres.map((g) => ({ label: g.genre, share: g.share / w.topGenres[0].share, sub: `${Math.round(g.share * 100)}%` })), 3)}
          </>
        ),
      });
    }

    if (w.binge) {
      out.push({
        key: 'binge',
        colors: ['#FF453A', '#2E0705'],
        ms: 6000,
        backdrop: <CoverWall sources={[poster(w.binge.poster)]} rows={3} opacity={0.35} />,
        body: (
          <>
            {s.kicker('YOUR BIGGEST BINGE', 0)}
            {s.huge(String(w.binge.count), 1)}
            {s.line(`episodes of ${w.binge.title} in one day, on ${new Date(w.binge.day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}.`, 2)}
          </>
        ),
      });
    }

    if (w.busiest) {
      const max = Math.max(...w.buckets.map((b) => b.minutes), 1);
      out.push({
        key: 'busiest',
        colors: ['#64D2FF', '#03202B'],
        ms: 6500,
        body: (
          <>
            {s.kicker(w.range.kind === 'year' ? 'YOUR BUSIEST MONTH' : 'YOUR BUSIEST DAY', 0)}
            {s.big(w.busiest.label, 1)}
            {s.line(`${fmtMinutesLong(w.busiest.minutes)} of watching.`, 2)}
            <Animated.View entering={s.enter(3)} style={styles.columns}>
              {w.buckets.map((b, n) => (
                <View key={n} style={styles.colCell}>
                  <GrowColumn ratio={b.minutes / max} height={120} width="70%" delay={300 + n * 40} color={b.minutes === w.busiest!.minutes ? '#fff' : 'rgba(255,255,255,0.45)'} />
                  {w.range.kind === 'year' && <Text style={styles.colLabel}>{b.label.slice(0, 1)}</Text>}
                </View>
              ))}
            </Animated.View>
          </>
        ),
      });
    }

    if (w.favouriteWeekday && w.peakHour !== null) {
      out.push({
        key: 'habits',
        colors: ['#AC8E68', '#1E160B'],
        ms: 6000,
        body: (
          <>
            {s.kicker('YOUR HABITS', 0)}
            {s.big(`${w.favouriteWeekday.name} were yours`, 1)}
            {s.line(`${Math.round(w.favouriteWeekday.share * 100)}% of your watching happened on ${w.favouriteWeekday.name}.`, 2)}
            {s.line(`Your favourite time: around ${hourLabel(w.peakHour)}.${w.nightShare >= 0.25 ? ` ${Math.round(w.nightShare * 100)}% after 10 at night.` : ''}`, 3)}
          </>
        ),
      });
    }

    if (w.longestStreak >= 2) {
      out.push({
        key: 'streak',
        colors: ['#FF9F0A', '#2B1500'],
        ms: 5500,
        body: (
          <>
            {s.kicker('YOUR LONGEST STREAK', 0)}
            {s.huge(String(w.longestStreak), 1)}
            {s.line('days in a row with something on.', 2)}
          </>
        ),
      });
    }

    if (w.discoveries.length) {
      out.push({
        key: 'new',
        colors: ['#32ADE6', '#041A26'],
        ms: 6500,
        body: (
          <>
            {s.kicker('NEW TO YOU', 0)}
            {s.big(`${w.discoveries.length >= 6 ? '6+' : w.discoveries.length} ${w.discoveries.length === 1 ? 'discovery' : 'discoveries'}`, 1)}
            <Animated.View entering={s.enter(2)} style={styles.grid}>
              {w.discoveries.map((d) => (
                <View key={d.simklId} style={styles.gridCell}>
                  <Image source={poster(d.poster)} style={styles.gridImg} contentFit="cover" />
                  <Text style={styles.gridLabel} numberOfLines={1}>
                    {d.title}
                  </Text>
                </View>
              ))}
            </Animated.View>
          </>
        ),
      });
    }

    if (w.finished.length) {
      out.push({
        key: 'finished',
        colors: ['#34C759', '#06200C'],
        ms: 6000,
        backdrop: <CoverWall sources={w.finished.map((f) => poster(f.poster))} opacity={0.4} />,
        body: (
          <>
            {s.kicker('YOU FINISHED', 0)}
            {s.huge(String(w.finished.length), 1)}
            {s.line(`${w.finished.length === 1 ? 'title' : 'titles'}, from ${w.finished[w.finished.length - 1].title} to ${w.finished[0].title}.`, 2)}
          </>
        ),
      });
    }

    if (w.bestRated.length) {
      out.push({
        key: 'rated',
        colors: ['#FFCC00', '#2B2200'],
        ms: 6000,
        body: (
          <>
            {s.kicker('YOUR BEST RATED', 0)}
            <View style={{ gap: 10, marginTop: 6 }}>
              {w.bestRated.map((r, n) => (
                <Animated.View key={r.simklId} entering={s.enter(1 + n)} style={styles.row}>
                  <Image source={poster(r.poster)} style={styles.rowImg} contentFit="cover" />
                  <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={2}>
                    {r.title}
                  </Text>
                  <Text style={styles.score}>★ {fmtRating(r.rating)}</Text>
                </Animated.View>
              ))}
            </View>
          </>
        ),
      });
    }

    const who = WATCHER[w.watcher];
    out.push({
      key: 'who',
      colors: ['#FF2D55', '#2E0510'],
      ms: 6500,
      cheer: true,
      backdrop: <Rays size={1000} />,
      body: (
        <>
          {s.kicker('THAT MAKES YOU', 0)}
          <Animated.View entering={ZoomIn.delay(200).springify()}>
            <Text style={styles.who}>{who.name}</Text>
          </Animated.View>
          {s.line(who.line, 2)}
          <Confetti delay={400} />
        </>
      ),
    });

    const summary = [
      `My Simkl Wrapped ${w.range.label}`,
      `${fmtInt(w.minutes / 60)} hours · ${fmtInt(w.episodes)} episodes · ${fmtInt(w.movies)} movies`,
      w.top[0] ? `#1: ${w.top[0].title}` : null,
      w.topGenres[0] ? `Top genre: ${w.topGenres[0].genre}` : null,
      `I'm ${who.name}`,
    ]
      .filter(Boolean)
      .join('\n');
    out.push({
      key: 'summary',
      colors: ['#1C1C1E', '#000000'],
      ms: 12000,
      interactive: true,
      body: (
        <>
          {s.kicker(`SIMKL WRAPPED ${w.range.label.toUpperCase()}`, 0)}
          <Animated.View entering={s.enter(1)} style={styles.sumGrid}>
            {[
              [fmtInt(w.minutes / 60), 'hours'],
              [fmtInt(w.episodes), 'episodes'],
              [fmtInt(w.movies), 'movies'],
              [String(w.titles), 'titles'],
              [String(w.longestStreak), 'day streak'],
              [String(w.finished.length), 'finished'],
            ].map(([n, label]) => (
              <View key={label} style={styles.sumCell}>
                <Text style={styles.sumNum}>{n}</Text>
                <Text style={styles.sumLabel}>{label}</Text>
              </View>
            ))}
          </Animated.View>
          {w.top[0] && s.line(`#1 ${w.top[0].title}${w.topGenres[0] ? ` · ${w.topGenres[0].genre}` : ''} · ${who.name}`, 2)}
          <Animated.View entering={s.enter(3)}>
            <TouchableOpacity style={styles.share} onPress={() => Share.share({ message: summary }).catch(() => undefined)}>
              <Text style={styles.shareText}>Share</Text>
            </TouchableOpacity>
          </Animated.View>
        </>
      ),
    });
    return out;
  }, [wrap, quizDone]); // eslint-disable-line react-hooks/exhaustive-deps

  return <StoryDeck cards={cards} onClose={onClose} />;
}

const makeStyles = () =>
  sheet({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(0,0,0,0.28)', borderRadius: 16, padding: 8 },
    rank: { color: '#fff', fontSize: 26, fontWeight: '900', width: 26, textAlign: 'center' },
    rowImg: { width: 44, height: 64, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.1)' },
    rowTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
    rowSub: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '700' },
    score: { color: '#FFD60A', fontSize: 18, fontWeight: '900' },
    hero: { width: 170, height: 250, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 3, borderColor: '#fff' },
    who: { color: '#fff', fontSize: 50, fontWeight: '900', letterSpacing: -1.5, lineHeight: 54 },
    quiz: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
    quizOpt: { width: '47%', borderRadius: 14, overflow: 'hidden', borderWidth: 3, borderColor: 'rgba(255,255,255,0.35)', backgroundColor: 'rgba(0,0,0,0.3)' },
    quizRight: { borderColor: '#30D158', borderWidth: 4 },
    quizWrong: { borderColor: '#FF453A' },
    quizImg: { width: '100%', aspectRatio: 1.25 },
    quizLabel: { color: '#fff', fontSize: 13, fontWeight: '800', padding: 6 },
    columns: { flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 2, marginTop: 14 },
    colCell: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
    colLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '800' },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
    gridCell: { width: '30%', gap: 4 },
    gridImg: { width: '100%', aspectRatio: 0.68, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)' },
    gridLabel: { color: '#fff', fontSize: 11, fontWeight: '800' },
    sumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
    sumCell: { width: '30%', flexGrow: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 12, gap: 2, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)' },
    sumNum: { color: '#fff', fontSize: 26, fontWeight: '900' },
    sumLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
    share: { alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 22, paddingVertical: 11, marginTop: 10 },
    shareText: { color: '#000', fontSize: 16, fontWeight: '900' },
  });
