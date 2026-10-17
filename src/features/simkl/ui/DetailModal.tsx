/**
 * One movie, show or anime, styled after the Simkl app: a backdrop with the
 * years, language and title over it; a ratings row (Simkl + rank, IMDb or MAL,
 * yours); the main action ("Watched S02E04" / "I've seen this"); rows for the
 * trailer, the episodes, the list it is in and its Simkl page; then the
 * overview and "More like this".
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmAction } from '@/features/vault/ui/confirm';
import { OptionsSheet } from '@/features/vault/ui/prompts';
import RatingPicker from '@/features/vault/ui/RatingPicker';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { episodesLeft, fanartUrl, fmtVotes, parseEpisodeCode, posterUrl, simklUrl, STATUS_LABELS, statusesFor } from '../logic';
import { activeSession, fmtRating, toSimklRating } from '../insights';
import EpisodesModal from './EpisodesModal';
import { IMDB_YELLOW, MAL_BLUE, SIMKL_ICON } from './parts';
import { fmtDay } from './time';
import type { CatalogTitle, Play, Session, SimklActions, SimklDetailInfo, SimklItem, SimklStatus } from './types';

const HERO = 330;
/** 24 thin bands, eased, so the backdrop melts into the page without visible steps. */
const FADE_STEP = 6;
const FADE = Array.from({ length: 24 }, (_, i) => Math.pow((i + 1) / 24, 2.2));

export default function DetailModal({
  item,
  title,
  actions,
  initialEpisodesOpen = false,
  initialRewatchOpen = false,
  initialRatingOpen = false,
  onOpen,
  onClose,
}: {
  /** null = not in the library yet (from search, trending or the calendar). */
  item: SimklItem | null;
  title: CatalogTitle;
  actions: SimklActions;
  initialEpisodesOpen?: boolean;
  initialRewatchOpen?: boolean;
  initialRatingOpen?: boolean;
  /** Open another title (from "More like this"). */
  onOpen: (t: CatalogTitle) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();

  const [detail, setDetail] = useState<SimklDetailInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [ratingOpen, setRatingOpen] = useState(initialRatingOpen && !!item);
  const [statusOpen, setStatusOpen] = useState(false);
  const [episodesOpen, setEpisodesOpen] = useState(initialEpisodesOpen && !!item);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [plays, setPlays] = useState<Play[]>([]);
  const [rewatchSession, setRewatchSession] = useState<Session | null>(null);
  const [sessionMenu, setSessionMenu] = useState<Session | null>(null);
  const [wantRewatchOpen, setWantRewatchOpen] = useState(initialRewatchOpen);

  const type = title.type;
  const id = title.simklId;

  useEffect(() => {
    setDetail(null);
    actions
      .loadDetail(type, id)
      .then(setDetail)
      .catch((e) => setNote(`Details could not load: ${String(e?.message ?? e)}`));
  }, [actions, type, id]);

  const refreshRewatches = () => {
    if (!item) return;
    actions.loadSessions(id).then(setSessions).catch(() => undefined);
    actions.loadPlays(id).then(setPlays).catch(() => undefined);
  };
  useEffect(refreshRewatches, [actions, id, item?.lastWatchedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = activeSession(sessions);
  useEffect(() => {
    if (wantRewatchOpen && current) {
      setWantRewatchOpen(false);
      setRewatchSession(current);
    }
  }, [wantRewatchOpen, current]);
  const moviePlays = plays.filter((x) => x.season === 0 && x.episode === 0).length;
  const sessionDone = current ? new Set(plays.filter((x) => x.sessionId === current.id).map((x) => `${x.season}:${x.episode}`)).size : 0;

  async function run(label: string, job: () => Promise<void>) {
    setBusy(true);
    setNote('');
    try {
      await job();
      setNote(label);
    } catch (e: any) {
      setNote(`That did not work: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const fanart = fanartUrl(detail?.fanart ?? null);
  // No backdrop on Simkl: the poster, blurred, so the title still sits on colour.
  const backdrop = fanart ?? posterUrl(detail?.poster ?? title.poster, '_m');
  const years = detail?.years ? detail.years.replace('-', ' – ') : (detail?.year ?? title.year);
  const facts = [years, detail?.language].filter(Boolean).join('  •  ');
  const link = simklUrl(type, id, title.slug);
  const next = item ? parseEpisodeCode(item.nextToWatch) : null;
  const simklRating = detail?.simklRating ?? item?.simklRating ?? title.simklRating ?? null;
  const imdbRating = detail?.imdbRating ?? item?.imdbRating ?? title.imdbRating ?? null;
  const malRating = detail?.malRating ?? item?.malRating ?? null;
  const rank = detail?.rank ?? item?.rank ?? title.rank ?? null;
  const left = item ? episodesLeft(item) : 0;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
          {/* Backdrop with the title over it */}
          <View style={[styles.hero, { height: HERO + insets.top }]}>
            <Image source={{ uri: backdrop }} style={styles.heroImage} contentFit="cover" transition={200} blurRadius={fanart ? 0 : 30} />
            <View style={styles.heroShade} />
            {/* A soft fade into the page (no gradient module in this build). */}
            {FADE.map((o, i) => (
              <View key={i} style={[styles.fade, { bottom: (FADE.length - 1 - i) * FADE_STEP, opacity: o }]} />
            ))}
            <View style={[styles.heroBar, { top: insets.top + 6 }]}>
              <TouchableOpacity style={styles.heroBtn} onPress={onClose} accessibilityLabel="Back">
                <Text style={styles.heroBtnText}>‹</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.heroBtn} onPress={() => actions.openUrl(link)} accessibilityLabel="Open on Simkl">
                <Text style={styles.heroBtnSmall}>↗</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.heroText}>
              {!!facts && <Text style={styles.facts}>{facts}</Text>}
              <Text style={styles.title}>{title.title}</Text>
            </View>
          </View>

          {/* Ratings */}
          <View style={styles.ratings}>
            <TouchableOpacity style={styles.rating} onPress={() => actions.openUrl(link)} accessibilityLabel="Simkl rating">
              <Image source={{ uri: SIMKL_ICON }} style={styles.simklMark} />
              <View>
                <Text style={styles.ratingValue}>
                  {simklRating !== null ? simklRating.toFixed(1) : '–'}
                  {rank ? <Text style={styles.ratingRank}>{`  #${rank}`}</Text> : null}
                </Text>
                {!!detail?.simklVotes && <Text style={styles.ratingVotes}>{fmtVotes(detail.simklVotes)} votes</Text>}
              </View>
            </TouchableOpacity>
            {(imdbRating !== null || type !== 'anime') && (
              <View style={styles.rating}>
                <View style={[styles.brand, { backgroundColor: IMDB_YELLOW }]}>
                  <Text style={styles.brandDark}>IMDb</Text>
                </View>
                <View>
                  <Text style={styles.ratingValue}>{imdbRating !== null ? imdbRating.toFixed(1) : '–'}</Text>
                  {!!detail?.imdbVotes && <Text style={styles.ratingVotes}>{fmtVotes(detail.imdbVotes)} votes</Text>}
                </View>
              </View>
            )}
            {type === 'anime' && malRating !== null && (
              <View style={styles.rating}>
                <View style={[styles.brand, { backgroundColor: MAL_BLUE }]}>
                  <Text style={styles.brandLight}>MAL</Text>
                </View>
                <View>
                  <Text style={styles.ratingValue}>{malRating.toFixed(1)}</Text>
                  {!!detail?.malVotes && <Text style={styles.ratingVotes}>{fmtVotes(detail.malVotes)} votes</Text>}
                </View>
              </View>
            )}
            {item && (
              <TouchableOpacity style={styles.mine} onPress={() => setRatingOpen(true)} accessibilityLabel="My rating">
                <Text style={styles.mineStar}>{item.rating ? '★' : '☆'}</Text>
                <Text style={[styles.mineValue, !item.rating && styles.mineEmpty]}>{item.rating ? fmtRating(item.rating) : 'Rate'}</Text>
              </TouchableOpacity>
            )}
          </View>

          {!!note && <Text style={styles.note}>{note}</Text>}

          {/* Main action */}
          <View style={styles.primaryWrap}>
            {!item ? (
              <Big
                label="Add to Plan to Watch"
                disabled={busy}
                onPress={() => run('Added to Plan to Watch', () => actions.addToLibrary(title, 'plantowatch'))}
              />
            ) : type === 'movie' ? (
              item.status === 'completed' ? (
                <Big
                  label="Watched again"
                  sub={`Seen ${1 + moviePlays} ${moviePlays ? 'times' : 'time'} so far`}
                  disabled={busy}
                  onPress={() =>
                    run('Logged a rewatch', async () => {
                      await actions.logRewatch(item, [], null);
                      refreshRewatches();
                    })
                  }
                />
              ) : (
                <Big label="I've seen this" disabled={busy} onPress={() => run('Marked as watched', () => actions.markMovieWatched(item))} />
              )
            ) : next ? (
              <Big
                label={`Watched ${item.nextToWatch}`}
                sub={item.nextTitle ?? undefined}
                disabled={busy}
                onPress={() => run(`${item.nextToWatch} watched`, () => actions.setEpisodes(item, [next], true))}
              />
            ) : null}
          </View>

          {/* Action rows */}
          <View style={styles.rows}>
            {!!detail?.trailer && <ActionRow icon="▶" label="Watch trailer" onPress={() => actions.openUrl(detail.trailer!)} />}
            {item && type !== 'movie' && (
              <ActionRow
                icon="✓"
                label="Mark specific episodes"
                value={`${item.watchedEpisodes}/${item.totalEpisodes || '?'}${left ? ` · ${left} left` : ''}`}
                onPress={() => setEpisodesOpen(true)}
              />
            )}
            {item && type !== 'movie' && item.watchedEpisodes > 0 && (
              <ActionRow
                icon="↻"
                label={current ? `Rewatch #${current.number}` : 'Start a rewatch'}
                value={current ? `${sessionDone}/${item.totalEpisodes || '?'}` : sessions.length ? `${sessions.length} done` : undefined}
                onPress={() => {
                  if (current) setRewatchSession(current);
                  else
                    void run('Rewatch started', async () => {
                      const s = await actions.startRewatch(item);
                      refreshRewatches();
                      setRewatchSession(s);
                    });
                }}
              />
            )}
            <ActionRow
              icon="◉"
              label={item ? STATUS_LABELS[item.status] : 'Add to a list'}
              value={item ? 'Change' : undefined}
              onPress={() => setStatusOpen(true)}
            />
            <ActionRow icon="↗" label="View on Simkl" onPress={() => actions.openUrl(link)} />
          </View>

          {item && sessions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>REWATCHES</Text>
              {[...sessions].reverse().map((s) => {
                const n = new Set(plays.filter((x) => x.sessionId === s.id).map((x) => `${x.season}:${x.episode}`)).size;
                return (
                  <TouchableOpacity key={s.id} style={styles.sessionRow} onPress={() => setSessionMenu(s)}>
                    <Text style={styles.sessionTitle}>#{s.number}</Text>
                    <Text style={styles.sessionFacts}>
                      {n} episodes · started {fmtDay(s.startedAt)}
                      {s.finishedAt ? ` · finished ${fmtDay(s.finishedAt)}` : ' · in progress'}
                      {s.remoteId ? ' · on Simkl' : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {!!item?.memo && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>MY NOTE</Text>
              <Text style={styles.text}>{item.memo}</Text>
            </View>
          )}

          {(detail?.overview || detail?.network || detail?.genres.length) && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>OVERVIEW</Text>
              {!!detail?.network && <Text style={styles.network}>{detail.network}</Text>}
              {!!detail?.overview && <Text style={styles.text}>{detail.overview}</Text>}
              {!!detail?.genres.length && <Text style={styles.genres}>{detail.genres.join(', ')}</Text>}
              <Text style={styles.small}>
                {[
                  detail?.status ? detail.status[0].toUpperCase() + detail.status.slice(1) : null,
                  detail?.runtime ? `${detail.runtime} min` : null,
                  detail?.certification,
                  detail?.country,
                  detail?.totalEpisodes && type !== 'movie' ? `${detail.totalEpisodes} episodes` : null,
                ]
                  .filter(Boolean)
                  .join('  ·  ')}
              </Text>
            </View>
          )}

          {!!detail?.related.length && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>MORE LIKE THIS</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.related}>
                {detail.related.map((r) => (
                  <TouchableOpacity key={r.simklId} style={styles.relatedItem} onPress={() => onOpen(r)}>
                    <Image source={{ uri: posterUrl(r.poster, '_c') }} style={styles.relatedPoster} contentFit="cover" />
                    <Text style={styles.relatedTitle} numberOfLines={2}>
                      {r.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {item && (
            <TouchableOpacity
              style={styles.remove}
              onPress={() =>
                confirmAction(
                  `Remove ${item.title} from Simkl?`,
                  'It leaves every list on Simkl, together with its watch history and rating.',
                  () =>
                    void run('Removed', async () => {
                      await actions.remove(item);
                      onClose();
                    }),
                  { label: 'Remove', destructive: true }
                )
              }>
              <Text style={styles.removeText}>Remove from Simkl</Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {statusOpen && (
          <OptionsSheet
            title={item ? 'Move to' : 'Add to'}
            options={statusesFor(type).map((s: SimklStatus) => ({
              label: STATUS_LABELS[s],
              hint: item?.status === s ? 'Now' : undefined,
              onPress: () =>
                void run(item ? `Moved to ${STATUS_LABELS[s]}` : `Added to ${STATUS_LABELS[s]}`, () =>
                  item ? actions.setStatus(item, s) : actions.addToLibrary(title, s)
                ),
            }))}
            onClose={() => setStatusOpen(false)}
          />
        )}
        {ratingOpen && item && (
          <RatingPicker
            value={item.rating}
            note={(n) => (Number.isInteger(n) ? 'Saved on Simkl too.' : `Simkl only takes whole numbers, so it gets ${toSimklRating(n)}; ReelVault keeps ${fmtRating(n)}.`)}
            onPick={(n) => void run(n === null ? 'Rating cleared' : `Rated ${fmtRating(n)}`, () => actions.setRating(item, n))}
            onClose={() => setRatingOpen(false)}
          />
        )}
        {episodesOpen && item && <EpisodesModal item={item} actions={actions} onClose={() => setEpisodesOpen(false)} />}
        {rewatchSession && item && (
          <EpisodesModal
            item={item}
            actions={actions}
            session={rewatchSession}
            onFinishSession={() => {
              const s = rewatchSession;
              setRewatchSession(null);
              void run(`Rewatch #${s.number} finished`, async () => {
                await actions.endRewatch(item, s, true);
                refreshRewatches();
              });
            }}
            onClose={() => {
              setRewatchSession(null);
              refreshRewatches();
            }}
          />
        )}
        {sessionMenu && item && (
          <OptionsSheet
            title={`Rewatch #${sessionMenu.number}`}
            options={[
              { label: 'Open', onPress: () => setRewatchSession(sessionMenu) },
              sessionMenu.finishedAt
                ? {
                    label: 'Continue this rewatch',
                    onPress: () =>
                      void run('Rewatch reopened', async () => {
                        await actions.endRewatch(item, sessionMenu, false);
                        refreshRewatches();
                      }),
                  }
                : {
                    label: 'Finish',
                    onPress: () =>
                      void run('Rewatch finished', async () => {
                        await actions.endRewatch(item, sessionMenu, true);
                        refreshRewatches();
                      }),
                  },
              {
                label: 'Delete from ReelVault',
                danger: true,
                onPress: () =>
                  confirmAction(
                    `Delete rewatch #${sessionMenu.number}?`,
                    'Its episodes are removed from ReelVault. A copy saved on Simkl (PRO) stays there.',
                    () =>
                      void run('Rewatch deleted', async () => {
                        await actions.deleteRewatch(sessionMenu);
                        refreshRewatches();
                      }),
                    { label: 'Delete', destructive: true }
                  ),
              },
            ]}
            onClose={() => setSessionMenu(null)}
          />
        )}
      </View>
    </Modal>
  );

  function Big({ label, sub, disabled, subtle, onPress }: { label: string; sub?: string; disabled?: boolean; subtle?: boolean; onPress: () => void }) {
    return (
      <TouchableOpacity
        style={[styles.big, subtle && styles.bigSubtle, disabled && styles.disabled]}
        disabled={disabled}
        onPress={onPress}>
        <Text style={[styles.bigText, subtle && styles.bigTextSubtle]}>{label}</Text>
        {!!sub && (
          <Text style={styles.bigSub} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </TouchableOpacity>
    );
  }

  function ActionRow({ icon, label, value, onPress }: { icon: string; label: string; value?: string; onPress: () => void }) {
    return (
      <TouchableOpacity style={styles.row} onPress={onPress}>
        <Text style={styles.rowIcon}>{icon}</Text>
        <Text style={styles.rowLabel}>{label}</Text>
        {!!value && <Text style={styles.rowValue}>{value}</Text>}
        <Text style={[styles.rowChevron, { color: p.textMuted }]}>›</Text>
      </TouchableOpacity>
    );
  }
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    hero: { width: '100%', justifyContent: 'flex-end', backgroundColor: p.tile },
    heroImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    heroShade: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.25)' },
    fade: { position: 'absolute', left: 0, right: 0, height: FADE_STEP, backgroundColor: p.bg },
    heroBar: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between' },
    heroBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroBtnText: { color: '#fff', fontSize: 28, fontWeight: '500', marginTop: -4 },
    heroBtnSmall: { color: '#fff', fontSize: 18, fontWeight: '700' },
    heroText: { paddingHorizontal: 18, paddingBottom: 10, gap: 4 },
    facts: { color: p.textSoft, fontSize: 15, fontWeight: '600' },
    title: { color: p.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },

    ratings: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 18,
      paddingHorizontal: 18,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: p.separator,
    },
    rating: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    simklMark: { width: 34, height: 34, borderRadius: 7 },
    brand: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 6 },
    brandDark: { color: '#000', fontWeight: '900', fontSize: 13 },
    brandLight: { color: '#fff', fontWeight: '900', fontSize: 13 },
    ratingValue: { color: p.text, fontSize: 19, fontWeight: '800', fontVariant: ['tabular-nums'] },
    ratingRank: { color: p.textSecondary, fontSize: 14, fontWeight: '700' },
    ratingVotes: { color: p.textSecondary, fontSize: 12, fontWeight: '600' },
    mine: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
    mineStar: { color: p.rating, fontSize: 28 },
    mineValue: { color: p.rating, fontSize: 30, fontWeight: '900' },
    mineEmpty: { fontSize: 16, fontWeight: '700' },

    note: { color: p.link, fontSize: 13, fontWeight: '600', paddingHorizontal: 18, paddingTop: 10 },
    primaryWrap: { paddingHorizontal: 18, paddingTop: 14 },
    big: { backgroundColor: p.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
    bigSubtle: { backgroundColor: p.card },
    bigText: { color: '#fff', fontSize: 17, fontWeight: '800' },
    bigTextSubtle: { color: p.text },
    bigSub: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 2, paddingHorizontal: 12 },
    disabled: { opacity: 0.5 },

    rows: { marginTop: 14, borderTopWidth: 1, borderTopColor: p.separator },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      paddingHorizontal: 18,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: p.separator,
    },
    rowIcon: { color: p.text, fontSize: 18, width: 24, textAlign: 'center' },
    rowLabel: { flex: 1, color: p.text, fontSize: 17 },
    rowValue: { color: p.textSecondary, fontSize: 14 },
    rowChevron: { fontSize: 26, marginTop: -2 },

    section: { paddingHorizontal: 18, paddingTop: 22, gap: 8 },
    sectionLabel: { color: p.textSecondary, fontSize: 13, fontWeight: '700', letterSpacing: 0.8 },
    network: { color: p.link, fontSize: 18, fontWeight: '600' },
    text: { color: p.textSoft, fontSize: 16, lineHeight: 23 },
    genres: { color: p.text, fontSize: 15 },
    small: { color: p.textSecondary, fontSize: 13 },
    related: { gap: 12, paddingVertical: 4 },
    relatedItem: { width: 100 },
    relatedPoster: { width: 100, height: 147, borderRadius: 8, backgroundColor: p.tile },
    relatedTitle: { color: p.text, fontSize: 13, marginTop: 5 },

    remove: { marginTop: 28, alignSelf: 'center', padding: 10 },
    removeText: { color: p.dangerText, fontSize: 15, fontWeight: '600' },

    sessionRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: p.separator, gap: 2 },
    sessionTitle: { color: p.text, fontSize: 16, fontWeight: '800' },
    sessionFacts: { color: p.textSecondary, fontSize: 13 },
  });
