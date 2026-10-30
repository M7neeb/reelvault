/**
 * The audio player: the full screen (cover or read-along, a scrubber with
 * the chapters marked on it, back 15 / forward 30, chapter jumps, speed,
 * sleep timer, bookmarks, your rating) and the mini player that stays at the
 * bottom of the Audio screen while you browse. Listening goes on with the
 * screen locked; the lock screen shows the chapter and the cover.
 * Presentational only (see the note at the top of types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View, type GestureResponderEvent } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { chapterIndexAt, chaptersOf, DEFAULT_AUDIO_PREFS, displayTitle, fmtClockMs, fmtLength, fmtRating, REWIND_CHOICES, SLEEP_OPTIONS, SPEEDS, type AudioPrefs } from '../../audio/audioLogic';
import { success, tick } from '../haptics';
import Icon from '../Icon';
import { OptionsSheet, PromptSheet } from '../prompts';
import RatingPicker from '../RatingPicker';
import { Modal } from '../screen';
import { Segment, SheetFrame } from '../sheets';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import AudioCover from './AudioCover';
import { AudioPhotos } from './AudioPhotos';
import type { AudioActions, AudioBookmark, AudioUiItem } from './audioTypes';
import { useAudioPlayback } from './playback';
import ReadAlong from './ReadAlong';

/** The bar at the bottom of the Audio screen: cover, title, chapter, play/pause, and a thin progress line. */
export function MiniPlayer({ onExpand, bottom }: { onExpand: () => void; bottom: number }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const pb = useAudioPlayback();
  const item = pb.item;
  const chapters = useMemo(() => (item ? chaptersOf(item) : []), [item]);
  if (!item) return null;
  const ch = chapters[chapterIndexAt(chapters, pb.overall)];
  return (
    <Animated.View entering={FadeInDown} style={[styles.mini, { bottom }]}>
      <TouchableOpacity style={styles.miniMain} onPress={onExpand} accessibilityLabel={`Open the player: ${displayTitle(item)}`}>
        <AudioCover item={item} size={42} radius={9} />
        <View style={{ flex: 1 }}>
          <Text style={styles.miniTitle} numberOfLines={1}>
            {displayTitle(item)}
          </Text>
          <Text style={styles.miniSub} numberOfLines={1}>
            {pb.error ? pb.error : ch && chapters.length > 1 ? ch.title : (item.author ?? fmtLength(pb.total))}
          </Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity hitSlop={8} onPress={() => pb.skip(-15_000)} accessibilityLabel="Back 15 seconds">
        <Icon name="back15" size={20} color={p.text} />
      </TouchableOpacity>
      <TouchableOpacity hitSlop={8} onPress={pb.toggle} style={styles.miniPlay} accessibilityLabel={pb.playing ? 'Pause' : 'Play'}>
        <Icon name={pb.playing ? 'pause' : 'play'} size={18} color={p.bg} />
      </TouchableOpacity>
      <View style={styles.miniTrack}>
        <View style={[styles.miniFill, { width: `${pb.total ? Math.min(100, (pb.overall / pb.total) * 100) : 0}%` }]} />
      </View>
    </Animated.View>
  );
}

/** A bar you tap or drag along to move through the item; chapters are little ticks. */
function Scrubber({ value, total, ticks, onSeek }: { value: number; total: number; ticks: number[]; onSeek: (ms: number) => void }) {
  const styles = useStyles(makeStyles);
  const [width, setWidth] = useState(1);
  const [drag, setDrag] = useState<number | null>(null);
  const at = (e: GestureResponderEvent) => Math.max(0, Math.min(1, e.nativeEvent.locationX / width)) * total;
  const shown = drag ?? value;
  const frac = total ? Math.min(1, shown / total) : 0;
  return (
    <View>
      <View
        style={styles.scrub}
        onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => setDrag(at(e))}
        onResponderMove={(e) => setDrag(at(e))}
        onResponderRelease={(e) => {
          const ms = at(e);
          setDrag(null);
          tick();
          onSeek(ms);
        }}
        onResponderTerminate={() => setDrag(null)}
        accessibilityRole="adjustable"
        accessibilityLabel="Position"
        accessibilityValue={{ text: `${fmtClockMs(shown)} of ${fmtClockMs(total)}` }}>
        <View style={styles.scrubTrack}>
          <View style={[styles.scrubFill, { width: `${frac * 100}%` }]} />
          {ticks.map((t, n) => (
            <View key={n} style={[styles.scrubTick, { left: `${(t / Math.max(1, total)) * 100}%` }]} />
          ))}
        </View>
        <View style={[styles.scrubKnob, { left: `${frac * 100}%` }, drag !== null && styles.scrubKnobBig]} />
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{fmtClockMs(shown)}</Text>
        <Text style={styles.time}>-{fmtClockMs(Math.max(0, total - shown))}</Text>
      </View>
    </View>
  );
}

export function AudioPlayerScreen({
  actions,
  prefs = DEFAULT_AUDIO_PREFS,
  onInfo,
  onClose,
}: {
  actions: AudioActions;
  prefs?: AudioPrefs;
  onInfo: (item: AudioUiItem) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const pb = useAudioPlayback();
  const item = pb.item;
  const [view, setView] = useState<'cover' | 'read'>(item?.kind === 'book' ? 'read' : 'cover');
  const [sheetOpen, setSheetOpen] = useState<null | 'chapters' | 'speed' | 'sleep' | 'marks' | 'rate' | 'mark-label' | 'rewind'>(null);
  const [marks, setMarks] = useState<AudioBookmark[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [boosting, setBoosting] = useState<number | null>(null);

  const chapters = useMemo(() => (item ? chaptersOf(item) : []), [item]);
  const chIndex = chapterIndexAt(chapters, pb.overall);
  const ch = chapters[chIndex];

  const loadMarks = () => {
    if (item) actions.listBookmarks(item.id).then(setMarks).catch(() => undefined);
  };
  useEffect(loadMarks, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // The sleep timer's countdown.
  useEffect(() => {
    if (!pb.sleep?.endsAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pb.sleep?.endsAt]);

  if (!item) return null;
  const left = Math.max(0, pb.total - pb.overall) / Math.max(0.5, pb.rate);
  const sleepLabel = pb.sleep ? (pb.sleep.endsAt ? fmtClockMs(Math.max(0, pb.sleep.endsAt - now)) : 'Chapter end') : 'Sleep';
  const isBook = item.kind === 'book';

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 4, paddingBottom: insets.bottom + 10 }]}>
        <View style={styles.top}>
          <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close the player">
            <Icon name="down" size={16} color={p.icon} weight="bold" />
          </TouchableOpacity>
          {isBook ? (
            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Segment
                options={[
                  { key: 'read', label: 'Read along' },
                  { key: 'cover', label: 'Cover' },
                ]}
                value={view}
                onChange={(v) => setView(v as 'cover' | 'read')}
              />
            </View>
          ) : (
            <Text style={styles.topTitle} numberOfLines={1}>
              {chapters.length > 1 ? `Chapter ${chIndex + 1} of ${chapters.length}` : 'Now playing'}
            </Text>
          )}
          <TouchableOpacity style={styles.circle} onPress={() => onInfo(item)} accessibilityLabel="Details">
            <Icon name="more" size={16} color={p.icon} />
          </TouchableOpacity>
        </View>

        <View style={{ flex: 1, justifyContent: 'center' }}>
          {isBook && view === 'read' ? (
            <ReadAlong item={item} actions={actions} />
          ) : (
            <Animated.View entering={FadeIn} style={{ alignItems: 'center', paddingHorizontal: 30 }}>
              <AudioCover item={item} size={290} radius={22} />
              <AudioPhotos itemId={item.id} actions={actions} playing={pb.playing} onToggle={pb.toggle} title={displayTitle(item)} />
            </Animated.View>
          )}
        </View>

        <View style={styles.bottom}>
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={2}>
                {displayTitle(item)}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                {[item.author, item.narrator ? `read by ${item.narrator}` : null].filter(Boolean).join(' · ') || fmtLength(pb.total)}
              </Text>
            </View>
            <TouchableOpacity style={styles.rateBtn} onPress={() => setSheetOpen('rate')} accessibilityLabel={item.rating ? `Your rating ${fmtRating(item.rating)}` : 'Rate'}>
              <Icon name={item.rating ? 'star' : 'starOff'} size={18} color={item.rating ? p.rating : p.textSecondary} />
              {item.rating > 0 && <Text style={styles.rateText}>{fmtRating(item.rating)}</Text>}
            </TouchableOpacity>
          </View>
          {ch && chapters.length > 1 && (
            <TouchableOpacity style={styles.chapter} onPress={() => setSheetOpen('chapters')}>
              <Icon name="chapters" size={13} color={p.textSecondary} />
              <Text style={styles.chapterText} numberOfLines={1}>
                {ch.title}
              </Text>
              <Text style={styles.chapterLeft}>{fmtLength(Math.max(0, ch.overallStart + ch.lengthMs - pb.overall))} left</Text>
            </TouchableOpacity>
          )}
          {!!pb.error && <Text style={styles.error}>{pb.error}</Text>}

          <Scrubber value={pb.overall} total={pb.total} ticks={chapters.length > 1 ? chapters.slice(1).map((c) => c.overallStart) : []} onSeek={pb.seekOverall} />

          <View style={styles.controls}>
            <TouchableOpacity
              hitSlop={10}
              disabled={chapters.length < 2}
              onPress={() => {
                // Back to the start of this chapter, or the one before when already near its start.
                const target = ch && pb.overall - ch.overallStart > 3000 ? ch : chapters[Math.max(0, chIndex - 1)];
                if (target) pb.seekOverall(target.overallStart);
              }}
              accessibilityLabel="Previous chapter">
              <Icon name="prevVideo" size={22} color={chapters.length < 2 ? p.textMuted : p.text} />
            </TouchableOpacity>
            <TouchableOpacity hitSlop={10} onPress={() => pb.skip(-15_000)} accessibilityLabel="Back 15 seconds">
              <Icon name="back15" size={30} color={p.text} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.play} onPress={pb.toggle} accessibilityLabel={pb.playing ? 'Pause' : 'Play'}>
              <Icon name={pb.playing ? 'pause' : 'play'} size={32} color={p.bg} />
            </TouchableOpacity>
            <TouchableOpacity hitSlop={10} onPress={() => pb.skip(30_000)} accessibilityLabel="Forward 30 seconds">
              <Icon name="forward30" size={30} color={p.text} />
            </TouchableOpacity>
            <TouchableOpacity
              hitSlop={10}
              disabled={chIndex >= chapters.length - 1}
              onPress={() => {
                const next = chapters[chIndex + 1];
                if (next) pb.seekOverall(next.overallStart);
              }}
              accessibilityLabel="Next chapter">
              <Icon name="nextVideo" size={22} color={chIndex >= chapters.length - 1 ? p.textMuted : p.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.tools}>
            <TouchableOpacity style={styles.tool} onPress={() => setSheetOpen('speed')} accessibilityLabel={`Speed ${pb.rate}`}>
              <Text style={styles.toolBig}>{pb.rate}×</Text>
              <Text style={styles.toolLabel}>Speed</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tool} onPress={() => setSheetOpen('sleep')} accessibilityLabel="Sleep timer">
              <Icon name="sleep" size={18} color={pb.sleep ? p.accent : p.text} />
              <Text style={[styles.toolLabel, pb.sleep && { color: p.accent }]}>{sleepLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.tool}
              onPress={() => setSheetOpen('mark-label')}
              onLongPress={() => setSheetOpen('marks')}
              accessibilityLabel="Add a bookmark (hold for your bookmarks)">
              <Icon name="bookmarkAdd" size={18} color={p.text} />
              <Text style={styles.toolLabel}>Bookmark</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.tool} onPress={() => setSheetOpen('marks')} accessibilityLabel="Your bookmarks">
              <Icon name="bookmark" size={18} color={marks.length ? p.accent : p.text} />
              <Text style={styles.toolLabel}>{marks.length ? `${marks.length} ${marks.length === 1 ? 'mark' : 'marks'}` : 'Marks'}</Text>
            </TouchableOpacity>
            {actions.setVoiceBoost && actions.canBoost?.() && (
              <TouchableOpacity
                style={styles.tool}
                disabled={boosting !== null}
                onPress={() => {
                  tick();
                  const on = !prefs.boosted.includes(item.id);
                  if (on) setBoosting(0);
                  actions.setVoiceBoost!(item.id, on, (f) => setBoosting(f))
                    .catch((e) => Alert.alert('Voice Boost did not work', String(e?.message ?? e)))
                    .finally(() => setBoosting(null));
                }}
                accessibilityLabel={prefs.boosted.includes(item.id) ? 'Voice Boost is on. Tap to turn it off' : 'Voice Boost: clearer, louder voices'}>
                <Icon name="audio" size={18} color={prefs.boosted.includes(item.id) || boosting !== null ? p.accent : p.text} />
                <Text style={[styles.toolLabel, (prefs.boosted.includes(item.id) || boosting !== null) && { color: p.accent }]}>
                  {boosting !== null ? `${Math.round(boosting * 100)}%` : 'Boost'}
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {/* One-tap speeds (hold one to make it your current speed instead). */}
          <View style={styles.favRow}>
            {prefs.favSpeeds.map((s, n) => {
              const on = Math.abs(s - pb.rate) < 0.001;
              return (
                <TouchableOpacity
                  key={`${s}-${n}`}
                  style={[styles.fav, on && styles.favOn]}
                  onPress={() => {
                    tick();
                    pb.setRate(s);
                  }}
                  onLongPress={() => {
                    if (on || !actions.setPrefs) return;
                    success();
                    const favSpeeds = prefs.favSpeeds.map((x, i) => (i === n ? pb.rate : x));
                    void actions.setPrefs({ ...prefs, favSpeeds });
                  }}
                  accessibilityLabel={`Speed ${s}×${on ? ', now' : ''}. Hold to put ${pb.rate}× here`}>
                  <Text style={[styles.favText, on && styles.favTextOn]}>{s}×</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.leftLine}>{left > 60_000 ? `${fmtLength(left)} left${pb.rate !== 1 ? ` at ${pb.rate}×` : ''}` : ''}</Text>
        </View>
      </View>

      {sheetOpen === 'chapters' && (
        <SheetFrame title="Chapters" onClose={() => setSheetOpen(null)}>
          <ScrollView style={{ maxHeight: 520 }}>
            {chapters.map((c, n) => (
              <TouchableOpacity
                key={`${c.track}-${c.startMs}`}
                style={[styles.chRow, n === chIndex && styles.chRowOn]}
                onPress={() => {
                  tick();
                  pb.seekOverall(c.overallStart);
                  setSheetOpen(null);
                }}>
                <Text style={[styles.chNum, n === chIndex && { color: p.accent }]}>{n + 1}</Text>
                <Text style={[styles.chTitle, n === chIndex && { color: p.accent }]} numberOfLines={2}>
                  {c.title}
                </Text>
                <Text style={styles.chLen}>{fmtLength(c.lengthMs)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </SheetFrame>
      )}
      {sheetOpen === 'speed' && (
        <OptionsSheet
          title="Speed"
          options={[
            ...SPEEDS.map((s) => ({ label: `${s}×`, hint: s === pb.rate ? '✓ (this book remembers it)' : s === 1 ? 'normal' : undefined, onPress: () => pb.setRate(s) })),
            ...(actions.setPrefs
              ? [
                  { label: 'Smart rewind after a pause…', hint: REWIND_CHOICES.find((c) => c.value === prefs.rewind)?.label, onPress: () => setSheetOpen('rewind') },
                  {
                    label: 'When a book of a series ends',
                    hint: prefs.seriesAutoplay ? 'Play the next book' : 'Stop',
                    onPress: () => void actions.setPrefs?.({ ...prefs, seriesAutoplay: !prefs.seriesAutoplay }),
                  },
                ]
              : []),
          ]}
          onClose={() => setSheetOpen((s) => (s === 'speed' ? null : s))}
        />
      )}
      {sheetOpen === 'rewind' && (
        <OptionsSheet
          title="After a pause, go back a little so you don't lose the thread"
          options={REWIND_CHOICES.map((c) => ({
            label: c.label,
            hint: c.value === prefs.rewind ? `✓ ${c.hint}` : c.hint,
            onPress: () => void actions.setPrefs?.({ ...prefs, rewind: c.value }),
          }))}
          onClose={() => setSheetOpen(null)}
        />
      )}
      {sheetOpen === 'sleep' && (
        <OptionsSheet
          title="Sleep timer"
          options={[
            ...SLEEP_OPTIONS.filter((o) => o.minutes !== 'chapter' || chapters.length > 1).map((o) => ({ label: o.label, onPress: () => pb.setSleep(o.minutes) })),
            ...(pb.sleep ? [{ label: 'Turn off', danger: true, onPress: () => pb.setSleep(null) }] : []),
          ]}
          onClose={() => setSheetOpen(null)}
        />
      )}
      {sheetOpen === 'mark-label' && (
        <PromptSheet
          title={`Bookmark at ${fmtClockMs(pb.overall)}`}
          placeholder="A note (optional)"
          onSubmit={(t) => {
            actions
              .addBookmark(item.id, pb.track, pb.position, t.trim() || null)
              .then(() => {
                success();
                loadMarks();
              })
              .catch(() => undefined);
          }}
          onClose={() => setSheetOpen(null)}
        />
      )}
      {sheetOpen === 'marks' && (
        <SheetFrame title="Bookmarks" onClose={() => setSheetOpen(null)}>
          {marks.length === 0 && <Text style={styles.sub}>No bookmarks yet. Tap Bookmark while listening to keep a spot.</Text>}
          {marks.map((m) => (
            <View key={m.id} style={styles.chRow}>
              <TouchableOpacity
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                onPress={() => {
                  pb.seekTrack(m.track, m.atMs);
                  setSheetOpen(null);
                }}>
                <Text style={styles.chNum}>{fmtClockMs(item.tracks.slice(0, m.track).reduce((a, t) => a + (t.durationMs ?? 0), 0) + m.atMs)}</Text>
                <Text style={styles.chTitle} numberOfLines={2}>
                  {m.label || 'Bookmark'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity hitSlop={8} onPress={() => actions.removeBookmark(m.id).then(loadMarks)} accessibilityLabel="Remove the bookmark">
                <Icon name="trash" size={15} color={p.danger} />
              </TouchableOpacity>
            </View>
          ))}
        </SheetFrame>
      )}
      {sheetOpen === 'rate' && (
        <RatingPicker title="Your rating" value={item.rating || null} onPick={(r) => actions.update([item.id], { rating: r ?? 0 }).catch(() => undefined)} onClose={() => setSheetOpen(null)} />
      )}
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    mini: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.elevated, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1, borderColor: p.border, overflow: 'hidden' },
    miniMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
    miniTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    miniSub: { color: p.textSecondary, fontSize: 12 },
    miniPlay: { width: 36, height: 36, borderRadius: 18, backgroundColor: p.text, alignItems: 'center', justifyContent: 'center' },
    miniTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, backgroundColor: 'transparent' },
    miniFill: { height: 2, backgroundColor: p.accent },
    screen: { flex: 1, backgroundColor: p.bg },
    top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8, paddingBottom: 8 },
    topTitle: { flex: 1, color: p.textSecondary, fontSize: 14, fontWeight: '700', textAlign: 'center' },
    circle: { width: 36, height: 36, borderRadius: 18, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    bottom: { paddingHorizontal: 22, gap: 10, paddingTop: 10 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    title: { color: p.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
    sub: { color: p.textSecondary, fontSize: 14 },
    rateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 12, height: 36 },
    rateText: { color: p.text, fontSize: 15, fontWeight: '800' },
    chapter: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
    chapterText: { flex: 1, color: p.text, fontSize: 14, fontWeight: '600' },
    chapterLeft: { color: p.textSecondary, fontSize: 12 },
    error: { color: p.danger, fontSize: 13 },
    scrub: { height: 28, justifyContent: 'center' },
    scrubTrack: { height: 5, borderRadius: 3, backgroundColor: p.card, overflow: 'hidden' },
    scrubFill: { height: 5, backgroundColor: p.text },
    scrubTick: { position: 'absolute', top: 0, width: 2, height: 5, marginLeft: -1, backgroundColor: p.bg, opacity: 0.8 },
    scrubKnob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, marginLeft: -7, backgroundColor: p.text },
    scrubKnobBig: { width: 22, height: 22, borderRadius: 11, marginLeft: -11 },
    times: { flexDirection: 'row', justifyContent: 'space-between' },
    time: { color: p.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },
    controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 6, paddingVertical: 4 },
    play: { width: 74, height: 74, borderRadius: 37, backgroundColor: p.text, alignItems: 'center', justifyContent: 'center' },
    tools: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    tool: { flex: 1, alignItems: 'center', gap: 4, backgroundColor: p.card, borderRadius: 14, paddingVertical: 9 },
    toolBig: { color: p.text, fontSize: 16, fontWeight: '800' },
    toolLabel: { color: p.textSecondary, fontSize: 11, fontWeight: '700' },
    favRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 10 },
    fav: { minWidth: 58, alignItems: 'center', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: p.card },
    favOn: { backgroundColor: p.accent },
    favText: { color: p.text, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
    favTextOn: { color: '#fff' },
    leftLine: { color: p.textMuted, fontSize: 12, textAlign: 'center', minHeight: 16 },
    chRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: p.separator },
    chRowOn: { backgroundColor: p.accentSoft, borderRadius: 10, paddingHorizontal: 8 },
    chNum: { color: p.textSecondary, fontSize: 14, fontWeight: '700', minWidth: 28, fontVariant: ['tabular-nums'] },
    chTitle: { flex: 1, color: p.text, fontSize: 15 },
    chLen: { color: p.textSecondary, fontSize: 13 },
  });
