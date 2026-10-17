/**
 * HashPhotos' "Adjust Date/Time": set one filming date, or (for several videos)
 * shift every date by the same amount. Plain number fields - there is no
 * native date picker in the build, and these work the same in the preview.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { sheet, usePalette, useStyles, type Palette } from './theme';
import Glyph from './Glyph';

type Mode = 'set' | 'shift';

const pad = (n: number) => String(n).padStart(2, '0');

export default function DateSheet({
  count,
  initial,
  onApply,
  onClose,
}: {
  /** How many videos are being changed. Shifting is only offered for more than one. */
  count: number;
  /** Date shown to start with (ms). */
  initial: number;
  onApply: (change: { setTo?: number; shiftBy?: number }) => Promise<void>;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const d = new Date(initial);
  const [mode, setMode] = useState<Mode>('set');
  const [fields, setFields] = useState({
    year: String(d.getFullYear()),
    month: pad(d.getMonth() + 1),
    day: pad(d.getDate()),
    hour: pad(d.getHours()),
    minute: pad(d.getMinutes()),
  });
  const [shift, setShift] = useState({ days: '0', hours: '0', minutes: '0' });

  const asNumber = (s: string) => (s.trim() === '' || s.trim() === '-' ? NaN : Number(s));

  const target = (() => {
    const y = asNumber(fields.year);
    const mo = asNumber(fields.month);
    const da = asNumber(fields.day);
    const h = asNumber(fields.hour);
    const mi = asNumber(fields.minute);
    if (![y, mo, da, h, mi].every(Number.isFinite)) return null;
    if (mo < 1 || mo > 12 || da < 1 || da > 31 || h < 0 || h > 23 || mi < 0 || mi > 59 || y < 1900 || y > 2200) return null;
    const date = new Date(y, mo - 1, da, h, mi);
    return date.getMonth() === mo - 1 ? date.getTime() : null; // 31 Feb -> invalid
  })();

  const shiftMs = (() => {
    const values = [asNumber(shift.days), asNumber(shift.hours), asNumber(shift.minutes)];
    if (!values.every(Number.isFinite)) return null;
    return ((values[0] * 24 + values[1]) * 60 + values[2]) * 60 * 1000;
  })();

  const ok = mode === 'set' ? target !== null : shiftMs !== null && shiftMs !== 0;

  function apply() {
    if (!ok) return;
    const change = mode === 'set' ? { setTo: target as number } : { shiftBy: shiftMs as number };
    onApply(change)
      .then(onClose)
      .catch((e) => console.log(`[DATE] failed: ${String(e)}`));
  }

  const field = (value: string, onChange: (v: string) => void, width: number, label: string) => (
    <View style={styles.fieldWrap}>
      <TextInput
        style={[styles.field, { width }]}
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^0-9-]/g, ''))}
        keyboardType="numbers-and-punctuation"
        keyboardAppearance={p.scheme}
        selectTextOnFocus
      />
      <Text style={styles.fieldLabel}>{label}</Text>
    </View>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />
          <View style={styles.sheet}>
            <View style={styles.header}>
              <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close">
                <Glyph name="close" />
              </TouchableOpacity>
              <Text style={styles.title}>Adjust Date & Time</Text>
              <TouchableOpacity style={[styles.primary, !ok && styles.disabled]} disabled={!ok} onPress={apply}>
                <Text style={styles.primaryText}>Apply</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {count > 1 && (
                <View style={styles.segment}>
                  {(['set', 'shift'] as Mode[]).map((m) => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.segmentItem, mode === m && styles.segmentOn]}
                      onPress={() => setMode(m)}>
                      <Text style={[styles.segmentText, mode === m && styles.segmentTextOn]}>
                        {m === 'set' ? 'Set one date' : 'Shift all dates'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {mode === 'set' ? (
                <>
                  <Text style={styles.label}>
                    {count > 1 ? `All ${count} videos get this date` : 'When this video was filmed'}
                  </Text>
                  <View style={styles.row}>
                    {field(fields.day, (v) => setFields((f) => ({ ...f, day: v })), 48, 'day')}
                    {field(fields.month, (v) => setFields((f) => ({ ...f, month: v })), 48, 'month')}
                    {field(fields.year, (v) => setFields((f) => ({ ...f, year: v })), 70, 'year')}
                    <Text style={styles.at}>at</Text>
                    {field(fields.hour, (v) => setFields((f) => ({ ...f, hour: v })), 48, 'hour')}
                    {field(fields.minute, (v) => setFields((f) => ({ ...f, minute: v })), 48, 'min')}
                  </View>
                  {target === null && <Text style={styles.error}>That is not a real date.</Text>}
                </>
              ) : (
                <>
                  <Text style={styles.label}>Move every date forward (or back, with a minus)</Text>
                  <View style={styles.row}>
                    {field(shift.days, (v) => setShift((s) => ({ ...s, days: v })), 64, 'days')}
                    {field(shift.hours, (v) => setShift((s) => ({ ...s, hours: v })), 64, 'hours')}
                    {field(shift.minutes, (v) => setShift((s) => ({ ...s, minutes: v })), 64, 'minutes')}
                  </View>
                  <Text style={styles.hint}>Useful when a camera's clock was wrong: e.g. -1 hours.</Text>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    kav: { flex: 1 },
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: p.backdrop },
    backdropTap: { flex: 1 },
    sheet: { backgroundColor: p.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 8,
      gap: 10,
    },
    title: { flex: 1, color: p.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    circle: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.circle,
    },
    circleIcon: { color: p.icon, fontSize: 15, fontWeight: '700' },
    primary: { backgroundColor: p.accent, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
    primaryText: { color: '#fff', fontWeight: '700' },
    disabled: { opacity: 0.4 },
    body: { paddingHorizontal: 16, paddingBottom: 40, gap: 14 },
    label: { color: p.textSecondary, fontSize: 13 },
    hint: { color: p.textSecondary, fontSize: 12 },
    error: { color: p.dangerText, fontSize: 13 },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' },
    at: { color: p.textSecondary, paddingTop: 12 },
    fieldWrap: { alignItems: 'center', gap: 4 },
    field: {
      backgroundColor: p.card,
      borderRadius: 10,
      paddingVertical: 10,
      color: p.text,
      textAlign: 'center',
      fontSize: 17,
      fontVariant: ['tabular-nums'],
      borderWidth: 1,
      borderColor: p.border,
    },
    fieldLabel: { color: p.textMuted, fontSize: 11 },
    segment: { flexDirection: 'row', backgroundColor: p.card, borderRadius: 10, padding: 3 },
    segmentItem: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
    segmentOn: { backgroundColor: p.accent },
    segmentText: { color: p.textSoft, fontWeight: '600', fontSize: 13 },
    segmentTextOn: { color: '#fff' },
  });
