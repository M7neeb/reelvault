/**
 * The library drawer: Library, Albums & folders, Smart Filters, Status,
 * Keywords, Browse and Storage. Long-press a row for its options.
 * Presentational only (see the rule in types.ts).
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInLeft } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTabBarSpace } from './chrome';
import { DUR, EASE_OUT, useReducedMotion } from './motion';

import { gbFromBytes } from './format';
import { sameFilter, type Filter } from './filters';
import { describeRule, matchesRule, safeBatchGb } from './logic';
import Icon from './Icon';
import type { IconName } from './icons';
import { raised, sheet, usePalette, useStyles, type Palette } from './theme';
import { STATUSES, type SmartFilter, type UiAlbum, type UiFolder, type UiTag, type VaultItem } from './types';

function DrawerRow({
  label,
  hint,
  count,
  f,
  current,
  icon,
  dot,
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
  icon?: IconName;
  /** A small coloured dot instead of an icon (statuses). */
  dot?: string;
  indent?: boolean;
  onPick: (f: Filter) => void;
  onLongPress?: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const active = sameFilter(f, current);
  return (
    <TouchableOpacity
      style={[styles.row, active && styles.rowOn, indent && styles.indent]}
      onPress={() => onPick(f)}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count !== null ? `${label}, ${count}` : label}>
      <View style={styles.rowLead}>
        {icon ? <Icon name={icon} size={17} color={active ? p.accent : p.textSecondary} /> : dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      </View>
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
      {count !== null && <Text style={[styles.count, count === 0 && styles.countZero, active && styles.countOn]}>{count}</Text>}
    </TouchableOpacity>
  );
}

function ActionRow({ label, onPress, indent }: { label: string; onPress: () => void; indent?: boolean }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <TouchableOpacity style={[styles.row, indent && styles.indent]} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowLead}>
        <Icon name="plus" size={15} color={p.link} weight="bold" />
      </View>
      <Text style={styles.add} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/** A section title, with an optional small action on the right. */
function Heading({ title, action }: { title: string; action?: { label: string; onPress: () => void; a11y?: string } }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.headingRow}>
      <Text style={styles.heading} accessibilityRole="header">
        {title}
      </Text>
      {action && (
        <TouchableOpacity hitSlop={10} onPress={action.onPress} accessibilityLabel={action.a11y ?? action.label}>
          <Text style={styles.headingAction}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
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
  /** Open the keyword manager. */
  onManageKeywords?: () => void;
  /** Tidy up: quick tagging (untagged count) and keep or delete (rarely watched count). */
  tidy?: { untagged: number; cold: number; onQuickTag: () => void; onKeepOrDelete: () => void };
  onCalendar: () => void;
  onTimeline: () => void;
  onOverview: () => void;
  onMap: () => void;
  onRank: () => void;
  onSettings: () => void;
  onImport: () => void;
  onInsights: (tab: 'dashboard' | 'history' | 'wrapped' | 'badges' | 'storage') => void;
  onPersonalise: () => void;
  /** How the albums are listed (A to Z, most watched, recently used). */
  albumSort?: 'name' | 'watched' | 'recent';
  onAlbumSort?: (s: 'name' | 'watched' | 'recent') => void;
};

const TILES: { tab: 'dashboard' | 'history' | 'wrapped' | 'badges' | 'storage'; label: string; icon: IconName; color: string }[] = [
  { tab: 'dashboard', label: 'Dashboard', icon: 'dashboard', color: '#0A84FF' },
  { tab: 'history', label: 'History', icon: 'history', color: '#30B0C7' },
  { tab: 'wrapped', label: 'Wrapped', icon: 'sparkle', color: '#BF5AF2' },
  { tab: 'badges', label: 'Badges', icon: 'trophy', color: '#FF9F0A' },
  { tab: 'storage', label: 'Storage', icon: 'storage', color: '#30D158' },
];

const STATUS_DOT: Record<string, string> = {
  watching: '#0A84FF',
  plantowatch: '#8E8E93',
  completed: '#30D158',
  hold: '#FF9F0A',
  dropped: '#FF453A',
};

const ALBUM_SORT_LABEL = { name: 'A to Z', watched: 'Most watched', recent: 'Recently used' } as const;

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
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const reduce = useReducedMotion();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(340, Math.round(width * 0.86));
  // A bit over four tiles across, so the last one peeks in and says "scroll".
  const tileWidth = Math.floor((drawerWidth - 20 - 4 * 8) / 4.3);
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
  const usedGb = Number(gbFromBytes(totalBytes));
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
      icon={a.isPrivate ? 'lock' : a.pinned ? 'pin' : 'photo'}
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
      icon="wand"
      label={s.name}
      hint={describeRule(s.rule)}
      count={items.filter((v) => matchesRule(v, s.rule)).length}
      f={{ kind: 'smart', id: s.id }}
      onLongPress={() => props.onSmartOptions(s)}
    />
  );
  const browse: { label: string; icon: IconName; onPress: () => void }[] = [
    { label: 'Calendar', icon: 'calendar', onPress: props.onCalendar },
    { label: 'Timeline', icon: 'timeline', onPress: props.onTimeline },
    { label: 'Places', icon: 'mapPin', onPress: props.onMap },
    { label: 'Overview', icon: 'overview', onPress: props.onOverview },
    { label: 'Rank your videos', icon: 'trophy', onPress: props.onRank },
  ];

  return (
    <Animated.View style={styles.root} exiting={FadeOut.duration(DUR.fast)}>
      <Animated.View style={styles.backdrop} entering={FadeIn.duration(DUR.base)}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} accessibilityLabel="Close the library panel" />
      </Animated.View>
      <Animated.View
        style={[styles.drawer, { width: drawerWidth, paddingTop: insets.top + 10, paddingBottom: (tabSpace > 0 ? tabSpace : insets.bottom) + 10 }]}
        entering={reduce ? FadeIn.duration(DUR.fast) : SlideInLeft.duration(DUR.base).easing(EASE_OUT)}>
        <View style={styles.top}>
          <View style={styles.topText}>
            <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} accessibilityRole="header">
              Library
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {items.length} {items.length === 1 ? 'video' : 'videos'} · {usedGb} GB
            </Text>
          </View>
          <TouchableOpacity style={styles.close} onPress={onClose} accessibilityLabel="Close" hitSlop={6}>
            <Icon name="close" size={14} color={p.icon} weight="bold" />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tiles} style={styles.tilesBleed}>
            {TILES.map((t) => (
              <TouchableOpacity key={t.tab} style={[styles.tile, { width: tileWidth }]} onPress={() => props.onInsights(t.tab)} accessibilityRole="button" accessibilityLabel={t.label}>
                <View style={styles.tileIcon}>
                  <View style={[StyleSheet.absoluteFill, styles.tileWash, { backgroundColor: t.color }]} />
                  <Icon name={t.icon} size={18} color={t.color} />
                </View>
                <Text style={styles.tileLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {t.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <DrawerRow {...row} icon="videos" label="All Videos" count={items.length} f={{ kind: 'all' }} />
          <DrawerRow {...row} icon="heart" label="Favorites" count={favorites} f={{ kind: 'favorites' }} />
          <DrawerRow {...row} icon="star" label="Rated" count={rated} f={{ kind: 'rated' }} />
          <DrawerRow {...row} icon="flag" label="Picks" count={picks} f={{ kind: 'picks' }} />
          <DrawerRow {...row} icon="reject" label="Rejects" count={rejects} f={{ kind: 'rejects' }} />
          <DrawerRow {...row} icon="untagged" label="Untagged" count={untagged} f={{ kind: 'untagged' }} />
          <DrawerRow {...row} icon="folder" label="Uncategorized" hint="In no album" count={uncategorized} f={{ kind: 'uncategorized' }} />
          <DrawerRow {...row} icon="mapPin" label="With Location" count={located} f={{ kind: 'located' }} />
          <DrawerRow {...row} icon="tray" label="Tray" count={tray} f={{ kind: 'tray' }} />
          <DrawerRow {...row} icon="duplicate" label="Duplicates" count={duplicateCount} f={{ kind: 'duplicates' }} />
          <DrawerRow {...row} icon="similar" label="Similar Videos" count={similarCount} f={{ kind: 'similar' }} />
          <DrawerRow {...row} icon="trash" label="Recently Deleted" count={deletedCount} f={{ kind: 'deleted' }} />
          <DrawerRow
            {...row}
            icon={privateItems === null ? 'lock' : 'unlock'}
            label="Private"
            hint={privateItems === null ? 'Locked' : 'Unlocked'}
            count={privateItems === null ? null : privateItems.length}
            f={{ kind: 'private' }}
          />
          {privateItems !== null && (
            <>
              {albums.filter((a) => a.isPrivate).map((a) => albumRow(a, true))}
              <ActionRow indent label="New private album" onPress={() => props.onNewAlbum({ isPrivate: true })} />
            </>
          )}

          <Heading
            title="Albums"
            action={
              props.onAlbumSort
                ? {
                    label: ALBUM_SORT_LABEL[props.albumSort ?? 'name'],
                    a11y: 'Change how albums are sorted',
                    onPress: () => props.onAlbumSort!(props.albumSort === 'name' ? 'watched' : props.albumSort === 'watched' ? 'recent' : 'name'),
                  }
                : undefined
            }
          />
          {topAlbums.map((a) => albumRow(a))}
          {folders.map((folder) => {
            const open = openFolders.includes(folder.id);
            const inside = publicAlbums.filter((a) => a.folderId === folder.id);
            const filters = smartFilters.filter((s) => s.folderId === folder.id);
            return (
              <View key={`f${folder.id}`}>
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => setOpenFolders((ids) => (open ? ids.filter((x) => x !== folder.id) : [...ids, folder.id]))}
                  onLongPress={() => props.onFolderOptions(folder)}
                  delayLongPress={350}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}>
                  <View style={styles.rowLead}>
                    <Icon name="folder" size={17} color={p.textSecondary} />
                  </View>
                  <Text style={[styles.label, styles.rowText]} numberOfLines={1}>
                    {folder.name}
                  </Text>
                  <Text style={styles.count}>{inside.length + filters.length}</Text>
                  <View style={styles.chevron}>
                    <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} color={p.textMuted} />
                  </View>
                </TouchableOpacity>
                {open && (
                  <>
                    {inside.map((a) => albumRow(a, true))}
                    {filters.map((s) => smartRow(s, true))}
                    <ActionRow indent label="New album here" onPress={() => props.onNewAlbum({ folderId: folder.id })} />
                  </>
                )}
              </View>
            );
          })}
          <ActionRow label="New album" onPress={() => props.onNewAlbum({})} />
          <ActionRow label="New folder" onPress={props.onNewFolder} />

          <Heading title="Smart Filters" />
          {topFilters.map((s) => smartRow(s))}
          <ActionRow label="New smart filter" onPress={props.onNewSmart} />

          <Heading title="Status" />
          {STATUSES.map((s) => (
            <DrawerRow
              {...row}
              key={s.key}
              dot={STATUS_DOT[s.key] ?? p.textMuted}
              label={s.label}
              count={items.filter((v) => v.status === s.key).length}
              f={{ kind: 'status', status: s.key }}
            />
          ))}

          <Heading title="Keywords" action={tags.length > 0 && props.onManageKeywords ? { label: 'Manage', onPress: props.onManageKeywords, a11y: 'Manage keywords' } : undefined} />
          {tags.length === 0 ? (
            <Text style={styles.muted}>Keywords you add to videos show up here.</Text>
          ) : (
            <View style={styles.chips}>
              {tags.map((t) => {
                const on = sameFilter({ kind: 'tag', tag: t.name }, filter);
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => onPick({ kind: 'tag', tag: t.name })}
                    onLongPress={() => props.onTagOptions(t)}
                    delayLongPress={350}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Keyword ${t.name}, ${tagCounts[t.name] ?? 0}`}>
                    {t.pinned && <Icon name="pin" size={11} color={on ? '#fff' : p.keyword} />}
                    <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                      {t.name}
                    </Text>
                    <Text style={[styles.chipCount, on && styles.chipTextOn]}>{tagCounts[t.name] ?? 0}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {props.tidy && (props.tidy.untagged > 0 || props.tidy.cold > 0) && (
            <>
              <Heading title="Tidy up" />
              {props.tidy.untagged > 0 && (
                <TouchableOpacity style={styles.row} onPress={props.tidy.onQuickTag} accessibilityRole="button">
                  <View style={styles.rowLead}>
                    <Icon name="tag" size={17} color={p.textSecondary} />
                  </View>
                  <Text style={[styles.label, styles.rowText]} numberOfLines={1}>
                    Quick tagging
                  </Text>
                  <Text style={styles.count}>{props.tidy.untagged}</Text>
                </TouchableOpacity>
              )}
              {props.tidy.cold > 0 && (
                <TouchableOpacity style={styles.row} onPress={props.tidy.onKeepOrDelete} accessibilityRole="button">
                  <View style={styles.rowLead}>
                    <Icon name="trash" size={17} color={p.textSecondary} />
                  </View>
                  <Text style={[styles.label, styles.rowText]} numberOfLines={1}>
                    Keep or delete
                  </Text>
                  <Text style={styles.count}>{props.tidy.cold}</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          <Heading title="Browse" />
          <View style={styles.browse}>
            {browse.map((b) => (
              <TouchableOpacity key={b.label} style={styles.browseTile} onPress={b.onPress} accessibilityRole="button" accessibilityLabel={b.label}>
                <Icon name={b.icon} size={20} color={p.text} />
                <Text style={styles.browseLabel} numberOfLines={1}>
                  {b.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Heading title="Storage" />
          <View style={styles.storage}>
            {freeGb !== null && usedGb + freeGb > 0 && (
              <View style={styles.bar} accessibilityLabel={`${usedGb} GB in ReelVault, ${freeGb} GB free`}>
                <View style={[styles.barUsed, { flex: Math.max(0.02, usedGb) }]} />
                <View style={{ flex: Math.max(0.02, freeGb) }} />
              </View>
            )}
            <Text style={styles.stat}>
              <Text style={styles.statStrong}>{usedGb} GB</Text> in ReelVault
              {freeGb !== null ? (
                <>
                  {' · '}
                  <Text style={styles.statStrong}>{freeGb} GB</Text> free
                </>
              ) : null}
            </Text>
            {freeGb !== null && <Text style={styles.statSoft}>Import up to {safeBatchGb(freeGb)} GB at a time</Text>}
          </View>
          <Text style={styles.tip}>Hold an album, folder, smart filter or keyword for its options.</Text>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.importBtn} onPress={props.onImport} accessibilityRole="button">
            <Icon name="plus" size={15} color={p.bg} weight="bold" />
            <Text style={styles.importText} numberOfLines={1}>
              Import
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.round} onPress={props.onPersonalise} accessibilityLabel="Personalise">
            <Icon name="paint" size={18} color={p.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.round} onPress={props.onSettings} accessibilityLabel="Settings">
            <Icon name="settings" size={18} color={p.text} />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
    backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: p.backdrop },
    drawer: {
      position: 'absolute',
      top: 0,
      left: 0,
      bottom: 0,
      backgroundColor: p.bg,
      borderTopRightRadius: 28,
      borderBottomRightRadius: 28,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 24,
      shadowOffset: { width: 6, height: 0 },
    },
    top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 20, paddingBottom: 14 },
    topText: { flex: 1, gap: 2 },
    title: { color: p.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
    subtitle: { color: p.textSecondary, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
    close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: p.circle, marginTop: 6 },
    scroll: { paddingHorizontal: 10, paddingBottom: 28 },

    tilesBleed: { marginHorizontal: -10, marginBottom: 14 },
    tiles: { paddingHorizontal: 20, gap: 8 },
    tile: { alignItems: 'center', gap: 7 },
    tileIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    tileWash: { opacity: 0.16 },
    tileLabel: { color: p.textSoft, fontSize: 12, fontWeight: '600' },

    headingRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 26, paddingBottom: 8 },
    heading: { color: p.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
    headingAction: { color: p.link, fontSize: 14, fontWeight: '600' },

    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, minHeight: 46, paddingVertical: 8, borderRadius: 14 },
    rowOn: { backgroundColor: p.accentSoft },
    indent: { paddingLeft: 28 },
    rowLead: { width: 24, alignItems: 'center' },
    dot: { width: 9, height: 9, borderRadius: 5 },
    rowText: { flex: 1 },
    label: { color: p.textSoft, fontSize: 16, fontWeight: '500' },
    labelOn: { color: p.text, fontWeight: '700' },
    hint: { color: p.textSecondary, fontSize: 12, marginTop: 1 },
    count: { color: p.textSecondary, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
    countZero: { color: p.textMuted },
    countOn: { color: p.accent },
    chevron: { width: 16, alignItems: 'center' },
    add: { color: p.link, fontSize: 15, fontWeight: '600', flex: 1 },

    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 10 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', backgroundColor: raised(p), borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
    chipOn: { backgroundColor: p.accent },
    chipText: { color: p.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
    chipCount: { color: p.textSecondary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
    chipTextOn: { color: '#fff' },

    browse: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 10 },
    browseTile: { width: '48%', flexGrow: 1, gap: 14, backgroundColor: raised(p), borderRadius: 18, padding: 14 },
    browseLabel: { color: p.text, fontSize: 15, fontWeight: '700' },

    storage: { gap: 8, paddingHorizontal: 10 },
    bar: { flexDirection: 'row', height: 8, borderRadius: 4, backgroundColor: raised(p), overflow: 'hidden' },
    barUsed: { backgroundColor: p.accent, borderRadius: 4 },
    stat: { color: p.textSecondary, fontSize: 14 },
    statStrong: { color: p.text, fontWeight: '700' },
    statSoft: { color: p.textMuted, fontSize: 13 },
    tip: { color: p.textMuted, fontSize: 12.5, paddingHorizontal: 10, paddingTop: 22 },
    muted: { color: p.textMuted, fontSize: 14, paddingHorizontal: 10 },

    footer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 10 },
    importBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: p.text, height: 48, borderRadius: 24 },
    importText: { color: p.bg, fontSize: 16, fontWeight: '800' },
    round: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: p.circle },
  });
