/**
 * The Manga section's library: manga, manhwa and comics as a wall of covers.
 * Continue reading at the top, then filters (status, unread, favourites,
 * kind, your keywords), search and sorting. Each cover shows your rating and
 * how many chapters are unread. Hold a cover to select several: rate, set a
 * status, add a keyword, move to Private or delete (Recently Deleted keeps
 * them for the days you chose). Presentational only (see types.ts).
 */

import { useMemo, useState } from 'react';
import { FlatList, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions, Alert } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MANGA_SORTS,
  MANGA_STATUSES,
  chapterLabel,
  continueReading,
  fmtRating,
  matchesManga,
  nextChapter,
  progressOf,
  sortManga,
  unreadCount,
  type MangaFilter,
  type MangaSort,
  type MangaStatus,
} from '../../manga/mangaLogic';
import { useTabBarSpace } from '../chrome';
import { tick } from '../haptics';
import { confirmAction } from '../confirm';
import Icon from '../Icon';
import IconButton from '../IconButton';
import { enterUp } from '../motion';
import { ModeSwitch, type VideosMode } from '../overviewParts';
import { OptionsSheet, PromptSheet, type OptionItem } from '../prompts';
import RatingPicker from '../RatingPicker';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import MangaCover from './MangaCover';
import type { DownloadState, MangaActions, MangaUiSeries } from './mangaTypes';

const SIDE = 16;
const GAP = 12;

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
  const cols = width >= 700 ? 5 : 3;
  const tileW = Math.floor((width - SIDE * 2 - GAP * (cols - 1)) / cols);

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState('all');
  const [sort, setSort] = useState<MangaSort>('recentRead');
  const [inDeleted, setInDeleted] = useState(initialDeleted);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [menu, setMenu] = useState<null | 'add' | 'more' | 'sort' | 'status' | 'deleted-one' | 'download-all'>(null);
  const [rating, setRating] = useState(false);
  const [tagPrompt, setTagPrompt] = useState(false);
  const [deletedTarget, setDeletedTarget] = useState<MangaUiSeries | null>(null);

  const visible = useMemo(() => items.filter((s) => showPrivate || !s.isPrivate), [items, showPrivate]);
  const privateCount = items.length - visible.length;
  const tags = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of visible) for (const t of s.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [visible]);
  const chips: Chip[] = useMemo(
    () => [
      { key: 'all', label: 'All', filter: {} },
      ...MANGA_STATUSES.map((s) => ({ key: s.key, label: s.label, filter: { status: s.key } as MangaFilter })),
      { key: 'unread', label: 'Unread', filter: { unread: true } },
      { key: 'fav', label: 'Favourites', filter: { favourites: true } },
      { key: 'manhwa', label: 'Manhwa', filter: { kind: 'manhwa' } },
      { key: 'comic', label: 'Comics', filter: { kind: 'comic' } },
      ...tags.slice(0, 20).map((t) => ({ key: `#${t}`, label: `# ${t}`, filter: { tag: t } })),
    ],
    [tags]
  );
  const active = chips.find((c) => c.key === chip) ?? chips[0];
  const source = inDeleted ? deleted.filter((s) => showPrivate || !s.isPrivate) : visible;
  const list = useMemo(() => sortManga(source.filter((s) => matchesManga(s, { ...active.filter, query })), sort), [source, active, query, sort]);
  const counts = useMemo(() => Object.fromEntries(chips.map((c) => [c.key, visible.filter((s) => matchesManga(s, c.filter)).length])), [chips, visible]);
  const resume = useMemo(() => (query || chip !== 'all' || inDeleted ? [] : continueReading(visible)), [visible, query, chip, inDeleted]);
  const chapterTotal = visible.reduce((a, s) => a + s.chapters.length, 0);
  const unreadTotal = visible.reduce((a, s) => a + unreadCount(s), 0);

  const ids = selected ? [...selected] : [];
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s ?? []);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const addOptions: OptionItem[] = [
    { label: 'From Files', hint: 'CBZ, ZIP, PDF or pictures', onPress: () => actions.importFiles().catch(failed) },
    { label: 'A whole folder', hint: 'A series, or many: one chapter per sub-folder', onPress: () => actions.importFolder().catch(failed) },
    { label: 'A Tachimanga backup', hint: 'Your library, chapters read and categories (.tmb or .tachibk)', onPress: () => actions.importBackup().catch(failed) },
    { label: 'Browse sources', hint: 'MangaDex, your servers, extensions', onPress: onBrowse },
  ];
  const moreOptions: OptionItem[] = [
    { label: 'Sort', hint: MANGA_SORTS.find((s) => s.key === sort)?.label, onPress: () => setTimeout(() => setMenu('sort'), 250) },
    ...(items.some((s) => s.sourceId) ? [{ label: 'Check for new chapters', hint: 'Every title from a source', onPress: () => actions.refreshAll().catch(failed) }] : []),
    { label: 'Browse sources', hint: 'MangaDex, your servers, extensions', onPress: onBrowse },
    ...(items.some((s) => s.sourceId) ? [{ label: 'Updates', hint: 'New chapters, newest first', onPress: () => onFeed('updates') }] : []),
    ...(items.some((s) => s.chapters.some((c) => c.readAt)) ? [{ label: 'History', hint: 'What you read, by day', onPress: () => onFeed('history') }] : []),
    { label: 'Reading stats and Wrapped', onPress: onDashboard },
    { label: `Downloads${downloads.queue.length ? ` · ${downloads.queue.length}` : ''}`, onPress: onDownloads },
    ...(items.some((s) => s.sourceId && !s.sourceId.startsWith('tachi:')) ? [{ label: 'Download everything', hint: 'Every chapter not on the phone yet', onPress: () => setTimeout(() => setMenu('download-all'), 250) }] : []),
    ...(items.some((s) => s.sourceId?.startsWith('tachi:')) ? [{ label: 'Link backup titles', hint: 'Through your Suwayomi server', onPress: () => actions.autoLink().catch(failed) }] : []),
    { label: 'Select', onPress: () => setSelected(new Set()) },
    { label: inDeleted ? 'Back to the library' : `Recently Deleted${deleted.length ? ` · ${deleted.length}` : ''}`, onPress: () => setInDeleted((x) => !x) },
    ...(privateCount > 0 && !showPrivate && onUnlockPrivate ? [{ label: `Show Private · ${privateCount}`, onPress: onUnlockPrivate }] : []),
  ];

  const header = (
    <View style={{ paddingTop: insets.top + 8 }}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{inDeleted ? 'Recently Deleted' : 'Manga'}</Text>
        <View style={styles.buttons}>
          {!inDeleted && <IconButton icon="stats" label="Reading stats" onPress={onDashboard} />}
          {!inDeleted && <IconButton icon="globe" label="Browse sources" onPress={onBrowse} />}
          {!inDeleted && <IconButton icon="plus" label="Add manga or comics" onPress={() => setMenu('add')} />}
          <IconButton icon="more" label="More" onPress={() => setMenu('more')} />
        </View>
      </View>
      {!inDeleted && (
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
              ? `Downloads paused · ${downloads.queue.length} waiting`
              : downloads.current
                ? `Downloading · page ${downloads.current.done} of ${downloads.current.total} · ${downloads.queue.filter((q) => q.state === 'queued').length} chapters left`
                : `${downloads.queue.filter((q) => q.state === 'failed').length} downloads failed · tap to retry`}
          </Text>
          <Icon name="forward" size={12} color={p.textMuted} />
        </TouchableOpacity>
      )}
      {!inDeleted && visible.length > 0 && (
        <Text style={styles.summary}>
          {visible.length} {visible.length === 1 ? 'series' : 'series'} · {chapterTotal} {chapterTotal === 1 ? 'chapter' : 'chapters'}
          {unreadTotal ? ` · ${unreadTotal} unread` : ''}
        </Text>
      )}
      {inDeleted && <Text style={styles.summary}>Series here are removed for good after the days you chose in Settings. Tap one to restore it.</Text>}

      {(visible.length > 0 || inDeleted) && (
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
          />
        </View>
      )}

      {resume.length > 0 && (
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

      {!inDeleted && visible.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {chips.map((c) => {
            const on = c.key === chip;
            if (c.key !== 'all' && !counts[c.key] && !on) return null;
            return (
              <TouchableOpacity
                key={c.key}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => {
                  tick();
                  setChip(c.key);
                }}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
                <Text style={[styles.chipCount, on && styles.chipTextOn]}>{counts[c.key] ?? 0}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
      {list.length > 0 && (
        <TouchableOpacity style={styles.sortRow} onPress={() => setMenu('sort')}>
          <Text style={styles.sortText}>{MANGA_SORTS.find((s) => s.key === sort)?.label}</Text>
          <Icon name="down" size={11} color={p.textSecondary} />
        </TouchableOpacity>
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
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: SIDE }}
        contentContainerStyle={{ paddingBottom: tabSpace + 24, gap: 16 }}
        keyboardDismissMode="on-drag"
        renderItem={({ item: s }) => {
          const sel = selected?.has(s.id) ?? false;
          const unread = unreadCount(s);
          return (
            <TouchableOpacity
              style={{ width: tileW }}
              onPress={() => {
                if (selected) return toggle(s.id);
                if (inDeleted) {
                  setDeletedTarget(s);
                  setMenu('deleted-one');
                  return;
                }
                onOpen(s);
              }}
              onLongPress={() => {
                tick();
                if (inDeleted) return;
                if (!selected) setSelected(new Set([s.id]));
                else toggle(s.id);
              }}
              accessibilityLabel={`${s.title}${unread ? `, ${unread} unread` : ''}`}>
              <View>
                <MangaCover series={s} width={tileW} style={sel ? styles.tileSel : undefined} />
                {s.rating > 0 && (
                  <View style={styles.ratingBadge}>
                    <Text style={styles.ratingBadgeText}>★ {fmtRating(s.rating)}</Text>
                  </View>
                )}
                {unread > 0 && (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadText}>{unread}</Text>
                  </View>
                )}
                {s.status === 'completed' && unread === 0 && (
                  <View style={styles.unreadBadge}>
                    <Icon name="check" size={11} color="#fff" weight="bold" />
                  </View>
                )}
                {selected && (
                  <View style={[styles.check, sel && styles.checkOn]}>{sel && <Icon name="check" size={12} color="#fff" weight="bold" />}</View>
                )}
                {s.isPrivate && (
                  <View style={styles.lockBadge}>
                    <Icon name="lock" size={10} color="#fff" />
                  </View>
                )}
              </View>
              <Text style={styles.tileTitle} numberOfLines={2}>
                {s.title}
              </Text>
              <Text style={styles.tileMeta} numberOfLines={1}>
                {s.status ? MANGA_STATUSES.find((x) => x.key === s.status)?.label : `${s.chapters.length} ${s.chapters.length === 1 ? 'chapter' : 'chapters'}`}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      {selected && (
        <Animated.View entering={FadeInDown} exiting={FadeOut} style={[styles.selectBar, { bottom: tabSpace + 10 }]}>
          <Text style={styles.selectCount}>{ids.length} selected</Text>
          <TouchableOpacity disabled={!ids.length} onPress={() => setRating(true)} style={styles.selectBtn}>
            <Text style={styles.selectBtnText}>Rate</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={!ids.length} onPress={() => setMenu('status')} style={styles.selectBtn}>
            <Text style={styles.selectBtnText}>Status</Text>
          </TouchableOpacity>
          <TouchableOpacity disabled={!ids.length} onPress={() => setTagPrompt(true)} style={styles.selectBtn}>
            <Text style={styles.selectBtnText}>#</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={!ids.length}
            onPress={() => {
              actions.update(ids, { isPrivate: true }).catch(() => undefined);
              setSelected(null);
            }}
            style={styles.selectBtn}>
            <Icon name="lock" size={14} color={p.text} />
          </TouchableOpacity>
          <TouchableOpacity
            disabled={!ids.length}
            onPress={() =>
              confirmAction(
                `Delete ${ids.length} ${ids.length === 1 ? 'title' : 'titles'}?`,
                'They go to Recently Deleted with their read marks; you can bring them back from there.',
                () => {
                  actions.trash(ids).catch(() => undefined);
                  setSelected(null);
                },
                { label: 'Delete', destructive: true }
              )
            }
            style={styles.selectBtn}>
            <Icon name="trash" size={14} color={p.danger} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSelected(null)} style={styles.selectBtn}>
            <Text style={styles.selectBtnText}>Done</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

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
      {menu === 'sort' && (
        <OptionsSheet
          title="Sort by"
          options={MANGA_SORTS.map((s) => ({ label: s.label, hint: s.key === sort ? '✓' : undefined, onPress: () => setSort(s.key) }))}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'status' && (
        <OptionsSheet
          title={`Status of ${ids.length}`}
          options={[
            ...MANGA_STATUSES.map((s) => ({ label: s.label, onPress: () => actions.update(ids, { status: s.key as MangaStatus }).then(() => setSelected(null)) })),
            { label: 'No status', onPress: () => actions.update(ids, { status: null }).then(() => setSelected(null)) },
          ]}
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
            actions.update(ids, { rating: r ?? 0 }).catch(() => undefined);
            setSelected(null);
          }}
          onClose={() => setRating(false)}
        />
      )}
      {tagPrompt && (
        <PromptSheet
          title="Add a keyword"
          placeholder="e.g. action, isekai, favourite"
          onSubmit={(t) => {
            if (t.trim()) actions.addTag(ids, t.trim()).catch(() => undefined);
            setSelected(null);
          }}
          onClose={() => setTagPrompt(false)}
        />
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    titleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, paddingTop: 6 },
    title: { flex: 1, color: p.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
    buttons: { flexDirection: 'row', gap: 8 },
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
    chips: { gap: 8, paddingHorizontal: SIDE, paddingTop: 16 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    chipOn: { backgroundColor: p.text },
    chipText: { color: p.textSoft, fontSize: 14, fontWeight: '700' },
    chipCount: { color: p.textSecondary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
    chipTextOn: { color: p.bg },
    sortRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: SIDE, paddingTop: 14, paddingBottom: 8, alignSelf: 'flex-start' },
    sortText: { color: p.textSecondary, fontSize: 13, fontWeight: '700' },
    tileSel: { opacity: 0.6 },
    tileTitle: { color: p.text, fontSize: 13, fontWeight: '700', marginTop: 6, lineHeight: 17 },
    tileMeta: { color: p.textSecondary, fontSize: 12, marginTop: 1 },
    ratingBadge: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2 },
    ratingBadgeText: { color: '#F5A623', fontSize: 11, fontWeight: '800' },
    unreadBadge: { position: 'absolute', top: 6, right: 6, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    unreadText: { color: '#fff', fontSize: 11, fontWeight: '900', fontVariant: ['tabular-nums'] },
    lockBadge: { position: 'absolute', bottom: 6, left: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
    check: { position: 'absolute', bottom: 6, right: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'center', justifyContent: 'center' },
    checkOn: { backgroundColor: p.accent, borderColor: p.accent },
    selectBar: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.elevated, borderRadius: 18, padding: 8, borderWidth: 1, borderColor: p.border },
    selectCount: { flex: 1, color: p.text, fontSize: 14, fontWeight: '700', paddingLeft: 6 },
    selectBtn: { backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 10, height: 34, alignItems: 'center', justifyContent: 'center' },
    selectBtnText: { color: p.text, fontSize: 14, fontWeight: '700' },
    empty: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 40, gap: 12 },
    emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { color: p.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
    emptyText: { color: p.textSecondary, fontSize: 15, lineHeight: 21, textAlign: 'center' },
    emptyBtn: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 12, marginTop: 6 },
    emptyBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    emptyGhost: { paddingHorizontal: 22, paddingVertical: 10 },
    emptyGhostText: { color: p.link, fontSize: 16, fontWeight: '700' },
  });
