/**
 * The living backgrounds of the reading Wrapped, made only of your pages.
 *
 * A page bank loads pages from many of the titles you read (the top ones
 * first), once, while the story is open. Each card then gets one of eighteen
 * layouts (see pageDirector.ts for the order and how pages are dealt so none
 * repeats on a card):
 *   strip    a long strip scrolling by itself
 *   twin     two strips side by side, scrolling opposite ways
 *   flip     pages turning one after another
 *   triptych three tall panels, a slow camera in each
 *   camera   a slow camera move down one page
 *   river    tilted columns of pages flowing
 *   volume   a manga page: four panels of different pages dropping in
 *   slash    three diagonal action panels sliding in from both sides
 *   focus    one panel up close with speed lines around it
 *   scatter  pages tossed onto a table one by one
 *   spread   an open book, pages turning over the spine
 *   mosaic   a contact sheet of pages, one lighting up after another
 *   blinds   pages changing in slats, like shutters turning
 *   cinema   widescreen: a panel at a time between black bars, hard cuts
 *   zoomout  from one panel up close out to a wall of pages
 *   dealt    pages dealt onto a pile
 *   coverwall a tilted wall of your covers drifting
 *   poster   one big cover, two pages peeking out behind it
 * A card about one title uses that title's own pages when there are any, and
 * pages of your other titles when there are none (never just its cover).
 * Covers are one look among the rest (the wall and the poster), and fill in
 * while the first pages load or when no page of any title can be shown. With Reduce Motion on, scenes hold still.
 * Presentational only.
 */

import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { Easing, FadeIn, Keyframe, SlideInLeft, SlideInRight, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming, ZoomIn } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { COVER_LAYOUTS, deal, layoutFor, NEEDS, titleLayout, type Layout } from '../../manga/pageDirector';
import { EASE_OUT, useReducedMotion } from '../motion';
import { Equalizer, FilmStrips, ImageRiver, Scanlines, Screentone, Vinyl } from '../scenes';
import { CoverWall, KenBurns } from '../storyKit';
import { useWindowDimensions } from '../screen';
import type { ThumbSource } from '../types';
import { PageFlip, PageStrip, PanelMontage, type PageLoader, type Pic } from './mangaKit';
import type { MangaUiSeries } from './mangaTypes';

/* ------------------------------------------------------------------- bank */

export type PageBank = {
  /** Every page loaded, a page from each title in turn (titles loaded later go after). */
  all: Pic[];
  byTitle: Map<string, Pic[]>;
  /** Shown only while pages load, or when there are none at all. */
  covers: ThumbSource[];
  /** Titles whose pages have been asked for (with or without luck). */
  tried: Set<string>;
  /** Every title has been tried. */
  ready: boolean;
};

const EMPTY: PageBank = { all: [], byTitle: new Map(), covers: [], tried: new Set(), ready: false };
const BankCtx = createContext<PageBank>(EMPTY);
export const PageBankProvider = BankCtx.Provider;
export const usePageBank = () => useContext(BankCtx);

/** Width pages are decoded at (sharp enough full screen under the shade, small enough to keep many). */
const BANK_WIDTH = 540;
/** At most this many pixels of pages in memory (about 90 MB), and this many pages. */
const BANK_PIXELS = 22_000_000;
const BANK_PAGES = 64;

/**
 * Loads pages from `ids` (most important first), three titles at a time,
 * up to 8 pages each (skipping a title's first page, usually its cover or
 * credits), until the memory budget is used.
 */
export function useBankLoader(load: PageLoader | null | undefined, ids: string[], covers: ThumbSource[]): PageBank {
  const [bank, setBank] = useState<PageBank>(() => ({ ...EMPTY, covers, tried: new Set(), ready: !load || !ids.length }));
  const key = ids.join('|');
  useEffect(() => {
    if (!load || !ids.length) {
      setBank({ ...EMPTY, covers, ready: true });
      return;
    }
    let live = true;
    (async () => {
      const byTitle = new Map<string, Pic[]>();
      const tried = new Set<string>();
      const all: Pic[] = [];
      let pixels = 0;
      for (let k = 0; k < ids.length && live; k += 3) {
        const batch = ids.slice(k, k + 3);
        const got = await Promise.all(batch.map((id) => load.pages(id, { maxWidth: BANK_WIDTH, max: 9 }).catch(() => [] as Pic[])));
        if (!live) return;
        const lists = got.map((list) => (list.length >= 4 ? list.slice(1) : list));
        batch.forEach((id, j) => {
          tried.add(id);
          if (lists[j].length) byTitle.set(id, lists[j]);
        });
        // A page from each title in turn, so pages next to each other are from different titles.
        const longest = Math.max(0, ...lists.map((l) => l.length));
        for (let p = 0; p < longest; p++)
          for (const l of lists) {
            const pic = l[p];
            if (!pic || all.length >= BANK_PAGES) continue;
            all.push(pic);
            pixels += BANK_WIDTH * BANK_WIDTH * Math.min(8, pic.aspect ?? 1.45);
          }
        setBank({ all: [...all], byTitle: new Map(byTitle), covers, tried: new Set(tried), ready: false });
        if (pixels >= BANK_PIXELS || all.length >= BANK_PAGES) break;
      }
      if (live) setBank({ all, byTitle, covers, tried, ready: true });
    })().catch(() => live && setBank((b) => ({ ...b, ready: true })));
    return () => {
      live = false;
    };
  }, [load, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return bank;
}

/* ---------------------------------------------------------------- helpers */

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

const ASPECT = 1.45;

/**
 * Part of a page in a frame of `w` x `h`: zoomed in `zoom` times on one spot,
 * drifting slowly to another (a camera over the paper).
 */
const Crop = memo(function Crop({ pic, w, h, zoom = 1.6, seed = 0, ms = 9000, blur }: { pic: Pic; w: number; h: number; zoom?: number; seed?: number; ms?: number; blur?: number }) {
  const reduce = useReducedMotion();
  const aspect = Math.min(8, pic.aspect ?? ASPECT);
  const imgW = Math.max(w * zoom, (h / aspect) * 1.05);
  const imgH = imgW * aspect;
  const spanX = Math.max(0, imgW - w);
  const spanY = Math.max(0, imgH - h);
  const from = { x: rand(seed + 1), y: rand(seed + 2) * 0.85 };
  const to = { x: rand(seed + 3), y: Math.min(1, from.y + 0.08 + rand(seed + 4) * 0.2) };
  const k = useSharedValue(0);
  useEffect(() => {
    if (!reduce) k.value = withTiming(1, { duration: ms, easing: Easing.inOut(Easing.quad) });
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({
    transform: [{ translateX: -spanX * (from.x + (to.x - from.x) * k.value) }, { translateY: -spanY * (from.y + (to.y - from.y) * k.value) }],
  }));
  return (
    <View style={{ width: w, height: h, overflow: 'hidden', backgroundColor: '#f4f1ea' }}>
      <Animated.View style={anim}>
        <Image source={pic.source} style={{ width: imgW, height: imgH }} contentFit="cover" contentPosition="top" transition={0} blurRadius={blur} />
      </Animated.View>
    </View>
  );
});

/** A page blurred and dark, filling the card (behind a book, a pile or a wall). */
function Blurred({ pic }: { pic: Pic | undefined }) {
  const { width, height } = useWindowDimensions();
  if (!pic) return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#14110d' }]} />;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Crop pic={pic} w={width} h={height} zoom={1.3} blur={18} ms={14000} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.45)' }]} />
    </View>
  );
}

/** A panel: a black border round part of a page. */
function Frame({ children, style }: { children: ReactNode; style?: object }) {
  return <View style={[{ borderWidth: 3, borderColor: '#0b0b0b', overflow: 'hidden', backgroundColor: '#fff' }, style]}>{children}</View>;
}

/* ---------------------------------------------------------------- layouts */

function Twin({ pics }: { pics: Pic[] }) {
  const { width } = useWindowDimensions();
  const half = (width - 6) / 2;
  const a = pics.filter((_, k) => k % 2 === 0);
  const b = pics.filter((_, k) => k % 2 === 1);
  return (
    <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', gap: 6, backgroundColor: '#fff' }]}>
      <PageStrip pages={a} width={half} />
      <PageStrip pages={b.length ? b : a} width={half} reverse />
    </View>
  );
}

function Triptych({ pics, seed }: { pics: Pic[]; seed: number }) {
  const { width, height } = useWindowDimensions();
  const g = 6;
  const w = (width - g * 4) / 3 - 6;
  return (
    <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', gap: g, padding: g, backgroundColor: '#fff' }]}>
      {pics.slice(0, 3).map((p, k) => (
        <Animated.View key={k} entering={FadeIn.delay(k * 180).duration(400)}>
          <Frame>
            <Crop pic={p} w={w} h={height - g * 2 - 6} zoom={1.15 + k * 0.1} seed={seed + k} ms={9000 + k * 1500} />
          </Frame>
        </Animated.View>
      ))}
    </View>
  );
}

const panelIn = (k: number) => ZoomIn.delay(120 + k * 380).springify().damping(14);

/** A manga page: a wide panel, two side by side (slanted), a wide one below, each a different page. */
function Volume({ pics, seed }: { pics: Pic[]; seed: number }) {
  const { width, height } = useWindowDimensions();
  const pad = 10;
  const inner = width - pad * 2;
  const h1 = height * 0.27;
  const h2 = height * 0.33;
  const h3 = height - pad * 2 - h1 - h2 - pad * 2;
  const reduce = useReducedMotion();
  const p = (k: number) => pics[k % pics.length];
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#f4f1ea', padding: pad, gap: pad }]}>
      <Screentone opacity={0.12} />
      <Animated.View entering={reduce ? undefined : panelIn(0)}>
        <Frame>
          <Crop pic={p(0)} w={inner - 6} h={h1 - 6} zoom={1.25} seed={seed} />
        </Frame>
      </Animated.View>
      <View style={{ flexDirection: 'row', gap: pad, height: h2 }}>
        <Animated.View entering={reduce ? undefined : panelIn(1)} style={{ transform: [{ rotate: '-1.6deg' }] }}>
          <Frame>
            <Crop pic={p(1)} w={inner * 0.58 - pad / 2 - 6} h={h2 - 6} zoom={1.5} seed={seed + 1} />
          </Frame>
        </Animated.View>
        <Animated.View entering={reduce ? undefined : panelIn(2)} style={{ transform: [{ rotate: '1.6deg' }] }}>
          <Frame>
            <Crop pic={p(2)} w={inner * 0.42 - pad / 2 - 6} h={h2 - 6} zoom={1.8} seed={seed + 2} />
          </Frame>
        </Animated.View>
      </View>
      <Animated.View entering={reduce ? undefined : panelIn(3)}>
        <Frame>
          <Crop pic={p(3)} w={inner - 6} h={h3 - 6} zoom={1.35} seed={seed + 3} />
        </Frame>
      </Animated.View>
    </View>
  );
}

/** Three diagonal action panels sliding in from both sides. */
function Slash({ pics, seed }: { pics: Pic[]; seed: number }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const W = width * 1.9;
  const H = height * 1.25;
  const g = 10;
  const bandH = (H - g * 2) / 3;
  const tilt = seed % 2 ? -16 : 16;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }]}>
      <View style={{ width: W, height: H, gap: g, transform: [{ rotate: `${tilt}deg` }] }}>
        {[0, 1, 2].map((k) => (
          <Animated.View key={k} entering={reduce ? undefined : (k % 2 ? SlideInRight : SlideInLeft).delay(100 + k * 260).duration(520)} style={{ borderTopWidth: 3, borderBottomWidth: 3, borderColor: '#000' }}>
            <Crop pic={pics[k % pics.length]} w={W} h={bandH - 6} zoom={1.05} seed={seed + k} ms={8000} />
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

/** Speed lines: thin black wedges pointing at the middle, flickering a little. */
function SpeedLines({ count = 54 }: { count?: number }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const diag = Math.hypot(width, height);
  const j = useSharedValue(0);
  useEffect(() => {
    if (!reduce) j.value = withRepeat(withSequence(withTiming(1, { duration: 90 }), withTiming(0, { duration: 90 })), -1, false);
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ transform: [{ rotate: `${j.value * 1.2}deg` }, { scale: 1 + j.value * 0.02 }] }));
  const lines = useMemo(
    () =>
      Array.from({ length: count }, (_, k) => ({
        angle: (360 / count) * k + rand(k) * 4,
        inner: Math.min(width, height) * (0.3 + rand(k + 50) * 0.16),
        thick: 1.5 + rand(k + 99) * 4,
      })),
    [count, width, height]
  );
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, anim]}>
      {lines.map((l, k) => (
        <View key={k} style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${l.angle}deg` }] }]}>
          <View style={{ position: 'absolute', left: width / 2 + l.inner, top: height / 2 - l.thick / 2, width: diag, height: l.thick, backgroundColor: '#000', opacity: 0.85, borderTopLeftRadius: l.thick, borderBottomLeftRadius: l.thick }} />
        </View>
      ))}
    </Animated.View>
  );
}

/** One panel up close, pushing in, with speed lines round it. */
function Focus({ pics, seed }: { pics: Pic[]; seed: number }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const s = useSharedValue(1);
  useEffect(() => {
    if (!reduce) s.value = withTiming(1.18, { duration: 7000, easing: Easing.out(Easing.quad) });
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const push = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#fff', overflow: 'hidden' }]}>
      <Animated.View style={[StyleSheet.absoluteFill, push]}>
        <Crop pic={pics[0]} w={width} h={height} zoom={2.3} seed={seed} ms={7000} />
      </Animated.View>
      <SpeedLines />
    </View>
  );
}

const tossIn = (rot: number) =>
  new Keyframe({
    0: { opacity: 0, transform: [{ scale: 1.6 }, { rotate: `${rot + 25}deg` }] },
    100: { opacity: 1, transform: [{ scale: 1 }, { rotate: `${rot}deg` }], easing: EASE_OUT },
  }).duration(520);

/** Pages tossed onto a table one by one, the table moving slowly under them. */
function Scatter({ pics, seed }: { pics: Pic[]; seed: number }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const pw = width * 0.56;
  const spots = useMemo(
    () =>
      pics.map((p, k) => ({
        p,
        x: -width * 0.1 + rand(seed * 7 + k) * width * 0.62,
        y: -height * 0.04 + ((k + rand(seed + k * 3)) / pics.length) * height * 0.78,
        rot: (rand(seed + k * 11) - 0.5) * 34,
        h: pw * Math.min(1.6, p.aspect ?? ASPECT),
      })),
    [pics, seed, width, height, pw]
  );
  const pan = useSharedValue(0);
  useEffect(() => {
    if (!reduce) pan.value = withTiming(1, { duration: 9000, easing: Easing.linear });
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const drift = useAnimatedStyle(() => ({ transform: [{ translateY: -pan.value * 40 }, { rotate: `${pan.value * 2}deg` }] }));
  return (
    <View style={StyleSheet.absoluteFill}>
      <Blurred pic={pics[pics.length - 1]} />
      <Animated.View style={[StyleSheet.absoluteFill, drift]}>
        {spots.map((s, k) => (
          <Animated.View key={k} entering={reduce ? undefined : tossIn(s.rot).delay(80 + k * 620)} style={{ position: 'absolute', left: s.x, top: s.y, transform: [{ rotate: `${s.rot}deg` }], shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } }}>
            <View style={{ backgroundColor: '#fff', padding: 6 }}>
              <Image source={s.p.source} style={{ width: pw, height: s.h }} contentFit="cover" contentPosition="top" transition={0} />
            </View>
          </Animated.View>
        ))}
      </Animated.View>
    </View>
  );
}

/** An open book: two pages, the right one turning over the spine to the next two. */
function Spread({ pics }: { pics: Pic[] }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  // Big: the open book runs off both sides, so its pages fill the card.
  const pw = Math.min(width * 0.64, (height * 0.78) / ASPECT);
  const ph = pw * ASPECT;
  const pairs = Math.max(1, Math.floor(pics.length / 2));
  const [s, setS] = useState(0);
  const t = useSharedValue(0);
  const at = (k: number) => pics[k % pics.length];
  const advance = () => {
    t.value = 0;
    setS((n) => n + 1);
  };
  useEffect(() => {
    if (reduce || pairs < 2) return;
    const id = setInterval(() => {
      t.value = withTiming(2, { duration: 1000, easing: Easing.inOut(Easing.quad) }, (done) => {
        if (done) scheduleOnRN(advance);
      });
    }, 2800);
    return () => clearInterval(id);
  }, [reduce, pairs]); // eslint-disable-line react-hooks/exhaustive-deps
  const rightTurn = useAnimatedStyle(() => ({ opacity: t.value < 1 ? 1 : 0, transform: [{ perspective: 1400 }, { rotateY: `${-Math.min(1, t.value) * 90}deg` }] }));
  const leftTurn = useAnimatedStyle(() => ({ opacity: t.value >= 1 ? 1 : 0, transform: [{ perspective: 1400 }, { rotateY: `${Math.max(0, 2 - t.value) * 90}deg` }] }));
  const L = 2 * (s % pairs);
  const page = (pic: Pic) => <Image source={pic.source} style={{ width: pw, height: ph }} contentFit="cover" contentPosition="top" transition={0} />;
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      <Blurred pic={at(L)} />
      <Animated.View entering={reduce ? undefined : ZoomIn.springify().damping(15)} style={{ flexDirection: 'row', shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 22, shadowOffset: { width: 0, height: 14 } }}>
        <View style={{ backgroundColor: '#fff' }}>
          {page(at(L))}
          <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: 'right' }, leftTurn]}>{page(at(L + 2))}</Animated.View>
        </View>
        <View style={{ backgroundColor: '#fff' }}>
          {page(at(L + 3))}
          <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: 'left' }, rightTurn]}>{page(at(L + 1))}</Animated.View>
        </View>
        {/* The spine's shadow. */}
        <View pointerEvents="none" style={{ position: 'absolute', left: pw - 14, width: 28, top: 0, bottom: 0, flexDirection: 'row' }}>
          {[0.04, 0.1, 0.2, 0.32, 0.2, 0.1, 0.04].map((o, k) => (
            <View key={k} style={{ flex: 1, backgroundColor: `rgba(0,0,0,${o})` }} />
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

const Tile = memo(function Tile({ pic, w, h, lit }: { pic: Pic; w: number; h: number; lit: boolean }) {
  const s = useSharedValue(1);
  useEffect(() => {
    s.value = withTiming(lit ? 1.14 : 1, { duration: 320, easing: EASE_OUT });
  }, [lit]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }], zIndex: s.value > 1.01 ? 2 : 0 }));
  return (
    <Animated.View style={[{ width: w, height: h, borderWidth: lit ? 3 : 0, borderColor: '#FFD60A', backgroundColor: '#fff' }, anim]}>
      <Image source={pic.source} style={{ width: '100%', height: '100%', opacity: lit ? 1 : 0.72 }} contentFit="cover" contentPosition="top" transition={0} />
    </Animated.View>
  );
});

/** A contact sheet of pages drifting, one lighting up after another. */
function Mosaic({ pics, seed }: { pics: Pic[]; seed: number }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const cols = pics.length >= 12 ? 4 : 3;
  const g = 4;
  const tw = (width * 1.12 - g * (cols - 1)) / cols;
  const rows = Math.ceil(pics.length / cols);
  const th = Math.max(tw * ASPECT, (height * 1.1 - g * (rows - 1)) / rows);
  const [lit, setLit] = useState(-1);
  useEffect(() => {
    if (reduce) return;
    let n = 0;
    const id = setInterval(() => setLit(Math.floor(rand(seed * 13 + n++) * pics.length)), 900);
    return () => clearInterval(id);
  }, [reduce, pics.length, seed]);
  const k = useSharedValue(0);
  useEffect(() => {
    if (!reduce) k.value = withTiming(1, { duration: 10000, easing: Easing.linear });
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const over = Math.max(0, rows * (th + g) - height);
  const drift = useAnimatedStyle(() => ({ transform: [{ translateX: -k.value * width * 0.1 }, { translateY: -k.value * over }] }));
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', overflow: 'hidden' }]}>
      <Animated.View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: g, width: width * 1.12 + 1 }, drift]}>
        {pics.map((p, i) => (
          <Tile key={i} pic={p} w={tw} h={th} lit={i === lit} />
        ))}
      </Animated.View>
    </View>
  );
}

/** One slat of the shutters: turns away, changes page, turns back. */
const Slat = memo(function Slat({ pic, k, n }: { pic: Pic; k: number; n: number }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const sw = width / n;
  const [shown, setShown] = useState(pic);
  const r = useSharedValue(0);
  // The page itself never goes into the animation (it lives on this side only).
  const next = useRef(pic);
  next.current = pic;
  const swap = () => setShown(next.current);
  useEffect(() => {
    if (pic === shown) return;
    if (reduce) {
      setShown(pic);
      return;
    }
    r.value = withDelay(
      k * 70,
      withTiming(90, { duration: 180 }, (done) => {
        if (!done) return;
        scheduleOnRN(swap);
        r.value = withTiming(0, { duration: 200 });
      })
    );
  }, [pic]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ transform: [{ perspective: 900 }, { rotateY: `${r.value}deg` }] }));
  return (
    <Animated.View style={[{ width: sw, height, overflow: 'hidden', borderRightWidth: k < n - 1 ? 2 : 0, borderColor: '#000' }, anim]}>
      <Image source={shown.source} style={{ position: 'absolute', left: -k * sw, width, height }} contentFit="cover" contentPosition="top" transition={0} />
    </Animated.View>
  );
});

/** Pages changing in slats, like shutters turning. */
function Blinds({ pics }: { pics: Pic[] }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce || pics.length < 2) return;
    const id = setInterval(() => setI((n) => n + 1), 2300);
    return () => clearInterval(id);
  }, [reduce, pics.length]);
  const n = 7;
  return (
    <View style={[StyleSheet.absoluteFill, { flexDirection: 'row', backgroundColor: '#000' }]}>
      {Array.from({ length: n }, (_, k) => (
        <Slat key={k} pic={pics[i % pics.length]} k={k} n={n} />
      ))}
    </View>
  );
}

/** Widescreen: a panel at a time between black bars, cutting hard to the next. */
function Cinema({ pics, seed }: { pics: Pic[]; seed: number }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce || pics.length < 2) return;
    const id = setInterval(() => setI((n) => n + 1), 2200);
    return () => clearInterval(id);
  }, [reduce, pics.length]);
  const bar = height * 0.2;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
      <View style={{ position: 'absolute', top: bar, left: 0, width, height: height - bar * 2, overflow: 'hidden' }}>
        <Animated.View key={i} entering={reduce ? undefined : FadeIn.duration(140)}>
          <Crop pic={pics[i % pics.length]} w={width} h={height - bar * 2} zoom={1.25} seed={seed + i * 5} ms={2600} />
        </Animated.View>
        <Scanlines opacity={0.12} />
      </View>
    </View>
  );
}

/** From one page filling the card out to the wall of pages around it. */
function ZoomOut({ pics }: { pics: Pic[] }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const grid = pics.length >= 9 ? 3 : 1;
  const cols = 3;
  const g = 5;
  const tw = (width - g * 2) / cols;
  const th = tw * ASPECT;
  const gridH = th * grid + g * (grid - 1);
  const start = Math.max(width / tw, height / th) * 1.02;
  const s = useSharedValue(reduce ? 1 : start);
  useEffect(() => {
    if (!reduce) s.value = withDelay(500, withTiming(1, { duration: 3800, easing: Easing.inOut(Easing.cubic) }));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  // The page in the middle of the grid is the one up close at first.
  const order = grid === 3 ? [1, 2, 3, 4, 0, 5, 6, 7, 8] : [1, 0, 2];
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}>
      <Blurred pic={pics[1 % pics.length]} />
      <Animated.View style={[{ width, height: gridH, flexDirection: 'row', flexWrap: 'wrap', gap: g }, anim]}>
        {order.map((o, k) => (
          <View key={k} style={{ width: tw, height: th, backgroundColor: '#fff' }}>
            <Image source={pics[o % pics.length].source} style={{ width: '100%', height: '100%' }} contentFit="cover" contentPosition="top" transition={0} />
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

const dealIn = (rot: number, fromLeft: boolean) =>
  new Keyframe({
    0: { opacity: 0.6, transform: [{ translateX: fromLeft ? -500 : 500 }, { translateY: 60 }, { rotate: `${rot * 4}deg` }] },
    100: { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: `${rot}deg` }], easing: EASE_OUT },
  }).duration(560);

/** Pages dealt onto a pile, one after another. */
function Dealt({ pics, seed }: { pics: Pic[]; seed: number }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? pics.length : 1);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setN((x) => x + 1), 1100);
    return () => clearInterval(id);
  }, [reduce]);
  const pw = Math.min(width * 0.74, (height * 0.66) / ASPECT);
  const shown = Array.from({ length: Math.min(n, 4) }, (_, k) => n - Math.min(n, 4) + k);
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      <Blurred pic={pics[pics.length - 1]} />
      {shown.map((c) => {
        const rot = (rand(seed + c) - 0.5) * 14;
        return (
          <Animated.View key={c} entering={reduce ? undefined : dealIn(rot, c % 2 === 1)} style={{ position: 'absolute', transform: [{ rotate: `${rot}deg` }], backgroundColor: '#fff', padding: 5, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 16, shadowOffset: { width: 0, height: 10 } }}>
            <Image source={pics[c % pics.length].source} style={{ width: pw, height: pw * ASPECT }} contentFit="cover" contentPosition="top" transition={0} />
          </Animated.View>
        );
      })}
    </View>
  );
}

/** A big cover standing in the middle, a page or two peeking out behind it, its own colours blurred all round. */
function Poster({ cover, pics, seed }: { cover: ThumbSource; pics: Pic[]; seed: number }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const cw = width * 0.62;
  const s = useSharedValue(1);
  useEffect(() => {
    if (!reduce) s.value = withTiming(1.06, { duration: 8000, easing: Easing.inOut(Easing.quad) });
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const breathe = useAnimatedStyle(() => ({ transform: [{ scale: s.value }, { rotate: `${seed % 2 ? 3 : -3}deg` }] }));
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      <Image source={cover} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={30} transition={0} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
      {pics.slice(0, 2).map((p, k) => (
        <Animated.View key={k} entering={reduce ? undefined : (k ? SlideInRight : SlideInLeft).delay(500 + k * 200).duration(600)} style={{ position: 'absolute', top: height * (0.2 + k * 0.28), [k ? 'right' : 'left']: -width * 0.08, transform: [{ rotate: `${k ? 9 : -9}deg` }], backgroundColor: '#fff', padding: 4 }}>
          <Image source={p.source} style={{ width: width * 0.42, height: width * 0.42 * ASPECT }} contentFit="cover" contentPosition="top" transition={0} />
        </Animated.View>
      ))}
      <Animated.View entering={reduce ? undefined : ZoomIn.springify().damping(14)} style={[{ shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 24, shadowOffset: { width: 0, height: 14 } }, breathe]}>
        <Image source={cover} style={{ width: cw, height: cw * 1.42, borderRadius: 14 }} contentFit="cover" transition={0} />
      </Animated.View>
    </View>
  );
}

/* --------------------------------------------------------------- director */

/** Pictures circling round one in the middle, the ring turning slowly. */
function Orbit({ pics, seed }: { pics: Pic[]; seed: number }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const r = useSharedValue(0);
  useEffect(() => {
    if (!reduce) r.value = withRepeat(withTiming(1, { duration: 30000, easing: Easing.linear }), -1, false);
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const dir = seed % 2 ? -1 : 1;
  const ring = useAnimatedStyle(() => ({ transform: [{ rotate: `${dir * r.value * 360}deg` }] }));
  const upright = useAnimatedStyle(() => ({ transform: [{ rotate: `${-dir * r.value * 360}deg` }] }));
  const center = pics[0];
  const around = pics.slice(1);
  const R = Math.min(width, height) * 0.62;
  const tile = width * 0.24;
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      <Blurred pic={center} />
      <Animated.View style={[{ position: 'absolute', width: R * 2, height: R * 2 }, ring]}>
        {around.map((p, k) => {
          const a = (k / around.length) * Math.PI * 2;
          return (
            <Animated.View key={k} style={[{ position: 'absolute', left: R + Math.cos(a) * R - tile / 2, top: R + Math.sin(a) * R - tile * 0.7, shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 10 }, upright]}>
              <Image source={p.source} style={{ width: tile, height: tile * Math.min(1.5, Math.max(0.8, p.aspect ?? 1.4)), borderRadius: 10 }} contentFit="cover" transition={0} />
            </Animated.View>
          );
        })}
      </Animated.View>
      {center && (
        <Animated.View entering={reduce ? undefined : ZoomIn.springify().damping(13)} style={{ shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 20 }}>
          <Image source={center.source} style={{ width: width * 0.46, height: width * 0.46 * Math.min(1.5, Math.max(0.8, center.aspect ?? 1.4)), borderRadius: 16 }} contentFit="cover" transition={0} />
        </Animated.View>
      )}
    </View>
  );
}

/** A cover in the middle and an equalizer dancing along the bottom. */
function EqCover({ pic, seed }: { pic: Pic; seed: number }) {
  const { width } = useWindowDimensions();
  const reduce = useReducedMotion();
  return (
    <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
      <Blurred pic={pic} />
      <Animated.View entering={reduce ? undefined : ZoomIn.springify().damping(14)} style={{ transform: [{ rotate: seed % 2 ? '3deg' : '-3deg' }], shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 24, marginBottom: '20%' }}>
        <Image source={pic.source} style={{ width: width * 0.64, height: width * 0.64, borderRadius: 12 }} contentFit="cover" transition={0} />
      </Animated.View>
      <Equalizer color="#fff" bars={22} />
    </View>
  );
}

/**
 * One layout drawn with these pictures. `covers` feed the cover wall and the
 * poster (the bank's covers in the reading Wrapped; the pictures themselves
 * elsewhere).
 */
export function Layouted({ layout, pics, seed, covers: given }: { layout: Layout; pics: Pic[]; seed: number; covers?: ThumbSource[] }) {
  const { width, height } = useWindowDimensions();
  const bankCovers = usePageBank().covers;
  const covers = given ?? (bankCovers.length ? bankCovers : (pics.map((p) => p.source) as ThumbSource[]));
  switch (layout) {
    case 'kenburns':
      return <KenBurns source={pics[0].source as ThumbSource} ms={9000} seed={seed} fill />;
    case 'filmstrips':
      return (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
          <FilmStrips sources={pics.map((p) => p.source)} count={3} frame={96} />
        </View>
      );
    case 'vinyl':
      return (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
          <Blurred pic={pics[0]} />
          <Vinyl cover={pics[0].source} accent={['#FF375F', '#0A84FF', '#30D158', '#FF9F0A'][seed % 4]} />
        </View>
      );
    case 'orbit':
      return <Orbit pics={pics} seed={seed} />;
    case 'equalizer':
      return <EqCover pic={pics[0]} seed={seed} />;
    case 'coverwall':
      return (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
          <CoverWall sources={[...covers.slice(seed % Math.max(1, covers.length)), ...covers]} rows={5} tile={96} tilt={seed % 2 ? 12 : -12} />
        </View>
      );
    case 'poster':
      return <Poster cover={covers[(seed * 7) % Math.max(1, covers.length)]} pics={pics} seed={seed} />;
    case 'strip':
      return <PageStrip pages={pics} />;
    case 'twin':
      return <Twin pics={pics} />;
    case 'flip':
      return <PageFlip pages={pics} rtl={seed % 2 === 0} />;
    case 'triptych':
      return <Triptych pics={pics} seed={seed} />;
    case 'camera':
      return <Crop pic={pics[0]} w={width} h={height} zoom={1.5} seed={seed} ms={8000} />;
    case 'river':
      return (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
          <ImageRiver sources={pics.map((p) => p.source)} columns={3} aspect={ASPECT} tilt={seed % 2 ? 9 : -9} speed={1.1} />
        </View>
      );
    case 'volume':
      return <Volume pics={pics} seed={seed} />;
    case 'slash':
      return <Slash pics={pics} seed={seed} />;
    case 'focus':
      return <Focus pics={pics} seed={seed} />;
    case 'scatter':
      return <Scatter pics={pics} seed={seed} />;
    case 'spread':
      return <Spread pics={pics} />;
    case 'mosaic':
      return <Mosaic pics={pics} seed={seed} />;
    case 'blinds':
      return <Blinds pics={pics} />;
    case 'cinema':
      return <Cinema pics={pics} seed={seed} />;
    case 'zoomout':
      return <ZoomOut pics={pics} />;
    case 'dealt':
      return <Dealt pics={pics} seed={seed} />;
  }
}

// The browser preview can show one layout on every card (`&layout=spread`), to look at it closely.
const FORCED = (typeof window !== 'undefined' && window.location && !!window.location.search && new URLSearchParams(window.location.search).get('layout')) as Layout | null;

const isStrip = (s: MangaUiSeries | undefined) => !!s && (s.readingMode === 'webtoon' || (s.readingMode === null && s.kind !== 'comic' && s.kind !== 'manga'));

/**
 * The scene behind card `i`: pages of `focus` when it has some (a card about
 * one title), else pages from everything you read. Once it has shown pages it
 * keeps them, so nothing jumps while more pages load.
 */
export function PageScene({ i, focus, dim = 0 }: { i: number; focus?: MangaUiSeries; dim?: number }) {
  const bank = usePageBank();
  const own = focus ? bank.byTitle.get(focus.id) ?? [] : [];
  const pick = (): { layout: Layout; pics: Pic[] } | null => {
    if (own.length && !FORCED) {
      const layout = titleLayout(i, own.length, isStrip(focus));
      // Its own pages, starting somewhere else on each card about it.
      const from = (i * 3) % own.length;
      const pics = Array.from({ length: Math.min(own.length, NEEDS[layout].best) }, (_, k) => own[(from + k) % own.length]);
      return { layout, pics };
    }
    if (!bank.all.length) return null;
    let layout = FORCED && NEEDS[FORCED] ? FORCED : layoutFor(i, bank.all.length);
    // No covers: the next layout made of pages.
    for (let k = 1; COVER_LAYOUTS.includes(layout) && !bank.covers.length && k < 20; k++) layout = layoutFor(i + k, bank.all.length);
    return { layout, pics: deal(bank.all.length, i, layout).map((k) => bank.all[k]) };
  };
  const kept = useRef<{ layout: Layout; pics: Pic[] } | null>(null);
  if (!kept.current) {
    const p = pick();
    // A title's own pages settle at once; other pages once the layout has its best number of
    // them (or everything has loaded), and for a title only once its own pages turned out to be missing.
    const settled = !!p && (own.length > 0 || ((!focus || bank.ready || bank.tried.has(focus.id)) && (bank.ready || p.pics.length >= NEEDS[p.layout].best)));
    if (p && settled) kept.current = p;
    else if (p)
      return (
        <SceneShell dim={dim}>
          <Layouted layout={p.layout} pics={p.pics} seed={i} />
        </SceneShell>
      );
  }
  if (kept.current) {
    return (
      <SceneShell dim={dim}>
        <Layouted layout={kept.current.layout} pics={kept.current.pics} seed={i} />
      </SceneShell>
    );
  }
  // No page yet (loading), or none anywhere: covers flowing by.
  return (
    <SceneShell dim={dim}>
      <ImageRiver sources={bank.covers} columns={3} aspect={1.42} tilt={8} speed={0.9} />
    </SceneShell>
  );
}

function SceneShell({ children, dim }: { children: ReactNode; dim: number }) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', overflow: 'hidden' }]} pointerEvents="none">
      {children}
      <Screentone opacity={0.05} />
      {dim > 0 && <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${dim})` }]} />}
    </View>
  );
}

/** Quick cuts through panels of everything you read (the cold open). */
export function BankMontage() {
  const bank = usePageBank();
  const pics = bank.all.slice(0, 24);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} pointerEvents="none">
      {pics.length ? <PanelMontage pages={pics} every={380} /> : <ImageRiver sources={bank.covers} columns={3} aspect={1.42} tilt={-8} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.12)' }]} />
    </View>
  );
}

/** Pages of one title, or of everything, for a card body (a page to show in a frame). */
export function useTitlePics(id: string | null | undefined): Pic[] {
  const bank = usePageBank();
  return (id && bank.byTitle.get(id)) || [];
}

/**
 * The same layouts for any pictures (posters and stills, album covers):
 * card `i` gets the layout of `seq` at its place (stepping down when there
 * are too few pictures) and its own pictures from the pool, so two cards in a
 * row never look alike and no picture shows twice on one card.
 */
export function PicScene({ i, pics, seq, lead, dim = 0 }: { i: number; pics: Pic[]; seq: Layout[]; /** A card about one title: its own pictures, first and in the middle of the look. */ lead?: Pic[]; dim?: number }) {
  const own = (lead ?? []).filter(Boolean);
  const pool = own.length ? pics.filter((p) => !own.some((o) => o.source === p.source)) : pics;
  const total = own.length + pool.length;
  if (!total) return null;
  const layout = layoutFor(i, total, seq);
  const dealt = deal(pool.length, i, layout, seq).map((k) => pool[k]);
  const mine = [...own, ...dealt].slice(0, Math.max(own.length, NEEDS[layout].best, 1));
  return (
    <SceneShell dim={dim}>
      <Layouted layout={layout} pics={mine.length ? mine : [pics[i % pics.length]]} seed={i} covers={(own.length ? own : pics).map((p) => p.source) as ThumbSource[]} />
    </SceneShell>
  );
}
