/**
 * One movie, show or anime. A full-bleed backdrop with the poster and title
 * over it; rating tiles (Simkl + rank, IMDb or MAL, yours); the main action
 * ("Watched S02E04" / "I've seen this"); four quick buttons (list, your
 * lists, trailer, rewatch); episode progress; the overview and facts; your
 * rewatches; "More like this".
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmAction } from '@/features/vault/ui/confirm';
import Fade from '@/features/vault/ui/Fade';
import { success } from '@/features/vault/ui/haptics';
import Icon from '@/features/vault/ui/Icon';
import IconButton from '@/features/vault/ui/IconButton';
import type { IconName } from '@/features/vault/ui/icons';
import { OptionsSheet } from '@/features/vault/ui/prompts';
import RatingPicker from '@/features/vault/ui/RatingPicker';
import { rgbOf, sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { episodesLeft, fanartUrl, fmtVotes, parseEpisodeCode, posterUrl, simklUrl, STATUS_LABELS, statusesFor } from '../logic';
import { activeSession, fmtDuration, fmtRating, toSimklRating } from '../insights';
import EpisodesModal from './EpisodesModal';
import WatchOrder from './FranchiseUI';
import { AddToListSheet } from './ListsUI';
import { IMDB_YELLOW, MAL_BLUE, SIMKL_ICON } from './parts';
import Poster, { hueFor } from './Poster';
import { fmtDay } from './time';
import type { CatalogTitle, Play, Session, SimklActions, SimklDetailInfo, SimklItem, SimklList, SimklStatus } from './types';

const HERO = 400;
const EMPTY_LIBRARY = new Map<number, SimklItem>();
const STATUS_ICON: Record<SimklStatus, IconName> = {
  watching: 'play',
  plantowatch: 'clock',
  hold: 'pause',
  completed: 'checkCircle',
  dropped: 'close',
};

export default function DetailModal({
  item,
  title,
  actions,
  lists = [],
  library,
  hideSpoilers = false,
  initialEpisodesOpen = false,
  initialRewatchOpen = false,
  initialRatingOpen = false,
  initialListsOpen = false,
  onOpen,
  onClose,
}: {
  /** null = not in the library yet (from search, trending or the calendar). */
  item: SimklItem | null;
  title: CatalogTitle;
  actions: SimklActions;
  lists?: SimklList[];
  /** Your library, for ticking what you have seen in the watch order. */
  library?: Map<number, SimklItem>;
  hideSpoilers?: boolean;
  initialEpisodesOpen?: boolean;
  initialRewatchOpen?: boolean;
  initialRatingOpen?: boolean;
  initialListsOpen?: boolean;
  /** Open another title (from "More like this"). */
  onOpen: (t: CatalogTitle) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();

  const [detail, setDetail] = useState<SimklDetailInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [ratingOpen, setRatingOpen] = useState(initialRatingOpen && !!item);
  const [statusOpen, setStatusOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(initialListsOpen);
  const [episodesOpen, setEpisodesOpen] = useState(initialEpisodesOpen && !!item);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [plays, setPlays] = useState<Play[]>([]);
  const [rewatchSession, setRewatchSession] = useState<Session | null>(null);
  const [sessionMenu, setSessionMenu] = useState<Session | null>(null);
  const [wantRewatchOpen, setWantRewatchOpen] = useState(initialRewatchOpen);
  const [moreText, setMoreText] = useState(false);

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
      success();
      setNote(label);
    } catch (e: any) {
      setNote(`That did not work: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const fanart = fanartUrl(detail?.fanart ?? item?.fanart ?? null);
  const poster = detail?.poster ?? title.poster;
  // No backdrop on Simkl: the poster, blurred, so the title still sits on colour.
  const backdrop = fanart ?? (poster ? posterUrl(poster, '_m') : null);
  const years = detail?.years ? detail.years.replace('-', '–') : (detail?.year ?? title.year);
  const runtime = detail?.runtime ?? item?.runtime ?? null;
  const facts = [years, runtime ? fmtDuration(runtime) : null, detail?.certification].filter(Boolean).join('  ·  ');
  const link = simklUrl(type, id, title.slug);
  const next = item ? parseEpisodeCode(item.nextToWatch) : null;
  const simklRating = detail?.simklRating ?? item?.simklRating ?? title.simklRating ?? null;
  const imdbRating = detail?.imdbRating ?? item?.imdbRating ?? title.imdbRating ?? null;
  const malRating = detail?.malRating ?? item?.malRating ?? null;
  const rank = detail?.rank ?? item?.rank ?? title.rank ?? null;
  const left = item ? episodesLeft(item) : 0;
  const total = item?.totalEpisodes || detail?.totalEpisodes || 0;
  const inLists = lists.filter((l) => l.ids.includes(id));
  const posterW = 112;
  const posterH = Math.round(posterW * 1.48);
  const fade = rgbOf(p.bg);

  const infoFacts: [string, string][] = [
    ['Status', detail?.status ? detail.status[0].toUpperCase() + detail.status.slice(1) : ''],
    ['Network', detail?.network ?? ''],
    ['Runtime', runtime ? `${runtime} min${type === 'movie' ? '' : ' / episode'}` : ''],
    ['Episodes', type !== 'movie' && total ? String(total) : ''],
    ['First aired', detail?.firstAired ? fmtDay(detail.firstAired) : ''],
    ['Country', detail?.country ?? ''],
    ['Language', detail?.language ?? ''],
    ['Rated', detail?.certification ?? ''],
  ].filter(([, v]) => !!v) as [string, string][];

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 36 }} showsVerticalScrollIndicator={false}>
          {/* Backdrop, poster and title */}
          <View style={[styles.hero, { height: HERO + insets.top }]}>
            {backdrop ? (
              <Image source={{ uri: backdrop }} style={StyleFill} contentFit="cover" transition={250} blurRadius={fanart ? 0 : 28} />
            ) : (
              <View style={[StyleFill, { backgroundColor: `hsl(${hueFor(title.title)}, 36%, 22%)` }]} />
            )}
            <Fade color="0,0,0" from={0} to={0.45} reverse style={[StyleFill, { bottom: '60%' }]} />
            <Fade color={fade} from={0} to={1} style={[StyleFill, { top: '30%' }]} />
            <View style={styles.heroBody}>
              <Poster path={poster} title={title.title} width={posterW} height={posterH} radius={12} size="_m" style={styles.posterShadow} />
              <View style={styles.heroText}>
                {!!facts && <Text style={styles.facts}>{facts}</Text>}
                <Text style={styles.title} numberOfLines={3}>
                  {title.title}
                </Text>
                {!!detail?.genres.length && (
                  <Text style={styles.genres} numberOfLines={1}>
                    {detail.genres.slice(0, 3).join(' · ')}
                  </Text>
                )}
              </View>
            </View>
          </View>

          {/* Ratings */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ratings}>
            <TouchableOpacity style={styles.tile} onPress={() => actions.openUrl(link)} accessibilityLabel="Simkl rating">
              <Image source={{ uri: SIMKL_ICON }} style={styles.simklMark} />
              <View>
                <Text style={styles.tileValue}>{simklRating !== null ? simklRating.toFixed(1) : '–'}</Text>
                <Text style={styles.tileSub}>{rank ? `#${rank}` : detail?.simklVotes ? fmtVotes(detail.simklVotes) : 'Simkl'}</Text>
              </View>
            </TouchableOpacity>
            {(imdbRating !== null || type !== 'anime') && (
              <View style={styles.tile}>
                <View style={[styles.brand, { backgroundColor: IMDB_YELLOW }]}>
                  <Text style={styles.brandDark}>IMDb</Text>
                </View>
                <View>
                  <Text style={styles.tileValue}>{imdbRating !== null ? imdbRating.toFixed(1) : '–'}</Text>
                  <Text style={styles.tileSub}>{detail?.imdbVotes ? `${fmtVotes(detail.imdbVotes)} votes` : 'IMDb'}</Text>
                </View>
              </View>
            )}
            {type === 'anime' && malRating !== null && (
              <View style={styles.tile}>
                <View style={[styles.brand, { backgroundColor: MAL_BLUE }]}>
                  <Text style={styles.brandLight}>MAL</Text>
                </View>
                <View>
                  <Text style={styles.tileValue}>{malRating.toFixed(1)}</Text>
                  <Text style={styles.tileSub}>{detail?.malVotes ? `${fmtVotes(detail.malVotes)} votes` : 'MyAnimeList'}</Text>
                </View>
              </View>
            )}
            {item && (
              <TouchableOpacity style={[styles.tile, styles.mineTile]} onPress={() => setRatingOpen(true)} accessibilityLabel="My rating">
                <Icon name={item.rating ? 'star' : 'starOff'} size={22} color={p.rating} />
                <View>
                  <Text style={[styles.tileValue, { color: p.rating }]}>{item.rating ? fmtRating(item.rating) : 'Rate'}</Text>
                  <Text style={styles.tileSub}>{item.rating ? 'Yours' : 'Tap to rate'}</Text>
                </View>
              </TouchableOpacity>
            )}
          </ScrollView>

          {!!note && <Text style={styles.note}>{note}</Text>}

          {/* Main action */}
          <View style={styles.primaryWrap}>
            {!item ? (
              <Big
                icon="plus"
                label="Add to Plan to Watch"
                disabled={busy}
                onPress={() => run('Added to Plan to Watch', () => actions.addToLibrary(title, 'plantowatch'))}
              />
            ) : type === 'movie' ? (
              item.status === 'completed' ? (
                <Big
                  icon="rewatch"
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
                <Big icon="check" label="I've seen this" disabled={busy} onPress={() => run('Marked as watched', () => actions.markMovieWatched(item))} />
              )
            ) : next ? (
              <Big
                icon="check"
                label={`Watched ${item.nextToWatch}`}
                sub={hideSpoilers ? undefined : (item.nextTitle ?? undefined)}
                disabled={busy}
                onPress={() => run(`${item.nextToWatch} watched`, () => actions.setEpisodes(item, [next], true))}
              />
            ) : null}
          </View>

          {/* Quick buttons */}
          <View style={styles.quick}>
            <Quick
              icon={item ? STATUS_ICON[item.status] : 'listAdd'}
              label={item ? STATUS_LABELS[item.status] : 'Add to…'}
              on={!!item}
              onPress={() => setStatusOpen(true)}
            />
            <Quick
              icon="lists"
              label={inLists.length ? `${inLists.length} ${inLists.length === 1 ? 'list' : 'lists'}` : 'My lists'}
              on={inLists.length > 0}
              onPress={() => setListsOpen(true)}
            />
            <Quick icon="play" label="Trailer" disabled={!detail?.trailer} onPress={() => detail?.trailer && actions.openUrl(detail.trailer)} />
            {item && type !== 'movie' && item.watchedEpisodes > 0 ? (
              <Quick
                icon="rewatch"
                label={current ? `Rewatch #${current.number}` : 'Rewatch'}
                on={!!current}
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
            ) : (
              <Quick icon="share" label="Simkl" onPress={() => actions.openUrl(link)} />
            )}
          </View>

          {/* Episodes */}
          {item && type !== 'movie' && (
            <TouchableOpacity style={styles.card} onPress={() => setEpisodesOpen(true)} accessibilityLabel="Episodes">
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>Episodes</Text>
                <Text style={styles.cardValue}>
                  {item.watchedEpisodes} of {total || '?'}
                </Text>
                <Icon name="forward" size={14} color={p.textMuted} />
              </View>
              <View style={styles.track}>
                <View style={[styles.trackFill, { width: `${total ? Math.min(100, (item.watchedEpisodes / total) * 100) : 0}%` }]} />
              </View>
              <Text style={styles.cardSub}>
                {left > 0
                  ? `${left} left${runtime ? ` · about ${fmtDuration(left * runtime)}` : ''}`
                  : item.notAiredEpisodes > 0
                    ? `Caught up · ${item.notAiredEpisodes} still to air`
                    : 'All watched'}
                {current ? ` · Rewatch #${current.number}: ${sessionDone} done` : ''}
              </Text>
            </TouchableOpacity>
          )}

          {/* Overview */}
          {!!detail?.overview && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Overview</Text>
              <Text style={styles.text} numberOfLines={moreText ? undefined : 4} onPress={() => setMoreText(!moreText)}>
                {detail.overview}
              </Text>
              {detail.overview.length > 220 && (
                <Text style={styles.more} onPress={() => setMoreText(!moreText)}>
                  {moreText ? 'Less' : 'More'}
                </Text>
              )}
            </View>
          )}

          {!!item?.memo && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>My note</Text>
              <Text style={styles.text}>{item.memo}</Text>
            </View>
          )}

          {infoFacts.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Info</Text>
              <View style={styles.factsGrid}>
                {infoFacts.map(([k, v]) => (
                  <View key={k} style={styles.fact}>
                    <Text style={styles.factKey}>{k}</Text>
                    <Text style={styles.factValue} numberOfLines={2}>
                      {v}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          <WatchOrder type={type} id={id} actions={actions} library={library ?? EMPTY_LIBRARY} onOpen={onOpen} />

          {item && sessions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Rewatches</Text>
              <View style={styles.group}>
                {[...sessions].reverse().map((s, i) => {
                  const n = new Set(plays.filter((x) => x.sessionId === s.id).map((x) => `${x.season}:${x.episode}`)).size;
                  return (
                    <TouchableOpacity key={s.id} style={[styles.groupRow, i > 0 && styles.groupSep]} onPress={() => setSessionMenu(s)}>
                      <View style={[styles.badge, !s.finishedAt && { backgroundColor: p.accent }]}>
                        <Text style={styles.badgeText}>#{s.number}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.groupTitle}>{s.finishedAt ? 'Finished' : 'In progress'}</Text>
                        <Text style={styles.groupSub}>
                          {n} episodes · {fmtDay(s.startedAt)}
                          {s.finishedAt ? ` – ${fmtDay(s.finishedAt)}` : ''}
                          {s.remoteId ? ' · on Simkl' : ''}
                        </Text>
                      </View>
                      <Icon name="more" size={16} color={p.textMuted} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {!!detail?.related.length && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>More like this</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.related} style={styles.bleed}>
                {detail.related.map((r) => (
                  <TouchableOpacity key={r.simklId} style={styles.relatedItem} onPress={() => onOpen(r)}>
                    <Poster path={r.poster} title={r.title} width={108} height={160} radius={10} />
                    <Text style={styles.relatedTitle} numberOfLines={2}>
                      {r.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={styles.footerLinks}>
            <TouchableOpacity style={styles.linkBtn} onPress={() => actions.openUrl(link)}>
              <Icon name="open" size={14} color={p.link} />
              <Text style={styles.linkText}>View on Simkl</Text>
            </TouchableOpacity>
            {item && (
              <TouchableOpacity
                style={styles.linkBtn}
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
                <Icon name="trash" size={14} color={p.dangerText} />
                <Text style={[styles.linkText, { color: p.dangerText }]}>Remove from Simkl</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>

        {/* Floating controls over the backdrop */}
        <View style={[styles.topBar, { top: insets.top + 6, width }]} pointerEvents="box-none">
          <IconButton icon="back" label="Back" clear onPress={onClose} />
          <View style={styles.topRight}>
            <IconButton icon="lists" label="Add to my lists" clear onPress={() => setListsOpen(true)} />
            <IconButton icon="open" label="Open on Simkl" clear onPress={() => actions.openUrl(link)} />
          </View>
        </View>

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
        {listsOpen && <AddToListSheet title={{ ...title, poster }} lists={lists} actions={actions} onClose={() => setListsOpen(false)} />}
        {ratingOpen && item && (
          <RatingPicker
            value={item.rating}
            note={(n) => (Number.isInteger(n) ? 'Saved on Simkl too.' : `Simkl only takes whole numbers, so it gets ${toSimklRating(n)}; ReelVault keeps ${fmtRating(n)}.`)}
            onPick={(n) => void run(n === null ? 'Rating cleared' : `Rated ${fmtRating(n)}`, () => actions.setRating(item, n))}
            onClose={() => setRatingOpen(false)}
          />
        )}
        {episodesOpen && item && <EpisodesModal item={item} actions={actions} hideSpoilers={hideSpoilers} onClose={() => setEpisodesOpen(false)} />}
        {rewatchSession && item && (
          <EpisodesModal
            item={item}
            actions={actions}
            hideSpoilers={hideSpoilers}
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

  function Big({ icon, label, sub, disabled, onPress }: { icon: IconName; label: string; sub?: string; disabled?: boolean; onPress: () => void }) {
    return (
      <TouchableOpacity style={[styles.big, disabled && styles.disabled]} disabled={disabled} onPress={onPress} activeOpacity={0.8}>
        <Icon name={icon} size={20} color="#fff" weight="bold" />
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.bigText}>{label}</Text>
          {!!sub && (
            <Text style={styles.bigSub} numberOfLines={1}>
              {sub}
            </Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  function Quick({ icon, label, on, disabled, onPress }: { icon: IconName; label: string; on?: boolean; disabled?: boolean; onPress: () => void }) {
    return (
      <TouchableOpacity style={[styles.quickBtn, disabled && styles.disabled]} disabled={disabled} onPress={onPress} accessibilityLabel={label}>
        <View style={[styles.quickIcon, on && { backgroundColor: p.accentSoft }]}>
          <Icon name={icon} size={20} color={on ? p.accent : p.text} />
        </View>
        <Text style={[styles.quickLabel, on && { color: p.accent }]} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  }
}

const StyleFill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    hero: { width: '100%', justifyContent: 'flex-end', backgroundColor: p.elevated, overflow: 'hidden' },
    heroBody: { flexDirection: 'row', alignItems: 'flex-end', gap: 16, paddingHorizontal: 18, paddingBottom: 8 },
    posterShadow: { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
    heroText: { flex: 1, gap: 4, paddingBottom: 4 },
    facts: { color: p.textSoft, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
    title: { color: p.text, fontSize: 27, lineHeight: 31, fontWeight: '800', letterSpacing: -0.6 },
    genres: { color: p.textSecondary, fontSize: 13, fontWeight: '600' },
    topBar: { position: 'absolute', left: 0, paddingHorizontal: 14, flexDirection: 'row', justifyContent: 'space-between' },
    topRight: { flexDirection: 'row', gap: 10 },

    ratings: { gap: 10, paddingHorizontal: 18, paddingTop: 14 },
    tile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: p.elevated,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
      minWidth: 108,
    },
    mineTile: { borderWidth: 1, borderColor: 'rgba(245,166,35,0.35)' },
    simklMark: { width: 28, height: 28, borderRadius: 7 },
    brand: { borderRadius: 5, paddingHorizontal: 5, paddingVertical: 4 },
    brandDark: { color: '#000', fontWeight: '900', fontSize: 12 },
    brandLight: { color: '#fff', fontWeight: '900', fontSize: 12 },
    tileValue: { color: p.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
    tileSub: { color: p.textSecondary, fontSize: 11, fontWeight: '600' },

    note: { color: p.link, fontSize: 13, fontWeight: '600', paddingHorizontal: 18, paddingTop: 12 },
    primaryWrap: { paddingHorizontal: 18, paddingTop: 16 },
    big: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      backgroundColor: p.accent,
      borderRadius: 16,
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    bigText: { color: '#fff', fontSize: 17, fontWeight: '800' },
    bigSub: { color: 'rgba(255,255,255,0.82)', fontSize: 13, marginTop: 1 },
    disabled: { opacity: 0.45 },

    quick: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 16 },
    quickBtn: { flex: 1, alignItems: 'center', gap: 6 },
    quickIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: p.elevated, alignItems: 'center', justifyContent: 'center' },
    quickLabel: { color: p.textSoft, fontSize: 12, fontWeight: '600', maxWidth: 84 },

    card: { marginHorizontal: 18, marginTop: 20, backgroundColor: p.elevated, borderRadius: 16, padding: 14, gap: 10 },
    cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    cardTitle: { flex: 1, color: p.text, fontSize: 17, fontWeight: '700' },
    cardValue: { color: p.textSecondary, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
    cardSub: { color: p.textSecondary, fontSize: 13 },
    track: { height: 6, borderRadius: 3, backgroundColor: p.card, overflow: 'hidden' },
    trackFill: { height: 6, borderRadius: 3, backgroundColor: p.accent },

    section: { paddingHorizontal: 18, paddingTop: 26, gap: 10 },
    sectionLabel: { color: p.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
    text: { color: p.textSoft, fontSize: 15, lineHeight: 22 },
    more: { color: p.link, fontSize: 15, fontWeight: '600', marginTop: -4 },
    factsGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: p.elevated, borderRadius: 16, paddingVertical: 6 },
    fact: { width: '50%', paddingHorizontal: 14, paddingVertical: 8, gap: 2 },
    factKey: { color: p.textSecondary, fontSize: 12, fontWeight: '600' },
    factValue: { color: p.text, fontSize: 15, fontWeight: '600' },

    group: { backgroundColor: p.elevated, borderRadius: 16, overflow: 'hidden' },
    groupRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
    groupSep: { borderTopWidth: 1, borderTopColor: p.separator },
    groupTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    groupSub: { color: p.textSecondary, fontSize: 12, marginTop: 1 },
    badge: { minWidth: 40, height: 28, borderRadius: 14, paddingHorizontal: 8, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    badgeText: { color: '#fff', fontSize: 13, fontWeight: '800' },

    bleed: { marginHorizontal: -18 },
    related: { gap: 12, paddingHorizontal: 18 },
    relatedItem: { width: 108 },
    relatedTitle: { color: p.text, fontSize: 13, fontWeight: '600', marginTop: 6 },

    footerLinks: { flexDirection: 'row', justifyContent: 'center', gap: 22, marginTop: 30 },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 },
    linkText: { color: p.link, fontSize: 14, fontWeight: '600' },
  });
