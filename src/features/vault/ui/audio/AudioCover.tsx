/**
 * An audio item's cover: its picture, or a coloured square with its first
 * letter and a waveform (or a book) when it has none. Same colour for the
 * same title every time. Presentational only.
 */

import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { spineHue } from '../../spineColor';
import { DISPLAY_FONT } from '../paletteMath';
import { Spine } from '../spine';
import { Image } from 'expo-image';

import Icon from '../Icon';
import { sheet, useStyles } from '../theme';
import type { AudioUiItem } from './audioTypes';

const HUES = [['#5E5CE6', '#2C1E7A'], ['#FF375F', '#7A1230'], ['#30D158', '#0E5A26'], ['#FF9F0A', '#7A4300'], ['#64D2FF', '#0B4A66'], ['#BF5AF2', '#4E1370'], ['#AC8E68', '#4A3A22']] as const;


export default function AudioCover({ item, size, radius = 6, style }: { item: Pick<AudioUiItem, 'coverSource' | 'title' | 'filename' | 'kind'>; size: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles(makeStyles);
  const name = item.title || item.filename;
  if (item.coverSource) {
    return (
      <View style={[{ width: size, height: size, borderRadius: Math.min(radius, 8), overflow: 'hidden' }, styles.shadow, style]}>
        <Image source={item.coverSource} style={{ width: size, height: size }} contentFit="cover" transition={150} recyclingKey={String(item.coverSource)} />
        <Spine name={name} width={size >= 90 ? 4 : 3} />
      </View>
    );
  }
  return (
    <View style={[{ width: size, height: size, borderRadius: Math.min(radius, 8), backgroundColor: `hsl(${spineHue(name)}, 34%, 20%)`, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]}>
      <Spine name={name} width={size >= 90 ? 5 : 3} />
      <Text style={[styles.letter, { fontSize: Math.max(12, size * 0.38) }]}>{name.trim().charAt(0).toUpperCase() || '♪'}</Text>
      {size >= 56 && (
        <View style={styles.badge}>
          <Icon name={item.kind === 'book' ? 'book' : 'audio'} size={Math.max(10, size * 0.13)} color="rgba(255,255,255,0.85)" />
        </View>
      )}
    </View>
  );
}

const makeStyles = () =>
  sheet({
    shadow: { backgroundColor: 'rgba(127,127,127,0.15)' },
    letter: { color: '#fff', fontFamily: DISPLAY_FONT.bold },
    badge: { position: 'absolute', right: 6, bottom: 6 },
  });
