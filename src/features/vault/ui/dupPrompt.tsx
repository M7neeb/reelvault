/**
 * "Already in your library": shown while an import waits, when a file you are
 * adding is a video (or audio) you already have - the very same file, or one
 * that looks like the same. Replace the one you have (it keeps its rating,
 * keywords and history and uses the new file), keep both, or don't import it.
 * With more files to come, "Do the same for the rest" answers them all at once.
 * Presentational only (see the note at the top of types.ts).
 */

import { useState } from 'react';
import { Switch, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import { fmtDateTime, fmtDuration, fmtSize } from './format';
import { success, tick } from './haptics';
import Icon from './Icon';
import { Modal } from './screen';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { DuplicateAsk } from './types';

export function DuplicatePrompt({ ask }: { ask: DuplicateAsk }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [all, setAll] = useState(false);
  const what = ask.kind === 'audio' ? 'audio file' : 'video';
  const answer = (choice: 'replace' | 'both' | 'skip') => {
    if (choice === 'skip') tick();
    else success();
    ask.answer(choice, all);
  };
  const e = ask.existing;
  const newBits = [fmtSize(ask.size), fmtDuration(ask.durationMs)].filter(Boolean).join(' · ');

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => answer('skip')}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.badge}>
            <Icon name="duplicate" size={18} color={p.accent} />
          </View>
          <Text style={styles.title}>{ask.exact ? 'Already in your library' : `Looks like a ${what} you have`}</Text>
          <Text style={styles.sub}>
            {ask.exact ? (
              <>
                <Text style={styles.strong}>{ask.name}</Text> is the very same file as this one:
              </>
            ) : (
              <>
                <Text style={styles.strong}>{ask.name}</Text> has {ask.reason} as this one:
              </>
            )}
          </Text>

          <View style={styles.existing}>
            {e.thumb ? (
              <Image source={e.thumb} style={[styles.thumb, ask.kind === 'audio' && styles.thumbSquare]} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty, ask.kind === 'audio' && styles.thumbSquare]}>
                <Icon name={ask.kind === 'audio' ? 'headphones' : 'lock'} size={18} color={p.textSecondary} />
              </View>
            )}
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={styles.exTitle} numberOfLines={2}>
                {e.title}
              </Text>
              <Text style={styles.exMeta} numberOfLines={1}>
                Added {fmtDateTime(e.importedAt).date}
                {e.rating > 0 ? ` · ★ ${Number.isInteger(e.rating) ? e.rating : e.rating.toFixed(1)}` : ''}
              </Text>
              {e.detail !== e.title && (
                <Text style={styles.exMeta} numberOfLines={1}>
                  {e.detail}
                </Text>
              )}
            </View>
          </View>
          {!!newBits && <Text style={styles.newLine}>The new file: {newBits}</Text>}

          <TouchableOpacity style={styles.primary} onPress={() => answer('replace')} accessibilityLabel={`Replace the ${what} you have with the new file`}>
            <Text style={styles.primaryText}>Replace the one I have</Text>
            <Text style={styles.primaryHint}>Keeps its rating, keywords and history, uses the new file</Text>
          </TouchableOpacity>
          <View style={styles.row}>
            <TouchableOpacity style={styles.secondary} onPress={() => answer('both')}>
              <Text style={styles.secondaryText}>Keep both</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={() => answer('skip')}>
              <Text style={[styles.secondaryText, { color: p.danger }]}>Don't import</Text>
            </TouchableOpacity>
          </View>

          {ask.remaining > 0 && (
            <View style={styles.allRow}>
              <Text style={styles.allText}>Same answer for other copies in this import ({ask.remaining} {ask.remaining === 1 ? 'file' : 'files'} to go)</Text>
              <Switch value={all} onValueChange={setAll} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 20 },
    card: { backgroundColor: p.panel, borderRadius: 24, padding: 20, gap: 12 },
    badge: { width: 40, height: 40, borderRadius: 20, backgroundColor: p.accentSoft, alignItems: 'center', justifyContent: 'center' },
    title: { color: p.text, fontSize: 21, fontWeight: '800' },
    sub: { color: p.textSecondary, fontSize: 15, lineHeight: 20 },
    strong: { color: p.text, fontWeight: '700' },
    existing: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.card, borderRadius: 14, padding: 10 },
    thumb: { width: 96, height: 60, borderRadius: 10, backgroundColor: p.tile },
    thumbSquare: { width: 60 },
    thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
    exTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    exMeta: { color: p.textSecondary, fontSize: 12 },
    newLine: { color: p.textSecondary, fontSize: 13 },
    primary: { backgroundColor: p.accent, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, gap: 2, alignItems: 'center' },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    primaryHint: { color: 'rgba(255,255,255,0.85)', fontSize: 12, textAlign: 'center' },
    row: { flexDirection: 'row', gap: 10 },
    secondary: { flex: 1, backgroundColor: p.card, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
    secondaryText: { color: p.text, fontSize: 15, fontWeight: '700' },
    allRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    allText: { flex: 1, color: p.textSecondary, fontSize: 13 },
  });
