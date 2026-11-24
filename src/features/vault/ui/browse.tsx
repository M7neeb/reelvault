/**
 * Ways to browse by date and the library's numbers: HashPhotos' Calendar,
 * Timeline & Events, and Library Overview. Presentational only.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { fmtSize, fmtTotalDuration } from './format';
import { countByDay, dayKey, groupItems, libraryOverview, monthGrid, monthName } from './logic';
import { Row, Rows, SheetFrame } from './sheets';
import { raised, sheet, usePalette, useStyles, type Palette } from './theme';
import Icon from './Icon';
import type { DateGroup, VaultItem } from './types';
import Glyph from './Glyph';

const WEEK = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** A month grid; days with videos show how many. Tap a day to see its videos. */
export function CalendarSheet({
  items,
  onPickDay,
  onClose,
}: {
  items: VaultItem[];
  onPickDay: (day: string) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const counts = useMemo(() => countByDay(items), [items]);
  const newest = items.reduce((m, v) => Math.max(m, v.createdAt), 0) || Date.now();
  const [cursor, setCursor] = useState(() => {
    const d = new Date(newest);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const weeks = monthGrid(cursor.year, cursor.month);
  const today = dayKey(Date.now());

  const move = (delta: number) =>
    setCursor((c) => {
      const m = c.month + delta;
      return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });

  const monthTotal = weeks
    .flat()
    .filter((d): d is number => d !== null)
    .reduce((s, d) => s + (counts.get(dayKey(new Date(cursor.year, cursor.month, d).getTime())) ?? 0), 0);

  return (
    <SheetFrame title="Calendar" onClose={onClose}>
      <View style={styles.monthRow}>
        <TouchableOpacity style={styles.arrow} onPress={() => move(-1)} accessibilityLabel="Previous month">
          <Glyph name="back" size={16} />
        </TouchableOpacity>
        <View style={styles.monthTitleWrap}>
          <Text style={styles.monthTitle}>
            {monthName(cursor.month)} {cursor.year}
          </Text>
          <Text style={styles.monthCount}>
            {monthTotal} video{monthTotal === 1 ? '' : 's'}
          </Text>
        </View>
        <TouchableOpacity style={styles.arrow} onPress={() => move(1)} accessibilityLabel="Next month">
          <Glyph name="forward" size={16} />
        </TouchableOpacity>
      </View>

      <View style={styles.weekRow}>
        {WEEK.map((w) => (
          <Text key={w} style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>
      {weeks.map((week, i) => (
        <View key={i} style={styles.weekRow}>
          {week.map((d, j) => {
            if (d === null) return <View key={j} style={styles.cell} />;
            const key = dayKey(new Date(cursor.year, cursor.month, d).getTime());
            const n = counts.get(key) ?? 0;
            return (
              <TouchableOpacity
                key={j}
                style={[styles.cell, n > 0 && styles.cellOn, key === today && styles.cellToday]}
                disabled={n === 0}
                onPress={() => {
                  onPickDay(key);
                  onClose();
                }}>
                <Text style={[styles.dayNum, n > 0 && styles.dayNumOn]}>{d}</Text>
                {n > 0 && <Text style={styles.dayCount}>{n}</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </SheetFrame>
  );
}

/**
 * HashPhotos' Timeline & Events: every month and day that has videos, newest first. Tap a month to
 * see its days; the first row shows the whole month, the others one day (grouping the grid if needed).
 */
export function TimelineSheet({
  items,
  onJump,
  onClose,
}: {
  items: VaultItem[];
  onJump: (key: string, by: DateGroup) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const sorted = useMemo(() => [...items].sort((a, b) => b.createdAt - a.createdAt), [items]);
  const months = useMemo(() => groupItems(sorted, 'month'), [sorted]);
  const years = useMemo(() => {
    const out: { year: string; months: typeof months }[] = [];
    for (const m of months) {
      const year = m.key.slice(0, 4);
      const last = out[out.length - 1];
      if (last && last.year === year) last.months.push(m);
      else out.push({ year, months: [m] });
    }
    return out;
  }, [months]);
  const [open, setOpen] = useState<string | null>(months[0]?.key ?? null);
  const jump = (key: string, by: DateGroup) => {
    onJump(key, by);
    onClose();
  };

  return (
    <SheetFrame title="Timeline" onClose={onClose} page>
      {months.length === 0 && <Text style={styles.muted}>Videos you import show up here by month and day.</Text>}
      {years.map((y) => (
        <View key={y.year} style={styles.year}>
          <Text style={styles.yearTitle} accessibilityRole="header">
            {y.year}
          </Text>
          <View style={styles.card}>
            {y.months.map((m, i) => {
              const isOpen = open === m.key;
              const days = isOpen ? groupItems(m.items, 'day') : [];
              return (
                <View key={m.key} style={i > 0 && styles.line}>
                  <TouchableOpacity
                    style={styles.tlRow}
                    onPress={() => setOpen(isOpen ? null : m.key)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isOpen }}
                    accessibilityLabel={`${m.title}, ${m.items.length} videos`}>
                    <Text style={styles.tlTitle} numberOfLines={1}>
                      {m.title.replace(/\s*\d{4}$/, '')}
                    </Text>
                    <Text style={styles.tlCount}>{m.items.length}</Text>
                    <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size={12} color={p.textMuted} />
                  </TouchableOpacity>
                  {isOpen && (
                    <View style={styles.days}>
                      <TouchableOpacity style={styles.tlDay} onPress={() => jump(m.key, 'month')} accessibilityRole="button">
                        <Text style={styles.tlAll} numberOfLines={1}>
                          Show all of {m.title}
                        </Text>
                        <Icon name="forward" size={12} color={p.link} />
                      </TouchableOpacity>
                      {days.map((d) => (
                        <TouchableOpacity key={d.key} style={styles.tlDay} onPress={() => jump(d.key, 'day')} accessibilityRole="button">
                          <Text style={styles.tlDayTitle} numberOfLines={1}>
                            {d.title}
                          </Text>
                          <Text style={styles.tlCount}>{d.items.length}</Text>
                          <Icon name="forward" size={12} color={p.textMuted} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </SheetFrame>
  );
}

function Bars({ rows, total }: { rows: { label: string; count: number }[]; total: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.bars}>
      {rows.slice(0, 6).map((r) => (
        <View key={r.label} style={styles.barRow} accessibilityLabel={`${r.label}: ${r.count}`}>
          <View style={styles.barHead}>
            <Text style={styles.barLabel} numberOfLines={1}>
              {r.label}
            </Text>
            <Text style={styles.barCount}>{r.count}</Text>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${total ? Math.max(2, (r.count / total) * 100) : 0}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** HashPhotos' Library Overview. */
export function OverviewSheet({ items, onClose }: { items: VaultItem[]; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const o = useMemo(() => libraryOverview(items), [items]);
  const groups: { label: string; rows: [string, string][] }[] = [
    {
      label: 'Your library',
      rows: [
        ['Videos', String(o.count)],
        ['On the phone', fmtSize(o.totalBytes)],
        ['To watch it all', fmtTotalDuration(o.totalMs)],
        ['Average rating', o.averageRating === null ? 'None yet' : `${o.averageRating} of 10`],
      ],
    },
    {
      label: 'Sorted',
      rows: [
        ['Rated', String(o.rated)],
        ['With keywords', String(o.withKeywords)],
        ['In albums', String(o.inAlbums)],
        ['With a place', String(o.withLocation)],
        ['Picks', String(o.picks)],
        ['Rejects', String(o.rejects)],
      ],
    },
    {
      label: 'Space',
      rows: [
        ['Made smaller', String(o.madeSmaller)],
        ['Space saved', fmtSize(o.savedBytes)],
      ],
    },
  ];
  const charts = [
    { label: 'By year', rows: o.byYear },
    { label: 'By format', rows: o.byFormat },
    { label: 'By shape', rows: o.byOrientation },
    { label: 'By camera', rows: o.byDevice },
  ].filter((c) => c.rows.length > 0);
  return (
    <SheetFrame title="Overview" onClose={onClose} page>
      {groups.map((g) => (
        <Rows key={g.label} label={g.label}>
          {g.rows.map(([title, value]) => (
            <Row key={title} title={title} value={value} />
          ))}
        </Rows>
      ))}
      {charts.map((c) => (
        <View key={c.label} style={styles.chart}>
          <Text style={styles.chartTitle} accessibilityRole="header">
            {c.label}
          </Text>
          <View style={styles.card}>
            <Bars rows={c.rows} total={o.count} />
          </View>
        </View>
      ))}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    muted: { color: p.textMuted, fontStyle: 'italic' },
    monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: p.card },
    arrowText: { color: p.text, fontSize: 22, fontWeight: '700' },
    monthTitleWrap: { alignItems: 'center' },
    monthTitle: { color: p.text, fontSize: 18, fontWeight: '700' },
    monthCount: { color: p.textSecondary, fontSize: 12 },
    weekRow: { flexDirection: 'row', justifyContent: 'space-between' },
    weekday: { flex: 1, textAlign: 'center', color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    cell: { flex: 1, aspectRatio: 1, margin: 2, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    cellOn: { backgroundColor: p.accentSoft },
    cellToday: { borderWidth: 1.5, borderColor: p.accent },
    dayNum: { color: p.textMuted, fontSize: 15 },
    dayNumOn: { color: p.text, fontWeight: '700' },
    dayCount: { color: p.link, fontSize: 10, fontWeight: '700' },

    year: { gap: 10 },
    yearTitle: { color: p.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
    card: { backgroundColor: raised(p), borderRadius: 18, overflow: 'hidden' },
    line: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.separator },
    tlRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, minHeight: 52 },
    tlTitle: { flex: 1, color: p.text, fontSize: 16, fontWeight: '600' },
    tlCount: { color: p.textSecondary, fontSize: 15, fontVariant: ['tabular-nums'] },
    days: { paddingBottom: 6 },
    tlDay: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 28, paddingRight: 16, minHeight: 44 },
    tlAll: { flex: 1, color: p.link, fontSize: 15, fontWeight: '600' },
    tlDayTitle: { flex: 1, color: p.textSoft, fontSize: 15 },

    chart: { gap: 10 },
    chartTitle: { color: p.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
    bars: { gap: 14, padding: 16 },
    barRow: { gap: 6 },
    barHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
    barLabel: { flex: 1, color: p.text, fontSize: 15, fontWeight: '500' },
    barTrack: { height: 6, borderRadius: 3, backgroundColor: p.separator, overflow: 'hidden' },
    barFill: { height: 6, borderRadius: 3, backgroundColor: p.accent },
    barCount: { color: p.textSecondary, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  });
