/**
 * "Move to" for the titles you picked in the manga library: one tap puts all
 * of them in a status (Reading, Plan to Read, Completed...), and the
 * checkboxes add or take away your categories (keywords, also the ones from a
 * Tachimanga backup). Each row says how many of the picked titles are there
 * already. A new category can be typed right here.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MANGA_STATUSES, tagState, type MangaStatus } from '../../manga/mangaLogic';
import { tick } from '../haptics';
import Icon from '../Icon';
import { Modal } from '../screen';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { MangaUiSeries } from './mangaTypes';

export default function MoveSheet({
  picked,
  tags,
  onStatus,
  onTag,
  onClose,
}: {
  picked: MangaUiSeries[];
  /** Every category in the library, most used first. */
  tags: string[];
  onStatus: (status: MangaStatus | null) => void;
  /** Add the category to all picked titles, or take it off all of them. */
  onTag: (tag: string, add: boolean) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [typing, setTyping] = useState(false);
  const [name, setName] = useState('');
  // New categories typed here show at the top until the library catches up.
  const [added, setAdded] = useState<string[]>([]);
  const every = [...added.filter((t) => !tags.includes(t)), ...tags];
  // With many categories, a search box narrows the list.
  const [find, setFind] = useState('');
  const all = find.trim() ? every.filter((t) => t.toLowerCase().includes(find.trim().toLowerCase())) : every;
  const n = picked.length;
  const word = n === 1 ? 'title' : 'titles';

  const addNew = () => {
    const t = name.trim().replace(/^#/, '').trim();
    setName('');
    setTyping(false);
    if (!t) return;
    tick();
    setAdded((a) => (a.includes(t) ? a : [t, ...a]));
    onTag(t, true);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} accessibilityLabel="Close" />
          <View style={[styles.card, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <Text style={styles.title} numberOfLines={1}>
                Move {n} {word}
              </Text>
              <TouchableOpacity style={styles.done} onPress={onClose} accessibilityLabel="Done">
                <Text style={styles.doneText}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <Text style={styles.head}>Status</Text>
              <Text style={styles.sub}>{n === 1 ? 'Tap one to move it there.' : `Tap one to put all ${n} there.`}</Text>
              {[...MANGA_STATUSES, { key: null, label: 'No status' }].map((s) => {
                const here = picked.filter((x) => x.status === s.key).length;
                const on = here === n;
                return (
                  <TouchableOpacity
                    key={s.label}
                    style={styles.row}
                    onPress={() => {
                      tick();
                      onStatus(s.key as MangaStatus | null);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${s.label}${here ? `, ${here} already there` : ''}`}>
                    <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
                    <Text style={styles.rowText}>{s.label}</Text>
                    {here > 0 && !on && <Text style={styles.count}>{here} here</Text>}
                  </TouchableOpacity>
                );
              })}

              <View style={styles.rule} />
              <Text style={styles.head}>Categories</Text>
              <Text style={styles.sub}>{n === 1 ? 'Tick to add it, untick to take it out.' : `Tick to add all ${n}, untick to take them out.`} A title can be in many.</Text>
              {every.length > 8 && (
                <View style={styles.findRow}>
                  <Icon name="search" size={15} color={p.textSecondary} />
                  <TextInput value={find} onChangeText={setFind} placeholder={`Search ${every.length} categories`} placeholderTextColor={p.textMuted} style={styles.findInput} clearButtonMode="while-editing" autoCorrect={false} />
                </View>
              )}
              {all.map((t) => {
                const { has, state } = tagState(picked, t);
                return (
                  <TouchableOpacity
                    key={t}
                    style={styles.row}
                    onPress={() => {
                      tick();
                      onTag(t, state !== 'all');
                    }}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: state === 'all' ? true : state === 'some' ? 'mixed' : false }}>
                    <View style={[styles.box, state !== 'none' && styles.boxOn]}>
                      {state === 'all' && <Icon name="check" size={14} color={p.bg} weight="bold" />}
                      {state === 'some' && <Icon name="minus" size={14} color={p.bg} weight="bold" />}
                    </View>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {t}
                    </Text>
                    {state === 'some' && <Text style={styles.count}>{has} of {n}</Text>}
                  </TouchableOpacity>
                );
              })}
              {typing ? (
                <View style={styles.newRow}>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="New category, e.g. Isekai"
                    placeholderTextColor={p.textMuted}
                    style={styles.input}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={addNew}
                  />
                  <TouchableOpacity style={[styles.add, !name.trim() && { opacity: 0.4 }]} disabled={!name.trim()} onPress={addNew}>
                    <Text style={styles.addText}>Add</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.row} onPress={() => setTyping(true)}>
                  <View style={[styles.box, { borderStyle: 'dashed' }]}>
                    <Icon name="plus" size={14} color={p.accent} weight="bold" />
                  </View>
                  <Text style={[styles.rowText, { color: p.accent }]}>New category</Text>
                </TouchableOpacity>
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
    backdrop: { flex: 1, backgroundColor: p.backdrop },
    card: { backgroundColor: p.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '85%' },
    grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: p.separator, marginTop: 8 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingTop: 12, paddingBottom: 6, gap: 12 },
    title: { flex: 1, color: p.text, fontSize: 22, fontWeight: '900' },
    done: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
    doneText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    body: { paddingHorizontal: 22, paddingVertical: 8 },
    head: { color: p.text, fontSize: 16, fontWeight: '800', marginTop: 6 },
    sub: { color: p.textSecondary, fontSize: 13, marginTop: 2, marginBottom: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 13 },
    rowText: { flex: 1, color: p.text, fontSize: 18, fontWeight: '700' },
    count: { color: p.textSecondary, fontSize: 14, fontWeight: '700' },
    box: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    boxOn: { backgroundColor: p.accent },
    radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    radioOn: { borderWidth: 2.5 },
    radioDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: p.accent },
    rule: { height: 1, backgroundColor: p.separator, marginVertical: 10, marginHorizontal: -22 },
    findRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 12, height: 40 },
    findInput: { flex: 1, color: p.text, fontSize: 16 },
    newRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    input: { flex: 1, height: 42, borderRadius: 12, backgroundColor: p.card, paddingHorizontal: 12, color: p.text, fontSize: 16 },
    add: { backgroundColor: p.accent, borderRadius: 12, paddingHorizontal: 16, height: 42, justifyContent: 'center' },
    addText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  });
