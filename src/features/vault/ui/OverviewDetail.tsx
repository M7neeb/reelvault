/**
 * One title in the Overview: a series (its own rating, every episode its
 * own) or a single video. Rate it, set its status, change its name, picture
 * and description, group videos into a series, reorder and rename episodes.
 * Removed videos show what is kept and can be forgotten.
 *
 * The page opens on a big picture that plays the video (the next episode),
 * then your rating, your review, how many times you watched it all again,
 * a chart of every episode's rating, and the episodes with their progress.
 * Presentational only (see the note at the top of types.ts).
 */

import { useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Modal, useWindowDimensions } from './screen';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fmtAgo } from '@/features/simkl/ui/time';

import { episodeOrder, guessSeriesName, moveEpisode, OV_STATUS_LABELS, playable, videoName, type OvEntry, type OvEpisode, type OvMember, type OvSeries, type OvStatus, type OvVideo } from '../overview';
import { addRewatch, logRating, removeLastRewatch, setReview, type OvExtra } from '../ovExtra';
import { fmtMs, ratingLabel, type RatingLabels } from '../stats';
import Fade from './Fade';
import { LiveCard, LiveProvider, useLiveScope } from './live';
import { GrowColumn } from './storyKit';
import { success, tick } from './haptics';
import Icon from './Icon';
import IconButton from './IconButton';
import { Cover, fmtStars, statusColor } from './overviewParts';
import { OptionsSheet, PromptSheet, type OptionItem } from './prompts';
import RatingPicker from './RatingPicker';
import { Section, SheetFrame } from './sheets';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultActions, VaultItem } from './types';

const SIDE = 18;
const STATUS_ORDER: OvStatus[] = ['watching', 'plantowatch', 'completed', 'hold', 'dropped'];
const ago = (ms: number) => fmtAgo(new Date(ms).toISOString());
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function OverviewDetail({
  entry,
  entries,
  videos,
  items,
  members,
  labels,
  actions,
  devSheet,
  extra,
  onExtra,
  enableVideo = false,
  liveSound,
  onLiveSound,
  onPlay,
  onOpen,
  onClose,
}: {
  /** Reviews, rewatches and rating history (all titles). */
  extra: OvExtra;
  onExtra: (change: (x: OvExtra) => OvExtra) => void;
  /** Play the video in the big picture (off in the browser preview). */
  enableVideo?: boolean;
  liveSound: boolean;
  onLiveSound: (on: boolean) => void;
  entry: OvEntry;
  entries: OvEntry[];
  videos: OvVideo[];
  items: VaultItem[];
  members: OvMember[];
  labels: RatingLabels;
  actions: VaultActions;
  devSheet?: 'edit' | 'add';
  onPlay: (videoId: string) => void;
  onOpen: (key: string | null) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const series = entry.kind === 'series';
  const single = !series ? entry.episodes[0] : null;

  const [rating, setRating] = useState<{ title: string; value: number; onPick: (r: number | null) => void } | null>(null);
  const [options, setOptions] = useState<{ title: string; options: OptionItem[] } | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; initial: string; placeholder?: string; onSubmit: (v: string) => void } | null>(null);
  const [editing, setEditing] = useState(devSheet === 'edit');
  const [adding, setAdding] = useState<'add' | 'make' | null>(devSheet === 'add' ? (series ? 'add' : 'make') : null);
  const [note, setNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const live = useLiveScope({ enableVideo, sound: liveSound, onSound: onLiveSound, paused: editing || !!adding || !!rating || !!options || !!prompt || reviewing });

  const fail = (e: unknown) => setNote(String((e as Error)?.message ?? e));
  const allSeries = entries.filter((e) => e.kind === 'series' && e.id !== entry.id);

  /* --------------------------------------------------------- writing it */

  const rateVideo = (v: OvVideo, r: number | null) =>
    (v.where === 'kept' ? actions.ovUpdateKept(v.id, { rating: r ?? 0 }) : actions.onRate(v.id, r ?? 0)).catch(fail);
  const statusVideo = (v: OvVideo, s: OvStatus | null) =>
    (v.where === 'kept' ? actions.ovUpdateKept(v.id, { status: s }) : actions.onSetStatus([v.id], s)).catch(fail);

  function rateEntry(r: number | null) {
    success();
    onExtra((x) => logRating(x, entry.key, r ?? 0, Date.now()));
    if (series) actions.ovUpdateSeries(entry.id, { rating: r ?? 0 }).catch(fail);
    else if (single) void rateVideo(single.video, r);
  }
  function statusEntry(s: OvStatus | null) {
    tick();
    if (series) actions.ovUpdateSeries(entry.id, { status: s }).catch(fail);
    else if (single) void statusVideo(single.video, s);
  }

  function pickStatus() {
    setOptions({
      title: 'Status',
      options: [
        ...STATUS_ORDER.map((s) => ({ label: OV_STATUS_LABELS[s], hint: entry.statusSet && entry.status === s ? 'Selected' : undefined, onPress: () => statusEntry(s) })),
        { label: 'Work it out from what I watched', hint: entry.statusSet ? undefined : 'Selected', onPress: () => statusEntry(null) },
      ],
    });
  }

  function episodeMenu(ep: OvEpisode) {
    const order = entry.episodes.map((e) => e.video.id);
    const live = ep.video.where === 'library';
    const list: OptionItem[] = [];
    if (live) list.push({ label: 'Play', onPress: () => onPlay(ep.video.id) });
    list.push({
      label: ep.video.rating > 0 ? `Change rating (★ ${fmtStars(ep.video.rating)})` : 'Rate episode',
      onPress: () => setRating({ title: `Episode ${ep.number}`, value: ep.video.rating, onPick: (r) => void rateVideo(ep.video, r) }),
    });
    list.push({
      label: ep.watched ? 'Mark not watched' : 'Mark watched',
      onPress: () => void statusVideo(ep.video, ep.watched ? null : 'completed'),
    });
    list.push({
      label: 'Rename episode',
      onPress: () =>
        setPrompt({
          title: `Episode ${ep.number}`,
          initial: members.find((m) => m.videoId === ep.video.id)?.label ?? '',
          placeholder: videoName(ep.video),
          onSubmit: (v) => actions.ovEpisodeName(ep.video.id, v).catch(fail),
        }),
    });
    if (ep.number > 1) list.push({ label: 'Move up', onPress: () => actions.ovReorder(entry.id, moveEpisode(order, ep.video.id, -1)).catch(fail) });
    if (ep.number < order.length) list.push({ label: 'Move down', onPress: () => actions.ovReorder(entry.id, moveEpisode(order, ep.video.id, 1)).catch(fail) });
    if (typeof ep.video.thumb === 'string' && ep.video.thumb)
      list.push({ label: 'Use as the series picture', onPress: () => actions.ovSeriesCover(entry.id, { uri: ep.video.thumb as string }).catch(fail) });
    list.push({ label: 'Take out of the series', hint: 'The video stays', danger: true, onPress: () => actions.ovRemoveFromSeries([ep.video.id]).catch(fail) });
    setOptions({ title: ep.name, options: list });
  }

  function groupMenu() {
    if (!single) return;
    setOptions({
      title: 'Add to a series',
      options: allSeries.map((s) => ({
        label: s.title,
        hint: `${s.episodes.length} episodes`,
        onPress: () =>
          actions
            .ovAddToSeries(s.id, [single.video.id])
            .then(() => onOpen(s.key))
            .catch(fail),
      })),
    });
  }

  function confirmUngroup() {
    setOptions({
      title: `Ungroup "${entry.title}"?`,
      options: [
        {
          label: 'Ungroup',
          hint: 'The series and its rating go; the videos stay with their own ratings',
          danger: true,
          onPress: () =>
            actions
              .ovDeleteSeries(entry.id)
              .then(() => onOpen(null))
              .catch(fail),
        },
      ],
    });
  }

  function confirmForget() {
    const ids = entry.episodes.filter((e) => e.video.where === 'kept').map((e) => e.video.id);
    setOptions({
      title: ids.length > 1 ? `Forget ${ids.length} removed videos?` : 'Forget this removed video?',
      options: [
        {
          label: 'Forget',
          hint: 'Its rating and info are deleted too. This cannot be undone.',
          danger: true,
          onPress: () =>
            actions
              .ovForget(ids)
              .then(() => !series && onOpen(null))
              .catch(fail),
        },
      ],
    });
  }

  /* ------------------------------------------------------------- render */

  const word = ratingLabel(entry.rating, labels);
  const kept = entry.episodes.filter((e) => e.video.where === 'kept');
  const inTrash = single?.video.where === 'trash';
  const playTarget = playable(entry);
  const canPlay = playTarget?.video.where === 'library';
  const heroItem = canPlay && playTarget ? items.find((i) => i.id === playTarget.video.id) : undefined;
  const review = extra.reviews[entry.key];
  const rewatches = extra.rewatches[entry.key] ?? [];
  const progress = series && entry.episodes.length ? entry.watchedCount / entry.episodes.length : 0;
  const facts: [string, string][] = [
    ['Plays', String(entry.plays)],
    ['Watched', fmtMs(entry.watchedMs)],
    ['Length', entry.totalMs ? fmtMs(entry.totalMs) : '–'],
    ['Last watched', entry.lastWatchedAt ? ago(entry.lastWatchedAt) : 'Never'],
    ['Added', entry.addedAt ? day(entry.addedAt) : '–'],
  ];

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <LiveProvider value={live.value}>
      <View style={styles.screen}>
        <ScrollView {...live.scrollProps} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>
          <View style={styles.hero}>
            {heroItem ? (
              <LiveCard
                id={`ov-detail-${entry.key}`}
                uri={heroItem.uri}
                durationMs={heroItem.durationMs}
                cover={heroItem.thumbSource}
                video={heroItem}
                radius={0}
                priority={5}
                clipMs={20_000}
                style={styles.fill}
                soundStyle={{ top: 12, left: 14, right: undefined }}
              />
            ) : entry.cover ? (
              <Image source={entry.cover} style={styles.fill} contentFit="cover" blurRadius={28} />
            ) : (
              <View style={[styles.fill, { backgroundColor: p.elevated }]} />
            )}
            <Fade color="0,0,0" from={0.1} to={0.5} style={styles.fill} />
            <Fade color={hexRgb(p.bg)} from={0} to={1} style={[styles.fill, { top: '52%' }]} />
            <View style={styles.heroBody}>
              <Cover source={entry.cover} title={entry.title} width={118} height={168} radius={12} />
              <View style={styles.heroText}>
                <Text style={styles.kind}>{series ? `SERIES · ${entry.episodes.length} EPISODES` : 'VIDEO'}</Text>
                <Text style={styles.heroTitle} numberOfLines={3}>
                  {entry.title}
                </Text>
                <Text style={[styles.heroStatus, { color: statusColor(p, entry.status) }]}>
                  {OV_STATUS_LABELS[entry.status]}
                  {!entry.statusSet ? <Text style={styles.heroAuto}> · from what you watched</Text> : null}
                </Text>
                {series && (
                  <View style={{ gap: 5 }}>
                    <Text style={styles.heroMeta}>
                      {entry.watchedCount} of {entry.episodes.length} watched{rewatches.length ? ` · watched again ${rewatches.length}×` : ''}
                    </Text>
                    <View style={styles.heroTrack}>
                      <View style={[styles.heroBar, { width: `${Math.round(progress * 100)}%` }]} />
                    </View>
                  </View>
                )}
                {!series && entry.rating > 0 && <Text style={styles.heroMeta}>★ {fmtStars(entry.rating)}{word ? ` · ${word}` : ''}</Text>}
              </View>
            </View>
            <View style={[styles.close, { top: 12 }]}>
              <IconButton icon="close" label="Close" clear onPress={onClose} />
            </View>
          </View>

          {!!note && <Text style={styles.note}>{note}</Text>}

          {(entry.gone || (!series && kept.length > 0)) && (
            <View style={styles.banner}>
              <Icon name="info" size={16} color={p.textSecondary} />
              <Text style={styles.bannerText}>
                Removed from ReelVault {kept[0]?.video.removedAt ? `on ${day(kept[0].video.removedAt)}` : ''}. The video is gone; its rating and info are kept.
              </Text>
            </View>
          )}
          {inTrash && (
            <View style={styles.banner}>
              <Icon name="trash" size={16} color={p.textSecondary} />
              <Text style={styles.bannerText}>In Recently Deleted. If it is removed for good, its rating and info stay here.</Text>
            </View>
          )}

          <View style={styles.actions}>
            {canPlay && playTarget && (
              <TouchableOpacity style={styles.playBtn} onPress={() => onPlay(playTarget.video.id)} accessibilityLabel="Play">
                <Icon name="play" size={16} color="#fff" />
                <Text style={styles.playText}>{series ? `${!entry.next ? 'Watch again' : entry.watchedCount > 0 ? 'Continue' : 'Play'} · Ep ${playTarget.number}` : 'Play'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.actBtn} onPress={pickStatus}>
              <Icon name="status" size={15} color={statusColor(p, entry.status)} />
              <Text style={styles.actText}>Status</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.actBtn} onPress={() => setEditing(true)}>
              <Icon name="edit" size={15} color={p.text} />
              <Text style={styles.actText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.ratingCard}
            onPress={() => setRating({ title: series ? 'Rate the series' : 'My rating', value: entry.rating, onPick: rateEntry })}
            accessibilityLabel={entry.rating ? `Your rating ${fmtStars(entry.rating)}, change` : 'Rate'}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.ratingLabel}>{series ? 'Your rating for the series' : 'Your rating'}</Text>
              {entry.rating > 0 ? (
                <Text style={styles.ratingValue}>
                  ★ {fmtStars(entry.rating)}
                  <Text style={styles.ratingOf}> / 10</Text>
                </Text>
              ) : (
                <Text style={styles.ratingEmpty}>Tap to rate</Text>
              )}
              {!!word && <Text style={styles.ratingWord}>“{word}”</Text>}
            </View>
            {series && (
              <View style={styles.avgBox}>
                <Text style={styles.avgValue}>{entry.episodeAvg !== null ? `★ ${fmtStars(entry.episodeAvg)}` : '–'}</Text>
                <Text style={styles.avgLabel}>
                  episodes{'\n'}
                  {entry.episodes.filter((e) => e.video.rating > 0).length} of {entry.episodes.length} rated
                </Text>
              </View>
            )}
            <Icon name="forward" size={14} color={p.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.reviewCard} onPress={() => setReviewing(true)} accessibilityLabel={review ? 'Edit your review' : 'Write a review'}>
            {review ? (
              <>
                <Text style={styles.reviewQuote}>“</Text>
                <Text style={styles.reviewText}>{review.text}</Text>
                <Text style={styles.reviewDate}>Your review · {day(review.at)}</Text>
              </>
            ) : (
              <View style={styles.reviewEmpty}>
                <Icon name="edit" size={16} color={p.link} />
                <Text style={styles.reviewAdd}>Write a review</Text>
                <Text style={styles.reviewAddHint}>What did you think? It shows on the card and in Wrapped.</Text>
              </View>
            )}
          </TouchableOpacity>

          {series && entry.watchedCount > 0 && (
            <View style={styles.rewatchCard}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.ratingLabel}>Rewatches</Text>
                <Text style={styles.rewatchValue}>{rewatches.length === 0 ? 'Not yet' : rewatches.length === 1 ? 'Once' : `${rewatches.length} times`}</Text>
                {rewatches.length > 0 && (
                  <Text style={styles.rewatchDates} numberOfLines={2}>
                    {rewatches
                      .slice(-4)
                      .reverse()
                      .map((t) => day(t))
                      .join(' · ')}
                  </Text>
                )}
              </View>
              <View style={{ gap: 8, alignItems: 'flex-end' }}>
                <TouchableOpacity
                  style={styles.rewatchBtn}
                  onPress={() => {
                    success();
                    onExtra((x) => addRewatch(x, entry.key, Date.now()));
                  }}
                  accessibilityLabel="I watched it all again">
                  <Icon name="rewatch" size={14} color="#fff" />
                  <Text style={styles.rewatchBtnText}>Watched it again</Text>
                </TouchableOpacity>
                {rewatches.length > 0 && (
                  <TouchableOpacity
                    hitSlop={8}
                    onPress={() => {
                      tick();
                      onExtra((x) => removeLastRewatch(x, entry.key));
                    }}>
                    <Text style={styles.rewatchUndo}>Take the last one back</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          <View style={styles.facts}>
            {facts.map(([k, v]) => (
              <View key={k} style={styles.fact}>
                <Text style={styles.factValue} numberOfLines={1}>
                  {v}
                </Text>
                <Text style={styles.factLabel}>{k}</Text>
              </View>
            ))}
          </View>

          {entry.description ? (
            <TouchableOpacity onPress={() => setEditing(true)}>
              <Text style={styles.desc}>{entry.description}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => setEditing(true)}>
              <Text style={styles.addDesc}>+ Add a description</Text>
            </TouchableOpacity>
          )}

          {entry.tags.length > 0 && (
            <View style={styles.tags}>
              {entry.tags.map((t) => (
                <View key={t} style={styles.tag}>
                  <Text style={styles.tagText}>{t}</Text>
                </View>
              ))}
            </View>
          )}

          {series && (
            <>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Episodes</Text>
                <Text style={styles.sectionDetail}>{entry.episodes.length}</Text>
                <TouchableOpacity style={styles.sectionAction} onPress={() => setAdding('add')} hitSlop={8}>
                  <Icon name="plus" size={14} color={p.link} />
                  <Text style={styles.sectionActionText}>Add videos</Text>
                </TouchableOpacity>
              </View>
              {entry.episodes.length === 0 && <Text style={styles.hint}>No episodes yet. Add videos to this series.</Text>}
              {entry.episodes.length > 1 && (
                <EpisodeChart
                  episodes={entry.episodes}
                  seriesRating={entry.rating}
                  onRate={(ep) => setRating({ title: `Episode ${ep.number}`, value: ep.video.rating, onPick: (r) => void rateVideo(ep.video, r) })}
                />
              )}
              {entry.episodes.map((ep) => (
                <EpisodeRow
                  key={ep.video.id}
                  ep={ep}
                  labels={labels}
                  onPress={() => (ep.video.where === 'library' ? onPlay(ep.video.id) : episodeMenu(ep))}
                  onMore={() => episodeMenu(ep)}
                  onRate={() => setRating({ title: `Episode ${ep.number}`, value: ep.video.rating, onPick: (r) => void rateVideo(ep.video, r) })}
                  onToggle={() => {
                    tick();
                    void statusVideo(ep.video, ep.watched ? null : 'completed');
                  }}
                />
              ))}
              <Text style={styles.hint}>Tap an episode to play it. ★ rates just that episode; the rating above is for the whole series.</Text>
            </>
          )}

          {!series && single && (
            <View style={styles.groupBox}>
              <Text style={styles.groupTitle}>Part of something bigger?</Text>
              <Text style={styles.groupHint}>Group videos that belong together into a series. It gets its own rating, and every video keeps its own as an episode.</Text>
              <View style={styles.groupBtns}>
                <TouchableOpacity style={styles.groupBtn} onPress={() => setAdding('make')}>
                  <Icon name="lists" size={15} color={p.text} />
                  <Text style={styles.groupBtnText}>Make a series</Text>
                </TouchableOpacity>
                {allSeries.length > 0 && (
                  <TouchableOpacity style={styles.groupBtn} onPress={groupMenu}>
                    <Icon name="listAdd" size={15} color={p.text} />
                    <Text style={styles.groupBtnText}>Add to a series</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          <View style={styles.danger}>
            {series && (
              <TouchableOpacity onPress={confirmUngroup}>
                <Text style={styles.dangerText}>Ungroup series</Text>
              </TouchableOpacity>
            )}
            {kept.length > 0 && (
              <TouchableOpacity onPress={confirmForget}>
                <Text style={styles.dangerText}>{series ? `Forget ${kept.length} removed episode${kept.length > 1 ? 's' : ''}` : 'Forget this video'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>

        {editing && (
          <EditSheet
            entry={entry}
            items={items}
            actions={actions}
            onClose={() => setEditing(false)}
            onError={fail}
          />
        )}
        {adding && (
          <SeriesMaker
            title={adding === 'add' ? `Add to ${entry.title}` : 'New series'}
            askName={adding === 'make'}
            initialName={adding === 'make' && single ? guessSeriesName([videoName(single.video)]) : ''}
            initialIds={adding === 'make' && single ? [single.video.id] : []}
            videos={videos}
            members={members}
            series={entries.filter((e) => e.kind === 'series').map((e) => ({ id: e.id, name: e.title }))}
            hideIds={series ? entry.episodes.map((e) => e.video.id) : []}
            onClose={() => setAdding(null)}
            onDone={async (name, ids) => {
              if (adding === 'add') {
                await actions.ovAddToSeries(entry.id, ids);
                setAdding(null);
              } else {
                const id = await actions.ovCreateSeries(name, ids);
                setAdding(null);
                onOpen(`s:${id}`);
              }
            }}
          />
        )}
        {reviewing && (
          <ReviewSheet
            title={entry.title}
            initial={review?.text ?? ''}
            onSave={(text) => {
              success();
              onExtra((x) => setReview(x, entry.key, text, Date.now()));
            }}
            onClose={() => setReviewing(false)}
          />
        )}
        {rating && <RatingPicker title={rating.title} value={rating.value} onPick={rating.onPick} onClose={() => setRating(null)} />}
        {options && <OptionsSheet title={options.title} options={options.options} onClose={() => setOptions(null)} />}
        {prompt && (
          <PromptSheet
            title={prompt.title}
            initial={prompt.initial}
            placeholder={prompt.placeholder}
            message="Leave it as the video's own name, or give the episode a name of its own."
            onSubmit={prompt.onSubmit}
            onClose={() => setPrompt(null)}
          />
        )}
      </View>
      </LiveProvider>
    </Modal>
  );
}

/** Every episode's rating as a bar (tap one to rate it), with the series' own rating as a line. */
function EpisodeChart({ episodes, seriesRating, onRate }: { episodes: OvEpisode[]; seriesRating: number; onRate: (ep: OvEpisode) => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const H = 96;
  const rated = episodes.filter((e) => e.video.rating > 0);
  const best = rated.length ? rated.reduce((a, b) => (b.video.rating > a.video.rating ? b : a)) : null;
  const { width } = useWindowDimensions();
  const col = Math.max(22, Math.min(64, Math.floor((width - SIDE * 2 - 28) / episodes.length) - 4));
  return (
    <View style={styles.chart}>
      <View style={styles.chartHead}>
        <Text style={styles.ratingLabel}>Episode ratings</Text>
        <Text style={styles.chartSub}>
          {rated.length ? `${rated.length} of ${episodes.length} rated${best ? ` · best: Ep ${best.number} (★ ${fmtStars(best.video.rating)})` : ''}` : 'Tap a bar to rate that episode'}
        </Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 8 }}>
        <View style={{ height: H + 34, flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
          {seriesRating > 0 && (
            <View pointerEvents="none" style={[styles.chartLine, { bottom: 18 + (seriesRating / 10) * H, width: episodes.length * (col + 4) }]}>
              <Text style={styles.chartLineText}>series ★ {fmtStars(seriesRating)}</Text>
            </View>
          )}
          {episodes.map((ep, i) => {
            const r = ep.video.rating;
            return (
              <TouchableOpacity key={ep.video.id} onPress={() => onRate(ep)} style={{ width: col, alignItems: 'center' }} accessibilityLabel={`Episode ${ep.number}, ${r ? `rated ${fmtStars(r)}` : 'not rated'}`}>
                <Text style={[styles.chartValue, !r && { color: p.textMuted }]}>{r ? fmtStars(r) : '–'}</Text>
                {r ? (
                  <GrowColumn ratio={r / 10} height={H} width="72%" radius={4} delay={120 + i * 30} color={r >= 8 ? p.rating : r >= 5 ? `${p.rating}AA` : `${p.rating}66`} />
                ) : (
                  <View style={[styles.chartEmpty, { height: 6 }]} />
                )}
                <Text style={[styles.chartNum, ep.watched && { color: p.text }]}>{ep.number}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

/** A short review of the title. Empty and saved = no review. */
function ReviewSheet({ title, initial, onSave, onClose }: { title: string; initial: string; onSave: (text: string) => void; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [text, setText] = useState(initial);
  return (
    <SheetFrame
      title={initial ? 'Your review' : 'Write a review'}
      onClose={onClose}
      action={{
        label: 'Save',
        disabled: text.trim() === initial.trim(),
        onPress: () => {
          onSave(text);
          onClose();
        },
      }}>
      <Section label={title}>
        <TextInput
          style={[styles.input, styles.inputMulti, { minHeight: 150 }]}
          value={text}
          onChangeText={setText}
          placeholder="What did you think of it? What stood out?"
          placeholderTextColor={p.textMuted}
          keyboardAppearance={p.scheme}
          multiline
          autoFocus
          maxLength={2000}
        />
        <Text style={styles.hint}>{text.trim().length} / 2000 · it shows on the card and in Wrapped</Text>
      </Section>
      {!!initial && (
        <TouchableOpacity
          onPress={() => {
            onSave('');
            onClose();
          }}
          style={{ paddingHorizontal: 4, paddingTop: 6 }}>
          <Text style={styles.dangerText}>Delete review</Text>
        </TouchableOpacity>
      )}
    </SheetFrame>
  );
}

function EpisodeRow({
  ep,
  labels,
  onPress,
  onMore,
  onRate,
  onToggle,
}: {
  ep: OvEpisode;
  labels: RatingLabels;
  onPress: () => void;
  onMore: () => void;
  onRate: () => void;
  onToggle: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const gone = ep.video.where === 'kept';
  const word = ratingLabel(ep.video.rating, labels);
  return (
    <TouchableOpacity style={styles.ep} onPress={onPress} onLongPress={onMore} accessibilityLabel={`Episode ${ep.number}, ${ep.name}`}>
      <TouchableOpacity onPress={onToggle} hitSlop={8} accessibilityLabel={ep.watched ? 'Mark not watched' : 'Mark watched'}>
        <View style={[styles.epNum, ep.watched && styles.epNumOn]}>
          {ep.watched ? <Icon name="check" size={13} color="#fff" weight="bold" /> : <Text style={styles.epNumText}>{ep.number}</Text>}
        </View>
      </TouchableOpacity>
      <View style={styles.epThumb}>
        <Cover source={ep.video.thumb} title={ep.name} width={104} height={58} radius={8} hideTitle>
          {gone && <View style={styles.epGone} />}
          {!gone && (ep.watched || ep.watchedMs > 0) && (
            <View style={styles.epTrack}>
              <View style={[styles.epBar, { width: `${ep.watched ? 100 : Math.min(100, Math.round((ep.watchedMs / Math.max(1, ep.video.durationMs ?? ep.watchedMs)) * 100))}%` }]} />
            </View>
          )}
          {!!ep.video.durationMs && (
            <View style={styles.epDur}>
              <Text style={styles.epDurText}>{fmtMs(ep.video.durationMs)}</Text>
            </View>
          )}
        </Cover>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.epName, gone && { color: p.textSecondary }]} numberOfLines={2}>
          {ep.name}
        </Text>
        <Text style={styles.epMeta} numberOfLines={1}>
          {gone ? 'Removed · ' : ep.video.where === 'trash' ? 'In Recently Deleted · ' : ''}
          {ep.plays ? `${ep.plays} play${ep.plays > 1 ? 's' : ''}` : 'Not played'}
          {word ? ` · ${word}` : ''}
        </Text>
      </View>
      <TouchableOpacity style={[styles.epRate, ep.video.rating > 0 && styles.epRateOn]} onPress={onRate} hitSlop={6} accessibilityLabel="Rate episode">
        <Text style={[styles.epRateText, ep.video.rating > 0 && { color: p.rating }]}>{ep.video.rating > 0 ? `★ ${fmtStars(ep.video.rating)}` : '☆'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onMore} hitSlop={8} accessibilityLabel="More">
        <Icon name="more" size={16} color={p.textSecondary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

/** Name, picture and description, for a series or a single video. */
function EditSheet({
  entry,
  items,
  actions,
  onClose,
  onError,
}: {
  entry: OvEntry;
  items: VaultItem[];
  actions: VaultActions;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const series = entry.kind === 'series';
  const video = !series ? entry.episodes[0]?.video : null;
  const item = video ? items.find((i) => i.id === video.id) : undefined;
  const [name, setName] = useState(series ? entry.title : (video?.title ?? ''));
  const [desc, setDesc] = useState(entry.description ?? '');
  const pictures = useMemo(
    () => (series ? entry.episodes.map((e) => e.video.thumb).filter((t): t is string => typeof t === 'string' && !!t) : []),
    [series, entry.episodes]
  );

  async function save() {
    try {
      if (series) await actions.ovUpdateSeries(entry.id, { name: name.trim() || entry.title, description: desc });
      else if (video?.where === 'kept') await actions.ovUpdateKept(video.id, { title: name, notes: desc });
      else if (video) {
        await actions.onSetText([video.id], 'title', name.trim());
        await actions.onSetText([video.id], 'notes', desc.trim());
      }
      success();
      onClose();
    } catch (e) {
      onError(e);
    }
  }

  const pickPhoto = () => {
    const job = series
      ? actions.ovSeriesCover(entry.id, 'photo')
      : video?.where === 'kept'
        ? actions.ovKeptCover(video.id)
        : item
          ? actions.onPickCover(item)
          : Promise.resolve(false);
    job.catch(onError);
  };

  return (
    <SheetFrame title={series ? 'Edit series' : 'Edit video'} onClose={onClose} action={{ label: 'Save', onPress: () => void save() }}>
      <Section label="Picture">
        <View style={styles.editPic}>
          <Cover source={entry.cover} title={name || entry.title} width={86} height={122} radius={10} />
          <View style={{ flex: 1, gap: 8 }}>
            <TouchableOpacity style={styles.editBtn} onPress={pickPhoto}>
              <Icon name="import" size={15} color={p.text} />
              <Text style={styles.editBtnText}>Choose a photo</Text>
            </TouchableOpacity>
            {series && entry.cover && (
              <TouchableOpacity style={styles.editBtn} onPress={() => actions.ovSeriesCover(entry.id, null).catch(onError)}>
                <Icon name="rewatch" size={15} color={p.text} />
                <Text style={styles.editBtnText}>Use the first episode</Text>
              </TouchableOpacity>
            )}
            {!series && item?.customCover && (
              <TouchableOpacity style={styles.editBtn} onPress={() => actions.onResetCover(item).catch(onError)}>
                <Icon name="rewatch" size={15} color={p.text} />
                <Text style={styles.editBtnText}>Back to the video's frame</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {pictures.length > 1 && (
          <>
            <Text style={styles.hint}>Or use an episode's picture:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {pictures.map((uri, i) => (
                <TouchableOpacity key={`${uri}-${i}`} onPress={() => actions.ovSeriesCover(entry.id, { uri }).catch(onError)} accessibilityLabel={`Episode ${i + 1} picture`}>
                  <Image source={uri} style={styles.editThumb} contentFit="cover" />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}
      </Section>
      <Section label="Name">
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder={video ? videoName({ title: null, filename: video.filename }) : 'Series name'}
          placeholderTextColor={p.textMuted}
          keyboardAppearance={p.scheme}
          maxLength={120}
        />
        {!series && <Text style={styles.hint}>Empty = the file name. The name is also shown in Watch mode.</Text>}
      </Section>
      <Section label="Description">
        <TextInput
          style={[styles.input, styles.inputMulti]}
          value={desc}
          onChangeText={setDesc}
          placeholder={series ? 'What is this series?' : 'Notes about this video'}
          placeholderTextColor={p.textMuted}
          keyboardAppearance={p.scheme}
          multiline
          maxLength={2000}
        />
      </Section>
    </SheetFrame>
  );
}

/** Pick videos for a new series, or to add to one. Episodes are ordered by name ("Part 2" before "Part 10"). */
export function SeriesMaker({
  title,
  askName = true,
  initialName,
  initialIds,
  videos,
  members,
  series,
  hideIds = [],
  onClose,
  onDone,
}: {
  title: string;
  askName?: boolean;
  initialName: string;
  initialIds: string[];
  videos: OvVideo[];
  members: OvMember[];
  series: Pick<OvSeries, 'id' | 'name'>[];
  hideIds?: string[];
  onClose: () => void;
  onDone: (name: string, ids: string[]) => Promise<void>;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [name, setName] = useState(initialName);
  const [picked, setPicked] = useState<string[]>(initialIds);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const seriesOf = useMemo(() => {
    const names = new Map(series.map((s) => [s.id, s.name]));
    return new Map(members.map((m) => [m.videoId, names.get(m.seriesId) ?? 'a series']));
  }, [members, series]);
  const choices = useMemo(() => {
    const q = query.trim().toLowerCase();
    return episodeOrder(videos.filter((v) => !v.isPrivate && v.where !== 'trash' && !hideIds.includes(v.id))).filter(
      (v) => !q || `${videoName(v)} ${v.filename} ${v.tagNames.join(' ')}`.toLowerCase().includes(q)
    );
  }, [videos, hideIds, query]);
  const chosen = episodeOrder(videos.filter((v) => picked.includes(v.id)));
  const guess = guessSeriesName(chosen.map(videoName));

  const toggle = (id: string) => {
    tick();
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  };

  return (
    <SheetFrame
      title={title}
      onClose={onClose}
      action={{
        label: askName ? 'Create' : 'Add',
        disabled: picked.length === 0,
        onPress: () => {
          onDone(name.trim() || guess || 'New series', chosen.map((v) => v.id)).catch((e) => setError(String(e?.message ?? e)));
        },
      }}>
      {!!error && <Text style={styles.note}>{error}</Text>}
      {askName && (
        <Section label="Series name">
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={guess || 'e.g. Cooking class'}
            placeholderTextColor={p.textMuted}
            keyboardAppearance={p.scheme}
            maxLength={120}
          />
        </Section>
      )}
      <Section label={`Videos · ${picked.length} chosen`}>
        <View style={styles.pickSearch}>
          <Icon name="search" size={15} color={p.textMuted} />
          <TextInput
            style={styles.pickInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Find videos"
            placeholderTextColor={p.textMuted}
            keyboardAppearance={p.scheme}
            autoCorrect={false}
          />
        </View>
        {chosen.length > 0 && <Text style={styles.hint}>Order: {chosen.map((v, i) => `${i + 1}. ${videoName(v)}`).join('   ')}</Text>}
        <View style={styles.pickList}>
          {choices.slice(0, 300).map((v) => {
            const on = picked.includes(v.id);
            const other = seriesOf.get(v.id);
            return (
              <TouchableOpacity key={v.id} style={styles.pickRow} onPress={() => toggle(v.id)} accessibilityLabel={videoName(v)} accessibilityState={{ selected: on }}>
                <Cover source={v.thumb} title={videoName(v)} width={64} height={40} radius={6} hideTitle />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickName} numberOfLines={1}>
                    {videoName(v)}
                  </Text>
                  <Text style={styles.pickSub} numberOfLines={1}>
                    {[v.durationMs ? fmtMs(v.durationMs) : null, v.where === 'kept' ? 'Removed' : null, other ? `in ${other}, moves here` : null, v.rating ? `★ ${fmtStars(v.rating)}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Icon name={on ? 'checkCircle' : 'circle'} size={22} color={on ? p.accent : p.textMuted} />
              </TouchableOpacity>
            );
          })}
          {choices.length === 0 && <Text style={[styles.hint, { padding: 14 }]}>No videos to add.</Text>}
        </View>
      </Section>
    </SheetFrame>
  );
}

function hexRgb(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    hero: { minHeight: 360, justifyContent: 'flex-end', overflow: 'hidden' },
    heroTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden', marginTop: 2 },
    heroBar: { height: 4, borderRadius: 2, backgroundColor: p.success },

    reviewCard: { marginHorizontal: SIDE, marginTop: 10, padding: 16, borderRadius: 16, backgroundColor: p.elevated },
    reviewQuote: { color: p.rating, fontSize: 40, fontWeight: '900', lineHeight: 36, height: 26 },
    reviewText: { color: p.text, fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
    reviewDate: { color: p.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 8 },
    reviewEmpty: { gap: 3 },
    reviewAdd: { color: p.link, fontSize: 16, fontWeight: '800' },
    reviewAddHint: { color: p.textSecondary, fontSize: 12 },

    rewatchCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: SIDE, marginTop: 10, padding: 16, borderRadius: 16, backgroundColor: p.elevated },
    rewatchValue: { color: p.text, fontSize: 22, fontWeight: '900', letterSpacing: -0.4 },
    rewatchDates: { color: p.textSecondary, fontSize: 12 },
    rewatchBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    rewatchBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    rewatchUndo: { color: p.textSecondary, fontSize: 12, fontWeight: '600' },

    chart: { marginHorizontal: SIDE, marginBottom: 8, padding: 14, borderRadius: 16, backgroundColor: p.elevated, gap: 10 },
    chartHead: { gap: 2 },
    chartSub: { color: p.textSecondary, fontSize: 12 },
    chartValue: { color: p.text, fontSize: 10, fontWeight: '800', marginBottom: 3 },
    chartEmpty: { width: '72%', borderRadius: 3, backgroundColor: p.card },
    chartNum: { color: p.textSecondary, fontSize: 11, fontWeight: '700', marginTop: 4, height: 14 },
    chartLine: { position: 'absolute', left: 0, borderTopWidth: 1, borderStyle: 'dashed', borderTopColor: p.textSecondary, zIndex: 2 },
    chartLineText: { position: 'absolute', right: 0, top: -15, color: p.textSecondary, fontSize: 10, fontWeight: '700' },
    heroBody: { flexDirection: 'row', gap: 16, alignItems: 'flex-end', paddingHorizontal: SIDE, paddingTop: 70, paddingBottom: 6 },
    heroText: { flex: 1, gap: 4, paddingBottom: 4 },
    kind: { color: p.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
    heroTitle: { color: p.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
    heroStatus: { fontSize: 14, fontWeight: '700' },
    heroAuto: { color: p.textSecondary, fontWeight: '600', fontSize: 12 },
    heroMeta: { color: p.textSoft, fontSize: 13, fontWeight: '600' },
    close: { position: 'absolute', right: 14 },
    note: { color: p.link, fontSize: 13, fontWeight: '600', paddingHorizontal: SIDE, paddingTop: 8 },

    banner: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginHorizontal: SIDE, marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: p.elevated },
    bannerText: { flex: 1, color: p.textSoft, fontSize: 13 },

    actions: { flexDirection: 'row', gap: 8, paddingHorizontal: SIDE, paddingTop: 16 },
    playBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: p.accent, borderRadius: 14, paddingVertical: 13 },
    playText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    actBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.elevated, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13 },
    actText: { color: p.text, fontSize: 15, fontWeight: '700' },

    ratingCard: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: SIDE, marginTop: 14, padding: 16, borderRadius: 16, backgroundColor: p.elevated },
    ratingLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    ratingValue: { color: p.rating, fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
    ratingOf: { color: p.textMuted, fontSize: 16, fontWeight: '700' },
    ratingEmpty: { color: p.link, fontSize: 20, fontWeight: '800' },
    ratingWord: { color: p.textSoft, fontSize: 14, fontWeight: '600', fontStyle: 'italic' },
    avgBox: { alignItems: 'flex-end', gap: 2, paddingLeft: 14, borderLeftWidth: 1, borderLeftColor: p.separator },
    avgValue: { color: p.text, fontSize: 18, fontWeight: '800' },
    avgLabel: { color: p.textSecondary, fontSize: 11, textAlign: 'right' },

    facts: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SIDE - 4, paddingTop: 12 },
    fact: { width: '33.33%', paddingHorizontal: 4, paddingVertical: 6 },
    factValue: { color: p.text, fontSize: 15, fontWeight: '800' },
    factLabel: { color: p.textSecondary, fontSize: 11, fontWeight: '600' },

    desc: { color: p.textSoft, fontSize: 15, lineHeight: 21, paddingHorizontal: SIDE, paddingTop: 10 },
    addDesc: { color: p.link, fontSize: 15, fontWeight: '600', paddingHorizontal: SIDE, paddingTop: 10 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: SIDE, paddingTop: 12 },
    tag: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
    tagText: { color: p.keyword, fontSize: 12, fontWeight: '700' },

    sectionHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: SIDE, paddingTop: 26, paddingBottom: 8 },
    sectionTitle: { color: p.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
    sectionDetail: { color: p.textSecondary, fontSize: 15, fontWeight: '600' },
    sectionAction: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5 },
    sectionActionText: { color: p.link, fontSize: 15, fontWeight: '600' },
    hint: { color: p.textSecondary, fontSize: 12, paddingHorizontal: SIDE, paddingTop: 8 },

    ep: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SIDE, paddingVertical: 8 },
    epNum: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: p.border, alignItems: 'center', justifyContent: 'center' },
    epNumOn: { backgroundColor: p.success, borderColor: p.success },
    epNumText: { color: p.textSoft, fontSize: 12, fontWeight: '800' },
    epThumb: {},
    epGone: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
    epTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
    epBar: { height: 3, backgroundColor: p.accent },
    epDur: { position: 'absolute', right: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1 },
    epDurText: { color: '#fff', fontSize: 10, fontWeight: '800' },
    epName: { color: p.text, fontSize: 14, fontWeight: '700' },
    epMeta: { color: p.textSecondary, fontSize: 12 },
    epRate: { minWidth: 44, alignItems: 'center', backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
    epRateOn: { backgroundColor: p.elevated },
    epRateText: { color: p.textSecondary, fontSize: 13, fontWeight: '800' },

    groupBox: { marginHorizontal: SIDE, marginTop: 22, padding: 16, borderRadius: 16, backgroundColor: p.elevated, gap: 2 },
    groupTitle: { color: p.text, fontSize: 17, fontWeight: '800' },
    groupHint: { color: p.textSecondary, fontSize: 12, paddingTop: 4 },
    groupBtns: { flexDirection: 'row', gap: 8, marginTop: 12, paddingHorizontal: 0 },
    groupBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    groupBtnText: { color: p.text, fontSize: 14, fontWeight: '700' },

    danger: { gap: 14, paddingHorizontal: SIDE, paddingTop: 28, alignItems: 'flex-start' },
    dangerText: { color: p.dangerText, fontSize: 15, fontWeight: '700' },

    editPic: { flexDirection: 'row', gap: 14, alignItems: 'center' },
    editBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
    editBtnText: { color: p.text, fontSize: 14, fontWeight: '700' },
    editThumb: { width: 96, height: 54, borderRadius: 8 },
    input: { backgroundColor: p.card, color: p.text, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 16 },
    inputMulti: { minHeight: 96, textAlignVertical: 'top' },

    pickSearch: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 12 },
    pickInput: { flex: 1, color: p.text, fontSize: 15, paddingVertical: 9 },
    pickList: { backgroundColor: p.card, borderRadius: 14, overflow: 'hidden' },
    pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: p.separator },
    pickName: { color: p.text, fontSize: 14, fontWeight: '700' },
    pickSub: { color: p.textSecondary, fontSize: 12 },
  });
