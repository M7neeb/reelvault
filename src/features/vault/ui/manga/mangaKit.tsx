/**
 * The moving pieces of the reading Wrapped, made of your manga itself:
 * - the pages of the title a card talks about, behind it: a long strip that
 *   scrolls by itself (webtoons) or pages turning one after another (manga),
 *   with a quick cut of panels for the opening; the cover moves slowly until
 *   the pages have loaded;
 * - a calendar of every day you read, wiped in from the left;
 * - a 24-hour clock, a streak of flames, rating bars, a stack of paper, a fan
 *   of covers, a shelf of finished titles, badges and quizzes.
 * Pages load once per title and are kept while the story is open. With Reduce
 * Motion on, everything simply appears. Presentational only.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image, type ImageProps } from 'expo-image';
import Animated, { Easing, FadeIn, Keyframe, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';

import type { ImageRef } from '../../manga/sources/types';
import Fade from '../Fade';
import { success, warn } from '../haptics';
import Icon from '../Icon';
import type { IconName } from '../icons';
import { EASE_OUT, useReducedMotion } from '../motion';
import { ImageRiver, Screentone } from '../scenes';
import { CoverWall, GrowColumn, KenBurns, Tilt } from '../storyKit';
import { sheet, useStyles } from '../theme';
import type { ThumbSource } from '../types';
import MangaCover from './MangaCover';
import type { MangaUiSeries } from './mangaTypes';

/* ------------------------------------------------------------------ pages */

/** A page ready to draw: decoded once at a small size (shared by every copy on screen), with its shape. */
export type Pic = { source: NonNullable<ImageProps['source']>; aspect: number | null };

/**
 * Pages of a title, decoded once per size while the story is open (going back
 * and forth never loads or decodes twice; closing the story frees them).
 */
export type PageLoader = { pages: (seriesId: string, opts: { maxWidth: number; max: number }) => Promise<Pic[]> };

/** Wraps "the pages of a title" (addresses) into a PageLoader that decodes and remembers. */
export function cachedLoader(load: (seriesId: string) => Promise<ImageRef[]>): PageLoader {
  const raw = new Map<string, Promise<ImageRef[]>>();
  const done = new Map<string, Promise<Pic[]>>();
  const rawOf = (id: string) => {
    let p = raw.get(id);
    if (!p) {
      p = load(id).catch(() => [] as ImageRef[]);
      raw.set(id, p);
    }
    return p;
  };
  return {
    pages: (id, { maxWidth, max }) => {
      const k = `${id}|${maxWidth}|${max}`;
      let p = done.get(k);
      if (!p) {
        p = rawOf(id).then((refs) =>
          Promise.all(
            refs.slice(0, max).map(async (r): Promise<Pic> => {
              try {
                const bmp = await Image.loadAsync({ uri: r.uri, headers: r.headers }, { maxWidth });
                return { source: bmp, aspect: bmp.width > 0 ? bmp.height / bmp.width : null };
              } catch {
                return { source: { uri: r.uri, headers: r.headers }, aspect: null };
              }
            })
          )
        );
        done.set(k, p);
      }
      return p;
    },
  };
}

/** The pages of one title for a card that fills the screen. */
export function usePages(load: PageLoader | null | undefined, seriesId: string | null | undefined, max = 6): Pic[] | null {
  const [pages, setPages] = useState<Pic[] | null>(null);
  useEffect(() => {
    if (!load || !seriesId) return;
    let live = true;
    load
      .pages(seriesId, { maxWidth: 600, max })
      .then((p) => live && setPages(p))
      .catch(() => live && setPages([]));
    return () => {
      live = false;
    };
  }, [load, seriesId, max]);
  return pages;
}

/**
 * A few pages from each of several titles, mixed together (for the scenes
 * behind the cards). Small (360 px wide); very long strips only if nothing
 * else is there (they would be cropped to their top anyway).
 */
export function usePagePool(load: PageLoader | null | undefined, ids: string[], per = 4): Pic[] {
  const [pool, setPool] = useState<Pic[]>([]);
  const key = ids.join('|');
  useEffect(() => {
    if (!load || !ids.length) return;
    let live = true;
    Promise.all(ids.slice(0, 6).map((id) => load.pages(id, { maxWidth: 360, max: per }).catch(() => [] as Pic[])))
      .then((all) => {
        const out: Pic[] = [];
        for (let k = 0; k < per; k++) for (const p of all) if (p[k]) out.push(p[k]);
        const fit = out.filter((p) => p.aspect === null || p.aspect <= 3);
        if (live) setPool(fit.length >= 6 ? fit : out);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [load, key, per]); // eslint-disable-line react-hooks/exhaustive-deps
  return pool;
}

const PAGE_ASPECT = 1.45;

/** A long strip of pages scrolling up by itself, without end (webtoons), each page at its real shape. */
export function PageStrip({ pages, ms = 26000, width: w, reverse = false }: { pages: Pic[]; ms?: number; /** Narrower than the screen (side by side). */ width?: number; /** Scrolls down instead of up. */ reverse?: boolean }) {
  const screen = useWindowDimensions();
  const width = w ?? screen.width;
  const reduce = useReducedMotion();
  const heights = pages.map((p) => Math.round(width * Math.min(8, p.aspect ?? PAGE_ASPECT)));
  const set = heights.reduce((a, b) => a + b, 0);
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduce || !set) return;
    y.value = 0;
    // About one screen every 7 seconds, like a slow, steady scroll.
    y.value = withRepeat(withTiming(1, { duration: Math.max(ms, (set / Math.max(1, width)) * 4500), easing: Easing.linear }), -1, false);
  }, [set, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ transform: [{ translateY: reverse ? -set + y.value * set : -y.value * set }] }));
  return (
    <View style={[w ? { width: w, height: '100%' } : StyleSheet.absoluteFill, { overflow: 'hidden' }]} pointerEvents="none">
      <Animated.View style={anim}>
        {[...pages, ...pages].map((p, i) => (
          <Image key={i} source={p.source} style={{ width, height: heights[i % pages.length] }} contentFit="cover" contentPosition="top" transition={0} />
        ))}
      </Animated.View>
    </View>
  );
}

const turnIn = (rtl: boolean) =>
  new Keyframe({
    0: { opacity: 0, transform: [{ perspective: 900 }, { translateX: rtl ? -160 : 160 }, { rotateY: rtl ? '-55deg' : '55deg' }, { scale: 0.92 }] },
    100: { opacity: 1, transform: [{ perspective: 900 }, { translateX: 0 }, { rotateY: '0deg' }, { scale: 1 }], easing: EASE_OUT },
  }).duration(650);

/** Pages turning one after another, the way the book reads (right to left for manga). */
export function PageFlip({ pages, every = 1900, rtl = true }: { pages: Pic[]; every?: number; rtl?: boolean }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce || pages.length < 2) return;
    const id = setInterval(() => setI((n) => (n + 1) % pages.length), every);
    return () => clearInterval(id);
  }, [pages.length, every, reduce]);
  const prev = pages[(i - 1 + pages.length) % pages.length];
  const cur = pages[i];
  const anim = useMemo(() => turnIn(rtl), [rtl]);
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: '#111' }]} pointerEvents="none">
      {i > 0 && prev && <Image source={prev.source} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" transition={0} />}
      {cur && (
        <Animated.View key={i} entering={reduce ? undefined : anim} style={StyleSheet.absoluteFill}>
          <Image source={cur.source} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" transition={0} />
        </Animated.View>
      )}
    </View>
  );
}

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/** Quick cuts between close-ups of panels, like a trailer. */
export function PanelMontage({ pages, every = 520 }: { pages: Pic[]; every?: number }) {
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduce || !pages.length) return;
    const id = setInterval(() => setN((x) => x + 1), every);
    return () => clearInterval(id);
  }, [pages.length, every, reduce]);
  if (!pages.length) return null;
  const p = pages[n % pages.length];
  const zoom = 1.6 + rand(n) * 1.2;
  const dx = (rand(n + 3) - 0.5) * 60 * zoom;
  const dy = (rand(n + 5) - 0.5) * 90 * zoom;
  return (
    <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', backgroundColor: '#000' }]} pointerEvents="none">
      <Animated.View key={n} entering={reduce ? undefined : FadeIn.duration(90)} style={[StyleSheet.absoluteFill, { transform: [{ scale: zoom }, { translateX: dx }, { translateY: dy }] }]}>
        <Image source={p.source} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" transition={0} />
      </Animated.View>
    </View>
  );
}

/**
 * The backdrop of a card about one title: its pages (a strip or turning
 * pages, or quick cuts), darkened so the words stay readable; its cover until
 * they load.
 */
export function TitleBackdrop({ load, series, style = 'auto', dim = 0.55 }: { load?: PageLoader | null; series: MangaUiSeries | undefined; style?: 'auto' | 'strip' | 'flip' | 'montage'; dim?: number }) {
  const pages = usePages(load, series?.id, style === 'strip' || style === 'auto' ? 5 : 8);
  if (!series) return null;
  const strip = series.readingMode === 'webtoon' || (series.readingMode === null && series.kind !== 'comic' && series.kind !== 'manga');
  const kind = style === 'auto' ? (strip ? 'strip' : 'flip') : style;
  const rtl = series.readingMode ? series.readingMode === 'rtl' : series.kind === 'manga';
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} pointerEvents="none">
      {pages && pages.length ? (
        kind === 'strip' ? (
          <PageStrip pages={pages} />
        ) : kind === 'montage' ? (
          <PanelMontage pages={pages} />
        ) : (
          <PageFlip pages={pages} rtl={rtl} />
        )
      ) : (
        <KenBurns source={series.coverSource ?? undefined} ms={9000} fill seed={series.title.length} />
      )}
      {/* The story's own dark shade sits on top: only a touch more here, so the pages stay clear. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${Math.max(0, dim - 0.4)})` }]} />
    </View>
  );
}

/** Quick cuts through the pages of several titles (the opening); your covers drifting by while they load or when there are none. */
export function MultiMontage({ load, ids, covers, dim = 0.45 }: { load?: PageLoader | null; ids: string[]; covers: ThumbSource[]; dim?: number }) {
  const [pages, setPages] = useState<Pic[]>([]);
  useEffect(() => {
    if (!load) return;
    let live = true;
    Promise.all(ids.slice(0, 6).map((id) => load.pages(id, { maxWidth: 700, max: 6 }).catch(() => [] as Pic[])))
      .then((all) => {
        // Interleave titles: a panel from each in turn (skipping the title page).
        const out: Pic[] = [];
        for (let k = 1; k < 6; k++) for (const p of all) if (p[k]) out.push(p[k]);
        if (live) setPages(out);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [load, ids.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} pointerEvents="none">
      {pages.length ? <PanelMontage pages={pages} every={380} /> : <CoverWall sources={covers} opacity={0.6} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${Math.max(0, dim - 0.35)})` }]} />
    </View>
  );
}

/** One page moving slowly inside a frame: panning down it, zooming in on part of it, like a camera over the paper. */
function PanPage({ pic, w, h, ms, zoom = 1.25, seed = 0 }: { pic: Pic | undefined; w: number; h: number; ms: number; zoom?: number; seed?: number }) {
  const reduce = useReducedMotion();
  const k = useSharedValue(0);
  const imgH = Math.max(h, w * Math.min(6, pic?.aspect ?? PAGE_ASPECT));
  useEffect(() => {
    k.value = 0;
    if (!reduce) k.value = withTiming(1, { duration: ms, easing: Easing.inOut(Easing.quad) });
  }, [pic, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const dx = (rand(seed) - 0.5) * w * 0.3;
  const anim = useAnimatedStyle(() => ({
    transform: [{ translateY: -k.value * (imgH - h) * 0.6 }, { translateX: k.value * dx }, { scale: 1 + k.value * (zoom - 1) }],
  }));
  if (!pic) return <View style={{ width: w, height: h, backgroundColor: '#111' }} />;
  return (
    <View style={{ width: w, height: h, overflow: 'hidden', backgroundColor: '#111' }}>
      <Animated.View style={anim}>
        <Image source={pic.source} style={{ width: w, height: imgH }} contentFit="cover" contentPosition="top" transition={0} />
      </Animated.View>
    </View>
  );
}

/**
 * The background of a card in the reading Wrapped: your manga itself, never a
 * plain colour. The layout changes from card to card (and the title with it):
 * a long strip scrolling, two titles side by side scrolling opposite ways,
 * pages turning, three titles framed like the panels of a page, a slow camera
 * move over one page, or a wall of pages from everything you read. While the
 * pages load (or when a title has none on the phone), your covers flow by.
 */
export function MangaScene({ load, ids, index, pool, covers }: { load?: PageLoader | null; ids: string[]; index: number; pool: Pic[]; covers: ThumbSource[] }) {
  const { width, height } = useWindowDimensions();
  const v = index % 6;
  const n = Math.max(1, ids.length);
  const a = ids.length ? ids[index % n] : null;
  const b = ids.length > 1 ? ids[(index + 1) % n] : null;
  const c = ids.length > 2 ? ids[(index + 2) % n] : null;
  const pa = usePages(load, a, 5);
  const pb = usePages(load, v === 1 || v === 3 ? b : null, 5);
  const pc = usePages(load, v === 3 ? c : null, 5);
  const has = (p: Pic[] | null): p is Pic[] => !!p && p.length > 0;
  const gutter = 6;
  let body: ReactNode;
  if (v === 5 && pool.length >= 3) {
    body = <ImageRiver sources={pool.map((p) => p.source)} columns={3} aspect={1.45} tilt={-9} speed={1.1} />;
  } else if (!has(pa)) {
    body = <ImageRiver sources={covers} columns={3} aspect={1.42} tilt={8} speed={0.9} />;
  } else if (v === 0) {
    body = <PageStrip pages={pa} />;
  } else if (v === 1) {
    const half = (width - gutter) / 2;
    body = (
      <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', gap: gutter, backgroundColor: '#fff' }]}>
        <PageStrip pages={pa} width={half} />
        <PageStrip pages={has(pb) ? pb : pa} width={half} reverse />
      </View>
    );
  } else if (v === 2) {
    body = <PageFlip pages={pa} />;
  } else if (v === 3) {
    // Three titles framed like the panels of one page: white gutters, black borders.
    const third = (width - gutter * 4) / 3;
    const h = height - gutter * 2;
    const pics = [pa[1] ?? pa[0], (has(pb) ? pb : pa)[1] ?? pa[0], (has(pc) ? pc : pa)[2] ?? pa[0]];
    body = (
      <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', gap: gutter, padding: gutter, backgroundColor: '#fff' }]}>
        {pics.map((p, i) => (
          <View key={i} style={{ borderWidth: 2, borderColor: '#000' }}>
            <PanPage pic={p} w={third - 4} h={h - 4} ms={9000 + i * 1500} zoom={1.1 + i * 0.08} seed={index + i} />
          </View>
        ))}
      </View>
    );
  } else {
    body = <PanPage pic={pa[2] ?? pa[0]} w={width} h={height} ms={8000} zoom={1.55} seed={index} />;
  }
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} pointerEvents="none">
      {body}
      <Screentone opacity={0.05} />
    </View>
  );
}

/* --------------------------------------------------------------- calendar */

/** Every day of the range as a square, brighter the more you read; wiped in from the left. */
export function Heatmap({ calendar, color = '#30D158', year }: { calendar: { day: number; v: number }[]; color?: string; year: boolean }) {
  const styles = useStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const sorted = calendar.map((c) => c.v).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] ?? 1;
  const level = (v: number) => (v <= 0 ? 0 : v <= q(0.25) ? 1 : v <= q(0.5) ? 2 : v <= q(0.8) ? 3 : 4);
  const alpha = [0.1, 0.35, 0.55, 0.78, 1];
  const wipe = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!reduce) wipe.value = withDelay(350, withTiming(1, { duration: 1600, easing: Easing.out(Easing.cubic) }));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const wipeStyle = useAnimatedStyle(() => ({ width: `${wipe.value * 100}%` }));
  // Sideways the card is short: the calendar stays small enough to fit.
  const avail = Math.min(width, height * 0.62) - 56;
  if (year) {
    // A row for each month, a dot for each day: the year reads top to bottom.
    const rows = new Map<number, { day: number; v: number }[]>();
    for (const c of calendar) {
      const d = new Date(c.day);
      const k = d.getFullYear() * 12 + d.getMonth();
      rows.set(k, [...(rows.get(k) ?? []), c]);
    }
    const label = 16;
    const gap = 2;
    const size = Math.max(4, Math.floor((avail - label - gap * 30) / 31));
    return (
      <Animated.View style={[{ overflow: 'hidden' }, wipeStyle]}>
        <View style={{ gap: 3, width: avail }}>
          {[...rows.entries()].map(([k, days]) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap }}>
              <Text style={[styles.monthLetter, { width: label }]}>{'JFMAMJJASOND'[k % 12]}</Text>
              {days.map((c) => (
                <View key={c.day} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: hexA(color, alpha[level(c.v)]) }} />
              ))}
            </View>
          ))}
        </View>
      </Animated.View>
    );
  }
  // A month or a week: a calendar with the dates.
  const first = (new Date(calendar[0]?.day ?? 0).getDay() + 6) % 7;
  const cells = [...Array.from({ length: first }, () => null), ...calendar];
  const size = Math.floor((avail - 6 * 6) / 7);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => (
          <Text key={i} style={[styles.calHead, { width: size }]}>
            {l}
          </Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {cells.map((c, i) =>
          c ? (
            <Animated.View key={i} entering={reduce ? undefined : ZoomIn.delay(200 + i * 22).springify().damping(14)} style={[styles.calCell, { width: size, height: size, backgroundColor: hexA(color, alpha[level(c.v)]) }]}>
              <Text style={[styles.calNum, level(c.v) >= 3 && { color: '#000' }]}>{new Date(c.day).getDate()}</Text>
            </Animated.View>
          ) : (
            <View key={i} style={{ width: size, height: size }} />
          )
        )}
      </View>
    </View>
  );
}

export function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ------------------------------------------------------------------ clock */

/** A 24-hour dial: a bar for each hour, growing out from the middle; the peak hour in gold. */
export function ClockDial({ hours, peak, size = 260 }: { hours: number[]; peak: number | null; size?: number }) {
  const styles = useStyles(makeStyles);
  const reduce = useReducedMotion();
  const max = Math.max(1, ...hours);
  const inner = size * 0.22;
  const reach = size / 2 - inner - 6;
  const night = peak !== null && (peak >= 21 || peak < 6);
  return (
    <View style={{ width: size, height: size, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' }}>
      {hours.map((v, h) => (
        <View key={h} style={[StyleSheet.absoluteFill, { alignItems: 'center', transform: [{ rotate: `${h * 15}deg` }] }]} pointerEvents="none">
          <View style={{ height: size / 2 - inner, justifyContent: 'flex-end', alignItems: 'center' }}>
            <GrowColumn ratio={Math.max(0.04, v / max)} height={reach} width={Math.max(4, size * 0.035)} color={h === peak ? '#FFD60A' : 'rgba(255,255,255,0.85)'} radius={4} delay={reduce ? 0 : 200 + h * 45} />
          </View>
        </View>
      ))}
      <View style={[styles.dialCore, { width: inner * 2 - 8, height: inner * 2 - 8, borderRadius: inner }]}>
        <Icon name={night ? 'moon' : 'sun'} size={inner * 0.7} color="#FFD60A" />
      </View>
      {['12 am', '6 am', '12 pm', '6 pm'].map((l, i) => (
        <Text key={l} style={[styles.dialLabel, i === 0 ? { top: -18 } : i === 1 ? { right: -34 } : i === 2 ? { bottom: -18 } : { left: -34 }]}>
          {l}
        </Text>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ streak */

/** The days of your streak as flames lighting up one after another. */
export function StreakChain({ days }: { days: number }) {
  const reduce = useReducedMotion();
  const shown = Math.min(days, 35);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
      {Array.from({ length: shown }, (_, i) => (
        <Animated.View key={i} entering={reduce ? undefined : ZoomIn.delay(250 + i * 55).springify().damping(12)}>
          <Icon name="fire" size={22} color={i === shown - 1 ? '#FFD60A' : '#FF9F0A'} />
        </Animated.View>
      ))}
      {days > shown && <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18, alignSelf: 'center' }}>+{days - shown}</Text>}
    </View>
  );
}

/* ----------------------------------------------------------------- ratings */

/** How many titles got each rating, 1 to 10. */
export function RatingBars({ histogram }: { histogram: number[] }) {
  const styles = useStyles(makeStyles);
  const max = Math.max(1, ...histogram);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 170, marginTop: 8 }}>
      {histogram.map((n, i) => (
        <View key={i} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
          {n > 0 && <Text style={styles.barNum}>{n}</Text>}
          <GrowColumn ratio={n / max} height={120} width="100%" color={i >= 7 ? '#FFD60A' : i >= 4 ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)'} delay={200 + i * 70} radius={5} />
          <Text style={styles.barLabel}>{i + 1}</Text>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------- paper */

/** A stack of paper growing to the height of every page you turned. */
export function PageStack({ sheets = 14 }: { sheets?: number }) {
  const reduce = useReducedMotion();
  return (
    <View style={{ height: 112 + Math.min(sheets, 12) * 6, alignItems: 'center', justifyContent: 'flex-end', marginVertical: 8 }}>
      {Array.from({ length: Math.min(sheets, 12) }, (_, i) => (
        <Animated.View
          key={i}
          entering={reduce ? undefined : FadeIn.delay(150 + i * 90).duration(260)}
          style={{ position: 'absolute', bottom: i * 6, width: 150, height: 104, borderRadius: 4, backgroundColor: i % 2 ? '#F2EFE6' : '#FFFFFF', borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)', transform: [{ rotate: `${(rand(i) - 0.5) * 6}deg` }, { translateX: (rand(i + 9) - 0.5) * 10 }] }}>
          <View style={{ margin: 10, gap: 6 }}>
            <View style={{ height: 34, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.12)' }} />
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <View style={{ flex: 1, height: 34, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.1)' }} />
              <View style={{ flex: 1.4, height: 34, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.08)' }} />
            </View>
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ covers */

/** Covers fanned out like a hand of cards, springing in one by one. */
export function CoverFan({ list, width = 96 }: { list: MangaUiSeries[]; width?: number }) {
  const n = Math.min(list.length, 7);
  const mid = (n - 1) / 2;
  return (
    <View style={{ height: width * 1.6, alignItems: 'center', justifyContent: 'center', marginVertical: 8 }}>
      {list.slice(0, n).map((s, i) => (
        <View key={s.id} style={{ position: 'absolute', transform: [{ translateX: (i - mid) * width * 0.42 }, { translateY: Math.abs(i - mid) * 8 }] }}>
          <Tilt rotate={(i - mid) * 7} delay={150 + i * 110}>
            <View style={{ shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } }}>
              <MangaCover series={s} width={width} radius={10} />
            </View>
          </Tilt>
        </View>
      ))}
    </View>
  );
}

/** Finished titles standing on a shelf, a check popping up on each. */
export function Shelf({ list }: { list: MangaUiSeries[] }) {
  const reduce = useReducedMotion();
  const show = list.slice(0, 8);
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        {show.map((s, i) => (
          <Animated.View key={s.id} entering={reduce ? undefined : FadeIn.delay(150 + i * 120).duration(300)}>
            <MangaCover series={s} width={70} radius={8} />
            <Animated.View entering={reduce ? undefined : ZoomIn.delay(500 + i * 120).springify()} style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: '#30D158', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={12} color="#fff" weight="bold" />
            </Animated.View>
          </Animated.View>
        ))}
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)', marginTop: 4 }} />
      {list.length > show.length && <Text style={{ color: 'rgba(255,255,255,0.8)', fontWeight: '800', marginTop: 6 }}>and {list.length - show.length} more</Text>}
    </View>
  );
}

/* ------------------------------------------------------------------ badges */

export function BadgeGrid({ badges }: { badges: { key: string; name: string; line: string; icon: IconName }[] }) {
  const styles = useStyles(makeStyles);
  const reduce = useReducedMotion();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
      {badges.slice(0, 6).map((b, i) => (
        <Animated.View key={b.key} entering={reduce ? undefined : ZoomIn.delay(250 + i * 140).springify().damping(11)} style={styles.badge}>
          <View style={styles.badgeIcon}>
            <Icon name={b.icon} size={22} color="#FFD60A" />
          </View>
          <Text style={styles.badgeName} numberOfLines={1}>
            {b.name}
          </Text>
          <Text style={styles.badgeLine} numberOfLines={2}>
            {b.line}
          </Text>
        </Animated.View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ quizzes */

/** A question with four answers: tap one, see if you were right. */
export function TextQuiz({ options, answer, reveal }: { options: string[]; answer: number; reveal: (right: boolean) => string }) {
  const styles = useStyles(makeStyles);
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <View style={{ gap: 10, marginTop: 8 }}>
      {options.map((o, i) => {
        const show = picked !== null;
        const right = i === answer;
        return (
          <TouchableOpacity
            key={o}
            disabled={show}
            onPress={() => {
              setPicked(i);
              if (right) success();
              else warn();
            }}
            style={[styles.qOpt, show && right && styles.qRight, show && picked === i && !right && styles.qWrong, show && !right && picked !== i && { opacity: 0.45 }]}>
            <Text style={styles.qText}>{o}</Text>
            {show && right && <Icon name="check" size={18} color="#fff" weight="bold" />}
          </TouchableOpacity>
        );
      })}
      {picked !== null && (
        <Animated.Text entering={ZoomIn} style={styles.qResult}>
          {reveal(picked === answer)}
        </Animated.Text>
      )}
    </View>
  );
}

/* --------------------------------------------------------------------- misc */

/** A giant rank number behind a countdown card. */
export function GiantRank({ n }: { n: number }) {
  const styles = useStyles(makeStyles);
  const reduce = useReducedMotion();
  const s = useSharedValue(reduce ? 1 : 1.6);
  useEffect(() => {
    if (!reduce) s.value = withSpring(1, { damping: 14, stiffness: 90 });
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], opacity: Math.min(1, 2.2 - s.value) }));
  return (
    <Animated.Text style={[styles.giant, anim]} pointerEvents="none">
      {n}
    </Animated.Text>
  );
}

/** A thin pill with a cover and a title (who a number is about). */
export function TitleChip({ series, sub }: { series: MangaUiSeries; sub?: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.chip}>
      <MangaCover series={series} width={34} radius={6} />
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.chipTitle} numberOfLines={1}>
          {series.title}
        </Text>
        {!!sub && <Text style={styles.chipSub}>{sub}</Text>}
      </View>
    </View>
  );
}

/** Things that move in a row, one after another (for small lists). */
export function Stagger({ children, delay = 0 }: { children: ReactNode[]; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <>
      {children.map((c, i) => (
        <Animated.View key={i} entering={reduce ? undefined : FadeIn.delay(delay + i * 140).duration(380)}>
          {c}
        </Animated.View>
      ))}
    </>
  );
}

/** Keeps a value from the first render (for a deck that must not rebuild while it plays). */
export function useOnce<T>(make: () => T): T {
  const ref = useRef<{ v: T } | null>(null);
  if (!ref.current) ref.current = { v: make() };
  return ref.current.v;
}

const makeStyles = () =>
  sheet({
    monthLetter: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '900' },
    calHead: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '800', textAlign: 'center' },
    calCell: { borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    calNum: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '800' },
    dialCore: { backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
    dialLabel: { position: 'absolute', color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '800' },
    barNum: { color: '#fff', fontSize: 12, fontWeight: '900' },
    barLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '800' },
    badge: { width: '47%', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 18, padding: 12, gap: 4, borderWidth: 1, borderColor: 'rgba(255,214,10,0.35)' },
    badgeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,214,10,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
    badgeName: { color: '#fff', fontSize: 16, fontWeight: '900' },
    badgeLine: { color: 'rgba(255,255,255,0.78)', fontSize: 12, fontWeight: '700' },
    qOpt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 16, paddingHorizontal: 18, paddingVertical: 15, borderWidth: 2, borderColor: 'transparent' },
    qRight: { backgroundColor: 'rgba(48,209,88,0.35)', borderColor: '#30D158' },
    qWrong: { backgroundColor: 'rgba(255,69,58,0.3)', borderColor: '#FF453A' },
    qText: { color: '#fff', fontSize: 18, fontWeight: '800' },
    qResult: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center', marginTop: 4 },
    giant: { position: 'absolute', right: -10, top: '8%', color: 'rgba(255,255,255,0.13)', fontSize: 300, fontWeight: '900', letterSpacing: -20 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 14, padding: 6, paddingRight: 14, alignSelf: 'flex-start' },
    chipTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
    chipSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '700' },
  });

/**
 * A chapter's title page: a little manga page of three panels filled with your
 * pages (one wide on top, two below), dropping in one after another.
 */
export function ChapterArt({ load, ids, seed }: { load?: PageLoader | null; ids: string[]; seed: number }) {
  const pool = usePagePool(load, ids, 3);
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  if (pool.length < 3) return null;
  const pick = (k: number) => pool[(seed * 3 + k) % pool.length];
  const W = Math.min(width * 0.86, height * 0.5);
  const panel = (src: Pic, w: number, h: number, delay: number, rot: number) => (
    <Animated.View entering={reduce ? undefined : ZoomIn.delay(delay).springify().damping(13)} style={{ width: w, height: h, borderWidth: 3, borderColor: '#000', backgroundColor: '#fff', transform: [{ rotate: `${rot}deg` }], overflow: 'hidden' }}>
      <Image source={src.source} style={{ width: '100%', height: '100%' }} contentFit="cover" contentPosition="top" transition={0} />
    </Animated.View>
  );
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'flex-end', paddingBottom: '14%', opacity: 0.9 }]}>
      <View style={{ width: W, padding: 8, gap: 8, backgroundColor: '#fff', transform: [{ rotate: seed % 2 ? '3deg' : '-3deg' }] }}>
        {panel(pick(0), W - 16, W * 0.42, 150, 0)}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {panel(pick(1), (W - 24) * 0.45, W * 0.5, 320, 0)}
          {panel(pick(2), (W - 24) * 0.55, W * 0.5, 480, 0)}
        </View>
      </View>
    </View>
  );
}
