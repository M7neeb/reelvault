/**
 * "Find on a source": links a title in your library (one from a backup, or
 * your own files) to the same title on a source, so its chapters can be read
 * online, downloaded and checked for new ones. Your read marks stay: chapters
 * are matched by number. Presentational only.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { SourceInfo, SourceSeries } from '../../manga/sources/types';
import { success } from '../haptics';
import Icon from '../Icon';
import { SheetFrame } from '../sheets';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import MangaCover from './MangaCover';
import type { BrowseActions, MangaActions, MangaUiSeries } from './mangaTypes';

export default function LinkSheet({ series, browse, actions, hint, onClose }: { series: MangaUiSeries; browse: BrowseActions; actions: MangaActions; hint?: string | null; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [sources, setSources] = useState<SourceInfo[] | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [query, setQuery] = useState(series.title);
  const [results, setResults] = useState<SourceSeries[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    browse
      .groups()
      .then((g) => {
        const list = g.flatMap((x) => x.items);
        setSources(list);
        // A source with the backup's source name first (e.g. the same extension on your Suwayomi server).
        const guess = hint ? list.find((s) => s.name.toLowerCase().includes(hint.toLowerCase())) : null;
        setSourceId((guess ?? list[0])?.id ?? null);
      })
      .catch((e) => setMessage(String(e).replace(/^Error:\s*/, '')));
  }, [browse, hint]);

  const search = async () => {
    const src = sourceId ? browse.source(sourceId) : null;
    if (!src || !query.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      setResults((await src.search(query.trim(), 1)).items.filter((x) => !x.folder));
    } catch (e) {
      setMessage(String(e).replace(/^Error:\s*/, ''));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (sourceId) search();
  }, [sourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = async (hit: SourceSeries) => {
    if (!sourceId) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await actions.linkSeries(series.id, sourceId, hit.key);
      success();
      setMessage(`Linked. ${res.matched} of your chapters matched${res.added ? `, ${res.added} more added` : ''}. You can read, download and get new chapters now.`);
      setResults(null);
    } catch (e) {
      setMessage(String(e).replace(/^Error:\s*/, ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SheetFrame title="Find on a source" onClose={onClose}>
      <Text style={styles.hint}>Pick where to find "{series.title}". Your read marks stay: chapters are matched by number.</Text>
      {!sources ? (
        <ActivityIndicator color={p.textSecondary} />
      ) : !sources.length ? (
        <Text style={styles.hint}>No sources yet. Add MangaDex languages, your server or an extension in Browse.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {sources.map((s) => (
            <TouchableOpacity key={s.id} style={[styles.chip, sourceId === s.id && styles.chipOn]} onPress={() => setSourceId(s.id)}>
              <Text style={[styles.chipText, sourceId === s.id && styles.chipTextOn]} numberOfLines={1}>
                {s.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      <View style={styles.search}>
        <Icon name="search" size={15} color={p.textSecondary} />
        <TextInput value={query} onChangeText={setQuery} onSubmitEditing={search} returnKeyType="search" style={styles.input} placeholderTextColor={p.textMuted} placeholder="Title" autoCorrect={false} />
      </View>
      {busy && <ActivityIndicator color={p.textSecondary} />}
      {message && <Text style={styles.message}>{message}</Text>}
      {results && !results.length && !busy && <Text style={styles.hint}>Nothing found. Try another spelling or source.</Text>}
      {results?.slice(0, 20).map((r) => (
        <TouchableOpacity key={r.key} style={styles.row} onPress={() => link(r)} disabled={busy}>
          <MangaCover series={{ coverSource: r.cover, title: r.title }} width={44} radius={6} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {r.title}
            </Text>
            {!!r.author && <Text style={styles.meta}>{r.author}</Text>}
          </View>
          <Text style={styles.linkText}>Link</Text>
        </TouchableOpacity>
      ))}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    hint: { color: p.textSecondary, fontSize: 14, lineHeight: 20 },
    chip: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, maxWidth: 220 },
    chipOn: { backgroundColor: p.text },
    chipText: { color: p.text, fontSize: 14, fontWeight: '700' },
    chipTextOn: { color: p.bg },
    search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 12, height: 42 },
    input: { flex: 1, color: p.text, fontSize: 16 },
    message: { color: p.text, fontSize: 14, lineHeight: 20, backgroundColor: p.card, borderRadius: 12, padding: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: p.separator },
    rowTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    meta: { color: p.textSecondary, fontSize: 12 },
    linkText: { color: p.link, fontSize: 15, fontWeight: '800' },
  });
