/**
 * Calendar: what airs next for titles you follow - this tab's type or
 * everything (shows, anime and movie releases together) - with a two-week
 * strip (a dot for each day with something on), countdowns, and a bell on
 * each title to turn its new-episode reminders on or off.
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { tick } from '@/features/vault/ui/haptics';
import Icon from '@/features/vault/ui/Icon';
import { Section, Segment, SheetFrame } from '@/features/vault/ui/sheets';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { countdown, myCalendar, SIMKL_TYPES } from '../logic';
import Poster from './Poster';
import type { CatalogTitle, ReminderSettings, SimklActions, SimklItem, SimklType } from './types';

const DAY = 86_400_000;
const sod = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

const dayLabel = (t: number) => {
  const today = sod(Date.now());
  const diff = Math.round((sod(t) - today) / DAY);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return new Date(t).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
};

const TYPE_ICON: Record<SimklType, 'tv' | 'anime' | 'movie'> = { show: 'tv', anime: 'anime', movie: 'movie' };

export function CalendarModal({
  type,
  items,
  allItems,
  actions,
  onOpen,
  onClose,
}: {
  type: SimklType;
  /** The library titles of this type. */
  items: SimklItem[];
  /** Every library title, for "Everything". */
  allItems?: SimklItem[];
  actions: SimklActions;
  onOpen: (t: CatalogTitle) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [scope, setScope] = useState<'type' | 'all'>('type');
  const [rows, setRows] = useState<CatalogTitle[] | null>(null);
  const [error, setError] = useState('');
  const [exported, setExported] = useState('');
  const [day, setDay] = useState<number | null>(null);
  const [rem, setRem] = useState<ReminderSettings | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    actions
      .getReminders()
      .then(setRem)
      .catch(() => undefined);
  }, [actions]);

  useEffect(() => {
    setRows(null);
    const types: SimklType[] = scope === 'all' ? ['show', 'anime', 'movie'] : [type];
    Promise.all(types.map((t) => actions.calendar(t).catch(() => [] as CatalogTitle[])))
      .then((lists) => setRows(lists.flat()))
      .catch((e) => {
        setRows([]);
        setError(String(e?.message ?? e));
      });
  }, [actions, type, scope]);

  const pool = scope === 'all' && allItems ? allItems : items;
  // Only what you follow: watching, plan to watch, on hold (movies: plan to watch).
  const following = useMemo(
    () => new Set(pool.filter((i) => (i.type === 'movie' ? i.status === 'plantowatch' : i.status !== 'completed' && i.status !== 'dropped')).map((i) => i.simklId)),
    [pool]
  );
  const mine = useMemo(() => (rows ? myCalendar(rows, following, Date.now()) : []), [rows, following]);
  const strip = useMemo(() => {
    const start = sod(Date.now());
    return Array.from({ length: 14 }, (_, i) => {
      const key = sod(start + i * DAY + 2 * 3_600_000);
      return { key, count: mine.filter((r) => sod(Date.parse(r.date ?? '')) === key).length };
    });
  }, [mine]);
  const shown = day === null ? mine : mine.filter((r) => sod(Date.parse(r.date ?? '')) === day);
  const days = useMemo(() => {
    const map = new Map<number, CatalogTitle[]>();
    for (const r of shown) {
      const key = sod(Date.parse(r.date ?? ''));
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()];
  }, [shown]);

  const saveRem = (next: ReminderSettings) => {
    setRem(next);
    actions
      .setReminders(next)
      .then((ok) => {
        if (!ok) {
          setRem({ ...next, enabled: false });
          setNote('Notifications are off for ReelVault in iPhone Settings → Notifications.');
        }
      })
      .catch(() => undefined);
  };
  const bell = (id: number) => {
    if (!rem) return;
    tick();
    if (!rem.enabled) return saveRem({ ...rem, enabled: true, muted: rem.muted.filter((x) => x !== id) });
    saveRem({ ...rem, muted: rem.muted.includes(id) ? rem.muted.filter((x) => x !== id) : [...rem.muted, id] });
  };

  const title = scope === 'all' ? 'Coming up' : `Upcoming ${SIMKL_TYPES.find((t) => t.key === type)?.plural}`;

  return (
    <SheetFrame title={title} onClose={onClose}>
      {allItems && (
        <Segment
          options={[
            { key: 'type', label: SIMKL_TYPES.find((t) => t.key === type)?.plural ?? 'This tab' },
            { key: 'all', label: 'Everything' },
          ]}
          value={scope}
          onChange={(v) => {
            setDay(null);
            setScope(v);
          }}
        />
      )}

      {rem && !rem.enabled && (
        <TouchableOpacity style={styles.remBanner} onPress={() => saveRem({ ...rem, enabled: true })}>
          <Icon name="bell" size={18} color={p.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.remTitle}>Get a notification for each new episode</Text>
            <Text style={styles.sub}>Turn reminders on, then use the bells to choose which titles.</Text>
          </View>
        </TouchableOpacity>
      )}
      {!!note && <Text style={styles.hint}>{note}</Text>}

      {rows !== null && mine.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {strip.map((d) => {
            const on = day === d.key;
            const dt = new Date(d.key);
            return (
              <TouchableOpacity
                key={d.key}
                style={[styles.dayCell, on && { backgroundColor: p.accent }]}
                onPress={() => {
                  tick();
                  setDay(on ? null : d.key);
                }}
                accessibilityLabel={`${dayLabel(d.key)}: ${d.count}`}>
                <Text style={[styles.dayDow, on && { color: '#fff' }]}>{dt.toLocaleDateString(undefined, { weekday: 'narrow' })}</Text>
                <Text style={[styles.dayNum, on && { color: '#fff' }]}>{dt.getDate()}</Text>
                <View style={styles.dots}>
                  {Array.from({ length: Math.min(3, d.count) }, (_, i) => (
                    <View key={i} style={[styles.dot, { backgroundColor: on ? '#fff' : p.rating }]} />
                  ))}
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {rows === null ? (
        <ActivityIndicator color={p.textSecondary} />
      ) : days.length === 0 ? (
        <Text style={styles.body}>{error || (day !== null ? 'Nothing that day.' : 'Nothing you follow comes out in the next weeks.')}</Text>
      ) : (
        days.map(([key, list]) => (
          <Section key={key} label={dayLabel(key)}>
            {list.map((r) => {
              const muted = !rem?.enabled || rem.muted.includes(r.simklId);
              return (
                <TouchableOpacity key={`${r.simklId}-${r.episodeLabel}-${r.date}`} style={styles.row} onPress={() => onOpen(r)}>
                  <Poster path={r.poster} title={r.title} width={46} height={68} radius={7} size="_cm" />
                  <View style={styles.rowText}>
                    <Text style={styles.title} numberOfLines={1}>
                      {r.title}
                    </Text>
                    <View style={styles.metaRow}>
                      <Icon name={TYPE_ICON[r.type]} size={11} color={p.textSecondary} />
                      <Text style={styles.sub}>
                        {r.type === 'movie' ? 'Release' : (r.episodeLabel ?? '')}
                        {r.date && r.type !== 'movie' ? `  ${new Date(r.date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
                      </Text>
                    </View>
                    {!!countdown(r.date ?? null, Date.now()) && <Text style={styles.countdown}>{countdown(r.date ?? null, Date.now())}</Text>}
                  </View>
                  {rem && (
                    <TouchableOpacity
                      style={[styles.bell, !muted && { backgroundColor: `${p.accent}26` }]}
                      hitSlop={8}
                      onPress={() => bell(r.simklId)}
                      accessibilityLabel={muted ? `Remind me about ${r.title}` : `No reminders for ${r.title}`}>
                      <Icon name="bell" size={16} color={muted ? p.textMuted : p.accent} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })}
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
      <Text style={styles.hint}>Air dates from the Simkl calendar. A lit bell means a notification when it comes out.</Text>
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    body: { color: p.textSoft, fontSize: 14 },
    hint: { color: p.textSecondary, fontSize: 12 },
    remBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.card, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: `${p.accent}55` },
    remTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    strip: { gap: 8, paddingVertical: 2 },
    dayCell: { width: 46, paddingVertical: 8, borderRadius: 14, backgroundColor: p.card, alignItems: 'center', gap: 2 },
    dayDow: { color: p.textSecondary, fontSize: 11, fontWeight: '700' },
    dayNum: { color: p.text, fontSize: 17, fontWeight: '800' },
    dots: { flexDirection: 'row', gap: 2, height: 5 },
    dot: { width: 5, height: 5, borderRadius: 3 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    rowText: { flex: 1, gap: 2 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    title: { color: p.text, fontSize: 15, fontWeight: '600' },
    sub: { color: p.textSecondary, fontSize: 13 },
    countdown: { color: p.rating, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
    bell: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    export: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: p.card, borderRadius: 12, paddingVertical: 12 },
    exportText: { color: p.accent, fontSize: 15, fontWeight: '700' },
  });
