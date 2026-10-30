/**
 * Edit the tabs above the manga library: move a tab up or down, hide or show
 * it, rename it (a category is renamed on every title in it), delete a
 * category (it comes off its titles; the titles stay) and make a new one.
 * Select picks many categories at once (all, or the small ones with one
 * title or none) to hide or delete together.
 * Library stays first. Every change shows at once and is kept.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { moveTab, type TabPrefs } from '../../manga/mangaLogic';
import { confirmAction } from '../confirm';
import { tick } from '../haptics';
import Icon from '../Icon';
import { Modal } from '../screen';
import { sheet, usePalette, useStyles, type Palette } from '../theme';

export type EditTab = { key: string; label: string; count: number };

export default function TabsSheet({
  tabs,
  prefs,
  onPrefs,
  onRename,
  onDelete,
  onAdd,
  onClose,
}: {
  /** Every tab in its current order, hidden ones too. */
  tabs: EditTab[];
  prefs: TabPrefs;
  onPrefs: (p: TabPrefs) => void;
  onRename: (key: string, name: string) => void;
  /** Deletes these categories (keys start with '#'). */
  onDelete: (keys: string[]) => void;
  onAdd: (name: string) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const keys = tabs.map((t) => t.key);
  const cats = tabs.filter((t) => t.key.startsWith('#'));
  // Picking many categories to hide or delete together.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const pickedList = cats.filter((t) => picked.has(t.key));
  const togglePick = (key: string) => {
    tick();
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  };
  const stopPicking = () => {
    setPicking(false);
    setPicked(new Set());
  };
  const n = pickedList.length;
  const word = n === 1 ? 'category' : 'categories';

  const startEdit = (t: EditTab) => {
    setEditing(t.key);
    setText(t.key === '+new' ? '' : t.label);
  };
  const save = () => {
    const name = text.trim();
    const key = editing;
    setEditing(null);
    setText('');
    if (!key || !name) return;
    tick();
    if (key === '+new') onAdd(name);
    else onRename(key, name);
  };
  const move = (key: string, dir: -1 | 1) => {
    tick();
    onPrefs({ ...prefs, order: moveTab(keys, key, dir) });
  };
  const toggleHidden = (key: string) => {
    tick();
    const hidden = prefs.hidden.includes(key) ? prefs.hidden.filter((k) => k !== key) : [...prefs.hidden, key];
    onPrefs({ ...prefs, hidden });
  };

  const input = (
    <View style={styles.editRow}>
      <TextInput value={text} onChangeText={setText} style={styles.input} autoFocus returnKeyType="done" onSubmitEditing={save} placeholder="Name" placeholderTextColor={p.textMuted} />
      <TouchableOpacity style={[styles.save, !text.trim() && { opacity: 0.4 }]} disabled={!text.trim()} onPress={save}>
        <Text style={styles.saveText}>Save</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => setEditing(null)} hitSlop={8} accessibilityLabel="Cancel">
        <Icon name="close" size={18} color={p.textSecondary} />
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} accessibilityLabel="Close" />
          <View style={[styles.card, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <Text style={styles.title}>{picking ? `${n} selected` : 'Edit tabs'}</Text>
              {cats.length > 0 && (
                <TouchableOpacity style={styles.ghost} onPress={() => (picking ? stopPicking() : setPicking(true))}>
                  <Text style={styles.ghostText}>{picking ? 'Cancel' : 'Select'}</Text>
                </TouchableOpacity>
              )}
              {!picking && (
                <TouchableOpacity style={styles.done} onPress={onClose}>
                  <Text style={styles.doneText}>Done</Text>
                </TouchableOpacity>
              )}
            </View>
            {picking ? (
              <View style={styles.quick}>
                <TouchableOpacity style={styles.chip} onPress={() => setPicked(n === cats.length ? new Set() : new Set(cats.map((t) => t.key)))}>
                  <Text style={styles.chipText}>{n === cats.length ? 'Unselect all' : `Select all ${cats.length}`}</Text>
                </TouchableOpacity>
                {cats.some((t) => t.count <= 1) && (
                  <TouchableOpacity style={styles.chip} onPress={() => setPicked(new Set(cats.filter((t) => t.count <= 1).map((t) => t.key)))}>
                    <Text style={styles.chipText}>Small ones (0-1 title)</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : (
              <Text style={styles.sub}>Arrows move a tab, the eye hides it, tap a name to rename it. Select deletes many categories at once.</Text>
            )}
            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {picking &&
                cats.map((t) => {
                  const on = picked.has(t.key);
                  return (
                    <TouchableOpacity key={t.key} style={styles.row} onPress={() => togglePick(t.key)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                      <View style={styles.iconBtn}>
                        <View style={[styles.box, on && styles.boxOn]}>{on && <Icon name="check" size={14} color={p.bg} weight="bold" />}</View>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.label} numberOfLines={1}>
                          {t.label}
                        </Text>
                        <Text style={styles.count}>
                          {t.count} {t.count === 1 ? 'title' : 'titles'}
                          {prefs.hidden.includes(t.key) ? ' · hidden' : ''}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              {!picking && tabs.map((t, i) => {
                const hidden = prefs.hidden.includes(t.key);
                const fixed = t.key === 'all';
                const keyword = t.key.startsWith('#');
                if (editing === t.key) return <View key={t.key}>{input}</View>;
                return (
                  <View key={t.key} style={styles.row}>
                    <TouchableOpacity disabled={fixed} onPress={() => toggleHidden(t.key)} hitSlop={6} accessibilityLabel={hidden ? `Show ${t.label}` : `Hide ${t.label}`} style={[styles.iconBtn, fixed && { opacity: 0.3 }]}>
                      <Icon name={hidden ? 'eyeOff' : 'eye'} size={20} color={hidden ? p.textMuted : p.accent} />
                    </TouchableOpacity>
                    <TouchableOpacity style={{ flex: 1 }} onPress={() => startEdit(t)} accessibilityLabel={`Rename ${t.label}`}>
                      <Text style={[styles.label, hidden && { color: p.textMuted }]} numberOfLines={1}>
                        {t.label}
                      </Text>
                      <Text style={styles.count}>
                        {keyword ? 'Category' : fixed ? 'Everything' : 'Built in'} · {t.count} {t.count === 1 ? 'title' : 'titles'}
                      </Text>
                    </TouchableOpacity>
                    {keyword && (
                      <TouchableOpacity
                        hitSlop={6}
                        style={styles.iconBtn}
                        accessibilityLabel={`Delete ${t.label}`}
                        onPress={() =>
                          confirmAction(
                            `Delete the category ${t.label}?`,
                            t.count ? `It comes off its ${t.count} ${t.count === 1 ? 'title' : 'titles'}; the titles stay in your library.` : 'No title is in it.',
                            () => onDelete([t.key]),
                            { label: 'Delete', destructive: true }
                          )
                        }>
                        <Icon name="trash" size={18} color={p.danger} />
                      </TouchableOpacity>
                    )}
                    {!fixed && (
                      <>
                        <TouchableOpacity hitSlop={4} disabled={i <= 1} onPress={() => move(t.key, -1)} style={[styles.arrow, i <= 1 && { opacity: 0.25 }]} accessibilityLabel={`Move ${t.label} up`}>
                          <Icon name="chevronUp" size={18} color={p.text} weight="bold" />
                        </TouchableOpacity>
                        <TouchableOpacity hitSlop={4} disabled={i >= tabs.length - 1} onPress={() => move(t.key, 1)} style={[styles.arrow, i >= tabs.length - 1 && { opacity: 0.25 }]} accessibilityLabel={`Move ${t.label} down`}>
                          <Icon name="chevronDown" size={18} color={p.text} weight="bold" />
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                );
              })}
              {picking ? null : editing === '+new' ? (
                input
              ) : (
                <TouchableOpacity style={styles.row} onPress={() => startEdit({ key: '+new', label: '', count: 0 })}>
                  <View style={styles.iconBtn}>
                    <Icon name="plus" size={20} color={p.accent} weight="bold" />
                  </View>
                  <Text style={[styles.label, { color: p.accent }]}>New category</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
            {picking && (
              <View style={styles.bar}>
                <TouchableOpacity
                  style={[styles.barBtn, !n && { opacity: 0.4 }]}
                  disabled={!n}
                  onPress={() => {
                    tick();
                    onPrefs({ ...prefs, hidden: [...new Set([...prefs.hidden, ...pickedList.map((t) => t.key)])] });
                    stopPicking();
                  }}>
                  <Icon name="eyeOff" size={18} color={p.text} />
                  <Text style={styles.barText}>Hide {n || ''}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.barBtn, styles.barDanger, !n && { opacity: 0.4 }]}
                  disabled={!n}
                  onPress={() => {
                    const titles = pickedList.reduce((a, t) => a + t.count, 0);
                    confirmAction(
                      `Delete ${n} ${word}?`,
                      titles ? 'They come off the titles in them; the titles stay in your library.' : 'No title is in them.',
                      () => {
                        onDelete(pickedList.map((t) => t.key));
                        stopPicking();
                      },
                      { label: 'Delete', destructive: true }
                    );
                  }}>
                  <Icon name="trash" size={18} color="#fff" />
                  <Text style={[styles.barText, { color: '#fff' }]}>Delete {n || ''}</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    backdrop: { flex: 1, backgroundColor: p.backdrop },
    card: { backgroundColor: p.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '88%' },
    grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: p.separator, marginTop: 8 },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingTop: 12, gap: 12 },
    title: { flex: 1, color: p.text, fontSize: 22, fontWeight: '900' },
    done: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
    doneText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    sub: { color: p.textSecondary, fontSize: 13, paddingHorizontal: 22, paddingTop: 6, paddingBottom: 4 },
    body: { paddingHorizontal: 16, paddingVertical: 6 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: p.separator },
    iconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
    label: { color: p.text, fontSize: 17, fontWeight: '700' },
    count: { color: p.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 1 },
    arrow: { width: 36, height: 36, borderRadius: 18, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    editRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
    input: { flex: 1, height: 42, borderRadius: 12, backgroundColor: p.card, paddingHorizontal: 12, color: p.text, fontSize: 16 },
    save: { backgroundColor: p.accent, borderRadius: 12, paddingHorizontal: 14, height: 42, justifyContent: 'center' },
    saveText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    ghost: { paddingHorizontal: 12, paddingVertical: 8 },
    ghostText: { color: p.accent, fontSize: 16, fontWeight: '800' },
    quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 22, paddingTop: 8, paddingBottom: 4 },
    chip: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    chipText: { color: p.text, fontSize: 14, fontWeight: '700' },
    box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    boxOn: { backgroundColor: p.accent },
    bar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10 },
    barBtn: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 14, backgroundColor: p.card },
    barDanger: { backgroundColor: p.danger },
    barText: { color: p.text, fontSize: 16, fontWeight: '800' },
  });
