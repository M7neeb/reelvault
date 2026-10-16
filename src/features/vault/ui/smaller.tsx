/**
 * "Make Smaller": pick a quality, re-encode one or many videos, see what it
 * saved. The re-encoding itself is behind `actions.onMakeSmaller`.
 * Presentational only (see the rule in types.ts).
 */

import { useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { QUALITIES, type CompressQuality } from '../smaller';
import { confirmAction } from './confirm';
import { fmtSize } from './format';
import { Chip, Section, SheetFrame, Wrap } from './sheets';
import { sheet, useStyles, type Palette } from './theme';
import type { UiSmallerResult, VaultItem } from './types';

type Run = { index: number; total: number; fraction: number; name: string };
type Tally = { done: number; skipped: number; failed: number; saved: number; notes: string[] };

const EMPTY: Tally = { done: 0, skipped: 0, failed: 0, saved: 0, notes: [] };

export function SmallerSheet({
  items,
  available,
  onMakeSmaller,
  onCancel,
  onClose,
}: {
  items: VaultItem[];
  /** False until the app build has the encoder (1.1). */
  available: boolean;
  onMakeSmaller: (item: VaultItem, quality: CompressQuality, onProgress: (f: number) => void) => Promise<UiSmallerResult>;
  onCancel: () => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const [quality, setQuality] = useState<CompressQuality>('1080p');
  const [run, setRun] = useState<Run | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const stopped = useRef(false);

  const total = items.reduce((s, v) => s + v.sizeBytes, 0);
  const label = items.length === 1 ? (items[0].title ?? items[0].filename) : `${items.length} videos`;
  const hint = QUALITIES.find((q) => q.key === quality)?.hint ?? '';

  async function start() {
    stopped.current = false;
    let t: Tally = { ...EMPTY, notes: [] };
    setTally(t);
    for (const [index, item] of items.entries()) {
      if (stopped.current) break;
      setRun({ index, total: items.length, fraction: 0, name: item.title ?? item.filename });
      const result = await onMakeSmaller(item, quality, (fraction) =>
        setRun((r) => (r ? { ...r, fraction } : r))
      );
      if (result.kind === 'done') t = { ...t, done: t.done + 1, saved: t.saved + (result.before - result.after) };
      else if (result.kind === 'skipped') t = { ...t, skipped: t.skipped + 1, notes: [...t.notes, `${item.filename}: ${result.reason}`] };
      else t = { ...t, failed: t.failed + 1, notes: [...t.notes, `${item.filename}: ${result.reason}`] };
      setTally(t);
    }
    setRun(null);
  }

  function confirmStart() {
    confirmAction(
      `Make ${items.length === 1 ? 'this video' : `${items.length} videos`} smaller?`,
      'Each video is re-encoded and the new file replaces the old one - this cannot be undone. ' +
        'Ratings, keywords, albums, dates and covers stay. A video is left alone when it would not get at least 10% smaller.',
      () => void start(),
      { label: 'Make Smaller', destructive: true }
    );
  }

  function close() {
    if (run) {
      stopped.current = true;
      onCancel();
    }
    onClose();
  }

  return (
    <SheetFrame
      title="Make Smaller"
      onClose={close}
      action={
        run
          ? { label: 'Stop', onPress: () => ((stopped.current = true), onCancel()) }
          : tally
            ? { label: 'Done', onPress: onClose }
            : { label: 'Start', onPress: confirmStart, disabled: !available || items.length === 0 }
      }>
      <Text style={styles.body}>
        {label} · {fmtSize(total)} now
      </Text>

      {!available && (
        <Text style={styles.warn}>
          This needs the new app version (1.1), because it uses the iPhone's video encoder. It works as soon as that version is
          installed.
        </Text>
      )}

      {!run && !tally && (
        <Section label="Quality">
          <Wrap>
            {QUALITIES.map((q) => (
              <Chip key={q.key} label={q.label} on={quality === q.key} onPress={() => setQuality(q.key)} />
            ))}
          </Wrap>
          <Text style={styles.hint}>{hint}</Text>
          <Text style={styles.hint}>
            Keep the app open while it works. A 1 GB video takes about a minute on an iPhone 15.
          </Text>
        </Section>
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
          <Text style={styles.result}>Saved {fmtSize(tally.saved)}</Text>
          <Text style={styles.body}>
            {tally.done} smaller · {tally.skipped} left as they were · {tally.failed} failed
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
    result: { color: p.text, fontSize: 22, fontWeight: '700' },
    link: { color: p.link, fontSize: 14, fontWeight: '600', paddingTop: 6 },
    track: { height: 6, borderRadius: 3, backgroundColor: p.card, overflow: 'hidden' },
    fill: { height: 6, backgroundColor: p.accent },
  });
