/**
 * Join videos: the picked videos in order (oldest first, move them up or
 * down), then one new video made from all of them. The originals stay.
 */

import { useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import { friendlyName } from '../names';
import { fmtDuration, fmtSize } from './format';
import { success, tick } from './haptics';
import Icon from './Icon';
import { Rows, SheetFrame } from './sheets';
import { raised, sheet, usePalette, useStyles, type Palette } from './theme';
import type { UiSmallerResult, VaultItem } from './types';

export default function JoinSheet({
  items,
  onJoin,
  onCancel,
  onOpen,
  onClose,
}: {
  items: VaultItem[];
  onJoin: (ids: string[], onProgress: (f: number) => void) => Promise<UiSmallerResult>;
  onCancel: () => void;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [order, setOrder] = useState(() => [...items].sort((a, b) => a.createdAt - b.createdAt));
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<UiSmallerResult | null>(null);
  const running = progress !== null && result === null;
  const startedAt = useRef(0);

  const totalMs = useMemo(() => order.reduce((s, v) => s + (v.durationMs ?? 0), 0), [order]);
  const totalBytes = useMemo(() => order.reduce((s, v) => s + v.sizeBytes, 0), [order]);
  const shapes = new Set(order.map((v) => (v.width && v.height ? (v.width >= v.height ? 'wide' : 'tall') : '?')));

  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= order.length) return;
    tick();
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };

  const join = async () => {
    startedAt.current = Date.now();
    setProgress(0);
    const r = await onJoin(
      order.map((v) => v.id),
      (f) => setProgress(f)
    );
    if (r.kind === 'done') success();
    setResult(r);
  };

  const close = () => {
    if (running) onCancel();
    onClose();
  };

  return (
    <SheetFrame page title="Join videos" onClose={close}>
      <View style={styles.body}>
        {result?.kind === 'done' ? (
          <View style={styles.done}>
            <View style={[styles.doneIcon, { backgroundColor: raised(p) }]}>
              <Icon name="checkCircle" size={30} color={p.success} />
            </View>
            <Text style={styles.doneTitle}>Joined into one video</Text>
            <Text style={styles.lead}>
              {fmtDuration(totalMs) ?? ''} · {fmtSize(result.after)}. The {order.length} videos you picked are still there.
            </Text>
            {result.newId && (
              <TouchableOpacity
                style={styles.primary}
                onPress={() => {
                  onClose();
                  onOpen(result.newId!);
                }}
                accessibilityRole="button">
                <Text style={styles.primaryText}>Play it</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            <Text style={styles.lead}>
              One after another, in this order, as a new video. The {order.length} you picked stay as they are.
              {shapes.size > 1 ? ' Some are upright and some sideways: they all get the shape of the first one, with black bars where needed.' : ''}
            </Text>
            <Rows>
              {order.map((v, i) => (
                <View key={v.id} style={styles.row}>
                  <Text style={styles.num}>{i + 1}</Text>
                  <Image source={v.thumbSource} style={styles.thumb} contentFit="cover" />
                  <View style={styles.text}>
                    <Text style={styles.title} numberOfLines={1}>
                      {friendlyName(v)}
                    </Text>
                    <Text style={styles.sub}>{[fmtDuration(v.durationMs), fmtSize(v.sizeBytes)].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <View style={styles.moves}>
                    <TouchableOpacity style={[styles.move, i === 0 && styles.off]} disabled={i === 0 || running} onPress={() => move(i, -1)} hitSlop={4} accessibilityLabel={`Move ${friendlyName(v)} up`}>
                      <Icon name="chevronUp" size={14} color={p.text} weight="bold" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.move, i === order.length - 1 && styles.off]}
                      disabled={i === order.length - 1 || running}
                      onPress={() => move(i, 1)}
                      hitSlop={4}
                      accessibilityLabel={`Move ${friendlyName(v)} down`}>
                      <Icon name="chevronDown" size={14} color={p.text} weight="bold" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </Rows>
            <Text style={styles.total}>
              {fmtDuration(totalMs) ?? '?'} in all · about {fmtSize(totalBytes)} more space while it is made
            </Text>
            {result && <Text style={styles.error}>Couldn't join them: {result.reason}</Text>}
            {running ? (
              <View style={styles.progressBox}>
                <View style={[styles.track, { backgroundColor: raised(p) }]}>
                  <View style={[styles.fill, { width: `${Math.round((progress ?? 0) * 100)}%` }]} />
                </View>
                <Text style={styles.sub}>Joining… {Math.round((progress ?? 0) * 100)}%. Keep ReelVault open.</Text>
                <TouchableOpacity onPress={onCancel} style={styles.quiet} accessibilityRole="button">
                  <Text style={styles.quietText}>Stop</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.primary} onPress={() => void join()} accessibilityRole="button">
                <Text style={styles.primaryText}>{result ? 'Try again' : `Join ${order.length} videos`}</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    body: { gap: 16 },
    lead: { color: p.textSoft, fontSize: 15, lineHeight: 21 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
    num: { width: 20, color: p.textSecondary, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'], textAlign: 'right' },
    thumb: { width: 56, height: 42, borderRadius: 8, backgroundColor: p.tile },
    text: { flex: 1, minWidth: 0, gap: 2 },
    title: { color: p.text, fontSize: 16, fontWeight: '600' },
    sub: { color: p.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
    moves: { flexDirection: 'row', gap: 6 },
    move: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: p.scheme === 'light' ? p.card : p.circle },
    off: { opacity: 0.3 },
    total: { color: p.textSecondary, fontSize: 13, textAlign: 'center' },
    error: { color: p.dangerText, fontSize: 14, textAlign: 'center' },
    primary: { height: 54, borderRadius: 27, backgroundColor: p.text, alignItems: 'center', justifyContent: 'center' },
    primaryText: { color: p.bg, fontSize: 17, fontWeight: '800' },
    progressBox: { gap: 10, alignItems: 'center' },
    track: { alignSelf: 'stretch', height: 8, borderRadius: 4, overflow: 'hidden' },
    fill: { height: 8, borderRadius: 4, backgroundColor: p.accent },
    quiet: { paddingVertical: 6 },
    quietText: { color: p.dangerText, fontSize: 15, fontWeight: '600' },
    done: { alignItems: 'center', gap: 10, paddingTop: 30 },
    doneIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
    doneTitle: { color: p.text, fontSize: 22, fontWeight: '800' },
  });
