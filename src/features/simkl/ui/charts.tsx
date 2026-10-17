/**
 * Small charts for Stats and the review, drawn with plain views.
 * One series each (so no legend - the section title names it), thin bars with
 * rounded tops sitting on the baseline, a 2px gap between bars, recessive
 * labels, and a tap on a bar shows its exact value. Text uses text colours;
 * only the marks carry the accent. Presentational only.
 */

import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { sheet, useStyles, type Palette } from '@/features/vault/ui/theme';

export type BarDatum = { label: string; value: number };

/** Vertical bars. `format` turns a value into its tooltip / label text. */
export function BarChart({
  data,
  format,
  height = 120,
  labelEvery,
}: {
  data: BarDatum[];
  format: (v: number) => string;
  height?: number;
  /** Show every n-th axis label (default: all when there are 12 or fewer). */
  labelEvery?: number;
}) {
  const styles = useStyles(makeStyles);
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const every = labelEvery ?? (data.length <= 12 ? 1 : data.length <= 31 ? 5 : 6);
  const peak = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const shown = picked ?? (data[peak]?.value ? peak : null);

  return (
    <View>
      <Text style={styles.readout} numberOfLines={1}>
        {shown !== null && data[shown] ? `${data[shown].label}: ${format(data[shown].value)}` : 'Nothing yet'}
        {picked === null && shown !== null ? '  (most)' : ''}
      </Text>
      <View style={[styles.plot, { height }]}>
        {data.map((d, i) => {
          const h = d.value > 0 ? Math.max(3, (d.value / max) * (height - 4)) : 0;
          return (
            <TouchableOpacity
              key={`${d.label}-${i}`}
              style={styles.hit}
              onPress={() => setPicked(picked === i ? null : i)}
              accessibilityLabel={`${d.label}: ${format(d.value)}`}>
              <View style={[styles.bar, { height: h }, (picked ?? -1) === i && styles.barOn]} />
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={styles.baseline} />
      <View style={styles.labels}>
        {data.map((d, i) => (
          <Text key={`${d.label}-${i}`} style={styles.axis} numberOfLines={1}>
            {i % every === 0 ? d.label : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}

/** Horizontal ranked bars: label on the left, value on the right. */
export function RankedBars({ rows, format }: { rows: { label: string; value: number }[]; format: (v: number) => string }) {
  const styles = useStyles(makeStyles);
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <Text style={styles.empty}>Nothing yet</Text>;
  return (
    <View style={styles.ranked}>
      {rows.map((r) => (
        <View key={r.label} style={styles.rankRow}>
          <View style={styles.rankHead}>
            <Text style={styles.rankLabel} numberOfLines={1}>
              {r.label}
            </Text>
            <Text style={styles.rankValue}>{format(r.value)}</Text>
          </View>
          <View style={styles.rankTrack}>
            <View style={[styles.rankFill, { width: `${Math.max(2, (r.value / max) * 100)}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    readout: { color: p.textSoft, fontSize: 13, fontWeight: '600', marginBottom: 6, fontVariant: ['tabular-nums'] },
    plot: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
    hit: { flex: 1, height: '100%', justifyContent: 'flex-end' },
    bar: { backgroundColor: p.accent, borderTopLeftRadius: 4, borderTopRightRadius: 4, opacity: 0.85 },
    barOn: { opacity: 1 },
    baseline: { height: 1, backgroundColor: p.separator },
    labels: { flexDirection: 'row', gap: 2, marginTop: 4 },
    axis: { flex: 1, color: p.textMuted, fontSize: 10, textAlign: 'center', overflow: 'visible' },
    empty: { color: p.textSecondary, fontSize: 13 },
    ranked: { gap: 10 },
    rankRow: { gap: 4 },
    rankHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
    rankLabel: { flex: 1, color: p.text, fontSize: 14 },
    rankValue: { color: p.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
    rankTrack: { height: 6, borderRadius: 3, backgroundColor: p.card, overflow: 'hidden' },
    rankFill: { height: 6, borderRadius: 3, backgroundColor: p.accent },
  });
