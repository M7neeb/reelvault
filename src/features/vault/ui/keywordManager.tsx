/**
 * The keyword manager: every keyword with how many videos have it, grouped
 * (a keyword named "Travel/Japan" sits under Travel), searchable and sortable.
 * Tap one to rename it, give it a colour, put it under another keyword, merge
 * it into another, or delete it. Select several to merge them in one go, and
 * clear out the keywords no video uses. Renaming onto a keyword that exists
 * merges the two; smart albums follow the change. Presentational only.
 */

import { useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { keywordTree, leafOf, parentOf, type KwNode } from '../keywordTree';
import { confirmAction } from './confirm';
import { success, tick } from './haptics';
import Icon from './Icon';
import { SheetFrame } from './sheets';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { UiTag, VaultActions } from './types';

export const KEYWORD_COLORS = ['#FF453A', '#FF9F0A', '#FFD60A', '#30D158', '#64D2FF', '#0A84FF', '#BF5AF2', '#FF375F'];

export function KeywordManager({
  tags,
  counts,
  actions,
  onShow,
  onRenamed,
  onClose,
}: {
  tags: UiTag[];
  counts: Record<string, number>;
  actions: VaultActions;
  onShow: (name: string) => void;
  /** A keyword got a new name (or was merged / deleted: null), for things that name keywords (your own memories). */
  onRenamed?: (from: string, to: string | null) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'name' | 'used'>('name');
  const [open, setOpen] = useState<number | null>(null);
  const [mode, setMode] = useState<'rename' | 'merge' | 'parent' | null>(null);
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [merging, setMerging] = useState(false);
  const [note, setNote] = useState('');
  const tree = useMemo(() => keywordTree(tags, counts, query, sort), [tags, counts, query, sort]);
  const unused = tags.filter((t) => !(counts[t.name] > 0)).length;
  const byId = new Map(tags.map((t) => [t.id, t]));
  const run = (label: string, job: Promise<unknown>) => {
    job
      .then(() => {
        success();
        setNote(label);
        setOpen(null);
        setMode(null);
        setPicked([]);
        setMerging(false);
      })
      .catch((e) => setNote(`That did not work: ${String(e)}`));
  };
  const toggle = (id: number) => {
    tick();
    setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  };
  const choose = (list: UiTag[], onPick: (t: UiTag) => void) => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
      {list.map((t) => (
        <TouchableOpacity key={t.id} style={styles.pick} onPress={() => onPick(t)}>
          <Text style={styles.pickText}>#{t.name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const row = (n: KwNode, child: boolean) => {
    const t = n.tag;
    const isOpen = !!t && open === t.id;
    const selecting = picked.length > 0;
    return (
      <View key={n.name} style={[styles.rowWrap, child && styles.child]}>
        <TouchableOpacity
          style={styles.row}
          disabled={!t}
          onPress={() => {
            if (!t) return;
            if (selecting) return toggle(t.id);
            tick();
            setOpen(isOpen ? null : t.id);
            setMode(null);
            setDraft(t.name);
          }}
          onLongPress={() => t && toggle(t.id)}
          accessibilityLabel={`${n.label}, ${n.count} ${n.count === 1 ? 'video' : 'videos'}`}>
          {selecting && t ? (
            <View style={[styles.check, picked.includes(t.id) && { backgroundColor: p.accent, borderColor: p.accent }]}>{picked.includes(t.id) && <Icon name="check" size={12} color="#fff" />}</View>
          ) : (
            <View style={[styles.dot, { backgroundColor: t?.color ?? p.border }]} />
          )}
          <Text style={[styles.name, !t && { color: p.textSecondary }]} numberOfLines={1}>
            {child ? n.label : `#${n.label}`}
          </Text>
          {t?.pinned && <Icon name="pin" size={11} color={p.textMuted} />}
          <Text style={styles.count}>{n.count}</Text>
          {!!t && !selecting && <Icon name={isOpen ? 'down' : 'forward'} size={12} color={p.textMuted} />}
        </TouchableOpacity>
        {isOpen && t && (
          <View style={styles.panel}>
            <View style={styles.colors}>
              {KEYWORD_COLORS.map((c) => (
                <TouchableOpacity key={c} style={[styles.swatch, { backgroundColor: c }, t.color === c && styles.swatchOn]} onPress={() => run('Colour set', actions.setTagColor(t.id, t.color === c ? null : c))} accessibilityLabel={`Colour ${c}`} />
              ))}
            </View>
            {mode === 'rename' || mode === 'parent' ? (
              <View style={{ gap: 8 }}>
                <TextInput
                  style={styles.input}
                  value={draft}
                  onChangeText={setDraft}
                  autoFocus
                  autoCapitalize="none"
                  placeholder={mode === 'parent' ? 'Parent/Name' : 'New name'}
                  placeholderTextColor={p.textMuted}
                  keyboardAppearance={p.scheme}
                  onSubmitEditing={() => draft.trim() && run('Renamed', actions.renameTag(t.id, draft).then(() => onRenamed?.(t.name, draft.trim())))}
                />
                {mode === 'parent' &&
                  choose(
                    tags.filter((x) => x.id !== t.id && !parentOf(x.name)),
                    (x) => setDraft(`${x.name}/${leafOf(t.name)}`)
                  )}
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.primary} disabled={!draft.trim()} onPress={() => run('Renamed', actions.renameTag(t.id, draft).then(() => onRenamed?.(t.name, draft.trim())))}>
                    <Text style={styles.primaryText}>Save</Text>
                  </TouchableOpacity>
                  {mode === 'parent' && parentOf(t.name) && (
                    <TouchableOpacity style={styles.ghost} onPress={() => run('Moved to the top level', actions.renameTag(t.id, leafOf(t.name)).then(() => onRenamed?.(t.name, leafOf(t.name))))}>
                      <Text style={styles.ghostText}>Take out of {parentOf(t.name)}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.hint}>A name that already exists merges the two keywords.</Text>
              </View>
            ) : mode === 'merge' ? (
              <View style={{ gap: 6 }}>
                <Text style={styles.hint}>Merge #{t.name} into:</Text>
                {choose(
                  tags.filter((x) => x.id !== t.id),
                  (x) => run(`Merged into #${x.name}`, actions.mergeTags([t.id], x.id).then(() => onRenamed?.(t.name, x.name)))
                )}
              </View>
            ) : (
              <View style={styles.actions}>
                <TouchableOpacity style={styles.ghost} onPress={() => onShow(t.name)}>
                  <Text style={styles.ghostText}>Show videos</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghost} onPress={() => setMode('rename')}>
                  <Text style={styles.ghostText}>Rename</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.ghost}
                  onPress={() => {
                    setDraft(t.name);
                    setMode('parent');
                  }}>
                  <Text style={styles.ghostText}>Put under…</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghost} onPress={() => setMode('merge')}>
                  <Text style={styles.ghostText}>Merge into…</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghost} onPress={() => run(t.pinned ? 'Unpinned' : 'Pinned to the top', actions.onPinTag(t.id, !t.pinned))}>
                  <Text style={styles.ghostText}>{t.pinned ? 'Unpin' : 'Pin to top'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.ghost}
                  onPress={() =>
                    confirmAction(`Delete #${t.name}?`, `It comes off ${n.count} ${n.count === 1 ? 'video' : 'videos'}. The videos stay.`, () => run(`#${t.name} deleted`, actions.deleteTag(t.id).then(() => onRenamed?.(t.name, null))), { label: 'Delete keyword' })
                  }>
                  <Text style={[styles.ghostText, { color: p.dangerText }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <SheetFrame title="Keywords" onClose={onClose}>
      <Text style={styles.summary}>
        {tags.length} keywords{unused ? ` · ${unused} not on any video` : ''}
      </Text>
      <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder="Find a keyword" placeholderTextColor={p.textMuted} autoCapitalize="none" keyboardAppearance={p.scheme} clearButtonMode="while-editing" />
      <View style={styles.actions}>
        {(['name', 'used'] as const).map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.seg, sort === s && { backgroundColor: p.accent }]}
            onPress={() => {
              tick();
              setSort(s);
            }}>
            <Text style={[styles.segText, sort === s && { color: '#fff' }]}>{s === 'name' ? 'A to Z' : 'Most used'}</Text>
          </TouchableOpacity>
        ))}
        {unused > 0 && (
          <TouchableOpacity
            style={styles.ghost}
            onPress={() =>
              confirmAction(`Remove ${unused} unused ${unused === 1 ? 'keyword' : 'keywords'}?`, 'They are not on any video.', () =>
                actions
                  .deleteUnusedTags()
                  .then((k) => {
                    success();
                    setNote(`${k} removed`);
                  })
                  .catch((e) => setNote(String(e))), { label: 'Remove' }
              )
            }>
            <Text style={styles.ghostText}>Clear unused</Text>
          </TouchableOpacity>
        )}
      </View>
      {picked.length > 0 && (
        <View style={styles.selBar}>
          <Text style={styles.selText}>{picked.length} selected</Text>
          {picked.length > 1 && !merging && (
            <TouchableOpacity style={styles.primary} onPress={() => setMerging(true)}>
              <Text style={styles.primaryText}>Merge…</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.ghost} onPress={() => setPicked([])}>
            <Text style={styles.ghostText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
      {merging && (
        <View style={{ gap: 6 }}>
          <Text style={styles.hint}>Keep which one? The others move into it.</Text>
          {choose(
            picked.map((id) => byId.get(id)).filter((t): t is UiTag => !!t),
            (keep) =>
              run(
                `Merged into #${keep.name}`,
                actions
                  .mergeTags(
                    picked.filter((id) => id !== keep.id),
                    keep.id
                  )
                  .then(() => {
                    for (const id of picked) if (id !== keep.id && byId.get(id)) onRenamed?.(byId.get(id)!.name, keep.name);
                  })
              )
          )}
        </View>
      )}
      {!!note && <Text style={[styles.hint, { color: p.success }]}>{note}</Text>}
      <View style={styles.list}>
        {tree.length === 0 && <Text style={styles.hint}>{tags.length ? 'Nothing matches.' : 'No keywords yet. Add them to videos in the player or with Edit on a selection.'}</Text>}
        {tree.map((n) => (
          <View key={n.name}>
            {row(n, false)}
            {n.children.map((c) => row(c, true))}
          </View>
        ))}
      </View>
      <Text style={styles.hint}>Tap a keyword for its options. Hold to select several and merge them. A keyword named Travel/Japan shows under Travel.</Text>
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    summary: { color: p.textSecondary, fontSize: 13, fontWeight: '600' },
    input: { backgroundColor: p.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: p.text, fontSize: 15 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    seg: { borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, backgroundColor: p.card },
    segText: { color: p.text, fontSize: 13, fontWeight: '700' },
    list: { backgroundColor: p.card, borderRadius: 14, overflow: 'hidden' },
    rowWrap: { borderTopWidth: 1, borderTopColor: p.separator },
    child: { paddingLeft: 22 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
    dot: { width: 12, height: 12, borderRadius: 6 },
    check: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: p.border, alignItems: 'center', justifyContent: 'center' },
    name: { color: p.text, fontSize: 15, fontWeight: '600', flex: 1 },
    count: { color: p.textSecondary, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
    panel: { paddingHorizontal: 12, paddingBottom: 12, gap: 10 },
    colors: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    swatch: { width: 26, height: 26, borderRadius: 13 },
    swatchOn: { borderWidth: 3, borderColor: p.text },
    primary: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: p.accent },
    primaryText: { color: '#fff', fontSize: 13, fontWeight: '800' },
    ghost: { borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, backgroundColor: p.elevated },
    ghostText: { color: p.link, fontSize: 13, fontWeight: '700' },
    chipRow: { gap: 6 },
    pick: { borderRadius: 999, borderWidth: 1, borderColor: p.accent, paddingHorizontal: 12, paddingVertical: 6 },
    pickText: { color: p.link, fontSize: 13, fontWeight: '700' },
    selBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.card, borderRadius: 12, padding: 8 },
    selText: { color: p.text, fontSize: 14, fontWeight: '800', flex: 1 },
    hint: { color: p.textSecondary, fontSize: 12 },
  });
