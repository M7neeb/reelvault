/**
 * Two tools on the Simkl tabs:
 * - Pick for me: one title for tonight, within the time you have;
 * - Import: your IMDb or Letterboxd history into Simkl.
 * Presentational only (see simkl/ui/types.ts).
 */

import { useMemo, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Modal, useWindowDimensions } from '@/features/vault/ui/screen';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Fade from '@/features/vault/ui/Fade';
import { success, tick } from '@/features/vault/ui/haptics';
import Icon from '@/features/vault/ui/Icon';
import IconButton from '@/features/vault/ui/IconButton';
import { Chip, Section, Segment, SheetFrame, Wrap } from '@/features/vault/ui/sheets';
import { rgbOf, sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { describeImport, SOURCE_LABELS } from '../imports';
import { fmtDuration, fmtRating } from '../insights';
import { fanartUrl, posterUrl, SIMKL_TYPES } from '../logic';
import { candidates, pickOne, TIME_CHOICES, type PickOptions } from '../pick';
import Poster from './Poster';
import type { ImportResult, SimklActions, SimklItem, SimklType } from './types';

/* ------------------------------------------------------------ Pick for me */

export function PickModal({
  type,
  items,
  onOpen,
  onClose,
}: {
  type: SimklType;
  items: SimklItem[];
  onOpen: (item: SimklItem) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width, height } = useWindowDimensions();
  const [from, setFrom] = useState<PickOptions['from']>(type === 'movie' ? 'plan' : 'any');
  const [maxMinutes, setMaxMinutes] = useState<number | null>(null);
  const [offered, setOffered] = useState<Set<number>>(new Set());
  const [seed, setSeed] = useState(0);

  const pool = useMemo(() => candidates(items, { type, from, maxMinutes }), [items, type, from, maxMinutes]);
  const pick = useMemo(() => {
    const fresh = pool.filter((i) => !offered.has(i.simklId));
    return pickOne(fresh.length ? fresh : pool);
  }, [pool, seed]); // eslint-disable-line react-hooks/exhaustive-deps

  function another() {
    tick();
    if (pick) setOffered(new Set([...offered, pick.simklId]));
    setSeed(seed + 1);
  }

  const plural = SIMKL_TYPES.find((t) => t.key === type)!.plural.toLowerCase();
  const art = pick ? (fanartUrl(pick.fanart ?? null) ?? (pick.poster ? posterUrl(pick.poster, '_m') : null)) : null;
  const posterW = Math.min(200, width * 0.48);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.pickScreen}>
        {art && <Image source={{ uri: art }} style={[StyleFill, { height: height * 0.62 }]} contentFit="cover" blurRadius={36} transition={300} />}
        <Fade color={rgbOf(p.bg)} from={0.2} to={1} style={[StyleFill, { height: height * 0.62 }]} />
        <View style={[styles.pickTop, { paddingTop: insets.top + 6 }]}>
          <IconButton icon="close" label="Close" clear onPress={onClose} />
          <Text style={styles.pickHeading}>Pick for me</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.pickBody}>
          {pick ? (
            <TouchableOpacity style={styles.pickCard} onPress={() => onOpen(pick)} activeOpacity={0.85} accessibilityLabel={`Open ${pick.title}`}>
              <Poster path={pick.poster} title={pick.title} width={posterW} height={Math.round(posterW * 1.48)} radius={16} size="_m" style={styles.pickShadow} />
              <Text style={styles.pickTitle} numberOfLines={2}>
                {pick.title}
              </Text>
              <Text style={styles.pickFacts}>
                {[
                  pick.year,
                  pick.runtime ? (type === 'movie' ? fmtDuration(pick.runtime) : `${pick.runtime} min episodes`) : null,
                  pick.imdbRating ? `IMDb ${pick.imdbRating.toFixed(1)}` : null,
                  pick.rating ? `★ ${fmtRating(pick.rating)}` : null,
                ]
                  .filter(Boolean)
                  .join('  ·  ')}
              </Text>
              {pick.type !== 'movie' && pick.nextToWatch && <Text style={styles.pickNext}>Up next: {pick.nextToWatch}</Text>}
            </TouchableOpacity>
          ) : (
            <View style={styles.pickEmpty}>
              <Icon name="dice" size={42} color={p.textMuted} />
              <Text style={styles.pickEmptyText}>
                Nothing fits. Try a longer time, or add {plural} to Plan to Watch.
              </Text>
            </View>
          )}
        </View>

        <View style={[styles.pickControls, { paddingBottom: insets.bottom + 16 }]}>
          <Segment
            options={[
              { key: 'plan', label: 'Plan to Watch' },
              { key: 'watching', label: 'Watching' },
              { key: 'any', label: 'Both' },
            ]}
            value={from}
            onChange={(k) => {
              setFrom(k);
              setOffered(new Set());
            }}
          />
          <Wrap>
            {TIME_CHOICES.map((c) => (
              <Chip
                key={c.label}
                label={c.label}
                on={maxMinutes === c.minutes}
                onPress={() => {
                  setMaxMinutes(c.minutes);
                  setOffered(new Set());
                }}
              />
            ))}
          </Wrap>
          <View style={styles.pickButtons}>
            <TouchableOpacity style={[styles.pickBtn, styles.pickBtnGhost]} onPress={another} disabled={pool.length < 2} accessibilityLabel="Another one">
              <Icon name="shuffle" size={18} color={p.text} />
              <Text style={styles.pickBtnGhostText}>Another</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.pickBtn, !pick && { opacity: 0.4 }]}
              disabled={!pick}
              onPress={() => {
                if (!pick) return;
                success();
                onOpen(pick);
              }}>
              <Icon name="play" size={16} color="#fff" />
              <Text style={styles.pickBtnText}>Let's watch</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.pickHint}>
            {pool.length} {pool.length === 1 ? 'title fits' : 'titles fit'}. Better-rated ones come up more often.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ Import */

export function ImportSheet({ actions, onClose }: { actions: SimklActions; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [message, setMessage] = useState('');

  async function start() {
    setState('running');
    setMessage('');
    try {
      const r = await actions.importFile((done, total) => setProgress([done, total]));
      if (r === null) setState('idle');
      else if (r === 'unknown') {
        setState('error');
        setMessage('That file is not an IMDb or Letterboxd export. Pick the .csv straight from their export.');
      } else {
        success();
        setResult(r);
        setState('done');
      }
    } catch (e: any) {
      setState('error');
      setMessage(`The import stopped: ${e?.message ?? String(e)}. Whatever was sent before that is on Simkl.`);
    }
  }

  return (
    <SheetFrame title="Import" onClose={onClose} action={state === 'running' ? undefined : { label: 'Done', onPress: onClose }}>
      <Section label="From IMDb">
        <Text style={styles.body}>
          On imdb.com: your profile → Your ratings → ⋯ → Export. Ratings become watched and rated; a watchlist or list export goes to Plan to
          Watch. Matched exactly by IMDb id.
        </Text>
      </Section>
      <Section label="From Letterboxd">
        <Text style={styles.body}>
          On letterboxd.com: Settings → Data → Export your data, unzip it in Files, then pick watched.csv, diary.csv, ratings.csv or
          watchlist.csv. Half stars become Simkl's 1–10. Matched by title and year.
        </Text>
      </Section>

      {state === 'running' && (
        <View style={styles.running}>
          <ActivityIndicator color={p.accent} />
          <Text style={styles.body}>{progress[1] ? `Sending part ${progress[0]} of ${progress[1]}…` : 'Reading the file…'}</Text>
        </View>
      )}
      {state === 'done' && result && (
        <View style={styles.resultCard}>
          <Icon name="checkCircle" size={26} color={p.success} />
          <Text style={styles.resultTitle}>{SOURCE_LABELS[result.source]}</Text>
          <Text style={styles.body}>{describeImport(result)}</Text>
          {result.notFound.length > 0 && (
            <Text style={styles.hint} numberOfLines={6}>
              Not found on Simkl: {result.notFound.slice(0, 20).join(', ')}
              {result.notFound.length > 20 ? ` and ${result.notFound.length - 20} more` : ''}
            </Text>
          )}
        </View>
      )}
      {!!message && <Text style={[styles.body, { color: p.dangerText }]}>{message}</Text>}

      <TouchableOpacity style={[styles.importBtn, state === 'running' && { opacity: 0.4 }]} disabled={state === 'running'} onPress={() => void start()}>
        <Icon name="import" size={18} color="#fff" />
        <Text style={styles.importText}>{state === 'done' ? 'Import another file…' : 'Choose a CSV file…'}</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>Already-watched titles are not doubled. Simkl takes one write a second, so a big file takes a minute.</Text>
    </SheetFrame>
  );
}

const StyleFill = { position: 'absolute' as const, top: 0, left: 0, right: 0 };

const makeStyles = (p: Palette) =>
  sheet({
    pickScreen: { flex: 1, backgroundColor: p.bg },
    pickTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
    pickHeading: { color: p.text, fontSize: 17, fontWeight: '700' },
    pickBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
    pickCard: { alignItems: 'center', gap: 8 },
    pickShadow: { shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 24, shadowOffset: { width: 0, height: 12 } },
    pickTitle: { color: p.text, fontSize: 26, fontWeight: '800', textAlign: 'center', letterSpacing: -0.5, marginTop: 10 },
    pickFacts: { color: p.textSecondary, fontSize: 14, fontWeight: '600', textAlign: 'center' },
    pickNext: { color: p.link, fontSize: 15, fontWeight: '700' },
    pickEmpty: { alignItems: 'center', gap: 12 },
    pickEmptyText: { color: p.textSecondary, fontSize: 15, textAlign: 'center' },
    pickControls: { paddingHorizontal: 16, gap: 12 },
    pickButtons: { flexDirection: 'row', gap: 10 },
    pickBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: p.accent,
      borderRadius: 16,
      paddingVertical: 15,
    },
    pickBtnGhost: { backgroundColor: p.elevated },
    pickBtnText: { color: '#fff', fontSize: 17, fontWeight: '800' },
    pickBtnGhostText: { color: p.text, fontSize: 17, fontWeight: '700' },
    pickHint: { color: p.textSecondary, fontSize: 12, textAlign: 'center' },

    body: { color: p.textSoft, fontSize: 14, lineHeight: 20 },
    hint: { color: p.textSecondary, fontSize: 12 },
    running: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    resultCard: { backgroundColor: p.card, borderRadius: 14, padding: 14, gap: 6, alignItems: 'flex-start' },
    resultTitle: { color: p.text, fontSize: 16, fontWeight: '700' },
    importBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: p.accent,
      borderRadius: 14,
      paddingVertical: 14,
    },
    importText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  });
