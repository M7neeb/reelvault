/**
 * Your year in days: twelve little month calendars, every day coloured by
 * how long you watched (darker = more, by your own standards). Tap a day to
 * see what it was; pick another year from the chips.
 * Presentational only (see the note at the top of types.ts).
 */

import { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { fmtMs } from '../stats';
import { yearHeat, type HeatPlay, type YearDay } from '../yearHeat';
import { tick } from './haptics';
import { Card } from './insightParts';
import { sheet, usePalette, useStyles, type Palette } from './theme';

const RGB = '48,209,88';
const SHADES = [0, 0.28, 0.5, 0.74, 1];
const GAP = 2;

export function YearHeatCard({ plays, nameOf, index = 0, onOpen }: { plays: HeatPlay[]; nameOf: (id: string) => string | null; index?: number; onOpen?: (videoId: string) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [now] = useState(() => Date.now());
  const [year, setYear] = useState(new Date(now).getFullYear());
  const [picked, setPicked] = useState<YearDay | null>(null);
  const [width, setWidth] = useState(0);
  const h = useMemo(() => yearHeat(plays, year, now), [plays, year]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthW = width ? (width - 2 * 12) / 3 : 0;
  const cell = monthW ? Math.floor((monthW - 6 * GAP) / 7) : 0;
  const todayKey = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime();
  const years = h.years.includes(year) ? h.years : [year, ...h.years];

  const color = (d: YearDay) => (d.future ? 'transparent' : d.level === 0 ? p.card : `rgba(${RGB},${SHADES[d.level]})`);
  const dayText = (d: YearDay) => new Date(d.day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <Card index={index} title={`Your ${year} in days`} sub={h.days ? `${fmtMs(h.totalMs)} on ${h.days} ${h.days === 1 ? 'day' : 'days'} · longest run ${h.run} ${h.run === 1 ? 'day' : 'days'}` : 'Nothing watched this year yet'}>
      {years.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
          {years.map((y) => (
            <TouchableOpacity
              key={y}
              style={[styles.chip, y === year && styles.chipOn]}
              onPress={() => {
                tick();
                setYear(y);
                setPicked(null);
              }}>
              <Text style={[styles.chipText, y === year && styles.chipTextOn]}>{y}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View style={styles.grid} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {!!cell &&
          h.months.map((m) => (
            <View key={m.month} style={{ width: monthW, gap: 4 }}>
              <View style={styles.monthHead}>
                <Text style={styles.monthName}>{m.label}</Text>
                {m.ms > 0 && <Text style={styles.monthMs}>{fmtMs(m.ms)}</Text>}
              </View>
              <View style={{ gap: GAP }}>
                {m.weeks.map((w, wi) => (
                  <View key={wi} style={{ flexDirection: 'row', gap: GAP }}>
                    {w.map((d, di) =>
                      d ? (
                        <TouchableOpacity
                          key={di}
                          disabled={d.future}
                          onPress={() => {
                            tick();
                            setPicked(picked?.day === d.day ? null : d);
                          }}
                          accessibilityLabel={`${dayText(d)}: ${d.ms ? fmtMs(d.ms) : 'nothing'}`}
                          style={[
                            { width: cell, height: cell, borderRadius: Math.max(2, cell / 4), backgroundColor: color(d) },
                            d.future && { borderWidth: 1, borderColor: p.separator },
                            d.day === todayKey && { borderWidth: 1.5, borderColor: p.text },
                            picked?.day === d.day && { borderWidth: 2, borderColor: p.accent },
                          ]}
                        />
                      ) : (
                        <View key={di} style={{ width: cell, height: cell }} />
                      )
                    )}
                  </View>
                ))}
              </View>
            </View>
          ))}
      </View>

      <View style={styles.foot}>
        {picked ? (
          <TouchableOpacity style={{ flex: 1 }} disabled={!picked.top || !onOpen} onPress={() => picked.top && onOpen?.(picked.top)}>
            <Text style={styles.pickDay}>{dayText(picked)}</Text>
            <Text style={styles.pickText} numberOfLines={2}>
              {picked.ms
                ? `${fmtMs(picked.ms)} · ${picked.plays} ${picked.plays === 1 ? 'play' : 'plays'}${picked.top && nameOf(picked.top) ? ` · mostly ${nameOf(picked.top)}` : ''}`
                : 'Nothing watched'}
            </Text>
          </TouchableOpacity>
        ) : (
          <Text style={[styles.pickText, { flex: 1 }]} numberOfLines={2}>
            {h.best ? `Biggest day: ${dayText(h.best)}, ${fmtMs(h.best.ms)}. Tap a day to see it.` : 'Tap a day to see it.'}
          </Text>
        )}
        <View style={styles.legend}>
          <Text style={styles.legendText}>Less</Text>
          {SHADES.map((s, i) => (
            <View key={i} style={[styles.legendCell, { backgroundColor: i === 0 ? p.card : `rgba(${RGB},${s})` }]} />
          ))}
          <Text style={styles.legendText}>More</Text>
        </View>
      </View>
    </Card>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 14, marginTop: 8 },
    monthHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    monthName: { color: p.text, fontSize: 12, fontWeight: '800' },
    monthMs: { color: p.textSecondary, fontSize: 10, fontWeight: '700' },
    chip: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
    chipOn: { backgroundColor: p.text },
    chipText: { color: p.textSoft, fontSize: 13, fontWeight: '700' },
    chipTextOn: { color: p.bg },
    foot: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
    pickDay: { color: p.text, fontSize: 13, fontWeight: '800' },
    pickText: { color: p.textSecondary, fontSize: 12 },
    legend: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    legendCell: { width: 10, height: 10, borderRadius: 3 },
    legendText: { color: p.textMuted, fontSize: 10, fontWeight: '700', marginHorizontal: 2 },
  });
