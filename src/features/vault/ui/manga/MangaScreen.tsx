/**
 * The Manga section's library: manga, manhwa and comics as a wall of covers.
 * Continue reading at the top, then filters (status, unread, favourites,
 * kind, your keywords), search and sorting. Each cover shows your rating and
 * how many chapters are unread. Hold a cover to select several (hold a second
 * one to pick everything between; All and Invert at the top work on the tab
 * you are on, and the picks stay while you switch tabs), then Move them to a
 * status or categories, rate, mark read, download, move to Private or delete
 * (Recently Deleted keeps them for the days you chose). Presentational only.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions, Alert } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DEFAULT_LIBRARY_VIEW,
  DEFAULT_TAB_PREFS,
  arrangeTabs,
  parseTabPrefs,
  renameTabKey,
  type TabPrefs,
  MANGA_STATUSES,
  chapterLabel,
  continueReading,
  downloadedCount,
  fmtRating,
  idsBetween,
  invertSelection,
  matchesManga,
  nextChapter,
  parseLibraryView,
  progressOf,
  sourceLabel,
  statusGroups,
  unreadCount,
  viewLibrary,
  type LibraryView,
  type MangaFilter,
  type MangaStatus,
} from '../../manga/mangaLogic';
import { getSetting, setSetting } from '../../library';
import LibrarySheet from './LibrarySheet';
import { useTabBarSpace } from '../chrome';
import { tick } from '../haptics';
import { confirmAction } from '../confirm';
import Icon from '../Icon';
import IconButton from '../IconButton';
import { enterUp } from '../motion';
import { ModeSwitch, type VideosMode } from '../overviewParts';
import { OptionsSheet, type OptionItem } from '../prompts';
import RatingPicker from '../RatingPicker';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import Fade from '../Fade';
import MangaCover from './MangaCover';
import MoveSheet from './MoveSheet';
import TabsSheet from './TabsSheet';
import type { DownloadState, MangaActions, MangaUiSeries } from './mangaTypes';

const VIEW_KEY = 'manga.libraryView';
const TABS_KEY = 'manga.tabs';
const SIDE = 12;
const GAP = 10;

type Chip = { key: string; label: string; filter: MangaFilter };


/** A picker or import that went wrong says so, instead of doing nothing. */
const failed = (e: unknown) => Alert.alert('That did not work', String(e).replace(/^Error:\s*/, ''));

export default function MangaScreen({
  items,
  deleted,
  status,
  busy,
  showPrivate,
  onUnlockPrivate,
  actions,
  onOpen,
  onContinue,
  onMode,
  onBrowse,
  onDashboard,
  onFeed,
  onDownloads,
  downloads,
  initialDeleted = false,
}: {
  items: MangaUiSeries[];
  deleted: MangaUiSeries[];
  status: string;
  busy: boolean;
  showPrivate: boolean;
  onUnlockPrivate?: () => void;
  actions: MangaActions;
  /** The series' page. */
  onOpen: (s: MangaUiSeries) => void;
  /** Straight into the reader, where you left off. */
  onContinue: (s: MangaUiSeries) => void;
  onMode: (m: VideosMode) => void;
  /** Sources, servers and extensions. */
  onBrowse: () => void;
  onDashboard: () => void;
  /** Updates (new chapters) or History (what you read). */
  onFeed: (tab: 'updates' | 'history') => void;
  onDownloads: () => void;
  downloads: DownloadState;
  initialDeleted?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const tabSpace = useTabBarSpace();
  const { width } = useWindowDimensions();
  // Filter · Sort · Display, kept between visits.
  const [view, setView] = useState<LibraryView>(DEFAULT_LIBRARY_VIEW);
  useEffect(() => {
    getSetting(VIEW_KEY)
      .then((raw) => setView(parseLibraryView(raw)))
      .catch(() => undefined);
  }, []);
  const changeView = (v: LibraryView) => {
    setView(v);
    setSetting(VIEW_KEY, JSON.stringify(v)).catch(() => undefined);
  };
  // The tabs: your order, hidden ones, names, empty categories (Edit tabs).
  const [tabPrefs, setTabPrefs] = useState<TabPrefs>(DEFAULT_TAB_PREFS);
  useEffect(() => {
    getSetting(TABS_KEY)
      .then((raw) => setTabPrefs(parseTabPrefs(raw)))
      .catch(() => undefined);
  }, []);
  const changeTabs = (t: TabPrefs) => {
    setTabPrefs(t);
    setSetting(TABS_KEY, JSON.stringify(t)).catch(() => undefined);
  };
  const [tabsOpen, setTabsOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // Big covers, two to a row by default (twice as many on wide screens), like Tachimanga.
  const cols = view.layout === 'list' ? 1 : width >= 700 ? view.perRow * 2 : view.perRow;
  const tileW = Math.floor((width - SIDE * 2 - GAP * (cols - 1)) / cols);
  const small = cols >= 4;

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState('all');
  const [inDeleted, setInDeleted] = useState(initialDeleted);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  // The last cover tapped while selecting: holding another picks everything between.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [menu, setMenu] = useState<null | 'add' | 'more' | 'move' | 'read' | 'dl' | 'pick-more' | 'deleted-one' | 'download-all'>(null);
  const [rating, setRating] = useState(false);
  // A short note at the bottom after a change, with Undo when it can be taken back.
  const [note, setNote] = useState<{ text: string; undo?: () => void } | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = (text: string, undo?: () => void) => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    setNote({ text, undo });
    noteTimer.current = setTimeout(() => setNote(null), 6000);
  };
  useEffect(() => () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
  }, []);
  const [deletedTarget, setDeletedTarget] = useState<MangaUiSeries | null>(null);

  const visible = useMemo(() => items.filter((s) => showPrivate || !s.isPrivate), [items, showPrivate]);
  const privateCount = items.length - visible.length;
  const tags = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of visible) for (const t of s.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [visible]);
  // Categories: your keywords, plus ones you made that no title is in yet.
  const categories = useMemo(() => [...tags, ...tabPrefs.extra.filter((t) => !tags.includes(t))], [tags, tabPrefs.extra]);
  const chips: Chip[] = useMemo(
    () =>
      arrangeTabs(
        (
          [
          { key: 'all', label: 'Library', filter: {} },
          ...MANGA_STATUSES.map((s) => ({ key: s.key, label: s.label, filter: { status: s.key } as MangaFilter })),
          { key: 'unread', label: 'Unread', filter: { unread: true } },
          { key: 'fav', label: 'Favourites', filter: { favourites: true } },
          { key: 'manhwa', label: 'Manhwa', filter: { kind: 'manhwa' } },
          { key: 'comic', label: 'Comics', filter: { kind: 'comic' } },
          ...categories.map((t) => ({ key: `#${t}`, label: t, filter: { tag: t } as MangaFilter })),
          ] as Chip[]
        ).map((c) => ({ ...c, label: tabPrefs.labels[c.key] ?? c.label })),
        tabPrefs
      ),
    [categories, tabPrefs]
  );
  const active = chips.find((c) => c.key === chip) ?? chips[0];
  const source = inDeleted ? deleted.filter((s) => showPrivate || !s.isPrivate) : visible;
  const list = useMemo(() => viewLibrary(source.filter((s) => matchesManga(s, { ...active.filter, query })), view), [source, active, query, view]);
  const sourceNames = useMemo(() => [...new Set(visible.map((s) => sourceLabel(s.sourceId)))].sort(), [visible]);
  const filtering = view.filter.unread || view.filter.downloaded || view.filter.completed || view.filter.sources.length > 0;
  const counts = useMemo(() => Object.fromEntries(chips.map((c) => [c.key, visible.filter((s) => matchesManga(s, c.filter)).length])), [chips, visible]);
  const resume = useMemo(() => (!view.continueRow || query || chip !== 'all' || inDeleted ? [] : continueReading(visible)), [visible, query, chip, inDeleted, view.continueRow]);

  const ids = selected ? [...selected] : [];
  const picked = useMemo(() => (selected ? items.filter((s) => selected.has(s.id)) : []), [items, selected]);
  const listIds = useMemo(() => list.map((s) => s.id), [list]);
  const shownPicked = selected ? listIds.filter((id) => selected.has(id)).length : 0;
  const allShownPicked = listIds.length > 0 && shownPicked === listIds.length;
  const titles = (n: number) => `${n} ${n === 1 ? 'title' : 'titles'}`;
  const endSelect = () => {
    setSelected(null);
    setAnchor(null);
  };
  const toggle = (id: string) => {
    setAnchor(id);
    setSelected((s) => {
      const n = new Set(s ?? []);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  /** Hold a second cover: it and everything between it and the last one tapped. */
  const pickRange = (id: string) => {
    const range = anchor ? idsBetween(listIds, anchor, id) : [id];
    setAnchor(id);
    setSelected((s) => new Set([...(s ?? []), ...(range.length ? range : [id])]));
  };
  const moveTo = (status: MangaStatus | null) => {
    const before = statusGroups(picked);
    const n = picked.length;
    const label = status ? MANGA_STATUSES.find((x) => x.key === status)?.label : 'No status';
    actions
      .update(ids, { status })
      .then(() =>
        say(`Moved ${titles(n)} to ${label}`, () => {
          Promise.all(before.map((g) => actions.update(g.ids, { status: g.status }))).catch(failed);
          say('Moved back');
        })
      )
      .catch(failed);
    setMenu(null);
    endSelect();
  };
  const chapterIds = (read: boolean) => picked.flatMap((s) => s.chapters.filter((c) => (c.readAt !== null) !== read).map((c) => c.id));
  const canDownload = picked.some((s) => s.sourceId && !s.sourceId.startsWith('tachi:'));
  const downloadPicked = async (which: 'all' | 'unread') => {
    let n = 0;
    for (const id of ids) n += await actions.download(id, which).catch(() => 0);
    say(n ? `${n} chapters added to Downloads` : 'Nothing new to download for these');
    endSelect();
  };

  const addOptions: OptionItem[] = [
    { label: 'From Files', hint: 'CBZ, ZIP, PDF or pictures', onPress: () => actions.importFiles().catch(failed) },
    { label: 'A whole folder', hint: 'A series, or many: one chapter per sub-folder', onPress: () => actions.importFolder().catch(failed) },
    { label: 'A Tachimanga backup', hint: 'Your library, chapters read and categories (.tmb or .tachibk)', onPress: () => actions.importBackup().catch(failed) },
    { label: 'Browse sources', hint: 'MangaDex, your servers, extensions', onPress: onBrowse },
  ];
  const moreOptions: OptionItem[] = [
    { label: 'Add manga', hint: 'Files, a folder or a Tachimanga backup', onPress: () => setTimeout(() => setMenu('add'), 250) },
    ...(items.some((s) => s.sourceId) ? [{ label: 'Check for new chapters', hint: 'Every title from a source', onPress: () => actions.refreshAll().catch(failed) }] : []),
    { label: 'Browse sources', hint: 'MangaDex, your servers, extensions', onPress: onBrowse },
    ...(items.some((s) => s.sourceId) ? [{ label: 'Updates', hint: 'New chapters, newest first', onPress: () => onFeed('updates') }] : []),
    ...(items.some((s) => s.chapters.some((c) => c.readAt)) ? [{ label: 'History', hint: 'What you read, by day', onPress: () => onFeed('history') }] : []),
    { label: 'Reading stats and Wrapped', onPress: onDashboard },
    { label: `Downloads${downloads.queue.length ? ` · ${downloads.queue.length}` : ''}`, onPress: onDownloads },
    ...(items.some((s) => s.sourceId && !s.sourceId.startsWith('tachi:')) ? [{ label: 'Download everything', hint: 'Every chapter not on the phone yet', onPress: () => setTimeout(() => setMenu('download-all'), 250) }] : []),
    ...(items.some((s) => s.sourceId?.startsWith('tachi:') || /^server:[^:]+:library$/.test(s.sourceId ?? '')) ? [{ label: 'Find backup titles', hint: 'On your Suwayomi server, extensions or MangaDex; fixes linked ones too', onPress: () => actions.autoLink().catch(failed) }] : []),
    { label: 'Edit tabs', hint: 'Order, hide, rename, new category', onPress: () => setTimeout(() => setTabsOpen(true), 250) },
    { label: 'Select', hint: 'Pick titles to move, rate or mark read', onPress: () => setSelected(new Set()) },
    { label: 'Select all', hint: chip === 'all' ? 'Every title in the library' : `Every title in ${active.label.replace(/^# /, '')}`, onPress: () => setSelected(new Set(list.map((x) => x.id))) },
    { label: inDeleted ? 'Back to the library' : `Recently Deleted${deleted.length ? ` · ${deleted.length}` : ''}`, onPress: () => setInDeleted((x) => !x) },
    ...(privateCount > 0 && !showPrivate && onUnlockPrivate ? [{ label: `Show Private · ${privateCount}`, onPress: onUnlockPrivate }] : []),
  ];

  const header = (
    <View style={{ paddingTop: insets.top + 8 }}>
      {/* While picking: how many, and All / Invert for the tab you are on. */}
      {selected ? (
        <View>
          <View style={styles.titleRow}>
            <TouchableOpacity style={styles.round} onPress={endSelect} accessibilityLabel="Stop selecting">
              <Icon name="close" size={20} color={p.text} />
            </TouchableOpacity>
            <Text style={[styles.title, { fontSize: 28 }]} numberOfLines={1}>
              {ids.length} selected
            </Text>
            <View style={styles.pill}>
              <TouchableOpacity
                style={styles.pillText}
                onPress={() => {
                  tick();
                  setSelected((s) => {
                    const n = new Set(s ?? []);
                    for (const id of listIds) allShownPicked ? n.delete(id) : n.add(id);
                    return n;
                  });
                }}
                accessibilityLabel={allShownPicked ? 'Unselect this tab' : 'Select everything in this tab'}>
                <Text style={styles.pillLabel}>{allShownPicked ? 'Unselect all' : 'Select all'}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.hint}>
            {ids.length && ids.length !== shownPicked ? `${shownPicked} in this tab · ` : ''}Tap to pick · hold another cover to pick all between · switch tabs to add more · Select all picks this tab
          </Text>
        </View>
      ) : (
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1}>
          {inDeleted ? 'Deleted' : 'Manga'}
        </Text>
        {!inDeleted && (
          <TouchableOpacity style={[styles.round, filtering && styles.roundOn]} onPress={() => setViewOpen(true)} accessibilityLabel="Filter, sort and display">
            <Icon name="options" size={20} color={filtering ? p.accent : p.text} />
          </TouchableOpacity>
        )}
        <View style={styles.pill}>
          {(visible.length > 0 || inDeleted) && (
            <TouchableOpacity
              style={styles.pillBtn}
              onPress={() => {
                if (searchOpen) setQuery('');
                setSearchOpen((o) => !o);
              }}
              accessibilityLabel="Search">
              <Icon name={searchOpen ? 'close' : 'search'} size={20} color={p.text} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.pillBtn} onPress={() => setMenu('more')} accessibilityLabel="More">
            <Icon name="more" size={20} color={p.text} />
          </TouchableOpacity>
        </View>
      </View>
      )}
      {!inDeleted && !selected && (
        <View style={styles.modeRow}>
          <ModeSwitch mode="manga" onChange={onMode} />
        </View>
      )}
      {!!status && (
        <Animated.Text entering={FadeIn} exiting={FadeOut} style={styles.status} numberOfLines={2}>
          {busy ? '⏳ ' : ''}
          {status}
        </Animated.Text>
      )}
      {(downloads.current || downloads.queue.length > 0) && !inDeleted && (
        <TouchableOpacity style={styles.dlBar} onPress={onDownloads} accessibilityLabel="Downloads">
          <Icon name={downloads.paused ? 'pause' : 'import'} size={14} color={p.accent} />
          <Text style={styles.dlText} numberOfLines={1}>
            {downloads.paused
              ? `Downloads paused · ${downloads.queue.filter((q) => q.state === 'queued').length} waiting`
              : downloads.current
                ? `Downloading · page ${downloads.current.done} of ${downloads.current.total} · ${downloads.queue.filter((q) => q.state === 'queued').length} chapters left`
                : downloads.queue.some((q) => q.state === 'queued')
                  ? `Starting the next chapter…`
                  : downloads.queue.some((q) => q.state === 'failed')
                    ? `${downloads.queue.filter((q) => q.state === 'failed').length} downloads failed · tap to retry`
                    : `${downloads.queue.filter((q) => q.state === 'held').length} chapters on hold · tap to choose`}
          </Text>
          <Icon name="forward" size={12} color={p.textMuted} />
        </TouchableOpacity>
      )}
      {inDeleted && <Text style={styles.summary}>Series here are removed for good after the days you chose in Settings. Tap one to restore it.</Text>}

      {(searchOpen || !!query) && (
        <View style={styles.search}>
          <Icon name="search" size={15} color={p.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search titles, authors, notes, keywords"
            placeholderTextColor={p.textMuted}
            style={styles.searchInput}
            clearButtonMode="while-editing"
            returnKeyType="search"
            autoFocus
          />
        </View>
      )}

      {resume.length > 0 && !selected && (
        <View style={{ marginTop: 16 }}>
          <Text style={styles.section}>Continue reading</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SIDE, gap: 12 }}>
            {resume.map((s, n) => {
              const next = nextChapter(s);
              const pr = progressOf(s);
              return (
                <Animated.View key={s.id} entering={FadeInDown.delay(n * 60)}>
                  <TouchableOpacity style={styles.resume} onPress={() => onContinue(s)} onLongPress={() => onOpen(s)} accessibilityLabel={`Continue ${s.title}`}>
                    <View>
                      <MangaCover series={s} width={112} radius={12} />
                      <View style={styles.resumePlay}>
                        <Icon name="bookOpen" size={13} color="#fff" />
                      </View>
                    </View>
                    <View style={styles.resumeBar}>
                      <View style={[styles.resumeFill, { width: `${Math.max(3, Math.round(pr * 100))}%` }]} />
                    </View>
                    <Text style={styles.resumeTitle} numberOfLines={1}>
                      {s.title}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {next ? chapterLabel(next, true) : 'All read'}
                    </Text>
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Categories as one rounded bar of tabs (your statuses and keywords), like Tachimanga's. */}
      {!inDeleted && visible.length > 0 && (
        <View style={styles.tabsWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
            {chips.map((c) => {
              const on = c.key === chip;
              if (!on && c.key !== 'all' && (tabPrefs.hidden.includes(c.key) || (!counts[c.key] && !tabPrefs.extra.includes(c.key.slice(1))))) return null;
              return (
                <TouchableOpacity
                  key={c.key}
                  style={[styles.tab, on && styles.tabOn]}
                  onPress={() => {
                    tick();
                    setChip(c.key);
                  }}
                  onLongPress={() => {
                    tick();
                    setTabsOpen(true);
                  }}>
                  <Text style={[styles.tabText, on && styles.tabTextOn]}>{c.label}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.tabEdit} onPress={() => setTabsOpen(true)} accessibilityLabel="Edit tabs">
              <Icon name="edit" size={18} color={p.textSecondary} />
            </TouchableOpacity>
          </ScrollView>
        </View>
      )}
    </View>
  );

  const empty = (
    <Animated.View entering={enterUp(1)} style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name="book" size={30} color={p.accent} />
      </View>
      <Text style={styles.emptyTitle}>{inDeleted ? 'Nothing here' : query || chip !== 'all' ? 'Nothing matches' : 'Your manga and comics'}</Text>
      {!inDeleted && !query && chip === 'all' && (
        <>
          <Text style={styles.emptyText}>
            Add manga, manhwa and comics as CBZ or ZIP files, PDFs, or folders of pictures. Chapters of the same series go together, in order. Read right to left, left to right, page by page or as one long webtoon strip.
          </Text>
          <Text style={styles.emptyText}>Rate them, set a status, add keywords and notes, and pick up on the page you left.</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => setMenu('add')}>
            <Text style={styles.emptyBtnText}>Add manga</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.emptyGhost} onPress={onBrowse}>
            <Text style={styles.emptyGhostText}>Browse sources</Text>
          </TouchableOpacity>
        </>
      )}
    </Animated.View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        key={cols}
        data={list}
        numColumns={cols}
        keyExtractor={(s) => s.id}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        columnWrapperStyle={cols > 1 ? { gap: GAP, paddingHorizontal: SIDE } : undefined}
        contentContainerStyle={{ paddingBottom: tabSpace + 24, gap: view.layout === 'list' ? 0 : small ? 8 : 12 }}
        keyboardDismissMode="on-drag"
        renderItem={({ item: s }) => {
          const sel = selected?.has(s.id) ?? false;
          const unread = unreadCount(s);
          const onPhone = view.badges.downloaded ? downloadedCount(s) : 0;
          const press = () => {
            if (selected) return toggle(s.id);
            if (inDeleted) {
              setDeletedTarget(s);
              setMenu('deleted-one');
              return;
            }
            onOpen(s);
          };
          const longPress = () => {
            tick();
            if (inDeleted) return;
            if (!selected) {
              setSelected(new Set([s.id]));
              setAnchor(s.id);
            } else pickRange(s.id);
          };
          const label = `${s.title}${unread ? `, ${unread} unread` : ''}`;

          if (view.layout === 'list')
            return (
              <TouchableOpacity style={[styles.row, sel && styles.tileSel]} onPress={press} onLongPress={longPress} accessibilityLabel={label}>
                <MangaCover series={s} width={52} radius={8} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {s.title}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {[
                      `${s.chapters.length} ${s.chapters.length === 1 ? 'chapter' : 'chapters'}`,
                      onPhone ? `${onPhone} on the phone` : null,
                      view.badges.rating && s.rating > 0 ? `★ ${fmtRating(s.rating)}` : null,
                      s.status ? MANGA_STATUSES.find((x) => x.key === s.status)?.label : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                {selected ? (
                  <View style={[styles.check, { position: 'relative', top: 0, right: 0 }, sel && styles.checkOn]}>{sel && <Icon name="check" size={12} color="#fff" weight="bold" />}</View>
                ) : view.badges.unread && unread > 0 ? (
                  <View style={styles.rowBadge}>
                    <Text style={styles.unreadText}>{unread}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );

          return (
            <TouchableOpacity style={{ width: tileW }} onPress={press} onLongPress={longPress} accessibilityLabel={label}>
              <View>
                <MangaCover series={s} width={tileW} radius={small ? 10 : 14} bare />
                {/* The title on the cover, over a dark fade (Tachimanga's look). */}
                <Fade color="0,0,0" from={0} to={0.85} style={[styles.tileFade, small && { borderBottomLeftRadius: 10, borderBottomRightRadius: 10 }]} />
                <View style={[styles.tileCaption, small && { left: 7, right: 7, bottom: 6 }]} pointerEvents="none">
                  <Text style={[styles.tileTitle, small && { fontSize: 12, lineHeight: 15 }, cols === 1 && { fontSize: 22, lineHeight: 27 }]} numberOfLines={2}>
                    {s.title}
                  </Text>
                </View>
                <View style={styles.badgeRow} pointerEvents="none">
                  {view.badges.unread && unread > 0 ? (
                    <View style={styles.badgeUnread}>
                      <Text style={styles.unreadText}>{unread}</Text>
                    </View>
                  ) : view.badges.unread && s.status === 'completed' ? (
                    <View style={styles.badgeUnread}>
                      <Icon name="check" size={11} color="#06290f" weight="bold" />
                    </View>
                  ) : null}
                  {onPhone > 0 && (
                    <View style={styles.badgeDl}>
                      <Text style={styles.dlText2}>{onPhone}</Text>
                    </View>
                  )}
                </View>
                {view.badges.rating && s.rating > 0 && !selected && !small && (
                  <View style={styles.ratingBadge}>
                    <Text style={styles.ratingBadgeText}>★ {fmtRating(s.rating)}</Text>
                  </View>
                )}
                {sel && <View style={[styles.selRing, { borderRadius: small ? 10 : 14 }]} pointerEvents="none" />}
                {selected && (
                  <View style={[styles.check, sel && styles.checkOn]}>{sel && <Icon name="check" size={12} color="#fff" weight="bold" />}</View>
                )}
                {s.isPrivate && (
                  <View style={styles.lockBadge}>
                    <Icon name="lock" size={10} color="#fff" />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {selected && (
        <Animated.View entering={FadeInDown} exiting={FadeOut} style={[styles.selectBar, { bottom: tabSpace + 10 }]}>
          {(
            [
              { key: 'move', icon: 'lists', label: 'Move to', onPress: () => setMenu('move'), main: true },
              { key: 'rate', icon: 'star', label: 'Rate', onPress: () => setRating(true) },
              { key: 'read', icon: 'checkCircle', label: 'Read', onPress: () => setMenu('read') },
              ...(canDownload ? [{ key: 'dl', icon: 'import', label: 'Download', onPress: () => setMenu('dl') }] : []),
              { key: 'more', icon: 'more', label: 'More', onPress: () => setMenu('pick-more') },
            ] as { key: string; icon: 'lists'; label: string; onPress: () => void; main?: boolean }[]
          ).map((b) => (
            <TouchableOpacity
              key={b.key}
              disabled={!ids.length && b.key !== 'more'}
              onPress={() => {
                tick();
                b.onPress();
              }}
              style={[styles.barBtn, b.main && styles.barMain, !ids.length && b.key !== 'more' && { opacity: 0.4 }]}
              accessibilityLabel={b.label}>
              <Icon name={b.icon} size={20} color={b.main ? '#fff' : p.text} />
              <Text style={[styles.barLabel, b.main && { color: '#fff' }]} numberOfLines={1}>
                {b.label}
              </Text>
            </TouchableOpacity>
          ))}
        </Animated.View>
      )}

      {note && !selected && (
        <Animated.View entering={FadeInDown} exiting={FadeOut} style={[styles.note, { bottom: tabSpace + 10 }]}>
          <Text style={styles.noteText} numberOfLines={2}>
            {note.text}
          </Text>
          {note.undo && (
            <TouchableOpacity
              onPress={() => {
                const u = note.undo;
                setNote(null);
                u?.();
              }}
              hitSlop={8}>
              <Text style={styles.noteUndo}>Undo</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      )}

      {tabsOpen && (
        <TabsSheet
          tabs={chips.map((c) => ({ key: c.key, label: c.label, count: counts[c.key] ?? 0 }))}
          prefs={tabPrefs}
          onPrefs={changeTabs}
          onRename={(key, name) => {
            if (!key.startsWith('#')) return changeTabs({ ...tabPrefs, labels: { ...tabPrefs.labels, [key]: name } });
            const to = `#${name.replace(/^#/, '')}`;
            changeTabs(renameTabKey(tabPrefs, key, to));
            if (chip === key) setChip(to);
            actions.renameTag(key.slice(1), name).catch(failed);
          }}
          onDelete={(key) => {
            changeTabs({ ...tabPrefs, order: tabPrefs.order.filter((k) => k !== key), hidden: tabPrefs.hidden.filter((k) => k !== key), extra: tabPrefs.extra.filter((t) => `#${t}` !== key) });
            if (chip === key) setChip('all');
            actions.deleteTag(key.slice(1)).catch(failed);
          }}
          onAdd={(name) => {
            const t = name.replace(/^#/, '').trim();
            if (t && !categories.includes(t)) changeTabs({ ...tabPrefs, extra: [...tabPrefs.extra, t] });
          }}
          onClose={() => setTabsOpen(false)}
        />
      )}
      {viewOpen && <LibrarySheet view={view} sources={sourceNames} onChange={changeView} onClose={() => setViewOpen(false)} />}
      {menu === 'add' && <OptionsSheet title="Add to Manga" options={addOptions} onClose={() => setMenu(null)} />}
      {menu === 'more' && <OptionsSheet title="Manga" options={moreOptions} onClose={() => setMenu((m) => (m === 'more' ? null : m))} />}
      {menu === 'download-all' && (
        <OptionsSheet
          title="Download everything?"
          options={[
            {
              label: `Download ${items.filter((s) => s.sourceId && !s.sourceId.startsWith('tachi:')).reduce((a, s) => a + s.chapters.filter((c) => !c.folder && c.sourceKey && !c.sourceUrl).length, 0)} chapters`,
              hint: 'About 5 to 10 MB each (half with Smaller pages). Runs while the app is open.',
              onPress: () => actions.downloadLibrary().then(() => onDownloads()),
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'move' && (
        <MoveSheet
          picked={picked}
          tags={categories}
          onStatus={moveTo}
          onTag={(t, add) => (add ? actions.addTag(ids, t) : actions.removeTag(ids, t)).catch(failed)}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'read' && (
        <OptionsSheet
          title={titles(ids.length)}
          options={[
            {
              label: 'Mark every chapter read',
              hint: `${chapterIds(false).length} chapters`,
              onPress: () => {
                const ch = chapterIds(false);
                actions.setRead(ch, true).then(() => say(`${ch.length} chapters marked read`, () => actions.setRead(ch, false).catch(failed))).catch(failed);
                endSelect();
              },
            },
            {
              label: 'Mark every chapter unread',
              hint: `${chapterIds(true).length} chapters`,
              onPress: () => {
                const ch = chapterIds(true);
                actions.setRead(ch, false).then(() => say(`${ch.length} chapters marked unread`, () => actions.setRead(ch, true).catch(failed))).catch(failed);
                endSelect();
              },
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'dl' && (
        <OptionsSheet
          title={`Download for ${titles(ids.length)}`}
          options={[
            { label: 'Unread chapters', onPress: () => downloadPicked('unread').catch(failed) },
            { label: 'Every chapter', onPress: () => downloadPicked('all').catch(failed) },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'pick-more' && (
        <OptionsSheet
          title={titles(ids.length)}
          options={[
            {
              label: 'Invert the selection',
              hint: 'In this tab',
              onPress: () => setSelected((s) => invertSelection(listIds, s ?? [])),
            },
            {
              label: 'Move to Private',
              hint: 'Hidden until Face ID',
              onPress: () => {
                actions.update(ids, { isPrivate: true }).catch(failed);
                endSelect();
              },
            },
            {
              label: `Delete ${titles(ids.length)}`,
              danger: true,
              hint: 'Goes to Recently Deleted',
              onPress: () =>
                confirmAction(
                  `Delete ${titles(ids.length)}?`,
                  'They go to Recently Deleted with their read marks; you can bring them back from there.',
                  () => {
                    actions.trash(ids).catch(failed);
                    endSelect();
                  },
                  { label: 'Delete', destructive: true }
                ),
            },
          ].filter((o, i) => i === 0 || ids.length > 0)}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'deleted-one' && deletedTarget && (
        <OptionsSheet
          title={deletedTarget.title}
          options={[
            { label: 'Restore', onPress: () => actions.restore([deletedTarget.id]) },
            { label: 'Delete for good', danger: true, hint: 'Removes its pages', onPress: () => actions.purge([deletedTarget.id]) },
          ]}
          onClose={() => {
            setMenu(null);
            setDeletedTarget(null);
          }}
        />
      )}
      {rating && (
        <RatingPicker
          title={`Rate ${ids.length}`}
          value={null}
          onPick={(r) => {
            actions.update(ids, { rating: r ?? 0 }).then(() => say(r ? `Rated ${titles(ids.length)} ${fmtRating(r)}` : 'Rating cleared')).catch(failed);
            endSelect();
          }}
          onClose={() => setRating(false)}
        />
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SIDE + 4, paddingTop: 6 },
    title: { flex: 1, color: p.text, fontSize: 36, fontWeight: '900', letterSpacing: -0.8 },
    round: { width: 48, height: 48, borderRadius: 24, backgroundColor: p.card, borderWidth: 1, borderColor: p.border, alignItems: 'center', justifyContent: 'center' },
    roundOn: { backgroundColor: p.accentSoft, borderColor: p.accent },
    pill: { flexDirection: 'row', height: 48, borderRadius: 24, backgroundColor: p.card, borderWidth: 1, borderColor: p.border, alignItems: 'center', paddingHorizontal: 6 },
    pillBtn: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
    modeRow: { paddingHorizontal: SIDE, paddingTop: 10 },
    status: { color: p.textSecondary, fontSize: 13, paddingHorizontal: SIDE, paddingTop: 10 },
    summary: { color: p.textSecondary, fontSize: 13, paddingHorizontal: SIDE, paddingTop: 10 },
    dlBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: SIDE, marginTop: 10, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
    dlText: { flex: 1, color: p.text, fontSize: 13, fontWeight: '600' },
    search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: SIDE, marginTop: 12, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 12, height: 40 },
    searchInput: { flex: 1, color: p.text, fontSize: 16 },
    section: { color: p.text, fontSize: 20, fontWeight: '800', paddingHorizontal: SIDE, marginBottom: 10 },
    resume: { width: 112, gap: 5 },
    resumePlay: { position: 'absolute', right: 7, bottom: 7, width: 26, height: 26, borderRadius: 13, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    resumeBar: { height: 4, borderRadius: 2, backgroundColor: p.card, overflow: 'hidden', marginTop: 3 },
    resumeFill: { height: 4, borderRadius: 2, backgroundColor: p.accent },
    resumeTitle: { color: p.text, fontSize: 14, fontWeight: '700' },
    meta: { color: p.textSecondary, fontSize: 12 },
    tabsWrap: { marginHorizontal: SIDE, marginTop: 14, marginBottom: 12, backgroundColor: p.card, borderRadius: 999, borderWidth: 1, borderColor: p.border, overflow: 'hidden' },
    tabs: { padding: 5, gap: 2 },
    tab: { borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
    tabOn: { backgroundColor: p.elevated },
    tabText: { color: p.textSecondary, fontSize: 17, fontWeight: '700' },
    tabTextOn: { color: p.text },
    tabEdit: { width: 44, alignItems: 'center', justifyContent: 'center' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: SIDE + 4, paddingVertical: 8 },
    rowTitle: { color: p.text, fontSize: 16, fontWeight: '800' },
    rowMeta: { color: p.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 2 },
    rowBadge: { minWidth: 26, height: 24, borderRadius: 8, paddingHorizontal: 7, backgroundColor: '#8BD88E', alignItems: 'center', justifyContent: 'center' },
    dlBadge: { position: 'absolute', top: 8, minWidth: 26, height: 26, borderRadius: 9, paddingHorizontal: 7, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    dlText2: { color: '#fff', fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
    tileSel: { backgroundColor: 'rgba(10,132,255,0.15)' },
    tileFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '42%', borderBottomLeftRadius: 14, borderBottomRightRadius: 14 },
    tileCaption: { position: 'absolute', left: 12, right: 12, bottom: 11 },
    tileTitle: { color: '#fff', fontSize: 16, fontWeight: '800', lineHeight: 20, letterSpacing: -0.2, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 4 },
    ratingBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
    ratingBadgeText: { color: '#F5A623', fontSize: 12, fontWeight: '800' },
    badgeRow: { position: 'absolute', top: 8, left: 8, flexDirection: 'row', borderRadius: 9, overflow: 'hidden' },
    badgeUnread: { minWidth: 26, height: 26, paddingHorizontal: 7, backgroundColor: '#8BD88E', alignItems: 'center', justifyContent: 'center' },
    badgeDl: { minWidth: 26, height: 26, paddingHorizontal: 7, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    unreadBadge: { position: 'absolute', top: 8, left: 8, minWidth: 26, height: 26, borderRadius: 9, paddingHorizontal: 7, backgroundColor: '#8BD88E', alignItems: 'center', justifyContent: 'center' },
    unreadText: { color: '#06290f', fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
    lockBadge: { position: 'absolute', top: 40, right: 8, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
    check: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
    checkOn: { backgroundColor: p.accent, borderColor: p.accent },
    selectBar: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'stretch', gap: 6, backgroundColor: p.elevated, borderRadius: 22, padding: 6, borderWidth: 1, borderColor: p.border },
    barBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 16, paddingVertical: 8 },
    barMain: { flex: 1.4, backgroundColor: p.accent },
    barLabel: { color: p.text, fontSize: 12, fontWeight: '700' },
    selRing: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderWidth: 3, borderColor: p.accent, backgroundColor: 'rgba(10,132,255,0.18)' },
    hint: { color: p.textSecondary, fontSize: 13, paddingHorizontal: SIDE + 4, paddingTop: 8 },
    pillText: { paddingHorizontal: 12, height: 46, alignItems: 'center', justifyContent: 'center' },
    pillLabel: { color: p.accent, fontSize: 16, fontWeight: '800' },
    note: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.elevated, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14, borderWidth: 1, borderColor: p.border },
    noteText: { flex: 1, color: p.text, fontSize: 15, fontWeight: '600' },
    noteUndo: { color: p.accent, fontSize: 16, fontWeight: '800' },
    empty: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 40, gap: 12 },
    emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { color: p.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
    emptyText: { color: p.textSecondary, fontSize: 15, lineHeight: 21, textAlign: 'center' },
    emptyBtn: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12, marginTop: 6 },
    emptyBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    emptyGhost: { paddingHorizontal: 22, paddingVertical: 10 },
    emptyGhostText: { color: p.link, fontSize: 16, fontWeight: '700' },
  });
