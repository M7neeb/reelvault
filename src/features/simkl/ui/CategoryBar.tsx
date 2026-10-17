/** Videos · Movies · Shows · Anime - the switch between your own videos and Simkl. */

import { Text, TouchableOpacity, View } from 'react-native';

import { sheet, useStyles, type Palette } from '@/features/vault/ui/theme';

import type { Category } from './types';

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'videos', label: 'Videos' },
  { key: 'movie', label: 'Movies' },
  { key: 'show', label: 'Shows' },
  { key: 'anime', label: 'Anime' },
];

export default function CategoryBar({ value, onChange }: { value: Category; onChange: (c: Category) => void }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {CATEGORIES.map((c) => {
        const on = c.key === value;
        return (
          <TouchableOpacity
            key={c.key}
            style={[styles.item, on && styles.itemOn]}
            onPress={() => onChange(c.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}>
            <Text style={[styles.label, on && styles.labelOn]}>{c.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    bar: { flexDirection: 'row', backgroundColor: p.card, borderRadius: 999, padding: 3, marginBottom: 10 },
    item: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 999 },
    itemOn: { backgroundColor: p.accent },
    label: { color: p.textSoft, fontSize: 14, fontWeight: '600' },
    labelOn: { color: '#fff' },
  });
