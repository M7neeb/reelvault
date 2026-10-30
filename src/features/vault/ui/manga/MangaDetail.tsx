/**
 * A series' page: its cover over a blurred copy of itself, a big Continue
 * button, your rating and status, how it reads (right to left, left to
 * right, vertical, webtoon), keywords, the chapters (tap to read, hold for
 * read / unread, "everything before is read", use a page as the cover,
 * delete), and its details and your notes. Presentational only.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { GatedModal as Modal } from '../screen';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MANGA_KINDS,
  MANGA_STATUSES,
  READING_MODES,
  chapterLabel,
  fmtRating,
  isRead,
  modeOf,
  nextChapter,
  progressOf,
  unreadCount,
  type MangaChapter,
} from '../../manga/mangaLogic';
import { fmtDateTime, fmtSize } from '../format';
import { success, tick } from '../haptics';
import Icon from '../Icon';
import { OptionsSheet, PromptSheet } from '../prompts';
import RatingPicker from '../RatingPicker';
import { sheet, usePalette, useStyles, withAccent, type Palette } from '../theme';
import { tachiSourceOf } from '../../manga/mangaBackup';
import LinkSheet from './LinkSheet';
import LogReadingSheet from './LogReading';
import AniListSheet from './AniListSheet';
import type { AniListActions, AniListState } from '../../manga/anilistData';
import MangaCover from './MangaCover';
import type { BrowseActions, DownloadState, MangaActions, MangaEdit, MangaUiSeries } from './mangaTypes';
import { showFailure } from '../oops';

type Field = { key: 'title' | 'altTitle' | 'author' | 'artist' | 'notes' | 'description'; label: string; placeholder: string; multiline?: boolean };
const PUB_LABEL: Record<string, string> = { ongoing: 'Ongoing', completed: 'Completed', hiatus: 'On hiatus', cancelled: 'Cancelled' };

const FIELDS: Field[] = [
  { key: 'title', label: 'Title', placeholder: 'Title' },
  { key: 'altTitle', label: 'Other title', placeholder: 'e.g. the Japanese or English title' },
  { key: 'author', label: 'Author', placeholder: 'Who wrote it' },
  { key: 'artist', label: 'Artist', placeholder: 'Who drew it' },
  { key: 'notes', label: 'Your notes', placeholder: 'What you think of it', multiline: true },
  { key: 'description', label: 'About', placeholder: 'What it is about', multiline: true },
];

export default function MangaDetail({
  series,
  actions,
  onRead,
  onOpenUrl,
  onClose,
  children,
  downloads,
  browse,
  anilist,
}: {
  series: MangaUiSeries;
  actions: MangaActions;
  downloads?: DownloadState;
  /** For "Find on a source". */
  browse?: BrowseActions;
  /** AniList: link, details, your list. */
  anilist?: { state: AniListState; actions: AniListActions };
  /** Opens the reader on this chapter (at the page you left, or the start). */
  onRead: (chapter: MangaChapter, fromStart?: boolean) => void;
  onOpenUrl?: (url: string) => void;
  onClose: () => void;
  /** The reader, shown inside this window (one full-screen window at a time on the iPhone). */
  children?: ReactNode;
}) {
  // The title's own colour (from its cover) for its buttons and bars.
  const base = usePalette();
  const [tint, setTint] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    actions
      .coverColor?.(series.id)
      .then((c) => live && setTint(c))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [series.id, series.cover]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = useMemo(() => withAccent(base, tint), [base, tint]);
  const styles = useMemo(() => makeStyles(p), [p]);
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, series[f.key] ?? ''])));
  const [rating, setRating] = useState(false);
  const [tag, setTag] = useState(false);
  const [menu, setMenu] = useState<null | 'mode' | 'kind' | 'more' | 'delete'>(null);
  const [chapterMenu, setChapterMenu] = useState<MangaChapter | null>(null);
  const [newestFirst, setNewestFirst] = useState(false);
  /** Which chapters the list shows. */
  const [show, setShow] = useState<'all' | 'unread' | 'phone'>('all');
  const [checking, setChecking] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [linking, setLinking] = useState(false);
  const [aniOpen, setAniOpen] = useState(false);
  const tachi = tachiSourceOf(series.sourceId);
  const fromSource = !!series.sourceId && !tachi;
  const queue = new Map((downloads?.queue ?? []).filter((q) => q.seriesId === series.id).map((q) => [q.chapterId, q]));
  const current = downloads?.current?.seriesId === series.id ? downloads.current : null;
  const online = series.chapters.filter((c) => !c.folder && c.sourceKey && !c.sourceUrl);
  const onPhone = series.chapters.filter((c) => c.folder && c.pages.length);
  const say = (job: Promise<unknown>, text: (v: never) => string) => {
    job.then((v) => setChecking(text(v as never))).catch((e) => setChecking(String(e).replace(/^Error:\s*/, '')));
  };
  const checkNew = () => {
    setChecking('Checking for new chapters…');
    actions
      .refresh(series.id)
      .then((n) => setChecking(n ? `${n} new ${n === 1 ? 'chapter' : 'chapters'}` : 'No new chapters'))
      .catch((e) => setChecking(String(e).replace(/^Error:\s*/, '')));
  };

  const next = nextChapter(series);
  const unread = unreadCount(series);
  const pr = progressOf(series);
  const size = series.chapters.reduce((a, c) => a + c.size, 0);
  const pages = series.chapters.reduce((a, c) => a + c.pageCount, 0);
  const chapters = useMemo(() => {
    const list = show === 'unread' ? series.chapters.filter((c) => !c.readAt) : show === 'phone' ? series.chapters.filter((c) => c.folder && c.pages.length) : series.chapters;
    return newestFirst ? [...list].reverse() : list;
  }, [series.chapters, newestFirst, show]);
  const mode = modeOf(series);

  const save = (f: Field) => {
    const raw = (draft[f.key] ?? '').trim();
    if (f.key === 'title' && !raw) return;
    const value = raw || null;
    if (value === (series[f.key] ?? null)) return;
    actions.update([series.id], { [f.key]: value } as MangaEdit).catch(() => undefined);
  };

  const continueLabel = !series.chapters.length
    ? null
    : !next
      ? 'Read again from the start'
      : next.lastPage > 0
        ? `Continue ${chapterLabel(next, true)} · page ${next.lastPage + 1}`
        : series.chapters.some(isRead)
          ? `Read ${chapterLabel(next, true)}`
          : 'Start reading';

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
          <View style={styles.hero}>
            {series.coverSource ? <Image source={series.coverSource} style={styles.heroBg} contentFit="cover" blurRadius={40} /> : null}
            <View style={styles.heroShade} />
            <View style={[styles.heroBar, { paddingTop: insets.top + 6 }]}>
              <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Back">
                <Icon name="back" size={16} color="#fff" weight="bold" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.circle} onPress={() => setMenu('more')} accessibilityLabel="More">
                <Icon name="more" size={16} color="#fff" weight="bold" />
              </TouchableOpacity>
            </View>
            <View style={styles.heroRow}>
              <TouchableOpacity onPress={() => actions.setCoverFromPhoto(series.id).catch(showFailure)} accessibilityLabel="Change the cover">
                <MangaCover series={series} width={118} radius={12} />
              </TouchableOpacity>
              <View style={styles.heroText}>
                <Text style={styles.heroTitle} numberOfLines={4}>
                  {series.title}
                </Text>
                {!!(series.author || series.artist) && (
                  <Text style={styles.heroSub} numberOfLines={2}>
                    {[series.author, series.artist && series.artist !== series.author ? series.artist : null].filter(Boolean).join(' · ')}
                  </Text>
                )}
                <Text style={styles.heroFacts}>
                  {series.chapters.length} {series.chapters.length === 1 ? 'chapter' : 'chapters'}
                  {unread ? ` · ${unread} unread` : series.chapters.length ? ' · all read' : ''}
                </Text>
                <Text style={styles.heroFacts}>
                  {pages} pages · {fmtSize(size)}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.body}>
            {continueLabel && (
              <TouchableOpacity
                style={styles.primary}
                onPress={() => {
                  success();
                  if (next) onRead(next);
                  else if (series.chapters[0]) onRead(series.chapters[0], true);
                }}>
                <Icon name="bookOpen" size={17} color="#fff" />
                <Text style={styles.primaryText} numberOfLines={1}>
                  {continueLabel}
                </Text>
              </TouchableOpacity>
            )}
            {tachi && browse && (
              <TouchableOpacity style={styles.linkBox} onPress={() => setLinking(true)}>
                <Icon name="link" size={16} color={p.link} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.linkTitle}>Find on a source</Text>
                  <Text style={styles.facts}>From your Tachimanga backup ({tachi.name}). Link it to read, download and get new chapters; your read marks stay.</Text>
                </View>
              </TouchableOpacity>
            )}
            {fromSource && (
              <View style={styles.dlRow}>
                <TouchableOpacity
                  style={styles.dlBtn}
                  disabled={!online.length}
                  onPress={() => say(actions.download(series.id, 'unread'), (n: number) => (n ? `${n} ${n === 1 ? 'chapter' : 'chapters'} added to Downloads` : 'Every unread chapter is on the phone or waiting'))}>
                  <Icon name="import" size={15} color={online.length ? p.text : p.textMuted} />
                  <Text style={[styles.dlText, !online.length && { color: p.textMuted }]}>Download unread</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.dlBtn}
                  disabled={!online.length}
                  onPress={() => say(actions.download(series.id, 'all'), (n: number) => (n ? `${n} ${n === 1 ? 'chapter' : 'chapters'} added to Downloads` : 'Everything is on the phone or waiting'))}>
                  <Icon name="import" size={15} color={online.length ? p.text : p.textMuted} />
                  <Text style={[styles.dlText, !online.length && { color: p.textMuted }]}>All</Text>
                </TouchableOpacity>
                {onPhone.length > 0 && (
                  <TouchableOpacity style={styles.dlBtn} onPress={() => say(actions.exportCbz(series.id, 'all'), (m: string) => m)}>
                    <Icon name="share" size={15} color={p.text} />
                    <Text style={styles.dlText}>.cbz</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {(current || queue.size > 0) && (
              <Text style={styles.facts}>
                {current ? `Downloading ${chapterLabel(series.chapters.find((c) => c.id === current.chapterId) ?? { number: null, volume: null, title: null, filename: null }, true)} · page ${current.done} of ${current.total}` : 'Waiting to download'}
                {queue.size > (current ? 1 : 0) ? ` · ${queue.size - (current ? 1 : 0)} more waiting` : ''}
              </Text>
            )}
            {!!checking && <Text style={styles.facts}>{checking}</Text>}
            {pr > 0 && pr < 1 && (
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${Math.round(pr * 100)}%` }]} />
              </View>
            )}

            <View style={styles.quick}>
              <TouchableOpacity style={styles.quickBtn} onPress={() => setRating(true)}>
                <Icon name={series.rating ? 'star' : 'starOff'} size={18} color={series.rating ? p.rating : p.textSecondary} />
                <Text style={styles.quickText}>{series.rating ? fmtRating(series.rating) : 'Rate'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickBtn} onPress={() => setLogging(true)} accessibilityLabel="Log reading time">
                <Icon name="clock" size={18} color={p.textSecondary} />
                <Text style={styles.quickText}>Log time</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickBtn} onPress={() => setMenu('mode')}>
                <Icon name="bookOpen" size={18} color={p.textSecondary} />
                <Text style={styles.quickText}>{READING_MODES.find((m) => m.key === mode)?.label}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.quickBtn} onPress={() => setMenu('kind')}>
                <Icon name="book" size={18} color={p.textSecondary} />
                <Text style={styles.quickText}>{MANGA_KINDS.find((k) => k.key === (series.kind ?? 'manga'))?.label.split(' /')[0]}</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.section}>Status</Text>
            <View style={styles.chips}>
              {MANGA_STATUSES.map((s) => {
                const on = series.status === s.key;
                return (
                  <TouchableOpacity
                    key={s.key}
                    style={[styles.chip, on && styles.chipOn]}
                    onPress={() => {
                      tick();
                      actions.update([series.id], { status: on ? null : s.key }).catch(() => undefined);
                    }}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{s.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.section}>Keywords</Text>
            <View style={styles.chips}>
              {series.tags.map((t) => (
                <TouchableOpacity key={t} style={styles.tag} onPress={() => actions.removeTag(series.id, t).catch(showFailure)} accessibilityLabel={`Remove keyword ${t}`}>
                  <Text style={styles.tagText}># {t}</Text>
                  <Icon name="close" size={10} color={p.textSecondary} />
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.chip} onPress={() => setTag(true)}>
                <Text style={styles.chipText}>+ Keyword</Text>
              </TouchableOpacity>
            </View>

            {!!series.description && (
              <>
                <Text style={styles.section}>About</Text>
                <Text style={styles.about}>{series.description}</Text>
              </>
            )}

            <View style={styles.chHead}>
              <Text style={[styles.section, { marginTop: 0, flex: 1 }]}>Chapters</Text>
              {series.chapters.length > 1 && (
                <TouchableOpacity
                  onPress={() => setShow((x) => (x === 'all' ? 'unread' : x === 'unread' && onPhone.length && online.length ? 'phone' : 'all'))}
                  style={styles.chSort}
                  accessibilityLabel="Which chapters to show">
                  <Icon name="options" size={12} color={show === 'all' ? p.textSecondary : p.accent} />
                  <Text style={[styles.chSortText, show !== 'all' && { color: p.accent }]}>{show === 'all' ? 'All' : show === 'unread' ? 'Unread' : 'On the phone'}</Text>
                </TouchableOpacity>
              )}
              {series.chapters.length > 1 && (
                <TouchableOpacity onPress={() => setNewestFirst((x) => !x)} style={styles.chSort}>
                  <Icon name="sort" size={12} color={p.textSecondary} />
                  <Text style={styles.chSortText}>{newestFirst ? 'Newest first' : 'First to last'}</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.chList}>
              {chapters.map((c) => {
                const read = isRead(c);
                const started = !read && c.lastPage > 0;
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={styles.chRow}
                    onPress={() => (!c.folder && c.sourceUrl && onOpenUrl ? onOpenUrl(c.sourceUrl) : onRead(c))}
                    onLongPress={() => {
                      tick();
                      setChapterMenu(c);
                    }}
                    accessibilityLabel={`${chapterLabel(c)}${read ? ', read' : ''}`}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.chTitle, read && styles.chRead]} numberOfLines={2}>
                        {chapterLabel(c)}
                      </Text>
                      <Text style={styles.chMeta} numberOfLines={1}>
                        {[
                          !c.folder ? (c.sourceUrl ? 'On another website' : 'Online') : null,
                          c.pageCount ? `${c.pageCount} pages` : null,
                          started ? `page ${c.lastPage + 1}` : null,
                          c.scanlator,
                          fmtDateTime(c.uploadedAt ?? c.addedAt).date,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                    {current?.chapterId === c.id ? (
                      <Text style={styles.dlPct}>{Math.round((current.done / Math.max(1, current.total)) * 100)}%</Text>
                    ) : queue.get(c.id)?.state === 'failed' ? (
                      <Icon name="info" size={15} color={p.danger} />
                    ) : queue.has(c.id) ? (
                      <ActivityIndicator size="small" color={p.textMuted} />
                    ) : c.folder && c.sourceKey ? (
                      <Icon name="import" size={13} color={p.textMuted} />
                    ) : null}
                    {read ? (
                      <Icon name="checkCircle" size={18} color={p.textMuted} />
                    ) : started ? (
                      <View style={styles.startedDot} />
                    ) : (
                      <View style={styles.unreadDot} />
                    )}
                  </TouchableOpacity>
                );
              })}
              {!series.chapters.length && <Text style={styles.about}>No chapters yet.</Text>}
            </View>

            <Text style={styles.section}>Details</Text>
            {FIELDS.map((f) => (
              <View key={f.key} style={styles.field}>
                <Text style={styles.label}>{f.label}</Text>
                <TextInput
                  value={draft[f.key]}
                  onChangeText={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                  onEndEditing={() => save(f)}
                  placeholder={f.placeholder}
                  placeholderTextColor={p.textMuted}
                  multiline={f.multiline}
                  style={[styles.input, f.multiline && styles.inputMulti]}
                />
              </View>
            ))}
            <Text style={styles.facts}>Added {fmtDateTime(series.importedAt).date}</Text>
            {series.lastReadAt && <Text style={styles.facts}>Last read {fmtDateTime(series.lastReadAt).date}</Text>}
          </View>
        </ScrollView>
      </View>

      {logging && <LogReadingSheet series={series} actions={actions} onDone={setChecking} onClose={() => setLogging(false)} />}
      {rating && <RatingPicker title="Your rating" value={series.rating || null} onPick={(r) => actions.update([series.id], { rating: r ?? 0 }).catch(() => undefined)} onClose={() => setRating(false)} />}
      {tag && <PromptSheet title="Add a keyword" placeholder="e.g. action, isekai, favourite" onSubmit={(t) => t.trim() && actions.addTag([series.id], t.trim()).catch(() => undefined)} onClose={() => setTag(false)} />}
      {menu === 'mode' && (
        <OptionsSheet
          title="How it reads"
          options={READING_MODES.map((m) => ({
            label: m.label,
            hint: `${m.hint}${m.key === mode ? '  ✓' : ''}`,
            onPress: () => actions.update([series.id], { readingMode: m.key }).catch(showFailure),
          }))}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'kind' && (
        <OptionsSheet
          title="What it is"
          options={MANGA_KINDS.map((k) => ({
            label: k.label,
            hint: (series.kind ?? 'manga') === k.key ? '✓' : undefined,
            onPress: () => actions.update([series.id], { kind: k.key }).catch(showFailure),
          }))}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'more' && (
        <OptionsSheet
          title={series.title}
          options={[
            ...(fromSource ? [{ label: 'Check for new chapters', onPress: checkNew }] : []),
            ...(onPhone.some((c) => c.sourceKey) ? [{ label: 'Remove downloads', hint: 'The chapters stay, readable online', onPress: () => actions.removeDownloads(series.id, 'all').catch(showFailure) }] : []),
            ...(onPhone.length ? [{ label: 'Save all as .cbz', hint: 'Files › On My iPhone › ReelVault › Exports', onPress: () => say(actions.exportCbz(series.id, 'all'), (m: string) => m) }] : []),
            ...(browse ? [{ label: fromSource ? 'Link to another source' : 'Find on a source', onPress: () => setTimeout(() => setLinking(true), 250) }] : []),
            ...(series.sourceUrl && onOpenUrl ? [{ label: 'Open on the website', onPress: () => onOpenUrl(series.sourceUrl!) }] : []),
            ...(anilist ? [{ label: 'AniList', hint: anilist.state.links[series.id] ? (anilist.state.user ? 'Linked · updates as you read' : 'Linked') : 'Track it, fill in details', onPress: () => setAniOpen(true) }] : []),
            { label: 'Mark all as read', onPress: () => actions.setRead(series.chapters.map((c) => c.id), true).catch(() => undefined) },
            { label: 'Mark all as unread', onPress: () => actions.setRead(series.chapters.map((c) => c.id), false).catch(() => undefined) },
            { label: 'Change the cover', hint: 'A picture from Photos, or hold a page in the reader', onPress: () => actions.setCoverFromPhoto(series.id).catch(showFailure) },
            {
              label: `Publication · ${PUB_LABEL[series.pubStatus?.toLowerCase() ?? ''] ?? (series.pubStatus || 'Not set')}`,
              hint: 'Tap to change: ongoing, completed, on hiatus, cancelled',
              onPress: () => {
                const order = ['ongoing', 'completed', 'hiatus', 'cancelled'];
                const i = order.indexOf(series.pubStatus?.toLowerCase() ?? '');
                actions.update([series.id], { pubStatus: i >= order.length - 1 ? null : order[i + 1] }).catch(showFailure);
              },
            },
            { label: series.isPrivate ? 'Remove from Private' : 'Move to Private', onPress: () => actions.update([series.id], { isPrivate: !series.isPrivate }).catch(showFailure) },
            { label: 'Delete', danger: true, hint: 'To Recently Deleted', onPress: () => setTimeout(() => setMenu('delete'), 250) },
          ]}
          onClose={() => setMenu((m) => (m === 'more' ? null : m))}
        />
      )}
      {menu === 'delete' && (
        <OptionsSheet
          title={`Delete ${series.title}?`}
          options={[
            {
              label: 'Delete',
              danger: true,
              hint: 'You can bring it back from Recently Deleted',
              onPress: () => {
                actions.trash([series.id]).catch(() => undefined);
                onClose();
              },
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {chapterMenu && (
        <OptionsSheet
          title={chapterLabel(chapterMenu)}
          options={[
            isRead(chapterMenu)
              ? { label: 'Mark as unread', onPress: () => actions.setRead([chapterMenu.id], false).catch(showFailure) }
              : { label: 'Mark as read', onPress: () => actions.setRead([chapterMenu.id], true).catch(showFailure) },
            ...(!chapterMenu.folder && chapterMenu.sourceKey && !chapterMenu.sourceUrl && !queue.has(chapterMenu.id) ? [{ label: 'Download', onPress: () => actions.download(series.id, [chapterMenu.id]).catch(showFailure) }] : []),
            ...(queue.has(chapterMenu.id) ? [{ label: 'Cancel download', onPress: () => actions.cancelDownloads([chapterMenu.id]).catch(showFailure) }] : []),
            ...(chapterMenu.folder && chapterMenu.sourceKey ? [{ label: 'Remove download', hint: 'Stays readable online', onPress: () => actions.removeDownloads(series.id, [chapterMenu.id]).catch(showFailure) }] : []),
            ...(chapterMenu.folder ? [{ label: 'Share as .cbz', onPress: () => actions.shareCbz(series.id, chapterMenu.id).catch(showFailure) }] : []),
            { label: 'Mark everything before as read', onPress: () => actions.markPreviousRead(series.id, chapterMenu.id).catch(showFailure) },
            { label: 'Read from the first page', onPress: () => onRead(chapterMenu, true) },
            ...(chapterMenu.folder ? [{ label: 'Use its first page as the cover', onPress: () => actions.setCoverFromPage(series.id, chapterMenu, 0).catch(showFailure) }] : []),
            { label: 'Delete this chapter', danger: true, hint: 'Removes its pages', onPress: () => actions.deleteChapters(series.id, [chapterMenu.id]).catch(showFailure) },
          ]}
          onClose={() => setChapterMenu(null)}
        />
      )}
      {aniOpen && anilist && <AniListSheet series={series} state={anilist.state} actions={anilist.actions} onOpenUrl={onOpenUrl} onClose={() => setAniOpen(false)} />}
      {linking && browse && <LinkSheet series={series} browse={browse} actions={actions} hint={tachi?.name ?? null} onClose={() => setLinking(false)} />}
      {children}
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    hero: { overflow: 'hidden', paddingBottom: 18, backgroundColor: p.elevated },
    heroBg: { position: 'absolute', top: -40, left: -40, right: -40, bottom: -40, opacity: 0.9 },
    heroShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
    heroBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
    circle: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
    heroRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 16, alignItems: 'flex-end' },
    heroText: { flex: 1, gap: 4, paddingBottom: 4 },
    heroTitle: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
    heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600' },
    heroFacts: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
    body: { paddingHorizontal: 16, paddingTop: 16, gap: 8 },
    primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: p.accent, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '800', flexShrink: 1 },
    bar: { height: 4, borderRadius: 2, backgroundColor: p.card, overflow: 'hidden' },
    barFill: { height: 4, borderRadius: 2, backgroundColor: p.accent },
    quick: { flexDirection: 'row', gap: 8, marginTop: 6 },
    quickBtn: { flex: 1, alignItems: 'center', gap: 5, backgroundColor: p.card, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 6 },
    quickText: { color: p.text, fontSize: 13, fontWeight: '700', textAlign: 'center' },
    section: { color: p.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 14 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
    chipOn: { backgroundColor: p.text },
    chipText: { color: p.text, fontSize: 14, fontWeight: '700' },
    chipTextOn: { color: p.bg },
    tag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.accentSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    tagText: { color: p.link, fontSize: 14, fontWeight: '700' },
    about: { color: p.textSoft, fontSize: 14, lineHeight: 20 },
    chHead: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
    chSort: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    chSortText: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    chList: { backgroundColor: p.card, borderRadius: 14, overflow: 'hidden' },
    chRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: p.separator },
    chTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    chRead: { color: p.textMuted },
    chMeta: { color: p.textSecondary, fontSize: 12 },
    linkBox: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: p.card, borderRadius: 14, padding: 14 },
    linkTitle: { color: p.link, fontSize: 16, fontWeight: '800' },
    dlRow: { flexDirection: 'row', gap: 8 },
    dlBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: p.card, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, flexGrow: 1 },
    dlText: { color: p.text, fontSize: 14, fontWeight: '700' },
    dlPct: { color: p.accent, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
    unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: p.accent },
    startedDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2, borderColor: p.accent },
    field: { gap: 4 },
    label: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    input: { color: p.text, fontSize: 16, backgroundColor: p.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
    inputMulti: { minHeight: 80, textAlignVertical: 'top' },
    facts: { color: p.textSecondary, fontSize: 13 },
  });
