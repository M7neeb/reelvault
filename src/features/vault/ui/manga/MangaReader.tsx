/**
 * The reader. Four ways to read: right to left (manga), left to right
 * (comics), vertical pages, or one long webtoon strip. Pinch a page to zoom
 * (paged modes), tap the sides to turn pages (left = forward in manga), tap
 * the middle for the controls: the chapter, how it reads, a page slider and
 * the chapters before and after. The page you are on is saved as you go;
 * reaching the last page marks the chapter read, and the end of a chapter
 * offers the next. The next few pages, and near the end the next chapter,
 * load ahead so turning a page never waits; the screen stays on while it is
 * open, and leaving the app ends the reading session (so stats stay true).
 * Presentational only (see types.ts).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Modal,
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
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { READING_MODES, chapterAfter, chapterLabel, modeOf, type MangaChapter, type ReadingMode } from '../../manga/mangaLogic';
import { DEFAULT_READER, type ReaderPrefs } from '../../manga/sources/prefs';
import { pageSlots, slotOfPage } from '../../manga/readerLogic';
import type { ImageRef } from '../../manga/sources/types';
import { tick } from '../haptics';
import Icon from '../Icon';
import { OptionsSheet } from '../prompts';
import { usePalette } from '../theme';
import type { MangaActions, MangaUiSeries } from './mangaTypes';

const END = '__end__';

/** One screen: a page, two pages side by side, or (img null) the end card. */
type Item = { key: string; img: ImageRef | null; index: number; pair?: ImageRef | null };

const PAGE_BG: Record<ReaderPrefs['page'], string> = { black: '#000', grey: '#2b2b2e', white: '#f4f4f2' };

/** One page in a paged mode: fills the screen, pinch to zoom, taps go to the reader. */
const PagedPage = memo(function PagedPage({ img, pair, rtl, width, height, onTap }: { img: ImageRef; pair?: ImageRef | null; rtl?: boolean; width: number; height: number; onTap: (x: number) => void }) {
  if (pair) {
    // Two pages side by side; in manga the first page is on the right.
    const [left, right] = rtl ? [pair, img] : [img, pair];
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
        <Pressable style={{ width, height, flexDirection: 'row' }} onPress={(e: GestureResponderEvent) => onTap(e.nativeEvent.locationX / width)}>
          <Image source={left} style={{ width: width / 2, height }} contentFit="contain" contentPosition="right" transition={0} recyclingKey={left.uri} />
          <Image source={right} style={{ width: width / 2, height }} contentFit="contain" contentPosition="left" transition={0} recyclingKey={right.uri} />
        </Pressable>
      </ScrollView>
    );
  }
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
      <Pressable style={{ width, height }} onPress={(e: GestureResponderEvent) => onTap(e.nativeEvent.locationX / width)}>
        <Image source={img} style={{ width, height }} contentFit="contain" transition={0} recyclingKey={img.uri} />
      </Pressable>
    </ScrollView>
  );
});

/** One page of the webtoon strip: full width, as tall as the picture is. */
const StripPage = memo(function StripPage({ img, width, aspect, onAspect, onTap }: { img: ImageRef; width: number; aspect: number; onAspect: (a: number) => void; onTap: () => void }) {
  return (
    <Pressable onPress={onTap}>
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
  actions: Pick<MangaActions, 'loadPages' | 'saveProgress' | 'addRead' | 'update' | 'keepAwake'>;
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
  const mode: ReadingMode = modeOf(series);
  // The pages arrive from the phone at once, or from the source over the network.
  const [loaded, setLoaded] = useState<{ chapterId: string; pages: ImageRef[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const resume = useRef(!(fromStart || chapter.readAt));
  const uris = loaded?.chapterId === chapter.id ? loaded.pages : null;
  const count = uris?.length ?? 0;
  const firstPage = useRef(0);
  const [page, setPage] = useState(0);
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
  const listRef = useRef<FlatList<Item>>(null);
  const atEnd = useRef(false);
  const session = useRef({ startedAt: Date.now(), pages: new Set<number>([0]) });
  const pageRef = useRef(0);
  pageRef.current = page;

  // The screen stays on while you read.
  useEffect(() => {
    actions.keepAwake?.(true);
    return () => actions.keepAwake?.(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const prev = chapterAfter(series, chapter.id, -1);
  const next = chapterAfter(series, chapter.id, 1);
  const paged = mode === 'rtl' || mode === 'ltr';
  const rtl = mode === 'rtl';

  // Sideways, in page modes: two pages per screen (the cover on its own).
  const spread = paged && prefs.spreads && W > H * 1.15;
  const slots = useMemo(() => pageSlots(count, spread), [count, spread]);
  const S = slots.length;
  const slotOf = useCallback((page: number) => (page >= count ? S : slotOfPage(slots, page)), [slots, count, S]);

  // Screens in order (right to left: reversed, so swiping left goes back), plus the end card.
  const items: Item[] = useMemo(() => {
    const list: Item[] = slots.map((sl, i) => ({ key: `${chapter.id}:${sl.join('-')}`, img: uris![sl[0]], pair: sl.length > 1 ? uris![sl[1]] : null, index: i }));
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
    item.img === null ? endCard : <PagedPage img={item.img} pair={item.pair} rtl={rtl} width={W} height={H} onTap={onTapPage} />;

  const renderStrip = ({ item }: { item: Item }) =>
    item.img === null ? (
      endCard
    ) : (
      <StripPage img={item.img} width={W} aspect={aspects[item.index] ?? 1.45} onAspect={(a) => setAspects((m) => (Math.abs((m[item.index] ?? 0) - a) < 0.001 ? m : { ...m, [item.index]: a }))} onTap={toggleChrome} />
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
      <View style={[s.screen, { backgroundColor: PAGE_BG[prefs.page] }]}>
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
            onScrollBeginDrag={() => setChrome(false)}
          />
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
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          />
        )}

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
              <Text style={s.pageText}>
                Page {shown + 1} of {count}
              </Text>
            </Animated.View>
          </>
        )}
        {scrubAt !== null && (
          <View style={s.scrubBadge} pointerEvents="none">
            <Text style={s.scrubText}>{scrubAt + 1}</Text>
          </View>
        )}
      </View>

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
