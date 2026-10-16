/** Browser preview stand-in for the map: the places as a list (react-native-maps has no web version). */

import { Text, TouchableOpacity, View } from 'react-native';

import { fmtLocation } from './logic';
import { sheet, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

export default function VideoMap({ items, onOpen }: { items: VaultItem[]; onOpen: (item: VaultItem) => void }) {
  const styles = useStyles(makeStyles);
  const located = items.filter((v) => v.meta?.location);
  return (
    <View style={styles.box}>
      <Text style={styles.note}>Map (shown on the iPhone) · {located.length} places</Text>
      {located.map((v) => (
        <TouchableOpacity key={v.id} style={styles.row} onPress={() => onOpen(v)}>
          <Text style={styles.pin}>●</Text>
          <Text style={styles.name} numberOfLines={1}>
            {v.title ?? v.filename}
          </Text>
          <Text style={styles.where}>{fmtLocation(v.meta!.location!)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    box: { flex: 1, backgroundColor: p.card, padding: 16, gap: 10 },
    note: { color: p.textSecondary, fontSize: 13 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    pin: { color: p.dangerText, fontSize: 16 },
    name: { color: p.text, fontSize: 15, flex: 1 },
    where: { color: p.textSecondary, fontSize: 12 },
  });
