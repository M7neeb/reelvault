/**
 * "Make Smaller": pick a quality, re-encode one or many videos, see what it
 * saved. The re-encoding itself is behind `actions.onMakeSmaller`.
 * Presentational only (see the rule in types.ts).
 */

import { useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { EMPTY_PLAN, estimateBytes, fmtFormatLine, FRAME_RATES, RESOLUTIONS, type EditPlan } from '../edit';
import { confirmAction } from './confirm';
import { fmtBitrate, fmtSize } from './format';
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
  onMakeSmaller: (item: VaultItem, plan: EditPlan, onProgress: (f: number) => void) => Promise<UiSmallerResult>;
  onCancel: () => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const [maxShortSide, setMaxShortSide] = useState<number | null>(1080);
  const [fps, setFps] = useState<number | null>(null);
  const plan: EditPlan = { ...EMPTY_PLAN, maxShortSide, fps, lossless: false };
  const [run, setRun] = useState<Run | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const stopped = useRef(false);

  const total = items.reduce((s, v) => s + v.sizeBytes, 0);
  const label = items.length === 1 ? (items[0].title ?? items[0].filename) : `${items.length} videos`;
  const one = items.length === 1 ? items[0] : null;
  const sources = items.map((v) => ({
    width: v.width,
    height: v.height,
    fps: v.meta?.fps ?? null,
    durationMs: v.durationMs,
    sizeBytes: v.sizeBytes,
  }));
  const shortSides = sources.map((v) => (v.width && v.height ? Math.min(v.width, v.height) : 0)).filter(Boolean);
  const maxShort = shortSides.length ? Math.max(...shortSides) : null;
  const rates = sources.map((v) => v.fps ?? 0).filter(Boolean);
  const maxFps = rates.length ? Math.max(...rates) : null;
  const estimates = sources.map((src) => estimateBytes(plan, src));
  const estimate = estimates.every((e) => e !== null) ? estimates.reduce<number>((s, e) => s + (e ?? 0), 0) : null;
  const now = one
    ? [fmtFormatLine(one.width, one.height, one.meta?.fps ?? null), one.meta?.codec, fmtBitrate(one.sizeBytes, one.durationMs)]
        .filter(Boolean)
        .join(' · ')
    : `${shortSides.length ? `${Math.min(...shortSides)}p – ${maxShort}p` : 'sizes unknown'}${
        rates.length ? ` · ${Math.round(Math.min(...rates))}–${Math.round(maxFps ?? 0)} fps` : ''
      }`;

  async function start() {
    stopped.current = false;
    let t: Tally = { ...EMPTY, notes: [] };
    setTally(t);
    for (const [index, item] of items.entries()) {
      if (stopped.current) break;
      setRun({ index, total: items.length, fraction: 0, name: item.title ?? item.filename });
      const result = await onMakeSmaller(item, plan, (fraction) =>
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
        <>
          <Section label="Now">
            <Text style={styles.body}>{now}</Text>
          </Section>
          <Section label="Resolution (short side)">
            <Wrap>
              {RESOLUTIONS.map((r) => (
                <Chip
                  key={r.label}
                  label={r.label}
                  on={maxShortSide === r.key}
                  onPress={() => setMaxShortSide(r.key)}
                />
              ))}
            </Wrap>
            {maxShort !== null && maxShortSide !== null && maxShortSide >= maxShort && (
              <Text style={styles.hint}>Already at or below that - only re-encoded as HEVC.</Text>
            )}
          </Section>
          <Section label="Frame rate">
            <Wrap>
              {FRAME_RATES.map((r) => (
                <Chip key={r.label} label={r.key ? `${r.label} fps` : r.label} on={fps === r.key} onPress={() => setFps(r.key)} />
              ))}
            </Wrap>
            <Text style={styles.hint}>Frame rate and size only ever go down, never up.</Text>
          </Section>
          <Section label="Result">
            <Text style={styles.result}>{estimate !== null ? `about ${fmtSize(estimate)}` : 'size unknown'}</Text>
            <Text style={styles.hint}>
              A guess - the real size depends on how much moves in the video. Keep the app open while it works.
            </Text>
          </Section>
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
