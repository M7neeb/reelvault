/**
 * A book's audiobook on the book's own screens: the Audiobook part of a
 * book's page (link one, import one, listen), and the small player that sits
 * over the text while the audiobook of that book is playing.
 * Presentational only (see the note at the top of types.ts).
 */

import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { SPEEDS, displayTitle as audioTitle, fmtLength } from '../../audio/audioLogic';
import { audioDoneFrac, audioLength, nextSpeed } from '../../books/bookAudio';
import AudioCover from '../audio/AudioCover';
import type { AudioUiItem } from '../audio/audioTypes';
import type { Playback } from '../audio/playback';
import Icon from '../Icon';
import { OptionsSheet, type OptionItem } from '../prompts';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { Ink } from './BookReader';

const pct = (f: number) => `${Math.round(f * 100)}%`;

/** The Audiobook part of a book's page. */
export function AudiobookPart({
  audiobook,
  suggestion,
  choices,
  playing,
  importing,
  bookFrac,
  onListen,
  onLink,
  onImport,
}: {
  audiobook: AudioUiItem | null;
  /** Something in Audio that looks like this book, while none is linked. */
  suggestion: AudioUiItem | null;
  /** What can be picked from the Audio section. */
  choices: AudioUiItem[];
  /** This book's audiobook is the one playing right now. */
  playing: boolean;
  importing: boolean;
  /** How far through the text you are, for "from my place in the book". */
  bookFrac: number;
  onListen: (from: 'audio' | 'book' | 'auto') => void;
  onLink: (audioId: string | null) => void;
  onImport: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [sheetOpen, setSheetOpen] = useState<'menu' | 'pick' | null>(null);

  const pickOptions: OptionItem[] = choices.slice(0, 20).map((a) => ({
    label: audioTitle(a),
    hint: [a.author, fmtLength(audioLength(a))].filter(Boolean).join(' · ') || undefined,
    onPress: () => onLink(a.id),
  }));

  return (
    <View>
      <Text style={styles.label}>Audiobook</Text>
      {audiobook ? (
        <TouchableOpacity style={styles.card} activeOpacity={0.75} onPress={() => setSheetOpen('menu')} accessibilityHint="Choose where to start, or change the audiobook">
          <AudioCover item={audiobook} size={52} radius={8} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.title} numberOfLines={2}>
              {audioTitle(audiobook)}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {[fmtLength(audioLength(audiobook)), audiobook.lastPlayedAt ? `${pct(audioDoneFrac(audiobook))} listened` : null, audiobook.narrator ? `read by ${audiobook.narrator}` : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <TouchableOpacity style={styles.listen} onPress={() => onListen('auto')} accessibilityLabel={playing ? 'Open the player' : `Listen to ${audioTitle(audiobook)}`}>
            <Icon name={playing ? 'sound' : 'headphones'} size={15} color={p.bg} weight="bold" />
            <Text style={styles.listenText}>{playing ? 'Playing' : 'Listen'}</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      ) : (
        <View style={{ gap: 10 }}>
          {suggestion && (
            <View style={styles.card}>
              <AudioCover item={suggestion} size={52} radius={8} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.meta}>In your Audio</Text>
                <Text style={styles.title} numberOfLines={2}>
                  {audioTitle(suggestion)}
                </Text>
              </View>
              <TouchableOpacity style={styles.listen} onPress={() => onLink(suggestion.id)} accessibilityLabel={`Use ${audioTitle(suggestion)} as the audiobook`}>
                <Text style={styles.listenText}>Use it</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={styles.row}>
            <TouchableOpacity style={styles.pill} onPress={onImport} disabled={importing}>
              <Icon name="import" size={15} color={p.text} />
              <Text style={styles.pillText}>{importing ? 'Adding…' : 'Import audio'}</Text>
            </TouchableOpacity>
            {choices.length > 0 && (
              <TouchableOpacity style={styles.pill} onPress={() => setSheetOpen('pick')}>
                <Icon name="headphones" size={15} color={p.text} />
                <Text style={styles.pillText}>Choose from Audio</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.hint}>One .m4b, .mp3 or .m4a file, or all of its chapter files at once. It plays here with speed, sleep timer and chapters, and starts at your place in the book.</Text>
        </View>
      )}

      {sheetOpen === 'menu' && audiobook && (
        <OptionsSheet
          title={audioTitle(audiobook)}
          options={[
            ...(bookFrac > 0.01 ? [{ label: 'Listen from my place in the book', hint: pct(bookFrac), onPress: () => onListen('book') }] : []),
            ...(audiobook.lastPlayedAt ? [{ label: 'Listen from where the audio stopped', hint: pct(audioDoneFrac(audiobook)), onPress: () => onListen('audio') }] : [{ label: 'Listen from the start', onPress: () => onListen('audio') }]),
            ...(choices.length > 1 ? [{ label: 'Choose another audiobook', onPress: () => setTimeout(() => setSheetOpen('pick'), 250) }] : []),
            { label: 'Import another audio file', onPress: onImport },
            { label: 'Unlink from this book', hint: 'It stays in Audio', danger: true, onPress: () => onLink(null) },
          ]}
          onClose={() => setSheetOpen((s) => (s === 'menu' ? null : s))}
        />
      )}
      {sheetOpen === 'pick' && <OptionsSheet title="The audiobook of this book" options={pickOptions} onClose={() => setSheetOpen((s) => (s === 'pick' ? null : s))} />}
    </View>
  );
}

/** Play, back 15 s, speed and the title (opens the full player), over the book's text. */
export function ListenBar({ pb, ink, bottom, onOpen, onRate }: { pb: Playback; ink: Ink; bottom: number; onOpen: () => void; onRate: (rate: number) => void }) {
  const item = pb.item;
  if (!item) return null;
  const frac = pb.total > 0 ? Math.min(1, pb.overall / pb.total) : 0;
  return (
    <Animated.View entering={FadeInDown.duration(220)} exiting={FadeOut.duration(150)} style={[bar.wrap, { bottom, backgroundColor: ink.bar, borderColor: ink.rule }]}>
      <View style={[bar.progress, { backgroundColor: ink.rule }]}>
        <View style={{ height: 2, width: `${frac * 100}%`, backgroundColor: ink.accent }} />
      </View>
      <TouchableOpacity hitSlop={8} onPress={() => pb.skip(-15_000)} accessibilityLabel="Back 15 seconds" style={bar.btn}>
        <Icon name="back15" size={20} color={ink.text} />
      </TouchableOpacity>
      <TouchableOpacity hitSlop={8} onPress={pb.toggle} accessibilityLabel={pb.playing ? 'Pause' : 'Play'} style={[bar.play, { backgroundColor: ink.text }]}>
        <Icon name={pb.playing ? 'pause' : 'play'} size={16} color={ink.bg} weight="bold" />
      </TouchableOpacity>
      <TouchableOpacity style={bar.mid} onPress={onOpen} accessibilityLabel="Open the player: chapters, sleep timer and more">
        <Text style={[bar.title, { color: ink.text }]} numberOfLines={1}>
          {audioTitle(item)}
        </Text>
        <Text style={[bar.sub, { color: ink.soft }]} numberOfLines={1}>
          {pb.error ?? `${fmtLength(Math.max(0, pb.total - pb.overall) / Math.max(0.5, pb.rate))} left`}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity hitSlop={8} onPress={() => onRate(nextSpeed(pb.rate, SPEEDS))} accessibilityLabel={`Speed ${pb.rate} times. Tap for faster.`} style={[bar.speed, { borderColor: ink.rule }]}>
        <Text style={[bar.speedText, { color: ink.text }]}>{`${pb.rate}×`}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const bar = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 58,
    borderRadius: 29,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  progress: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2 },
  btn: { width: 30, alignItems: 'center' },
  play: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 1, fontVariant: ['tabular-nums'] },
  speed: { minWidth: 46, height: 30, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  speedText: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
});

const makeStyles = (p: Palette) =>
  sheet({
    label: { color: p.textSecondary, fontSize: 13, fontWeight: '700', marginTop: 26, marginBottom: 10 },
    card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.elevated, borderRadius: 14, padding: 10 },
    title: { color: p.text, fontSize: 15, fontWeight: '700', lineHeight: 19 },
    meta: { color: p.textSecondary, fontSize: 12.5, fontVariant: ['tabular-nums'] },
    listen: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.text, borderRadius: 999, paddingHorizontal: 14, height: 36 },
    listenText: { color: p.bg, fontSize: 14, fontWeight: '700' },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 15, height: 38 },
    pillText: { color: p.text, fontSize: 14.5, fontWeight: '700' },
    hint: { color: p.textSecondary, fontSize: 13, lineHeight: 18 },
  });
