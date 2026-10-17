/**
 * "Mark specific episodes": every season with checkmarks, mark a season,
 * unmark a season. Two modes:
 * - history: your Simkl watch history; hold an episode to log watching it again;
 * - rewatch: one rewatch session ("Rewatch #2"), with its own checkmarks.
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmAction } from '@/features/vault/ui/confirm';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { watchCounts } from '../insights';
import { episodeCode, groupBySeason, parseEpisodeCode, watchedKey } from '../logic';
import { fmtDay } from './time';
import type { CatalogEpisode, Play, Session, SimklActions, SimklItem } from './types';

export default function EpisodesModal({
  item,
  actions,
  session = null,
  onFinishSession,
  onClose,
}: {
  item: SimklItem;
  actions: SimklActions;
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

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close">
            <Text style={styles.circleIcon}>‹</Text>
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.sub}>
              {rewatch ? `Rewatch #${session!.number} · ${inSession.size} of ${item.totalEpisodes || episodes?.length || '?'}` : `${watched.size} of ${item.totalEpisodes || episodes?.length || '?'} watched`}
            </Text>
          </View>
          {rewatch && onFinishSession && (
            <TouchableOpacity style={styles.finish} onPress={onFinishSession}>
              <Text style={styles.finishText}>Finish</Text>
            </TouchableOpacity>
          )}
        </View>
        {!!note && <Text style={styles.note}>{note}</Text>}
        {!rewatch && <Text style={styles.tip}>Hold an episode you watched to log watching it again.</Text>}
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
          {episodes === null ? (
            <ActivityIndicator color={p.textSecondary} />
          ) : seasons.length === 0 ? (
            <Text style={styles.empty}>Simkl has no episode list for this title.</Text>
          ) : (
            seasons.map((s) => {
              const aired = s.episodes.filter((e) => e.aired);
              const done = s.episodes.filter((e) => checked.has(watchedKey(e.season, e.episode))).length;
              const isOpen = shownSeason === s.season;
              return (
                <View key={s.season} style={styles.season}>
                  <TouchableOpacity style={styles.seasonHead} onPress={() => setOpenSeason(isOpen ? -1 : s.season)}>
                    <Text style={styles.seasonTitle}>{s.label}</Text>
                    <Text style={styles.seasonCount}>
                      {done}/{s.episodes.length} {isOpen ? '▾' : '▸'}
                    </Text>
                  </TouchableOpacity>
                  <View style={styles.seasonTrack}>
                    <View style={[styles.seasonFill, { width: `${s.episodes.length ? (done / s.episodes.length) * 100 : 0}%` }]} />
                  </View>
                  {isOpen && (
                    <>
                      <View style={styles.actions}>
                        <TouchableOpacity style={styles.action} onPress={() => toggle(aired, true)}>
                          <Text style={styles.actionText}>Mark all aired</Text>
                        </TouchableOpacity>
                        {done > 0 && (
                          <TouchableOpacity
                            style={styles.action}
                            onPress={() =>
                              confirmAction(
                                `Unmark ${s.label}?`,
                                'Removes these episodes from your Simkl watch history.',
                                () => toggle(s.episodes, false),
                                { label: 'Unmark', destructive: true }
                              )
                            }>
                            <Text style={styles.actionText}>Unmark</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                      {s.episodes.map((e) => {
                        const on = checked.has(watchedKey(e.season, e.episode));
                        const isNext = !rewatch && next?.season === e.season && next?.episode === e.episode;
                        const times = counts.get(watchedKey(e.season, e.episode)) ?? 0;
                        return (
                          <TouchableOpacity
                            key={`${e.season}-${e.episode}`}
                            style={[styles.episode, isNext && styles.episodeNext]}
                            disabled={!e.aired && !on}
                            onPress={() => toggle([e], !on)}
                            onLongPress={() => {
                              if (!rewatch && watched.has(watchedKey(e.season, e.episode))) rewatchToggle([e], true, null);
                            }}>
                            <View style={[styles.check, on && styles.checkOn]}>{on && <Text style={styles.checkMark}>✓</Text>}</View>
                            <View style={styles.episodeText}>
                              <Text style={[styles.episodeTitle, !e.aired && styles.unaired]} numberOfLines={1}>
                                <Text style={styles.code}>{e.special ? `SP${e.episode}` : episodeCode(item.type, e.season, e.episode)}</Text>
                                {e.title ? `  ${e.title}` : ''}
                              </Text>
                              {!!e.date && (
                                <Text style={styles.episodeDate}>
                                  {e.aired ? 'Aired ' : 'Airs '}
                                  {fmtDay(e.date)}
                                  {isNext ? '  ·  up next' : ''}
                                </Text>
                              )}
                            </View>
                            {times > 1 && (
                              <View style={styles.times}>
                                <Text style={styles.timesText}>×{times}</Text>
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  )}
                </View>
              );
            })
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
    circle: { width: 36, height: 36, borderRadius: 18, backgroundColor: p.circle, alignItems: 'center', justifyContent: 'center' },
    circleIcon: { color: p.icon, fontSize: 24, fontWeight: '600', marginTop: -3 },
    headerText: { flex: 1 },
    title: { color: p.text, fontSize: 19, fontWeight: '800' },
    sub: { color: p.textSecondary, fontSize: 13 },
    note: { color: p.link, fontSize: 13, fontWeight: '600', paddingHorizontal: 16 },
    tip: { color: p.textSecondary, fontSize: 12, paddingHorizontal: 16 },
    finish: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    finishText: { color: '#fff', fontWeight: '800' },
    times: { backgroundColor: p.card, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
    timesText: { color: p.rating, fontSize: 12, fontWeight: '800' },
    body: { padding: 14, gap: 10 },
    empty: { color: p.textSecondary, textAlign: 'center', marginTop: 30 },
    season: { backgroundColor: p.panel, borderRadius: 14, paddingHorizontal: 14, paddingBottom: 6 },
    seasonHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
    seasonTitle: { color: p.text, fontSize: 16, fontWeight: '700' },
    seasonCount: { color: p.textSecondary, fontSize: 14, fontVariant: ['tabular-nums'] },
    seasonTrack: { height: 3, borderRadius: 2, backgroundColor: p.card, overflow: 'hidden', marginBottom: 8 },
    seasonFill: { height: 3, backgroundColor: p.rating },
    actions: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
    action: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    actionText: { color: p.textSoft, fontSize: 13, fontWeight: '600' },
    episode: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: p.separator },
    episodeNext: { backgroundColor: p.accentSoft, marginHorizontal: -14, paddingHorizontal: 14 },
    check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: p.textMuted, alignItems: 'center', justifyContent: 'center' },
    checkOn: { backgroundColor: p.accent, borderColor: p.accent },
    checkMark: { color: '#fff', fontSize: 14, fontWeight: '800' },
    episodeText: { flex: 1 },
    episodeTitle: { color: p.text, fontSize: 15 },
    code: { color: p.link, fontWeight: '700', fontVariant: ['tabular-nums'] },
    unaired: { color: p.textMuted },
    episodeDate: { color: p.textSecondary, fontSize: 12, marginTop: 2 },
  });
