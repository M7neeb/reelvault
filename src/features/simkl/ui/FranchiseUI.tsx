/**
 * "Watch order" on a title's page: the franchise it belongs to (from
 * Wikidata), numbered in release order or the series' own order, with what
 * you have seen ticked and this title marked. Tap one to open it.
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { tick } from '@/features/vault/ui/haptics';
import Icon from '@/features/vault/ui/Icon';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { hasOrdinals, sortOrdinal, sortRelease, type Franchise, type FranchiseItem } from '../franchise';
import Poster from './Poster';
import type { CatalogTitle, SimklActions, SimklItem, SimklType } from './types';

export default function WatchOrder({
  type,
  id,
  actions,
  library,
  onOpen,
}: {
  type: SimklType;
  id: number;
  actions: SimklActions;
  /** Your library, to tick what you have seen. */
  library: Map<number, SimklItem>;
  onOpen: (t: CatalogTitle) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [franchises, setFranchises] = useState<Franchise[] | null>(null);
  const [pick, setPick] = useState(0);
  const [order, setOrder] = useState<'release' | 'series'>('release');
  const [matched, setMatched] = useState<Record<string, FranchiseItem[]>>({});

  useEffect(() => {
    let live = true;
    actions
      .loadFranchises(type, id)
      .then((f) => live && setFranchises(f.filter((x) => x.entries.length >= 2)))
      .catch(() => live && setFranchises([]));
    return () => {
      live = false;
    };
  }, [actions, type, id]);

  const current = franchises?.[pick];
  useEffect(() => {
    if (!current || matched[current.qid]) return;
    let live = true;
    actions
      .matchFranchise(current.entries)
      .then((m) => live && setMatched((all) => ({ ...all, [current.qid]: m })))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [actions, current]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!current) return [];
    const base: FranchiseItem[] =
      matched[current.qid] ?? current.entries.map((e) => ({ ...e, simklId: null, type: null, poster: null, year: e.date ? Number(e.date.slice(0, 4)) : null }));
    return order === 'series' ? sortOrdinal(base) : sortRelease(base);
  }, [current, matched, order]);

  if (!franchises || franchises.length === 0 || !current) return null;
  const here = rows.findIndex((r) => r.simklId === id);
  const seen = rows.filter((r) => r.simklId && isSeen(library.get(r.simklId))).length;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Text style={styles.title}>Watch order</Text>
        <Text style={styles.sub}>
          {here >= 0 ? `${here + 1} of ${rows.length}` : `${rows.length} titles`} · {seen} seen
        </Text>
      </View>
      {franchises.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.bleed}>
          {franchises.map((f, i) => (
            <TouchableOpacity
              key={f.qid}
              style={[styles.chip, i === pick && styles.chipOn]}
              onPress={() => {
                tick();
                setPick(i);
              }}>
              <Text style={[styles.chipText, i === pick && styles.chipTextOn]} numberOfLines={1}>
                {f.name} · {f.entries.length}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      {franchises.length === 1 && <Text style={styles.name}>{current.name}</Text>}
      {hasOrdinals(current) && (
        <View style={styles.orders}>
          {(['release', 'series'] as const).map((o) => (
            <TouchableOpacity key={o} style={[styles.order, order === o && styles.orderOn]} onPress={() => setOrder(o)}>
              <Text style={[styles.orderText, order === o && styles.orderTextOn]}>{o === 'release' ? 'Release order' : 'Series order'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={styles.bleed}>
        {rows.map((r, i) => {
          const mine = r.simklId ? library.get(r.simklId) : undefined;
          const isHere = r.simklId === id;
          const upcoming = !!r.date && r.date > today;
          return (
            <TouchableOpacity
              key={r.qid}
              style={styles.item}
              disabled={!r.simklId || !r.type || isHere}
              onPress={() => r.simklId && r.type && onOpen({ simklId: r.simklId, type: r.type, title: r.title, year: r.year, poster: r.poster, slug: null })}
              accessibilityLabel={`${i + 1}. ${r.title}`}>
              <Poster path={r.poster} title={r.title} width={96} height={142} radius={10} style={isHere ? styles.here : undefined}>
                <View style={styles.num}>
                  <Text style={styles.numText}>{i + 1}</Text>
                </View>
                {isSeen(mine) && (
                  <View style={styles.seen}>
                    <Icon name="check" size={11} color="#fff" weight="bold" />
                  </View>
                )}
              </Poster>
              <Text style={[styles.itemTitle, isHere && { color: p.accent }]} numberOfLines={2}>
                {r.title}
              </Text>
              <Text style={styles.itemSub}>{upcoming ? `Out ${r.date}` : (r.year ?? r.date?.slice(0, 4) ?? '')}</Text>
            </TouchableOpacity>
          );
        })}
        {!matched[current.qid] && <ActivityIndicator color={p.textSecondary} style={{ marginLeft: 8 }} />}
      </ScrollView>
      <Text style={styles.credit}>Series data from Wikidata</Text>
    </View>
  );
}

function isSeen(i: SimklItem | undefined): boolean {
  if (!i) return false;
  return i.type === 'movie' ? i.status === 'completed' || !!i.lastWatchedAt : i.status === 'completed' || i.watchedEpisodes > 0;
}

const makeStyles = (p: Palette) =>
  sheet({
    box: { paddingHorizontal: 18, paddingTop: 26, gap: 10 },
    head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    title: { color: p.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
    sub: { color: p.textSecondary, fontSize: 13, fontWeight: '600' },
    name: { color: p.link, fontSize: 15, fontWeight: '700' },
    bleed: { marginHorizontal: -18 },
    chips: { gap: 8, paddingHorizontal: 18 },
    chip: { backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, maxWidth: 240 },
    chipOn: { backgroundColor: p.text },
    chipText: { color: p.textSoft, fontSize: 13, fontWeight: '700' },
    chipTextOn: { color: p.bg },
    orders: { flexDirection: 'row', backgroundColor: p.elevated, borderRadius: 10, padding: 3, alignSelf: 'flex-start' },
    order: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
    orderOn: { backgroundColor: p.card },
    orderText: { color: p.textSecondary, fontSize: 13, fontWeight: '700' },
    orderTextOn: { color: p.text },
    row: { gap: 12, paddingHorizontal: 18, alignItems: 'flex-start' },
    item: { width: 96 },
    here: { borderWidth: 2.5, borderColor: p.accent },
    num: { position: 'absolute', top: 6, left: 6, minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 5, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center' },
    numText: { color: '#fff', fontSize: 12, fontWeight: '900' },
    seen: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: p.success, alignItems: 'center', justifyContent: 'center' },
    itemTitle: { color: p.text, fontSize: 12, fontWeight: '700', marginTop: 6 },
    itemSub: { color: p.textSecondary, fontSize: 11 },
    credit: { color: p.textMuted, fontSize: 11 },
  });
