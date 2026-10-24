/**
 * Import from Dropbox or OneDrive: pick a service, sign in, walk through your
 * folders, tick videos and bring them into the library (each is downloaded,
 * then imported like any other). Presentational only (see types.ts).
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GatedModal as Modal } from './screen';
import { fmtSize } from './format';
import { tick } from './haptics';
import Icon from './Icon';
import IconButton from './IconButton';
import { OptionsSheet } from './prompts';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { CloudBridge, CloudEntryUi, CloudKindUi } from './types';

export default function CloudSheet({ cloud, onClose }: { cloud: CloudBridge; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [services, setServices] = useState<{ kind: CloudKindUi; name: string; configured: boolean; connected: boolean }[]>([]);
  const [kind, setKind] = useState<CloudKindUi | null>(null);
  /** The folders you went into (the last is the one shown). */
  const [path, setPath] = useState<{ id: string | null; name: string }[]>([]);
  const [entries, setEntries] = useState<CloudEntryUi[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);

  const reloadServices = () => {
    cloud
      .services()
      .then(setServices)
      .catch(() => undefined);
  };
  useEffect(reloadServices, []); // eslint-disable-line react-hooks/exhaustive-deps

  const here = path[path.length - 1] ?? null;
  useEffect(() => {
    if (!kind || !here) return;
    let live = true;
    setEntries(null);
    setError('');
    cloud
      .list(kind, here.id)
      .then((e) => live && setEntries(e))
      .catch((e) => {
        if (!live) return;
        setEntries([]);
        setError(String(e?.message ?? e));
      });
    return () => {
      live = false;
    };
  }, [kind, here?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function open(k: CloudKindUi) {
    const s = services.find((x) => x.kind === k);
    if (!s?.configured) return;
    setError('');
    try {
      if (!s.connected && !(await cloud.signIn(k))) return;
      reloadServices();
      setKind(k);
      setPath([{ id: k === 'dropbox' ? '' : null, name: s.name }]);
      setPicked(new Set());
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }

  function back() {
    if (path.length > 1) setPath(path.slice(0, -1));
    else {
      setKind(null);
      setPath([]);
      setEntries(null);
    }
  }

  const chosen = (entries ?? []).filter((e) => picked.has(e.id));
  const bytes = chosen.reduce((a, e) => a + e.size, 0);

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingBottom: insets.bottom + 10 }]}>
        <View style={styles.header}>
          <IconButton icon={kind ? 'back' : 'close'} label={kind ? 'Back' : 'Close'} onPress={kind ? back : onClose} />
          <Text style={styles.title} numberOfLines={1}>
            {here?.name ?? 'Cloud drives'}
          </Text>
          {kind ? <IconButton icon="more" label="Account" onPress={() => setMenu(true)} /> : <View style={{ width: 40 }} />}
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}

        {!kind ? (
          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.hint}>Bring videos in from your cloud drive. You sign in on the service's own page; ReelVault never sees your password.</Text>
            {services.map((s) => (
              <TouchableOpacity key={s.kind} style={[styles.service, !s.configured && { opacity: 0.5 }]} disabled={!s.configured} onPress={() => void open(s.kind)}>
                <Icon name="storage" size={20} color={p.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.serviceName}>{s.name}</Text>
                  <Text style={styles.meta}>{!s.configured ? 'Not set up in this build yet' : s.connected ? 'Signed in' : 'Tap to sign in'}</Text>
                </View>
                {s.configured && <Icon name="forward" size={14} color={p.textMuted} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : entries === null ? (
          <ActivityIndicator color={p.textSecondary} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            {entries.length === 0 && !error && <Text style={styles.hint}>No folders or videos here.</Text>}
            {entries.map((e) => {
              const on = picked.has(e.id);
              return (
                <TouchableOpacity
                  key={e.id}
                  style={[styles.row, on && styles.rowOn]}
                  onPress={() => {
                    tick();
                    if (e.folder) setPath([...path, { id: e.id, name: e.name }]);
                    else
                      setPicked((cur) => {
                        const n = new Set(cur);
                        if (n.has(e.id)) n.delete(e.id);
                        else n.add(e.id);
                        return n;
                      });
                  }}>
                  <Icon name={e.folder ? 'lists' : 'film'} size={18} color={e.folder ? p.accent : p.textSecondary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={2}>
                      {e.name}
                    </Text>
                    {!e.folder && <Text style={styles.meta}>{fmtSize(e.size)}</Text>}
                  </View>
                  {e.folder ? <Icon name="forward" size={13} color={p.textMuted} /> : <Icon name={on ? 'checkCircle' : 'circle'} size={20} color={on ? p.accent : p.textMuted} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {kind && chosen.length > 0 && (
          <TouchableOpacity
            style={styles.importBtn}
            onPress={() => {
              cloud.importFiles(kind, chosen);
              onClose();
            }}>
            <Text style={styles.importText}>
              Import {chosen.length} {chosen.length === 1 ? 'video' : 'videos'} · {fmtSize(bytes)}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      {menu && kind && (
        <OptionsSheet
          title={services.find((s) => s.kind === kind)?.name ?? ''}
          options={[
            {
              label: 'Sign out',
              danger: true,
              onPress: () =>
                void cloud.signOut(kind).then(() => {
                  setKind(null);
                  setPath([]);
                  reloadServices();
                }),
            },
          ]}
          onClose={() => setMenu(false)}
        />
      )}
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 14, paddingBottom: 8 },
    title: { flex: 1, color: p.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
    error: { color: p.dangerText, fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 },
    body: { padding: 14, gap: 8 },
    hint: { color: p.textSecondary, fontSize: 14, marginBottom: 6 },
    service: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.card, borderRadius: 14, padding: 14 },
    serviceName: { color: p.text, fontSize: 16, fontWeight: '700' },
    meta: { color: p.textSecondary, fontSize: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11 },
    rowOn: { backgroundColor: p.accentSoft },
    name: { color: p.text, fontSize: 15, fontWeight: '600' },
    importBtn: { marginHorizontal: 14, marginTop: 6, backgroundColor: p.accent, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
    importText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  });
