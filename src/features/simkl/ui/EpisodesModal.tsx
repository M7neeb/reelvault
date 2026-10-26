/**
 * "Mark specific episodes": season pills, then that season's episodes with
 * their stills (with the episode's IMDb or TVmaze rating), checkmarks, "Mark all aired" and "Unmark". With spoilers
 * hidden, episodes you have not seen show no title or picture. Two modes:
 * - history: your Simkl watch history; hold an episode to log watching it again;
 * - rewatch: one rewatch session ("Rewatch #2"), with its own checkmarks.
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Modal } from '@/features/vault/ui/screen';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmAction } from '@/features/vault/ui/confirm';
import { tick } from '@/features/vault/ui/haptics';
import Icon from '@/features/vault/ui/Icon';
import IconButton from '@/features/vault/ui/IconButton';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { fmtEpisodeRating, type EpisodeRatings } from '../episodeRatings';
import { watchCounts } from '../insights';
import { episodeCode, episodeImageUrl, finaleLabel, fmtMinutes, groupBySeason, minutesLeft, parseEpisodeCode, upToHere, watchedKey } from '../logic';
import { fmtDay } from './time';
import type { CatalogEpisode, Play, Session, SimklActions, SimklItem } from './types';

export default function EpisodesModal({
  item,
  actions,
  session = null,
  hideSpoilers = false,
  onFinishSession,
  onClose,
}: {
  item: SimklItem;
  actions: SimklActions;
  /** No titles or stills for episodes you have not watched. */
  hideSpoilers?: boolean;
  /** Set = rewatch mode for this session. */
  session?: Session | null;
  onFinishSession?: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [episodes, setEpisodes] = useState<CatalogEpisode[] | null>(null);
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [openSeason, setOpenSeason] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [plays, setPlays] = useState<Play[]>([]);
  const [ratings, setRatings] = useState<EpisodeRatings>({});
  const rewatch = session !== null;

  useEffect(() => {
    actions
      .loadEpisodes(item.type, item.simklId)
      .then(setEpisodes)
      .catch((e) => {
        setEpisodes([]);
        setNote(String(e?.message ?? e));
      });
    actions
      .loadWatched(item.simklId)
      .then((rows) => setWatched(new Set(rows.map((r) => watchedKey(r.season, r.episode)))))
      .catch(() => undefined);
    actions
      .loadPlays(item.simklId)
      .then(setPlays)
      .catch(() => undefined);
  }, [actions, item.simklId, item.type]);

  // Ratings arrive after the list; without them the pictures just have no badge.
  useEffect(() => {
    if (!episodes?.length) return;
    let live = true;
    actions
      .loadEpisodeRatings(item.type, item.simklId, episodes)
      .then((r) => live && setRatings(r))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [actions, episodes, item.simklId, item.type]);

  const counts = useMemo(() => watchCounts(watched, plays), [watched, plays]);
  const inSession = useMemo(
    () => new Set(plays.filter((p) => session && p.sessionId === session.id).map((p) => watchedKey(p.season, p.episode))),
    [plays, session]
  );
  const checked = rewatch ? inSession : watched;

  /** Rewatch mode: tick / untick inside the session. History mode: hold = watched again. */
  function rewatchToggle(eps: { season: number; episode: number }[], on: boolean, inThisSession: Session | null) {
    const stamp = new Date().toISOString();
    const before = plays;
    setPlays(
      on
        ? [...plays, ...eps.map((e, n) => ({ id: -Date.now() - n, simklId: item.simklId, season: e.season, episode: e.episode, watchedAt: stamp, sessionId: inThisSession?.id ?? null }))]
        : plays.filter((p) => !(p.sessionId === (inThisSession?.id ?? null) && eps.some((e) => e.season === p.season && e.episode === p.episode)))
    );
    setNote(on && !inThisSession ? `Logged ${eps.length === 1 ? 'a rewatch' : `${eps.length} rewatches`}` : '');
    actions.logRewatch(item, eps, inThisSession, on).catch((e) => {
      setPlays(before);
      setNote(`Not saved: ${e?.message ?? String(e)}`);
    });
  }

  const seasons = useMemo(() => groupBySeason(episodes ?? []), [episodes]);
  const next = parseEpisodeCode(item.nextToWatch);
  const shownSeason = openSeason ?? next?.season ?? seasons[0]?.season ?? null;

  function toggle(eps: { season: number; episode: number }[], on: boolean) {
    if (!eps.length) return;
    tick();
    if (rewatch) {
      // Only the ones that change, so "Mark all aired" does not log doubles.
      const change = eps.filter((e) => inSession.has(watchedKey(e.season, e.episode)) !== on);
      if (change.length) rewatchToggle(change, on, session);
      return;
    }
    const before = watched;
    const after = new Set(watched);
    for (const e of eps) {
      const k = watchedKey(e.season, e.episode);
      if (on) after.add(k);
      else after.delete(k);
    }
    setWatched(after);
    setNote('');
    actions.setEpisodes(item, eps, on).catch((e) => {
      setWatched(before);
      setNote(`Not saved: ${e?.message ?? String(e)}`);
    });
  }

  const season = seasons.find((s) => s.season === shownSeason) ?? seasons[0];
  const totalEps = item.totalEpisodes || episodes?.length || 0;
  // Time left to finish, with each episode's own length (or the show's usual one).
  const left = useMemo(() => minutesLeft(episodes ?? [], watched, item.runtime), [episodes, watched, item.runtime]);

  /** Hold an episode you have not watched: everything up to it (all seasons before too) is marked watched. */
  function markUpTo(e: { season: number; episode: number }, code: string) {
    const eps = upToHere(episodes ?? [], e).filter((x) => !watched.has(watchedKey(x.season, x.episode)));
    if (!eps.length) return;
    confirmAction(`Watched up to ${code}?`, `Marks ${eps.length} ${eps.length === 1 ? 'episode' : 'episodes'} watched on Simkl.`, () => toggle(eps, true), {
      label: 'Mark watched',
    });
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <View style={styles.header}>
          <IconButton icon="back" label="Close" onPress={onClose} />
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>
              {rewatch ? `Rewatch #${session!.number}` : item.title}
            </Text>
            <Text style={styles.sub}>
              {rewatch
                ? `${item.title} · ${inSession.size} of ${totalEps || '?'}`
                : `${watched.size} of ${totalEps || '?'} watched${left.episodes > 0 && left.minutes > 0 ? ` · ${left.guessed ? 'about ' : ''}${fmtMinutes(left.minutes)} left` : ''}`}
            </Text>
          </View>
          {rewatch && onFinishSession && (
            <TouchableOpacity style={styles.finish} onPress={onFinishSession}>
              <Text style={styles.finishText}>Finish</Text>
            </TouchableOpacity>
          )}
        </View>

        {seasons.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills} style={styles.pillBar}>
            {seasons.map((s) => {
              const on = s.season === season?.season;
              const done = s.episodes.filter((e) => checked.has(watchedKey(e.season, e.episode))).length;
              const all = done === s.episodes.length && done > 0;
              return (
                <TouchableOpacity key={s.season} style={[styles.pill, on && styles.pillOn]} onPress={() => setOpenSeason(s.season)}>
                  {all && <Icon name="check" size={12} color={on ? '#fff' : p.success} weight="bold" />}
                  <Text style={[styles.pillText, on && styles.pillTextOn]}>{s.season === 0 ? 'Specials' : `Season ${s.season}`}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        {!!note && <Text style={styles.note}>{note}</Text>}

        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
          {episodes === null ? (
            <ActivityIndicator color={p.textSecondary} style={{ marginTop: 30 }} />
          ) : !season ? (
            <Text style={styles.empty}>Simkl has no episode list for this title.</Text>
          ) : (
            (() => {
              const s = season;
              const aired = s.episodes.filter((e) => e.aired);
              const done = s.episodes.filter((e) => checked.has(watchedKey(e.season, e.episode))).length;
              return (
                <>
                  <View style={styles.seasonCard}>
                    <View style={styles.seasonHead}>
                      <Text style={styles.seasonTitle}>{s.label}</Text>
                      <Text style={styles.seasonCount}>
                        {done} of {s.episodes.length}
                      </Text>
                    </View>
                    <View style={styles.seasonTrack}>
                      <View style={[styles.seasonFill, { width: `${s.episodes.length ? (done / s.episodes.length) * 100 : 0}%` }]} />
                    </View>
                    <View style={styles.actions}>
                      <TouchableOpacity style={styles.action} onPress={() => toggle(aired, true)}>
                        <Icon name="checkCircle" size={14} color={p.accent} />
                        <Text style={styles.actionText}>Mark all aired</Text>
                      </TouchableOpacity>
                      {done > 0 && (
                        <TouchableOpacity
                          style={styles.action}
                          onPress={() =>
                            confirmAction(
                              `Unmark ${s.label}?`,
                              rewatch ? 'Removes these episodes from this rewatch.' : 'Removes these episodes from your Simkl watch history.',
                              () => toggle(s.episodes, false),
                              { label: 'Unmark', destructive: true }
                            )
                          }>
                          <Icon name="rewatch" size={14} color={p.textSecondary} />
                          <Text style={styles.actionText}>Unmark</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {!rewatch && <Text style={styles.tip}>Hold an episode you haven't watched to mark everything up to it; hold one you watched to log watching it again.</Text>}
                  </View>

                  {s.episodes.map((e) => {
                    const key = watchedKey(e.season, e.episode);
                    const on = checked.has(key);
                    const seen = watched.has(key);
                    const isNext = !rewatch && next?.season === e.season && next?.episode === e.episode;
                    const times = counts.get(key) ?? 0;
                    const hidden = hideSpoilers && !seen && e.aired;
                    const still = episodeImageUrl(e.img);
                    const rated = hidden ? undefined : ratings[key];
                    const code = e.special ? `SP${e.episode}` : episodeCode(item.type, e.season, e.episode);
                    return (
                      <TouchableOpacity
                        key={`${e.season}-${e.episode}`}
                        style={[styles.episode, isNext && styles.episodeNext]}
                        disabled={!e.aired && !on}
                        onPress={() => toggle([e], !on)}
                        onLongPress={() => {
                          if (rewatch) return;
                          if (seen) rewatchToggle([e], true, null);
                          else if (e.aired && !e.special) markUpTo(e, code);
                        }}
                        accessibilityLabel={`${code} ${hidden ? '' : (e.title ?? '')}`}>
                        <View style={styles.still}>
                          {still ? (
                            <Image source={{ uri: still }} style={styles.stillImg} contentFit="cover" blurRadius={hidden ? 40 : 0} transition={120} />
                          ) : (
                            <View style={[styles.stillImg, styles.stillEmpty]}>
                              <Icon name="tv" size={18} color={p.textMuted} />
                            </View>
                          )}
                          {hidden && (
                            <View style={styles.stillCover}>
                              <Icon name="spoiler" size={16} color="#fff" />
                            </View>
                          )}
                          {rated && (
                            <View
                              style={styles.rated}
                              accessibilityLabel={`${rated.source === 'imdb' ? 'IMDb' : 'TVmaze'} rating ${fmtEpisodeRating(rated.rating)}`}>
                              {rated.source === 'imdb' ? (
                                <Text style={styles.imdbTag}>IMDb</Text>
                              ) : (
                                <Icon name="star" size={10} color={p.rating} />
                              )}
                              <Text style={styles.ratedText}>{fmtEpisodeRating(rated.rating)}</Text>
                            </View>
                          )}
                          {times > 1 && (
                            <View style={styles.times}>
                              <Text style={styles.timesText}>×{times}</Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.episodeText}>
                          <Text style={[styles.code, !e.aired && styles.unaired]}>
                            {code}
                            {isNext ? <Text style={styles.nextTag}>{'  UP NEXT'}</Text> : null}
                          </Text>
                          {!!finaleLabel(e.finale) && (
                            <View style={[styles.finale, e.finale === 3 && styles.finaleSeries]}>
                              <Text style={[styles.finaleText, e.finale === 3 && styles.finaleTextSeries]}>{finaleLabel(e.finale)!.toUpperCase()}</Text>
                            </View>
                          )}
                          <Text style={[styles.episodeTitle, !e.aired && styles.unaired]} numberOfLines={2}>
                            {hidden ? `Episode ${e.episode}` : (e.title ?? `Episode ${e.episode}`)}
                          </Text>
                          {(!!e.date || !!e.runtime) && (
                            <Text style={styles.episodeDate}>
                              {e.date ? `${e.aired ? '' : 'Airs '}${fmtDay(e.date)}` : ''}
                              {e.date && e.runtime ? ' · ' : ''}
                              {e.runtime ? `${e.runtime} min` : ''}
                            </Text>
                          )}
                        </View>
                        <View style={[styles.check, on && styles.checkOn, !e.aired && !on && { opacity: 0.3 }]}>
                          {on && <Icon name="check" size={14} color="#fff" weight="bold" />}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </>
              );
            })()
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 10 },
    headerText: { flex: 1 },
    title: { color: p.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
    sub: { color: p.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
    note: { color: p.link, fontSize: 13, fontWeight: '600', paddingHorizontal: 16, paddingBottom: 4 },
    tip: { color: p.textSecondary, fontSize: 12 },
    finish: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
    finishText: { color: '#fff', fontWeight: '800' },
    pillBar: { flexGrow: 0 },
    pills: { gap: 8, paddingHorizontal: 14, paddingBottom: 10 },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    pillOn: { backgroundColor: p.accent },
    pillText: { color: p.textSoft, fontSize: 14, fontWeight: '700' },
    pillTextOn: { color: '#fff' },
    body: { paddingHorizontal: 14, gap: 2 },
    empty: { color: p.textSecondary, textAlign: 'center', marginTop: 30 },
    seasonCard: { backgroundColor: p.elevated, borderRadius: 16, padding: 14, gap: 10, marginBottom: 8 },
    seasonHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    seasonTitle: { color: p.text, fontSize: 18, fontWeight: '800' },
    seasonCount: { color: p.textSecondary, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
    seasonTrack: { height: 6, borderRadius: 3, backgroundColor: p.card, overflow: 'hidden' },
    seasonFill: { height: 6, borderRadius: 3, backgroundColor: p.accent },
    actions: { flexDirection: 'row', gap: 8 },
    action: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    actionText: { color: p.textSoft, fontSize: 13, fontWeight: '600' },
    episode: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 14 },
    episodeNext: { backgroundColor: p.accentSoft },
    still: { width: 118, height: 66, borderRadius: 10, overflow: 'hidden', backgroundColor: p.elevated },
    stillImg: { width: 118, height: 66 },
    stillEmpty: { alignItems: 'center', justifyContent: 'center' },
    stillCover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
    times: { position: 'absolute', right: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
    timesText: { color: p.rating, fontSize: 11, fontWeight: '800' },
    rated: {
      position: 'absolute',
      left: 4,
      top: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(0,0,0,0.72)',
      borderRadius: 6,
      paddingLeft: 3,
      paddingRight: 5,
      paddingVertical: 2,
    },
    imdbTag: { backgroundColor: '#F5C518', color: '#000', fontSize: 9, fontWeight: '900', borderRadius: 3, overflow: 'hidden', paddingHorizontal: 3, paddingVertical: 0.5 },
    ratedText: { color: '#fff', fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
    episodeText: { flex: 1, gap: 1 },
    code: { color: p.link, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: 0.3 },
    nextTag: { color: p.accent, fontSize: 11, fontWeight: '900' },
    finale: { alignSelf: 'flex-start', backgroundColor: p.accentSoft, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1, marginVertical: 1 },
    finaleSeries: { backgroundColor: p.accent },
    finaleText: { color: p.accent, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
    finaleTextSeries: { color: '#fff' },
    episodeTitle: { color: p.text, fontSize: 15, fontWeight: '600' },
    unaired: { color: p.textMuted },
    episodeDate: { color: p.textSecondary, fontSize: 12 },
    check: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: p.textMuted, alignItems: 'center', justifyContent: 'center' },
    checkOn: { backgroundColor: p.accent, borderColor: p.accent },
  });
