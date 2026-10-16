/**
 * The library drawer: Library, Albums & folders, Smart Filters, Status,
 * Keywords, Browse and Storage. Long-press a row for its options.
 * Presentational only (see the rule in types.ts).
 */

import { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { gbFromBytes } from './format';
import { sameFilter, type Filter } from './filters';
import { describeRule, matchesRule, safeBatchGb } from './logic';
import { sheet, useStyles, type Palette } from './theme';
import { STATUSES, type SmartFilter, type UiAlbum, type UiFolder, type UiTag, type VaultItem } from './types';

function DrawerRow({
  label,
  hint,
  count,
  f,
  current,
  indent,
  onPick,
  onLongPress,
}: {
  label: string;
  /** Optional second line, e.g. what a smart filter checks. */
  hint?: string;
  /** Hidden when null (the locked Private album). */
  count: number | null;
  f: Filter;
  current: Filter;
  indent?: boolean;
  onPick: (f: Filter) => void;
  onLongPress?: () => void;
}) {
  const styles = useStyles(makeStyles);
  const active = sameFilter(f, current);
  return (
    <TouchableOpacity
      style={[styles.row, active && styles.rowOn, indent && styles.indent]}
      onPress={() => onPick(f)}
      onLongPress={onLongPress}
      delayLongPress={350}>
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

function ActionRow({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <Text style={styles.add}>{label}</Text>
    </TouchableOpacity>
  );
}

export type SidebarProps = {
  /** Live videos outside the Private album. */
  items: VaultItem[];
  /** Private videos - only passed while Private is unlocked (and not the decoy). */
  privateItems: VaultItem[] | null;
  tags: UiTag[];
  /** tag name -> how many of `items` carry it. */
  tagCounts: Record<string, number>;
  smartFilters: SmartFilter[];
  albums: UiAlbum[];
  folders: UiFolder[];
  deletedCount: number;
  duplicateCount: number;
  similarCount: number;
  freeGb: number | null;
  filter: Filter;
  onPick: (f: Filter) => void;
  onClose: () => void;
  onNewSmart: () => void;
  onNewAlbum: (opts: { folderId?: number | null; isPrivate?: boolean }) => void;
  onNewFolder: () => void;
  onAlbumOptions: (album: UiAlbum) => void;
  onFolderOptions: (folder: UiFolder) => void;
  onSmartOptions: (filter: SmartFilter) => void;
  onTagOptions: (tag: UiTag) => void;
  onCalendar: () => void;
  onTimeline: () => void;
  onOverview: () => void;
  onSettings: () => void;
  onImport: () => void;
};

export default function Sidebar(props: SidebarProps) {
  const {
    items,
    privateItems,
    tags,
    tagCounts,
    smartFilters,
    albums,
    folders,
    deletedCount,
    duplicateCount,
    similarCount,
    freeGb,
    filter,
    onPick,
    onClose,
  } = props;
  const styles = useStyles(makeStyles);
  const [openFolders, setOpenFolders] = useState<number[]>([]);

  const favorites = items.filter((v) => v.rating >= 8).length;
  const rated = items.filter((v) => v.rating > 0).length;
  const untagged = items.filter((v) => v.tagCount === 0).length;
  const picks = items.filter((v) => v.flag === 1).length;
  const rejects = items.filter((v) => v.flag === -1).length;
  const tray = items.filter((v) => v.inTray).length;
  const located = items.filter((v) => v.meta?.location).length;
  const counted = new Set(albums.filter((a) => !a.excludeUncategorized).map((a) => a.id));
  const uncategorized = items.filter((v) => !v.albumIds.some((id) => counted.has(id))).length;
  const totalBytes = items.reduce((sum, v) => sum + v.sizeBytes, 0);
  const row = { current: filter, onPick };

  const albumCount = (a: UiAlbum) => (a.isPrivate ? privateItems ?? [] : items).filter((v) => v.albumIds.includes(a.id)).length;
  const publicAlbums = albums.filter((a) => !a.isPrivate);
  const topAlbums = publicAlbums.filter((a) => a.folderId === null);
  const topFilters = smartFilters.filter((s) => s.folderId === null);

  const albumRow = (a: UiAlbum, indent = false) => (
    <DrawerRow
      {...row}
      key={`a${a.id}`}
      indent={indent}
      label={a.name}
      hint={a.pinned ? 'Pinned' : undefined}
      count={albumCount(a)}
      f={{ kind: 'album', id: a.id }}
      onLongPress={() => props.onAlbumOptions(a)}
    />
  );
  const smartRow = (s: SmartFilter, indent = false) => (
    <DrawerRow
      {...row}
      key={`s${s.id}`}
      indent={indent}
      label={s.name}
      hint={describeRule(s.rule)}
      count={items.filter((v) => matchesRule(v, s.rule)).length}
      f={{ kind: 'smart', id: s.id }}
      onLongPress={() => props.onSmartOptions(s)}
    />
  );

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
          <DrawerRow {...row} label="Picks" count={picks} f={{ kind: 'picks' }} />
          <DrawerRow {...row} label="Rejects" count={rejects} f={{ kind: 'rejects' }} />
          <DrawerRow {...row} label="Untagged" count={untagged} f={{ kind: 'untagged' }} />
          <DrawerRow {...row} label="Uncategorized" hint="In no album" count={uncategorized} f={{ kind: 'uncategorized' }} />
          <DrawerRow {...row} label="With Location" count={located} f={{ kind: 'located' }} />
          <DrawerRow {...row} label="Tray" count={tray} f={{ kind: 'tray' }} />
          <DrawerRow {...row} label="Duplicates" count={duplicateCount} f={{ kind: 'duplicates' }} />
          <DrawerRow {...row} label="Similar Videos" count={similarCount} f={{ kind: 'similar' }} />
          <DrawerRow {...row} label="Recently Deleted" count={deletedCount} f={{ kind: 'deleted' }} />
          <DrawerRow
            {...row}
            label="Private"
            hint={privateItems === null ? 'Locked' : 'Unlocked'}
            count={privateItems === null ? null : privateItems.length}
            f={{ kind: 'private' }}
          />
          {privateItems !== null && (
            <>
              {albums.filter((a) => a.isPrivate).map((a) => albumRow(a, true))}
              <ActionRow label="   + New Private Album" onPress={() => props.onNewAlbum({ isPrivate: true })} />
            </>
          )}

          <Text style={styles.section}>Albums</Text>
          {topAlbums.map((a) => albumRow(a))}
          {folders.map((folder) => {
            const open = openFolders.includes(folder.id);
            const inside = publicAlbums.filter((a) => a.folderId === folder.id);
            const filters = smartFilters.filter((s) => s.folderId === folder.id);
            return (
              <View key={`f${folder.id}`}>
                <TouchableOpacity
                  style={styles.row}
                  onPress={() =>
                    setOpenFolders((ids) => (open ? ids.filter((x) => x !== folder.id) : [...ids, folder.id]))
                  }
                  onLongPress={() => props.onFolderOptions(folder)}
                  delayLongPress={350}>
                  <Text style={styles.label} numberOfLines={1}>
                    {open ? '▾' : '▸'}  {folder.name}
                  </Text>
                  <Text style={styles.count}>{inside.length + filters.length}</Text>
                </TouchableOpacity>
                {open && (
                  <>
                    {inside.map((a) => albumRow(a, true))}
                    {filters.map((s) => smartRow(s, true))}
                    <ActionRow label="   + New Album here" onPress={() => props.onNewAlbum({ folderId: folder.id })} />
                  </>
                )}
              </View>
            );
          })}
          <ActionRow label="+ New Album" onPress={() => props.onNewAlbum({})} />
          <ActionRow label="+ New Folder" onPress={props.onNewFolder} />

          <Text style={styles.section}>Smart Filters</Text>
          {topFilters.map((s) => smartRow(s))}
          <ActionRow label="+ New Smart Filter" onPress={props.onNewSmart} />

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
              hint={t.pinned ? 'Pinned' : undefined}
              count={tagCounts[t.name] ?? 0}
              f={{ kind: 'tag', tag: t.name }}
              onLongPress={() => props.onTagOptions(t)}
            />
          ))}

          <Text style={styles.section}>Browse</Text>
          <ActionRow label="Calendar" onPress={props.onCalendar} />
          <ActionRow label="Timeline" onPress={props.onTimeline} />
          <ActionRow label="Library Overview" onPress={props.onOverview} />

          <Text style={styles.section}>Storage</Text>
          <Text style={styles.stat}>{gbFromBytes(totalBytes)} GB in ReelVault</Text>
          <Text style={styles.stat}>
            {freeGb !== null ? `${freeGb} GB free on device` : 'Device space unavailable'}
          </Text>
          {freeGb !== null && <Text style={styles.stat}>Safe import batch: up to {safeBatchGb(freeGb)} GB</Text>}
          <Text style={styles.tip}>Tip: long-press an album, folder, smart filter or keyword for its options.</Text>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.action} onPress={props.onImport}>
            <Text style={styles.actionText}>+ Import</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.ghost} onPress={props.onSettings}>
            <Text style={styles.ghostText}>Settings</Text>
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
    indent: { paddingLeft: 28 },
    rowText: { flex: 1, paddingRight: 8 },
    label: { color: p.textSoft, fontSize: 15 },
    labelOn: { color: p.text, fontWeight: '700' },
    hint: { color: p.textSecondary, fontSize: 12, marginTop: 2 },
    count: { color: p.textSecondary, fontSize: 14 },
    add: { color: p.link, fontSize: 15, fontWeight: '600' },
    stat: { color: p.textSecondary, fontSize: 13, paddingHorizontal: 12, paddingVertical: 3 },
    tip: { color: p.textMuted, fontSize: 12, paddingHorizontal: 12, paddingTop: 12 },
    muted: { color: p.textMuted, fontStyle: 'italic', paddingHorizontal: 12 },
    footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 10 },
    action: { flex: 1.2, backgroundColor: p.accent, padding: 12, borderRadius: 12, alignItems: 'center' },
    actionText: { color: '#fff', fontWeight: '700' },
    ghost: { flex: 1, backgroundColor: p.card, padding: 12, borderRadius: 12, alignItems: 'center' },
    ghostText: { color: p.textSoft, fontWeight: '700' },
  });
