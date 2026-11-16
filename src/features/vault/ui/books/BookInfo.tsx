/**
 * A book's page: its cover (yours or the book's own), title and author you
 * can correct, your rating, status, keywords and notes, how far you are, the
 * book's own description, and every bookmark and highlight with your notes.
 * Tap a bookmark or highlight to read from there.
 * Presentational only (see the note at the top of types.ts).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BOOK_STATUSES, displayTitle, fmtProgress, isStarted, progressOf, statusOf, type BookMark, type BookRead } from '../../books/bookLogic';
import { bookHistory, fmtTime } from '../../books/bookStats';
import { fmtSize } from '../format';
import Icon from '../Icon';
import { OptionsSheet, PromptSheet } from '../prompts';
import RatingPicker from '../RatingPicker';
import { Modal } from '../screen';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { AudioUiItem } from '../audio/audioTypes';
import { AudiobookPart } from './BookAudio';
import { BookCover } from './BooksScreen';
import type { BookActions, BookUi } from './bookTypes';

const SERIF = Platform.select({ ios: 'Charter', web: 'Charter, Georgia, serif', default: 'serif' });
const failed = (e: unknown) => Alert.alert('That did not work', String(e).replace(/^Error:\s*/, ''));

/** EPUB descriptions are often HTML. */
const plainText = (s: string) =>
  s
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const fmtPct = (f: number) => `${Math.round(f * 100)}%`;
const DAY_MS = 86_400_000;
const dayName = (day: number, now: number) => {
  const today = new Date(now);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (day >= t) return 'Today';
  if (day >= t - DAY_MS - 3_600_000) return 'Yesterday';
  const d = new Date(day);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
};

type Sheet = 'rate' | 'status' | 'tag' | 'cover' | 'title' | 'author' | null;

export default function BookInfo({
  book,
  actions,
  tags,
  onRead,
  onClose,
  initialMarks,
  audiobook = null,
  audioSuggestion = null,
  audioChoices = [],
  audioPlaying = false,
  audioImporting = false,
  onListen,
  onLinkAudio,
  onImportAudio,
  sittings = [],
}: {
  book: BookUi;
  actions: BookActions;
  /** Keywords used on the shelf, to pick from. */
  tags: string[];
  /** Read from the saved place, or from a bookmark or highlight. */
  onRead: (at?: { chapter: number; block: number }) => void;
  onClose: () => void;
  initialMarks?: BookMark[];
  audiobook?: AudioUiItem | null;
  audioSuggestion?: AudioUiItem | null;
  audioChoices?: AudioUiItem[];
  audioPlaying?: boolean;
  audioImporting?: boolean;
  /** Absent where the Audio section is not there (the Audiobook part is hidden). */
  onListen?: (from: 'audio' | 'book' | 'auto') => void;
  onLinkAudio?: (audioId: string | null) => void;
  onImportAudio?: () => void;
  /** Reading and listening sittings (any book: this one is picked out). */
  sittings?: BookRead[];
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [sheetOpen, setSheet] = useState<Sheet>(null);
  const [marks, setMarks] = useState<BookMark[]>(initialMarks ?? []);
  const [now] = useState(() => Date.now());
  const history = useMemo(() => bookHistory(sittings, book.id, now), [sittings, book.id, now]);
  const [allDays, setAllDays] = useState(false);
  const [notes, setNotes] = useState(book.notes ?? '');
  const [markFor, setMarkFor] = useState<BookMark | null>(null);
  const [noteFor, setNoteFor] = useState<BookMark | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    actions
      .loadMarks(book.id)
      .then(setMarks)
      .catch(() => undefined);
  }, [book.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pr = progressOf(book);
  const st = statusOf(book);
  const about = useMemo(() => (book.description ? plainText(book.description) : ''), [book.description]);
  const highlights = marks.filter((m) => m.kind === 'highlight');
  const bookmarks = marks.filter((m) => m.kind === 'bookmark');
  // Saved when the box loses focus, and again as the page closes: closing with the X or a swipe
  // does not always blur the box first, and the note would be lost.
  const savedNotes = useRef(book.notes ?? '');
  const typed = useRef(notes);
  typed.current = notes;
  const saveNotes = () => {
    if (savedNotes.current === typed.current) return;
    savedNotes.current = typed.current;
    actions.setNotes(book.id, typed.current).catch(failed);
  };
  useEffect(() => saveNotes, []); // eslint-disable-line react-hooks/exhaustive-deps

  const MarkRow = ({ m }: { m: BookMark }) => (
    <TouchableOpacity style={styles.mark} onPress={() => onRead({ chapter: m.chapter, block: m.block })} onLongPress={() => setMarkFor(m)} accessibilityLabel={`${m.kind === 'highlight' ? 'Highlight' : 'Bookmark'} in chapter ${m.chapter + 1}. Hold for more`}>
      <View style={[styles.markRule, m.kind === 'bookmark' && styles.markRuleBookmark]} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.markWhere}>
          Chapter {m.chapter + 1} · {new Date(m.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
        </Text>
        {m.text ? <Text style={styles.markText}>{m.text}</Text> : <Text style={styles.markPlain}>Bookmarked paragraph {m.block + 1}</Text>}
        {!!m.note && <Text style={styles.markNote}>{m.note}</Text>}
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close">
            <Icon name="close" size={15} color={p.icon} weight="bold" />
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          {audiobook && onListen && (
            <TouchableOpacity style={[styles.circle, { width: 36, height: 36, borderRadius: 18, marginRight: 10 }]} onPress={() => onListen('auto')} accessibilityLabel="Listen to the audiobook">
              <Icon name="headphones" size={17} color={p.icon} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.readBtn} onPress={() => onRead()}>
            <Text style={styles.readText}>{isStarted(book) && !book.finishedAt ? 'Carry on' : book.finishedAt ? 'Read again' : 'Start reading'}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 40 }]} keyboardDismissMode="interactive" keyboardShouldPersistTaps="handled">
          <View style={styles.top}>
            <TouchableOpacity onPress={() => setSheet('cover')} accessibilityLabel="Change the cover">
              <BookCover book={book} width={116} radius={4} />
              <Text style={styles.coverHint}>Change</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, gap: 6 }}>
              <TouchableOpacity onPress={() => setSheet('title')} accessibilityLabel="Edit the title">
                <Text style={styles.title}>{displayTitle(book)}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSheet('author')} accessibilityLabel="Edit the author">
                <Text style={[styles.author, !book.author && styles.link]}>{book.author ?? 'Add the author'}</Text>
              </TouchableOpacity>
              <Text style={styles.meta}>
                {book.finishedAt ? `Finished ${new Date(book.finishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}` : fmtProgress(pr, isStarted(book))}
                {book.readMs >= 60_000 ? ` · ${fmtTime(book.readMs)} read` : ''}
              </Text>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${Math.round(pr * 100)}%` }]} />
              </View>
            </View>
          </View>

          <View style={styles.pills}>
            <TouchableOpacity style={styles.pill} onPress={() => setSheet('rate')}>
              <Text style={[styles.pillText, book.rating > 0 && { color: p.rating }]}>{book.rating > 0 ? `★ ${book.rating}` : '☆ Rate'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pill} onPress={() => setSheet('status')}>
              <Text style={styles.pillText}>{BOOK_STATUSES.find((s) => s.key === st)?.label}</Text>
              <Icon name="down" size={11} color={p.textSecondary} />
            </TouchableOpacity>
          </View>

          {onListen && onLinkAudio && onImportAudio && (
            <AudiobookPart
              audiobook={audiobook}
              suggestion={audioSuggestion}
              choices={audioChoices}
              playing={audioPlaying}
              importing={audioImporting}
              bookFrac={pr}
              onListen={onListen}
              onLink={onLinkAudio}
              onImport={onImportAudio}
            />
          )}

          {history.totalMs >= 60_000 && (
            <>
              <Text style={styles.label}>Your time with it</Text>
              <View style={styles.figures}>
                {[
                  { n: history.todayMs, label: 'Today' },
                  { n: history.weekMs, label: 'Last 7 days' },
                  { n: history.totalMs, label: 'In all' },
                ].map((f) => (
                  <View key={f.label} style={styles.figure}>
                    <Text style={styles.figureNum}>{f.n >= 60_000 ? fmtTime(f.n) : '-'}</Text>
                    <Text style={styles.figureLabel}>{f.label}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.days}>
                {(allDays ? history.days : history.days.slice(0, 5)).map((d) => (
                  <View key={d.day} style={styles.dayRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.dayName}>{dayName(d.day, now)}</Text>
                      <Text style={styles.dayDetail} numberOfLines={1}>
                        {[
                          d.from !== null && d.to !== null && Math.round(d.to * 100) > Math.round(d.from * 100) ? `${fmtPct(d.from)} to ${fmtPct(d.to)}` : null,
                          d.readMs >= 60_000 && d.listenMs >= 60_000 ? `${fmtTime(d.readMs)} reading` : null,
                          d.listenMs >= 60_000 ? `${fmtTime(d.listenMs)} listening` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'Reading'}
                      </Text>
                    </View>
                    <Text style={styles.dayTime}>{fmtTime(d.readMs + d.listenMs)}</Text>
                  </View>
                ))}
                {history.days.length > 5 && (
                  <TouchableOpacity onPress={() => setAllDays((x) => !x)} style={styles.dayMore}>
                    <Text style={styles.link}>{allDays ? 'Fewer days' : `Show ${history.days.length - 5} more days`}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}

          <Text style={styles.label}>Keywords</Text>
          <View style={styles.tagWrap}>
            {book.tags.map((t) => (
              <TouchableOpacity key={t} style={styles.tag} onPress={() => void actions.removeTag([book.id], t).catch(failed)} accessibilityLabel={`Remove keyword ${t}`}>
                <Text style={styles.tagText}>#{t}</Text>
                <Icon name="close" size={10} color={p.textSecondary} />
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.tag, styles.tagAdd]} onPress={() => setSheet('tag')}>
              <Icon name="plus" size={11} color={p.link} />
              <Text style={[styles.tagText, styles.link]}>Add</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Notes</Text>
          <TextInput
            style={styles.notes}
            value={notes}
            onChangeText={setNotes}
            onBlur={saveNotes}
            onEndEditing={saveNotes}
            placeholder="What you thought, who recommended it, which translation…"
            placeholderTextColor={p.textMuted}
            multiline
            textAlignVertical="top"
          />

          {(highlights.length > 0 || bookmarks.length > 0) && (
            <>
              <Text style={styles.label}>
                {highlights.length ? `${highlights.length} ${highlights.length === 1 ? 'highlight' : 'highlights'}` : ''}
                {highlights.length && bookmarks.length ? ' · ' : ''}
                {bookmarks.length ? `${bookmarks.length} ${bookmarks.length === 1 ? 'bookmark' : 'bookmarks'}` : ''}
              </Text>
              <View style={styles.marks}>
                {[...marks].sort((a, b) => a.chapter - b.chapter || a.block - b.block).map((m) => (
                  <MarkRow key={m.id} m={m} />
                ))}
              </View>
            </>
          )}

          {!!about && (
            <>
              <Text style={styles.label}>About the book</Text>
              <Text style={styles.about} numberOfLines={aboutOpen ? undefined : 6} onPress={() => setAboutOpen((x) => !x)}>
                {about}
              </Text>
            </>
          )}

          <View style={styles.rows}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Private</Text>
              <Switch value={book.isPrivate} onValueChange={(v) => void actions.setPrivate([book.id], v).catch(failed)} />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>File</Text>
              <Text style={styles.rowValue} numberOfLines={1}>
                {book.filename} · {fmtSize(book.size)}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Added</Text>
              <Text style={styles.rowValue}>{new Date(book.addedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
            </View>
            <TouchableOpacity
              style={styles.row}
              onPress={() => {
                actions.trash([book.id]).catch(failed);
                onClose();
              }}>
              <Text style={[styles.rowLabel, { color: p.danger }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>

      {sheetOpen === 'rate' && <RatingPicker value={book.rating || null} onPick={(r) => void actions.rate([book.id], r ?? 0).catch(failed)} onClose={() => setSheet(null)} />}
      {sheetOpen === 'status' && (
        <OptionsSheet
          title="Status"
          options={[
            ...BOOK_STATUSES.map((s) => ({ label: s.label, hint: book.status === s.key ? '✓' : undefined, onPress: () => void actions.setStatus([book.id], s.key).catch(failed) })),
            { label: 'From my reading', hint: book.status === null ? '✓' : undefined, onPress: () => void actions.setStatus([book.id], null).catch(failed) },
          ]}
          onClose={() => setSheet(null)}
        />
      )}
      {sheetOpen === 'tag' && (
        <PromptSheet
          title="Add a keyword"
          message={tags.filter((t) => !book.tags.includes(t)).length ? `On your shelf: ${tags.filter((t) => !book.tags.includes(t)).slice(0, 8).join(', ')}` : undefined}
          placeholder="e.g. Russian, classics, book club"
          confirmLabel="Add"
          onSubmit={(t) => void actions.addTag([book.id], t).catch(failed)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheetOpen === 'title' && <PromptSheet title="Title" initial={displayTitle(book)} onSubmit={(t) => void actions.edit(book.id, t, book.author).catch(failed)} onClose={() => setSheet(null)} />}
      {sheetOpen === 'author' && <PromptSheet title="Author" initial={book.author ?? ''} placeholder="Fyodor Dostoevsky" onSubmit={(a) => void actions.edit(book.id, book.title, a).catch(failed)} onClose={() => setSheet(null)} />}
      {sheetOpen === 'cover' && (
        <OptionsSheet
          title="Cover"
          options={[
            { label: 'A picture from Files', onPress: () => void actions.setCover(book.id).catch(failed) },
            { label: "The book's own cover", onPress: () => void actions.setCover(book.id, true).catch(failed) },
          ]}
          onClose={() => setSheet(null)}
        />
      )}
      {markFor && (
        <OptionsSheet
          title={markFor.kind === 'highlight' ? 'Highlight' : 'Bookmark'}
          options={[
            { label: 'Read from here', onPress: () => onRead({ chapter: markFor.chapter, block: markFor.block }) },
            { label: markFor.note ? 'Edit the note' : 'Add a note', onPress: () => setTimeout(() => setNoteFor(markFor), 250) },
            {
              label: 'Remove',
              danger: true,
              onPress: () => {
                setMarks((l) => l.filter((x) => x.id !== markFor.id));
                actions.deleteMark(markFor.id).catch(failed);
              },
            },
          ]}
          onClose={() => setMarkFor(null)}
        />
      )}
      {noteFor && (
        <PromptSheet
          title="Note"
          initial={noteFor.note ?? ''}
          placeholder="Why this line"
          onSubmit={(n) => {
            setMarks((l) => l.map((x) => (x.id === noteFor.id ? { ...x, note: n } : x)));
            actions.setMarkNote(noteFor.id, n).catch(failed);
          }}
          onClose={() => setNoteFor(null)}
        />
      )}
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
    circle: { width: 34, height: 34, borderRadius: 17, backgroundColor: p.elevated, alignItems: 'center', justifyContent: 'center' },
    readBtn: { backgroundColor: p.text, borderRadius: 999, paddingHorizontal: 18, height: 36, justifyContent: 'center' },
    readText: { color: p.bg, fontSize: 15, fontWeight: '700' },
    body: { paddingHorizontal: 20, paddingTop: 10 },
    top: { flexDirection: 'row', gap: 18 },
    coverHint: { color: p.link, fontSize: 12, textAlign: 'center', marginTop: 6 },
    title: { color: p.text, fontSize: 24, lineHeight: 29, fontWeight: '700', fontFamily: SERIF },
    author: { color: p.textSecondary, fontSize: 15 },
    link: { color: p.link },
    meta: { color: p.textSecondary, fontSize: 13, marginTop: 8, fontVariant: ['tabular-nums'] },
    bar: { height: 3, borderRadius: 2, backgroundColor: p.elevated, overflow: 'hidden' },
    barFill: { height: 3, backgroundColor: p.accent },
    pills: { flexDirection: 'row', gap: 10, marginTop: 20 },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 16, height: 38 },
    pillText: { color: p.text, fontSize: 15, fontWeight: '700' },
    label: { color: p.textSecondary, fontSize: 13, fontWeight: '700', marginTop: 26, marginBottom: 10 },
    figures: { flexDirection: 'row', gap: 10 },
    figure: { flex: 1, gap: 2 },
    figureNum: { color: p.text, fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
    figureLabel: { color: p.textSecondary, fontSize: 12 },
    days: { marginTop: 14, borderTopWidth: 1, borderTopColor: p.separator },
    dayRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: p.separator },
    dayName: { color: p.text, fontSize: 15, fontWeight: '600' },
    dayDetail: { color: p.textSecondary, fontSize: 13, marginTop: 2, fontVariant: ['tabular-nums'] },
    dayTime: { color: p.text, fontSize: 15, fontVariant: ['tabular-nums'] },
    dayMore: { paddingVertical: 12 },
    tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 12, height: 32 },
    tagAdd: { backgroundColor: 'transparent', borderWidth: 1, borderColor: p.border },
    tagText: { color: p.text, fontSize: 14, fontWeight: '600' },
    notes: { minHeight: 96, backgroundColor: p.elevated, borderRadius: 12, padding: 12, paddingTop: 12, color: p.text, fontSize: 15, lineHeight: 21 },
    marks: { gap: 18 },
    mark: { flexDirection: 'row', gap: 12 },
    markRule: { width: 3, borderRadius: 2, backgroundColor: p.rating },
    markRuleBookmark: { backgroundColor: p.accent },
    markWhere: { color: p.textSecondary, fontSize: 12, fontWeight: '600' },
    markText: { color: p.text, fontSize: 16, lineHeight: 23, fontFamily: SERIF },
    markPlain: { color: p.textSoft, fontSize: 15 },
    markNote: { color: p.textSecondary, fontSize: 14, lineHeight: 20, fontStyle: 'italic' },
    about: { color: p.textSoft, fontSize: 15, lineHeight: 22 },
    rows: { marginTop: 28, backgroundColor: p.elevated, borderRadius: 14, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, minHeight: 48, borderBottomWidth: 1, borderBottomColor: p.separator },
    rowLabel: { color: p.text, fontSize: 15 },
    rowValue: { flexShrink: 1, color: p.textSecondary, fontSize: 14 },
  });
