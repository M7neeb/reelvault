/**
 * Calendar: what airs next for titles in your library, with countdowns.
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import { SheetFrame, Section } from '@/features/vault/ui/sheets';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { countdown, myCalendar, posterUrl, SIMKL_TYPES } from '../logic';
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

const makeStyles = (p: Palette) =>
  sheet({
    body: { color: p.textSoft, fontSize: 14 },
    hint: { color: p.textSecondary, fontSize: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    thumb: { width: 42, height: 62, borderRadius: 5, backgroundColor: p.tile },
    rowText: { flex: 1 },
    title: { color: p.text, fontSize: 15, fontWeight: '600' },
    sub: { color: p.textSecondary, fontSize: 13 },
    countdown: { color: p.rating, fontSize: 13, fontWeight: '700' },
  });
