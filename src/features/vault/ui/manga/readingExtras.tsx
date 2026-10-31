/**
 * The parts of the reading Wrapped that show your pages up close:
 * - Name that panel: a part of a page from one of your top titles, up close;
 *   pick the title, then the camera pulls back to the whole page. (A title
 *   with no page on the phone uses a close-up of its cover instead.)
 * - Your speed: pages turning at the pace you really read at.
 * - Your thumb: a long strip racing by, for how far you scrolled.
 * - A page a month (or a week, or a day): the title of each part of the
 *   range, as a row of framed pages sliding by.
 * - Where you left off: the very page you stopped on, with a bookmark.
 * Presentational only.
 */

import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming, ZoomIn } from 'react-native-reanimated';

import type { MangaChapter } from '../../manga/mangaLogic';
import type { ImageRef } from '../../manga/sources/types';
import { success, warn } from '../haptics';
import Icon from '../Icon';
import { useReducedMotion } from '../motion';
import { Marquee, Tilt } from '../storyKit';
import { sheet, useStyles } from '../theme';
import MangaCover from './MangaCover';
import { PageFlip, PageStrip, type Pic } from './mangaKit';
import type { MangaUiSeries } from './mangaTypes';
import { PageScene, usePageBank } from './pageScenes';

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/* ------------------------------------------------------------ panel quiz */

/**
 * "Which title is this panel from?": `options` are titles (the answer is the
 * first one that has a page to show; the rest are decoys), shown in a
 * shuffled order.
 */
export function PanelQuiz({ options, seed }: { options: MangaUiSeries[]; seed: number }) {
  const styles = useStyles(makeStyles);
  const bank = usePageBank();
  const reduce = useReducedMotion();
  // The answer: the first title with pages; settled once, so it never changes under your finger.
  const [answer] = useState(() => options.find((o) => (bank.byTitle.get(o.id)?.length ?? 0) > 0) ?? options[0]);
  const pics = bank.byTitle.get(answer.id) ?? [];
  const [pic] = useState<Pic | null>(() => (pics.length ? pics[Math.floor(rand(seed) * pics.length)] : null));
  const order = useMemo(() => [...options].sort((a, b) => rand(seed + a.title.length) - rand(seed + b.title.length)), [options, seed]);
  const [picked, setPicked] = useState<string | null>(null);
  const size = 240;
  const zoom = useSharedValue(2.8);
  useEffect(() => {
    if (picked !== null) zoom.value = reduce ? 1 : withTiming(1, { duration: 900, easing: Easing.inOut(Easing.cubic) });
  }, [picked, reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const fx = (rand(seed + 7) - 0.5) * size * 0.5;
  const fy = (rand(seed + 9) - 0.5) * size * 0.6;
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: zoom.value }, { translateX: (fx * (zoom.value - 1)) / zoom.value }, { translateY: (fy * (zoom.value - 1)) / zoom.value }] }));
  return (
    <View style={{ gap: 12, alignItems: 'stretch' }}>
      <View style={[styles.quizFrame, { height: size }]}>
        <Animated.View style={[StyleSheet.absoluteFill, anim]}>
          {pic ? (
            <Image source={pic.source} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" transition={0} />
          ) : answer.coverSource ? (
            <Image source={answer.coverSource} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} />
          ) : null}
        </Animated.View>
        {picked === null && (
          <View style={styles.quizMark}>
            <Text style={styles.quizMarkText}>?</Text>
          </View>
        )}
      </View>
      {order.map((o) => {
        const show = picked !== null;
        const right = o.id === answer.id;
        return (
          <TouchableOpacity
            key={o.id}
            disabled={show}
            onPress={() => {
              setPicked(o.id);
              if (right) success();
              else warn();
            }}
            style={[styles.opt, show && right && styles.optRight, show && picked === o.id && !right && styles.optWrong, show && !right && picked !== o.id && { opacity: 0.45 }]}>
            <MangaCover series={o} width={30} radius={5} />
            <Text style={styles.optText} numberOfLines={1}>
              {o.title}
            </Text>
            {show && right && <Icon name="check" size={18} color="#fff" weight="bold" />}
          </TouchableOpacity>
        );
      })}
      {picked !== null && (
        <Animated.Text entering={ZoomIn} style={styles.result}>
          {picked === answer.id ? 'You know your panels.' : `It was ${answer.title}.`}
        </Animated.Text>
      )}
    </View>
  );
}

/* ----------------------------------------------------------------- speed */

/** Pages turning at your own pace (at least one turn a second, so it never looks stuck). */
export function SpeedFlip({ secondsPerPage }: { secondsPerPage: number }) {
  const bank = usePageBank();
  const [pics] = useState(() => bank.all.slice(-8));
  const live = pics.length ? pics : bank.all.slice(0, 8);
  if (!live.length) return <PageScene i={5} />;
  return <PageFlip pages={live} every={Math.max(1000, Math.min(4000, secondsPerPage * 1000))} rtl />;
}

/* ---------------------------------------------------------------- scroll */

/** A long strip racing by (the tallest pages there are). */
export function RacingStrip() {
  const bank = usePageBank();
  const [pics] = useState(() => {
    const tall = bank.all.filter((p) => (p.aspect ?? 1.45) >= 1.8);
    return (tall.length >= 3 ? tall : bank.all).slice(0, 8);
  });
  if (!pics.length) return <PageScene i={0} />;
  return <PageStrip pages={pics} perScreen={700} />;
}

/* -------------------------------------------------------------- timeline */

/** One framed page for each part of the range (a month, a week, a day), sliding by. */
export function PageTimeline({ periods, byId }: { periods: { label: string; seriesId: string | null }[]; byId: Map<string, MangaUiSeries> }) {
  const styles = useStyles(makeStyles);
  const bank = usePageBank();
  // Each time a title comes back, the next of its pages (so the row never shows the same page twice).
  const cells = useMemo(() => {
    const used = new Map<string, number>();
    return periods.map((p) => {
      const s = p.seriesId ? byId.get(p.seriesId) : undefined;
      const own = s ? bank.byTitle.get(s.id) ?? [] : [];
      const n = s ? used.get(s.id) ?? 0 : 0;
      if (s) used.set(s.id, n + 1);
      return { label: p.label, s, pic: own.length ? own[n % own.length] : null };
    });
  }, [periods, byId, bank]);
  const w = 104;
  return (
    <Marquee ms={Math.max(9000, cells.length * 1500)} style={{ marginHorizontal: -28, marginTop: 10 }}>
      {cells.map((c, k) => (
        <View key={k} style={{ width: w + 12, alignItems: 'center', gap: 6 }}>
          <View style={[styles.cell, { width: w, height: w * 1.45, transform: [{ rotate: `${k % 2 ? 2 : -2}deg` }] }]}>
            {c.pic ? (
              <Image source={c.pic.source} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" transition={0} />
            ) : c.s ? (
              <MangaCover series={c.s} width={w - 6} radius={0} />
            ) : (
              <View style={styles.emptyCell}>
                <Text style={styles.emptyText}>—</Text>
              </View>
            )}
          </View>
          <Text style={styles.cellLabel}>{c.label}</Text>
          <Text style={styles.cellTitle} numberOfLines={1}>
            {c.s?.title ?? 'A break'}
          </Text>
        </View>
      ))}
    </Marquee>
  );
}

/* ------------------------------------------------------------- left off */

/** The page you stopped on, framed, with a bookmark ribbon over it. */
export function StopPage({ series, chapter, page, loadPages }: { series: MangaUiSeries; chapter: MangaChapter; page: number; loadPages: (s: MangaUiSeries, c: MangaChapter) => Promise<ImageRef[]> }) {
  const styles = useStyles(makeStyles);
  const [ref, setRef] = useState<ImageRef | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadPages(series, chapter)
      .then((list) => live && setRef(list[Math.min(page, list.length - 1)] ?? null))
      .catch(() => live && setRef(null));
    return () => {
      live = false;
    };
  }, [series, chapter, page, loadPages]);
  const w = 190;
  return (
    <Tilt rotate={-3} delay={250} style={{ alignSelf: 'center', marginVertical: 10 }}>
      <View style={[styles.stopFrame, { width: w, height: w * 1.45 }]}>
        {ref ? (
          <Image source={{ uri: ref.uri, headers: ref.headers }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition="top" transition={200} />
        ) : (
          <MangaCover series={series} width={w - 8} radius={0} />
        )}
        <Animated.View entering={ZoomIn.delay(700).springify()} style={styles.ribbon}>
          <Icon name="bookmark" size={22} color="#fff" />
        </Animated.View>
        <View style={styles.pageNo}>
          <Text style={styles.pageNoText}>p. {page + 1}</Text>
        </View>
      </View>
    </Tilt>
  );
}

const makeStyles = () =>
  sheet({
    quizFrame: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#f4f1ea', borderWidth: 3, borderColor: '#fff' },
    quizMark: { position: 'absolute', right: 10, top: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
    quizMarkText: { color: '#FFD60A', fontSize: 24, fontWeight: '900' },
    opt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, padding: 8, paddingRight: 14, borderWidth: 2, borderColor: 'transparent' },
    optRight: { backgroundColor: 'rgba(48,209,88,0.35)', borderColor: '#30D158' },
    optWrong: { backgroundColor: 'rgba(255,69,58,0.3)', borderColor: '#FF453A' },
    optText: { flex: 1, color: '#fff', fontSize: 16, fontWeight: '800' },
    result: { color: '#fff', fontSize: 18, fontWeight: '800', textAlign: 'center' },
    cell: { backgroundColor: '#fff', borderWidth: 3, borderColor: '#fff', overflow: 'hidden' },
    emptyCell: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
    emptyText: { color: 'rgba(255,255,255,0.6)', fontSize: 28, fontWeight: '900' },
    cellLabel: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 0.6 },
    cellTitle: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '700', maxWidth: 104 },
    stopFrame: { backgroundColor: '#fff', borderWidth: 4, borderColor: '#fff', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 18, shadowOffset: { width: 0, height: 10 } },
    ribbon: { position: 'absolute', top: -2, right: 18, width: 34, height: 52, backgroundColor: '#FF375F', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 8, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
    pageNo: { position: 'absolute', bottom: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    pageNoText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  });
