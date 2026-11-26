/**
 * A series' cover (2:3): its picture, or a coloured card with its title when
 * it has none. Same colour for the same title every time. Presentational only.
 */

import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { spineHue } from '../../spineColor';
import { DISPLAY_FONT } from '../paletteMath';
import { Spine } from '../spine';
import { Image } from 'expo-image';

import Icon from '../Icon';
import { sheet, useStyles } from '../theme';
import type { MangaUiSeries } from './mangaTypes';

const HUES = [['#5E5CE6', '#22195E'], ['#FF375F', '#5E0F26'], ['#30D158', '#0B4A20'], ['#FF9F0A', '#5E3400'], ['#64D2FF', '#0A3D55'], ['#BF5AF2', '#3F0F5C'], ['#AC8E68', '#3B2E1B']] as const;


export default function MangaCover({
  series,
  width,
  radius = 6,
  style,
  bare,
}: {
  series: Pick<MangaUiSeries, 'coverSource' | 'title'>;
  width: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  /** No title on the stand-in cover (the caller writes it over the cover). */
  bare?: boolean;
}) {
  const styles = useStyles(makeStyles);
  const height = Math.round(width * 1.5);
  if (series.coverSource) {
    return (
      <View style={[{ width, height, borderRadius: Math.min(radius, 8), overflow: 'hidden' }, styles.shade, style]}>
        <Image source={series.coverSource} style={{ width, height }} contentFit="cover" transition={150} recyclingKey={String(series.coverSource)} />
        <Spine name={series.title} width={width >= 90 ? 4 : 3} />
      </View>
    );
  }
  return (
    <View style={[{ width, height, borderRadius: Math.min(radius, 8), backgroundColor: `hsl(${spineHue(series.title)}, 34%, 20%)`, overflow: 'hidden', padding: Math.max(6, width * 0.08), paddingLeft: Math.max(10, width * 0.1), justifyContent: 'flex-end' }, style]}>
      <Spine name={series.title} width={width >= 90 ? 5 : 3} />
      <View style={styles.icon}>
        <Icon name="book" size={Math.max(12, width * 0.16)} color="rgba(255,255,255,0.8)" />
      </View>
      {!bare && (
        <Text style={[styles.title, { fontSize: Math.max(10, width * 0.13) }]} numberOfLines={4}>
          {series.title}
        </Text>
      )}
    </View>
  );
}

const makeStyles = () =>
  sheet({
    shade: { backgroundColor: 'rgba(127,127,127,0.15)' },
    icon: { position: 'absolute', top: 8, right: 8 },
    title: { color: '#fff', fontFamily: DISPLAY_FONT.bold },
  });
