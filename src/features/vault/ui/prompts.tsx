/**
 * Two small sheets used everywhere: a list of options (long-press menus) and
 * a one-line text prompt (new album, rename...). Alert.prompt is iOS-only and
 * absent in the browser preview, so these are drawn by hand.
 */

import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Modal } from './screen';

import { tick } from './haptics';
import { sheet, usePalette, useStyles, type Palette } from './theme';

export type OptionItem = { label: string; hint?: string; danger?: boolean; onPress: () => void };

/**
 * iOS shows one sheet, picker or page at a time, and refuses a new one while
 * the last is still fading away - silently. So a choice runs only once this
 * sheet is fully gone (onDismiss; a timer where that never comes).
 */
export function OptionsSheet({
  title,
  options,
  onClose,
}: {
  title: string;
  options: OptionItem[];
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(true);
  const after = useRef<(() => void) | null>(null);
  const done = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    if (timer.current) clearTimeout(timer.current);
    onClose();
    const run = after.current;
    after.current = null;
    run?.();
  };
  const close = (then?: () => void) => {
    if (!visible) return;
    after.current = then ?? null;
    setVisible(false);
    // onDismiss is iOS only; elsewhere (and as a safety net) a timer finishes.
    timer.current = setTimeout(finish, Platform.OS === 'ios' ? 700 : 0);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => close()} onDismiss={finish}>
      <View style={[styles.backdrop, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={() => close()} />
        {/* A long list scrolls instead of running off the top of the screen. */}
        <View style={[styles.card, { flexShrink: 1 }]}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <ScrollView bounces={false} style={{ flexShrink: 1 }}>
          {options.map((o) => (
            <TouchableOpacity
              key={o.label}
              style={[styles.row, long(o) && styles.rowStacked]}
              onPress={() => {
                tick();
                close(o.onPress);
              }}>
              <Text style={[styles.rowLabel, o.danger && styles.danger, !long(o) && styles.rowLabelShrink]}>{o.label}</Text>
              {!!o.hint && <Text style={[styles.rowHint, o.hint === '✓' && styles.rowCheck, long(o) && styles.rowHintStacked]}>{o.hint}</Text>}
            </TouchableOpacity>
          ))}
          </ScrollView>
        </View>
        <TouchableOpacity style={styles.cancelCard} onPress={() => close()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

/** A label and hint too long for one line: the hint goes under the label. */
const long = (o: OptionItem) => !!o.hint && o.hint !== '✓' && o.label.length + o.hint.length > 34;

export function PromptSheet({
  title,
  message,
  initial = '',
  placeholder,
  confirmLabel = 'Save',
  onSubmit,
  onClose,
}: {
  title: string;
  message?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [value, setValue] = useState(initial);
  const ok = value.trim().length > 0;

  function submit() {
    if (!ok) return;
    onClose();
    onSubmit(value.trim());
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdropCenter}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{title}</Text>
            {!!message && <Text style={styles.dialogMessage}>{message}</Text>}
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={setValue}
              placeholder={placeholder}
              placeholderTextColor={p.textMuted}
              autoFocus
              onSubmitEditing={submit}
              returnKeyType="done"
              keyboardAppearance={p.scheme}
            />
            <View style={styles.buttons}>
              <TouchableOpacity style={styles.button} onPress={onClose}>
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, !ok && styles.disabled]} disabled={!ok} onPress={submit}>
                <Text style={[styles.buttonText, styles.buttonPrimary]}>{confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    kav: { flex: 1 },
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: p.backdrop, padding: 10, paddingBottom: 34 },
    backdropTap: { flex: 1 },
    card: { backgroundColor: p.panel, borderRadius: 26, paddingVertical: 4, overflow: 'hidden' },
    cancelCard: { backgroundColor: p.panel, borderRadius: 26, alignItems: 'center', paddingVertical: 17, marginTop: 8 },
    rowCheck: { color: p.accent, fontSize: 17, fontWeight: '700' },
    title: { color: p.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 10, paddingHorizontal: 16 },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 18,
      paddingVertical: 14,
      borderTopWidth: 1,
      borderTopColor: p.separator,
    },
    rowStacked: { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 3, paddingVertical: 12 },
    rowLabel: { color: p.text, fontSize: 17 },
    rowLabelShrink: { flexShrink: 1, marginRight: 12 },
    rowHint: { color: p.textSecondary, fontSize: 14, textAlign: 'right', flexShrink: 1 },
    rowHintStacked: { textAlign: 'left', fontSize: 13 },
    danger: { color: p.dangerText },
    cancelText: { color: p.text, fontSize: 17, fontWeight: '700' },

    backdropCenter: { flex: 1, justifyContent: 'center', backgroundColor: p.backdrop, padding: 32 },
    dialog: { backgroundColor: p.panel, borderRadius: 26, padding: 20, gap: 12 },
    dialogTitle: { color: p.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    dialogMessage: { color: p.textSecondary, fontSize: 13, textAlign: 'center' },
    input: {
      backgroundColor: p.card,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
      color: p.text,
      borderWidth: 1,
      borderColor: p.border,
    },
    buttons: { flexDirection: 'row', gap: 10 },
    button: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 10, backgroundColor: p.card },
    buttonText: { color: p.link, fontSize: 16, fontWeight: '600' },
    buttonPrimary: { fontWeight: '800' },
    disabled: { opacity: 0.4 },
  });
