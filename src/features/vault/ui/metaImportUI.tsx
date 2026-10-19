/**
 * Import HashPhotos info: how to export it from HashPhotos, then what the
 * file holds and what would change (matched videos, keywords, ratings,
 * titles, captions, flags), with "replace what's there" off by default.
 * Nothing changes until Apply.
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Share, Text, TouchableOpacity, View } from 'react-native';

import { planMetadata, type MetaFile } from '../hashphotos';
import { success } from './haptics';
import Icon from './Icon';
import { Section, SheetFrame, ToggleRow } from './sheets';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultActions, VaultItem } from './types';

const FIELD_NAMES: Record<string, string> = { filename: 'file names', keywords: 'keywords', rating: 'ratings', title: 'titles', caption: 'captions', flag: 'flags', size: 'sizes', durationMs: 'lengths' };

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
  const [showMissing, setShowMissing] = useState(false);
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

  /** Why nothing would change, so an all-zero list never looks like the keywords were lost. */
  const why = (() => {
    if (!picked || !plan || plan.changes.length || !plan.matched) return null;
    const has = picked.file.recognised.filter((f) => !['filename', 'size', 'durationMs'].includes(f));
    if (!has.length) return `No keywords, ratings, titles or captions were found in this file. Its columns are: ${picked.file.columns.join(', ') || 'none'}. Share the list so ReelVault can learn these names.`;
    const parts: string[] = [];
    if (!has.includes('keywords')) parts.push('The file has no keywords column.');
    else if (!plan.withKeywords) parts.push('The keywords column is empty for every video found.');
    else if (plan.keywordsAlreadyThere === plan.withKeywords)
      parts.push(`All ${plan.withKeywords} ${plan.withKeywords === 1 ? 'video with keywords already has' : 'videos with keywords already have'} them in ReelVault.`);
    if (plan.otherAlreadyThere) parts.push(overwrite ? 'Ratings, titles and captions already match.' : 'Ratings, titles and captions are already set (turn on Replace to use the file\'s).');
    return parts.join(' ');
  })();

  return (
    <SheetFrame title="HashPhotos Info" onClose={onClose}>
      {!picked ? (
        <>
          <Text style={styles.lead}>Bring your HashPhotos keywords, ratings, titles and captions across to the videos you imported. Videos are matched by file name (and by size or length when the file has them).</Text>
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
              <Text style={styles.bigLabel}>of {picked.file.records.length - plan.pictures.length} videos are in ReelVault</Text>
              {plan.pictures.length > 0 && (
                <Text style={styles.hint}>
                  {plan.pictures.length} {plan.pictures.length === 1 ? 'row is a picture' : 'rows are pictures'} (ReelVault keeps videos only)
                </Text>
              )}
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
              {!!why && (
                <View style={styles.why}>
                  <Text style={styles.whyText}>{why}</Text>
                  <TouchableOpacity onPress={() => void Share.share({ message: `Columns: ${picked.file.columns.join(', ')}` }).catch(() => undefined)} hitSlop={8}>
                    <Text style={styles.link}>Share the file's columns</Text>
                  </TouchableOpacity>
                </View>
              )}
              <ToggleRow label="Replace what's already there" value={overwrite} onChange={setOverwrite} />
              <Text style={styles.hint}>Off: only fills in ratings, titles and captions a video doesn't have yet. Keywords are always added, never removed.</Text>
            </Section>

            {plan.unmatched.length > 0 && (
              <Section label={`Not found in ReelVault (${plan.unmatched.length})`}>
                <Text style={styles.hint}>
                  No video here has this name, even allowing for a " 2" or "(1)" added when it was saved or characters a folder can't hold. Send these from HashPhotos (Wi-Fi skips any you already have), then run this again.
                </Text>
                {(showMissing ? plan.unmatched : plan.unmatched.slice(0, 5)).map((name, i) => (
                  <Text key={`${name}-${i}`} style={styles.missing} numberOfLines={2}>
                    {name}
                  </Text>
                ))}
                <View style={styles.missingActions}>
                  {plan.unmatched.length > 5 && (
                    <TouchableOpacity onPress={() => setShowMissing((x) => !x)} hitSlop={8}>
                      <Text style={styles.link}>{showMissing ? 'Show fewer' : `Show all ${plan.unmatched.length}`}</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => void Share.share({ message: plan.unmatched.join('\n') }).catch(() => undefined)}
                    hitSlop={8}
                  >
                    <Text style={styles.link}>Share the list</Text>
                  </TouchableOpacity>
                </View>
              </Section>
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
    missing: { color: p.text, fontSize: 14, paddingVertical: 3 },
    missingActions: { flexDirection: 'row', gap: 20, paddingTop: 6 },
    error: { color: p.danger, fontSize: 13 },
    why: { backgroundColor: p.card, borderRadius: 12, padding: 12, gap: 8, marginVertical: 4 },
    whyText: { color: p.text, fontSize: 14 },
  });
