/**
 * Search: a bottom sheet with the query box and the keyword cloud. Tapping a
 * keyword adds it to the query. Presentational only (see the rule in types.ts).
 */

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { UiTag } from './types';
import Glyph from './Glyph';

export default function SearchSheet({
  value,
  tags,
  onChange,
  onClose,
  onSaveSmart,
  onFilters,
}: {
  value: string;
  tags: UiTag[];
  onChange: (v: string) => void;
  onClose: () => void;
  /** Turn the current search into a Smart Filter. */
  onSaveSmart: () => void;
  /** Open the built-in search filters (rating, date, length, size, shape...). */
  onFilters: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [draft, setDraft] = useState(value);

  function commit(next: string) {
    setDraft(next);
    onChange(next);
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close">
                <Glyph name="close" />
              </TouchableOpacity>
              <Text style={styles.title}>Search</Text>
              <TouchableOpacity style={styles.searchBtn} onPress={onClose}>
                <Text style={styles.searchBtnText}>Search</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.input}
              placeholder="name, notes or keyword…"
              placeholderTextColor={p.textMuted}
              value={draft}
              onChangeText={commit}
              autoCapitalize="none"
              autoFocus
              returnKeyType="search"
              onSubmitEditing={onClose}
              keyboardAppearance={p.scheme}
            />

            <View style={styles.actions}>
              <TouchableOpacity style={styles.saveSmart} onPress={onFilters}>
                <Text style={styles.saveSmartText}>Filters…</Text>
              </TouchableOpacity>
              {!!draft.trim() && (
                <TouchableOpacity style={styles.saveSmart} onPress={onSaveSmart}>
                  <Text style={styles.saveSmartText}>Save as Smart Filter</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.section}>Keywords</Text>
            <ScrollView contentContainerStyle={styles.cloud} keyboardShouldPersistTaps="handled">
              {tags.length === 0 && <Text style={styles.muted}>No keywords yet.</Text>}
              {tags.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.cloudChip}
                  onPress={() => commit(draft ? `${draft} ${t.name}` : t.name)}>
                  <Text style={styles.cloudChipText}>{t.name}</Text>
                </TouchableOpacity>
              ))}
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
    sheet: {
      backgroundColor: p.panel,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 16,
      gap: 12,
      maxHeight: '75%',
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    circle: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.circle,
    },
    circleIcon: { color: p.icon, fontSize: 15, fontWeight: '700' },
    title: { color: p.text, fontSize: 17, fontWeight: '700' },
    searchBtn: { backgroundColor: p.accent, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 999 },
    searchBtnText: { color: '#fff', fontWeight: '700' },
    input: {
      backgroundColor: p.card,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
      color: p.text,
    },
    actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    saveSmart: {
      alignSelf: 'flex-start',
      backgroundColor: p.card,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    saveSmartText: { color: p.link, fontWeight: '700', fontSize: 13 },
    section: { color: p.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
    cloud: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 12 },
    cloudChip: {
      borderWidth: 1,
      borderColor: p.accent,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    cloudChipText: { color: p.link, fontSize: 13, fontWeight: '600' },
    muted: { color: p.textMuted, fontStyle: 'italic' },
  });
