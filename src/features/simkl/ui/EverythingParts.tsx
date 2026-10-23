/**
 * The Search tab's own-library parts: "Jump back in" (what you were in the
 * middle of, across every section) and the results from your library as you
 * type. Presentational only (see simkl/ui/types.ts).
 */

import { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import { tick } from '@/features/vault/ui/haptics';
import Icon from '@/features/vault/ui/Icon';
import type { IconName } from '@/features/vault/ui/icons';
import { PressableScale } from '@/features/vault/ui/motion';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';
import type { ThumbSource } from '@/features/vault/ui/types';

import { countByKind, kindLabel, type FindKind, type Found, type JumpItem, type WeekSummary } from '../../home/everything';
import Poster, { hueFor } from './Poster';

/** What the Search tab needs from the rest of the app. */
export type LocalSearch = {
  /** Your library's matches for a query, best first. */
  find: (q: string) => Found[];
  /** What you were in the middle of. */
  jump: JumpItem[];
  /** The picture for a video, audio item or series (Simkl titles use their poster). */
  thumb: (kind: FindKind, id: string) => ThumbSource | null;
  /** Simkl poster path for a title you follow. */
  poster: (simklId: number) => string | null;
  /** Opens a video, audio item or series; `resume` = carry on where you were. */
  open: (kind: Exclude<FindKind, 'movie' | 'show' | 'anime'>, id: string, resume: boolean) => void;
  /** The last 7 days across every section (null while it loads). */
  week: WeekSummary | null;
  /** What you searched lately, newest first. */
  recent: string[];
  remember: (q: string) => void;
  clearRecent: () => void;
};

export const KIND_ICON: Record<FindKind, IconName> = {
  video: 'videos',
  audio: 'headphones',
  book: 'book',
  manga: 'bookOpen',
  movie: 'movie',
  show: 'tv',
  anime: 'anime',
};

const isTitle = (k: FindKind): k is 'movie' | 'show' | 'anime' => k === 'movie' || k === 'show' || k === 'anime';

function Thumb({ local, kind, id, title, w, h, radius }: { local: LocalSearch; kind: FindKind; id: string; title: string; w: number; h: number; radius: number }) {
  const p = usePalette();
  if (isTitle(kind)) return <Poster path={local.poster(Number(id))} title={title} width={w} height={h} radius={radius} />;
  const src = local.thumb(kind, id);
  return (
    <View style={{ width: w, height: h, borderRadius: radius, overflow: 'hidden', backgroundColor: `hsl(${hueFor(title)}, 32%, ${p.scheme === 'dark' ? 22 : 80}%)`, alignItems: 'center', justifyContent: 'center' }}>
      {src ? <Image source={src} style={{ width: w, height: h }} contentFit="cover" transition={120} /> : <Icon name={KIND_ICON[kind]} size={Math.round(Math.min(w, h) * 0.36)} color={p.textSecondary} />}
    </View>
  );
}

/** A shelf of cards: tap to carry on (play / read / next episode). */
export function JumpShelf({ local, onTitle }: { local: LocalSearch; onTitle: (simklId: number) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  if (!local.jump.length) return null;
  return (
    <View>
      <Text style={styles.section}>Jump back in</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
        {local.jump.map((j) => {
          const tall = isTitle(j.kind) || j.kind === 'manga' || j.kind === 'book';
          return (
            <PressableScale
              key={`${j.kind}:${j.id}`}
              style={styles.jumpCard}
              accessibilityLabel={`${j.title}, ${j.sub}`}
              onPress={() => {
                tick();
                if (isTitle(j.kind)) onTitle(Number(j.id));
                else local.open(j.kind, j.id, true);
              }}>
              <View style={styles.jumpRow}>
                <Thumb local={local} kind={j.kind} id={j.id} title={j.title} w={tall ? 54 : 84} h={tall ? 78 : 54} radius={8} />
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={styles.kindRow}>
                    <Icon name={KIND_ICON[j.kind]} size={11} color={p.accent} />
                    <Text style={styles.kindText}>{kindLabel(j.kind).toUpperCase()}</Text>
                  </View>
                  <Text style={styles.jumpTitle} numberOfLines={2}>
                    {j.title}
                  </Text>
                  <Text style={styles.jumpSub} numberOfLines={1}>
                    {j.sub}
                  </Text>
                </View>
                <View style={styles.playDot}>
                  <Icon name={j.kind === 'manga' || j.kind === 'book' ? 'bookOpen' : isTitle(j.kind) ? 'check' : 'play'} size={13} color="#fff" />
                </View>
              </View>
              {j.progress !== null && (
                <View style={styles.track}>
                  <View style={[styles.bar, { width: `${Math.round(Math.max(0.03, j.progress) * 100)}%` }]} />
                </View>
              )}
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

const ORDER: FindKind[] = ['video', 'audio', 'book', 'manga', 'show', 'movie', 'anime'];
const PLURAL: Record<FindKind, string> = { video: 'Videos', audio: 'Audio', book: 'Books', manga: 'Manga', show: 'Shows', movie: 'Movies', anime: 'Anime' };

/** Your library's matches, with a chip per kind when there are several kinds. */
export function LocalResults({
  local,
  query,
  compact,
  onTitle,
}: {
  local: LocalSearch;
  query: string;
  /** Show only the first few (Simkl results follow). */
  compact: boolean;
  onTitle: (simklId: number) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const found = useMemo(() => local.find(query), [local, query]);
  const counts = useMemo(() => countByKind(found), [found]);
  const kinds = ORDER.filter((k) => counts[k]);
  const [only, setOnly] = useState<FindKind | null>(null);
  const [all, setAll] = useState(false);
  const shown = found.filter((f) => !only || f.kind === only);
  const max = compact && !all && !only ? 6 : 60;

  if (!found.length) return <Text style={styles.none}>Nothing in your library for "{query}".</Text>;
  return (
    <View>
      <Text style={styles.section}>
        In your library <Text style={styles.count}>{found.length >= 60 ? '60+' : found.length}</Text>
      </Text>
      {kinds.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {[null, ...kinds].map((k) => (
            <TouchableOpacity
              key={k ?? 'all'}
              style={[styles.chip, only === k && styles.chipOn]}
              onPress={() => {
                tick();
                setOnly(k);
              }}>
              {k && <Icon name={KIND_ICON[k]} size={12} color={only === k ? p.bg : p.textSoft} />}
              <Text style={[styles.chipText, only === k && styles.chipTextOn]}>
                {k ? `${PLURAL[k]} ${counts[k]}` : 'All'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      <View style={styles.list}>
        {shown.slice(0, max).map((f) => {
          const tall = isTitle(f.kind) || f.kind === 'manga' || f.kind === 'book';
          return (
            <TouchableOpacity
              key={`${f.kind}:${f.id}`}
              style={styles.row}
              accessibilityLabel={`${f.title}, ${kindLabel(f.kind)}`}
              onPress={() => {
                tick();
                if (isTitle(f.kind)) onTitle(Number(f.id));
                else local.open(f.kind, f.id, false);
              }}>
              <View style={{ width: 64, alignItems: 'center' }}>
                <Thumb local={local} kind={f.kind} id={f.id} title={f.title} w={tall ? 44 : 64} h={tall ? 64 : 42} radius={6} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {f.title}
                </Text>
                <View style={styles.kindRow}>
                  <Icon name={KIND_ICON[f.kind]} size={11} color={p.textMuted} />
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {[kindLabel(f.kind), f.sub].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
              {f.rating > 0 && (
                <View style={styles.rating}>
                  <Icon name="star" size={10} color={p.rating} />
                  <Text style={styles.ratingText}>{Number.isInteger(f.rating) ? f.rating : f.rating.toFixed(1)}</Text>
                </View>
              )}
              <Icon name="forward" size={12} color={p.textMuted} />
            </TouchableOpacity>
          );
        })}
      </View>
      {shown.length > max && (
        <TouchableOpacity style={styles.more} onPress={() => setAll(true)}>
          <Text style={styles.moreText}>Show all {shown.length}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    section: { color: p.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3, paddingHorizontal: 16, paddingTop: 24, paddingBottom: 10 },
    count: { color: p.textMuted, fontSize: 15, fontWeight: '700' },
    shelf: { gap: 12, paddingHorizontal: 16 },
    jumpCard: { width: 268, backgroundColor: p.elevated, borderRadius: 16, overflow: 'hidden' },
    jumpRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
    kindRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    kindText: { color: p.accent, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
    jumpTitle: { color: p.text, fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
    jumpSub: { color: p.textSecondary, fontSize: 12, fontWeight: '600' },
    playDot: { width: 30, height: 30, borderRadius: 15, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    track: { height: 3, backgroundColor: p.separator },
    bar: { height: 3, backgroundColor: p.accent },

    chips: { gap: 8, paddingHorizontal: 16, paddingBottom: 6 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    chipOn: { backgroundColor: p.text },
    chipText: { color: p.textSoft, fontSize: 13, fontWeight: '700' },
    chipTextOn: { color: p.bg },
    list: { marginHorizontal: 16, marginTop: 4, backgroundColor: p.elevated, borderRadius: 14, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingRight: 12, borderBottomWidth: 0.5, borderBottomColor: p.separator, minHeight: 60 },
    rowTitle: { color: p.text, fontSize: 15, fontWeight: '600' },
    rowSub: { color: p.textSecondary, fontSize: 12, flexShrink: 1 },
    rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    ratingText: { color: p.textSoft, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
    more: { alignSelf: 'center', marginTop: 10, paddingHorizontal: 16, paddingVertical: 8 },
    moreText: { color: p.accent, fontSize: 14, fontWeight: '700' },
    none: { color: p.textSecondary, fontSize: 14, paddingHorizontal: 16, paddingTop: 20 },
  });

const fmtTime = (ms: number) => {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 && h < 10 ? `${h} h ${min % 60} min` : `${h} h`;
};

/** Up, down or the same as the week before. */
function Trend({ now, before }: { now: number; before: number }) {
  const styles = useStyles(makeWeekStyles);
  const p = usePalette();
  if (!before && !now) return null;
  if (!before) return <Text style={[styles.trend, { color: p.textMuted }]}>new this week</Text>;
  const pct = Math.round(((now - before) / before) * 100);
  if (Math.abs(pct) < 5) return <Text style={[styles.trend, { color: p.textMuted }]}>same as last week</Text>;
  return (
    <Text style={[styles.trend, { color: pct > 0 ? '#30D158' : p.textMuted }]}>
      {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}% on last week
    </Text>
  );
}

/** Videos, shows and movies, manga and listening in the last 7 days. */
export function WeekCard({ week }: { week: WeekSummary | null }) {
  const styles = useStyles(makeWeekStyles);
  const p = usePalette();
  if (!week) return null;
  const b = week.before;
  const tiles: { key: string; icon: IconName; label: string; value: string; now: number; before: number }[] = [];
  if (week.videoMs || b.videoMs) tiles.push({ key: 'v', icon: 'videos', label: 'Your videos', value: fmtTime(week.videoMs), now: week.videoMs, before: b.videoMs });
  if (week.episodes || week.movies || b.episodes || b.movies)
    tiles.push({
      key: 's',
      icon: 'tv',
      label: 'Shows and movies',
      value: [week.episodes ? `${week.episodes} ep` : null, week.movies ? `${week.movies} ${week.movies === 1 ? 'movie' : 'movies'}` : null].filter(Boolean).join(' · ') || '0',
      now: week.watchMs,
      before: b.watchMs,
    });
  if (week.chapters || b.chapters) tiles.push({ key: 'm', icon: 'bookOpen', label: 'Manga', value: `${week.chapters} ${week.chapters === 1 ? 'chapter' : 'chapters'}`, now: week.chapters, before: b.chapters });
  if (week.listenMs || b.listenMs) tiles.push({ key: 'a', icon: 'headphones', label: 'Listening', value: fmtTime(week.listenMs), now: week.listenMs, before: b.listenMs });
  if (!tiles.length) return null;
  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.title}>This week</Text>
        <View style={styles.days}>
          {Array.from({ length: 7 }, (_, i) => (
            <View key={i} style={[styles.dot, { backgroundColor: i < week.activeDays ? p.accent : p.separator }]} />
          ))}
          <Text style={styles.daysText}>{week.activeDays} of 7 days</Text>
        </View>
      </View>
      <View style={styles.grid}>
        {tiles.map((t) => (
          <View key={t.key} style={[styles.tile, tiles.length === 1 && { width: '100%' }]}>
            <View style={styles.tileHead}>
              <Icon name={t.icon} size={13} color={p.accent} />
              <Text style={styles.tileLabel} numberOfLines={1}>
                {t.label}
              </Text>
            </View>
            <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
              {t.value}
            </Text>
            <Trend now={t.now} before={t.before} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** What you searched lately: tap to search again. */
export function RecentSearches({ list, onPick, onClear }: { list: string[]; onPick: (q: string) => void; onClear: () => void }) {
  const styles = useStyles(makeWeekStyles);
  const p = usePalette();
  if (!list.length) return null;
  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.title}>Recent</Text>
        <TouchableOpacity onPress={onClear} accessibilityLabel="Clear recent searches" hitSlop={10}>
          <Text style={[styles.daysText, { color: p.accent }]}>Clear</Text>
        </TouchableOpacity>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recent}>
        {list.map((q) => (
          <TouchableOpacity
            key={q}
            style={styles.recentChip}
            onPress={() => {
              tick();
              onPick(q);
            }}>
            <Icon name="history" size={12} color={p.textMuted} />
            <Text style={styles.recentText} numberOfLines={1}>
              {q}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const makeWeekStyles = (p: Palette) =>
  sheet({
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 24, paddingBottom: 10 },
    title: { color: p.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
    days: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    dot: { width: 7, height: 7, borderRadius: 4 },
    daysText: { color: p.textSecondary, fontSize: 13, fontWeight: '600', marginLeft: 4 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 16 },
    tile: { width: '48.4%', backgroundColor: p.elevated, borderRadius: 14, padding: 12, gap: 4 },
    tileHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tileLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '700', flexShrink: 1 },
    value: { color: p.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
    trend: { fontSize: 11, fontWeight: '700' },
    recent: { gap: 8, paddingHorizontal: 16 },
    recentChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 200 },
    recentText: { color: p.text, fontSize: 14, fontWeight: '600' },
  });
