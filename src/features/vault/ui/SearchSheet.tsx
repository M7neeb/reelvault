/**
 * Search: a bottom sheet with the query box and the keyword cloud. Tapping a
 * keyword adds it to the query. Words that mean filters ("2024", "8+",
 * "long", "#holiday", "unwatched"...) show as chips under the box, with how
 * many videos match. Presentational only (see the rule in types.ts).
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
import { SEARCH_EXAMPLES, type SearchChip } from './query';
import type { UiTag } from './types';
import Glyph from './Glyph';

export default function SearchSheet({
  value,
  tags,
  chips = [],
  matches = null,
  onChange,
  onClose,
  onSaveSmart,
  onFilters,
}: {
  value: string;
  tags: UiTag[];
  /** What the query was understood as (empty for plain text). */
  chips?: SearchChip[];
  /** How many videos match right now (null while typing or empty). */
  matches?: number | null;
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
              placeholder="name, keyword, 2024, 8+, long, unwatched…"
              placeholderTextColor={p.textMuted}
              value={draft}
              onChangeText={commit}
              autoCapitalize="none"
              autoFocus
              returnKeyType="search"
              onSubmitEditing={onClose}
              keyboardAppearance={p.scheme}
            />

            {chips.length > 0 && (
              <View style={styles.understood}>
                <Text style={styles.understoodLabel}>Looking for</Text>
                <View style={styles.chipRow}>
                  {chips.map((c) => (
                    <View key={c.key + c.label} style={[styles.smartChip, c.key === 'text' && styles.textChip]}>
                      <Text style={[styles.smartChipText, c.key === 'text' && { color: p.text }]}>{c.label}</Text>
                    </View>
                  ))}
                </View>
                {matches !== null && (
                  <Text style={styles.matches}>
                    {matches} {matches === 1 ? 'video' : 'videos'}
                  </Text>
                )}
              </View>
            )}
            {!draft.trim() && (
              <View style={styles.understood}>
                <Text style={styles.understoodLabel}>Try</Text>
                <View style={styles.chipRow}>
                  {SEARCH_EXAMPLES.map((ex) => (
                    <TouchableOpacity key={ex} style={styles.exChip} onPress={() => commit(ex)}>
                      <Text style={styles.exChipText}>{ex}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

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
    understood: { gap: 6 },
    understoodLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    smartChip: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
    textChip: { backgroundColor: p.card },
    smartChipText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    matches: { color: p.text, fontSize: 13, fontWeight: '800' },
    exChip: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
    exChipText: { color: p.textSoft, fontSize: 13, fontWeight: '600' },
  });
