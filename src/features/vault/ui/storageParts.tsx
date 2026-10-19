/**
 * The Storage page's tools for keeping ReelVault small:
 * - What ReelVault keeps besides your videos (covers, filmstrips, temporary
 *   files, the database) and a Clean up button.
 * - The space planner: pick how much room you want back; the gentlest steps
 *   that get there, each one a tap away.
 * - How long Recently Deleted keeps videos, and emptying it now.
 * - Shrinking new imports as they arrive.
 * Presentational only (see types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import { spacePlan, type SpaceIdea } from '../recap';
import { QUALITIES, type CompressQuality } from '../smaller';
import type { AppStorage } from '../housekeeping';
import { confirmAction } from './confirm';
import { success, tick } from './haptics';
import Icon from './Icon';
import { Card } from './insightParts';
import { PressableScale } from './motion';
import { GrowBar } from './storyKit';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultActions } from './types';

const GB = 1024 ** 3;

export function fmtSize(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(bytes >= 10 * GB ? 0 : 1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/* ------------------------------------------------------- what the app keeps */

const KINDS: { key: keyof Omit<AppStorage, 'measured'>; label: string; hint: string; color: string }[] = [
  { key: 'videos', label: 'Your videos', hint: 'The videos themselves', color: '#0A84FF' },
  { key: 'deleted', label: 'Recently Deleted', hint: 'Waiting to be removed for good', color: '#FF453A' },
  { key: 'audio', label: 'Audio and books', hint: 'Your audio files and EPUB books, each kept once', color: '#64D2FF' },
  { key: 'covers', label: 'Covers', hint: 'One small picture per video', color: '#30D158' },
  { key: 'filmstrips', label: 'Filmstrips', hint: 'Frames under the player, remade when needed', color: '#BF5AF2' },
  { key: 'temporary', label: 'Temporary files', hint: 'Picture cache, picker copies, finished edits', color: '#FF9F0A' },
  { key: 'database', label: 'Library info', hint: 'Ratings, keywords, history', color: '#8E8E93' },
];

export function AppSpaceCard({ actions, index = 0 }: { actions: VaultActions; index?: number }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [space, setSpace] = useState<AppStorage | null>(null);
  const [busy, setBusy] = useState(false);
  const [freed, setFreed] = useState<string | null>(null);
  const load = () =>
    actions
      .getAppStorage()
      .then(setSpace)
      .catch(() => setSpace(null));
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const total = space ? KINDS.reduce((a, k) => a + space[k.key], 0) : 0;
  const extras = space ? space.covers + space.filmstrips + space.temporary + space.database : 0;
  const clean = () => {
    tick();
    setBusy(true);
    setFreed(null);
    actions
      .tidyStorage(true)
      .then((r) => {
        success();
        setFreed(r.freed > 0 ? `Freed ${fmtSize(r.freed)}${r.covers ? ` and shrank ${r.covers} covers` : ''}.` : 'Already tidy: nothing to clear.');
        return load();
      })
      .catch((e) => setFreed(`That did not work: ${String(e)}`))
      .finally(() => setBusy(false));
  };

  return (
    <Card index={index} title="What ReelVault keeps" sub={space?.measured ? `${fmtSize(total)} in all · ${fmtSize(extras)} besides your videos` : 'Your videos, and what the app adds to them'}>
      {!space ? (
        <ActivityIndicator color={p.textSecondary} />
      ) : (
        <>
          <View style={styles.stack}>
            {KINDS.filter((k) => space[k.key] > 0).map((k) => (
              <View key={k.key} style={{ flex: Math.max(0.015, space[k.key] / Math.max(1, total)), backgroundColor: k.color }} />
            ))}
          </View>
          <View style={{ gap: 10 }}>
            {KINDS.filter((k) => space.measured || k.key === 'videos' || k.key === 'deleted').map((k) => (
              <View key={k.key} style={styles.kindRow}>
                <View style={[styles.kindDot, { backgroundColor: k.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.kindLabel}>{k.label}</Text>
                  <Text style={styles.muted}>{k.hint}</Text>
                </View>
                <Text style={styles.kindValue}>{fmtSize(space[k.key])}</Text>
              </View>
            ))}
          </View>
          {space.measured ? (
            <PressableScale style={[styles.primary, busy && { opacity: 0.6 }]} onPress={clean} disabled={busy} accessibilityLabel="Clean up what ReelVault doesn't need">
              {busy ? <ActivityIndicator color="#fff" /> : <Icon name="sparkle" size={15} color="#fff" />}
              <Text style={styles.primaryText}>{busy ? 'Cleaning up…' : 'Clean up now'}</Text>
            </PressableScale>
          ) : (
            <Text style={styles.muted}>The app version with the clean-up (1.9.2) measures and clears the rest.</Text>
          )}
          {!!freed && <Text style={styles.result}>{freed}</Text>}
          <Text style={styles.muted}>
            Clean up never touches your videos or their info. It also runs on its own a few seconds after the app starts, and keeps filmstrips only for the videos you opened lately.
          </Text>
        </>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- planner */

const TARGETS = [1, 2, 5, 10, 20, 50];

export function SpacePlanner({ ideas, freeBytes, onStep, index = 0 }: { ideas: SpaceIdea[]; freeBytes: number | null; onStep: (step: SpaceIdea) => void; index?: number }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const possible = ideas.reduce((a, i) => a + i.bytes, 0);
  const choices = TARGETS.filter((g) => g * GB <= possible * 1.2 || g === TARGETS[0]);
  const [target, setTarget] = useState(() => choices[Math.min(1, choices.length - 1)] ?? 1);
  const plan = useMemo(() => spacePlan(ideas, target * GB), [ideas, target]);
  if (!ideas.length) return null;
  return (
    <Card index={index} title="Space planner" sub={`Pick how much room you want back${freeBytes !== null ? ` · ${fmtSize(freeBytes)} free now` : ''}`}>
      <View style={styles.chips}>
        {choices.map((g) => (
          <TouchableOpacity
            key={g}
            style={[styles.chip, target === g && { backgroundColor: p.accent, borderColor: p.accent }]}
            onPress={() => {
              tick();
              setTarget(g);
            }}>
            <Text style={[styles.chipText, target === g && { color: '#fff' }]}>{g} GB</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.planHead}>
        <Text style={styles.planValue}>{fmtSize(plan.bytes)}</Text>
        <Text style={[styles.muted, { flex: 1 }]}>
          {plan.reached ? `back in ${plan.steps.length} ${plan.steps.length === 1 ? 'step' : 'steps'}, gentlest first` : `is all these steps can free (short of ${target} GB)`}
        </Text>
      </View>
      <GrowBar share={Math.min(1, plan.bytes / (target * GB))} color={plan.reached ? '#30D158' : '#FF9F0A'} track={p.card} height={8} />
      <View style={{ gap: 8 }}>
        {plan.steps.map((s, n) => (
          <PressableScale key={s.key} style={styles.step} onPress={() => onStep(s)} accessibilityLabel={`Step ${n + 1}: ${s.title}, ${fmtSize(s.counted)}`}>
            <View style={styles.stepNum}>
              <Text style={styles.stepNumText}>{n + 1}</Text>
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={styles.kindLabel}>{s.title}</Text>
              <Text style={styles.muted} numberOfLines={2}>
                {s.count} {s.count === 1 ? 'video' : 'videos'} · {s.detail}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={styles.stepBytes}>{fmtSize(s.counted)}</Text>
              <Text style={styles.stepGo}>{s.action === 'smaller' || s.action === 'unwatched' ? 'Shrink ›' : s.action === 'deleted' ? 'Empty ›' : 'Review ›'}</Text>
            </View>
          </PressableScale>
        ))}
      </View>
      <Text style={styles.muted}>Shrinking keeps every video (made smaller, same look on the phone). Duplicates and rejects open for you to check first.</Text>
    </Card>
  );
}

/* -------------------------------------------------------- recently deleted */

const KEEP_DAYS = [1, 3, 7, 14, 30];

export function TrashCard({ days, onDays, count, bytes, onEmpty, index = 0 }: { days: number; onDays: (d: number) => void; count: number; bytes: number; onEmpty: () => Promise<number>; index?: number }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [note, setNote] = useState('');
  return (
    <Card index={index} title="Recently Deleted" sub={count ? `${count} ${count === 1 ? 'video' : 'videos'} · ${fmtSize(bytes)}` : 'Empty'}>
      <Text style={styles.kindLabel}>Keep deleted videos for</Text>
      <View style={styles.chips}>
        {KEEP_DAYS.map((d) => (
          <TouchableOpacity
            key={d}
            style={[styles.chip, days === d && { backgroundColor: p.accent, borderColor: p.accent }]}
            onPress={() => {
              tick();
              onDays(d);
            }}>
            <Text style={[styles.chipText, days === d && { color: '#fff' }]}>
              {d} {d === 1 ? 'day' : 'days'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.muted}>A shorter wait gives the space back sooner. The change applies the next time the app starts.</Text>
      {count > 0 && (
        <TouchableOpacity
          style={styles.danger}
          onPress={() =>
            confirmAction(
              `Remove ${count} ${count === 1 ? 'video' : 'videos'} for good?`,
              `This frees ${fmtSize(bytes)}. Their ratings and info are kept in Overview; the videos themselves can't be brought back.`,
              () => {
                onEmpty()
                  .then((n) => {
                    success();
                    setNote(`Removed ${n} for good. ${fmtSize(bytes)} freed.`);
                  })
                  .catch((e) => setNote(`That did not work: ${String(e)}`));
              },
              { label: 'Remove for good' }
            )
          }>
          <Icon name="trash" size={15} color={p.dangerText} />
          <Text style={[styles.dangerText, { color: p.dangerText }]}>Empty now · {fmtSize(bytes)}</Text>
        </TouchableOpacity>
      )}
      {!!note && <Text style={styles.result}>{note}</Text>}
    </Card>
  );
}

/* ----------------------------------------------------------- new imports */

export function ImportShrinkCard({ actions, index = 0 }: { actions: VaultActions; index?: number }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [q, setQ] = useState<CompressQuality | null | undefined>(undefined);
  useEffect(() => {
    actions
      .getImportQuality()
      .then(setQ)
      .catch(() => setQ(null));
  }, [actions]);
  if (q === undefined) return null;
  const pick = (next: CompressQuality | null) => {
    tick();
    setQ(next);
    actions.setImportQuality(next).catch(() => undefined);
  };
  return (
    <Card index={index} title="Shrink new videos as they come in" sub={q ? `On · ${QUALITIES.find((x) => x.key === q)?.label}` : 'Off'}>
      <View style={styles.chips}>
        <TouchableOpacity style={[styles.chip, q === null && { backgroundColor: p.accent, borderColor: p.accent }]} onPress={() => pick(null)}>
          <Text style={[styles.chipText, q === null && { color: '#fff' }]}>Off</Text>
        </TouchableOpacity>
        {QUALITIES.map((x) => (
          <TouchableOpacity key={x.key} style={[styles.chip, q === x.key && { backgroundColor: p.accent, borderColor: p.accent }]} onPress={() => pick(x.key)}>
            <Text style={[styles.chipText, q === x.key && { color: '#fff' }]}>{x.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.muted}>
        {q ? QUALITIES.find((x) => x.key === q)?.hint : 'New imports keep their full size.'} Each video is shrunk right after it arrives; ones that wouldn&apos;t get at least 10 % smaller stay as they are.
      </Text>
    </Card>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    muted: { color: p.textSecondary, fontSize: 12, lineHeight: 16 },
    stack: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2, backgroundColor: p.card },
    kindRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    kindDot: { width: 10, height: 10, borderRadius: 5 },
    kindLabel: { color: p.text, fontSize: 15, fontWeight: '700' },
    kindValue: { color: p.textSoft, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },
    primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#30A852', borderRadius: 14, paddingVertical: 13 },
    primaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    result: { color: p.success, fontSize: 13, fontWeight: '700' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderRadius: 999, borderWidth: 1, borderColor: p.border, backgroundColor: p.card, paddingHorizontal: 13, paddingVertical: 8 },
    chipText: { color: p.text, fontSize: 13, fontWeight: '700' },
    planHead: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
    planValue: { color: p.text, fontSize: 28, fontWeight: '900', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
    step: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.card, borderRadius: 14, padding: 10 },
    stepNum: { width: 26, height: 26, borderRadius: 13, backgroundColor: `${p.accent}26`, alignItems: 'center', justifyContent: 'center' },
    stepNumText: { color: p.accent, fontSize: 13, fontWeight: '900' },
    stepBytes: { color: '#30D158', fontSize: 14, fontWeight: '900', fontVariant: ['tabular-nums'] },
    stepGo: { color: p.link, fontSize: 12, fontWeight: '800' },
    danger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 12, borderWidth: 1, borderColor: p.border },
    dangerText: { fontSize: 15, fontWeight: '800' },
  });
