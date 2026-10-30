/**
 * "Trim Start & End": cut the same number of seconds off the start (and, if
 * you like, the end) of one or many videos, e.g. the first 5 seconds of five
 * clips. The cutting itself is behind `actions.onEditVideo`.
 * Presentational only (see the rule in types.ts).
 */

import { useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import { trimPlan, type EditPlan } from '../edit';
import { confirmAction } from './confirm';
import { Chip, Section, SheetFrame, ToggleRow, Wrap } from './sheets';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { UiSmallerResult, VaultItem } from './types';

type Run = { index: number; total: number; fraction: number; name: string };
type Tally = { done: number; skipped: number; failed: number; notes: string[] };

const START_PICKS = [1, 2, 3, 5, 10, 15, 30];
const END_PICKS = [0, 3, 5, 10, 30];

/** "1.5" -> 1.5; anything else -> null. */
function seconds(text: string): number | null {
  const n = Number(text.replace(',', '.').trim());
  return Number.isFinite(n) && n >= 0 && n <= 3600 ? n : null;
}

export function TrimManySheet({
  items,
  available,
  onEdit,
  onCancel,
  onClose,
}: {
  items: VaultItem[];
  /** False until the app build has the editor (1.1). */
  available: boolean;
  onEdit: (item: VaultItem, plan: EditPlan, mode: 'replace' | 'copy', onProgress: (f: number) => void) => Promise<UiSmallerResult>;
  onCancel: () => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [startText, setStartText] = useState('5');
  const [endText, setEndText] = useState('0');
  const [exact, setExact] = useState(true);
  const [keep, setKeep] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const stopped = useRef(false);

  const start = seconds(startText);
  const end = seconds(endText);
  const valid = start !== null && end !== null && start + end > 0;
  const plans = valid ? items.map((v) => trimPlan(v.durationMs, start, end, exact)) : [];
  const usable = plans.filter(Boolean).length;
  const tooShort = valid ? items.length - usable : 0;

  async function go() {
    stopped.current = false;
    let t: Tally = { done: 0, skipped: 0, failed: 0, notes: [] };
    setTally(t);
    for (const [index, item] of items.entries()) {
      if (stopped.current) break;
      const plan = plans[index];
      const name = item.title ?? item.filename;
      if (!plan) {
        t = { ...t, skipped: t.skipped + 1, notes: [...t.notes, `${name}: too short`] };
        setTally(t);
        continue;
      }
      setRun({ index, total: items.length, fraction: 0, name });
      const result = await onEdit(item, plan, keep ? 'copy' : 'replace', (fraction) => setRun((r) => (r ? { ...r, fraction } : r)));
      if (result.kind === 'done') t = { ...t, done: t.done + 1 };
      else if (result.kind === 'skipped') t = { ...t, skipped: t.skipped + 1, notes: [...t.notes, `${name}: ${result.reason}`] };
      else t = { ...t, failed: t.failed + 1, notes: [...t.notes, `${name}: ${result.reason}`] };
      setTally(t);
    }
    setRun(null);
  }

  function confirmStart() {
    const what = [start ? `the first ${start} s` : '', end ? `the last ${end} s` : ''].filter(Boolean).join(' and ');
    confirmAction(
      `Cut ${what} of ${usable === 1 ? 'this video' : `${usable} videos`}?`,
      keep
        ? 'Each trimmed video is saved as a new copy; the originals stay as they are.'
        : 'The trimmed video replaces the original - this cannot be undone. Ratings, keywords, albums and dates stay.',
      () => void go(),
      { label: 'Trim', destructive: !keep }
    );
  }

  function close() {
    if (run) {
      stopped.current = true;
      onCancel();
    }
    onClose();
  }

  const input = (value: string, set: (v: string) => void, label: string) => (
    <View style={styles.inputRow}>
      <TextInput
        value={value}
        onChangeText={set}
        keyboardType="decimal-pad"
        keyboardAppearance={p.scheme}
        style={styles.input}
        accessibilityLabel={label}
        selectTextOnFocus
      />
      <Text style={styles.body}>seconds</Text>
    </View>
  );

  return (
    <SheetFrame
      title="Trim Start & End"
      onClose={close}
      action={
        run
          ? { label: 'Stop', onPress: () => ((stopped.current = true), onCancel()) }
          : tally
            ? { label: 'Done', onPress: onClose }
            : { label: 'Trim', onPress: confirmStart, disabled: !available || !valid || usable === 0 }
      }>
      <Text style={styles.body}>{items.length === 1 ? (items[0].title ?? items[0].filename) : `${items.length} videos`}</Text>

      {!available && <Text style={styles.warn}>This needs the app version with the video editor (1.1 or later).</Text>}

      {!run && !tally && (
        <>
          <Section label="Cut from the start">
            {input(startText, setStartText, 'Seconds to cut from the start')}
            <Wrap>
              {START_PICKS.map((s) => (
                <Chip key={s} label={`${s} s`} on={start === s} onPress={() => setStartText(String(s))} />
              ))}
            </Wrap>
          </Section>
          <Section label="Cut from the end">
            {input(endText, setEndText, 'Seconds to cut from the end')}
            <Wrap>
              {END_PICKS.map((s) => (
                <Chip key={s} label={s ? `${s} s` : 'Nothing'} on={end === s} onPress={() => setEndText(String(s))} />
              ))}
            </Wrap>
          </Section>
          <Section label="How">
            <ToggleRow label="Cut on the exact frame" value={exact} onChange={setExact} />
            <Text style={styles.hint}>
              {exact
                ? 'Re-encodes each video in high quality, so it starts exactly there. Takes a little while.'
                : 'Instant and loses nothing, but each video starts at the nearest key frame - up to a second or two early.'}
            </Text>
            <ToggleRow label="Keep the originals" value={keep} onChange={setKeep} />
            <Text style={styles.hint}>{keep ? 'The trimmed versions are added as new videos.' : 'The trimmed versions replace the originals.'}</Text>
          </Section>
          {!valid && <Text style={styles.warn}>Enter how many seconds to cut.</Text>}
          {valid && tooShort > 0 && (
            <Text style={styles.hint}>
              {tooShort === 1 ? 'One video is' : `${tooShort} videos are`} too short for that and will be left alone.
            </Text>
          )}
        </>
      )}

      {run && (
        <Section label={`Video ${run.index + 1} of ${run.total}`}>
          <Text style={styles.body} numberOfLines={1}>
            {run.name}
          </Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(run.fraction * 100)}%` }]} />
          </View>
          <Text style={styles.hint}>{Math.round(run.fraction * 100)}%</Text>
        </Section>
      )}

      {tally && (
        <Section label={run ? 'So far' : 'Finished'}>
          <Text style={styles.body}>
            {tally.done} trimmed · {tally.skipped} left alone · {tally.failed} failed
          </Text>
          {tally.notes.slice(0, 8).map((n) => (
            <Text key={n} style={styles.hint} numberOfLines={2}>
              {n}
            </Text>
          ))}
          {!run && tally.done + tally.skipped + tally.failed < items.length && (
            <TouchableOpacity onPress={() => setTally(null)}>
              <Text style={styles.link}>Stopped early - start again</Text>
            </TouchableOpacity>
          )}
        </Section>
      )}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    body: { color: p.textSoft, fontSize: 14 },
    hint: { color: p.textSecondary, fontSize: 12 },
    warn: { color: p.dangerText, fontSize: 13 },
    link: { color: p.link, fontSize: 14, fontWeight: '600', paddingTop: 6 },
    inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    input: { backgroundColor: p.card, color: p.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 17, minWidth: 80, textAlign: 'center' },
    track: { height: 6, borderRadius: 3, backgroundColor: p.card, overflow: 'hidden' },
    fill: { height: 6, backgroundColor: p.accent },
  });
