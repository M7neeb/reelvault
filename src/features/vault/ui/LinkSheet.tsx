/**
 * Link one of your videos to a Simkl movie or episode. Once linked, playing it
 * in the viewer shows on Simkl as "watching now", and finishing it marks that
 * movie or episode watched. Presentational only: the Simkl calls come in
 * through `bridge`.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import Poster from '@/features/simkl/ui/Poster';
import type { CatalogEpisode, CatalogTitle, SimklBridge, SimklType, VideoLink } from '@/features/simkl/ui/types';
import { guessEpisode, guessQuery } from '@/features/simkl/linking';
import { episodeCode, groupBySeason } from '@/features/simkl/logic';

import { success, tick } from './haptics';
import Icon from './Icon';
import { Segment, SheetFrame } from './sheets';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

export default function LinkSheet({
  item,
  bridge,
  link,
  onChanged,
  onClose,
}: {
  item: VaultItem;
  bridge: SimklBridge;
  link: VideoLink | null;
  onChanged: () => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const guess = guessEpisode(item);
  const [type, setType] = useState<SimklType>(link?.type ?? (guess ? 'show' : 'movie'));
  const [query, setQuery] = useState(guessQuery(item));
  const [results, setResults] = useState<CatalogTitle[] | null>(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState<CatalogTitle | null>(null);
  const [episodes, setEpisodes] = useState<CatalogEpisode[] | null>(null);
  const [season, setSeason] = useState<number | null>(guess?.season ?? null);

  useEffect(() => {
    if (!query.trim() || !bridge.connected) return;
    let live = true;
    setResults(null);
    setError('');
    const t = setTimeout(() => {
      bridge
        .search(type, query.trim())
        .then((r) => live && setResults(r))
        .catch((e) => live && (setResults([]), setError(String(e?.message ?? e))));
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [bridge, type, query]);

  useEffect(() => {
    if (!title || title.type === 'movie') return;
    setEpisodes(null);
    bridge
      .loadEpisodes(title.type, title.simklId)
      .then(setEpisodes)
      .catch(() => setEpisodes([]));
  }, [bridge, title]);

  async function save(t: CatalogTitle, ep: { season: number; episode: number } | null) {
    await bridge.setLink(item.id, {
      simklId: t.simklId,
      type: t.type,
      title: t.title,
      year: t.year,
      poster: t.poster,
      season: ep?.season ?? null,
      episode: ep?.episode ?? null,
    });
    success();
    onChanged();
    onClose();
  }

  const seasons = episodes ? groupBySeason(episodes.filter((e) => !e.special)) : [];
  const shownSeason = seasons.find((s) => s.season === season) ?? seasons[0];

  return (
    <SheetFrame title="Link to Simkl" onClose={onClose}>
      {link && !title && (
        <View style={styles.current}>
          <Poster path={link.poster} title={link.title} width={44} height={65} radius={6} />
          <View style={{ flex: 1 }}>
            <Text style={styles.currentTitle} numberOfLines={1}>
              {link.title}
            </Text>
            <Text style={styles.currentSub}>
              {link.type === 'movie' ? (link.year ?? 'Movie') : episodeCode(link.type, link.season ?? 1, link.episode ?? 1)}
              {link.loggedAt ? ' · logged on Simkl' : ''}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.unlink}
            onPress={() =>
              void bridge.setLink(item.id, null).then(() => {
                onChanged();
                onClose();
              })
            }>
            <Text style={styles.unlinkText}>Unlink</Text>
          </TouchableOpacity>
        </View>
      )}
      <Text style={styles.hint}>
        Play it in ReelVault and it shows on Simkl as watching now; finish it (80 % or more) and the movie or episode is marked watched.
      </Text>

      {!bridge.connected ? (
        <Text style={styles.body}>Sign in to Simkl on the Movies, Shows or Anime tab first.</Text>
      ) : !title ? (
        <>
          <Segment
            options={[
              { key: 'movie', label: 'Movie' },
              { key: 'show', label: 'Show' },
              { key: 'anime', label: 'Anime' },
            ]}
            value={type}
            onChange={setType}
          />
          <View style={styles.search}>
            <Icon name="search" size={16} color={p.textMuted} />
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Title"
              placeholderTextColor={p.textMuted}
              autoCorrect={false}
              returnKeyType="search"
              keyboardAppearance={p.scheme}
              clearButtonMode="while-editing"
            />
          </View>
          {results === null && !!query.trim() ? (
            <ActivityIndicator color={p.textSecondary} />
          ) : (
            <View style={styles.group}>
              {(results ?? []).slice(0, 12).map((r, i) => (
                <TouchableOpacity
                  key={r.simklId}
                  style={[styles.row, i > 0 && styles.sep]}
                  onPress={() => {
                    tick();
                    if (r.type === 'movie') void save(r, null);
                    else setTitle(r);
                  }}>
                  <Poster path={r.poster} title={r.title} width={36} height={53} radius={5} size="_cm" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {r.title}
                    </Text>
                    <Text style={styles.rowSub}>{r.year ?? ''}</Text>
                  </View>
                  <Icon name={r.type === 'movie' ? 'link' : 'forward'} size={15} color={p.textMuted} />
                </TouchableOpacity>
              ))}
              {results?.length === 0 && <Text style={[styles.body, { padding: 14 }]}>{error || 'Nothing found on Simkl.'}</Text>}
            </View>
          )}
        </>
      ) : (
        <>
          <TouchableOpacity style={styles.back} onPress={() => setTitle(null)}>
            <Icon name="back" size={14} color={p.link} />
            <Text style={styles.backText}>{title.title}</Text>
          </TouchableOpacity>
          {episodes === null ? (
            <ActivityIndicator color={p.textSecondary} />
          ) : seasons.length === 0 ? (
            <Text style={styles.body}>Simkl has no episode list for this title.</Text>
          ) : (
            <>
              {seasons.length > 1 && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {seasons.map((s) => (
                    <TouchableOpacity
                      key={s.season}
                      style={[styles.pill, shownSeason?.season === s.season && styles.pillOn]}
                      onPress={() => setSeason(s.season)}>
                      <Text style={[styles.pillText, shownSeason?.season === s.season && styles.pillTextOn]}>{s.label}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <View style={styles.group}>
                {shownSeason?.episodes.map((e, i) => {
                  const guessed = guess?.season === e.season && guess?.episode === e.episode;
                  return (
                    <TouchableOpacity key={`${e.season}-${e.episode}`} style={[styles.row, i > 0 && styles.sep, guessed && styles.rowGuess]} onPress={() => void save(title, e)}>
                      <Text style={styles.code}>{episodeCode(title.type, e.season, e.episode)}</Text>
                      <Text style={[styles.rowTitle, { flex: 1 }]} numberOfLines={1}>
                        {e.title ?? `Episode ${e.episode}`}
                      </Text>
                      {guessed && <Text style={styles.guessTag}>From file name</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}
        </>
      )}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    hint: { color: p.textSecondary, fontSize: 12 },
    body: { color: p.textSoft, fontSize: 14 },
    current: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.card, borderRadius: 14, padding: 10 },
    currentTitle: { color: p.text, fontSize: 16, fontWeight: '700' },
    currentSub: { color: p.textSecondary, fontSize: 13 },
    unlink: { backgroundColor: p.panel, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    unlinkText: { color: p.dangerText, fontWeight: '700', fontSize: 13 },
    search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 12 },
    input: { flex: 1, color: p.text, fontSize: 16, paddingVertical: 11 },
    group: { backgroundColor: p.card, borderRadius: 14, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 9 },
    rowGuess: { backgroundColor: p.accentSoft },
    sep: { borderTopWidth: 1, borderTopColor: p.separator },
    rowTitle: { color: p.text, fontSize: 15, fontWeight: '600' },
    rowSub: { color: p.textSecondary, fontSize: 12 },
    code: { color: p.link, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'], width: 62 },
    guessTag: { color: p.accent, fontSize: 11, fontWeight: '700' },
    back: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    backText: { color: p.link, fontSize: 15, fontWeight: '700' },
    pill: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
    pillOn: { backgroundColor: p.accent },
    pillText: { color: p.textSoft, fontWeight: '700', fontSize: 13 },
    pillTextOn: { color: '#fff' },
  });
