/**
 * Sign in to Simkl with a code: tap Connect, open simkl.com/pin (pre-filled),
 * approve, come back. No password is typed into ReelVault.
 */

import { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import type { ConnectCode, SimklActions } from './types';

export function ConnectCard({ actions, initialCode }: { actions: SimklActions; initialCode?: ConnectCode }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [code, setCode] = useState<ConnectCode | null>(initialCode ?? null);
  const [waiting, setWaiting] = useState(!!initialCode);
  const [error, setError] = useState('');

  async function start() {
    setError('');
    setWaiting(true);
    const ok = await actions.connect((c) => {
      setCode(c);
      // Open the approval page straight away; the code is pre-filled there.
      actions.openUrl(c.url);
    });
    setWaiting(false);
    setCode(null);
    if (!ok) setError('Not connected. The code may have run out - try again.');
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Connect your Simkl account</Text>
      <Text style={styles.body}>
        Your movies, shows and anime from Simkl, with your ratings and watch status. Changes you make here are saved on Simkl
        too.
      </Text>
      {code ? (
        <>
          <Text style={styles.label}>Your code</Text>
          <Text style={styles.code} selectable>
            {code.code}
          </Text>
          <Text style={styles.body}>Approve it on simkl.com, then come back - this connects by itself.</Text>
          <View style={styles.row}>
            <TouchableOpacity style={styles.primary} onPress={() => actions.openUrl(code.url)}>
              <Text style={styles.primaryText}>Open simkl.com</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => {
                actions.cancelConnect();
                setCode(null);
                setWaiting(false);
              }}>
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.row}>
            <ActivityIndicator color={p.textSecondary} />
            <Text style={styles.hint}>Waiting for approval…</Text>
          </View>
        </>
      ) : (
        <TouchableOpacity style={[styles.primary, waiting && styles.disabled]} disabled={waiting} onPress={() => void start()}>
          <Text style={styles.primaryText}>{waiting ? 'Getting a code…' : 'Connect Simkl'}</Text>
        </TouchableOpacity>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    card: { backgroundColor: p.panel, borderRadius: 14, padding: 16, gap: 10 },
    title: { color: p.text, fontSize: 17, fontWeight: '700' },
    body: { color: p.textSoft, fontSize: 14 },
    label: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    code: { color: p.text, fontSize: 34, fontWeight: '800', letterSpacing: 4, fontVariant: ['tabular-nums'] },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    primary: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11, alignSelf: 'flex-start' },
    primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    secondary: { paddingHorizontal: 12, paddingVertical: 11 },
    secondaryText: { color: p.link, fontSize: 15 },
    disabled: { opacity: 0.5 },
    hint: { color: p.textSecondary, fontSize: 13 },
    error: { color: p.dangerText, fontSize: 13 },
  });
