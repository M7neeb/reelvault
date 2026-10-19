/**
 * The Audio section's library: your own audio files, books made of several
 * files, and EPUB 3 books with read-along. Continue listening at the top,
 * then filters (listening, not started, finished, favourites, read-along
 * books, your keywords), search, sorting, and a list with covers, progress
 * and ratings. Hold an item to select several: rate, set a status, add a
 * keyword, move to Private, or delete (Recently Deleted keeps them for the
 * days you chose). Presentational only (see the note at the top of types.ts).
 */

import { useMemo, useState } from 'react';
import { FlatList, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AUDIO_SORTS, AUDIO_STATUSES, continueListening, displayTitle, fmtLength, fmtRating, matchesAudio, progressOf, sortAudio, totalMs, type AudioFilter, type AudioSort, type AudioStatus } from '../../audio/audioLogic';
import { useTabBarSpace } from '../chrome';
import { tick } from '../haptics';
import Icon from '../Icon';
import IconButton from '../IconButton';
import { enterUp } from '../motion';
import { ModeSwitch, type VideosMode } from '../overviewParts';
import { OptionsSheet, PromptSheet, type OptionItem } from '../prompts';
import RatingPicker from '../RatingPicker';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import AudioCover from './AudioCover';
import type { AudioActions, AudioUiItem } from './audioTypes';

const SIDE = 16;

type Chip = { key: string; label: string; filter: AudioFilter };

export default function AudioScreen({
  items,
  deleted,
  status,
  busy,
  currentId,
  playing,
  showPrivate,
  onUnlockPrivate,
  actions,
  onOpen,
  onInfo,
  onDashboard,
  onMode,
  onWifi,
  bottomSpace = 0,
  initialDeleted = false,
}: {
  items: AudioUiItem[];
  deleted: AudioUiItem[];
  status: string;
  busy: boolean;
  currentId: string | null;
  playing: boolean;
  /** Private items are shown (unlocked). */
  showPrivate: boolean;
  onUnlockPrivate?: () => void;
  actions: AudioActions;
  onOpen: (item: AudioUiItem) => void;
  onInfo: (item: AudioUiItem) => void;
  onDashboard: () => void;
  onMode: (m: VideosMode) => void;
  onWifi?: () => void;
  /** Room kept at the bottom for the mini player. */
  bottomSpace?: number;
  initialDeleted?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const tabSpace = useTabBarSpace();
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState('all');
  const [sort, setSort] = useState<AudioSort>('recent');
  const [inDeleted, setInDeleted] = useState(initialDeleted);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [menu, setMenu] = useState<null | 'add' | 'more' | 'sort' | 'status' | 'deleted-one'>(null);
  const [rating, setRating] = useState(false);
  const [tagPrompt, setTagPrompt] = useState(false);
  const [deletedTarget, setDeletedTarget] = useState<AudioUiItem | null>(null);

  const visible = useMemo(() => items.filter((i) => showPrivate || !i.isPrivate), [items, showPrivate]);
  const privateCount = items.length - visible.length;
  const tags = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of visible) for (const t of i.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  }, [visible]);
  const chips: Chip[] = useMemo(
    () => [
      { key: 'all', label: 'All', filter: {} },
      { key: 'inProgress', label: 'Listening', filter: { status: 'inProgress' } },
      { key: 'notStarted', label: 'Not started', filter: { status: 'notStarted' } },
      { key: 'finished', label: 'Finished', filter: { status: 'finished' } },
      { key: 'fav', label: 'Favourites', filter: { favourites: true } },
      { key: 'books', label: 'Read-along', filter: { kind: 'book' } },
      { key: 'planned', label: 'To listen', filter: { status: 'planned' } },
      ...tags.slice(0, 20).map((t) => ({ key: `#${t}`, label: `# ${t}`, filter: { tag: t } })),
    ],
    [tags]
  );
  const active = chips.find((c) => c.key === chip) ?? chips[0];
  const source = inDeleted ? deleted.filter((i) => showPrivate || !i.isPrivate) : visible;
  const list = useMemo(() => sortAudio(source.filter((i) => matchesAudio(i, { ...active.filter, query })), sort), [source, active, query, sort]);
  const counts = useMemo(() => Object.fromEntries(chips.map((c) => [c.key, visible.filter((i) => matchesAudio(i, c.filter)).length])), [chips, visible]);
  const resume = useMemo(() => (query || chip !== 'all' || inDeleted ? [] : continueListening(visible)), [visible, query, chip, inDeleted]);
  const libraryMs = visible.reduce((a, i) => a + totalMs(i), 0);

  const ids = selected ? [...selected] : [];
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s ?? []);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const addOptions: OptionItem[] = [
    { label: 'From Files', hint: 'Audio files and EPUB books', onPress: () => actions.importFiles().catch(() => undefined) },
    { label: 'A whole folder', hint: 'Everything in it, sub-folders too', onPress: () => actions.importFolder().catch(() => undefined) },
    ...(onWifi ? [{ label: 'From your computer', hint: 'Wi-Fi transfer', onPress: onWifi }] : []),
  ];
  const moreOptions: OptionItem[] = [
    { label: 'Sort', hint: AUDIO_SORTS.find((s) => s.key === sort)?.label, onPress: () => setTimeout(() => setMenu('sort'), 250) },
    { label: 'Select', onPress: () => setSelected(new Set()) },
    { label: inDeleted ? 'Back to the library' : `Recently Deleted${deleted.length ? ` · ${deleted.length}` : ''}`, onPress: () => setInDeleted((x) => !x) },
    ...(privateCount > 0 && !showPrivate && onUnlockPrivate ? [{ label: `Show Private · ${privateCount}`, onPress: onUnlockPrivate }] : []),
    { label: 'Stats and Wrapped', onPress: onDashboard },
  ];

  const header = (
    <View style={{ paddingTop: insets.top + 8 }}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{inDeleted ? 'Recently Deleted' : 'Audio'}</Text>
        <View style={styles.buttons}>
          {!inDeleted && <IconButton icon="plus" label="Add audio or books" onPress={() => setMenu('add')} />}
          {!inDeleted && <IconButton icon="stats" label="Stats and Wrapped" onPress={onDashboard} />}
          <IconButton icon="more" label="More" onPress={() => setMenu('more')} />
        </View>
      </View>
      {!inDeleted && (
        <View style={styles.modeRow}>
          <ModeSwitch mode="audio" onChange={onMode} />
        </View>
      )}
      {!!status && (
        <Animated.Text entering={FadeIn} exiting={FadeOut} style={styles.status} numberOfLines={2}>
          {busy ? '⏳ ' : ''}
          {status}
        </Animated.Text>
      )}
      {!inDeleted && visible.length > 0 && (
        <Text style={styles.summary}>
          {visible.length} {visible.length === 1 ? 'item' : 'items'} · {fmtLength(libraryMs) || 'length unknown'}
        </Text>
      )}
      {inDeleted && <Text style={styles.summary}>Items here are removed for good after the days you chose in Settings. Tap one to restore it.</Text>}

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
        <View style={{ marginTop: 14 }}>
          <Text style={styles.section}>Continue listening</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SIDE, gap: 12 }}>
            {resume.map((i, n) => {
              const pr = progressOf(i);
              const left = Math.max(0, totalMs(i) * (1 - pr));
              return (
                <Animated.View key={i.id} entering={FadeInDown.delay(n * 60)}>
                  <TouchableOpacity style={styles.resume} onPress={() => onOpen(i)} onLongPress={() => onInfo(i)} accessibilityLabel={`Continue ${displayTitle(i)}`}>
                    <AudioCover item={i} size={132} radius={16} />
                    <View style={styles.resumeBar}>
                      <View style={[styles.resumeFill, { width: `${Math.round(pr * 100)}%` }]} />
                    </View>
                    <Text style={styles.resumeTitle} numberOfLines={2}>
                      {displayTitle(i)}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {left > 60_000 ? `${fmtLength(left)} left` : 'Almost done'}
                    </Text>
                    {currentId === i.id && playing && (
                      <View style={styles.nowBadge}>
                        <Icon name="audio" size={11} color="#fff" />
                      </View>
                    )}
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
          <Text style={styles.sortText}>{AUDIO_SORTS.find((s) => s.key === sort)?.label}</Text>
          <Icon name="down" size={11} color={p.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  );

  const empty = (
    <Animated.View entering={enterUp(1)} style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name="headphones" size={30} color={p.accent} />
      </View>
      <Text style={styles.emptyTitle}>{inDeleted ? 'Nothing here' : query || chip !== 'all' ? 'Nothing matches' : 'Your audio lives here'}</Text>
      {!inDeleted && !query && chip === 'all' && (
        <>
          <Text style={styles.emptyText}>
            Add your own audiobooks and audio files (MP3, M4A, M4B, WAV, FLAC and more) and EPUB 3 books - with read-along, the sentence being read lights up as it plays. Rate them, add keywords and notes, and pick up where you left off.
          </Text>
          <Text style={styles.emptyText}>Books are unpacked once when you add them, so they never take more space the more you listen.</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => setMenu('add')}>
            <Text style={styles.emptyBtnText}>Add audio</Text>
          </TouchableOpacity>
        </>
      )}
    </Animated.View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={list}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={{ paddingBottom: tabSpace + bottomSpace + 24 }}
        keyboardDismissMode="on-drag"
        renderItem={({ item: i }) => {
          const pr = progressOf(i);
          const sel = selected?.has(i.id) ?? false;
          const now = currentId === i.id;
          return (
            <TouchableOpacity
              style={[styles.row, sel && styles.rowSel]}
              onPress={() => {
                if (selected) return toggle(i.id);
                if (inDeleted) {
                  setDeletedTarget(i);
                  setMenu('deleted-one');
                  return;
                }
                onOpen(i);
              }}
              onLongPress={() => {
                tick();
                if (inDeleted) return;
                if (!selected) setSelected(new Set([i.id]));
                else onInfo(i);
              }}
              accessibilityLabel={`${displayTitle(i)}${i.author ? ` by ${i.author}` : ''}`}>
              {selected && (
                <View style={[styles.check, sel && styles.checkOn]}>{sel && <Icon name="check" size={12} color="#fff" weight="bold" />}</View>
              )}
              <AudioCover item={i} size={58} />
              <View style={{ flex: 1, gap: 3 }}>
                <View style={styles.rowHead}>
                  <Text style={[styles.rowTitle, now && { color: p.accent }]} numberOfLines={1}>
                    {displayTitle(i)}
                  </Text>
                  {i.rating > 0 && <Text style={styles.rating}>★ {fmtRating(i.rating)}</Text>}
                </View>
                <Text style={styles.meta} numberOfLines={1}>
                  {[i.author, fmtLength(totalMs(i)), i.kind === 'book' ? (i.tracks.length ? 'read-along' : 'book') : i.tracks.length > 1 ? `${i.tracks.length} files` : i.chapters.length ? `${i.chapters.length} chapters` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {i.status === 'finished' ? (
                  <Text style={styles.done}>✓ Finished</Text>
                ) : pr > 0 ? (
                  <View style={styles.bar}>
                    <View style={[styles.barFill, { width: `${Math.max(2, Math.round(pr * 100))}%` }]} />
                  </View>
                ) : i.tags.length ? (
                  <Text style={styles.tags} numberOfLines={1}>
                    {i.tags.map((t) => `#${t}`).join(' ')}
                  </Text>
                ) : null}
              </View>
              {now && playing && !selected && <Icon name="audio" size={16} color={p.accent} />}
              {!selected && !inDeleted && (
                <TouchableOpacity hitSlop={10} onPress={() => onInfo(i)} accessibilityLabel={`Details of ${displayTitle(i)}`}>
                  <Icon name="more" size={16} color={p.textSecondary} />
                </TouchableOpacity>
              )}
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
            onPress={() => {
              actions.trash(ids).catch(() => undefined);
              setSelected(null);
            }}
            style={styles.selectBtn}>
            <Icon name="trash" size={14} color={p.danger} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSelected(null)} style={styles.selectBtn}>
            <Text style={styles.selectBtnText}>Done</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {menu === 'add' && <OptionsSheet title="Add to Audio" options={addOptions} onClose={() => setMenu(null)} />}
      {menu === 'more' && <OptionsSheet title="Audio" options={moreOptions} onClose={() => setMenu(null)} />}
      {menu === 'sort' && (
        <OptionsSheet
          title="Sort by"
          options={AUDIO_SORTS.map((s) => ({ label: s.label, hint: s.key === sort ? '✓' : undefined, onPress: () => setSort(s.key) }))}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'status' && (
        <OptionsSheet
          title={`Status of ${ids.length}`}
          options={[
            ...AUDIO_STATUSES.map((s) => ({ label: s.label, onPress: () => actions.update(ids, { status: s.key as AudioStatus }).then(() => setSelected(null)) })),
            { label: 'No status', onPress: () => actions.update(ids, { status: null }).then(() => setSelected(null)) },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'deleted-one' && deletedTarget && (
        <OptionsSheet
          title={displayTitle(deletedTarget)}
          options={[
            { label: 'Restore', onPress: () => actions.restore([deletedTarget.id]) },
            { label: 'Delete for good', danger: true, hint: 'Removes the files', onPress: () => actions.purge([deletedTarget.id]) },
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
          placeholder="e.g. sleep, favourite, series name"
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
    search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: SIDE, marginTop: 12, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 12, height: 40 },
    searchInput: { flex: 1, color: p.text, fontSize: 16 },
    section: { color: p.text, fontSize: 20, fontWeight: '800', paddingHorizontal: SIDE, marginBottom: 10 },
    resume: { width: 132, gap: 5 },
    resumeBar: { height: 4, borderRadius: 2, backgroundColor: p.card, overflow: 'hidden', marginTop: 4 },
    resumeFill: { height: 4, borderRadius: 2, backgroundColor: p.accent },
    resumeTitle: { color: p.text, fontSize: 14, fontWeight: '700' },
    nowBadge: { position: 'absolute', top: 8, right: 8, width: 24, height: 24, borderRadius: 12, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    chips: { gap: 8, paddingHorizontal: SIDE, paddingTop: 14 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    chipOn: { backgroundColor: p.text },
    chipText: { color: p.textSoft, fontSize: 14, fontWeight: '700' },
    chipCount: { color: p.textSecondary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
    chipTextOn: { color: p.bg },
    sortRow: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: SIDE, paddingTop: 14, paddingBottom: 4, alignSelf: 'flex-start' },
    sortText: { color: p.textSecondary, fontSize: 13, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: SIDE, paddingVertical: 9 },
    rowSel: { backgroundColor: p.accentSoft },
    rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowTitle: { flex: 1, color: p.text, fontSize: 16, fontWeight: '700' },
    rating: { color: p.rating, fontSize: 13, fontWeight: '800' },
    meta: { color: p.textSecondary, fontSize: 13 },
    done: { color: '#30D158', fontSize: 12, fontWeight: '700' },
    tags: { color: p.link, fontSize: 12 },
    bar: { height: 3, borderRadius: 2, backgroundColor: p.card, overflow: 'hidden', marginTop: 3 },
    barFill: { height: 3, borderRadius: 2, backgroundColor: p.accent },
    check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: p.textMuted, alignItems: 'center', justifyContent: 'center' },
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
  });
