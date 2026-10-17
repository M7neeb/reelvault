/**
 * Calendar: what airs next for titles in your library, with countdowns.
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import Icon from '@/features/vault/ui/Icon';
import { SheetFrame, Section } from '@/features/vault/ui/sheets';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { countdown, myCalendar, SIMKL_TYPES } from '../logic';
import Poster from './Poster';
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
  const [exported, setExported] = useState('');

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
                <Poster path={r.poster} title={r.title} width={46} height={68} radius={7} size="_cm" />
                <View style={styles.rowText}>
                  <Text style={styles.title} numberOfLines={1}>
                    {r.title}
                  </Text>
                  <Text style={styles.sub}>
                    {r.episodeLabel ?? ''}
                    {r.date ? `  ${new Date(r.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </Text>
                </View>
                {!!countdown(r.date ?? null, Date.now()) && (
                  <View style={styles.pill}>
                    <Text style={styles.countdown}>{countdown(r.date ?? null, Date.now())}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </Section>
        ))
      )}
      <TouchableOpacity
        style={styles.export}
        onPress={() =>
          actions
            .exportCalendar()
            .then((n) => setExported(n ? `${n} dates ready - tap Add All` : 'Nothing to add'))
            .catch((e) => setExported(String(e?.message ?? e)))
        }>
        <Icon name="calendar" size={16} color={p.accent} />
        <Text style={styles.exportText}>Add to the Calendar app</Text>
      </TouchableOpacity>
      {!!exported && <Text style={styles.hint}>{exported}</Text>}
      <Text style={styles.hint}>Air dates from the Simkl calendar.</Text>
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    body: { color: p.textSoft, fontSize: 14 },
    hint: { color: p.textSecondary, fontSize: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    rowText: { flex: 1 },
    title: { color: p.text, fontSize: 15, fontWeight: '600' },
    sub: { color: p.textSecondary, fontSize: 13 },
    pill: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    countdown: { color: p.rating, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
    export: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: p.card, borderRadius: 12, paddingVertical: 12 },
    exportText: { color: p.accent, fontSize: 15, fontWeight: '700' },
  });
