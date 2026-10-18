/**
 * Import HashPhotos info: how to export it from HashPhotos, then what the
 * file holds and what would change (matched videos, keywords, ratings,
 * titles, captions, flags), with "replace what's there" off by default.
 * Nothing changes until Apply.
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

import { planMetadata, type MetaFile } from '../hashphotos';
import { success } from './haptics';
import Icon from './Icon';
import { Section, SheetFrame, ToggleRow } from './sheets';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultActions, VaultItem } from './types';

const FIELD_NAMES: Record<string, string> = { filename: 'file names', keywords: 'keywords', rating: 'ratings', title: 'titles', caption: 'captions', flag: 'flags' };

export function MetaImportSheet({
  items,
  actions,
  autoPick = false,
  onDone,
  onClose,
}: {
  items: VaultItem[];
  actions: VaultActions;
  /** Open the file picker straight away (the browser preview). */
  autoPick?: boolean;
  onDone: (line: string) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [picked, setPicked] = useState<{ name: string; file: MetaFile } | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const plan = useMemo(() => (picked ? planMetadata(picked.file, items, overwrite) : null), [picked, items, overwrite]);

  const choose = () => {
    setError('');
    setBusy(true);
    actions
      .pickMetadataFile()
      .then((r) => r && setPicked(r))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (autoPick) choose();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    if (!plan || !plan.changes.length) return;
    setBusy(true);
    actions
      .applyMetadata(plan.changes)
      .then(() => {
        success();
        onDone(`HashPhotos info added to ${plan.changes.length} videos`);
        onClose();
      })
      .catch((e) => {
        setError(String(e));
        setBusy(false);
      });
  };

  const titles = plan?.changes.filter((c) => c.title).length ?? 0;
  const captions = plan?.changes.filter((c) => c.caption).length ?? 0;
  const flags = plan?.changes.filter((c) => c.flag).length ?? 0;

  return (
    <SheetFrame title="HashPhotos Info" onClose={onClose}>
      {!picked ? (
        <>
          <Text style={styles.lead}>Bring your HashPhotos keywords, ratings, titles and captions across to the videos you imported. Videos are matched by file name.</Text>
          <Section label="In HashPhotos">
            {['Open the album (or All Items) and tap Select → Select All.', 'Tap ⋯ → Export Metadata, and pick CSV (JSON or XML work too).', 'Save the file to Files (On My iPhone is fine).', 'Come back here and choose that file.'].map((t, i) => (
              <View key={i} style={styles.step}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{t}</Text>
              </View>
            ))}
          </Section>
          <TouchableOpacity style={styles.primary} onPress={choose} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Icon name="import" size={16} color="#fff" />}
            <Text style={styles.primaryText}>Choose the Metadata File…</Text>
          </TouchableOpacity>
        </>
      ) : (
        plan && (
          <>
            <View style={styles.fileRow}>
              <Icon name="checkCircle" size={22} color={p.success} />
              <View style={{ flex: 1 }}>
                <Text style={styles.fileName} numberOfLines={1}>
                  {picked.name}
                </Text>
                <Text style={styles.fileSub}>
                  {picked.file.format.toUpperCase()} · {picked.file.records.length} rows · has {picked.file.recognised.map((f) => FIELD_NAMES[f] ?? f).join(', ')}
                </Text>
              </View>
              <TouchableOpacity onPress={choose} hitSlop={8}>
                <Text style={styles.link}>Other file</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.big}>
              <Text style={styles.bigNum}>{plan.matched}</Text>
              <Text style={styles.bigLabel}>of {picked.file.records.length} files are in ReelVault</Text>
            </View>

            <Section label="What changes">
              {[
                { icon: 'tag' as const, text: `${plan.keywords} ${plan.keywords === 1 ? 'keyword' : 'keywords'} added to ${plan.changes.filter((c) => c.addKeywords.length).length} videos` },
                { icon: 'star' as const, text: `${plan.ratings} ${plan.ratings === 1 ? 'rating' : 'ratings'}` },
                { icon: 'edit' as const, text: `${titles} ${titles === 1 ? 'title' : 'titles'} · ${captions} ${captions === 1 ? 'caption' : 'captions'}` },
                { icon: 'flag' as const, text: `${flags} picks or rejects` },
              ].map((r) => (
                <View key={r.text} style={styles.change}>
                  <Icon name={r.icon} size={15} color={p.accent} />
                  <Text style={styles.changeText}>{r.text}</Text>
                </View>
              ))}
              <ToggleRow label="Replace what's already there" value={overwrite} onChange={setOverwrite} />
              <Text style={styles.hint}>Off: only fills in ratings, titles and captions a video doesn't have yet. Keywords are always added, never removed.</Text>
            </Section>

            {plan.unmatched.length > 0 && (
              <Text style={styles.hint}>
                Not in ReelVault yet: {plan.unmatched.slice(0, 4).join(', ')}
                {plan.unmatched.length > 4 ? ` and ${plan.unmatched.length - 4} more` : ''}. Import those videos first, then run this again.
              </Text>
            )}

            <TouchableOpacity style={[styles.primary, !plan.changes.length && { opacity: 0.5 }]} disabled={!plan.changes.length || busy} onPress={apply}>
              {busy ? <ActivityIndicator color="#fff" /> : <Icon name="check" size={16} color="#fff" />}
              <Text style={styles.primaryText}>{plan.changes.length ? `Apply to ${plan.changes.length} videos` : 'Nothing new to add'}</Text>
            </TouchableOpacity>
          </>
        )
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    lead: { color: p.textSoft, fontSize: 15 },
    step: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 4 },
    stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: `${p.accent}33`, alignItems: 'center', justifyContent: 'center' },
    stepNumText: { color: p.accent, fontSize: 12, fontWeight: '900' },
    stepText: { color: p.text, fontSize: 14, flex: 1 },
    primary: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: p.accent, borderRadius: 14, paddingVertical: 14 },
    primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
    fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: p.card, borderRadius: 14, padding: 12 },
    fileName: { color: p.text, fontSize: 15, fontWeight: '700' },
    fileSub: { color: p.textSecondary, fontSize: 12 },
    link: { color: p.link, fontWeight: '700' },
    big: { alignItems: 'center', paddingVertical: 8 },
    bigNum: { color: p.text, fontSize: 48, fontWeight: '900', letterSpacing: -1 },
    bigLabel: { color: p.textSecondary, fontSize: 14, fontWeight: '600' },
    change: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
    changeText: { color: p.text, fontSize: 15 },
    hint: { color: p.textSecondary, fontSize: 13 },
    error: { color: p.danger, fontSize: 13 },
  });
