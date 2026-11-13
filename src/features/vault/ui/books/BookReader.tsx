/**
 * Reading a book. One chapter at a time, scrolled like a page that never
 * ends; tap the text to bring up the bar (contents, the look of the page,
 * where you are). Your place is the paragraph at the top of the screen: it is
 * saved a moment after you stop scrolling, when you change chapter, close the
 * book or leave the app, and the book opens there next time. The page has its
 * own colours (paper, sepia, night), separate from the app's.
 * Presentational only (see the note at the top of types.ts).
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View, type ViewToken } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { chapterBlocks, type Block } from '../../audio/epub';
import {
  chapterLabel,
  countedMs,
  displayTitle,
  fmtLeft,
  fmtProgress,
  fracOfBlock,
  lineHeightFor,
  minutesLeft,
  progressAt,
  READER_SIZES,
  safeBlock,
  type ReaderPrefs,
  type ReaderTheme,
} from '../../books/bookLogic';
import { tick } from '../haptics';
import Icon from '../Icon';
import { GatedModal as Modal, useWindowDimensions } from '../screen';
import type { BookActions, BookUi, OpenedBook } from './bookTypes';

type Ink = { bg: string; text: string; soft: string; faint: string; rule: string; accent: string; bar: string; dark: boolean };

/** Warm, low-glare page colours; night is never pure white on pure black. */
export const INKS: Record<ReaderTheme, Ink> = {
  paper: { bg: '#FAF7F0', text: '#221E19', soft: '#6E665B', faint: '#A69E92', rule: '#E4DDD0', accent: '#A4522C', bar: '#F3EFE6', dark: false },
  sepia: { bg: '#F2E8D3', text: '#3A2E20', soft: '#7A6A52', faint: '#AE9E84', rule: '#DFD1B4', accent: '#9A4F24', bar: '#EADFC7', dark: false },
  night: { bg: '#141312', text: '#DAD4C8', soft: '#948C80', faint: '#5E5850', rule: '#2A2826', accent: '#D69467', bar: '#1C1B19', dark: true },
};
const THEME_NAMES: Record<ReaderTheme, string> = { paper: 'Paper', sepia: 'Sepia', night: 'Night' };

const SERIF = Platform.select({ ios: 'Charter', web: 'Charter, Georgia, "Times New Roman", serif', default: 'serif' });
const MAX_MEASURE = 620;

type Shown = { index: number; blocks: Block[]; ids: Record<string, number> };

type BlockProps = { block: Block; ink: Ink; prefs: ReaderPrefs; uriOf: (p: string) => string; first: boolean };

const BlockView = memo(function BlockView({ block: b, ink, prefs, uriOf, first }: BlockProps) {
  const [ratio, setRatio] = useState(1.5);
  const family = prefs.font === 'serif' ? SERIF : undefined;
  if (b.k === 'hr') return <View style={[styles.hr, { backgroundColor: ink.faint }]} />;
  if (b.k === 'img')
    return (
      <View style={styles.imgWrap}>
        <Image
          source={{ uri: uriOf(b.src) }}
          style={[styles.img, { aspectRatio: ratio }]}
          contentFit="contain"
          onLoad={(e) => {
            const { width, height } = e.source;
            if (width && height) setRatio(width / height);
          }}
          accessibilityLabel={b.alt || 'Picture'}
        />
      </View>
    );
  const size = prefs.size;
  const head = b.k === 'h1' || b.k === 'h2' || b.k === 'h3' || b.k === 'h4';
  const scale = b.k === 'h1' ? 1.45 : b.k === 'h2' ? 1.28 : head ? 1.1 : b.k === 'cap' ? 0.84 : 1;
  const fs = Math.round(size * scale);
  const lh = head ? Math.round(fs * 1.25) : lineHeightFor(fs, prefs.spacing);
  return (
    <Text
      style={[
        {
          color: b.k === 'cap' ? ink.soft : ink.text,
          fontFamily: family,
          fontSize: fs,
          lineHeight: lh,
          marginBottom: head ? Math.round(size * 0.9) : Math.round(lh * 0.55),
        },
        head && { fontWeight: '600', textAlign: 'center', marginTop: first ? Math.round(size * 1.5) : Math.round(size * 2.2), letterSpacing: b.k === 'h1' || b.k === 'h2' ? 0.3 : 0 },
        b.k === 'quote' && { paddingLeft: 18, color: ink.soft, fontStyle: 'italic' },
        b.k === 'li' && { paddingLeft: 14 },
        b.k === 'cap' && { textAlign: 'center' },
        b.k === 'pre' && { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: Math.round(size * 0.82) },
      ]}>
      {b.k === 'li' ? '•  ' : ''}
      {b.runs.map((r, n) => (
        <Text key={n} style={[r.b && styles.bold, r.i && styles.italic]}>
          {r.t}
        </Text>
      ))}
    </Text>
  );
});

export default function BookReader({
  book,
  actions,
  prefs,
  onPrefs,
  onClose,
}: {
  book: BookUi;
  actions: BookActions;
  prefs: ReaderPrefs;
  onPrefs: (p: ReaderPrefs) => void;
  onClose: () => void;
}) {
  const ink = INKS[prefs.theme];
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const side = Math.max(24, (width - MAX_MEASURE) / 2);
  const topBand = insets.top + 26;
  const bottomBand = (insets.bottom ? insets.bottom - 6 : 8) + 20;

  const [opened, setOpened] = useState<OpenedBook | null>(null);
  const [failed, setFailed] = useState(false);
  const [chapter, setChapter] = useState(book.lastReadAt ? book.chapter : 0);
  const [shown, setShown] = useState<Shown | null>(null);
  const [chrome, setChrome] = useState(!book.lastReadAt);
  const [panel, setPanel] = useState<'contents' | 'look' | null>(null);
  const [placed, setPlaced] = useState(false);
  const [topBlock, setTopBlock] = useState(0);
  const [finished, setFinished] = useState(!!book.finishedAt);

  const list = useRef<FlatList<Block>>(null);
  const cache = useRef(new Map<number, Shown>());
  /** Where to land once a chapter is shown: a paragraph, or an element id from the contents. */
  const landing = useRef<{ block: number } | { id: string } | null>(book.lastReadAt ? { block: book.block } : null);
  const place = useRef({ chapter, block: 0 });
  const dirty = useRef(false);
  const lastMove = useRef(Date.now());
  const pendingMs = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    actions
      .open(book.id)
      .then((b) => {
        if (!alive) return;
        if (!b) setFailed(true);
        setOpened(b);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = opened?.chapters.length ?? book.chapterSizes.length;

  // Turn the chapter into paragraphs (kept for a few chapters, so going back is instant).
  useEffect(() => {
    if (!opened) return;
    const c = Math.min(Math.max(0, chapter), Math.max(0, opened.chapters.length - 1));
    const done = (s: Shown) => {
      setShown(s);
      setPlaced(false);
    };
    const cached = cache.current.get(c);
    if (cached) {
      done(cached);
      return;
    }
    let alive = true;
    setShown(null);
    opened
      .chapterText(c)
      .then((xhtml) => {
        if (!alive) return;
        const parsed = { index: c, ...chapterBlocks(xhtml ?? '', opened.chapters[c]?.href ?? '') };
        cache.current.set(c, parsed);
        if (cache.current.size > 5) cache.current.delete(cache.current.keys().next().value as number);
        done(parsed);
      })
      .catch(() => alive && done({ index: c, blocks: [], ids: {} }));
    return () => {
      alive = false;
    };
  }, [opened, chapter]);

  const blocks = shown?.blocks ?? [];

  const save = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    const { chapter: c, block } = place.current;
    const n = cache.current.get(c)?.blocks.length ?? 0;
    const ms = pendingMs.current;
    pendingMs.current = 0;
    actions.savePlace(book.id, { chapter: c, block, chapterFrac: fracOfBlock(block, n) }, ms).catch(() => undefined);
  }, [actions, book.id]);

  const moved = useCallback(
    (block: number) => {
      const now = Date.now();
      pendingMs.current += countedMs(now - lastMove.current);
      lastMove.current = now;
      place.current = { chapter: shown?.index ?? chapter, block };
      dirty.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(save, 1500);
    },
    [save, shown, chapter]
  );

  // Land on the saved paragraph (or the one picked in the contents) once the chapter is in.
  useEffect(() => {
    if (!shown) return;
    const target = landing.current;
    landing.current = null;
    const index = !target ? 0 : 'block' in target ? safeBlock(target.block, shown.blocks.length) : safeBlock(shown.ids[target.id] ?? 0, shown.blocks.length);
    setTopBlock(index);
    // Opening a book or jumping from the contents is a place worth keeping, even without a scroll after it.
    if (target) moved(index);
    if (index === 0) {
      list.current?.scrollToOffset({ offset: 0, animated: false });
      setPlaced(true);
      return;
    }
    const t = setTimeout(() => {
      try {
        list.current?.scrollToIndex({ index, viewPosition: 0, animated: false });
      } catch {
        // onScrollToIndexFailed takes over
      }
      setTimeout(() => setPlaced(true), 60);
    }, 30);
    return () => clearTimeout(t);
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const goChapter = (c: number, to: { block: number } | { id: string } | null = null) => {
    if (!opened || c < 0 || c >= opened.chapters.length) return;
    tick();
    landing.current = to;
    place.current = { chapter: c, block: to && 'block' in to ? to.block : 0 };
    dirty.current = true;
    save();
    if (c === chapter && shown) {
      // Same chapter: the effect above won't run again, so land here.
      const index = to ? ('block' in to ? to.block : (shown.ids[to.id] ?? 0)) : 0;
      landing.current = null;
      list.current?.scrollToIndex({ index: safeBlock(index, shown.blocks.length), viewPosition: 0, animated: false });
      return;
    }
    setChapter(c);
  };

  // Leaving the app or closing the book keeps your place.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') save();
      else lastMove.current = Date.now();
    });
    return () => {
      sub.remove();
      save();
    };
  }, [save]);

  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken<Block>[] }) => {
    const first = viewableItems.find((v) => v.isViewable && v.index !== null);
    if (first?.index == null) return;
    onTopRef.current(first.index);
  }).current;
  const onTopRef = useRef<(i: number) => void>(() => undefined);
  onTopRef.current = (i: number) => {
    if (!placed) return;
    setTopBlock(i);
    moved(i);
  };

  const close = () => {
    save();
    onClose();
  };

  const tocTitle = useMemo(() => (opened ? chapterLabel(opened.toc, chapter, book.title, opened.chapters[chapter]?.title ?? '') : ''), [opened, chapter, book.title]);

  const progress = progressAt(book.chapterSizes, shown?.index ?? chapter, fracOfBlock(topBlock, blocks.length));
  const left = minutesLeft({ ...book, chapter: shown?.index ?? chapter, chapterFrac: fracOfBlock(topBlock, blocks.length), finishedAt: null });
  const isLast = !!opened && chapter >= opened.chapters.length - 1;
  const nextTitle = opened && !isLast ? chapterLabel(opened.toc, chapter + 1, book.title, opened.chapters[chapter + 1]?.title ?? '') : null;

  const footer = shown ? (
    <View style={[styles.footer, { borderTopColor: ink.rule }]}>
      {nextTitle ? (
        <TouchableOpacity style={[styles.nextBtn, { borderColor: ink.rule }]} onPress={() => goChapter(chapter + 1)} accessibilityLabel={`Next chapter: ${nextTitle}`}>
          <Text style={[styles.nextLabel, { color: ink.soft }]}>Next</Text>
          <Text style={[styles.nextTitle, { color: ink.text, fontFamily: prefs.font === 'serif' ? SERIF : undefined }]} numberOfLines={2}>
            {nextTitle}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.endWrap}>
          <Text style={[styles.endMark, { color: ink.faint }]}>The end</Text>
          <TouchableOpacity
            style={[styles.finishBtn, { backgroundColor: finished ? 'transparent' : ink.accent, borderColor: ink.accent }]}
            onPress={() => {
              tick();
              const next = !finished;
              setFinished(next);
              actions.setFinished(book.id, next).catch(() => undefined);
            }}>
            <Text style={[styles.finishText, { color: finished ? ink.accent : ink.bg }]}>{finished ? 'Finished · tap to undo' : 'Mark as finished'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  ) : null;

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={close} supportedOrientations={['portrait', 'landscape']}>
      <StatusBar hidden={!chrome} animated barStyle={ink.dark ? 'light-content' : 'dark-content'} />
      <View style={[styles.fill, { backgroundColor: ink.bg }]}>
        {failed ? (
          <View style={styles.center}>
            <Text style={[styles.msg, { color: ink.text }]}>This book could not be opened.</Text>
            <Text style={[styles.msgSoft, { color: ink.soft }]}>Its files may be missing. Delete it from the shelf and add the .epub again.</Text>
            <TouchableOpacity onPress={close} style={[styles.finishBtn, { borderColor: ink.accent, marginTop: 20 }]}>
              <Text style={[styles.finishText, { color: ink.accent }]}>Back to the shelf</Text>
            </TouchableOpacity>
          </View>
        ) : !shown ? (
          <View style={styles.center}>
            <ActivityIndicator color={ink.soft} />
          </View>
        ) : (
          <Pressable focusable={false} style={[styles.fill, { marginTop: topBand, marginBottom: bottomBand }]} onPress={() => (panel ? setPanel(null) : setChrome((c) => !c))} accessibilityLabel="Tap to show or hide the reading controls">
            <FlatList
              ref={list}
              key={`${shown.index}`}
              data={blocks}
              keyExtractor={(_, i) => `${i}`}
              renderItem={({ item, index }) => <BlockView block={item} ink={ink} prefs={prefs} uriOf={opened!.uriOf} first={index === 0} />}
              extraData={prefs}
              style={{ opacity: placed ? 1 : 0 }}
              contentContainerStyle={{ paddingHorizontal: side, paddingTop: 18, paddingBottom: 40 }}
              ListFooterComponent={footer}
              ListEmptyComponent={<Text style={[styles.msgSoft, { color: ink.soft, textAlign: 'center' }]}>This part of the book has no text.</Text>}
              onViewableItemsChanged={onViewable}
              viewabilityConfig={{ itemVisiblePercentThreshold: 1, minimumViewTime: 0 }}
              initialNumToRender={Math.min(blocks.length, Math.max(12, (landing.current && 'block' in landing.current ? landing.current.block : 0) + 6))}
              windowSize={9}
              onScrollToIndexFailed={(info) => {
                list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
                setTimeout(() => {
                  try {
                    list.current?.scrollToIndex({ index: info.index, viewPosition: 0, animated: false });
                  } catch {
                    // close enough
                  }
                }, 80);
              }}
              onScrollBeginDrag={() => {
                if (chrome) setChrome(false);
                if (panel) setPanel(null);
              }}
              indicatorStyle={ink.dark ? 'white' : 'black'}
            />
          </Pressable>
        )}

        {/* Where you are, quietly, in the margins the text never runs into. */}
        {shown && (
          <>
            <View pointerEvents="none" style={[styles.band, { top: 0, height: topBand, justifyContent: 'flex-end', backgroundColor: ink.bg }]}>
              <Text style={[styles.quietText, { color: ink.faint }]} numberOfLines={1}>
                {tocTitle}
              </Text>
            </View>
            <View pointerEvents="none" style={[styles.band, { bottom: 0, height: bottomBand, paddingBottom: insets.bottom ? insets.bottom - 6 : 8, backgroundColor: ink.bg }]}>
              <Text style={[styles.quietText, { color: ink.faint }]}>{fmtProgress(progress, true)}</Text>
            </View>
          </>
        )}

        {chrome && (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={[styles.top, { paddingTop: insets.top + 4, backgroundColor: ink.bar, borderBottomColor: ink.rule }]}>
            <TouchableOpacity onPress={close} style={styles.topBtn} accessibilityLabel="Back to the shelf" hitSlop={8}>
              <Icon name="back" size={20} color={ink.text} />
            </TouchableOpacity>
            <View style={styles.topMid}>
              <Text style={[styles.topTitle, { color: ink.text }]} numberOfLines={1}>
                {displayTitle(book)}
              </Text>
              {!!tocTitle && (
                <Text style={[styles.topSub, { color: ink.soft }]} numberOfLines={1}>
                  {tocTitle}
                </Text>
              )}
            </View>
            <TouchableOpacity onPress={() => setPanel((x) => (x === 'contents' ? null : 'contents'))} style={styles.topBtn} accessibilityLabel="Contents" hitSlop={8}>
              <Icon name="list" size={20} color={panel === 'contents' ? ink.accent : ink.text} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPanel((x) => (x === 'look' ? null : 'look'))} style={styles.topBtn} accessibilityLabel="Text size and page colour" hitSlop={8}>
              <Icon name="textSize" size={20} color={panel === 'look' ? ink.accent : ink.text} />
            </TouchableOpacity>
          </Animated.View>
        )}

        {chrome && shown && !panel && (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={[styles.bottom, { paddingBottom: insets.bottom + 10, backgroundColor: ink.bar, borderTopColor: ink.rule }]}>
            <View style={[styles.track, { backgroundColor: ink.rule }]}>
              <View style={[styles.trackFill, { backgroundColor: ink.accent, width: `${Math.round(progress * 1000) / 10}%` }]} />
            </View>
            <View style={styles.bottomRow}>
              <TouchableOpacity disabled={chapter <= 0} onPress={() => goChapter(chapter - 1)} hitSlop={10} accessibilityLabel="Previous chapter">
                <Icon name="back" size={16} color={chapter <= 0 ? ink.rule : ink.soft} />
              </TouchableOpacity>
              <Text style={[styles.bottomText, { color: ink.soft }]} numberOfLines={1}>
                {fmtProgress(progress, true)} · chapter {chapter + 1} of {count}
                {left !== null ? ` · ${fmtLeft(left)}` : ''}
              </Text>
              <TouchableOpacity disabled={isLast} onPress={() => goChapter(chapter + 1)} hitSlop={10} accessibilityLabel="Next chapter">
                <Icon name="forward" size={16} color={isLast ? ink.rule : ink.soft} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {panel === 'contents' && opened && (
          <Animated.View entering={SlideInDown.duration(220)} exiting={SlideOutDown.duration(180)} style={[styles.panel, { top: insets.top + 60, backgroundColor: ink.bar, borderColor: ink.rule }]}>
            <Text style={[styles.panelTitle, { color: ink.text }]}>Contents</Text>
            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
              {(opened.toc.length ? opened.toc : opened.chapters.map((c, i) => ({ title: c.title, chapter: i, id: null as string | null, depth: 0 }))).map((t, n) => {
                const here = t.chapter === chapter && (!t.id || n === opened.toc.findIndex((x) => x.chapter === chapter));
                return (
                  <TouchableOpacity
                    key={`${n}`}
                    style={[styles.tocRow, { paddingLeft: 20 + Math.min(t.depth, 3) * 16, borderBottomColor: ink.rule }]}
                    onPress={() => {
                      setPanel(null);
                      setChrome(false);
                      goChapter(t.chapter, t.id ? { id: t.id } : null);
                    }}>
                    <Text style={[styles.tocText, { color: here ? ink.accent : t.depth ? ink.soft : ink.text, fontWeight: here ? '700' : t.depth ? '400' : '600' }]} numberOfLines={2}>
                      {t.title}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Animated.View>
        )}

        {panel === 'look' && (
          <Animated.View entering={SlideInDown.duration(220)} exiting={SlideOutDown.duration(180)} style={[styles.lookPanel, { paddingBottom: insets.bottom + 16, backgroundColor: ink.bar, borderColor: ink.rule }]}>
            <View style={styles.lookRow}>
              <TouchableOpacity
                style={[styles.sizeBtn, { borderColor: ink.rule }]}
                disabled={prefs.size === READER_SIZES[0]}
                onPress={() => onPrefs({ ...prefs, size: READER_SIZES[Math.max(0, READER_SIZES.indexOf(prefs.size) - 1)] })}
                accessibilityLabel="Smaller text">
                <Text style={[styles.sizeA, { color: prefs.size === READER_SIZES[0] ? ink.faint : ink.text, fontSize: 15, fontFamily: SERIF }]}>A</Text>
              </TouchableOpacity>
              <Text style={[styles.sizeValue, { color: ink.soft }]}>{prefs.size} pt</Text>
              <TouchableOpacity
                style={[styles.sizeBtn, { borderColor: ink.rule }]}
                disabled={prefs.size === READER_SIZES[READER_SIZES.length - 1]}
                onPress={() => onPrefs({ ...prefs, size: READER_SIZES[Math.min(READER_SIZES.length - 1, READER_SIZES.indexOf(prefs.size) + 1)] })}
                accessibilityLabel="Bigger text">
                <Text style={[styles.sizeA, { color: prefs.size === READER_SIZES[READER_SIZES.length - 1] ? ink.faint : ink.text, fontSize: 24, fontFamily: SERIF }]}>A</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.lookRow}>
              {(['paper', 'sepia', 'night'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => onPrefs({ ...prefs, theme: t })}
                  style={[styles.swatch, { backgroundColor: INKS[t].bg, borderColor: prefs.theme === t ? ink.accent : ink.rule, borderWidth: prefs.theme === t ? 2 : 1 }]}
                  accessibilityLabel={`${THEME_NAMES[t]} page`}
                  accessibilityState={{ selected: prefs.theme === t }}>
                  <Text style={{ color: INKS[t].text, fontSize: 14, fontWeight: '600' }}>{THEME_NAMES[t]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.lookRow}>
              {(
                [
                  ['serif', 'Charter', SERIF],
                  ['sans', 'System', undefined],
                ] as const
              ).map(([k, label, family]) => (
                <TouchableOpacity
                  key={k}
                  onPress={() => onPrefs({ ...prefs, font: k })}
                  style={[styles.choice, { borderColor: prefs.font === k ? ink.accent : ink.rule, borderWidth: prefs.font === k ? 2 : 1 }]}
                  accessibilityState={{ selected: prefs.font === k }}>
                  <Text style={{ color: ink.text, fontSize: 16, fontFamily: family }}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.lookRow}>
              {(
                [
                  ['tight', 'Tight'],
                  ['normal', 'Normal'],
                  ['loose', 'Roomy'],
                ] as const
              ).map(([k, label]) => (
                <TouchableOpacity
                  key={k}
                  onPress={() => onPrefs({ ...prefs, spacing: k })}
                  style={[styles.choice, { borderColor: prefs.spacing === k ? ink.accent : ink.rule, borderWidth: prefs.spacing === k ? 2 : 1 }]}
                  accessibilityLabel={`${label} line spacing`}
                  accessibilityState={{ selected: prefs.spacing === k }}>
                  <Text style={{ color: ink.text, fontSize: 14 }}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  msg: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  msgSoft: { fontSize: 15, lineHeight: 21, textAlign: 'center', marginTop: 8 },
  bold: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  hr: { alignSelf: 'center', width: 48, height: StyleSheet.hairlineWidth * 2, marginVertical: 28 },
  imgWrap: { alignItems: 'center', marginVertical: 16 },
  img: { width: '100%', maxHeight: 460 },
  footer: { marginTop: 36, paddingTop: 28, borderTopWidth: StyleSheet.hairlineWidth },
  nextBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 18, gap: 4 },
  nextLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  nextTitle: { fontSize: 19, lineHeight: 25 },
  endWrap: { alignItems: 'center', gap: 18, paddingVertical: 12 },
  endMark: { fontSize: 14, letterSpacing: 2, textTransform: 'uppercase' },
  finishBtn: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12 },
  finishText: { fontSize: 15, fontWeight: '700' },
  band: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 48, paddingBottom: 4 },
  quietText: { fontSize: 11, letterSpacing: 0.3, fontVariant: ['tabular-nums'] },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  topBtn: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  topMid: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  topTitle: { fontSize: 15, fontWeight: '700' },
  topSub: { fontSize: 12, marginTop: 1 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  trackFill: { height: 3 },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  bottomText: { flex: 1, textAlign: 'center', fontSize: 13, fontVariant: ['tabular-nums'] },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  panelTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  tocRow: { paddingVertical: 13, paddingRight: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  tocText: { fontSize: 16 },
  lookPanel: { position: 'absolute', left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 20, paddingTop: 18, gap: 14 },
  lookRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sizeBtn: { flex: 1, height: 46, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sizeA: { fontWeight: '500' },
  sizeValue: { width: 56, textAlign: 'center', fontSize: 13, fontVariant: ['tabular-nums'] },
  swatch: { flex: 1, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  choice: { flex: 1, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
