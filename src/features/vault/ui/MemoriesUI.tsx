/**
 * Memories: little films made from your videos, like the Photos app's.
 *
 * The tab shows a "For you" carousel (on this day, your latest trip, a big
 * day…), then rows of moments, themes, months and seasons, and years. A
 * memory plays full screen: a title card over a wall of its covers, then
 * each video as a short clip with its sound, a caption saying when it was
 * filmed, and an end card to replay, favourite, share or hide it. Three moods
 * change how it plays: Gentle (long clips, slow fades, warm), Upbeat (quick
 * cuts with a punch) and Epic (cinema bars, big titles).
 * You can make your own (a keyword, an album, dates, a lowest rating), shuffle
 * to a random one, and new memories carry a dot until you open them.
 * Hold to pause, tap the sides to skip, drag down to close.
 *
 * The cards play: the big For you card runs a trailer of its clips (with
 * sound), and the card most in view in a row plays its cover video. Quick
 * mixes (your saved memories, only the best, this month through the years, a
 * random handful) play in one tap; Looking back gathers a year ago, your
 * first videos, milestones and late nights. Then and now plays an old video
 * above a new one of the same keyword or place, the sound passing from the
 * first to the second halfway through. The end card shows every clip
 * (tap one to jump back to it) and the memory that comes next.
 * Presentational only.
 */

import { LiveCard } from './live';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Modal, useWindowDimensions } from './screen';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { customMatches, memoryClips, memoryLength, memoryMixes, memorySections, MOODS, type Clip, type CustomMemory, type Memory, type Mood } from '../memories';
import { friendlyName } from '../names';
import Fade from './Fade';
import { aspectOf, Backdrop, fitFor } from './frame';
import { success, tick } from './haptics';
import Icon from './Icon';
import IconButton from './IconButton';
import { gradient, SectionTitle } from './insightParts';
import { DUR, EASE_OUT, enterUp, PressableScale, SPRING, useReducedMotion } from './motion';
import { Aurora, CoverWall, Float, hexA, KenBurns, Letterbox, Pulse, Tilt, Words } from './storyKit';
import { Segment, SheetFrame } from './sheets';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

type Thumbs = Map<string, VaultItem['thumbSource']>;

/** A colour pair per kind of memory. */
export const TONES: [string, string][] = [
  ['#FF9F0A', '#3A1400'],
  ['#0A84FF', '#001A3D'],
  ['#FF375F', '#33020F'],
  ['#30D158', '#012A12'],
  ['#BF5AF2', '#22053A'],
  ['#FFB340', '#3A2A00'],
  ['#64D2FF', '#012738'],
  ['#FF6482', '#3A0716'],
  ['#FFD60A', '#3B1E00'],
  ['#5E5CE6', '#0E0B3A'],
  ['#AC8E68', '#1E160C'],
  ['#66D4CF', '#022B2A'],
  ['#FFD60A', '#2E2400'],
  ['#7D7AFF', '#05042B'],
];
const toneOf = (m: Memory) => TONES[m.tone % TONES.length];
const longDate = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const spanText = (m: Memory) => {
  const a = new Date(m.start);
  const b = new Date(m.end);
  const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  if (a.toDateString() === b.toDateString()) return a.toLocaleDateString(undefined, o);
  if (a.getFullYear() !== b.getFullYear()) return `${a.getFullYear()} – ${b.getFullYear()}`;
  return `${a.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${b.toLocaleDateString(undefined, o)}`;
};
const agoText = (t: number) => {
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days < 1) return 'Today';
  if (days < 2) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30.4);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(days / 365.25);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
};
const bigNumber = (m: Memory) => (m.kind === 'onThisDay' ? m.title.match(/^\d+/)?.[0] ?? null : m.kind === 'year' ? String(new Date(m.start).getFullYear()).slice(2) : null);

/* -------------------------------------------------------------- the tab */

export function MemoriesTab({
  list,
  items,
  thumbs,
  favs,
  hidden,
  seen = [],
  tags = [],
  albums = [],
  onPlay,
  onFav,
  onUnhideAll,
  onCreate,
  onDeleteCustom,
}: {
  list: Memory[];
  items: Map<string, VaultItem>;
  thumbs: Thumbs;
  favs: string[];
  hidden: string[];
  /** Opened before (the rest show a New dot). */
  seen?: string[];
  tags?: string[];
  albums?: { id: number; name: string }[];
  onPlay: (m: Memory) => void;
  onFav: (id: string) => void;
  onUnhideAll: () => void;
  onCreate?: (c: CustomMemory) => void;
  onDeleteCustom?: (id: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();
  const s = useMemo(() => memorySections(list, hidden, favs), [list, hidden, favs]);
  // Quick mixes; the random one is shuffled again each time the tab opens.
  const mixes = useMemo(() => memoryMixes(list.filter((m) => !hidden.includes(m.id)), [...items.values()], favs, Date.now(), Math.random), [list, items, favs, hidden]);
  const stats = useMemo(() => {
    const shown = list.filter((m) => !hidden.includes(m.id));
    const ids = new Set(shown.flatMap((m) => m.videoIds));
    const years = [...ids].map((id) => items.get(id)?.createdAt).filter((t): t is number => !!t).map((t) => new Date(t).getFullYear());
    return { count: shown.length, videos: ids.size, from: years.length ? Math.min(...years) : null, to: years.length ? Math.max(...years) : null };
  }, [list, hidden, items]);
  const [page, setPage] = useState(0);
  const [building, setBuilding] = useState(false);
  const cardW = width - 32;
  const isNew = (m: Memory) => m.kind !== 'custom' && !seen.includes(m.id);
  const shuffle = () => {
    const pool = list.filter((m) => !hidden.includes(m.id));
    if (pool.length) onPlay(pool[Math.floor(Math.random() * pool.length)]);
  };
  const builder = building && onCreate && (
    <MemoryBuilder
      items={items}
      thumbs={thumbs}
      tags={tags}
      albums={albums}
      onCreate={(c) => {
        setBuilding(false);
        success();
        onCreate(c);
      }}
      onClose={() => setBuilding(false)}
    />
  );

  if (!s.featured.length)
    return (
      <Animated.View entering={enterUp(0)} style={styles.empty}>
        <Float>
          <View style={styles.emptyIcon}>
            <Icon name="memories" size={34} color="#fff" />
          </View>
        </Float>
        <Text style={styles.emptyTitle}>Your memories will show up here</Text>
        <Text style={styles.emptyText}>As your library grows, ReelVault turns your videos into little films: trips, big days, on this day, the best of each month and season, and more.</Text>
        {onCreate && items.size > 0 && (
          <TouchableOpacity style={styles.makeBtn} onPress={() => setBuilding(true)}>
            <Icon name="plus" size={14} color="#fff" />
            <Text style={styles.makeText}>Make one yourself</Text>
          </TouchableOpacity>
        )}
        {hidden.length > 0 && (
          <TouchableOpacity onPress={onUnhideAll}>
            <Text style={[styles.link, { color: p.accent }]}>Show {hidden.length} hidden</Text>
          </TouchableOpacity>
        )}
        {builder}
      </Animated.View>
    );

  const row = (title: string, detail: string, ms: Memory[], kind: 'tall' | 'wide' | 'mosaic', i: number) =>
    ms.length > 0 && (
      <Animated.View entering={enterUp(i)} style={{ gap: 10 }}>
        <SectionTitle title={title} detail={detail} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.row} decelerationRate="fast" snapToInterval={kind === 'tall' ? 162 : 232}>
          {ms.map((m, n) => (
            <MemoryTile key={m.id} m={m} kind={kind} index={n} thumbs={thumbs} items={items} fav={favs.includes(m.id)} fresh={isNew(m)} onPress={() => onPlay(m)} />
          ))}
        </ScrollView>
      </Animated.View>
    );

  return (
    <>
      <Animated.View entering={enterUp(0)} style={{ gap: 10 }}>
        <View style={styles.forYouHead}>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.forYou}>For you</Text>
            <Text style={styles.forYouSub} numberOfLines={1}>
              {stats.count} memories · {stats.videos} videos{stats.from && stats.to && stats.from !== stats.to ? ` · ${stats.from}–${stats.to}` : ''}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <PressableScale style={styles.pill} onPress={shuffle} accessibilityLabel="Play a random memory">
              <Icon name="shuffle" size={14} color={p.text} />
              <Text style={styles.pillText}>Shuffle</Text>
            </PressableScale>
            {onCreate && (
              <PressableScale style={[styles.pill, { backgroundColor: p.accent }]} onPress={() => setBuilding(true)} accessibilityLabel="Make a memory">
                <Icon name="plus" size={14} color="#fff" />
                <Text style={[styles.pillText, { color: '#fff' }]}>Make</Text>
              </PressableScale>
            )}
          </View>
        </View>
        <ScrollView
          horizontal
          pagingEnabled={false}
          snapToInterval={cardW + 10}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          style={styles.bleed}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
          onScroll={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / (cardW + 10)))}
          scrollEventThrottle={32}>
          {s.featured.map((m, n) => (
            <FeaturedCard key={m.id} m={m} width={cardW} thumbs={thumbs} items={items} fav={favs.includes(m.id)} fresh={isNew(m)} active={n === page} onPress={() => onPlay(m)} onFav={() => onFav(m.id)} />
          ))}
        </ScrollView>
        <View style={styles.dots}>
          {s.featured.map((m, n) => (
            <Dot key={m.id} on={n === page} />
          ))}
        </View>
      </Animated.View>
      {mixes.length > 0 && (
        <Animated.View entering={enterUp(1)} style={{ gap: 10 }}>
          <SectionTitle title="Quick mixes" detail="Made on the spot" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.row}>
            {mixes.map((m, n) => (
              <MixCard key={m.id} m={m} index={n} thumbs={thumbs} onPress={() => onPlay(m)} />
            ))}
          </ScrollView>
        </Animated.View>
      )}
      {row('Made by you', 'Your own memories', s.mine, 'wide', 1)}
      {row('Favourite memories', 'The ones you saved', s.favourites, 'wide', 1)}
      {row('On this day', 'From earlier years', s.onThisDay, 'wide', 2)}
      {row('Looking back', 'A year ago, your firsts, milestones, late nights', s.lookingBack, 'tall', 2)}
      {row('Moments', 'Trips and big days', s.moments, 'tall', 3)}
      {row('Themes', 'From your tags, ratings and plays', s.themes, 'mosaic', 4)}
      {row('Months & seasons', 'The best of each', s.months, 'tall', 5)}
      {row('Years', 'Whole years, in a minute or two', s.years, 'mosaic', 6)}
      <Text style={styles.foot}>
        Memories are made on your phone from when and where your videos were filmed, their tags and your ratings. Nothing leaves the phone.
        {hidden.length ? ' ' : ''}
      </Text>
      {hidden.length > 0 && (
        <TouchableOpacity onPress={onUnhideAll} style={{ alignSelf: 'center' }}>
          <Text style={[styles.link, { color: p.accent }]}>Show {hidden.length} hidden {hidden.length === 1 ? 'memory' : 'memories'}</Text>
        </TouchableOpacity>
      )}
      {builder}
    </>
  );
}

const DATE_PRESETS: { key: string; label: string; range: (now: Date) => [number | null, number | null] }[] = [
  { key: 'any', label: 'Any time', range: () => [null, null] },
  { key: '30', label: 'Last 30 days', range: (n) => [n.getTime() - 30 * 86_400_000, null] },
  { key: 'year', label: 'This year', range: (n) => [new Date(n.getFullYear(), 0, 1).getTime(), null] },
  { key: 'last', label: 'Last year', range: (n) => [new Date(n.getFullYear() - 1, 0, 1).getTime(), new Date(n.getFullYear(), 0, 1).getTime() - 86_400_000] },
  { key: 'summer', label: 'Last summer', range: (n) => {
    const y = n.getMonth() >= 8 ? n.getFullYear() : n.getFullYear() - 1;
    return [new Date(y, 5, 1).getTime(), new Date(y, 8, 1).getTime() - 86_400_000];
  } },
];

/** Make a memory: name it, pick what goes in, see it fill up, pick a mood. */
function MemoryBuilder({ items, thumbs, tags, albums, onCreate, onClose }: { items: Map<string, VaultItem>; thumbs: Thumbs; tags: string[]; albums: { id: number; name: string }[]; onCreate: (c: CustomMemory) => void; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [albumId, setAlbumId] = useState<number | null>(null);
  const [when, setWhen] = useState('any');
  const [minRating, setMinRating] = useState(0);
  const [mood, setMood] = useState<Mood>('gentle');
  const [from, to] = DATE_PRESETS.find((d) => d.key === when)!.range(new Date());
  const videos = useMemo(() => [...items.values()], [items]);
  const matches = useMemo(() => customMatches({ tag, albumId, from, to, minRating }, videos), [tag, albumId, from, to, minRating, videos]);
  const suggested = tag ? `${tag.charAt(0).toUpperCase()}${tag.slice(1)}` : albumId !== null ? (albums.find((a) => a.id === albumId)?.name ?? 'My memory') : DATE_PRESETS.find((d) => d.key === when)!.label;
  const name = title.trim() || (when === 'any' && !tag && albumId === null ? 'My memory' : suggested);
  const chip = (label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity
      key={label}
      onPress={() => {
        tick();
        onPress();
      }}
      style={[styles.chip, on && { backgroundColor: p.accent, borderColor: p.accent }]}>
      <Text style={[styles.chipText, on && { color: '#fff' }]}>{label}</Text>
    </TouchableOpacity>
  );
  return (
    <SheetFrame
      title="New memory"
      onClose={onClose}
      action={{
        label: 'Make',
        disabled: matches.length === 0,
        onPress: () => onCreate({ id: `custom:${Date.now()}`, title: name, tag, albumId, from, to, minRating, mood, createdAt: Date.now() }),
      }}>
      <View style={styles.buildPreview}>
        {matches.slice(0, 8).map((v, i) => (
          <Animated.View key={v.id} entering={ZoomInSoft(i)} style={[styles.buildThumb, { transform: [{ rotate: `${((i % 3) - 1) * 4}deg` }] }]}>
            <Image source={thumbs.get(v.id)} style={StyleSheet.absoluteFill} contentFit="cover" />
          </Animated.View>
        ))}
        {matches.length === 0 && <Text style={styles.muted}>Nothing matches yet. Try fewer filters.</Text>}
      </View>
      <Text style={styles.buildCount}>
        {matches.length} {matches.length === 1 ? 'video' : 'videos'} · {name}
      </Text>
      <TextInput value={title} onChangeText={setTitle} placeholder={name} placeholderTextColor={p.textMuted} style={styles.input} maxLength={60} />
      {tags.length > 0 && (
        <>
          <Text style={styles.buildLabel}>KEYWORD</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {chip('Any', tag === null, () => setTag(null))}
            {tags.slice(0, 40).map((t) => chip(`#${t}`, tag === t, () => setTag(tag === t ? null : t)))}
          </ScrollView>
        </>
      )}
      {albums.length > 0 && (
        <>
          <Text style={styles.buildLabel}>ALBUM</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {chip('Any', albumId === null, () => setAlbumId(null))}
            {albums.map((a) => chip(a.name, albumId === a.id, () => setAlbumId(albumId === a.id ? null : a.id)))}
          </ScrollView>
        </>
      )}
      <Text style={styles.buildLabel}>FILMED</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {DATE_PRESETS.map((d) => chip(d.label, when === d.key, () => setWhen(d.key)))}
      </ScrollView>
      <Text style={styles.buildLabel}>RATED AT LEAST</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>{[0, 5, 7, 9].map((r) => chip(r ? `★ ${r}+` : 'Any', minRating === r, () => setMinRating(r)))}</View>
      <Text style={styles.buildLabel}>MOOD</Text>
      <Segment options={(['gentle', 'upbeat', 'epic'] as const).map((k) => ({ key: k, label: MOODS[k].label }))} value={mood} onChange={setMood} />
      <Text style={styles.muted}>{MOODS[mood].blurb}. You can change the mood while it plays.</Text>
    </SheetFrame>
  );
}

const ZoomInSoft = (i: number) => FadeInDown.delay(i * 40).duration(DUR.base).easing(EASE_OUT);

function Dot({ on }: { on: boolean }) {
  const p = usePalette();
  const w = useSharedValue(on ? 18 : 6);
  useEffect(() => {
    w.value = withSpring(on ? 18 : 6, SPRING);
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  const anim = useAnimatedStyle(() => ({ width: w.value }));
  return <Animated.View style={[{ height: 6, borderRadius: 3, backgroundColor: on ? p.text : p.textMuted, opacity: on ? 1 : 0.5 }, anim]} />;
}

/** The big carousel card: the cover moving slowly, its title, a play button. */
function FeaturedCard({ m, width, thumbs, items, fav, fresh, active, onPress, onFav }: { m: Memory; width: number; thumbs: Thumbs; items: Map<string, VaultItem>; fav: boolean; fresh: boolean; active: boolean; onPress: () => void; onFav: () => void }) {
  const styles = useStyles(makeStyles);
  const [a, b] = toneOf(m);
  const { height: screenH } = useWindowDimensions();
  const h = Math.min(480, width * 1.22, Math.max(260, screenH * 0.72));
  const num = bigNumber(m);
  const extra = m.videoIds.filter((id) => id !== m.coverId).slice(0, 3);
  // A trailer: while the card is in front it moves through up to six of its clips.
  const trailer = useMemo(() => [m.coverId, ...m.videoIds.filter((id) => id !== m.coverId)].filter((id) => items.has(id)).slice(0, 6), [m, items]);
  const [clip, setClip] = useState(0);
  useEffect(() => {
    if (!active || trailer.length < 2) return;
    const t = setInterval(() => setClip((c) => (c + 1) % trailer.length), 5000);
    return () => clearInterval(t);
  }, [active, trailer.length]);
  const nowId = trailer[clip % Math.max(1, trailer.length)] ?? m.coverId;
  const now = items.get(nowId);
  return (
    <PressableScale onPress={onPress} scaleTo={0.97} style={[styles.featured, { width, height: h, backgroundColor: b }]} accessibilityRole="button" accessibilityLabel={`${m.title}. ${m.subtitle}. Play memory`}>
      <Animated.View key={nowId} entering={FadeIn.duration(DUR.slow)} style={StyleSheet.absoluteFill}>
        <LiveCard
          id={`feat-${m.id}`}
          uri={now?.uri}
          durationMs={now?.durationMs}
          cover={thumbs.get(nowId)}
          clipMs={5200}
          radius={0}
          priority={3}
          style={StyleSheet.absoluteFill}
          soundStyle={{ top: 58, right: 16 }}
          video={now}
          under={<KenBurns key={active ? 'on' : 'off'} source={thumbs.get(nowId)} ms={14000} seed={m.title.length + clip} />}
        />
      </Animated.View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient(`linear-gradient(180deg, rgba(0,0,0,0.3) 0%, ${hexA(b, 0)} 22%, ${hexA(b, 0)} 42%, ${hexA(b, 0.6)} 66%, ${hexA(b, 0.96)} 100%)`, hexA(b, 0.35))]} />
      {trailer.length > 1 && (
        <View style={styles.trailerBars} pointerEvents="none">
          {trailer.map((id, n) => (
            <View key={id} style={[styles.trailerBar, n === clip % trailer.length && { backgroundColor: '#fff' }]} />
          ))}
        </View>
      )}
      {num && (
        <Text style={[styles.bigNum, { color: hexA(a, 0.9) }]} numberOfLines={1}>
          {num}
        </Text>
      )}
      <View style={styles.featuredTop}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <View style={[styles.kickerChip, { backgroundColor: hexA(a, 0.92) }]}>
            <Text style={styles.kickerChipText}>{m.kicker}</Text>
          </View>
          {fresh && (
            <View style={styles.newChip}>
              <Text style={styles.newChipText}>NEW</Text>
            </View>
          )}
        </View>
        <TouchableOpacity onPress={onFav} hitSlop={10} accessibilityLabel={fav ? 'Remove from favourites' : 'Add to favourites'} style={styles.heart}>
          <Icon name={fav ? 'heart' : 'heartOff'} size={18} color={fav ? '#FF375F' : '#fff'} />
        </TouchableOpacity>
      </View>
      <View style={styles.featuredBottom}>
        <View style={styles.stack}>
          {extra.map((id, i) => (
            <Image key={id} source={thumbs.get(id)} style={[styles.stackImg, { marginLeft: i ? -12 : 0, transform: [{ rotate: `${(i - 1) * 6}deg` }] }]} contentFit="cover" />
          ))}
          {m.videoIds.length > extra.length + 1 && <Text style={styles.stackMore}>+{m.videoIds.length - extra.length - 1}</Text>}
        </View>
        <Text style={styles.featuredTitle} numberOfLines={2}>
          {m.title}
        </Text>
        <View style={styles.featuredFoot}>
          <Text style={styles.featuredSub} numberOfLines={1}>
            {m.subtitle}
          </Text>
          <Pulse>
            <View style={styles.playBtn}>
              <Icon name="play" size={18} color="#000" />
            </View>
          </Pulse>
        </View>
        {items.get(m.coverId) && (
          <Text style={styles.featuredCaption} numberOfLines={1}>
            {MOODS[m.mood].label} mood · {m.pairs ? `${m.pairs.length} side by side` : `${m.videoIds.length} ${m.videoIds.length === 1 ? 'clip' : 'clips'}`}
          </Text>
        )}
      </View>
    </PressableScale>
  );
}

/** A quick mix: a fan of three covers and its name. */
function MixCard({ m, index, thumbs, onPress }: { m: Memory; index: number; thumbs: Thumbs; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const [a, b] = toneOf(m);
  const three = [m.coverId, ...m.videoIds.filter((id) => id !== m.coverId)].slice(0, 3);
  return (
    <Animated.View entering={FadeInDown.delay(60 + index * 60).duration(DUR.slow).easing(EASE_OUT)}>
      <PressableScale onPress={onPress} style={[styles.mix, gradient(`linear-gradient(150deg, ${hexA(a, 0.9)} 0%, ${b} 100%)`, b)]} accessibilityRole="button" accessibilityLabel={`Play ${m.title}`}>
        <View style={styles.mixFan}>
          {three.map((id, i) => (
            <Image key={id} source={thumbs.get(id)} style={[styles.mixImg, { left: 8 + i * 22, transform: [{ rotate: `${(i - 1) * 9}deg` }], zIndex: 3 - Math.abs(i - 1) }]} contentFit="cover" />
          ))}
        </View>
        <Text style={styles.mixTitle} numberOfLines={2}>
          {m.title}
        </Text>
        <View style={styles.mixFoot}>
          <Text style={styles.mixSub}>{m.total} videos</Text>
          <View style={styles.mixPlay}>
            <Icon name="play" size={11} color="#000" />
          </View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

/** A card in a row: tall (one cover), wide, or a mosaic of four covers. */
function MemoryTile({ m, kind, index, thumbs, items, fav, fresh = false, onPress }: { m: Memory; kind: 'tall' | 'wide' | 'mosaic'; index: number; thumbs: Thumbs; items?: Map<string, VaultItem>; fav: boolean; fresh?: boolean; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const [a, b] = toneOf(m);
  const size = kind === 'tall' ? { width: 152, height: 214 } : { width: 222, height: 160 };
  const four = [m.coverId, ...m.videoIds.filter((id) => id !== m.coverId)].slice(0, 4);
  const num = bigNumber(m);
  return (
    <Animated.View entering={FadeInDown.delay(80 + Math.min(index, 6) * 60).duration(DUR.slow).easing(EASE_OUT)}>
      <PressableScale onPress={onPress} style={[styles.tile, size, { backgroundColor: b }]} accessibilityRole="button" accessibilityLabel={`${m.title}. ${m.subtitle}`}>
        {kind === 'mosaic' && four.length >= 3 ? (
          <View style={styles.mosaic}>
            {four.map((id, i) => (
              <Image key={id} source={thumbs.get(id)} style={[styles.mosaicImg, four.length === 3 && i === 0 && { width: '100%' }]} contentFit="cover" />
            ))}
          </View>
        ) : (
          <LiveCard
            id={`tile-${m.id}`}
            uri={items?.get(m.coverId)?.uri}
            durationMs={items?.get(m.coverId)?.durationMs}
            cover={thumbs.get(m.coverId)}
            radius={0}
            style={StyleSheet.absoluteFill}
            soundStyle={{ top: 8, right: 8 }}
            video={items?.get(m.coverId)}
          />
        )}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient(`linear-gradient(180deg, ${hexA(b, 0)} 35%, ${hexA(b, 0.7)} 62%, ${hexA(b, 0.97)} 100%)`, hexA(b, 0.4))]} />
        {num && <Text style={[styles.tileNum, { color: hexA(a, 0.92) }]}>{num}</Text>}
        {fav && (
          <View style={styles.tileHeart}>
            <Icon name="heart" size={12} color="#FF375F" />
          </View>
        )}
        {fresh && <View style={styles.tileNew} />}
        <View style={styles.tileText}>
          <View style={styles.tileKickerRow}>
            <View style={[styles.tileDot, { backgroundColor: a }]} />
            <Text style={styles.tileKicker} numberOfLines={1}>
              {m.kicker}
            </Text>
          </View>
          <Text style={styles.tileTitle} numberOfLines={2}>
            {m.title}
          </Text>
          <Text style={styles.tileSub} numberOfLines={1}>
            {spanText(m)}
          </Text>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

/* ------------------------------------------------------------ the player */

const TITLE_MS = 3600;

/** One video player that moves from clip to clip, with the sound fading in. */
function ClipMedia({ clip, item, thumb, enableVideo, muted, paused, mood, seed }: { clip: Clip | null; item: VaultItem | undefined; thumb: VaultItem['thumbSource'] | undefined; enableVideo: boolean; muted: boolean; paused: boolean; mood: Mood; seed: number }) {
  const reduce = useReducedMotion();
  const player = useVideoPlayer(null, (pl) => {
    pl.loop = true;
  });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!enableVideo || !clip || !item?.uri) {
      player.pause();
      return;
    }
    let live = true;
    let fade: ReturnType<typeof setInterval> | null = null;
    player.volume = 0;
    player
      .replaceAsync({ uri: item.uri })
      .then(() => {
        if (!live) return;
        player.currentTime = clip.startMs / 1000;
        if (!paused) player.play();
        setTimeout(() => live && setReady(true), 220);
        let v = 0;
        const step = mood === 'upbeat' ? 0.25 : 0.08;
        fade = setInterval(() => {
          v = Math.min(1, v + step);
          player.volume = v;
          if (v >= 1 && fade) clearInterval(fade);
        }, 45);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (fade) clearInterval(fade);
    };
  }, [clip?.videoId, clip?.startMs, enableVideo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enableVideo) return;
    if (paused) player.pause();
    else if (clip && item?.uri) player.play();
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  // Upbeat cuts land with a little punch; Gentle drifts in slowly.
  const punch = useSharedValue(1);
  useEffect(() => {
    if (reduce || !clip) return;
    punch.value = mood === 'upbeat' ? withSequence(withTiming(1.05, { duration: 1 }), withSpring(1, { damping: 12, stiffness: 180 })) : withSequence(withTiming(1, { duration: 1 }), withTiming(1.03, { duration: clip.ms, easing: EASE_OUT }));
  }, [clip?.videoId, mood]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoom = useAnimatedStyle(() => ({ transform: [{ scale: punch.value }] }));
  const fadeMs = reduce ? 0 : MOODS[mood].fadeMs;
  const { width: sw, height: sh } = useWindowDimensions();
  const fit = fitFor(aspectOf(item), sw / sh);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* The whole clip shows, over a blurred copy of itself where it doesn't fill the screen. */}
      {clip && (
        <Animated.View key={`b${clip.videoId}`} entering={FadeIn.duration(fadeMs)} exiting={FadeOut.duration(fadeMs)} style={StyleSheet.absoluteFill}>
          <Backdrop source={thumb} dim={0.15} />
        </Animated.View>
      )}
      {enableVideo && (
        <Animated.View style={[StyleSheet.absoluteFill, zoom]}>
          <VideoView pointerEvents="none" player={player} style={StyleSheet.absoluteFill} contentFit={fit} nativeControls={false} />
        </Animated.View>
      )}
      {clip && (!enableVideo || !ready) && (
        <Animated.View key={clip.videoId} entering={FadeIn.duration(fadeMs)} exiting={FadeOut.duration(fadeMs)} style={StyleSheet.absoluteFill}>
          <KenBurns source={thumb} ms={clip.ms + 1200} seed={seed} />
        </Animated.View>
      )}
    </View>
  );
}

/**
 * Then and now: the old video on top, the new one below, each shown whole.
 * The sound starts with the old one and passes to the new one halfway.
 */
function PairMedia({ clip, items, thumbs, enableVideo, muted, paused, elapsed }: { clip: Clip & { pair: NonNullable<Clip['pair']> }; items: Map<string, VaultItem>; thumbs: Thumbs; enableVideo: boolean; muted: boolean; paused: boolean; elapsed: number }) {
  const { width, height } = useWindowDimensions();
  const half = height / 2;
  const first = elapsed < clip.ms / 2;
  const a = items.get(clip.videoId);
  const b = items.get(clip.pair.videoId);
  const year = (v: VaultItem | undefined) => (v ? new Date(v.createdAt).getFullYear() : null);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <HalfClip item={a} thumb={thumbs.get(clip.videoId)} startMs={clip.startMs} top={0} height={half} width={width} enableVideo={enableVideo} paused={paused} sound={!muted && first} label={`THEN · ${year(a) ?? ''}`} />
      <HalfClip item={b} thumb={thumbs.get(clip.pair.videoId)} startMs={clip.pair.startMs} top={half} height={half} width={width} enableVideo={enableVideo} paused={paused} sound={!muted && !first} label={`NOW · ${year(b) ?? ''}`} />
      <View style={[styles2.pairLine, { top: half - 1 }]} />
    </View>
  );
}

function HalfClip({ item, thumb, startMs, top, height, width, enableVideo, paused, sound, label }: { item: VaultItem | undefined; thumb: VaultItem['thumbSource'] | undefined; startMs: number; top: number; height: number; width: number; enableVideo: boolean; paused: boolean; sound: boolean; label: string }) {
  const player = useVideoPlayer(null, (pl) => {
    pl.loop = true;
  });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    if (!enableVideo || !item?.uri) return;
    let live = true;
    player
      .replaceAsync({ uri: item.uri })
      .then(() => {
        if (!live) return;
        player.currentTime = startMs / 1000;
        if (!paused) player.play();
        setTimeout(() => live && setReady(true), 220);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [item?.uri, startMs, enableVideo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!enableVideo || !item?.uri) return;
    if (paused) player.pause();
    else player.play();
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    player.muted = !sound;
  }, [sound, player]);
  const fit = fitFor(aspectOf(item), width / height);
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top, height, overflow: 'hidden' }}>
      <Backdrop source={thumb} dim={0.25} />
      {enableVideo && <VideoView pointerEvents="none" player={player} style={StyleSheet.absoluteFill} contentFit={fit} nativeControls={false} />}
      {(!enableVideo || !ready) && (
        <Animated.View entering={FadeIn.duration(400)} style={StyleSheet.absoluteFill}>
          <KenBurns source={thumb} ms={9000} seed={top ? 2 : 1} />
        </Animated.View>
      )}
      <View style={[styles2.pairChip, top === 0 ? { bottom: 12 } : { top: 12 }]}>
        {sound && <Icon name="sound" size={11} color="#000" />}
        <Text style={styles2.pairChipText}>{label}</Text>
      </View>
    </View>
  );
}

const styles2 = StyleSheet.create({
  pairLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: 'rgba(255,255,255,0.85)' },
  pairChip: { position: 'absolute', left: 14, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  pairChipText: { color: '#000', fontSize: 12, fontWeight: '900', letterSpacing: 0.6 },
});

export function MemoryPlayer({
  memory: m,
  items,
  thumbs,
  enableVideo,
  fav,
  loadBookmarks,
  onFav,
  onHide,
  onDelete,
  onEvent,
  onOpenVideo,
  next,
  onNext,
  onClose,
}: {
  memory: Memory;
  /** The memory after this one, offered on the end card. */
  next?: Memory | null;
  onNext?: (m: Memory) => void;
  items: Map<string, VaultItem>;
  thumbs: Thumbs;
  enableVideo: boolean;
  fav: boolean;
  loadBookmarks: (videoId: string) => Promise<number[]>;
  onFav: () => void;
  onHide: () => void;
  /** Your own memories can be deleted. */
  onDelete?: () => void;
  /** For badges: "memory" (with its kind) when it starts, "mood" for each mood it plays in. */
  onEvent?: (k: string, v?: string) => void;
  onOpenVideo: (id: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  const [a, b] = toneOf(m);
  const [mood, setMood] = useState<Mood>(m.mood);
  const [marks, setMarks] = useState<Map<string, number[]>>(new Map());
  useEffect(() => {
    Promise.all(m.videoIds.map((id) => loadBookmarks(id).then((l) => [id, l] as const).catch(() => [id, [] as number[]] as const)))
      .then((l) => setMarks(new Map(l)))
      .catch(() => undefined);
  }, [m.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const clips = useMemo(() => memoryClips(m, items, mood, marks), [m, items, mood, marks]);
  useEffect(() => {
    onEvent?.('memory', m.kind);
  }, [m.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    onEvent?.('mood', mood);
  }, [mood]); // eslint-disable-line react-hooks/exhaustive-deps

  // -1 = the title card, clips.length = the end card. The preview can open a step: `&card=2`.
  const previewCard = Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('card') : null;
  const [i, setI] = useState(() => (previewCard !== null ? Math.min(clips.length, Number(previewCard) - 1) : -1));
  const [paused, setPaused] = useState(previewCard !== null);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const iRef = useRef(i);
  iRef.current = i;
  const ended = i >= clips.length;
  const durOf = (n: number) => (n < 0 ? TITLE_MS : n < clips.length ? clips[n].ms : Infinity);

  const go = (n: number) => {
    if (n < -1) return setElapsed(0);
    if (n > clips.length) return onClose();
    if (n === clips.length) success();
    else tick();
    setElapsed(0);
    setI(n);
  };
  useEffect(() => {
    if (paused || ended) return;
    const id = setInterval(() => {
      setElapsed((e) => {
        const next = e + 50;
        if (next >= durOf(iRef.current)) {
          setTimeout(() => go(iRef.current + 1), 0);
          return 0;
        }
        return next;
      });
    }, 50);
    return () => clearInterval(id);
  }, [paused, ended, clips.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const ty = useSharedValue(0);
  const pan = Gesture.Pan()
    .activeOffsetY(14)
    .failOffsetX([-30, 30])
    .onUpdate((e) => {
      'worklet';
      ty.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      'worklet';
      if (e.translationY > 120 || e.velocityY > 900) ty.value = withTiming(height, { duration: DUR.base }, (d) => d && scheduleOnRN(onClose));
      else ty.value = withSpring(0, SPRING);
    });
  const tap = Gesture.Tap()
    .runOnJS(true)
    .maxDuration(250)
    .onEnd((e, ok) => {
      if (!ok || e.y < insets.top + 70) return;
      if (iRef.current >= clips.length) {
        if (e.x < width * 0.2) go(iRef.current - 1);
        return;
      }
      if (e.y > height - insets.bottom - 110 && e.x > width * 0.6) return; // the Open button
      go(e.x < width / 3 ? iRef.current - 1 : iRef.current + 1);
    });
  const hold = Gesture.LongPress()
    .runOnJS(true)
    .minDuration(200)
    .onStart(() => setPaused(true))
    .onFinalize(() => setPaused(false));
  const gestures = Gesture.Race(pan, hold, tap);
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }, { scale: 1 - Math.min(0.1, ty.value / 3000) }], borderRadius: Math.min(30, ty.value / 4) }));

  const clip = i >= 0 && i < clips.length ? clips[i] : null;
  const item = clip ? items.get(clip.videoId) : undefined;
  const epic = mood === 'epic';
  const titleFont = mood === 'gentle' ? styles.serif : epic ? styles.wide : null;
  const covers = m.videoIds.map((id) => thumbs.get(id));
  const cycleMood = () => {
    const order: Mood[] = ['gentle', 'upbeat', 'epic'];
    setMood(order[(order.indexOf(mood) + 1) % order.length]);
    tick();
  };

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose} statusBarTranslucent>
      <GestureHandlerRootView style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
        <GestureDetector gesture={gestures}>
          <Animated.View style={[styles.player, sheetStyle]}>
            <Aurora colors={[a, b]} width={width} height={height} />
            {clip?.pair ? (
              <PairMedia clip={clip as Clip & { pair: NonNullable<Clip['pair']> }} items={items} thumbs={thumbs} enableVideo={enableVideo} muted={muted} paused={paused} elapsed={elapsed} />
            ) : (
              <ClipMedia clip={clip} item={item} thumb={clip ? thumbs.get(clip.videoId) : undefined} enableVideo={enableVideo} muted={muted} paused={paused} mood={mood} seed={i} />
            )}
            {mood === 'gentle' && clip && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,160,80,0.08)' }]} />}
            {clip && <Fade color="0,0,0" from={0} to={0.75} style={[StyleSheet.absoluteFill, { top: '55%' }]} />}
            <Fade color="0,0,0" from={0.45} to={0} style={[StyleSheet.absoluteFill, { bottom: '78%' }]} />
            <Letterbox on={epic && !!clip} size={Math.round(height * 0.085)} />

            {/* title */}
            {i === -1 && (
              <View style={StyleSheet.absoluteFill} key={`t${mood}`}>
                <CoverWall sources={covers} opacity={0.42} />
                <View style={[StyleSheet.absoluteFill, gradient(`radial-gradient(circle at 50% 55%, ${hexA(b, 0.35)} 0%, ${hexA(b, 0.92)} 75%)`, hexA(b, 0.6))]} />
                <View style={[styles.center, { paddingTop: insets.top + 40 }]}>
                  <Tilt rotate={-3} delay={150}>
                    <View style={styles.titleCover}>
                      <Image source={thumbs.get(m.coverId)} style={StyleSheet.absoluteFill} contentFit="cover" />
                    </View>
                  </Tilt>
                  <Animated.Text entering={FadeIn.delay(300).duration(DUR.slow)} style={[styles.pKicker, { color: a }]}>
                    {m.kicker}
                  </Animated.Text>
                  <Words text={m.title} style={[styles.pTitle, titleFont]} delay={420} />
                  <Animated.Text entering={FadeInDown.delay(900).duration(DUR.slow)} style={styles.pSub}>
                    {spanText(m)} · {clips.length} {clips.length === 1 ? 'clip' : 'clips'} · {memoryLength(clips)}
                  </Animated.Text>
                </View>
              </View>
            )}

            {/* caption over a then-and-now pair */}
            {clip?.pair && item && items.get(clip.pair.videoId) && (
              <View style={[styles.caption, { bottom: insets.bottom + 28 }]} pointerEvents="none">
                <Animated.View key={clip.videoId} entering={FadeInDown.duration(DUR.slow).easing(EASE_OUT)} style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.capWhen, { color: a }]}>
                    {Math.max(1, new Date(items.get(clip.pair.videoId)!.createdAt).getFullYear() - new Date(item.createdAt).getFullYear())} YEARS APART
                  </Text>
                  <Text style={[styles.capTitle, titleFont]} numberOfLines={2}>
                    {m.title}
                  </Text>
                  <Text style={styles.capDate}>
                    {longDate(item.createdAt)} → {longDate(items.get(clip.pair.videoId)!.createdAt)}
                  </Text>
                </Animated.View>
              </View>
            )}

            {/* caption over a clip */}
            {clip && !clip.pair && item && (
              <View style={[styles.caption, { bottom: insets.bottom + (epic ? height * 0.085 + 12 : 28) }]} pointerEvents="box-none">
                <Animated.View key={clip.videoId} entering={FadeInDown.duration(DUR.slow).easing(EASE_OUT)} style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.capWhen, { color: a }]}>{agoText(item.createdAt).toUpperCase()}</Text>
                  <Text style={[styles.capTitle, titleFont]} numberOfLines={2}>
                    {friendlyName(item)}
                  </Text>
                  <Text style={styles.capDate}>{longDate(item.createdAt)}</Text>
                </Animated.View>
                <TouchableOpacity style={styles.openBtn} onPress={() => onOpenVideo(item.id)} accessibilityLabel="Open this video">
                  <Icon name="play" size={12} color="#000" />
                  <Text style={styles.openText}>Open</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* the end */}
            {ended && (
              <View style={StyleSheet.absoluteFill}>
                <CoverWall sources={covers} opacity={0.3} tilt={10} />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(b, 0.78) }]} />
                <View style={[styles.center, { paddingTop: insets.top + 50 }]}>
                  <Animated.Text entering={FadeIn.duration(DUR.slow)} style={[styles.pKicker, { color: a }]}>
                    THE END
                  </Animated.Text>
                  <Words text={m.title} style={[styles.pTitle, titleFont]} delay={150} />
                  <Animated.Text entering={FadeInDown.delay(500).duration(DUR.slow)} style={styles.pSub}>
                    {m.total} {m.total === 1 ? 'video' : 'videos'} · {spanText(m)}
                  </Animated.Text>
                  {clips.length > 1 && (
                    <Animated.View entering={FadeInDown.delay(600).duration(DUR.slow)} style={{ alignSelf: 'stretch' }}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.endClips}>
                        {clips.map((c, n) => (
                          <TouchableOpacity key={`${c.videoId}${n}`} onPress={() => go(n)} style={styles.endClip} accessibilityLabel={`Play clip ${n + 1} again`}>
                            <Image source={thumbs.get(c.videoId)} style={StyleSheet.absoluteFill} contentFit="cover" />
                            <Text style={styles.endClipN}>{n + 1}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </Animated.View>
                  )}
                  <Animated.View entering={FadeInDown.delay(700).duration(DUR.slow)} style={styles.endRow}>
                    <EndButton icon="rewatch" label="Replay" onPress={() => go(-1)} />
                    <EndButton icon={fav ? 'heart' : 'heartOff'} label={fav ? 'Saved' : 'Favourite'} tint={fav ? '#FF375F' : undefined} onPress={onFav} />
                    <EndButton
                      icon="share"
                      label="Share"
                      onPress={() => void Share.share({ message: `A memory from ReelVault: ${m.title} (${spanText(m)}), ${m.total} ${m.total === 1 ? 'video' : 'videos'}.` })}
                    />
                    <EndButton
                      icon={onDelete ? 'trash' : 'eyeOff'}
                      label={onDelete ? 'Delete' : 'Hide'}
                      onPress={() => {
                        if (onDelete) onDelete();
                        else onHide();
                        onClose();
                      }}
                    />
                  </Animated.View>
                  {next && onNext && (
                    <Animated.View entering={FadeInDown.delay(900).duration(DUR.slow)} style={{ alignSelf: 'stretch' }}>
                      <TouchableOpacity style={styles.upNext} onPress={() => onNext(next)} accessibilityLabel={`Play next: ${next.title}`}>
                        <Image source={thumbs.get(next.coverId)} style={styles.upNextImg} contentFit="cover" />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.upNextKicker}>UP NEXT</Text>
                          <Text style={styles.upNextTitle} numberOfLines={1}>
                            {next.title}
                          </Text>
                          <Text style={styles.upNextSub} numberOfLines={1}>
                            {next.subtitle}
                          </Text>
                        </View>
                        <View style={styles.upNextPlay}>
                          <Icon name="play" size={14} color="#000" />
                        </View>
                      </TouchableOpacity>
                    </Animated.View>
                  )}
                </View>
              </View>
            )}

            <View style={[styles.bars, { top: insets.top + 8 }]}>
              {[-1, ...clips.map((_, n) => n)].map((n) => (
                <View key={n} style={styles.bar}>
                  <View style={[styles.barFill, { width: n < i ? '100%' : n === i ? `${Math.min(100, (elapsed / durOf(n)) * 100)}%` : '0%' }]} />
                </View>
              ))}
            </View>
            <View style={[styles.top, { top: insets.top + 20 }]}>
              <TouchableOpacity onPress={cycleMood} style={styles.moodChip} accessibilityLabel={`Mood: ${MOODS[mood].label}. Change`}>
                <Icon name="wand" size={13} color="#fff" />
                <Text style={styles.moodText}>{MOODS[mood].label}</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }} />
              {enableVideo && <IconButton icon={muted ? 'muted' : 'sound'} label={muted ? 'Sound on' : 'Mute'} clear color="#fff" onPress={() => setMuted((x) => !x)} size={36} />}
              <IconButton icon="close" label="Close" clear color="#fff" onPress={onClose} size={36} />
            </View>
            {paused && !ended && (
              <Animated.View entering={FadeIn.duration(DUR.fast)} style={[styles.pausePill, { top: insets.top + 66 }]}>
                <Icon name="pause" size={12} color="#fff" />
                <Text style={styles.pauseText}>Paused</Text>
              </Animated.View>
            )}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

function EndButton({ icon, label, tint, onPress }: { icon: 'rewatch' | 'heart' | 'heartOff' | 'share' | 'eyeOff' | 'trash'; label: string; tint?: string; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  return (
    <PressableScale onPress={onPress} style={styles.endBtn} accessibilityRole="button" accessibilityLabel={label}>
      <View style={styles.endIcon}>
        <Icon name={icon} size={20} color={tint ?? '#fff'} />
      </View>
      <Text style={styles.endLabel}>{label}</Text>
    </PressableScale>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    trailerBars: { position: 'absolute', top: 12, left: 14, right: 14, flexDirection: 'row', gap: 4 },
    trailerBar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
    mix: { width: 172, height: 196, borderRadius: 22, padding: 12, overflow: 'hidden', justifyContent: 'flex-end', gap: 4 },
    mixFan: { position: 'absolute', top: 14, left: 0, right: 0, height: 100 },
    mixImg: { position: 'absolute', top: 6, width: 82, height: 94, borderRadius: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', backgroundColor: 'rgba(0,0,0,0.3)' },
    mixTitle: { color: '#fff', fontSize: 17, fontWeight: '900', letterSpacing: -0.3 },
    mixFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    mixSub: { color: 'rgba(255,255,255,0.82)', fontSize: 12, fontWeight: '700' },
    mixPlay: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
    endClips: { gap: 6, paddingHorizontal: 2, paddingVertical: 6 },
    endClip: { width: 54, height: 72, borderRadius: 9, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)' },
    endClipN: { position: 'absolute', left: 5, bottom: 3, color: '#fff', fontSize: 12, fontWeight: '900' },
    upNext: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, padding: 10, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.35)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
    upNextImg: { width: 56, height: 56, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)' },
    upNextKicker: { color: 'rgba(255,255,255,0.65)', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
    upNextTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
    upNextSub: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '600' },
    upNextPlay: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingLeft: 2 },
    bleed: { marginHorizontal: -16 },
    row: { paddingHorizontal: 16, gap: 10 },
    forYouHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    forYou: { color: p.text, fontSize: 28, fontWeight: '900', letterSpacing: -0.8 },
    forYouSub: { color: p.textSecondary, fontSize: 13, fontWeight: '700' },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
    pillText: { color: p.text, fontSize: 13, fontWeight: '800' },
    newChip: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
    newChipText: { color: '#FF375F', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    tileNew: { position: 'absolute', top: 10, right: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: '#FF375F', borderWidth: 2, borderColor: '#fff' },
    makeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12, marginTop: 6 },
    makeText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    muted: { color: p.textSecondary, fontSize: 13, lineHeight: 18 },
    chip: { borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, backgroundColor: p.card, borderWidth: 1, borderColor: p.border },
    chipText: { color: p.text, fontSize: 13, fontWeight: '700' },
    buildPreview: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, minHeight: 74, alignItems: 'center', justifyContent: 'center' },
    buildThumb: { width: 56, height: 74, borderRadius: 10, overflow: 'hidden', backgroundColor: p.card, borderWidth: 2, borderColor: '#fff' },
    buildCount: { color: p.text, fontSize: 17, fontWeight: '900', textAlign: 'center' },
    buildLabel: { color: p.textSecondary, fontSize: 11, fontWeight: '900', letterSpacing: 1, marginTop: 6 },
    input: { backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: p.text, fontSize: 16, fontWeight: '600' },
    dots: { flexDirection: 'row', gap: 5, alignSelf: 'center', alignItems: 'center' },
    foot: { color: p.textMuted, fontSize: 12, textAlign: 'center', paddingHorizontal: 20, lineHeight: 17, marginTop: 6 },
    link: { fontSize: 14, fontWeight: '700', paddingVertical: 8 },

    empty: { alignItems: 'center', gap: 12, paddingVertical: 50, paddingHorizontal: 20 },
    emptyIcon: { width: 84, height: 84, borderRadius: 26, alignItems: 'center', justifyContent: 'center', ...gradient('linear-gradient(135deg, #FF9F0A 0%, #FF375F 100%)') },
    emptyTitle: { color: p.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
    emptyText: { color: p.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },

    featured: { borderRadius: 30, overflow: 'hidden', justifyContent: 'space-between' },
    featuredTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
    kickerChip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    kickerChipText: { color: '#000', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    heart: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
    bigNum: { position: 'absolute', right: 18, top: 44, fontSize: 180, fontWeight: '900', letterSpacing: -10, lineHeight: 190, opacity: 0.85, mixBlendMode: 'overlay' } as never,
    featuredBottom: { padding: 18, gap: 6 },
    stack: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    stackImg: { width: 38, height: 50, borderRadius: 8, borderWidth: 2, borderColor: '#fff' },
    stackMore: { color: '#fff', fontSize: 13, fontWeight: '800', marginLeft: 8 },
    featuredTitle: { color: '#fff', fontSize: 32, fontWeight: '900', letterSpacing: -1, lineHeight: 35 },
    featuredFoot: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    featuredSub: { color: 'rgba(255,255,255,0.88)', fontSize: 14, fontWeight: '700', flex: 1 },
    featuredCaption: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '700' },
    playBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },

    tile: { borderRadius: 22, overflow: 'hidden', justifyContent: 'flex-end' },
    mosaic: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
    mosaicImg: { width: '49.5%', height: '49.5%' } as never,
    tileNum: { position: 'absolute', right: 6, top: -4, fontSize: 78, fontWeight: '900', letterSpacing: -4, mixBlendMode: 'overlay' } as never,
    tileHeart: { position: 'absolute', top: 10, left: 10, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
    tileText: { padding: 12, gap: 1 },
    tileKickerRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    tileDot: { width: 6, height: 6, borderRadius: 3 },
    tileKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '900', letterSpacing: 1, flexShrink: 1 },
    tileTitle: { color: '#fff', fontSize: 17, fontWeight: '900', letterSpacing: -0.3, lineHeight: 20 },
    tileSub: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '700' },

    player: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', backgroundColor: '#000' },
    center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 28, gap: 12 },
    titleCover: { width: 132, height: 176, borderRadius: 18, overflow: 'hidden', borderWidth: 4, borderColor: '#fff', marginBottom: 10, backgroundColor: 'rgba(255,255,255,0.1)' },
    pKicker: { fontSize: 13, fontWeight: '900', letterSpacing: 1.6 },
    pTitle: { color: '#fff', fontSize: 42, fontWeight: '900', letterSpacing: -1.4, lineHeight: 46 },
    serif: { fontFamily: Platform.select({ ios: 'Georgia', default: 'Georgia, serif' }), fontWeight: '700', letterSpacing: -0.6, fontStyle: 'italic' },
    wide: { textTransform: 'uppercase', letterSpacing: 1, fontWeight: '900' },
    pSub: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '700' },
    caption: { position: 'absolute', left: 22, right: 18, flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
    capWhen: { fontSize: 12, fontWeight: '900', letterSpacing: 1.2 },
    capTitle: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
    capDate: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700' },
    openBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    openText: { color: '#000', fontSize: 13, fontWeight: '800' },
    endRow: { flexDirection: 'row', gap: 10, marginTop: 18, flexWrap: 'wrap' },
    endBtn: { alignItems: 'center', gap: 6, width: 70 },
    endIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
    endLabel: { color: '#fff', fontSize: 12, fontWeight: '800' },
    bars: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', gap: 3, zIndex: 2 },
    bar: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' },
    barFill: { height: 3, backgroundColor: '#fff' },
    top: { position: 'absolute', left: 14, right: 12, zIndex: 3, flexDirection: 'row', gap: 8, alignItems: 'center' },
    moodChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
    moodText: { color: '#fff', fontSize: 13, fontWeight: '800' },
    pausePill: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    pauseText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  });
