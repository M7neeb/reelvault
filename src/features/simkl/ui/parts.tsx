/**
 * Rating badges shared by the Simkl screens: IMDb (yellow), MAL (blue),
 * Simkl (brand mark) and your own star. Presentational only.
 */

import { Text, View } from 'react-native';
import { Image } from 'expo-image';

import { sheet, useStyles, type Palette } from '@/features/vault/ui/theme';

export const SIMKL_ICON = 'https://us.simkl.in/img_favicon/v2/favicon-192x192.png';
export const IMDB_YELLOW = '#F5C518';
export const MAL_BLUE = '#2E51A2';

/** The compact line under a row's title: [IMDb 8.5] [S 8.4] ★ 9 */
export function RatingsLine({
  imdb,
  mal,
  simkl,
  mine,
}: {
  imdb: number | null;
  mal?: number | null;
  simkl: number | null;
  mine: number | null;
}) {
  const styles = useStyles(makeStyles);
  if (imdb === null && !mal && simkl === null && mine === null) return null;
  return (
    <View style={styles.line}>
      {imdb !== null && (
        <View style={styles.pair}>
          <View style={[styles.tag, { backgroundColor: IMDB_YELLOW }]}>
            <Text style={styles.tagTextDark}>IMDb</Text>
          </View>
          <Text style={styles.value}>{imdb.toFixed(1)}</Text>
        </View>
      )}
      {!!mal && (
        <View style={styles.pair}>
          <View style={[styles.tag, { backgroundColor: MAL_BLUE }]}>
            <Text style={styles.tagTextLight}>MAL</Text>
          </View>
          <Text style={styles.value}>{mal.toFixed(1)}</Text>
        </View>
      )}
      {simkl !== null && (
        <View style={styles.pair}>
          <Image source={{ uri: SIMKL_ICON }} style={styles.simkl} />
          <Text style={styles.value}>{simkl.toFixed(1)}</Text>
        </View>
      )}
      {mine !== null && (
        <View style={styles.pair}>
          <Text style={styles.star}>★</Text>
          <Text style={styles.mine}>{mine}</Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    line: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
    pair: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    tag: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
    tagTextDark: { color: '#000', fontSize: 10, fontWeight: '900' },
    tagTextLight: { color: '#fff', fontSize: 10, fontWeight: '900' },
    simkl: { width: 16, height: 16, borderRadius: 3 },
    value: { color: p.textSoft, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
    star: { color: p.rating, fontSize: 14 },
    mine: { color: p.rating, fontSize: 13, fontWeight: '800' },
  });
