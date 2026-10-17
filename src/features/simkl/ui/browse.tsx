/**
 * Calendar (what airs next for titles in your library) and Stats.
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import { SheetFrame, Section } from '@/features/vault/ui/sheets';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { countdown, myCalendar, posterUrl, SIMKL_TYPES, STATUS_LABELS, statsFor, watchHeatmap, type SimklStatus } from '../logic';
import type { CatalogTitle, SimklActions, SimklItem, SimklType } from './types';

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
};

export function CalendarModal({
  type,
  items,
  actions,
  onOpen,
  onClose,
}: {
  type: SimklType;
  /** The library titles of this type. */
  items: SimklItem[];
  actions: SimklActions;
  onOpen: (t: CatalogTitle) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [rows, setRows] = useState<CatalogTitle[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    actions
      .calendar(type)
      .then(setRows)
      .catch((e) => {
        setRows([]);
        setError(String(e?.message ?? e));
      });
  }, [actions, type]);

  // Only what you follow: watching, plan to watch, on hold.
  const following = useMemo(
    () => new Set(items.filter((i) => i.status !== 'completed' && i.status !== 'dropped').map((i) => i.simklId)),
    [items]
  );
  const mine = useMemo(() => (rows ? myCalendar(rows, following, Date.now()) : []), [rows, following]);
  const days = useMemo(() => {
    const map = new Map<string, CatalogTitle[]>();
    for (const r of mine) {
      const key = dayLabel(r.date ?? '');
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()];
  }, [mine]);

  return (
    <SheetFrame title={`Upcoming ${SIMKL_TYPES.find((t) => t.key === type)?.plural}`} onClose={onClose}>
      {rows === null ? (
        <ActivityIndicator color={p.textSecondary} />
      ) : days.length === 0 ? (
        <Text style={styles.body}>
          {error || 'Nothing from your Watching, Plan to Watch or On Hold list airs in the next weeks.'}
        </Text>
      ) : (
        days.map(([day, list]) => (
          <Section key={day} label={day}>
            {list.map((r) => (
              <TouchableOpacity key={`${r.simklId}-${r.episodeLabel}`} style={styles.row} onPress={() => onOpen(r)}>
                <Image source={{ uri: posterUrl(r.poster, '_cm') }} style={styles.thumb} contentFit="cover" />
                <View style={styles.rowText}>
                  <Text style={styles.title} numberOfLines={1}>
                    {r.title}
                  </Text>
                  <Text style={styles.sub}>
                    {r.episodeLabel ?? ''}
                    {r.date ? `  ${new Date(r.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </Text>
                </View>
                {!!countdown(r.date ?? null, Date.now()) && <Text style={styles.countdown}>{countdown(r.date ?? null, Date.now())}</Text>}
              </TouchableOpacity>
            ))}
          </Section>
        ))
      )}
      <Text style={styles.hint}>Air dates from the Simkl calendar.</Text>
    </SheetFrame>
  );
}

const fmtMinutes = (m: number) => {
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  return days ? `${days} d ${hours} h` : `${hours} h ${m % 60} min`;
};

export function StatsModal({ items, actions, onClose }: { items: SimklItem[]; actions: SimklActions; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const all = useMemo(() => statsFor(items), [items]);
  const [times, setTimes] = useState<(string | null)[] | null>(null);
  useEffect(() => {
    actions
      .watchTimes()
      .then(setTimes)
      .catch(() => setTimes([]));
  }, [actions]);
  const heat = useMemo(() => (times ? watchHeatmap(times, Date.now(), 18) : null), [times]);
  const shade = (n: number) => {
    if (!heat || n === 0) return p.card;
    const level = Math.min(4, Math.ceil((n / Math.max(1, heat.max)) * 4));
    return ['', 'rgba(245,166,35,0.3)', 'rgba(245,166,35,0.5)', 'rgba(245,166,35,0.75)', p.rating][level];
  };
  return (
    <SheetFrame title="Simkl Stats" onClose={onClose}>
      <View style={styles.tiles}>
        <Tile label="titles" value={String(all.total)} />
        <Tile label="episodes watched" value={String(all.episodesWatched)} />
        <Tile label="time watched" value={fmtMinutes(all.minutesWatched)} />
        <Tile label="average rating" value={all.averageRating === null ? '–' : `${all.averageRating}/10`} />
      </View>
      <Section label="Last 18 weeks">
        {heat ? (
          <>
            <View style={styles.heat}>
              {heat.columns.map((col, i) => (
                <View key={i} style={styles.heatCol}>
                  {col.map((d) => (
                    <View key={d.day} style={[styles.heatCell, { backgroundColor: d.future ? 'transparent' : shade(d.count) }]} />
                  ))}
                </View>
              ))}
            </View>
            <Text style={styles.hint}>
              Episodes and movies you marked, per day · streak {heat.current} {heat.current === 1 ? 'day' : 'days'} · longest{' '}
              {heat.longest}
            </Text>
          </>
        ) : (
          <ActivityIndicator color={p.textSecondary} />
        )}
      </Section>
      {SIMKL_TYPES.map((t) => {
        const s = statsFor(items.filter((i) => i.type === t.key));
        return (
          <Section key={t.key} label={`${t.plural} · ${s.total}`}>
            {(Object.keys(s.byStatus) as SimklStatus[])
              .filter((k) => s.byStatus[k] > 0)
              .map((k) => (
                <View key={k} style={styles.statRow}>
                  <Text style={styles.body}>{STATUS_LABELS[k]}</Text>
                  <Text style={styles.statValue}>{s.byStatus[k]}</Text>
                </View>
              ))}
            {s.total > 0 && (
              <Text style={styles.hint}>
                {fmtMinutes(s.minutesWatched)} watched{s.averageRating !== null ? ` · average ${s.averageRating}/10` : ''}
              </Text>
            )}
          </Section>
        );
      })}
      <Text style={styles.hint}>Counted from your library on this phone; time uses each title's runtime.</Text>
    </SheetFrame>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    body: { color: p.textSoft, fontSize: 14 },
    hint: { color: p.textSecondary, fontSize: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    thumb: { width: 42, height: 62, borderRadius: 5, backgroundColor: p.tile },
    rowText: { flex: 1 },
    title: { color: p.text, fontSize: 15, fontWeight: '600' },
    sub: { color: p.textSecondary, fontSize: 13 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    tile: { backgroundColor: p.card, borderRadius: 12, padding: 12, width: '47%' },
    tileValue: { color: p.text, fontSize: 20, fontWeight: '800' },
    tileLabel: { color: p.textSecondary, fontSize: 12 },
    statRow: { flexDirection: 'row', justifyContent: 'space-between' },
    statValue: { color: p.text, fontWeight: '700' },
    countdown: { color: p.rating, fontSize: 13, fontWeight: '700' },
    heat: { flexDirection: 'row', gap: 3 },
    heatCol: { gap: 3 },
    heatCell: { width: 14, height: 14, borderRadius: 3 },
  });
