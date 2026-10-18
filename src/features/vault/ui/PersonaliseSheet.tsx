/**
 * Settings → Personalise: the layout style (Standard, Simple, Detailed,
 * Compact, Desktop), the accent colour, the app icon, your own words for
 * ratings, and watching options (continue another time, hold for 2×, the
 * weekly Wrapped notification, keeping removed videos' info). Presentational only.
 */

import { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import { SUGGESTED_LABELS, type RatingLabels } from '../stats';
import { success, tick } from './haptics';
import Icon from './Icon';
import { Chip, Section, SheetFrame, ToggleRow, Wrap } from './sheets';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import { ACCENTS, LOOKS, type Look, type VaultActions, type VaultPrefs, type ViewOptions } from './types';

/** App icons (the names match app.json's alternate icons; null = the default). */
const APP_ICONS: { key: string | null; label: string; colors: [string, string]; image: number }[] = [
  { key: null, label: 'ReelVault', colors: ['#0A84FF', '#5838D6'], image: require('../../../../assets/icons/classic.png') },
  { key: 'Midnight', label: 'Midnight', colors: ['#16161C', '#040408'], image: require('../../../../assets/icons/midnight.png') },
  { key: 'Sunset', label: 'Sunset', colors: ['#FF9F0A', '#FF375F'], image: require('../../../../assets/icons/sunset.png') },
  { key: 'Forest', label: 'Forest', colors: ['#30D158', '#00785A'], image: require('../../../../assets/icons/forest.png') },
  { key: 'Grape', label: 'Grape', colors: ['#BF5AF2', '#5E5CE6'], image: require('../../../../assets/icons/grape.png') },
  { key: 'Mono', label: 'Mono', colors: ['#F5F5F7', '#DCDCE2'], image: require('../../../../assets/icons/mono.png') },
  { key: 'Ocean', label: 'Ocean', colors: ['#64D2FF', '#0040DD'], image: require('../../../../assets/icons/ocean.png') },
  { key: 'Cherry', label: 'Cherry', colors: ['#FF6B81', '#B0122E'], image: require('../../../../assets/icons/cherry.png') },
  { key: 'Gold', label: 'Gold', colors: ['#FFE066', '#FF8A00'], image: require('../../../../assets/icons/gold.png') },
  { key: 'Mint', label: 'Mint', colors: ['#7BF1C8', '#0F9D9A'], image: require('../../../../assets/icons/mint.png') },
  { key: 'Aurora', label: 'Aurora', colors: ['#30D158', '#5E5CE6'], image: require('../../../../assets/icons/aurora.png') },
  { key: 'Rose', label: 'Rose', colors: ['#FFC2D4', '#FF4F7B'], image: require('../../../../assets/icons/rose.png') },
];

/** A tiny drawing of each layout, so the choice is visual. */
function LookSketch({ look, on }: { look: Look; on: boolean }) {
  const p = usePalette();
  const ink = on ? p.accent : p.textMuted;
  const box = (w: number | `${number}%`, h: number, extra: object = {}) => (
    <View style={[{ width: w, height: h, borderRadius: 2, backgroundColor: ink, opacity: 0.85 }, extra]} />
  );
  const line = (w: `${number}%`) => <View style={{ width: w, height: 3, borderRadius: 2, backgroundColor: ink, opacity: 0.5, marginTop: 2 }} />;
  const frame = { width: 56, height: 74, borderRadius: 8, borderWidth: 1.5, borderColor: on ? p.accent : p.border, padding: 4, gap: 3, overflow: 'hidden' as const };
  switch (look) {
    case 'simple':
      return (
        <View style={frame}>
          <View style={{ flexDirection: 'row', gap: 3 }}>
            {box(22, 22)}
            {box(22, 22)}
          </View>
          <View style={{ flexDirection: 'row', gap: 3 }}>
            {box(22, 22)}
            {box(22, 22)}
          </View>
        </View>
      );
    case 'detailed':
      return (
        <View style={frame}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 3 }}>
              {box(16, 11)}
              <View style={{ flex: 1 }}>
                {line('90%')}
                {line('60%')}
              </View>
            </View>
          ))}
        </View>
      );
    case 'compact':
      return (
        <View style={[frame, { flexDirection: 'row', flexWrap: 'wrap', gap: 2 }]}>
          {Array.from({ length: 25 }, (_, i) => (
            <View key={i}>{box(7.5, 7.5)}</View>
          ))}
        </View>
      );
    case 'desktop':
      return (
        <View style={[frame, { flexDirection: 'row', gap: 3 }]}>
          <View style={{ width: 8, gap: 3 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <View key={i}>{box(8, 6)}</View>
            ))}
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 2 }}>
                {box('40%', 4, { opacity: i === 0 ? 1 : 0.5 })}
                {box('25%', 4, { opacity: 0.4 })}
                {box('25%', 4, { opacity: 0.4 })}
              </View>
            ))}
          </View>
        </View>
      );
    default:
      return (
        <View style={[frame, { flexDirection: 'row', flexWrap: 'wrap', gap: 2 }]}>
          {Array.from({ length: 12 }, (_, i) => (
            <View key={i}>{box(13, 13)}</View>
          ))}
        </View>
      );
  }
}

export default function PersonaliseSheet({
  viewOptions,
  onViewOptions,
  prefs,
  actions,
  onClose,
}: {
  viewOptions: ViewOptions;
  onViewOptions: (v: ViewOptions) => void;
  prefs: VaultPrefs;
  actions: VaultActions;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [labels, setLabels] = useState<RatingLabels>(prefs.ratingLabels);
  const [icon, setIcon] = useState<string | null>(() => actions.appIcon());
  const [weekly, setWeekly] = useState<boolean | null>(null);
  const [otd, setOtd] = useState<boolean | null>(null);
  const [yearly, setYearly] = useState<boolean | null>(null);
  const [monthly, setMonthly] = useState<boolean | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    actions.getWrappedReminder().then(setWeekly).catch(() => setWeekly(false));
    actions.getOnThisDayReminder().then(setOtd).catch(() => setOtd(false));
    actions.getYearWrappedReminder().then(setYearly).catch(() => setYearly(false));
    actions.getMonthWrappedReminder().then(setMonthly).catch(() => setMonthly(false));
  }, [actions]);

  /** Turns a notification on or off; a refusal from iOS turns the switch back off with a note. */
  const toggle = (v: boolean, set: (b: boolean) => void, save: (on: boolean) => Promise<boolean>) => {
    set(v);
    save(v)
      .then((ok) => {
        if (!ok) {
          set(false);
          setNote('Notifications are off for ReelVault in iPhone Settings → Notifications.');
        }
      })
      .catch(() => set(!v));
  };

  const savePrefs = (next: Partial<VaultPrefs>) => void actions.setPrefs({ ...prefs, ratingLabels: labels, ...next });

  return (
    <SheetFrame
      title="Personalise"
      onClose={() => {
        savePrefs({});
        onClose();
      }}
      action={{
        label: 'Done',
        onPress: () => {
          savePrefs({});
          onClose();
        },
      }}>
      {!!note && <Text style={styles.note}>{note}</Text>}

      <Section label="Layout">
        <View style={styles.looks}>
          {LOOKS.map((l) => {
            const on = viewOptions.look === l.key;
            return (
              <TouchableOpacity
                key={l.key}
                style={styles.look}
                onPress={() => {
                  tick();
                  onViewOptions({ ...viewOptions, look: l.key });
                }}
                accessibilityLabel={`${l.label} layout`}>
                <LookSketch look={l.key} on={on} />
                <Text style={[styles.lookLabel, on && { color: p.accent }]}>{l.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={styles.hint}>{LOOKS.find((l) => l.key === viewOptions.look)?.hint}. Used on the Videos and the Simkl tabs.</Text>
      </Section>

      <Section label="Accent colour">
        <View style={styles.swatches}>
          {ACCENTS.map((a) => {
            const on = (viewOptions.accent ?? '#0A84FF').toLowerCase() === a.key.toLowerCase();
            return (
              <TouchableOpacity
                key={a.key}
                style={[styles.swatch, { backgroundColor: a.key }, on && styles.swatchOn]}
                onPress={() => {
                  tick();
                  onViewOptions({ ...viewOptions, accent: a.key === '#0A84FF' ? null : a.key });
                }}
                accessibilityLabel={a.label}>
                {on && <Icon name="check" size={16} color="#fff" weight="bold" />}
              </TouchableOpacity>
            );
          })}
        </View>
      </Section>

      <Section label="App icon">
        <View style={styles.icons}>
          {APP_ICONS.map((i) => {
            const on = icon === i.key;
            return (
              <TouchableOpacity
                key={i.label}
                style={styles.iconCell}
                disabled={!actions.canChangeAppIcon()}
                onPress={() => {
                  actions
                    .setAppIcon(i.key)
                    .then(() => {
                      success();
                      setIcon(i.key);
                    })
                    .catch((e) => setNote(`Icon not changed: ${String(e?.message ?? e)}`));
                }}>
                <View style={[styles.iconPreview, { backgroundColor: i.colors[0] }, on && styles.iconOn]}>
                  <Image source={i.image} style={styles.iconImg} contentFit="cover" />
                </View>
                <Text style={[styles.iconLabel, on && { color: p.accent }]}>{i.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {!actions.canChangeAppIcon() && <Text style={styles.hint}>This device cannot change app icons.</Text>}
        <Text style={styles.hint}>iOS shows a short message when the icon changes.</Text>
      </Section>

      <Section label="Rating words">
        <Text style={styles.hint}>Your own word for a rating, shown next to the stars (e.g. 1 = Waste of time, 5 = Mid). Leave any empty.</Text>
        <Wrap>
          <Chip label="Use suggestions" onPress={() => setLabels({ ...SUGGESTED_LABELS, ...labels })} />
          <Chip label="Clear all" danger onPress={() => setLabels({})} />
        </Wrap>
        <View style={styles.labelList}>
          {Array.from({ length: 10 }, (_, i) => 10 - i).map((n) => (
            <View key={n} style={styles.labelRow}>
              <Text style={styles.labelNum}>★ {n}</Text>
              <TextInput
                style={styles.labelInput}
                value={labels[n] ?? ''}
                onChangeText={(t) => setLabels({ ...labels, [n]: t })}
                onEndEditing={() => savePrefs({})}
                placeholder={SUGGESTED_LABELS[n] ?? 'No word'}
                placeholderTextColor={p.textMuted}
                maxLength={40}
                keyboardAppearance={p.scheme}
                returnKeyType="done"
              />
            </View>
          ))}
        </View>
      </Section>

      <Section label="Watching">
        <ToggleRow label="Continue another time (videos of 5 min or more)" value={prefs.resumeEnabled} onChange={(v) => savePrefs({ resumeEnabled: v })} />
        <Text style={styles.hint}>Tap the clock in the player and it picks up 2.5 minutes before where you stopped next time.</Text>
        <ToggleRow label="Hold the left or right edge for 2× speed" value={prefs.holdForSpeed} onChange={(v) => savePrefs({ holdForSpeed: v })} />
        <ToggleRow
          label="Keep the info of removed videos I never rated"
          value={prefs.keepUnrated}
          onChange={(v) => savePrefs({ keepUnrated: v })}
        />
        <Text style={styles.hint}>
          When a video is removed for good, its rating, status, keywords and picture stay in Overview. Off = only videos you rated, gave a status or put in a series.
        </Text>
        {weekly !== null && <ToggleRow label="Weekly Wrapped notification (Monday 10:00)" value={weekly} onChange={(v) => toggle(v, setWeekly, actions.setWrappedReminder)} />}
        {otd !== null && <ToggleRow label="On this day (9:00, on days with old videos)" value={otd} onChange={(v) => toggle(v, setOtd, actions.setOnThisDayReminder)} />}
        {monthly !== null && <ToggleRow label="Last month's Wrapped is ready (the 1st)" value={monthly} onChange={(v) => toggle(v, setMonthly, actions.setMonthWrappedReminder)} />}
        {yearly !== null && <ToggleRow label="Your year's Wrapped is ready (1 December)" value={yearly} onChange={(v) => toggle(v, setYearly, actions.setYearWrappedReminder)} />}
        <Text style={styles.hint}>On this day only fires on days you have videos from that date in earlier years; tapping it plays the memory.</Text>
      </Section>
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    note: { color: p.link, fontSize: 13, fontWeight: '600' },
    hint: { color: p.textSecondary, fontSize: 12 },
    looks: { flexDirection: 'row', justifyContent: 'space-between' },
    look: { alignItems: 'center', gap: 6 },
    lookLabel: { color: p.textSoft, fontSize: 12, fontWeight: '700' },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    swatchOn: { borderWidth: 3, borderColor: p.text },
    icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    iconCell: { alignItems: 'center', gap: 5, width: 62 },
    iconPreview: { width: 60, height: 60, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    iconImg: { width: '100%', height: '100%' },
    iconOn: { borderWidth: 3, borderColor: p.accent },
    iconLabel: { color: p.textSoft, fontSize: 11, fontWeight: '700' },
    labelList: { backgroundColor: p.card, borderRadius: 14, overflow: 'hidden' },
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: p.separator },
    labelNum: { color: p.rating, fontSize: 14, fontWeight: '800', width: 46, fontVariant: ['tabular-nums'] },
    labelInput: { flex: 1, color: p.text, fontSize: 15, paddingVertical: 11 },
  });
