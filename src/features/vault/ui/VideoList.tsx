/**
 * The two list layouts of the Videos tab (Settings → Personalise → Layout):
 * - Detailed: one row per video with every fact, tags, your rating word, how
 *   often you watched it and where you stopped;
 * - Desktop: a table with sortable columns, and a rail of quick filters on
 *   the left, like a file manager on a computer.
 * The grid layouts (Standard, Simple, Compact) stay in Grid.tsx.
 */

import { FlatList, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import { fmtBytes, fmtClock, ratingLabel, type RatingLabels } from '../stats';
import { useTabBarSpace } from './chrome';
import type { Filter } from './filters';
import { fmtDuration } from './format';
import Icon from './Icon';
import type { IconName } from './icons';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultItem, VaultSort } from './types';

const nameOf = (v: VaultItem) => v.title || v.filename.replace(/\.[a-z0-9]{2,4}$/i, '');
const quality = (v: VaultItem) => {
  const s = Math.min(v.width ?? 0, v.height ?? 0);
  return !s ? null : s >= 2000 ? '4K' : s >= 1000 ? '1080p' : s >= 700 ? '720p' : `${s}p`;
};
const fmtDate = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

type Shared = {
  items: VaultItem[];
  header: React.ReactElement;
  empty: React.ReactElement;
  selectMode: boolean;
  selected: string[];
  labels: RatingLabels;
  resume: Map<string, number>;
  linked: Set<string>;
  plays: Map<string, number>;
  onPress: (v: VaultItem) => void;
  onLongPress?: (v: VaultItem) => void;
};

function Check({ on }: { on: boolean }) {
  const styles = useStyles(makeStyles);
  return <View style={[styles.check, on && styles.checkOn]}>{on && <Icon name="check" size={12} color="#fff" weight="bold" />}</View>;
}

/* ----------------------------------------------------------------- detailed */

export function DetailedList(props: Shared) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const tabSpace = useTabBarSpace();
  return (
    <FlatList
      data={props.items}
      keyExtractor={(v) => v.id}
      ListHeaderComponent={props.header}
      ListEmptyComponent={props.empty}
      contentContainerStyle={{ paddingBottom: Math.max(40, tabSpace + 24) }}
      renderItem={({ item: v }) => {
        const saved = props.resume.get(v.id);
        const word = ratingLabel(v.rating, props.labels);
        const n = props.plays.get(v.id) ?? 0;
        return (
          <TouchableOpacity style={styles.drow} onPress={() => props.onPress(v)} onLongPress={() => props.onLongPress?.(v)} delayLongPress={350}>
            {props.selectMode && <Check on={props.selected.includes(v.id)} />}
            <View style={styles.dthumb}>
              <Image source={v.thumbSource} style={styles.dthumbImg} contentFit="cover" recyclingKey={v.id} />
              {!!v.durationMs && <Text style={styles.ddur}>{fmtDuration(v.durationMs)}</Text>}
              {saved !== undefined && !!v.durationMs && (
                <View style={styles.dtrack}>
                  <View style={[styles.dfill, { width: `${Math.min(100, (saved / v.durationMs) * 100)}%` }]} />
                </View>
              )}
            </View>
            <View style={styles.dtext}>
              <Text style={styles.dtitle} numberOfLines={1}>
                {v.flag === 1 ? '⚑ ' : ''}
                {nameOf(v)}
              </Text>
              <Text style={styles.dmeta} numberOfLines={1}>
                {[fmtDate(v.createdAt), quality(v), fmtBytes(v.sizeBytes)].filter(Boolean).join(' · ')}
              </Text>
              <View style={styles.dline}>
                {v.rating > 0 && (
                  <Text style={styles.drating}>
                    ★ {Number.isInteger(v.rating) ? v.rating : v.rating.toFixed(1)}
                    {word ? <Text style={styles.dword}>{`  ${word}`}</Text> : null}
                  </Text>
                )}
                {n > 0 && <Text style={styles.dplays}>▶ {n}</Text>}
                {saved !== undefined && <Text style={[styles.dplays, { color: p.accent }]}>at {fmtClock(saved)}</Text>}
                {props.linked.has(v.id) && <Icon name="tv" size={12} color={p.textSecondary} />}
              </View>
              {v.tagNames.length > 0 && (
                <View style={styles.dtags}>
                  {v.tagNames.slice(0, 4).map((t) => (
                    <Text key={t} style={styles.dtag} numberOfLines={1}>
                      #{t}
                    </Text>
                  ))}
                  {v.tagNames.length > 4 && <Text style={styles.dmore}>+{v.tagNames.length - 4}</Text>}
                </View>
              )}
            </View>
          </TouchableOpacity>
        );
      }}
    />
  );
}

/* ------------------------------------------------------------------ desktop */

type Col = { key: string; label: string; flex: number; sort?: VaultSort; align?: 'right' };
const COLS: Col[] = [
  { key: 'name', label: 'Name', flex: 3.2, sort: 'name' },
  { key: 'date', label: 'Date', flex: 1.7, sort: 'recent' },
  { key: 'len', label: 'Length', flex: 1.2, sort: 'duration', align: 'right' },
  { key: 'size', label: 'Size', flex: 1.2, sort: 'size', align: 'right' },
  { key: 'rate', label: '★', flex: 0.8, sort: 'rating', align: 'right' },
];

const RAIL: { icon: IconName; label: string; f: Filter }[] = [
  { icon: 'videos', label: 'All Videos', f: { kind: 'all' } },
  { icon: 'star', label: 'Favorites', f: { kind: 'favorites' } },
  { icon: 'flag', label: 'Picks', f: { kind: 'picks' } },
  { icon: 'tag', label: 'Untagged', f: { kind: 'untagged' } },
  { icon: 'lists', label: 'Tray', f: { kind: 'tray' } },
  { icon: 'lock', label: 'Private', f: { kind: 'private' } },
  { icon: 'trash', label: 'Recently Deleted', f: { kind: 'deleted' } },
];

export function DesktopTable(
  props: Shared & {
    sort: VaultSort;
    onSort: (s: VaultSort) => void;
    filter: Filter;
    onFilter: (f: Filter) => void;
    onMore: () => void;
    topInset: number;
  }
) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const tabSpace = useTabBarSpace();
  return (
    <View style={styles.desk}>
      <View style={[styles.rail, { paddingTop: props.topInset, paddingBottom: Math.max(16, tabSpace) }]}>
        {RAIL.map((r) => {
          const on = props.filter.kind === r.f.kind;
          return (
            <TouchableOpacity key={r.label} style={[styles.railBtn, on && styles.railOn]} onPress={() => props.onFilter(r.f)} accessibilityLabel={r.label}>
              <Icon name={r.icon} size={18} color={on ? '#fff' : p.textSecondary} />
            </TouchableOpacity>
          );
        })}
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.railBtn} onPress={props.onMore} accessibilityLabel="All albums, tags and filters">
          <Icon name="sidebar" size={18} color={p.textSecondary} />
        </TouchableOpacity>
      </View>
      <FlatList
        style={{ flex: 1 }}
        data={props.items}
        keyExtractor={(v) => v.id}
        ListHeaderComponent={
          <>
            {props.header}
            <View style={styles.thead}>
              {COLS.map((c) => {
                const on = c.sort === props.sort || (c.key === 'date' && props.sort === 'oldest');
                return (
                  <TouchableOpacity
                    key={c.key}
                    style={{ flex: c.flex }}
                    onPress={() => c.sort && props.onSort(c.key === 'date' && props.sort === 'recent' ? 'oldest' : c.sort)}>
                    <Text style={[styles.th, c.align === 'right' && styles.right, on && { color: p.accent }]}>
                      {c.label}
                      {on ? (props.sort === 'oldest' || props.sort === 'name' ? ' ↑' : ' ↓') : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        }
        ListEmptyComponent={props.empty}
        contentContainerStyle={{ paddingBottom: Math.max(40, tabSpace + 24) }}
        renderItem={({ item: v, index }) => {
          const sel = props.selected.includes(v.id);
          return (
            <TouchableOpacity
              style={[styles.trow, index % 2 === 1 && styles.trowAlt, sel && styles.trowSel]}
              onPress={() => props.onPress(v)}
              onLongPress={() => props.onLongPress?.(v)}
              delayLongPress={350}>
              <View style={[styles.tcellName, { flex: COLS[0].flex }]}>
                {props.selectMode && <Check on={sel} />}
                <Image source={v.thumbSource} style={styles.tthumb} contentFit="cover" recyclingKey={v.id} />
                <Text style={styles.tname} numberOfLines={1}>
                  {nameOf(v)}
                </Text>
              </View>
              <Text style={[styles.td, { flex: COLS[1].flex }]} numberOfLines={1}>
                {new Date(v.createdAt).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' })}
              </Text>
              <Text style={[styles.td, styles.right, { flex: COLS[2].flex }]}>{v.durationMs ? fmtDuration(v.durationMs) : '–'}</Text>
              <Text style={[styles.td, styles.right, { flex: COLS[3].flex }]}>{fmtBytes(v.sizeBytes)}</Text>
              <Text style={[styles.td, styles.right, { flex: COLS[4].flex, color: v.rating ? p.rating : p.textMuted }]}>{v.rating || '–'}</Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: p.textMuted, alignItems: 'center', justifyContent: 'center' },
    checkOn: { backgroundColor: p.accent, borderColor: p.accent },

    drow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
    dthumb: { width: 132, height: 76, borderRadius: 10, overflow: 'hidden', backgroundColor: p.tile },
    dthumbImg: { width: 132, height: 76 },
    ddur: {
      position: 'absolute',
      right: 4,
      bottom: 4,
      color: '#fff',
      fontSize: 10,
      fontWeight: '700',
      backgroundColor: 'rgba(0,0,0,0.55)',
      paddingHorizontal: 4,
      borderRadius: 4,
      overflow: 'hidden',
      fontVariant: ['tabular-nums'],
    },
    dtrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(0,0,0,0.5)' },
    dfill: { height: 3, backgroundColor: p.accent },
    dtext: { flex: 1, gap: 3, borderBottomWidth: 1, borderBottomColor: p.separator, paddingBottom: 8 },
    dtitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    dmeta: { color: p.textSecondary, fontSize: 12 },
    dline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    drating: { color: p.rating, fontSize: 13, fontWeight: '800' },
    dword: { color: p.textSoft, fontWeight: '600' },
    dplays: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    dtags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
    dtag: { color: p.keyword, fontSize: 11, fontWeight: '700', backgroundColor: p.accentSoft, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, maxWidth: 110, overflow: 'hidden' },
    dmore: { color: p.textSecondary, fontSize: 11, fontWeight: '700' },

    desk: { flex: 1, flexDirection: 'row' },
    rail: { width: 52, alignItems: 'center', gap: 6, backgroundColor: p.panel, borderRightWidth: 1, borderRightColor: p.separator },
    railBtn: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    railOn: { backgroundColor: p.accent },
    thead: { flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: p.border, backgroundColor: p.panel },
    th: { color: p.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
    right: { textAlign: 'right' },
    trow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 40 },
    trowAlt: { backgroundColor: p.elevated },
    trowSel: { backgroundColor: p.accentSoft },
    tcellName: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingRight: 6 },
    tthumb: { width: 40, height: 24, borderRadius: 4, backgroundColor: p.tile },
    tname: { flex: 1, color: p.text, fontSize: 13, fontWeight: '600' },
    td: { color: p.textSoft, fontSize: 12, fontVariant: ['tabular-nums'] },
  });
