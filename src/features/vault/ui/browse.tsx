/**
 * Ways to browse by date and the library's numbers: HashPhotos' Calendar,
 * Timeline & Events, and Library Overview. Presentational only.
 */

import { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { fmtSize, fmtTotalDuration } from './format';
import { countByDay, dayKey, groupItems, libraryOverview, monthGrid, monthName } from './logic';
import { Section, SheetFrame } from './sheets';
import { sheet, useStyles, type Palette } from './theme';
import type { GroupBy, VaultItem } from './types';

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
          <Text style={styles.arrowText}>‹</Text>
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
          <Text style={styles.arrowText}>›</Text>
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
 * HashPhotos' Timeline & Events: every year, month and day that has videos,
 * newest first. Tapping one jumps the grid there (grouping the grid if needed).
 */
export function TimelineSheet({
  items,
  onJump,
  onClose,
}: {
  items: VaultItem[];
  onJump: (key: string, by: Exclude<GroupBy, 'none'>) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const sorted = useMemo(() => [...items].sort((a, b) => b.createdAt - a.createdAt), [items]);
  const months = useMemo(() => groupItems(sorted, 'month'), [sorted]);
  const [open, setOpen] = useState<string | null>(months[0]?.key ?? null);

  return (
    <SheetFrame title="Timeline" onClose={onClose}>
      {months.length === 0 && <Text style={styles.muted}>No videos yet.</Text>}
      {months.map((m) => {
        const days = open === m.key ? groupItems(m.items, 'day') : [];
        return (
          <View key={m.key}>
            <View style={styles.tlRow}>
              <TouchableOpacity style={styles.tlMain} onPress={() => setOpen(open === m.key ? null : m.key)}>
                <Text style={styles.tlTitle}>
                  {open === m.key ? '▾' : '▸'}  {m.title}
                </Text>
                <Text style={styles.tlCount}>{m.items.length}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.tlGo}
                onPress={() => {
                  onJump(m.key, 'month');
                  onClose();
                }}>
                <Text style={styles.tlGoText}>Go</Text>
              </TouchableOpacity>
            </View>
            {days.map((d) => (
              <TouchableOpacity
                key={d.key}
                style={styles.tlDay}
                onPress={() => {
                  onJump(d.key, 'day');
                  onClose();
                }}>
                <Text style={styles.tlDayTitle}>{d.title}</Text>
                <Text style={styles.tlCount}>{d.items.length}</Text>
              </TouchableOpacity>
            ))}
          </View>
        );
      })}
    </SheetFrame>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Bars({ rows, total }: { rows: { label: string; count: number }[]; total: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.bars}>
      {rows.slice(0, 6).map((r) => (
        <View key={r.label} style={styles.barRow}>
          <Text style={styles.barLabel} numberOfLines={1}>
            {r.label}
          </Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${total ? Math.max(2, (r.count / total) * 100) : 0}%` }]} />
          </View>
          <Text style={styles.barCount}>{r.count}</Text>
        </View>
      ))}
    </View>
  );
}

/** HashPhotos' Library Overview. */
export function OverviewSheet({ items, onClose }: { items: VaultItem[]; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const o = useMemo(() => libraryOverview(items), [items]);
  return (
    <SheetFrame title="Library Overview" onClose={onClose}>
      <View style={styles.stats}>
        <Stat label="videos" value={String(o.count)} />
        <Stat label="on disk" value={fmtSize(o.totalBytes)} />
        <Stat label="to watch it all" value={fmtTotalDuration(o.totalMs)} />
        <Stat label="average rating" value={o.averageRating === null ? '–' : `${o.averageRating}/10`} />
      </View>
      <View style={styles.stats}>
        <Stat label="rated" value={String(o.rated)} />
        <Stat label="with keywords" value={String(o.withKeywords)} />
        <Stat label="in albums" value={String(o.inAlbums)} />
        <Stat label="with location" value={String(o.withLocation)} />
      </View>
      <View style={styles.stats}>
        <Stat label="picks" value={String(o.picks)} />
        <Stat label="rejects" value={String(o.rejects)} />
      </View>
      <Section label="By year">
        <Bars rows={o.byYear} total={o.count} />
      </Section>
      <Section label="By format">
        <Bars rows={o.byFormat} total={o.count} />
      </Section>
      <Section label="By shape">
        <Bars rows={o.byOrientation} total={o.count} />
      </Section>
      <Section label="By camera">
        <Bars rows={o.byDevice} total={o.count} />
      </Section>
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

    tlRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tlMain: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: 12,
      backgroundColor: p.card,
      borderRadius: 10,
    },
    tlTitle: { color: p.text, fontSize: 15, fontWeight: '600' },
    tlCount: { color: p.textSecondary, fontSize: 14 },
    tlGo: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    tlGoText: { color: '#fff', fontWeight: '700' },
    tlDay: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 9,
      paddingLeft: 30,
      paddingRight: 70,
    },
    tlDayTitle: { color: p.textSoft, fontSize: 14 },

    stats: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, backgroundColor: p.card, borderRadius: 12, padding: 10, alignItems: 'center' },
    statValue: { color: p.text, fontSize: 17, fontWeight: '800' },
    statLabel: { color: p.textSecondary, fontSize: 11, textAlign: 'center' },
    bars: { gap: 6 },
    barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    barLabel: { width: 96, color: p.textSoft, fontSize: 13 },
    barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: p.card, overflow: 'hidden' },
    barFill: { height: 8, borderRadius: 4, backgroundColor: p.accent },
    barCount: { width: 36, textAlign: 'right', color: p.textSecondary, fontSize: 13 },
  });
