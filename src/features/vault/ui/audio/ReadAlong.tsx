/**
 * Read-along for EPUB 3 books: the chapter's text, with the sentence being
 * read lit up as the narration plays and kept in view. Tap any sentence to
 * play from there. Browse other chapters freely; "Back to the narration"
 * follows the audio again. Text size is adjustable. Books without narration
 * read like any book. Chapters are turned into text only when opened, and
 * nothing is written to the phone while you read.
 * Presentational only (see the note at the top of types.ts).
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import { chapterBlocks, clipAt, clipFor, firstClipOf, type Block } from '../../audio/epub';
import { tick } from '../haptics';
import Icon from '../Icon';
import { OptionsSheet } from '../prompts';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { AudioActions, AudioUiItem, OpenBook } from './audioTypes';
import { useAudioPlayback } from './playback';

/** Text size steps (kept for the session). */
const SIZES = [15, 17, 19, 22, 26];
let lastSize = 1;

type BlockProps = { block: Block; activeId: string | null; size: number; uriOf: (p: string) => string; onTap: (id: string | undefined) => void; styles: ReturnType<typeof makeStyles> };

const BlockView = memo(function BlockView({ block: b, activeId, size, uriOf, onTap, styles }: BlockProps) {
  const [ratio, setRatio] = useState(1.5);
  if (b.k === 'hr') return <View style={styles.hr} />;
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
  const whole = !!b.id && b.id === activeId;
  const base = b.k === 'h1' ? styles.h1 : b.k === 'h2' ? styles.h2 : b.k === 'h3' || b.k === 'h4' ? styles.h3 : b.k === 'quote' ? styles.quote : b.k === 'cap' ? styles.cap : styles.p;
  const scale = b.k === 'h1' ? 1.5 : b.k === 'h2' ? 1.3 : b.k === 'h3' || b.k === 'h4' ? 1.12 : b.k === 'cap' ? 0.85 : 1;
  return (
    <Text style={[base, { fontSize: size * scale, lineHeight: Math.round(size * scale * 1.5) }, whole && styles.active, b.k === 'li' && styles.li]} onPress={() => onTap(b.id)} suppressHighlighting>
      {b.k === 'li' ? '•  ' : ''}
      {b.runs.map((r, n) => (
        <Text
          key={n}
          style={[r.b && styles.bold, r.i && styles.italic, !whole && !!r.id && r.id === activeId && styles.active]}
          onPress={r.id ? () => onTap(r.id) : undefined}
          suppressHighlighting>
          {r.t}
        </Text>
      ))}
    </Text>
  );
});

export default function ReadAlong({ item, actions }: { item: AudioUiItem; actions: AudioActions }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const pb = useAudioPlayback();
  const [open, setOpen] = useState<OpenBook | null>(null);
  const [failed, setFailed] = useState(false);
  const [chapter, setChapter] = useState<number | null>(null);
  const [text, setText] = useState<{ index: number; blocks: Block[]; ids: Record<string, number> } | null>(null);
  const [follow, setFollow] = useState(true);
  const [sizeAt, setSizeAt] = useState(lastSize);
  const [picker, setPicker] = useState(false);
  const list = useRef<FlatList<Block>>(null);
  const cache = useRef(new Map<number, { blocks: Block[]; ids: Record<string, number> }>());

  useEffect(() => {
    let alive = true;
    actions
      .loadBook(item.id)
      .then((b) => {
        if (!alive) return;
        if (!b) setFailed(true);
        setOpen(b);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const book = open?.book ?? null;
  const playingHere = pb.item?.id === item.id;
  const clipIndex = book && playingHere ? clipAt(book.clips, pb.track, pb.position) : -1;
  const clip = book && clipIndex >= 0 ? book.clips[clipIndex] : null;
  // Which chapter to show: the one being read (while following), else the one picked.
  const narrated = clip?.c ?? (book && playingHere ? book.clips.find((c) => c.t === pb.track)?.c : undefined) ?? 0;
  const shown = follow || chapter === null ? narrated : chapter;

  useEffect(() => {
    if (!open || !book) return;
    const cached = cache.current.get(shown);
    if (cached) {
      setText({ index: shown, ...cached });
      return;
    }
    let alive = true;
    setText(null);
    open
      .chapterText(shown)
      .then((xhtml) => {
        if (!alive) return;
        const parsed = chapterBlocks(xhtml ?? '', book.chapters[shown]?.href ?? '');
        cache.current.set(shown, parsed);
        if (cache.current.size > 6) cache.current.delete(cache.current.keys().next().value as number);
        setText({ index: shown, ...parsed });
      })
      .catch(() => alive && setText({ index: shown, blocks: [], ids: {} }));
    return () => {
      alive = false;
    };
  }, [open, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeId = clip && text && clip.c === text.index ? clip.id : null;
  const activeBlock = activeId && text ? (text.ids[activeId] ?? -1) : -1;

  // Keep the sentence being read in view.
  useEffect(() => {
    if (!follow || activeBlock < 0) return;
    try {
      list.current?.scrollToIndex({ index: activeBlock, viewPosition: 0.3, animated: true });
    } catch {
      // not laid out yet: onScrollToIndexFailed handles it
    }
  }, [activeBlock, follow]);

  const onTap = (id: string | undefined) => {
    if (!book || !id || !text) return;
    const c = clipFor(book.clips, text.index, id);
    if (!c) return;
    tick();
    setFollow(true);
    if (!playingHere) pb.open(item, { track: c.t, ms: c.b, autoplay: true });
    else {
      pb.seekTrack(c.t, c.b);
      if (!pb.playing) pb.resume();
    }
  };

  const toc = useMemo(() => (book ? (book.toc.filter((t) => t.depth === 0).length ? book.toc.filter((t) => t.depth === 0) : book.chapters.map((c, n) => ({ title: c.title, chapter: n, id: null, depth: 0 }))) : []), [book]);
  const size = SIZES[sizeAt];

  if (failed) return <Text style={styles.note}>This book could not be opened.</Text>;
  if (!book) return <ActivityIndicator color={p.textSecondary} />;
  const blockData = text?.blocks ?? [];
  // Only the block being read gets the id, so only it redraws as the narration moves on.
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.bar}>
        <TouchableOpacity style={styles.chapterBtn} onPress={() => setPicker(true)} accessibilityLabel="Chapters">
          <Icon name="chapters" size={13} color={p.textSecondary} />
          <Text style={styles.chapterText} numberOfLines={1}>
            {book.chapters[shown]?.title ?? `Part ${shown + 1}`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.sizeBtn}
          disabled={sizeAt === 0}
          onPress={() => {
            lastSize = Math.max(0, sizeAt - 1);
            setSizeAt(lastSize);
          }}
          accessibilityLabel="Smaller text">
          <Text style={[styles.sizeText, { fontSize: 13 }]}>A</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.sizeBtn}
          disabled={sizeAt === SIZES.length - 1}
          onPress={() => {
            lastSize = Math.min(SIZES.length - 1, sizeAt + 1);
            setSizeAt(lastSize);
          }}
          accessibilityLabel="Bigger text">
          <Text style={[styles.sizeText, { fontSize: 18 }]}>A</Text>
        </TouchableOpacity>
      </View>
      {!text ? (
        <ActivityIndicator style={{ marginTop: 30 }} color={p.textSecondary} />
      ) : (
        <FlatList
          ref={list}
          data={blockData}
          keyExtractor={(_, n) => `${text.index}-${n}`}
          contentContainerStyle={styles.page}
          initialNumToRender={30}
          windowSize={9}
          onScrollBeginDrag={() => setFollow(false)}
          onScrollToIndexFailed={(e) => {
            list.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: false });
            setTimeout(() => {
              try {
                list.current?.scrollToIndex({ index: e.index, viewPosition: 0.3, animated: true });
              } catch {
                // give up quietly
              }
            }, 120);
          }}
          ListEmptyComponent={<Text style={styles.note}>This part has no text.</Text>}
          renderItem={({ item: b, index }) => <BlockView block={b} activeId={index === activeBlock ? activeId : null} size={size} uriOf={open!.uriOf} onTap={onTap} styles={styles} />}
        />
      )}
      {(!follow || shown !== narrated) && playingHere && book.clips.length > 0 && (
        <TouchableOpacity
          style={styles.followBtn}
          onPress={() => {
            setFollow(true);
            setChapter(null);
          }}
          accessibilityLabel="Back to where the narration is">
          <Icon name="follow" size={13} color="#fff" />
          <Text style={styles.followText}>Back to the narration</Text>
        </TouchableOpacity>
      )}
      {picker && (
        <OptionsSheet
          title="Chapters"
          options={toc.map((t) => ({
            label: t.title,
            hint: t.chapter === shown ? '✓' : undefined,
            onPress: () => {
              const c = firstClipOf(book.clips, t.chapter);
              if (c && playingHere) {
                pb.seekTrack(c.t, c.b);
                setFollow(true);
                setChapter(null);
              } else {
                setFollow(false);
                setChapter(t.chapter);
              }
            },
          }))}
          onClose={() => setPicker(false)}
        />
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 6 },
    chapterBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.card, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 },
    chapterText: { flex: 1, color: p.text, fontSize: 13, fontWeight: '700' },
    sizeBtn: { width: 34, height: 32, borderRadius: 10, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    sizeText: { color: p.text, fontWeight: '800' },
    page: { paddingHorizontal: 22, paddingBottom: 40, gap: 14 },
    p: { color: p.text },
    h1: { color: p.text, fontWeight: '900', marginTop: 8 },
    h2: { color: p.text, fontWeight: '800', marginTop: 6 },
    h3: { color: p.text, fontWeight: '800' },
    quote: { color: p.textSoft, fontStyle: 'italic', borderLeftWidth: 3, borderLeftColor: p.border, paddingLeft: 12 },
    cap: { color: p.textSecondary, textAlign: 'center' },
    li: { paddingLeft: 6 },
    bold: { fontWeight: '800' },
    italic: { fontStyle: 'italic' },
    active: { backgroundColor: p.accentSoft, color: p.text },
    hr: { height: 1, backgroundColor: p.separator, marginVertical: 8 },
    imgWrap: { alignItems: 'center' },
    img: { width: '100%', maxHeight: 360, borderRadius: 8 },
    note: { color: p.textSecondary, fontSize: 14, textAlign: 'center', padding: 20 },
    followBtn: { position: 'absolute', alignSelf: 'center', bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    followText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  });
