/**
 * The reader. Four ways to read: right to left (manga), left to right
 * (comics), vertical pages, or one long webtoon strip. Pinch to zoom in
 * every mode (in the strip also double-tap, and drag sideways while zoomed;
 * see ZoomStrip), tap the sides to turn pages (left = forward in manga), tap
 * the middle for the controls: the chapter, how it reads, a page slider and
 * the chapters before and after. The page you are on is saved as you go;
 * reaching the last page marks the chapter read, and the end of a chapter
 * offers the next. The next few pages, and near the end the next chapter,
 * load ahead so turning a page never waits; the screen stays on while it is
 * open, and leaving the app ends the reading session (so stats stay true).
 *
 * Also: how a page fits (whole, width, height, its own size), page filters
 * (grey, warm, dimmed), auto-scroll in the long strip, a chapter list to jump
 * to, and holding a page for Use as cover, Share, Save to Photos or Reload.
 * The bars hide as soon as you swipe.
 * Presentational only (see types.ts).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  PixelRatio,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
} from 'react-native';
import { GatedModal as Modal } from '../screen';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { READING_MODES, chapterAfter, chapterLabel, modeOf, type MangaChapter, type ReadingMode } from '../../manga/mangaLogic';
import { AUTO_SCROLL_SPEEDS, DEFAULT_READER, HOLD_PAGE_EVERY, HOLD_SCROLL_SPEEDS, type ReaderPrefs } from '../../manga/sources/prefs';
import { pageSlots, slotOfPage } from '../../manga/readerLogic';
import type { ImageRef } from '../../manga/sources/types';
import { tick } from '../haptics';
import { allowRotation, restoreRotation } from '../../rotate';
import Icon from '../Icon';
import { OptionsSheet } from '../prompts';
import { usePalette } from '../theme';
import type { MangaActions, MangaUiSeries } from './mangaTypes';
import ZoomStrip from './ZoomStrip';

const END = '__end__';

/** One screen: a page, two pages side by side, or (img null) the end card. */
type Item = { key: string; img: ImageRef | null; index: number; pair?: ImageRef | null; pages?: number[] };

const PAGE_BG: Record<ReaderPrefs['page'], string> = { black: '#000', grey: '#2b2b2e', white: '#f4f4f2' };
const EMPTY: ReadonlySet<number> = new Set();
type Margins = { top: number; left: number; bottom: number; right: number; edge: string };
const FIT_LABEL: Record<ReaderPrefs['fit'], string> = { screen: 'Whole page', width: 'Width', height: 'Height', original: 'Its own size' };
const NEXT_FIT: Record<ReaderPrefs['fit'], ReaderPrefs['fit']> = { screen: 'width', width: 'height', height: 'original', original: 'screen' };
const FILTER_LABEL: Record<ReaderPrefs['filter'], string> = { none: 'None', gray: 'Grey', warm: 'Warm', dim: 'Dimmed' };
const NEXT_FILTER: Record<ReaderPrefs['filter'], ReaderPrefs['filter']> = { none: 'gray', gray: 'warm', warm: 'dim', dim: 'none' };
/** Laid over the pages: grey takes the colour out (saturation blend), warm tints, dim darkens. */
const FILTER: Record<Exclude<ReaderPrefs['filter'], 'none'>, object> = {
  gray: { backgroundColor: '#808080', mixBlendMode: 'saturation' },
  warm: { backgroundColor: 'rgba(255,140,40,0.22)', mixBlendMode: 'multiply' },
  dim: { backgroundColor: 'rgba(0,0,0,0.4)' },
};

/** One page in a paged mode: fills the screen, pinch to zoom, taps go to the reader. */
const PagedPage = memo(function PagedPage({
  img,
  pair,
  pages,
  rtl,
  width,
  height,
  onTap,
  onSize,
  onLong,
  fit = 'screen',
  margins,
}: {
  img: ImageRef;
  pair?: ImageRef | null;
  /** The page numbers shown (one, or two side by side). */
  pages?: number[];
  rtl?: boolean;
  width: number;
  height: number;
  onTap: (x: number) => void;
  /** A page's picture size, once it has loaded (wide pages stand alone in the two-page view). */
  onSize?: (page: number, w: number, h: number) => void;
  /** Held: the page's menu. */
  onLong?: (page: number) => void;
  fit?: ReaderPrefs['fit'];
  /** Crop borders: the page's plain margins, as fractions. */
  margins?: Margins | null;
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const sized = (page: number | undefined) => (e: { source: { width: number; height: number } }) => {
    if (page !== undefined) onSize?.(page, e.source.width, e.source.height);
    if (e.source.width > 0 && e.source.height > 0) setNatural((n) => (n && n.w === e.source.width && n.h === e.source.height ? n : { w: e.source.width, h: e.source.height }));
  };
  if (pair) {
    // Two pages side by side; in manga the first page is on the right.
    const [left, right] = rtl ? [pair, img] : [img, pair];
    const [leftPage, rightPage] = rtl ? [pages?.[1], pages?.[0]] : [pages?.[0], pages?.[1]];
    return (
      <ScrollView
        style={{ width, height }}
        contentContainerStyle={{ width, height }}
        maximumZoomScale={Platform.OS === 'ios' ? 4 : 1}
        minimumZoomScale={1}
        centerContent
        bouncesZoom
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}>
        <Pressable
          style={{ width, height, flexDirection: 'row' }}
          onPress={(e: GestureResponderEvent) => onTap(e.nativeEvent.locationX / width)}
          onLongPress={(e: GestureResponderEvent) => {
            const p = e.nativeEvent.locationX < width / 2 ? leftPage : rightPage;
            if (p !== undefined) onLong?.(p);
          }}
          delayLongPress={450}>
          <Image source={left} style={{ width: width / 2, height }} contentFit="contain" contentPosition="right" transition={0} recyclingKey={left.uri} onLoad={sized(leftPage)} />
          <Image source={right} style={{ width: width / 2, height }} contentFit="contain" contentPosition="left" transition={0} recyclingKey={right.uri} onLoad={sized(rightPage)} />
        </Pressable>
      </ScrollView>
    );
  }
  // Fit: the whole page (default), the screen's width or height (scroll for the rest), or the picture's own size.
  // With Crop borders, only the part inside the plain margins is fitted (the rest is cut off).
  const m = margins ?? { top: 0, left: 0, bottom: 0, right: 0 };
  const fw = Math.max(0.3, 1 - m.left - m.right);
  const fh = Math.max(0.3, 1 - m.top - m.bottom);
  let box = { w: width, h: height };
  let pic: { w: number; h: number; x: number; y: number } | null = null;
  if (natural) {
    const vw = natural.w * fw;
    const vh = natural.h * fh;
    const scale = fit === 'width' ? width / vw : fit === 'height' ? height / vh : fit === 'original' ? 1 / PixelRatio.get() : Math.min(width / vw, height / vh);
    box = { w: Math.round(vw * scale), h: Math.round(vh * scale) };
    pic = { w: natural.w * scale, h: natural.h * scale, x: -m.left * natural.w * scale, y: -m.top * natural.h * scale };
  }
  const cw = Math.max(width, box.w);
  const ch = Math.max(height, box.h);
  return (
    <ScrollView
      style={{ width, height }}
      contentContainerStyle={{ width: cw, height: ch, alignItems: 'center', justifyContent: 'center' }}
      maximumZoomScale={Platform.OS === 'ios' ? 4 : 1}
      minimumZoomScale={1}
      centerContent
      bouncesZoom
      directionalLockEnabled
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}>
      <Pressable
        style={{ width: cw, height: ch, alignItems: 'center', justifyContent: 'center' }}
        onPress={(e: GestureResponderEvent) => onTap(Math.min(1, e.nativeEvent.pageX / width))}
        onLongPress={() => pages?.[0] !== undefined && onLong?.(pages[0])}
        delayLongPress={450}>
        <View style={{ width: box.w, height: box.h, overflow: 'hidden' }}>
          <Image
            source={img}
            style={pic ? { position: 'absolute', width: pic.w, height: pic.h, left: pic.x, top: pic.y } : { width: box.w, height: box.h }}
            contentFit="contain"
            transition={0}
            recyclingKey={img.uri}
            onLoad={sized(pages?.[0])}
          />
        </View>
      </Pressable>
    </ScrollView>
  );
});

/** One page of the webtoon strip: full width, as tall as the picture is. */
const StripPage = memo(function StripPage({
  img,
  width,
  aspect,
  onAspect,
  onTap,
  onLong,
}: {
  img: ImageRef;
  width: number;
  aspect: number;
  onAspect: (a: number) => void;
  onTap: () => void;
  onLong?: () => void;
}) {
  return (
    <Pressable onPress={onTap} onLongPress={onLong} delayLongPress={450}>
      <Image
        source={img}
        style={{ width, height: Math.round(width * aspect) }}
        contentFit="contain"
        transition={0}
        recyclingKey={img.uri}
        onLoad={(e) => {
          const { width: w, height: h } = e.source;
          if (w > 0 && h > 0) onAspect(h / w);
        }}
      />
    </Pressable>
  );
});

export default function MangaReader({
  series,
  chapter: startChapter,
  fromStart = false,
  actions,
  prefs = DEFAULT_READER,
  onPrefs,
  onClose,
  onOpenUrl,
}: {
  series: MangaUiSeries;
  chapter: MangaChapter;
  fromStart?: boolean;
  actions: Pick<MangaActions, 'loadPages' | 'saveProgress' | 'addRead' | 'update' | 'keepAwake' | 'setCoverFromImage' | 'sharePage' | 'savePage' | 'pageMargins' | 'volumeKeys'>;
  /** Tap zones, page colour, two pages side by side. */
  prefs?: ReaderPrefs;
  onPrefs?: (patch: Partial<ReaderPrefs>) => void;
  onClose: () => void;
  /** Chapters hosted on another website open there. */
  onOpenUrl?: (url: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const accent = usePalette().accent;
  const { width: W, height: H } = useWindowDimensions();
  const [chapterId, setChapterId] = useState(startChapter.id);
  // The newest copy of the chapter (read marks change while reading).
  const chapter = series.chapters.find((c) => c.id === chapterId) ?? startChapter;
  // Your own choice for this title first; then "open everything as a long strip"; then what suits the kind.
  const mode: ReadingMode = series.readingMode ?? (prefs.longStrip ? 'webtoon' : modeOf(series));
  // The pages arrive from the phone at once, or from the source over the network.
  const [loaded, setLoaded] = useState<{ chapterId: string; pages: ImageRef[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const resume = useRef(!(fromStart || chapter.readAt));
  const rawUris = loaded?.chapterId === chapter.id ? loaded.pages : null;
  const count = rawUris?.length ?? 0;
  const firstPage = useRef(0);
  const [page, setPage] = useState(0);
  const [reloadMap, setReloadMap] = useState<{ chapterId: string; n: Record<number, number> }>({ chapterId: '', n: {} });
  const uris = useMemo(() => {
    if (!rawUris) return null;
    const n = reloadMap.chapterId === chapter.id ? reloadMap.n : {};
    return Object.keys(n).length ? rawUris.map((u, i) => (n[i] && !u.uri.startsWith('file:') ? { ...u, uri: `${u.uri.replace(/#.*$/, '')}#r${n[i]}` } : u)) : rawUris;
  }, [rawUris, reloadMap, chapter.id]);
  const external = !chapter.folder && !!chapter.sourceUrl;
  // The next chapter, loaded while you read the end of this one.
  const ahead = useRef<{ chapterId: string; pages: ImageRef[] } | null>(null);
  useEffect(() => {
    if (external) return;
    let live = true;
    setLoadError(null);
    const early = ahead.current?.chapterId === chapter.id ? ahead.current.pages : null;
    (early ? Promise.resolve(early) : actions.loadPages(series, chapter))
      .then((pages) => {
        if (!live) return;
        const at = resume.current ? Math.min(chapter.lastPage, Math.max(0, pages.length - 1)) : 0;
        firstPage.current = at;
        session.current = { startedAt: Date.now(), pages: new Set([at]) };
        setPage(at);
        setLoaded({ chapterId: chapter.id, pages });
      })
      .catch((e) => live && setLoadError(String(e).replace(/^Error:\s*/, '')));
    return () => {
      live = false;
    };
  }, [chapter.id, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const [chrome, setChrome] = useState(true);
  const [menu, setMenu] = useState(false);
  const [scrubAt, setScrubAt] = useState<number | null>(null);
  const [aspects, setAspects] = useState<Record<number, number>>({});
  /** A held page: its menu. */
  const [pageMenu, setPageMenu] = useState<number | null>(null);
  const [chapterList, setChapterList] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(''), 1800);
    return () => clearTimeout(t);
  }, [note]);
  // Crop borders and the page-coloured background: each page's margins, worked out on the phone (build 17 on).
  const [marginMap, setMarginMap] = useState<{ chapterId: string; m: Record<number, Margins | null> }>({ chapterId: '', m: {} });
  /** Auto-scroll (long strip): on or off, and where the strip is. */
  const [auto, setAuto] = useState(false);
  const offset = useRef(0);
  /** When the strip last moved: a double-tap right after a scroll is not a zoom. */
  const scrolledAt = useRef(0);
  const listRef = useRef<FlatList<Item>>(null);
  const atEnd = useRef(false);
  const session = useRef({ startedAt: Date.now(), pages: new Set<number>([0]) });
  const pageRef = useRef(0);
  pageRef.current = page;

  // The screen stays on while you read, and the reader turns with the phone
  // (sideways = two pages side by side); upright again when it closes.
  useEffect(() => {
    actions.keepAwake?.(true);
    allowRotation();
    return () => {
      actions.keepAwake?.(false);
      restoreRotation();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const prev = chapterAfter(series, chapter.id, -1);
  const next = chapterAfter(series, chapter.id, 1);
  const paged = mode === 'rtl' || mode === 'ltr';
  const rtl = mode === 'rtl';

  // Sideways, in page modes: two pages per screen (the cover on its own).
  const spread = paged && prefs.spreads && W > H * 1.15;
  // Pages found to be double pages (wider than tall), per chapter.
  const [wide, setWide] = useState<{ chapterId: string; pages: Set<number> }>({ chapterId: '', pages: new Set() });
  const widePages = wide.chapterId === chapter.id ? wide.pages : EMPTY;
  const onSize = useCallback(
    (page: number, w: number, h: number) => {
      if (w <= h * 1.1) return;
      setWide((cur) => {
        const base = cur.chapterId === chapter.id ? cur.pages : EMPTY;
        if (base.has(page)) return cur;
        const next = new Set(base);
        next.add(page);
        return { chapterId: chapter.id, pages: next };
      });
    },
    [chapter.id]
  );
  const slots = useMemo(() => pageSlots(count, spread, widePages), [count, spread, widePages]);
  const S = slots.length;
  const slotOf = useCallback((page: number) => (page >= count ? S : slotOfPage(slots, page)), [slots, count, S]);

  // Screens in order (right to left: reversed, so swiping left goes back), plus the end card.
  const items: Item[] = useMemo(() => {
    const list: Item[] = slots.map((sl, i) => ({ key: `${chapter.id}:${sl.join('-')}`, img: uris![sl[0]], pair: sl.length > 1 ? uris![sl[1]] : null, index: i, pages: sl }));
    list.push({ key: `${chapter.id}:${END}`, img: null, index: S });
    return rtl ? list.reverse() : list;
  }, [uris, chapter.id, slots, S, rtl]);
  /** A screen's place in the list. */
  const toList = useCallback((slot: number) => (rtl ? S - slot : slot), [rtl, S]);

  /* ------------------------------------------------------------ saving */

  // Set while the app is in the background: that session was already saved.
  const away = useRef(false);
  const endSession = useCallback(() => {
    if (away.current) return;
    const s = session.current;
    actions
      .addRead({ seriesId: series.id, chapterId: chapter.id, startedAt: s.startedAt, readMs: Date.now() - s.startedAt, pages: s.pages.size })
      .catch(() => undefined);
  }, [actions, series.id, chapter.id]);

  // Where you are, saved shortly after you stop turning pages.
  useEffect(() => {
    if (!count) return;
    const finished = page >= count - 1 || atEnd.current;
    const t = setTimeout(() => actions.saveProgress(series.id, chapter.id, Math.min(page, count - 1), finished).catch(() => undefined), finished ? 0 : 700);
    return () => clearTimeout(t);
  }, [page, count, actions, series.id, chapter.id]);

  // Leaving the app ends this reading session; coming back starts a new one.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background' && !away.current) {
        endSession();
        away.current = true;
      } else if (st === 'active' && away.current) {
        away.current = false;
        session.current = { startedAt: Date.now(), pages: new Set([pageRef.current]) };
      }
    });
    return () => sub.remove();
  }, [endSession]);

  // The next pages load ahead (pages on the phone need nothing).
  useEffect(() => {
    if (!uris) return;
    const soon = uris.slice(page + 1, page + 5).filter((u) => !u.uri.startsWith('file:'));
    if (!soon.length) return;
    const byHeaders = new Map<string, { headers?: Record<string, string>; urls: string[] }>();
    for (const u of soon) {
      const k = JSON.stringify(u.headers ?? {});
      const g = byHeaders.get(k) ?? { headers: u.headers, urls: [] };
      g.urls.push(u.uri);
      byHeaders.set(k, g);
    }
    for (const g of byHeaders.values()) Image.prefetch(g.urls, { headers: g.headers, cachePolicy: 'memory-disk' }).catch(() => undefined);
  }, [uris, page]);

  // Close to the end: get the next chapter ready, and its first pages.
  useEffect(() => {
    if (!count || page < count - 4 || !next || (!next.folder && next.sourceUrl) || ahead.current?.chapterId === next.id) return;
    let live = true;
    actions
      .loadPages(series, next)
      .then((pages) => {
        if (!live) return;
        ahead.current = { chapterId: next.id, pages };
        const first = pages.slice(0, 3).filter((u) => !u.uri.startsWith('file:'));
        if (first.length) Image.prefetch(first.map((u) => u.uri), { headers: first[0].headers, cachePolicy: 'memory-disk' }).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [count, page, next?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    endSession();
    onClose();
  };

  const openChapter = (c: MangaChapter | null, startAt: 'start' | 'end' = 'start') => {
    if (!c) return;
    tick();
    endSession();
    void startAt;
    resume.current = false;
    atEnd.current = false;
    firstPage.current = 0;
    setAspects({});
    setPage(0);
    setChapterId(c.id);
  };

  const wantMargins = !!actions.pageMargins && (prefs.crop || prefs.autoBg) && (paged || mode === 'vertical');
  useEffect(() => {
    if (!wantMargins || !rawUris) return;
    const have = marginMap.chapterId === chapter.id ? marginMap.m : {};
    const todo = [page - 1, page, page + 1, page + 2].filter((i) => i >= 0 && i < rawUris.length && !(i in have));
    if (!todo.length) return;
    let live = true;
    (async () => {
      for (const i of todo) {
        const found = await actions.pageMargins!(rawUris[i]).catch(() => null);
        if (!live) return;
        setMarginMap((cur) => ({ chapterId: chapter.id, m: { ...(cur.chapterId === chapter.id ? cur.m : {}), [i]: found } }));
      }
    })();
    return () => {
      live = false;
    };
  }, [wantMargins, rawUris, page, chapter.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const marginsOf = (i: number | undefined) => (i === undefined || !prefs.crop || marginMap.chapterId !== chapter.id ? null : (marginMap.m[i] ?? null));
  const edgeBg = prefs.autoBg && marginMap.chapterId === chapter.id ? marginMap.m[page]?.edge || null : null;

  // Auto-scroll: the strip moves down by itself; touching it stops it.
  useEffect(() => {
    if (!auto || mode !== 'webtoon') return;
    const pxPerSec = AUTO_SCROLL_SPEEDS[prefs.autoSpeed - 1] ?? 60;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      offset.current += (pxPerSec * (now - last)) / 1000;
      last = now;
      listRef.current?.scrollToOffset({ offset: offset.current, animated: false });
      if (atEnd.current) setAuto(false);
    }, 16);
    return () => clearInterval(id);
  }, [auto, mode, prefs.autoSpeed]);

  /* ------------------------------------------- the volume buttons (build 18) */

  /** A held button: which way, and until when it counts as still held. */
  const hold = useRef({ dir: 0, until: 0, lastKey: 0, lastTurn: 0, held: false });
  const volumeTurn = useRef<(forward: boolean) => void>(() => undefined);
  // The latest actions, so a parent that rebuilds them every render does not restart the listener.
  const volumeKeysRef = useRef(actions.volumeKeys);
  volumeKeysRef.current = actions.volumeKeys;
  const hasVolumeKeys = !!actions.volumeKeys;
  useEffect(() => {
    if (!prefs.volumeKeys || !volumeKeysRef.current) return;
    return volumeKeysRef.current((key) => {
      const forward = (key === 'down') !== prefs.volumeInvert;
      const dir = forward ? 1 : -1;
      const now = Date.now();
      const h = hold.current;
      // Presses close together the same way: the button is being held.
      const held = now - h.lastKey < 450 && h.dir === dir;
      h.lastKey = now;
      h.dir = dir;
      h.held = held;
      h.until = now + 450;
      setChrome(false);
      setAuto(false);
      if (mode === 'webtoon') {
        if (!held) {
          offset.current = Math.max(0, offset.current + dir * H * 0.7);
          listRef.current?.scrollToOffset({ offset: offset.current, animated: true });
        }
        return;
      }
      const every = HOLD_PAGE_EVERY[prefs.holdSpeed - 1] ?? 650;
      if (!held || now - h.lastTurn >= every) {
        h.lastTurn = now;
        volumeTurn.current(forward);
      }
    });
  }, [prefs.volumeKeys, prefs.volumeInvert, prefs.holdSpeed, mode, H, hasVolumeKeys]);

  // Holding a button in the long strip: a smooth scroll while it is held.
  useEffect(() => {
    if (!prefs.volumeKeys || !hasVolumeKeys || mode !== 'webtoon') return;
    const pxPerSec = HOLD_SCROLL_SPEEDS[prefs.holdSpeed - 1] ?? 490;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const h = hold.current;
      const dt = now - last;
      last = now;
      // The first press already jumped; scrolling runs once the button is clearly held.
      if (!h.held || now >= h.until) return;
      offset.current = Math.max(0, offset.current + (h.dir * pxPerSec * dt) / 1000);
      listRef.current?.scrollToOffset({ offset: offset.current, animated: false });
    }, 16);
    return () => clearInterval(id);
  }, [prefs.volumeKeys, prefs.holdSpeed, mode, hasVolumeKeys]);

  /* ------------------------------------------------------- moving about */

  const goTo = useCallback(
    (index: number, animated = true) => {
      const i = Math.max(0, Math.min(count, index));
      if (mode === 'webtoon') {
        if (i >= count) listRef.current?.scrollToEnd({ animated });
        else listRef.current?.scrollToIndex({ index: i, animated, viewPosition: 0 });
      } else listRef.current?.scrollToIndex({ index: toList(slotOf(i)), animated });
      atEnd.current = i >= count;
      if (i < count) {
        // Both pages of a spread count as seen; the later one is where you are.
        const sl = slots[slotOf(i)] ?? [i];
        for (const x of sl) session.current.pages.add(x);
        setPage(sl[sl.length - 1]);
      }
    },
    [count, mode, toList, slotOf, slots]
  );

  // Back to the right page whenever the chapter or mode changes (and after a rotation).
  useEffect(() => {
    const t = setTimeout(() => goTo(firstPage.current, false), 30);
    return () => clearTimeout(t);
  }, [chapter.id, mode, W, uris, spread]); // eslint-disable-line react-hooks/exhaustive-deps

  // A double page found while reading regroups the screens: stay on the same page.
  const wideCount = widePages.size;
  useEffect(() => {
    if (!spread || !wideCount) return;
    const t = setTimeout(() => goTo(pageRef.current, false), 30);
    return () => clearTimeout(t);
  }, [wideCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTapPage = useCallback(
    (x: number) => {
      if (!prefs.tapZones || (x > 0.3 && x < 0.7)) {
        setChrome((c) => !c);
        return;
      }
      const left = x <= 0.3;
      const forward = (rtl ? left : !left) !== prefs.tapInvert;
      setChrome(false);
      const at = slotOf(page);
      goTo(forward ? (slots[at + 1]?.[0] ?? count) : (slots[at - 1]?.[0] ?? 0));
    },
    [rtl, page, goTo, prefs.tapZones, prefs.tapInvert, slotOf, slots, count]
  );
  const toggleChrome = useCallback(() => setChrome((c) => !c), []);
  volumeTurn.current = (forward: boolean) => {
    const at = slotOf(page);
    goTo(forward ? (slots[at + 1]?.[0] ?? count) : (slots[at - 1]?.[0] ?? 0));
  };

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset } = e.nativeEvent;
    const pos = mode === 'vertical' ? Math.round(contentOffset.y / H) : Math.round(contentOffset.x / W);
    const slot = rtl ? S - pos : pos;
    atEnd.current = slot >= S;
    if (slot >= S) {
      setPage(count - 1);
      return;
    }
    const sl = slots[Math.max(0, slot)] ?? [0];
    for (const x of sl) session.current.pages.add(x);
    setPage(sl[sl.length - 1]);
  };

  // Webtoon: the page at the top of the screen is the one you are on.
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<Item>[] }) => {
    const first = viewableItems.find((v) => v.item && v.item.img);
    const last = viewableItems[viewableItems.length - 1];
    if (last?.item && last.item.img === null) atEnd.current = true;
    if (first?.item) {
      session.current.pages.add(first.item.index);
      setPage(first.item.index);
    }
  }).current;

  /* --------------------------------------------------------------- views */

  const endCard = (
    <View style={[{ width: W, height: mode === 'webtoon' ? Math.max(320, H * 0.6) : H }, s.end]}>
      <Text style={s.endSmall}>Finished</Text>
      <Text style={s.endTitle}>{chapterLabel(chapter)}</Text>
      {next ? (
        <TouchableOpacity style={[s.endBtn, { backgroundColor: accent }]} onPress={() => openChapter(next)}>
          <Text style={s.endBtnText}>Next: {chapterLabel(next, true)}</Text>
          <Icon name="forward" size={14} color="#fff" weight="bold" />
        </TouchableOpacity>
      ) : (
        <Text style={s.endHint}>You are all caught up with {series.title}.</Text>
      )}
      <TouchableOpacity style={s.endGhost} onPress={close}>
        <Text style={s.endGhostText}>Back to the series</Text>
      </TouchableOpacity>
    </View>
  );

  const renderPaged = ({ item }: { item: Item }) =>
    item.img === null ? (
      endCard
    ) : (
      <PagedPage
        img={item.img}
        pair={item.pair}
        pages={item.pages}
        rtl={rtl}
        width={W}
        height={H}
        fit={prefs.fit}
        margins={item.pair ? null : marginsOf(item.pages?.[0])}
        onTap={onTapPage}
        onSize={spread ? onSize : undefined}
        onLong={setPageMenu}
      />
    );

  const renderStrip = ({ item }: { item: Item }) =>
    item.img === null ? (
      endCard
    ) : (
      <StripPage
        img={item.img}
        width={W}
        aspect={aspects[item.index] ?? 1.45}
        onAspect={(a) => setAspects((m) => (Math.abs((m[item.index] ?? 0) - a) < 0.001 ? m : { ...m, [item.index]: a }))}
        onTap={toggleChrome}
        onLong={() => setPageMenu(item.index)}
      />
    );

  const stripItems = useMemo(() => (rtl ? [...items].reverse() : items), [items, rtl]);

  /* -------------------------------------------------------------- slider */

  const [barW, setBarW] = useState(1);
  const fromTouch = (x: number) => {
    const f = Math.max(0, Math.min(1, x / barW));
    const pos = Math.round((rtl ? 1 - f : f) * Math.max(0, count - 1));
    return pos;
  };
  const shown = scrubAt ?? page;
  const fill = count > 1 ? shown / (count - 1) : 1;

  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={close} supportedOrientations={['portrait', 'landscape']}>
      <StatusBar hidden={!chrome} animated barStyle="light-content" />
      <View style={[s.screen, { backgroundColor: edgeBg ?? PAGE_BG[prefs.page] }]}>
        {!count ? (
          <View style={s.empty}>
            {external ? (
              <>
                <Text style={s.endTitle}>This chapter is on another website</Text>
                <Text style={s.endHint}>It is published there (often the official site), so it opens in Safari.</Text>
                {onOpenUrl && chapter.sourceUrl && (
                  <TouchableOpacity style={[s.endBtn, { backgroundColor: accent }]} onPress={() => onOpenUrl(chapter.sourceUrl!)}>
                    <Text style={s.endBtnText}>Open the website</Text>
                  </TouchableOpacity>
                )}
              </>
            ) : loadError ? (
              <>
                <Text style={s.endTitle}>The pages did not load</Text>
                <Text style={s.endHint}>{loadError}</Text>
                <TouchableOpacity style={[s.endBtn, { backgroundColor: accent }]} onPress={() => setAttempt((n) => n + 1)}>
                  <Text style={s.endBtnText}>Try again</Text>
                </TouchableOpacity>
              </>
            ) : !uris ? (
              <>
                <ActivityIndicator color="#fff" />
                <Text style={s.endHint}>{chapter.folder ? 'Opening…' : 'Loading the pages…'}</Text>
              </>
            ) : (
              <Text style={s.endTitle}>This chapter has no pages</Text>
            )}
            {next && (external || loadError) && (
              <TouchableOpacity style={s.endGhost} onPress={() => openChapter(next)}>
                <Text style={s.endGhostText}>Next: {chapterLabel(next, true)}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.endGhost} onPress={close}>
              <Text style={s.endGhostText}>Back</Text>
            </TouchableOpacity>
          </View>
        ) : mode === 'webtoon' ? (
          <ZoomStrip width={W} height={H} resetKey={chapter.id} lastScrollAt={scrolledAt}>
          <FlatList
            key={`strip:${chapter.id}`}
            ref={listRef}
            data={stripItems}
            keyExtractor={(i) => i.key}
            renderItem={renderStrip}
            initialNumToRender={4}
            maxToRenderPerBatch={4}
            windowSize={7}
            onViewableItemsChanged={onViewable}
            viewabilityConfig={{ itemVisiblePercentThreshold: 1, minimumViewTime: 120 }}
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
              setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0 }), 120);
            }}
            showsVerticalScrollIndicator={false}
            onScroll={(e) => {
              offset.current = e.nativeEvent.contentOffset.y;
              scrolledAt.current = Date.now();
            }}
            scrollEventThrottle={32}
            onScrollBeginDrag={() => {
              setChrome(false);
              setAuto(false);
            }}
          />
          </ZoomStrip>
        ) : (
          <FlatList
            key={`paged:${chapter.id}:${mode}:${W}:${spread}`}
            ref={listRef}
            data={items}
            keyExtractor={(i) => i.key}
            renderItem={renderPaged}
            horizontal={paged}
            pagingEnabled
            initialNumToRender={3}
            maxToRenderPerBatch={3}
            windowSize={5}
            initialScrollIndex={paged ? toList(slotOf(firstPage.current)) : firstPage.current}
            getItemLayout={(_, index) => (paged ? { length: W, offset: W * index, index } : { length: H, offset: H * index, index })}
            onMomentumScrollEnd={settle}
            onScrollBeginDrag={() => setChrome(false)}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          />
        )}

        {count > 0 && prefs.filter !== 'none' && <View style={[s.overlay, FILTER[prefs.filter]]} pointerEvents="none" />}

        {chrome && count > 0 && (
          <>
            <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={[s.top, { paddingTop: insets.top + 6 }]}>
              <TouchableOpacity style={s.circle} onPress={close} accessibilityLabel="Close the reader">
                <Icon name="close" size={15} color="#fff" weight="bold" />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={s.topTitle} numberOfLines={1}>
                  {series.title}
                </Text>
                <Text style={s.topSub} numberOfLines={1}>
                  {chapterLabel(chapter)}
                </Text>
              </View>
              {series.chapters.length > 1 && (
                <TouchableOpacity style={s.circle} onPress={() => setChapterList(true)} accessibilityLabel="Chapters">
                  <Icon name="chapters" size={15} color="#fff" />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.circle} onPress={() => setMenu(true)} accessibilityLabel="How it reads">
                <Icon name="bookOpen" size={15} color="#fff" />
              </TouchableOpacity>
            </Animated.View>

            <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={[s.bottom, { paddingBottom: insets.bottom + 10 }]}>
              <View style={s.pageRow}>
                <TouchableOpacity style={[s.chBtn, !(rtl ? next : prev) && s.dim]} disabled={!(rtl ? next : prev)} onPress={() => openChapter(rtl ? next : prev)} accessibilityLabel={rtl ? 'Next chapter' : 'Previous chapter'}>
                  <Icon name="prevVideo" size={15} color="#fff" />
                </TouchableOpacity>
                <View
                  style={s.track}
                  onLayout={(e: LayoutChangeEvent) => setBarW(Math.max(1, e.nativeEvent.layout.width))}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={(e) => setScrubAt(fromTouch(e.nativeEvent.locationX))}
                  onResponderMove={(e) => setScrubAt(fromTouch(e.nativeEvent.locationX))}
                  onResponderRelease={(e) => {
                    const at = fromTouch(e.nativeEvent.locationX);
                    setScrubAt(null);
                    goTo(at, false);
                  }}
                  onResponderTerminate={() => setScrubAt(null)}>
                  <View style={s.trackLine}>
                    <View style={[s.trackFill, { backgroundColor: accent }, rtl ? { right: 0, width: `${fill * 100}%` } : { left: 0, width: `${fill * 100}%` }]} />
                  </View>
                  <View style={[s.knob, { left: (rtl ? 1 - fill : fill) * barW - 9 }]} />
                </View>
                <TouchableOpacity style={[s.chBtn, !(rtl ? prev : next) && s.dim]} disabled={!(rtl ? prev : next)} onPress={() => openChapter(rtl ? prev : next)} accessibilityLabel={rtl ? 'Previous chapter' : 'Next chapter'}>
                  <Icon name="nextVideo" size={15} color="#fff" />
                </TouchableOpacity>
              </View>
              <View style={s.pageLine}>
                <Text style={s.pageText}>
                  Page {shown + 1} of {count}
                </Text>
                {mode === 'webtoon' && (
                  <>
                    <TouchableOpacity
                      style={[s.autoBtn, auto && { backgroundColor: accent }]}
                      onPress={() => {
                        tick();
                        setAuto(!auto);
                        if (!auto) setChrome(false);
                      }}
                      accessibilityLabel={auto ? 'Stop scrolling' : 'Scroll by itself'}>
                      <Icon name={auto ? 'pause' : 'play'} size={11} color="#fff" />
                      <Text style={s.autoText}>Auto</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={s.autoBtn}
                      onPress={() => onPrefs?.({ autoSpeed: (prefs.autoSpeed % 10) + 1 })}
                      accessibilityLabel={`Auto-scroll speed ${prefs.autoSpeed} of 10`}>
                      <Text style={s.autoText}>Speed {prefs.autoSpeed}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </Animated.View>
          </>
        )}
        {!!note && (
          <View style={s.note} pointerEvents="none">
            <Text style={s.noteText}>{note}</Text>
          </View>
        )}
        {scrubAt !== null && (
          <View style={s.scrubBadge} pointerEvents="none">
            <Text style={s.scrubText}>{scrubAt + 1}</Text>
          </View>
        )}
      </View>

      {pageMenu !== null && uris?.[pageMenu] && (
        <OptionsSheet
          title={`Page ${pageMenu + 1}`}
          options={[
            ...(actions.setCoverFromImage
              ? [{ label: 'Use as the cover', onPress: () => void actions.setCoverFromImage!(series.id, rawUris![pageMenu]).then(() => setNote('Cover changed')).catch((e) => setNote(String(e?.message ?? e))) }]
              : []),
            ...(actions.sharePage ? [{ label: 'Share', onPress: () => void actions.sharePage!(rawUris![pageMenu]).catch((e) => setNote(String(e?.message ?? e))) }] : []),
            ...(actions.savePage
              ? [
                  {
                    label: 'Save to Photos',
                    onPress: () =>
                      void actions.savePage!(rawUris![pageMenu])
                        .then((ok) => setNote(ok ? 'Saved to Photos' : 'ReelVault may not add to Photos (Settings › ReelVault › Photos)'))
                        .catch((e) => setNote(String(e?.message ?? e))),
                  },
                ]
              : []),
            ...(!rawUris![pageMenu].uri.startsWith('file:')
              ? [
                  {
                    label: 'Reload this page',
                    hint: 'If it came out broken or blank',
                    onPress: () =>
                      setReloadMap((cur) => {
                        const n = cur.chapterId === chapter.id ? { ...cur.n } : {};
                        n[pageMenu] = (n[pageMenu] ?? 0) + 1;
                        return { chapterId: chapter.id, n };
                      }),
                  },
                ]
              : []),
          ]}
          onClose={() => setPageMenu(null)}
        />
      )}
      {chapterList && (
        <OptionsSheet
          title={series.title}
          options={(() => {
            const at = series.chapters.findIndex((c) => c.id === chapter.id);
            const from = Math.max(0, at - 30);
            return series.chapters.slice(from, from + 60).map((c) => ({
              label: chapterLabel(c, true),
              hint: c.id === chapter.id ? 'Reading now' : c.readAt ? 'Read' : c.folder ? 'On the phone' : undefined,
              onPress: () => {
                if (c.id !== chapter.id) openChapter(c);
              },
            }));
          })()}
          onClose={() => setChapterList(false)}
        />
      )}
      {menu && (
        <OptionsSheet
          title="How it reads"
          options={[
            ...READING_MODES.map((m) => ({
              label: m.label,
              hint: `${m.hint}${m.key === mode ? '  ✓' : ''}`,
              onPress: () => {
                firstPage.current = page;
                actions.update([series.id], { readingMode: m.key }).catch(() => undefined);
              },
            })),
            ...(onPrefs
              ? [
                  {
                    label: `Tap the sides to turn · ${prefs.tapZones ? 'On' : 'Off'}`,
                    hint: prefs.tapZones ? 'Off: every tap shows the controls; swipe to turn' : 'On: tap near the left or right edge to turn the page',
                    onPress: () => onPrefs({ tapZones: !prefs.tapZones }),
                  },
                  ...(prefs.tapZones
                    ? [
                        {
                          label: `Tap sides the other way · ${prefs.tapInvert ? 'On' : 'Off'}`,
                          hint: rtl ? (prefs.tapInvert ? 'Now: right side goes forward' : 'Now: left side goes forward (manga)') : prefs.tapInvert ? 'Now: left side goes forward' : 'Now: right side goes forward',
                          onPress: () => onPrefs({ tapInvert: !prefs.tapInvert }),
                        },
                      ]
                    : []),
                  {
                    label: `Around the pages · ${prefs.page === 'black' ? 'Black' : prefs.page === 'grey' ? 'Grey' : 'White'}`,
                    hint: 'Tap to change: black, grey, white',
                    onPress: () => onPrefs({ page: prefs.page === 'black' ? 'grey' : prefs.page === 'grey' ? 'white' : 'black' }),
                  },
                  ...(paged || mode === 'vertical'
                    ? [
                        {
                          label: `Page fit · ${FIT_LABEL[prefs.fit]}`,
                          hint: 'Tap to change: whole page, width, height, its own size',
                          onPress: () => onPrefs({ fit: NEXT_FIT[prefs.fit] }),
                        },
                      ]
                    : []),
                  ...(actions.pageMargins && (paged || mode === 'vertical')
                    ? [
                        {
                          label: `Crop borders · ${prefs.crop ? 'On' : 'Off'}`,
                          hint: 'Cuts the white or black margins off scans',
                          onPress: () => onPrefs({ crop: !prefs.crop }),
                        },
                        {
                          label: `Background from the page · ${prefs.autoBg ? 'On' : 'Off'}`,
                          hint: 'Around the page: the colour of its own edges',
                          onPress: () => onPrefs({ autoBg: !prefs.autoBg }),
                        },
                      ]
                    : []),
                  ...(actions.volumeKeys
                    ? [
                        {
                          label: `Volume buttons · ${prefs.volumeKeys ? 'Turn pages' : 'Off'}`,
                          hint: prefs.volumeKeys ? 'Press to turn a page, hold to keep scrolling' : 'On: the volume buttons turn pages and scroll',
                          onPress: () => onPrefs({ volumeKeys: !prefs.volumeKeys }),
                        },
                        ...(prefs.volumeKeys
                          ? [
                              {
                                label: `Volume buttons the other way · ${prefs.volumeInvert ? 'On' : 'Off'}`,
                                hint: prefs.volumeInvert ? 'Now: volume up goes forward' : 'Now: volume down goes forward',
                                onPress: () => onPrefs({ volumeInvert: !prefs.volumeInvert }),
                              },
                              {
                                label: `Holding speed · ${prefs.holdSpeed} of 10`,
                                hint: 'How fast holding a volume button scrolls or turns pages; tap for faster',
                                onPress: () => onPrefs({ holdSpeed: (prefs.holdSpeed % 10) + 1 }),
                              },
                            ]
                          : []),
                      ]
                    : []),
                  {
                    label: `Auto-scroll speed · ${prefs.autoSpeed} of 10`,
                    hint: 'Long strip: tap Auto at the bottom to start, touch the page to stop; tap here for faster',
                    onPress: () => onPrefs({ autoSpeed: (prefs.autoSpeed % 10) + 1 }),
                  },
                  {
                    label: `Page filter · ${FILTER_LABEL[prefs.filter]}`,
                    hint: 'Tap to change: none, grey, warm (night), dimmed',
                    onPress: () => onPrefs({ filter: NEXT_FILTER[prefs.filter] }),
                  },
                  {
                    label: `Open titles as a long strip · ${prefs.longStrip ? 'On' : 'Off'}`,
                    hint: 'Scroll down instead of turning pages, for titles you have not chosen a way for',
                    onPress: () => {
                      firstPage.current = page;
                      onPrefs({ longStrip: !prefs.longStrip });
                    },
                  },
                  {
                    label: `Two pages when sideways · ${prefs.spreads ? 'On' : 'Off'}`,
                    hint: 'Turn the phone sideways to read pages side by side, like a book',
                    onPress: () => {
                      firstPage.current = page;
                      onPrefs({ spreads: !prefs.spreads });
                    },
                  },
                ]
              : []),
          ]}
          onClose={() => setMenu(false)}
        />
      )}
    </Modal>
  );
}

// The reader is always dark, whatever the app's look: pages read best on black.
const s = {
  screen: { flex: 1, backgroundColor: '#000' },
  empty: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 14, padding: 30 },
  top: { position: 'absolute' as const, top: 0, left: 0, right: 0, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 14, paddingBottom: 12, backgroundColor: 'rgba(0,0,0,0.72)' },
  circle: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center' as const, justifyContent: 'center' as const },
  topTitle: { color: '#fff', fontSize: 16, fontWeight: '800' as const },
  topSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  bottom: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, paddingHorizontal: 14, paddingTop: 12, gap: 6, backgroundColor: 'rgba(0,0,0,0.72)' },
  pageRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  chBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center' as const, justifyContent: 'center' as const },
  dim: { opacity: 0.35 },
  track: { flex: 1, height: 38, justifyContent: 'center' as const },
  trackLine: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' as const },
  trackFill: { position: 'absolute' as const, top: 0, bottom: 0 },
  knob: { position: 'absolute' as const, width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', top: 10 },
  overlay: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 },
  pageLine: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 10 },
  autoBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.14)' },
  autoText: { color: '#fff', fontSize: 12, fontWeight: '800' as const },
  note: { position: 'absolute' as const, alignSelf: 'center' as const, top: '46%' as const, backgroundColor: 'rgba(0,0,0,0.8)', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, maxWidth: '86%' as const },
  noteText: { color: '#fff', fontSize: 14, fontWeight: '700' as const, textAlign: 'center' as const },
  pageText: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700' as const, textAlign: 'center' as const, fontVariant: ['tabular-nums' as const] },
  scrubBadge: { position: 'absolute' as const, alignSelf: 'center' as const, top: '42%' as const, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 16, paddingHorizontal: 22, paddingVertical: 12 },
  scrubText: { color: '#fff', fontSize: 30, fontWeight: '900' as const, fontVariant: ['tabular-nums' as const] },
  end: { alignItems: 'center' as const, justifyContent: 'center' as const, gap: 12, paddingHorizontal: 30, backgroundColor: '#000' },
  endSmall: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '800' as const, letterSpacing: 0.8, textTransform: 'uppercase' as const },
  endTitle: { color: '#fff', fontSize: 22, fontWeight: '900' as const, textAlign: 'center' as const },
  endHint: { color: 'rgba(255,255,255,0.7)', fontSize: 15, textAlign: 'center' as const },
  endBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 13, marginTop: 6 },
  endBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' as const },
  endGhost: { paddingHorizontal: 18, paddingVertical: 10 },
  endGhostText: { color: 'rgba(255,255,255,0.75)', fontSize: 15, fontWeight: '700' as const },
};
