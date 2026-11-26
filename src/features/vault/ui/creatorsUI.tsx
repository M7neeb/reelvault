/**
 * Creators: who made your videos, kept apart from keywords. Your creators
 * (open, rename, remove) and the ones your file names suggest (add with a
 * tap, or "Not this one"). Presentational only (see the rule in types.ts).
 */

import { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { confirmAction } from './confirm';
import { success, tick } from './haptics';
import Icon from './Icon';
import { enterUp } from './motion';
import { Rows, SheetFrame } from './sheets';
import { Spine } from './spine';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

type Suggestion = { name: string; ids: string[] };

export function CreatorsSheet({
  creators,
  items,
  loadSuggestions,
  onOpen,
  onAdd,
  onDismiss,
  onRename,
  onDelete,
  onClose,
}: {
  creators: { name: string; count: number }[];
  /** To show a few covers per suggestion. */
  items: VaultItem[];
  loadSuggestions: () => Promise<Suggestion[]>;
  onOpen: (name: string) => void;
  onAdd: (ids: string[], name: string) => Promise<void>;
  onDismiss: (name: string) => Promise<void>;
  onRename: (from: string, to: string) => Promise<void>;
  onDelete: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const byId = new Map(items.map((v) => [v.id, v]));

  useEffect(() => {
    loadSuggestions()
      .then(setSuggestions)
      .catch(() => setSuggestions([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const drop = (name: string) => setSuggestions((s) => (s ? s.filter((x) => x.name !== name) : s));

  return (
    <SheetFrame page title="Creators" onClose={onClose} action={{ label: 'Done', onPress: onClose }}>
      <Text style={styles.lead}>Who made your videos, kept apart from your keywords. Search with @name.</Text>

      {!!suggestions?.length && (
        <View style={styles.block}>
          <Text style={styles.head}>From your file names</Text>
          {suggestions.map((s, i) => (
            <Animated.View key={s.name} entering={enterUp(i)} exiting={FadeOut.duration(160)} layout={LinearTransition.duration(220)} style={styles.suggest}>
              <View style={styles.thumbs}>
                {s.ids.slice(0, 3).map((id) => {
                  const v = byId.get(id);
                  return v ? <Image key={id} source={v.thumbSource} style={styles.thumb} contentFit="cover" /> : null;
                })}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name} numberOfLines={1}>
                  @{s.name}
                </Text>
                <Text style={styles.sub}>
                  {s.ids.length} video{s.ids.length === 1 ? '' : 's'} look like theirs
                </Text>
              </View>
              <TouchableOpacity
                style={styles.add}
                onPress={() => {
                  success();
                  drop(s.name);
                  void onAdd(s.ids, s.name);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Add ${s.name} to ${s.ids.length} videos`}>
                <Text style={styles.addText}>Add</Text>
              </TouchableOpacity>
              <TouchableOpacity
                hitSlop={8}
                onPress={() => {
                  tick();
                  drop(s.name);
                  void onDismiss(s.name);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${s.name}: not this one`}>
                <Text style={styles.not}>Not this one</Text>
              </TouchableOpacity>
            </Animated.View>
          ))}
        </View>
      )}

      {creators.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="person" size={28} color={p.textSecondary} />
          <Text style={styles.emptyTitle}>No creators yet</Text>
          <Text style={styles.sub}>Select the videos someone made, tap Edit, and type their name under Creator.</Text>
        </View>
      ) : (
        <Rows label={`Your creators · ${creators.length}`}>
          {creators.map((c) =>
            editing === c.name ? (
              <View key={c.name} style={styles.row}>
                <TextInput
                  style={styles.input}
                  value={draft}
                  onChangeText={setDraft}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardAppearance={p.scheme}
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    setEditing(null);
                    if (draft.trim() && draft.trim() !== c.name) void onRename(c.name, draft);
                  }}
                />
                <TouchableOpacity onPress={() => setEditing(null)} hitSlop={8}>
                  <Text style={styles.not}>Cancel</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity key={c.name} style={styles.row} onPress={() => onOpen(c.name)} accessibilityRole="button" accessibilityLabel={`${c.name}, ${c.count} videos`}>
                <View style={styles.spineBox}>
                  <Spine name={c.name} width={4} />
                  <Text style={styles.initial}>{c.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    @{c.name}
                  </Text>
                  <Text style={styles.sub}>
                    {c.count} video{c.count === 1 ? '' : 's'}
                  </Text>
                </View>
                <TouchableOpacity
                  hitSlop={8}
                  onPress={() => {
                    setDraft(c.name);
                    setEditing(c.name);
                  }}
                  accessibilityLabel={`Rename ${c.name}`}>
                  <Icon name="edit" size={16} color={p.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  hitSlop={8}
                  onPress={() =>
                    confirmAction(`Remove @${c.name}?`, `Taken off ${c.count === 1 ? 'its video' : `all ${c.count} videos`}. The videos stay.`, () => void onDelete(c.name), {
                      label: 'Remove',
                      destructive: true,
                    })
                  }
                  accessibilityLabel={`Remove ${c.name}`}>
                  <Icon name="trash" size={16} color={p.dangerText} />
                </TouchableOpacity>
              </TouchableOpacity>
            )
          )}
        </Rows>
      )}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    lead: { color: p.textSoft, fontSize: 15, lineHeight: 21 },
    block: { gap: 8, marginTop: 6 },
    head: { color: p.text, fontSize: 20, fontWeight: '700' },
    suggest: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: p.card },
    thumbs: { flexDirection: 'row' },
    thumb: { width: 30, height: 40, borderRadius: 4, marginRight: -8, borderWidth: 1.5, borderColor: p.card, backgroundColor: p.tile },
    name: { color: p.text, fontSize: 16, fontWeight: '600' },
    sub: { color: p.textSecondary, fontSize: 13 },
    add: { height: 34, paddingHorizontal: 14, borderRadius: 10, backgroundColor: p.text, alignItems: 'center', justifyContent: 'center' },
    addText: { color: p.bg, fontSize: 14, fontWeight: '700' },
    not: { color: p.textSecondary, fontSize: 13, fontWeight: '600' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
    spineBox: { width: 36, height: 48, borderRadius: 4, backgroundColor: p.tile, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
    initial: { color: p.text, fontSize: 22, fontWeight: '700' },
    input: { flex: 1, backgroundColor: p.card, color: p.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16 },
    empty: { alignItems: 'center', gap: 8, paddingVertical: 30 },
    emptyTitle: { color: p.text, fontSize: 20, fontWeight: '700' },
  });
