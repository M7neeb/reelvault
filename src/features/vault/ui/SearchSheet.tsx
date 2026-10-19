/**
 * Search: a bottom sheet with the query box and the keyword cloud. Tapping a
 * keyword adds it to the query. Words that mean filters ("2024", "8+",
 * "long", "#holiday", "unwatched"...) show as chips under the box, with how
 * many videos match. Below the box: what you searched lately, and as you type,
 * videos whose names come close (typos too) and matching keywords.
 * Presentational only (see the rule in types.ts).
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Modal } from './screen';

import { sheet, usePalette, useStyles, type Palette } from './theme';
import { SEARCH_EXAMPLES, type SearchChip } from './query';
import type { UiTag, VaultItem } from './types';
import { Image } from 'expo-image';
import { friendlyName } from '../names';
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
  recent = [],
  suggestions = { videos: [], tags: [] },
  onOpenVideo,
  onClearRecent,
}: {
  recent?: string[];
  suggestions?: { videos: VaultItem[]; tags: string[] };
  onOpenVideo?: (v: VaultItem) => void;
  onClearRecent?: () => void;
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
            {!!draft.trim() && (suggestions.videos.length > 0 || suggestions.tags.length > 0) && (
              <View style={styles.understood}>
                {suggestions.videos.map((v) => (
                  <TouchableOpacity key={v.id} style={styles.sugRow} onPress={() => onOpenVideo?.(v)} accessibilityLabel={`Play ${friendlyName(v)}`}>
                    <Image source={v.thumbSource} style={styles.sugThumb} contentFit="cover" />
                    <Text style={styles.sugText} numberOfLines={1}>
                      {friendlyName(v)}
                    </Text>
                    {v.rating > 0 && <Text style={styles.sugRate}>★ {v.rating}</Text>}
                  </TouchableOpacity>
                ))}
                {suggestions.tags.length > 0 && (
                  <View style={styles.chipRow}>
                    {suggestions.tags.map((t) => (
                      <TouchableOpacity key={t} style={styles.cloudChip} onPress={() => commit(`#${t}`)}>
                        <Text style={styles.cloudChipText}>#{t}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}
            {!draft.trim() && recent.length > 0 && (
              <View style={styles.understood}>
                <View style={styles.recentHead}>
                  <Text style={styles.understoodLabel}>Recent</Text>
                  {onClearRecent && (
                    <TouchableOpacity onPress={onClearRecent} hitSlop={8}>
                      <Text style={styles.clearText}>Clear</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.chipRow}>
                  {recent.map((r) => (
                    <TouchableOpacity key={r} style={styles.exChip} onPress={() => commit(r)}>
                      <Text style={styles.exChipText}>{r}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
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
    sugRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 },
    sugThumb: { width: 54, height: 34, borderRadius: 7, backgroundColor: p.card },
    sugText: { color: p.text, fontSize: 15, fontWeight: '600', flex: 1 },
    sugRate: { color: p.rating, fontSize: 12, fontWeight: '800' },
    recentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    clearText: { color: p.link, fontSize: 12, fontWeight: '700' },
  });
