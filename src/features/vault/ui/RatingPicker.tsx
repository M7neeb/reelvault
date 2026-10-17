/**
 * Rate with one decimal (9.7, 8.1): pick the whole number, then the tenth.
 * Used for your own videos and for Simkl titles. Presentational only.
 */

import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { SheetFrame } from './sheets';
import { sheet, useStyles, type Palette } from './theme';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export default function RatingPicker({
  title = 'My rating',
  value,
  note,
  onPick,
  onClose,
}: {
  title?: string;
  /** Current rating, or null / 0 for none. */
  value: number | null;
  /** A line under the picker (e.g. "Simkl gets 10"). */
  note?: (picked: number) => string | null;
  /** null = clear the rating. */
  onPick: (rating: number | null) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const start = value && value > 0 ? value : 8;
  const [whole, setWhole] = useState(Math.min(10, Math.floor(start)));
  const [tenth, setTenth] = useState(whole >= 10 ? 0 : Math.round((start - Math.floor(start)) * 10));
  const picked = whole >= 10 ? 10 : Math.round((whole + tenth / 10) * 10) / 10;
  const hint = note?.(picked);

  return (
    <SheetFrame
      title={title}
      onClose={onClose}
      action={{
        label: 'Save',
        onPress: () => {
          onClose();
          onPick(picked);
        },
      }}>
      <Text style={styles.big}>{fmt(picked)}</Text>
      <View style={styles.grid}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <View key={n} style={styles.slot}>
            <TouchableOpacity
              style={[styles.cell, whole === n && styles.cellOn]}
              onPress={() => {
                setWhole(n);
                if (n === 10) setTenth(0);
              }}
              accessibilityLabel={`${n}`}>
              <Text style={[styles.cellText, whole === n && styles.cellTextOn]}>{n}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
      <Text style={styles.label}>Decimal</Text>
      <View style={styles.grid}>
        {Array.from({ length: 10 }, (_, i) => i).map((t) => (
          <View key={t} style={styles.slot}>
            <TouchableOpacity
              disabled={whole >= 10}
              style={[styles.cell, styles.small, tenth === t && whole < 10 && styles.cellOn, whole >= 10 && styles.disabled]}
              onPress={() => setTenth(t)}
              accessibilityLabel={`point ${t}`}>
              <Text style={[styles.cellText, styles.smallText, tenth === t && whole < 10 && styles.cellTextOn]}>.{t}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </View>
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
      {!!value && (
        <TouchableOpacity
          onPress={() => {
            onClose();
            onPick(null);
          }}>
          <Text style={styles.clear}>Clear rating</Text>
        </TouchableOpacity>
      )}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    big: { color: p.rating, fontSize: 56, fontWeight: '900', textAlign: 'center', fontVariant: ['tabular-nums'] },
    // Five per row: each slot is a fifth of the width, padded, so rows never wrap early.
    grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
    slot: { width: '20%', padding: 4 },
    cell: { height: 52, borderRadius: 12, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    small: { height: 42 },
    cellOn: { backgroundColor: p.rating },
    cellText: { color: p.text, fontSize: 20, fontWeight: '800' },
    smallText: { fontSize: 16 },
    cellTextOn: { color: '#000' },
    disabled: { opacity: 0.35 },
    label: { color: p.textSecondary, fontSize: 12, fontWeight: '700', marginTop: 4 },
    hint: { color: p.textSecondary, fontSize: 12 },
    clear: { color: p.link, fontSize: 15, paddingVertical: 6 },
  });
