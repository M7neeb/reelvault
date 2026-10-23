/**
 * A title on a source before (or after) it is in your library: cover, who
 * made it, what it is about, its chapters with the groups that translated
 * them, "Add to library", and reading any chapter online right away.
 * Presentational only (see types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { chapterLabel, type MangaChapter } from '../../manga/mangaLogic';
import type { MangaSource, SourceChapter, SourceDetails } from '../../manga/sources/types';
import { fmtDateTime } from '../format';
import { success } from '../haptics';
import Icon from '../Icon';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import MangaCover from './MangaCover';
import MangaReader from './MangaReader';
import type { BrowseActions, MangaUiSeries } from './mangaTypes';

/** A title from a source as a temporary series, so the reader can show it without adding it. */
function asSeries(source: MangaSource, d: SourceDetails, chapters: SourceChapter[]): MangaUiSeries {
  const now = Date.now();
  return {
    id: `preview:${source.id}:${d.key}`,
    folder: '',
    title: d.title,
    altTitle: d.altTitles[0] ?? null,
    author: d.author ?? null,
    artist: d.artist,
    description: d.description,
    kind: d.kind,
    pubStatus: d.pubStatus,
    status: null,
    rating: 0,
    notes: null,
    cover: null,
    isPrivate: false,
    readingMode: null,
    sourceId: source.id,
    sourceKey: d.key,
    sourceUrl: d.webUrl,
    createdAt: now,
    importedAt: now,
    lastReadAt: null,
    finishedAt: null,
    deletedAt: null,
    tags: d.genres,
    coverSource: d.cover,
    chapters: chapters.map(
      (c, i): MangaChapter => ({
        id: `preview:${c.key}`,
        seriesId: '',
        folder: null,
        number: c.number,
        volume: c.volume,
        title: c.title,
        filename: null,
        pages: [],
        pageCount: c.pageCount ?? 0,
        size: 0,
        contentKey: null,
        sourceKey: c.key,
        sourceUrl: c.externalUrl,
        scanlator: c.scanlator,
        uploadedAt: c.uploadedAt,
        addedAt: now,
        readAt: null,
        lastPage: 0,
        downloaded: false,
        position: i,
      })
    ),
  };
}

export default function SourcePreview({
  source,
  seriesKey,
  inLibraryId,
  browse,
  onOpenInLibrary,
  onClose,
}: {
  source: MangaSource;
  seriesKey: string;
  /** The library series this title already is, if any. */
  inLibraryId: string | null;
  browse: BrowseActions;
  onOpenInLibrary: (seriesId: string) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [details, setDetails] = useState<SourceDetails | null>(null);
  const [chapters, setChapters] = useState<SourceChapter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [libraryId, setLibraryId] = useState(inLibraryId);
  const [reading, setReading] = useState<string | null>(null);
  const [newestFirst, setNewestFirst] = useState(false);
  const [more, setMore] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setError(null);
    Promise.all([source.details(seriesKey), source.chapters(seriesKey)])
      .then(([d, c]) => {
        if (!live) return;
        setDetails(d);
        setChapters(c);
      })
      .catch((e) => live && setError(String(e).replace(/^Error:\s*/, '')));
    return () => {
      live = false;
    };
  }, [source, seriesKey, attempt]);

  const temp = useMemo(() => (details && chapters ? asSeries(source, details, chapters) : null), [source, details, chapters]);
  const shown = useMemo(() => (temp ? (newestFirst ? [...temp.chapters].reverse() : temp.chapters) : []), [temp, newestFirst]);
  const readable = temp?.chapters.filter((c) => !c.sourceUrl) ?? [];
  const readChapter = reading ? (temp?.chapters.find((c) => c.id === reading) ?? null) : null;

  const add = async () => {
    if (!details || !chapters || adding) return;
    setAdding(true);
    try {
      const id = await browse.addToLibrary(source.id, details, chapters);
      success();
      setLibraryId(id);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''));
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
          <View style={styles.hero}>
            {details?.cover ? <Image source={details.cover} style={styles.heroBg} contentFit="cover" blurRadius={40} /> : null}
            <View style={styles.heroShade} />
            <View style={[styles.heroBar, { paddingTop: insets.top + 6 }]}>
              <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Back">
                <Icon name="back" size={16} color="#fff" weight="bold" />
              </TouchableOpacity>
              <Text style={styles.from} numberOfLines={1}>
                {source.name}
              </Text>
            </View>
            <View style={styles.heroRow}>
              <MangaCover series={{ coverSource: details?.cover ?? null, title: details?.title ?? '…' }} width={112} radius={12} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.heroTitle} numberOfLines={4}>
                  {details?.title ?? (error ? 'Could not load' : 'Loading…')}
                </Text>
                {!!(details?.author || details?.artist) && (
                  <Text style={styles.heroSub} numberOfLines={2}>
                    {[details?.author, details?.artist && details.artist !== details.author ? details.artist : null].filter(Boolean).join(' · ')}
                  </Text>
                )}
                {chapters && (
                  <Text style={styles.heroFacts}>
                    {chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'}
                    {details?.pubStatus ? ` · ${details.pubStatus}` : ''}
                  </Text>
                )}
              </View>
            </View>
          </View>

          <View style={styles.body}>
            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.secondary} onPress={() => setAttempt((n) => n + 1)}>
                  <Text style={styles.secondaryText}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : !details || !chapters ? (
              <ActivityIndicator style={{ marginTop: 30 }} color={p.textSecondary} />
            ) : (
              <>
                <View style={styles.buttons}>
                  {libraryId ? (
                    <TouchableOpacity style={styles.primary} onPress={() => onOpenInLibrary(libraryId)}>
                      <Icon name="checkCircle" size={17} color="#fff" />
                      <Text style={styles.primaryText}>In your library · Open</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.primary} onPress={add} disabled={adding}>
                      {adding ? <ActivityIndicator color="#fff" /> : <Icon name="plus" size={17} color="#fff" />}
                      <Text style={styles.primaryText}>Add to library</Text>
                    </TouchableOpacity>
                  )}
                  {readable[0] && (
                    <TouchableOpacity style={styles.secondary} onPress={() => setReading(readable[0].id)}>
                      <Icon name="bookOpen" size={15} color={p.text} />
                      <Text style={styles.secondaryText}>Read</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {!!details.genres.length && (
                  <View style={styles.chips}>
                    {details.genres.slice(0, 10).map((g) => (
                      <View key={g} style={styles.chip}>
                        <Text style={styles.chipText}>{g}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {!!details.description && (
                  <TouchableOpacity onPress={() => setMore((x) => !x)} activeOpacity={0.8}>
                    <Text style={styles.about} numberOfLines={more ? undefined : 4}>
                      {details.description}
                    </Text>
                  </TouchableOpacity>
                )}
                {details.webUrl && (
                  <TouchableOpacity onPress={() => browse.openUrl(details.webUrl!)} style={styles.link}>
                    <Icon name="open" size={13} color={p.link} />
                    <Text style={styles.linkText}>Open on {source.name}</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.chHead}>
                  <Text style={[styles.section, { flex: 1 }]}>Chapters</Text>
                  {chapters.length > 1 && (
                    <TouchableOpacity onPress={() => setNewestFirst((x) => !x)} style={styles.chSort}>
                      <Icon name="sort" size={12} color={p.textSecondary} />
                      <Text style={styles.chSortText}>{newestFirst ? 'Newest first' : 'First to last'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {!chapters.length ? (
                  <Text style={styles.about}>
                    No chapters in your languages here. On MangaDex that often means the title is licensed and its chapters were taken down; other languages may still have them (Browse settings).
                  </Text>
                ) : (
                  <View style={styles.chList}>
                    {shown.slice(0, 400).map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        style={styles.chRow}
                        onPress={() => (c.sourceUrl ? browse.openUrl(c.sourceUrl) : setReading(c.id))}
                        accessibilityLabel={chapterLabel(c)}>
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.chTitle} numberOfLines={2}>
                            {chapterLabel(c)}
                          </Text>
                          <Text style={styles.chMeta} numberOfLines={1}>
                            {[c.scanlator, c.uploadedAt ? fmtDateTime(c.uploadedAt).date : null, c.pageCount ? `${c.pageCount} pages` : null].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                        <Icon name={c.sourceUrl ? 'open' : 'bookOpen'} size={15} color={p.textSecondary} />
                      </TouchableOpacity>
                    ))}
                    {shown.length > 400 && <Text style={[styles.chMeta, { padding: 14 }]}>And {shown.length - 400} more: add it to your library to see them all.</Text>}
                  </View>
                )}
                <Text style={styles.credit}>From {source.name}. Translations belong to the groups named on each chapter.</Text>
              </>
            )}
          </View>
        </ScrollView>
      </View>
      {temp && readChapter && (
        <MangaReader
          key={readChapter.id}
          series={temp}
          chapter={readChapter}
          fromStart
          actions={{
            loadPages: (_s, c) => (c.sourceKey ? source.pages(c.sourceKey) : Promise.resolve([])),
            saveProgress: async () => undefined,
            addRead: async () => undefined,
            update: async () => undefined,
          }}
          onOpenUrl={browse.openUrl}
          onClose={() => setReading(null)}
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
    heroShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
    heroBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
    circle: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
    from: { flex: 1, color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '700' },
    heroRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 16, alignItems: 'flex-end' },
    heroTitle: { color: '#fff', fontSize: 23, fontWeight: '900', letterSpacing: -0.5 },
    heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600' },
    heroFacts: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
    body: { paddingHorizontal: 16, paddingTop: 16, gap: 10 },
    buttons: { flexDirection: 'row', gap: 10 },
    primary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: p.accent, borderRadius: 14, paddingVertical: 14 },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: p.card, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18 },
    secondaryText: { color: p.text, fontSize: 15, fontWeight: '800' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
    chipText: { color: p.textSoft, fontSize: 12, fontWeight: '700' },
    about: { color: p.textSoft, fontSize: 14, lineHeight: 20 },
    link: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
    linkText: { color: p.link, fontSize: 14, fontWeight: '700' },
    section: { color: p.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
    chHead: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
    chSort: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    chSortText: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    chList: { backgroundColor: p.card, borderRadius: 14, overflow: 'hidden' },
    chRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: p.separator },
    chTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    chMeta: { color: p.textSecondary, fontSize: 12 },
    credit: { color: p.textMuted, fontSize: 12, marginTop: 6 },
    errorBox: { backgroundColor: p.card, borderRadius: 14, padding: 14, gap: 10 },
    errorText: { color: p.text, fontSize: 14, lineHeight: 20 },
  });
