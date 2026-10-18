/**
 * A calendar heatmap (one column per week, Monday at the top), sized to the
 * width it is given so it always fits its card. Month names run along the
 * top, M / W / F down the side; tap a day to see what it counted.
 */

import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { usePalette } from './theme';

export type HeatDay = { day: string; count: number; future: boolean };

const LABEL_W = 16;
const GAP = 3;

export default function Heatmap({
  columns,
  max,
  rgb = '245,166,35',
  unit = (n) => `${n} watched`,
}: {
  columns: HeatDay[][];
  max: number;
  /** The colour of a full day, as `r,g,b`. */
  rgb?: string;
  unit?: (n: number) => string;
}) {
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<HeatDay | null>(null);
  const cols = Math.max(1, columns.length);
  const cell = width ? Math.max(5, Math.min(18, Math.floor((width - LABEL_W - GAP * (cols - 1)) / cols))) : 0;

  const shade = (n: number) => {
    if (n <= 0) return p.card;
    const level = Math.min(4, Math.ceil((n / Math.max(1, max)) * 4));
    return `rgba(${rgb},${[0, 0.3, 0.5, 0.75, 1][level]})`;
  };
  const month = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short' });
  const nice = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ gap: 6 }}>
      {cell > 0 && (
        <>
          <View style={{ marginLeft: LABEL_W, height: 14 }}>
            {columns.map((col, i) => {
              const first = col[0]?.day;
              const starts = first && (i === 0 || month(first) !== month(columns[i - 1][0].day));
              // Skip a month that starts too close to the right edge to have room for its name.
              if (!starts || i > cols - 3) return null;
              return (
                <Text key={i} style={{ position: 'absolute', left: i * (cell + GAP), color: p.textSecondary, fontSize: 10, fontWeight: '700' }}>
                  {month(first)}
                </Text>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: LABEL_W, gap: GAP }}>
              {['M', '', 'W', '', 'F', '', ''].map((l, i) => (
                <Text key={i} style={{ height: cell, lineHeight: cell, color: p.textMuted, fontSize: 9, fontWeight: '700' }}>
                  {l}
                </Text>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: GAP }} accessible accessibilityLabel={`Activity over the last ${cols} weeks`}>
              {columns.map((col, i) => (
                <View key={i} style={{ gap: GAP }}>
                  {col.map((d) => (
                    <TouchableOpacity
                      key={d.day}
                      disabled={d.future}
                      onPress={() => setPicked(picked?.day === d.day ? null : d)}
                      hitSlop={2}
                      style={{
                        width: cell,
                        height: cell,
                        borderRadius: Math.max(2, cell / 4.5),
                        backgroundColor: d.future ? 'transparent' : shade(d.count),
                        borderWidth: picked?.day === d.day ? 1.5 : 0,
                        borderColor: p.text,
                      }}
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginLeft: LABEL_W }}>
            <Text style={{ color: p.textSecondary, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
              {picked ? `${nice(picked.day)} · ${picked.count ? unit(picked.count) : 'nothing'}` : 'Tap a day'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text style={{ color: p.textMuted, fontSize: 10, marginRight: 2 }}>Less</Text>
              {[0, 1, 2, 3, 4].map((l) => (
                <View key={l} style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: l === 0 ? p.card : `rgba(${rgb},${[0, 0.3, 0.5, 0.75, 1][l]})` }} />
              ))}
              <Text style={{ color: p.textMuted, fontSize: 10, marginLeft: 2 }}>More</Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}
