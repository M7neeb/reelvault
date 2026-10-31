/**
 * The poster a Wrapped opens from (Audio and Simkl, like the manga Wrapped
 * tab): your covers or posters drifting behind, the year big, four numbers,
 * your top three and a Play button. `PosterRow` is the row of earlier years
 * and months under it, each a smaller poster with its #1 behind it.
 * Presentational only.
 */

import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInDown } from 'react-native-reanimated';

import Icon from './Icon';
import { gradient } from './insightParts';
import { useReducedMotion } from './motion';
import { CoverWall } from './storyKit';
import { sheet, useStyles, type Palette } from './theme';
import type { ThumbSource } from './types';

export type PosterTop = { title: string; source: ThumbSource | null };

export function WrappedPoster({
  kicker,
  title,
  stats,
  wall,
  top,
  tint,
  background,
  playLabel,
  onPress,
  accessibilityLabel,
  tileAspect = 1.3,
}: {
  kicker: string;
  title: string;
  stats: { v: string; l: string }[];
  wall: ThumbSource[];
  top: PosterTop[];
  tint: string;
  background: string;
  playLabel: string;
  onPress: () => void;
  accessibilityLabel: string;
  /** Square covers (audio) or tall posters. */
  tileAspect?: number;
}) {
  const styles = useStyles(makeStyles);
  const reduce = useReducedMotion();
  const coverW = (k: number) => (k ? 40 : 48);
  return (
    <Animated.View entering={reduce ? undefined : FadeInDown.duration(420)}>
      <TouchableOpacity activeOpacity={0.9} style={[styles.poster, { backgroundColor: background }]} onPress={onPress} accessibilityLabel={accessibilityLabel}>
        <CoverWall sources={wall} rows={4} tile={76} tilt={-12} opacity={0.55} />
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.92) 100%)', 'rgba(0,0,0,0.55)')]} />
        <View style={[styles.glow, { backgroundColor: tint }]} />
        <View style={{ gap: 10 }}>
          <Text style={styles.kicker}>{kicker}</Text>
          <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit>
            {title}
          </Text>
          <View style={styles.stats}>
            {stats.map((c) => (
              <View key={c.l} style={styles.stat}>
                <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
                  {c.v}
                </Text>
                <Text style={styles.statLabel}>{c.l}</Text>
              </View>
            ))}
          </View>
          {top.length > 0 && (
            <View style={styles.topRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {top.slice(0, 3).map((t, k) => (
                  <View key={k} style={{ marginLeft: k ? -14 : 0, zIndex: 3 - k, transform: [{ rotate: `${(k - 1) * 5}deg` }] }}>
                    {t.source ? (
                      <Image source={t.source} style={{ width: coverW(k), height: coverW(k) * tileAspect, borderRadius: 7 }} contentFit="cover" transition={0} />
                    ) : (
                      <View style={[styles.noCover, { width: coverW(k), height: coverW(k) * tileAspect }]}>
                        <Text style={styles.noCoverText}>{t.title.trim()[0]?.toUpperCase() ?? '?'}</Text>
                      </View>
                    )}
                    {k === 0 && (
                      <View style={styles.rankBadge}>
                        <Text style={styles.rankBadgeText}>1</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.topRank}>YOUR #1</Text>
                <Text style={styles.topTitle} numberOfLines={2}>
                  {top[0].title}
                </Text>
                {top.length > 1 && (
                  <Text style={styles.topMore} numberOfLines={1}>
                    then {top.slice(1, 3).map((t) => t.title).join(', ')}
                  </Text>
                )}
              </View>
            </View>
          )}
          <View style={styles.play}>
            <Icon name="play" size={14} color="#000" />
            <Text style={styles.playText}>{playLabel}</Text>
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

/** Earlier years and months: small posters to swipe through, each with its #1 behind it. */
export function PosterRow({ title, items }: { title: string; items: { key: string; label: string; line: string; top?: string; source: ThumbSource | null; onPress: () => void }[] }) {
  const styles = useStyles(makeStyles);
  if (!items.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.rowTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 8 }}>
        {items.map((it) => (
          <TouchableOpacity key={it.key} activeOpacity={0.85} style={styles.small} onPress={it.onPress} accessibilityLabel={`Play ${it.label}`}>
            {it.source && <Image source={it.source} style={[StyleSheet.absoluteFill, { opacity: 0.6 }]} contentFit="cover" transition={0} />}
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.9) 100%)', 'rgba(0,0,0,0.55)')]} />
            <Text style={styles.smallBig} numberOfLines={1} adjustsFontSizeToFit>
              {it.label}
            </Text>
            <Text style={styles.smallLine} numberOfLines={2}>
              {it.line}
            </Text>
            {!!it.top && (
              <Text style={styles.smallTop} numberOfLines={1}>
                #1 {it.top}
              </Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    poster: { borderRadius: 28, padding: 20, paddingTop: 110, overflow: 'hidden' },
    glow: { position: 'absolute', right: -80, top: -80, width: 260, height: 260, borderRadius: 130, opacity: 0.35 },
    kicker: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '900', letterSpacing: 1.6 },
    big: { color: '#fff', fontSize: 84, fontWeight: '900', letterSpacing: -4, lineHeight: 86, marginVertical: -4 },
    stats: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center' },
    statValue: { color: '#fff', fontSize: 19, fontWeight: '900' },
    statLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '800', marginTop: 1 },
    topRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 16, padding: 10 },
    noCover: { borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
    noCoverText: { color: '#fff', fontSize: 18, fontWeight: '900' },
    rankBadge: { position: 'absolute', top: -6, left: -6, width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFD60A', alignItems: 'center', justifyContent: 'center' },
    rankBadgeText: { color: '#000', fontSize: 11, fontWeight: '900' },
    topRank: { color: '#FFD60A', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    topTitle: { color: '#fff', fontSize: 16, fontWeight: '900' },
    topMore: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700' },
    play: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11, marginTop: 4 },
    playText: { color: '#000', fontSize: 15, fontWeight: '900' },
    rowTitle: { color: p.text, fontSize: 20, fontWeight: '900', letterSpacing: -0.3 },
    small: { width: 140, height: 180, borderRadius: 20, padding: 12, justifyContent: 'flex-end', overflow: 'hidden', backgroundColor: p.card, gap: 2 },
    smallBig: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: -1 },
    smallLine: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
    smallTop: { color: '#FFD60A', fontSize: 11, fontWeight: '800' },
  });
