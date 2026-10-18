/**
 * The Videos dashboard. At the top: your weekly goal ring, a memory made
 * from your videos, and what the app noticed. Then pick a period (7 days, 30 days, 12 months, all time) and read
 * how much you watched against the time before, every day or month as a
 * chart, the key numbers, memories filmed on this day, favourites to
 * rediscover, what you watched most, when you watch, your activity calendar,
 * your taste in tags, your ratings, and how complete your library is.
 * Presentational only.
 */

import { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import Animated from 'react-native-reanimated';

import { WEEKDAYS } from '@/features/simkl/insights';
import { watchHeatmap } from '@/features/simkl/logic';

import { daypart, fmtChange, libraryHealth, periodDashboard, type DashPeriod } from '../dashboard';
import { fmtMs, longestStreak, ratingLabel, videoDashboard, type RatingLabels, type VaultPlay } from '../stats';
import { streaks } from '../achievements';
import { friendlyName } from '../names';
import { noticed, onThisDay, rediscover } from '../recap';
import Heatmap from './Heatmap';
import Icon from './Icon';
import { Bars, Card, ChangePill, gradient, iconOr, PhotoCard, Ring, SectionTitle, ShareBar, StatTile } from './insightParts';
import { tick } from './haptics';
import type { Memory } from '../memories';
import { TONES } from './MemoriesUI';
import { enterUp, PressableScale } from './motion';
import { Aurora, CountUp, hexA, KenBurns, Pulse } from './storyKit';
import { Segment } from './sheets';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

const PERIODS: { key: DashPeriod; label: string }[] = [
  { key: 'week', label: '7 days' },
  { key: 'month', label: '30 days' },
  { key: 'year', label: '12 months' },
  { key: 'all', label: 'All time' },
];

const PERIOD_NAME: Record<DashPeriod, string> = { week: 'the 7 days before', month: 'the 30 days before', year: 'the year before', all: '' };

const hourLabel = (h: number) => new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

export default function Dashboard({
  items,
  plays,
  labels,
  thumbs,
  goalMin,
  onGoal,
  memory = null,
  onMemory,
  onAllMemories,
  onOpen,
}: {
  items: VaultItem[];
  plays: VaultPlay[];
  labels: RatingLabels;
  thumbs: Map<string, VaultItem['thumbSource']>;
  /** Weekly watch-time goal, in minutes. */
  goalMin: number;
  onGoal: (min: number) => void;
  /** The memory to feature, and what tapping it or "See all" does. */
  memory?: Memory | null;
  onMemory?: (m: Memory) => void;
  onAllMemories?: () => void;
  onOpen: (id: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();
  const [period, setPeriod] = useState<DashPeriod>('month');
  const now = Date.now();

  const d = useMemo(() => periodDashboard(period, items, plays, now), [period, items, plays]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => videoDashboard(items, plays), [items, plays]);
  const health = useMemo(() => libraryHealth(items, plays), [items, plays]);
  const own = useMemo(() => new Set(items.map((v) => v.id)), [items]);
  const times = useMemo(() => plays.filter((x) => own.has(x.videoId)).map((x) => x.startedAt), [plays, own]);
  const streak = useMemo(() => streaks(times, now), [times]); // eslint-disable-line react-hooks/exhaustive-deps
  const heat = useMemo(() => watchHeatmap(times.map((t) => new Date(t).toISOString()), now, 18), [times]); // eslint-disable-line react-hooks/exhaustive-deps
  const part = daypart(d.peakHour);

  // This calendar week against your goal.
  const week = useMemo(() => {
    const n = new Date(now);
    const monday = new Date(n.getFullYear(), n.getMonth(), n.getDate() - ((n.getDay() + 6) % 7)).getTime();
    const ms = plays.filter((x) => own.has(x.videoId) && x.startedAt >= monday).reduce((a, x) => a + x.watchedMs, 0);
    const daysLeft = 7 - ((n.getDay() + 6) % 7);
    return { ms, daysLeft };
  }, [plays, own]); // eslint-disable-line react-hooks/exhaustive-deps
  const goalMs = goalMin * 60000;
  const toGo = Math.max(0, goalMs - week.ms);
  const notes = useMemo(() => noticed(items, plays, now, d, streak.current, fmtMs), [items, plays, d, streak.current]); // eslint-disable-line react-hooks/exhaustive-deps
  const memories = useMemo(() => onThisDay(items, now), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const again = useMemo(() => rediscover(items, plays, now), [items, plays]); // eslint-disable-line react-hooks/exhaustive-deps
  const finish = useMemo(() => {
    const byId = new Map(items.map((v) => [v.id, v]));
    const ps = plays.filter((x) => x.startedAt >= d.start && x.startedAt < d.end && (byId.get(x.videoId)?.durationMs ?? 0) > 0);
    return ps.length ? ps.reduce((a, x) => a + Math.min(1, x.watchedMs / byId.get(x.videoId)!.durationMs!), 0) / ps.length : null;
  }, [items, plays, d]);
  const cardW = Math.min(250, width * 0.62);
  const change = fmtChange(d.change, d.prevMs, d.watchedMs);
  const empty = plays.length === 0;

  if (items.length === 0) {
    return (
      <Card>
        <View style={styles.emptyHero}>
          <Icon name="dashboard" size={36} color={p.textMuted} />
          <Text style={styles.emptyTitle}>Your dashboard fills up as you go</Text>
          <Text style={styles.emptyText}>Import a few videos and watch them here. Watch time, favourites, streaks and your habits show up on this page.</Text>
        </View>
      </Card>
    );
  }

  return (
    <>
      {/* ── this week's goal ─────────────────────────────────────── */}
      <Animated.View entering={enterUp(0)} style={[styles.goal, gradient('linear-gradient(135deg, #0A84FF 0%, #3A2BB8 55%, #1A0F4A 100%)')]}>
        <Aurora colors={['#0A84FF', '#1A0F4A']} accent="#BF5AF2" width={width - 32} height={150} />
        <Ring size={112} stroke={11} progress={week.ms / goalMs} color={week.ms >= goalMs ? '#30D158' : '#FFFFFF'} track="rgba(255,255,255,0.2)">
          <Text style={styles.goalPct}>{Math.min(999, Math.round((week.ms / goalMs) * 100))}%</Text>
        </Ring>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.goalKicker}>THIS WEEK</Text>
          <CountUp to={week.ms} format={(n) => (n >= 60000 ? fmtMs(n) : `${Math.round(n / 60000)} min`)} style={styles.goalValue} />
          <Text style={styles.goalSub}>
            {week.ms >= goalMs ? 'Goal reached. Nice!' : `${fmtMs(toGo)} to go · about ${fmtMs(toGo / Math.max(1, week.daysLeft))} a day`}
          </Text>
          <View style={styles.goalRow}>
            <TouchableOpacity
              style={styles.goalBtn}
              onPress={() => {
                tick();
                onGoal(Math.max(15, goalMin - 15));
              }}
              accessibilityLabel="Lower the weekly goal">
              <Text style={styles.goalBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.goalLabel}>Goal {fmtMs(goalMs)}</Text>
            <TouchableOpacity
              style={styles.goalBtn}
              onPress={() => {
                tick();
                onGoal(Math.min(6000, goalMin + 15));
              }}
              accessibilityLabel="Raise the weekly goal">
              <Text style={styles.goalBtnText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>

      {/* ── a memory for you ─────────────────────────────────────── */}
      {memory && onMemory && (
        <Animated.View entering={enterUp(1)}>
          <PressableScale onPress={() => onMemory(memory)} scaleTo={0.97} style={[styles.memory, { backgroundColor: TONES[memory.tone % TONES.length][1] }]} accessibilityLabel={`Play memory: ${memory.title}`}>
            <KenBurns source={thumbs.get(memory.coverId)} ms={16000} seed={3} />
            <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, gradient(`linear-gradient(90deg, ${hexA(TONES[memory.tone % TONES.length][1], 0.95)} 0%, ${hexA(TONES[memory.tone % TONES.length][1], 0.55)} 55%, ${hexA(TONES[memory.tone % TONES.length][1], 0.1)} 100%)`)]} />
            <View style={{ flex: 1, gap: 3, padding: 16, justifyContent: 'flex-end' }}>
              <Text style={[styles.memoryKicker, { color: TONES[memory.tone % TONES.length][0] }]}>A MEMORY FOR YOU · {memory.kicker}</Text>
              <Text style={styles.memoryTitle} numberOfLines={2}>
                {memory.title}
              </Text>
              <Text style={styles.memorySub} numberOfLines={1}>
                {memory.subtitle}
              </Text>
            </View>
            <View style={styles.memorySide}>
              <Pulse>
                <View style={styles.memoryPlay}>
                  <Icon name="play" size={18} color="#000" />
                </View>
              </Pulse>
              {onAllMemories && (
                <TouchableOpacity onPress={onAllMemories} hitSlop={8}>
                  <Text style={styles.memoryAll}>See all</Text>
                </TouchableOpacity>
              )}
            </View>
          </PressableScale>
        </Animated.View>
      )}

      {/* ── things we noticed ────────────────────────────────────── */}
      {notes.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.noteRow} style={styles.bleed}>
          {notes.map((n, i) => (
            <Animated.View key={n.key} entering={enterUp(1 + i)}>
              <TouchableOpacity
                disabled={!n.videoId}
                onPress={() => n.videoId && onOpen(n.videoId)}
                style={[styles.note, { width: cardW }, n.tone === 'good' && { borderColor: `${p.success}66` }, n.tone === 'nudge' && { borderColor: `${p.rating}55` }]}>
                <View style={[styles.noteIcon, { backgroundColor: n.tone === 'good' ? `${p.success}26` : n.tone === 'nudge' ? `${p.rating}26` : `${p.accent}26` }]}>
                  <Icon name={iconOr(n.icon)} size={16} color={n.tone === 'good' ? p.success : n.tone === 'nudge' ? p.rating : p.accent} />
                </View>
                <Text style={styles.noteTitle} numberOfLines={1}>
                  {n.title}
                </Text>
                <Text style={styles.muted} numberOfLines={3}>
                  {n.body}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          ))}
        </ScrollView>
      )}

      <Animated.View entering={enterUp(1)}>
        <Segment options={PERIODS} value={period} onChange={setPeriod} />
      </Animated.View>

      {/* ── watch time ───────────────────────────────────────────── */}
      <Card index={1}>
        <Text style={styles.kicker}>WATCH TIME · {d.label.toUpperCase()}</Text>
        <CountUp key={period} to={d.watchedMs} format={(n) => (n >= 60000 ? fmtMs(n) : '0 min')} style={styles.hero} ms={800} />
        <View style={styles.heroRow}>
          {change ? <ChangePill text={change} up={d.change === null ? true : d.change > 0} /> : null}
          {period !== 'all' && d.prevMs !== null && (
            <Text style={styles.heroCompare} numberOfLines={1}>
              {d.prevMs ? `${fmtMs(d.prevMs)} in ${PERIOD_NAME[period]}` : `nothing in ${PERIOD_NAME[period]}`}
            </Text>
          )}
        </View>
        <Bars
          data={d.buckets.map((b) => ({
            label: b.label,
            value: b.ms,
            current: b.current,
            detail: new Date(b.key).toLocaleDateString(undefined, period === 'week' || period === 'month' ? { weekday: 'short', day: 'numeric', month: 'short' } : { month: 'long', year: 'numeric' }),
          }))}
          format={(v) => (v ? fmtMs(v) : 'nothing')}
          height={110}
        />
      </Card>

      <View style={styles.tiles}>
        <StatTile index={2} icon="play" value={String(d.plays)} label={`plays of ${d.videos} ${d.videos === 1 ? 'video' : 'videos'}`} />
        <StatTile index={3} icon="calendar" value={String(d.activeDays)} label={d.activeDays === 1 ? 'day with watching' : 'days with watching'} tint={p.link} />
        <StatTile index={4} icon="trending" value={`${streak.current} ${streak.current === 1 ? 'day' : 'days'}`} label={`streak now · best ${streak.best}`} tint="#FF9F0A" />
        <StatTile index={5} icon="hourglass" value={d.plays ? fmtMs(d.avgSittingMs) : '–'} label="an average sitting" tint="#BF5AF2" />
        <StatTile index={6} icon="checkCircle" value={finish !== null ? `${Math.round(finish * 100)} %` : '–'} label="of a video watched, on average" tint={p.success} />
        <StatTile index={7} icon="import" value={String(d.newVideos)} label={d.newVideos === 1 ? 'new video added' : 'new videos added'} tint={p.keyword} />
      </View>

      {/* ── memories ─────────────────────────────────────────────── */}
      {memories.videos.length > 0 && (
        <>
          <SectionTitle index={8} title={memories.exact ? 'On this day' : 'This week, years ago'} detail={`${memories.videos.length}`} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.noteRow} style={styles.bleed}>
            {memories.videos.slice(0, 10).map((v, i) => {
              const years = new Date(now).getFullYear() - new Date(v.createdAt).getFullYear();
              return (
                <Animated.View key={v.id} entering={enterUp(9 + i)}>
                  <PhotoCard
                    source={thumbs.get(v.id)}
                    kicker={`${years} ${years === 1 ? 'year' : 'years'} ago`}
                    value={friendlyName(v)}
                    detail={new Date(v.createdAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    icon="calendar"
                    width={cardW}
                    height={180}
                    onPress={() => onOpen(v.id)}
                  />
                </Animated.View>
              );
            })}
          </ScrollView>
        </>
      )}

      {/* ── rediscover ───────────────────────────────────────────── */}
      {again.length > 0 && (
        <>
          <SectionTitle index={10} title="Rediscover" detail="Favourites you haven't seen in a while" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.noteRow} style={styles.bleed}>
            {again.map(({ video: v, why }, i) => (
              <Animated.View key={v.id} entering={enterUp(11 + i)}>
                <PhotoCard source={thumbs.get(v.id)} kicker={v.rating >= 7 ? 'Forgotten favourite' : 'Never watched'} value={friendlyName(v)} detail={why} icon={v.rating >= 7 ? 'heart' : 'eye'} width={cardW * 0.8} height={150} onPress={() => onOpen(v.id)} />
              </Animated.View>
            ))}
          </ScrollView>
        </>
      )}

      {/* ── most watched ─────────────────────────────────────────── */}
      <Card index={6} title="Most watched" sub={d.top.length ? `${d.label} · share of your watch time` : undefined}>
        {d.top.length === 0 ? (
          <Text style={styles.muted}>{empty ? 'Nothing watched yet. Play a video and it shows up here.' : `Nothing watched in ${d.label.toLowerCase()}.`}</Text>
        ) : (
          <View style={{ gap: 12 }}>
            {d.top.map((t, i) => (
              <PressableScale key={t.id} style={styles.vrow} onPress={() => onOpen(t.id)} accessibilityLabel={`${t.label}, ${fmtMs(t.ms)}`}>
                <Text style={[styles.rank, i === 0 && { color: p.rating }]}>{i + 1}</Text>
                <Image source={thumbs.get(t.id)} style={styles.vthumb} contentFit="cover" />
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.vline}>
                    <Text style={styles.vtitle} numberOfLines={1}>
                      {t.label}
                    </Text>
                    <Text style={styles.vvalue}>{fmtMs(t.ms)}</Text>
                  </View>
                  <ShareBar ratio={t.share} color={i === 0 ? p.rating : p.accent} height={5} />
                  <Text style={styles.vsub}>
                    {t.plays} {t.plays === 1 ? 'play' : 'plays'} · {Math.round(t.share * 100)} %
                  </Text>
                </View>
              </PressableScale>
            ))}
          </View>
        )}
      </Card>

      {/* ── when ─────────────────────────────────────────────────── */}
      <Card index={7} title="When you watch" sub={d.label}>
        {part ? (
          <View style={styles.partRow}>
            <View style={styles.partIcon}>
              <Icon name={iconOr(part.icon)} size={18} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.partTitle}>{part.label}</Text>
              <Text style={styles.muted}>
                Most watching around {hourLabel(d.peakHour!)}
                {d.peakWeekday !== null ? `, and most on ${['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'][d.peakWeekday]}` : ''}.
              </Text>
            </View>
          </View>
        ) : (
          <Text style={styles.muted}>Watch a few videos to see your habits.</Text>
        )}
        <Text style={styles.chartLabel}>Time of day</Text>
        <Bars
          data={d.hours.map((m, h) => ({ label: h % 6 === 0 ? String(h).padStart(2, '0') : '', value: m * 60000, detail: `${hourLabel(h)} – ${hourLabel((h + 1) % 24)}` }))}
          format={(v) => (v ? fmtMs(v) : 'nothing')}
          height={64}
          everyLabel={1}
          highlight="#BF5AF2"
        />
        <Text style={styles.chartLabel}>Day of the week</Text>
        <Bars
          data={d.weekdays.map((m, i) => ({ label: WEEKDAYS[i].slice(0, 2), value: m * 60000, detail: WEEKDAYS[i] }))}
          format={(v) => (v ? fmtMs(v) : 'nothing')}
          height={64}
          highlight={p.link}
        />
      </Card>

      <Card index={8} title="Activity" sub={`Last 18 weeks · ${times.length} plays in total`}>
        <Heatmap columns={heat.columns} max={heat.max} rgb="10,132,255" unit={(n) => `${n} ${n === 1 ? 'play' : 'plays'}`} />
        <Text style={styles.muted}>
          Longest run: {longestStreak(times)} {longestStreak(times) === 1 ? 'day' : 'days'} in a row.
        </Text>
      </Card>

      {/* ── taste ─────────────────────────────────────────────────── */}
      <SectionTitle index={9} title="Your taste" />
      <View style={styles.tasteRow}>
        <Animated.View entering={enterUp(10)} style={[styles.taste, { ...gradient('linear-gradient(150deg, #FF375F 0%, #8E1B47 100%)') } as object]}>
          <Icon name="heart" size={16} color="rgba(255,255,255,0.85)" />
          <Text style={styles.tasteKicker}>FAVOURITE TAG</Text>
          <Text style={styles.tasteTitle} numberOfLines={1}>
            {all.favouriteTag ? `#${all.favouriteTag.tag}` : '—'}
          </Text>
          <Text style={styles.tasteSub} numberOfLines={2}>
            {all.favouriteTag
              ? all.favouriteTag.avgRating !== null
                ? `Rated ★ ${all.favouriteTag.avgRating.toFixed(1)} on average, ${all.favouriteTag.videos} videos`
                : `${all.favouriteTag.videos} videos`
              : 'Tag and rate some videos'}
          </Text>
        </Animated.View>
        <Animated.View entering={enterUp(11)} style={[styles.taste, { ...gradient('linear-gradient(150deg, #0A84FF 0%, #1B2F8E 100%)') } as object]}>
          <Icon name="play" size={16} color="rgba(255,255,255,0.85)" />
          <Text style={styles.tasteKicker}>WATCHED MOST</Text>
          <Text style={styles.tasteTitle} numberOfLines={1}>
            {all.mostWatchedTag ? `#${all.mostWatchedTag.tag}` : '—'}
          </Text>
          <Text style={styles.tasteSub} numberOfLines={2}>
            {all.mostWatchedTag ? `${fmtMs(all.mostWatchedTag.watchedMs)} over ${all.mostWatchedTag.plays} plays` : 'Play some tagged videos'}
          </Text>
        </Animated.View>
      </View>
      {d.topTags.length > 0 && (
        <Card index={12} title="Tags you watched" sub={d.label}>
          <View style={{ gap: 10 }}>
            {d.topTags.map((t) => (
              <View key={t.tag} style={{ gap: 5 }}>
                <View style={styles.vline}>
                  <Text style={styles.tagName}>#{t.tag}</Text>
                  <Text style={styles.vvalue}>
                    {fmtMs(t.ms)} · {Math.round(t.share * 100)} %
                  </Text>
                </View>
                <ShareBar ratio={t.share} color={p.keyword} />
              </View>
            ))}
          </View>
        </Card>
      )}

      {/* ── ratings ──────────────────────────────────────────────── */}
      <Card index={13} title="Your ratings" sub={`${all.rated} of ${all.videos} videos rated`}>
        <View style={styles.rateRow}>
          <View style={styles.rateBig}>
            <Text style={styles.rateValue}>{all.avgRating !== null ? all.avgRating.toFixed(1) : '–'}</Text>
            <Text style={styles.rateLabel}>average</Text>
          </View>
          <View style={styles.rateBig}>
            <Text style={styles.rateValue}>{health.median !== null ? (Number.isInteger(health.median) ? health.median : health.median.toFixed(1)) : '–'}</Text>
            <Text style={styles.rateLabel}>median</Text>
          </View>
          {all.avgRating !== null && !!ratingLabel(all.avgRating, labels) && (
            <Text style={styles.rateWord} numberOfLines={2}>
              “{ratingLabel(all.avgRating, labels)}” on average
            </Text>
          )}
        </View>
        <Bars
          data={all.ratingHistogram.map((value, i) => ({ label: String(i + 1), value, detail: ratingLabel(i + 1, labels) ? `★ ${i + 1} · ${ratingLabel(i + 1, labels)}` : `★ ${i + 1}` }))}
          format={(v) => `${v} ${v === 1 ? 'video' : 'videos'}`}
          height={80}
          highlight={p.rating}
          everyLabel={1}
        />
        {all.topRated.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={styles.chartLabel}>Highest rated</Text>
            {all.topRated.slice(0, 3).map((r) => (
              <PressableScale key={r.key} style={styles.vrow} onPress={() => onOpen(r.key)}>
                <Image source={thumbs.get(r.key)} style={styles.vthumbSmall} contentFit="cover" />
                <Text style={[styles.vtitle, { flex: 1 }]} numberOfLines={1}>
                  {r.label}
                </Text>
                <Text style={[styles.vvalue, { color: p.rating }]}>★ {Number.isInteger(r.value) ? r.value : r.value.toFixed(1)}</Text>
              </PressableScale>
            ))}
          </View>
        )}
      </Card>

      {/* ── library ──────────────────────────────────────────────── */}
      <Card index={14} title="Your library" sub={`${health.total} videos · ${fmtMs(all.footageMs)} of footage`}>
        {(
          [
            ['Rated', health.rated, p.rating],
            ['Have keywords', health.tagged, p.keyword],
            ['Watched in ReelVault', health.watched, p.success],
          ] as const
        ).map(([label, n, color]) => (
          <View key={label} style={{ gap: 5 }}>
            <View style={styles.vline}>
              <Text style={styles.healthLabel}>{label}</Text>
              <Text style={styles.vvalue}>
                {n} · {health.total ? Math.round((n / health.total) * 100) : 0} %
              </Text>
            </View>
            <ShareBar ratio={health.total ? n / health.total : 0} color={color} />
          </View>
        ))}
        {d.newVideos > 0 && (
          <Text style={styles.muted}>
            {d.newVideos} new {d.newVideos === 1 ? 'video' : 'videos'} in {d.label.toLowerCase()}.
          </Text>
        )}
      </Card>

      {all.tags.length > 0 && (
        <Card index={15} title="Every tag">
          <View>
            <View style={[styles.trow, styles.thead]}>
              <Text style={[styles.tcell, styles.tname, styles.th]}>Tag</Text>
              <Text style={[styles.tcell, styles.th]}>Videos</Text>
              <Text style={[styles.tcell, styles.th]}>Avg ★</Text>
              <Text style={[styles.tcell, styles.th]}>Watched</Text>
            </View>
            {all.tags.slice(0, 20).map((t) => (
              <View key={t.tag} style={styles.trow}>
                <Text style={[styles.tcell, styles.tname]} numberOfLines={1}>
                  #{t.tag}
                </Text>
                <Text style={styles.tcell}>{t.videos}</Text>
                <Text style={[styles.tcell, { color: p.rating }]}>{t.avgRating !== null ? t.avgRating.toFixed(1) : '–'}</Text>
                <Text style={styles.tcell}>{t.watchedMs ? fmtMs(t.watchedMs) : '–'}</Text>
              </View>
            ))}
          </View>
        </Card>
      )}

      <Text style={styles.foot}>Watch time counts what you actually watched in ReelVault (skipped parts and short peeks under 3 s are left out).</Text>
    </>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    kicker: { color: p.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.8 },
    bleed: { marginHorizontal: -16 },
    memory: { height: 168, borderRadius: 24, overflow: 'hidden', flexDirection: 'row' },
    memoryKicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    memoryTitle: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.6, lineHeight: 27 },
    memorySub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' },
    memorySide: { justifyContent: 'space-between', alignItems: 'center', padding: 16 },
    memoryPlay: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
    memoryAll: { color: '#fff', fontSize: 13, fontWeight: '800' },
    goal: { flexDirection: 'row', alignItems: 'center', gap: 18, borderRadius: 26, padding: 18, overflow: 'hidden' },
    goalPct: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.6 },
    goalKicker: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    goalValue: { color: '#fff', fontSize: 30, fontWeight: '900', letterSpacing: -0.8 },
    goalSub: { color: 'rgba(255,255,255,0.88)', fontSize: 13, fontWeight: '600' },
    goalRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
    goalBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
    goalBtnText: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: -2 },
    goalLabel: { color: '#fff', fontSize: 13, fontWeight: '800' },
    noteRow: { gap: 10, paddingHorizontal: 16 },
    note: { backgroundColor: p.elevated, borderRadius: 18, padding: 14, gap: 6, borderWidth: 1, borderColor: 'transparent', minHeight: 132 },
    noteIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    noteTitle: { color: p.text, fontSize: 16, fontWeight: '800' },
    hero: { color: p.text, fontSize: 44, fontWeight: '900', letterSpacing: -1.5, marginTop: -6 },
    heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: -6 },
    heroCompare: { color: p.textSecondary, fontSize: 13, flexShrink: 1 },
    muted: { color: p.textSecondary, fontSize: 13, lineHeight: 18 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },

    vrow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    vline: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
    rank: { color: p.textSecondary, fontSize: 17, fontWeight: '900', width: 18, textAlign: 'center' },
    vthumb: { width: 72, height: 46, borderRadius: 9, backgroundColor: p.tile },
    vthumbSmall: { width: 48, height: 32, borderRadius: 7, backgroundColor: p.tile },
    vtitle: { color: p.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
    vsub: { color: p.textSecondary, fontSize: 12 },
    vvalue: { color: p.textSoft, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },

    partRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    partIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5E5CE6' },
    partTitle: { color: p.text, fontSize: 17, fontWeight: '800' },
    chartLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.4, marginTop: 4 },

    tasteRow: { flexDirection: 'row', gap: 10 },
    taste: { flex: 1, borderRadius: 20, padding: 14, gap: 3, minHeight: 140, justifyContent: 'flex-end' },
    tasteKicker: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '900', letterSpacing: 0.8, marginTop: 'auto' },
    tasteTitle: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
    tasteSub: { color: 'rgba(255,255,255,0.82)', fontSize: 12, fontWeight: '600' },
    tagName: { color: p.text, fontSize: 15, fontWeight: '700' },

    rateRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
    rateBig: { alignItems: 'flex-start' },
    rateValue: { color: p.rating, fontSize: 30, fontWeight: '900', letterSpacing: -0.8 },
    rateLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    rateWord: { flex: 1, color: p.textSoft, fontSize: 13, fontStyle: 'italic', textAlign: 'right' },
    healthLabel: { color: p.text, fontSize: 14, fontWeight: '700' },

    trow: { flexDirection: 'row', paddingVertical: 8, borderTopWidth: 1, borderTopColor: p.separator },
    thead: { borderTopWidth: 0 },
    th: { color: p.textSecondary, fontWeight: '700', fontSize: 12 },
    tcell: { flex: 1, color: p.textSoft, fontSize: 14, textAlign: 'right', fontVariant: ['tabular-nums'] },
    tname: { flex: 2, textAlign: 'left', color: p.text, fontWeight: '600' },

    emptyHero: { alignItems: 'center', gap: 10, paddingVertical: 24, paddingHorizontal: 10 },
    emptyTitle: { color: p.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    emptyText: { color: p.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    foot: { color: p.textMuted, fontSize: 12, textAlign: 'center', paddingHorizontal: 20, lineHeight: 17 },
  });
