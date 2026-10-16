/**
 * The library drawer: Library, Smart Filters, Status, Keywords, Storage.
 * Presentational only (see the rule in types.ts).
 */

import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { gbFromBytes } from './format';
import { sameFilter, type Filter } from './filters';
import { describeRule, matchesRule, safeBatchGb } from './logic';
import { sheet, useStyles, type Palette } from './theme';
import { STATUSES, type SmartFilter, type UiTag, type VaultItem } from './types';

function DrawerRow({
  label,
  hint,
  count,
  f,
  current,
  onPick,
}: {
  label: string;
  /** Optional second line, e.g. what a smart filter checks. */
  hint?: string;
  /** Hidden when null (the locked Private album). */
  count: number | null;
  f: Filter;
  current: Filter;
  onPick: (f: Filter) => void;
}) {
  const styles = useStyles(makeStyles);
  const active = sameFilter(f, current);
  return (
    <TouchableOpacity style={[styles.row, active && styles.rowOn]} onPress={() => onPick(f)}>
      <View style={styles.rowText}>
        <Text style={[styles.label, active && styles.labelOn]} numberOfLines={1}>
          {label}
        </Text>
        {!!hint && (
          <Text style={styles.hint} numberOfLines={1}>
            {hint}
          </Text>
        )}
      </View>
      {count !== null && <Text style={styles.count}>{count}</Text>}
    </TouchableOpacity>
  );
}

export default function Sidebar({
  items,
  tags,
  tagCounts,
  smartFilters,
  deletedCount,
  duplicateCount,
  privateCount,
  freeGb,
  filter,
  onPick,
  onClose,
  onNewSmart,
  onImport,
}: {
  /** Live videos outside the Private album. */
  items: VaultItem[];
  tags: UiTag[];
  /** tag name -> how many of `items` carry it. */
  tagCounts: Record<string, number>;
  smartFilters: SmartFilter[];
  deletedCount: number;
  duplicateCount: number;
  /** Null while the Private album is locked: its size stays secret too. */
  privateCount: number | null;
  freeGb: number | null;
  filter: Filter;
  onPick: (f: Filter) => void;
  onClose: () => void;
  onNewSmart: () => void;
  onImport: () => void;
}) {
  const styles = useStyles(makeStyles);
  const favorites = items.filter((v) => v.rating >= 8).length;
  const rated = items.filter((v) => v.rating > 0).length;
  const untagged = items.filter((v) => v.tagCount === 0).length;
  const totalBytes = items.reduce((sum, v) => sum + v.sizeBytes, 0);
  const row = { current: filter, onPick };

  return (
    <View style={styles.root}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.drawer}>
        <Text style={styles.title}>ReelVault</Text>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.section}>Library</Text>
          <DrawerRow {...row} label="All Videos" count={items.length} f={{ kind: 'all' }} />
          <DrawerRow {...row} label="★ Favorites" count={favorites} f={{ kind: 'favorites' }} />
          <DrawerRow {...row} label="Rated" count={rated} f={{ kind: 'rated' }} />
          <DrawerRow {...row} label="Untagged" count={untagged} f={{ kind: 'untagged' }} />
          <DrawerRow {...row} label="Duplicates" count={duplicateCount} f={{ kind: 'duplicates' }} />
          <DrawerRow {...row} label="Recently Deleted" count={deletedCount} f={{ kind: 'deleted' }} />
          <DrawerRow
            {...row}
            label="Private"
            hint={privateCount === null ? 'Locked · Face ID' : 'Unlocked'}
            count={privateCount}
            f={{ kind: 'private' }}
          />

          <Text style={styles.section}>Smart Filters</Text>
          {smartFilters.map((s) => (
            <DrawerRow
              {...row}
              key={s.id}
              label={s.name}
              hint={describeRule(s.rule)}
              count={items.filter((v) => matchesRule(v, s.rule)).length}
              f={{ kind: 'smart', id: s.id }}
            />
          ))}
          <TouchableOpacity style={styles.row} onPress={onNewSmart}>
            <Text style={styles.add}>+ New Smart Filter</Text>
          </TouchableOpacity>

          <Text style={styles.section}>Status</Text>
          {STATUSES.map((s) => (
            <DrawerRow
              {...row}
              key={s.key}
              label={s.label}
              count={items.filter((v) => v.status === s.key).length}
              f={{ kind: 'status', status: s.key }}
            />
          ))}

          <Text style={styles.section}>Keywords</Text>
          {tags.length === 0 && <Text style={styles.muted}>No keywords yet.</Text>}
          {tags.map((t) => (
            <DrawerRow
              {...row}
              key={t.id}
              label={`# ${t.name}`}
              count={tagCounts[t.name] ?? 0}
              f={{ kind: 'tag', tag: t.name }}
            />
          ))}

          <Text style={styles.section}>Storage</Text>
          <Text style={styles.stat}>{gbFromBytes(totalBytes)} GB in ReelVault</Text>
          <Text style={styles.stat}>
            {freeGb !== null ? `${freeGb} GB free on device` : 'Device space unavailable'}
          </Text>
          {freeGb !== null && (
            <Text style={styles.stat}>Safe import batch: up to {safeBatchGb(freeGb)} GB</Text>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.action} onPress={onImport}>
            <Text style={styles.actionText}>+ Import</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghost} onPress={onClose}>
            <Text style={styles.ghostText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
    backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: p.backdrop,
    },
    drawer: {
      position: 'absolute',
      top: 0,
      left: 0,
      bottom: 0,
      width: 300,
      backgroundColor: p.panel,
      paddingTop: 62,
      paddingBottom: 24,
    },
    title: { color: p.text, fontSize: 22, fontWeight: '800', paddingHorizontal: 18, paddingBottom: 12 },
    scroll: { paddingHorizontal: 12, paddingBottom: 24, gap: 2 },
    section: {
      color: p.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.5,
      paddingHorizontal: 8,
      paddingTop: 14,
      paddingBottom: 6,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
    },
    rowOn: { backgroundColor: p.accentSoft },
    rowText: { flex: 1, paddingRight: 8 },
    label: { color: p.textSoft, fontSize: 15 },
    labelOn: { color: p.text, fontWeight: '700' },
    hint: { color: p.textSecondary, fontSize: 12, marginTop: 2 },
    count: { color: p.textSecondary, fontSize: 14 },
    add: { color: p.link, fontSize: 15, fontWeight: '600' },
    stat: { color: p.textSecondary, fontSize: 13, paddingHorizontal: 12, paddingVertical: 3 },
    muted: { color: p.textMuted, fontStyle: 'italic', paddingHorizontal: 12 },
    footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 18, paddingTop: 10 },
    action: { flex: 1, backgroundColor: p.accent, padding: 12, borderRadius: 12, alignItems: 'center' },
    actionText: { color: '#fff', fontWeight: '700' },
    ghost: { flex: 1, backgroundColor: p.card, padding: 12, borderRadius: 12, alignItems: 'center' },
    ghostText: { color: p.textSoft, fontWeight: '700' },
  });
