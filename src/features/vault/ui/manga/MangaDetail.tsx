/**
 * A series' page: its cover over a blurred copy of itself, a big Continue
 * button, your rating and status, how it reads (right to left, left to
 * right, vertical, webtoon), keywords, the chapters (tap to read, hold for
 * read / unread, "everything before is read", use a page as the cover,
 * delete), and its details and your notes. Presentational only.
 */

import { useMemo, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import MangaCover from './MangaCover';
import type { MangaActions, MangaEdit, MangaUiSeries } from './mangaTypes';

type Field = { key: 'title' | 'altTitle' | 'author' | 'artist' | 'notes' | 'description'; label: string; placeholder: string; multiline?: boolean };
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
  onClose,
}: {
  series: MangaUiSeries;
  actions: MangaActions;
  /** Opens the reader on this chapter (at the page you left, or the start). */
  onRead: (chapter: MangaChapter, fromStart?: boolean) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, series[f.key] ?? ''])));
  const [rating, setRating] = useState(false);
  const [tag, setTag] = useState(false);
  const [menu, setMenu] = useState<null | 'mode' | 'kind' | 'more' | 'delete'>(null);
  const [chapterMenu, setChapterMenu] = useState<MangaChapter | null>(null);
  const [newestFirst, setNewestFirst] = useState(false);

  const next = nextChapter(series);
  const unread = unreadCount(series);
  const pr = progressOf(series);
  const size = series.chapters.reduce((a, c) => a + c.size, 0);
  const pages = series.chapters.reduce((a, c) => a + c.pageCount, 0);
  const chapters = useMemo(() => (newestFirst ? [...series.chapters].reverse() : series.chapters), [series.chapters, newestFirst]);
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
              <TouchableOpacity onPress={() => actions.setCoverFromPhoto(series.id).catch(() => undefined)} accessibilityLabel="Change the cover">
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
                <TouchableOpacity key={t} style={styles.tag} onPress={() => actions.removeTag(series.id, t).catch(() => undefined)} accessibilityLabel={`Remove keyword ${t}`}>
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
                    onPress={() => onRead(c)}
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
                        {[`${c.pageCount} pages`, started ? `page ${c.lastPage + 1}` : null, c.scanlator, fmtDateTime(c.uploadedAt ?? c.addedAt).date].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
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

      {rating && <RatingPicker title="Your rating" value={series.rating || null} onPick={(r) => actions.update([series.id], { rating: r ?? 0 }).catch(() => undefined)} onClose={() => setRating(false)} />}
      {tag && <PromptSheet title="Add a keyword" placeholder="e.g. action, isekai, favourite" onSubmit={(t) => t.trim() && actions.addTag([series.id], t.trim()).catch(() => undefined)} onClose={() => setTag(false)} />}
      {menu === 'mode' && (
        <OptionsSheet
          title="How it reads"
          options={READING_MODES.map((m) => ({
            label: m.label,
            hint: `${m.hint}${m.key === mode ? '  ✓' : ''}`,
            onPress: () => actions.update([series.id], { readingMode: m.key }).catch(() => undefined),
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
            onPress: () => actions.update([series.id], { kind: k.key }).catch(() => undefined),
          }))}
          onClose={() => setMenu(null)}
        />
      )}
      {menu === 'more' && (
        <OptionsSheet
          title={series.title}
          options={[
            { label: 'Mark all as read', onPress: () => actions.setRead(series.chapters.map((c) => c.id), true).catch(() => undefined) },
            { label: 'Mark all as unread', onPress: () => actions.setRead(series.chapters.map((c) => c.id), false).catch(() => undefined) },
            { label: 'Change the cover', hint: 'A picture from Files', onPress: () => actions.setCoverFromPhoto(series.id).catch(() => undefined) },
            { label: series.isPrivate ? 'Remove from Private' : 'Move to Private', onPress: () => actions.update([series.id], { isPrivate: !series.isPrivate }).catch(() => undefined) },
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
              ? { label: 'Mark as unread', onPress: () => actions.setRead([chapterMenu.id], false).catch(() => undefined) }
              : { label: 'Mark as read', onPress: () => actions.setRead([chapterMenu.id], true).catch(() => undefined) },
            { label: 'Mark everything before as read', onPress: () => actions.markPreviousRead(series.id, chapterMenu.id).catch(() => undefined) },
            { label: 'Read from the first page', onPress: () => onRead(chapterMenu, true) },
            { label: 'Use its first page as the cover', onPress: () => actions.setCoverFromPage(series.id, chapterMenu, 0).catch(() => undefined) },
            { label: 'Delete this chapter', danger: true, hint: 'Removes its pages', onPress: () => actions.deleteChapters(series.id, [chapterMenu.id]).catch(() => undefined) },
          ]}
          onClose={() => setChapterMenu(null)}
        />
      )}
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
    unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: p.accent },
    startedDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 2, borderColor: p.accent },
    field: { gap: 4 },
    label: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    input: { color: p.text, fontSize: 16, backgroundColor: p.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
    inputMulti: { minHeight: 80, textAlignVertical: 'top' },
    facts: { color: p.textSecondary, fontSize: 13 },
  });
