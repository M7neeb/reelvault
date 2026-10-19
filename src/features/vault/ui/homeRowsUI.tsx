/**
 * The library's home rows (see homeRows.ts): cards that play their video while
 * they are the one most in view, a row title with what it is, and tapping a
 * card plays the whole row in order. Presentational only.
 */

import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated from 'react-native-reanimated';

import type { HomeRow } from '../homeRows';
import { friendlyName } from '../names';
import { fmtDuration } from './format';
import { gradient } from './insightParts';
import { LiveCard } from './live';
import { enterUp } from './motion';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

export function HomeRows({ rows, onPlay, onHide }: { rows: HomeRow<VaultItem>[]; onPlay: (list: VaultItem[], item: VaultItem) => void; onHide?: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  if (!rows.length) return null;
  return (
    <View style={{ gap: 14, paddingTop: 4, paddingBottom: 6 }}>
      {rows.map((row, ri) => (
        <Animated.View key={row.key} entering={enterUp(Math.min(ri, 5))} style={{ gap: 8 }}>
          <View style={styles.head}>
            <Text style={styles.title}>{row.title}</Text>
            <Text style={styles.detail} numberOfLines={1}>
              {row.detail}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {row.videos.map((v, i) => (
              <TouchableOpacity key={v.id} style={[styles.card, row.key === 'best' && i === 0 && styles.cardWide]} onPress={() => onPlay(row.videos, v)} accessibilityLabel={`${friendlyName(v)}. Play ${row.title}`}>
                <View style={[styles.media, row.key === 'best' && i === 0 && styles.mediaWide]}>
                  <LiveCard id={`home-${row.key}-${v.id}`} uri={v.uri} durationMs={v.durationMs} cover={v.thumbSource} radius={0} style={StyleSheet.absoluteFill} video={v} soundStyle={{ top: 6, right: 6 }} />
                  <View pointerEvents="none" style={[StyleSheet.absoluteFill, gradient('linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.7) 100%)', 'transparent')]} />
                  {v.rating > 0 && (
                    <View style={styles.rate} pointerEvents="none">
                      <Text style={styles.rateText}>★ {v.rating}</Text>
                    </View>
                  )}
                  {!!v.durationMs && (
                    <Text style={styles.dur} pointerEvents="none">
                      {fmtDuration(v.durationMs)}
                    </Text>
                  )}
                </View>
                <Text style={styles.name} numberOfLines={1}>
                  {friendlyName(v)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </Animated.View>
      ))}
      {onHide && (
        <TouchableOpacity onPress={onHide} style={{ alignSelf: 'center' }} hitSlop={8}>
          <Text style={[styles.detail, { color: p.textMuted }]}>Hide these rows (Personalise brings them back)</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    head: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 12 },
    title: { color: p.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
    detail: { color: p.textSecondary, fontSize: 12, fontWeight: '600', flexShrink: 1 },
    row: { gap: 8, paddingHorizontal: 12 },
    card: { width: 164, gap: 4 },
    cardWide: { width: 236 },
    media: { width: 164, height: 104, borderRadius: 12, overflow: 'hidden', backgroundColor: p.card },
    mediaWide: { width: 236 },
    rate: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
    rateText: { color: p.rating, fontSize: 11, fontWeight: '900' },
    dur: { position: 'absolute', right: 6, bottom: 5, color: '#fff', fontSize: 11, fontWeight: '800' },
    name: { color: p.text, fontSize: 13, fontWeight: '700' },
  });
