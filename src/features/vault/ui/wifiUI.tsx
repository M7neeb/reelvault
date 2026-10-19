/**
 * From Computer (Wi-Fi): while this screen is open the phone shows an address
 * and a 4-digit code. On a computer on the same Wi-Fi, open the address, type
 * the code, and drop videos in; each one is imported the moment it arrives.
 * Closing the screen stops it (nothing listens otherwise).
 */

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Modal, useWindowDimensions } from './screen';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fmtSize } from './format';
import { success, warn } from './haptics';
import Icon from './Icon';
import { gradient } from './insightParts';
import { Aurora, Pulse } from './storyKit';
import type { WifiBridge, WifiEvent } from './types';

type Row = { name: string; state: 'receiving' | 'imported' | 'duplicate' | 'failed'; received: number; total: number; reason?: string };

export function WifiScreen({ wifi, onClose }: { wifi: WifiBridge | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [info, setInfo] = useState<{ url: string | null; code: string } | null>(null);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const rowsRef = useRef<Row[]>([]);

  useEffect(() => {
    if (!wifi) return;
    let alive = true;
    const onEvent = (e: WifiEvent) => {
      const list = [...rowsRef.current];
      const i = list.findIndex((r) => r.name === e.name && r.state === 'receiving');
      const at = i >= 0 ? i : list.findIndex((r) => r.name === e.name && e.kind !== 'receiving');
      const base: Row = at >= 0 ? list[at] : { name: e.name, state: 'receiving', received: 0, total: 0 };
      const next: Row =
        e.kind === 'receiving'
          ? { ...base, state: 'receiving', received: e.received, total: e.total }
          : e.kind === 'failed'
            ? { ...base, state: 'failed', reason: e.reason }
            : { ...base, state: e.kind, received: base.total };
      if (e.kind === 'imported') success();
      if (e.kind === 'failed') warn();
      if (i >= 0) list[i] = next;
      else list.unshift(next);
      rowsRef.current = list.slice(0, 200);
      if (alive) setRows(rowsRef.current);
    };
    wifi
      .start(onEvent)
      .then((r) => alive && setInfo(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      void wifi.stop();
    };
  }, [wifi]);

  const done = rows.filter((r) => r.state === 'imported').length;
  const dupes = rows.filter((r) => r.state === 'duplicate').length;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: '#05050A' }}>
        <Aurora colors={['#0A2A6B', '#05050A']} accent="#30D158" width={width} height={height * 0.6} />
        <ScrollView contentContainerStyle={[styles.body, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 30 }]}>
          <View style={styles.top}>
            <TouchableOpacity style={styles.round} onPress={onClose} accessibilityLabel="Stop and close">
              <Icon name="close" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
          <Text style={styles.kicker}>FROM COMPUTER · WI-FI</Text>
          <Text style={styles.title}>Send videos from your PC</Text>

          {!wifi ? (
            <View style={styles.card}>
              <Icon name="wifi" size={28} color="#FF9F0A" />
              <Text style={styles.cardTitle}>Needs the new app version</Text>
              <Text style={styles.text}>Wi-Fi transfer is part of app 1.9. Install the new build over this one (your videos stay), then come back here.</Text>
            </View>
          ) : error ? (
            <View style={styles.card}>
              <Icon name="wifi" size={28} color="#FF453A" />
              <Text style={styles.cardTitle}>Wi-Fi transfer could not start</Text>
              <Text style={styles.text}>{error}</Text>
            </View>
          ) : !info ? (
            <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
          ) : !info.url ? (
            <View style={styles.card}>
              <Icon name="wifi" size={28} color="#FF9F0A" />
              <Text style={styles.cardTitle}>Connect to Wi-Fi first</Text>
              <Text style={styles.text}>The phone and the computer have to be on the same Wi-Fi network. Turn Wi-Fi on, then open this screen again.</Text>
            </View>
          ) : (
            <>
              <View style={[styles.card, gradient('linear-gradient(135deg, rgba(48,209,88,0.22) 0%, rgba(10,132,255,0.18) 100%)', 'rgba(255,255,255,0.08)')]}>
                <View style={styles.live}>
                  <Pulse>
                    <View style={styles.dot} />
                  </Pulse>
                  <Text style={styles.liveText}>Ready · keep this screen open</Text>
                </View>
                <Text style={styles.step}>1 · On the computer, open this in a browser:</Text>
                <Text style={styles.url} selectable>
                  {info.url}
                </Text>
                <Text style={styles.step}>2 · Type this code:</Text>
                <View style={styles.code}>
                  {info.code.split('').map((d, i) => (
                    <View key={i} style={styles.digit}>
                      <Text style={styles.digitText}>{d}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.step}>3 · Drop your videos onto the page. Each one goes into your vault as it arrives.</Text>
              </View>
              <Text style={styles.text}>
                Same Wi-Fi only; nothing goes over the internet. The phone needs free space for one video at a time. iOS may ask once to allow ReelVault on your local network: say Allow.
              </Text>
            </>
          )}

          {rows.length > 0 && (
            <>
              <Text style={styles.listHead}>
                {done} imported{dupes ? ` · ${dupes} already here` : ''}
              </Text>
              {rows.map((r, i) => (
                <Animated.View key={`${r.name}-${i}`} entering={FadeInDown} layout={LinearTransition} style={styles.row}>
                  <Icon
                    name={r.state === 'imported' ? 'checkCircle' : r.state === 'duplicate' ? 'copies' : r.state === 'failed' ? 'close' : 'import'}
                    size={18}
                    color={r.state === 'imported' ? '#30D158' : r.state === 'failed' ? '#FF453A' : r.state === 'duplicate' ? '#FF9F0A' : '#64D2FF'}
                  />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {r.name}
                    </Text>
                    {r.state === 'receiving' ? (
                      <View style={styles.track}>
                        <View style={[styles.fill, { width: `${r.total ? Math.round((r.received / r.total) * 100) : 0}%` }]} />
                      </View>
                    ) : (
                      <Text style={styles.rowSub}>{r.state === 'imported' ? `In your vault · ${fmtSize(r.total)}` : r.state === 'duplicate' ? 'Already in ReelVault - skipped' : r.reason}</Text>
                    )}
                  </View>
                  {r.state === 'receiving' && <Text style={styles.rowSub}>{r.total ? `${Math.round((r.received / r.total) * 100)}%` : ''}</Text>}
                </Animated.View>
              ))}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, gap: 14 },
  top: { flexDirection: 'row' },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  kicker: { color: '#30D158', fontSize: 12, fontWeight: '900', letterSpacing: 1.2, marginTop: 12 },
  title: { color: '#fff', fontSize: 32, fontWeight: '900', letterSpacing: -0.9, lineHeight: 36 },
  card: { borderRadius: 22, padding: 18, gap: 10, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  cardTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  text: { color: 'rgba(255,255,255,0.7)', fontSize: 14, lineHeight: 20 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#30D158' },
  liveText: { color: '#30D158', fontSize: 13, fontWeight: '800' },
  step: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '700', marginTop: 4 },
  url: { color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  code: { flexDirection: 'row', gap: 10 },
  digit: { width: 54, height: 64, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  digitText: { color: '#fff', fontSize: 32, fontWeight: '900' },
  listHead: { color: '#fff', fontSize: 17, fontWeight: '800', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: 12 },
  rowName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  rowSub: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600' },
  track: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  fill: { height: 5, backgroundColor: '#64D2FF' },
});
