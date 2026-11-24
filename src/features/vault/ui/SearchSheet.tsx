/**
 * Search in the video library: a page with the query box at the top. Words that mean filters
 * ("2024", "8+", "long", "#holiday", "unwatched"...) show as chips under the box, with how many
 * videos match. As you type: videos whose names come close (typos too) and matching keywords.
 * Before you type: what you searched lately, examples to try, and your keywords.
 * Presentational only (see the rule in types.ts).
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { friendlyName } from '../names';
import { fmtDuration } from './format';
import { tick } from './haptics';
import Icon from './Icon';
import type { IconName } from './icons';
import { SEARCH_EXAMPLES, type SearchChip } from './query';
import { Modal } from './screen';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { UiTag, VaultItem } from './types';

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
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(value);
  const typed = draft.trim();
  // On the iPhone a page sheet (the system draws its top edge; swipe down closes it).
  const sheetLike = Platform.OS === 'ios';

  function commit(next: string) {
    setDraft(next);
    onChange(next);
  }
  /** Adds a word to what is typed, unless it is there already. */
  const add = (word: string) => {
    tick();
    const words = draft.trim().split(/\s+/).filter(Boolean);
    if (words.some((w) => w.toLowerCase() === word.toLowerCase())) return;
    commit([...words, word].join(' '));
  };

  return (
    <Modal visible animationType="slide" presentationStyle={sheetLike ? 'pageSheet' : undefined} onRequestClose={onClose}>
      <KeyboardAvoidingView style={[styles.page, { paddingTop: sheetLike ? 14 : insets.top + 10 }]} behavior={sheetLike ? 'padding' : undefined}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            Search
          </Text>
          <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close" hitSlop={6}>
            <Icon name="close" size={15} color={p.icon} weight="bold" />
          </TouchableOpacity>
        </View>

        <View style={styles.box}>
          <Icon name="search" size={17} color={p.textMuted} />
          <TextInput
            style={styles.input}
            placeholder="Name, keyword, 2024, 8+, long…"
            placeholderTextColor={p.textMuted}
            value={draft}
            onChangeText={commit}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={onClose}
            keyboardAppearance={p.scheme}
            clearButtonMode="while-editing"
            accessibilityLabel="Search your videos"
          />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {chips.length > 0 && (
            <View style={styles.understood}>
              <Text style={styles.understoodLabel}>Looking for</Text>
              <View style={styles.wrap}>
                {chips.map((c) => (
                  <View key={c.key + c.label} style={[styles.filterChip, c.key === 'text' && styles.textChip]}>
                    <Text style={[styles.filterChipText, c.key === 'text' && { color: p.text }]}>{c.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {!!typed && suggestions.videos.length > 0 && (
            <View>
              <Text style={styles.section}>Videos</Text>
              <View style={styles.list}>
                {suggestions.videos.map((v, i) => (
                  <TouchableOpacity
                    key={v.id}
                    style={[styles.row, i > 0 && styles.rowLine]}
                    onPress={() => onOpenVideo?.(v)}
                    accessibilityLabel={`Play ${friendlyName(v)}`}>
                    <View style={styles.thumb}>
                      <Image source={v.thumbSource} style={styles.thumbImg} contentFit="cover" transition={120} />
                      {!!v.durationMs && <Text style={styles.thumbTime}>{fmtDuration(v.durationMs)}</Text>}
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle} numberOfLines={2}>
                        {friendlyName(v)}
                      </Text>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {new Date(v.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                    </View>
                    {v.rating > 0 && (
                      <View style={styles.rate}>
                        <Icon name="star" size={11} color={p.rating} />
                        <Text style={styles.rateText}>{v.rating}</Text>
                      </View>
                    )}
                    <Icon name="play" size={13} color={p.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {!!typed && suggestions.tags.length > 0 && (
            <View>
              <Text style={styles.section}>Keywords</Text>
              <View style={styles.wrap}>
                {suggestions.tags.map((t) => (
                  <Pill key={t} icon="tag" label={t} tint={p.keyword} onPress={() => commit(`#${t}`)} />
                ))}
              </View>
            </View>
          )}

          {!typed && recent.length > 0 && (
            <View>
              <View style={styles.sectionRow}>
                <Text style={styles.section}>Recent</Text>
                {onClearRecent && (
                  <TouchableOpacity onPress={onClearRecent} hitSlop={10} accessibilityLabel="Clear recent searches">
                    <Text style={styles.link}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.wrap}>
                {recent.map((r) => (
                  <Pill key={r} icon="history" label={r} onPress={() => commit(r)} />
                ))}
              </View>
            </View>
          )}

          {!typed && (
            <View>
              <Text style={styles.section}>Try</Text>
              <View style={styles.wrap}>
                {SEARCH_EXAMPLES.map((ex) => (
                  <Pill key={ex} label={ex} onPress={() => commit(ex)} />
                ))}
              </View>
            </View>
          )}

          <View>
            <Text style={styles.section}>{typed ? 'Add a keyword' : 'Your keywords'}</Text>
            {tags.length === 0 ? (
              <Text style={styles.muted}>Keywords you add to videos show up here.</Text>
            ) : (
              <View style={styles.wrap}>
                {tags.map((t) => (
                  <Pill key={t.id} icon="tag" label={t.name} tint={t.color ?? p.keyword} onPress={() => add(t.name)} />
                ))}
              </View>
            )}
          </View>
        </ScrollView>

        <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) + 6 }]}>
          <TouchableOpacity style={styles.round} onPress={onFilters} accessibilityLabel="Filters">
            <Icon name="options" size={18} color={p.text} />
          </TouchableOpacity>
          {!!typed && (
            <TouchableOpacity style={styles.round} onPress={onSaveSmart} accessibilityLabel="Save as Smart Filter">
              <Icon name="wand" size={18} color={p.text} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.show, !typed && styles.showOff]} onPress={onClose} accessibilityRole="button">
            <Text style={[styles.showText, !typed && styles.showTextOff]} numberOfLines={1}>
              {!typed ? 'Show all videos' : matches === null ? 'Show results' : matches === 0 ? 'No videos match' : `Show ${matches} ${matches === 1 ? 'video' : 'videos'}`}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Pill({ label, icon, tint, onPress }: { label: string; icon?: IconName; tint?: string; onPress: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <TouchableOpacity style={styles.pill} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {icon && <Icon name={icon} size={12} color={tint ?? p.textMuted} />}
      <Text style={styles.pillText} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    page: { flex: 1, backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    title: { flex: 1, color: p.text, fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
    circle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: p.circle },
    box: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.elevated, borderRadius: 14, marginHorizontal: 16, paddingHorizontal: 12 },
    input: { flex: 1, color: p.text, fontSize: 17, paddingVertical: 12 },
    scroll: { flex: 1 },
    body: { paddingHorizontal: 16, paddingBottom: 24, gap: 4 },

    understood: { gap: 8, paddingTop: 16 },
    understoodLabel: { color: p.textSecondary, fontSize: 13, fontWeight: '700' },
    filterChip: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
    textChip: { backgroundColor: p.elevated },
    filterChipText: { color: '#fff', fontSize: 14, fontWeight: '700' },

    sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    section: { color: p.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.3, paddingTop: 22, paddingBottom: 10 },
    link: { color: p.link, fontSize: 14, fontWeight: '600' },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
    pillText: { color: p.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
    muted: { color: p.textMuted, fontSize: 14 },

    list: { backgroundColor: p.elevated, borderRadius: 16, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, paddingRight: 14 },
    rowLine: { borderTopWidth: 0.5, borderTopColor: p.separator },
    thumb: { width: 88, height: 54, borderRadius: 8, overflow: 'hidden', backgroundColor: p.tile },
    thumbImg: { width: 88, height: 54 },
    thumbTime: { position: 'absolute', right: 4, bottom: 3, color: '#fff', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 3 },
    rowText: { flex: 1, gap: 3 },
    rowTitle: { color: p.text, fontSize: 15, fontWeight: '600' },
    rowSub: { color: p.textSecondary, fontSize: 12.5 },
    rate: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    rateText: { color: p.textSoft, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },

    bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 10, backgroundColor: p.bg, borderTopWidth: 0.5, borderTopColor: p.separator },
    round: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: p.circle },
    show: { flex: 1, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: p.text, paddingHorizontal: 14 },
    showOff: { backgroundColor: p.elevated },
    showText: { color: p.bg, fontSize: 16, fontWeight: '800' },
    showTextOff: { color: p.text },
  });
