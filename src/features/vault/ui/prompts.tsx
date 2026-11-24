/**
 * Two small sheets used everywhere: a list of options (long-press menus) and
 * a one-line text prompt (new album, rename...). Alert.prompt is iOS-only and
 * absent in the browser preview, so these are drawn by hand.
 */

import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Modal } from './screen';

import { tick } from './haptics';
import Icon from './Icon';
import type { IconName } from './icons';
import { sheet, usePalette, useStyles, type Palette } from './theme';

export type OptionItem = { label: string; hint?: string; danger?: boolean; /** A small icon before the label. */ icon?: IconName; onPress: () => void };

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
  const p = usePalette();
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
      <View style={[styles.backdrop, { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 10) + 8 }]}>
        <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={() => close()} accessibilityLabel="Close" />
        {/* A long list scrolls instead of running off the top of the screen. */}
        <View style={[styles.card, { flexShrink: 1 }]}>
          <View style={styles.head}>
            <Text style={styles.title} numberOfLines={2} accessibilityRole="header">
              {title}
            </Text>
            <TouchableOpacity style={styles.close} onPress={() => close()} accessibilityLabel="Cancel" hitSlop={8}>
              <Icon name="close" size={13} color={p.icon} weight="bold" />
            </TouchableOpacity>
          </View>
          <ScrollView bounces={false} style={{ flexShrink: 1 }} contentContainerStyle={styles.list}>
            {options.map((o, i) => {
              const { checked, hint } = splitCheck(o.hint);
              const stacked = long(o);
              return (
                <TouchableOpacity
                  key={o.label}
                  style={[styles.row, i > 0 && styles.rowLine, stacked && styles.rowStacked]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: checked }}
                  accessibilityLabel={hint ? `${o.label}, ${hint}` : o.label}
                  onPress={() => {
                    tick();
                    close(o.onPress);
                  }}>
                  {o.icon && (
                    <View style={styles.rowIcon}>
                      <Icon name={o.icon} size={17} color={o.danger ? p.dangerText : p.text} />
                    </View>
                  )}
                  <View style={[styles.rowBody, stacked && styles.rowBodyStacked]}>
                    <Text style={[styles.rowLabel, o.danger && styles.danger, !stacked && styles.rowLabelShrink, checked && styles.rowLabelOn]}>{o.label}</Text>
                    {!!hint && <Text style={[styles.rowHint, stacked && styles.rowHintStacked]}>{hint}</Text>}
                  </View>
                  {checked && <Icon name="check" size={15} color={p.accent} weight="bold" />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Hints may mark the current choice with a leading check ("✓", "✓ Keep full size"): drawn as an icon. */
function splitCheck(hint: string | undefined): { checked: boolean; hint: string } {
  if (!hint) return { checked: false, hint: '' };
  const t = hint.trim();
  if (t.startsWith('✓')) return { checked: true, hint: t.slice(1).trim() };
  return { checked: false, hint: t };
}

/** A label and hint too long for one line: the hint goes under the label. */
const long = (o: OptionItem) => {
  const hint = splitCheck(o.hint).hint;
  return !!hint && o.label.length + hint.length > 34;
};

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
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: p.backdrop, paddingHorizontal: 10 },
    backdropTap: { flex: 1 },
    card: { backgroundColor: p.panel, borderRadius: 28, overflow: 'hidden' },
    head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 20, paddingRight: 14, paddingTop: 16, paddingBottom: 8 },
    title: { flex: 1, color: p.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
    close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: p.circle },
    list: { marginHorizontal: 10, marginBottom: 10, backgroundColor: p.card, borderRadius: 18, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 52, paddingVertical: 12 },
    rowLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.separator },
    rowStacked: { paddingVertical: 11 },
    rowIcon: { width: 22, alignItems: 'center' },
    rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowBodyStacked: { flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 3 },
    rowLabel: { color: p.text, fontSize: 16, fontWeight: '500' },
    rowLabelOn: { fontWeight: '700' },
    rowLabelShrink: { flexShrink: 1, marginRight: 12 },
    rowHint: { color: p.textSecondary, fontSize: 14, textAlign: 'right', flexShrink: 1 },
    rowHintStacked: { textAlign: 'left', fontSize: 13 },
    danger: { color: p.dangerText },

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
