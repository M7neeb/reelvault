/**
 * "Haven't watched in a while": shows you're watching but haven't touched for
 * two months. Carry on (asks again in two months), put on hold, or drop.
 */

import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { tick } from '@/features/vault/ui/haptics';
import { raised, sheet, useStyles, type Palette } from '@/features/vault/ui/theme';
import type { SimklItem, SimklStatus } from '../logic';
import Poster from './Poster';
import { fmtAgo } from './time';

export default function Stalled({
  items,
  onOpen,
  onCarryOn,
  onStatus,
}: {
  items: SimklItem[];
  onOpen: (item: SimklItem) => void;
  onCarryOn: (item: SimklItem) => void;
  onStatus: (item: SimklItem, status: SimklStatus) => Promise<void>;
}) {
  const styles = useStyles(makeStyles);
  const [busy, setBusy] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 3);
  const set = async (item: SimklItem, status: SimklStatus) => {
    tick();
    setBusy(item.simklId);
    try {
      await onStatus(item, status);
    } finally {
      setBusy(null);
    }
  };
  return (
    <View style={styles.box}>
      {shown.map((item, i) => {
        const since = item.lastWatchedAt ? `Last watched ${fmtAgo(item.lastWatchedAt)}` : `Added ${fmtAgo(item.addedAt ?? '')}`;
        return (
          <View key={item.simklId} style={[styles.row, i > 0 && styles.line, busy === item.simklId && styles.busy]}>
            <TouchableOpacity style={styles.top} onPress={() => onOpen(item)} accessibilityRole="button">
              <Poster path={item.poster} title={item.title} width={44} height={66} radius={8} hideTitle />
              <View style={styles.text}>
                <Text style={styles.title} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.sub} numberOfLines={2}>
                  {since} · {item.nextToWatch} is next
                </Text>
              </View>
            </TouchableOpacity>
            <View style={styles.buttons}>
              <TouchableOpacity
                style={[styles.btn, styles.btnMain]}
                disabled={busy !== null}
                onPress={() => {
                  tick();
                  onCarryOn(item);
                }}
                accessibilityRole="button"
                accessibilityHint="Asks again in two months">
                <Text style={styles.btnMainText}>Carry on</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} disabled={busy !== null} onPress={() => void set(item, 'hold')} accessibilityRole="button">
                <Text style={styles.btnText}>On hold</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} disabled={busy !== null} onPress={() => void set(item, 'dropped')} accessibilityRole="button">
                <Text style={[styles.btnText, styles.drop]}>Drop</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
      {items.length > 3 && (
        <TouchableOpacity style={[styles.more, styles.line]} onPress={() => setAll(!all)} accessibilityRole="button">
          <Text style={styles.moreText}>{all ? 'Show fewer' : `Show all ${items.length}`}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    box: { marginHorizontal: 16, borderRadius: 18, overflow: 'hidden', backgroundColor: raised(p) },
    row: { padding: 12, gap: 10 },
    line: { borderTopWidth: 0.5, borderTopColor: p.separator },
    busy: { opacity: 0.5 },
    top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    text: { flex: 1, minWidth: 0, gap: 2 },
    title: { color: p.text, fontSize: 16, fontWeight: '700' },
    sub: { color: p.textSecondary, fontSize: 13, lineHeight: 18 },
    buttons: { flexDirection: 'row', gap: 8 },
    btn: { flex: 1, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: p.scheme === 'light' ? p.card : p.circle },
    btnMain: { backgroundColor: p.text },
    btnText: { color: p.text, fontSize: 14, fontWeight: '700' },
    btnMainText: { color: p.bg, fontSize: 14, fontWeight: '800' },
    drop: { color: p.dangerText },
    more: { alignItems: 'center', paddingVertical: 12 },
    moreText: { color: p.link, fontSize: 15, fontWeight: '600' },
  });
