/**
 * Filter · Sort · Display for the manga library, as one sheet with three
 * tabs (the way Tachimanga does it). Filter: unread, downloaded, finished,
 * and which sources. Sort: tap a way to sort, tap it again to turn it round.
 * Display: grid or list, covers per row, the badges on the covers, and the
 * Continue reading row. Every change shows at once and is kept.
 */

import { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DEFAULT_LIBRARY_VIEW, type LibraryView, type MangaSort } from '../../manga/mangaLogic';
import { tick } from '../haptics';
import Icon from '../Icon';
import { Modal } from '../screen';
import { sheet, usePalette, useStyles, type Palette } from '../theme';

type Tab = 'filter' | 'sort' | 'display';

const SORTS: { key: MangaSort; label: string }[] = [
  { key: 'title', label: 'Alphabetical' },
  { key: 'chapters', label: 'Total chapters' },
  { key: 'recentRead', label: 'Last read' },
  { key: 'unread', label: 'Unread' },
  { key: 'latest', label: 'Latest chapter' },
  { key: 'recentAdded', label: 'Date added' },
  { key: 'rating', label: 'Your rating' },
];

export default function LibrarySheet({ view, sources, onChange, onClose }: { view: LibraryView; sources: string[]; onChange: (v: LibraryView) => void; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('filter');
  const set = (patch: Partial<LibraryView>) => {
    tick();
    onChange({ ...view, ...patch });
  };
  const setFilter = (patch: Partial<LibraryView['filter']>) => set({ filter: { ...view.filter, ...patch } });
  const setBadge = (patch: Partial<LibraryView['badges']>) => set({ badges: { ...view.badges, ...patch } });

  const Check = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
      <View style={[styles.box, on && styles.boxOn]}>{on && <Icon name="check" size={14} color={p.bg} weight="bold" />}</View>
      <Text style={styles.rowText}>{label}</Text>
    </TouchableOpacity>
  );
  const Radio = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.row} onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }}>
      <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
      <Text style={styles.rowText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.card, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.grabber} />
          <View style={styles.tabs}>
            {(['filter', 'sort', 'display'] as Tab[]).map((t) => (
              <TouchableOpacity key={t} style={styles.tab} onPress={() => setTab(t)}>
                <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === 'filter' ? 'Filter' : t === 'sort' ? 'Sort' : 'Display'}</Text>
                <View style={[styles.underline, tab === t && styles.underlineOn]} />
              </TouchableOpacity>
            ))}
          </View>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.body} bounces={false}>
            {tab === 'filter' && (
              <>
                <Check on={view.filter.unread} label="Unread" onPress={() => setFilter({ unread: !view.filter.unread })} />
                <Check on={view.filter.completed} label="Completed" onPress={() => setFilter({ completed: !view.filter.completed })} />
                <Check on={view.filter.downloaded} label="Downloaded" onPress={() => setFilter({ downloaded: !view.filter.downloaded })} />
                {sources.length > 1 && (
                  <>
                    <View style={styles.rule} />
                    <View style={styles.headRow}>
                      <Icon name="options" size={18} color={p.textSecondary} />
                      <Text style={styles.head}>Sources</Text>
                      {view.filter.sources.length > 0 && (
                        <TouchableOpacity onPress={() => setFilter({ sources: [] })} hitSlop={8}>
                          <Text style={styles.link}>All</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {sources.map((s) => {
                      const on = view.filter.sources.includes(s);
                      return <Check key={s} on={on} label={s} onPress={() => setFilter({ sources: on ? view.filter.sources.filter((x) => x !== s) : [...view.filter.sources, s] })} />;
                    })}
                  </>
                )}
              </>
            )}

            {tab === 'sort' &&
              SORTS.map((o) => {
                const on = view.sort === o.key;
                return (
                  <TouchableOpacity key={o.key} style={styles.row} onPress={() => (on ? set({ reverse: !view.reverse }) : set({ sort: o.key, reverse: false }))} accessibilityLabel={`Sort by ${o.label}${on ? ', tap to turn round' : ''}`}>
                    <View style={styles.arrow}>{on && <Icon name={view.reverse ? 'arrowUp' : 'arrowDown'} size={20} color={p.accent} weight="bold" />}</View>
                    <Text style={[styles.rowText, on && { color: p.accent }]}>{o.label}</Text>
                  </TouchableOpacity>
                );
              })}

            {tab === 'display' && (
              <>
                <Text style={styles.head}>Display mode</Text>
                <Radio on={view.layout === 'grid'} label="Grid" onPress={() => set({ layout: 'grid' })} />
                <Radio on={view.layout === 'list'} label="List" onPress={() => set({ layout: 'list' })} />
                {view.layout === 'grid' && (
                  <View style={[styles.row, { justifyContent: 'space-between' }]}>
                    <Text style={styles.head}>Items per row</Text>
                    <View style={styles.stepper}>
                      <TouchableOpacity style={[styles.step, view.perRow <= 1 && styles.off]} disabled={view.perRow <= 1} onPress={() => set({ perRow: view.perRow - 1 })} accessibilityLabel="Fewer per row">
                        <Icon name="minus" size={18} color={p.bg} weight="bold" />
                      </TouchableOpacity>
                      <Text style={styles.stepValue}>{view.perRow}</Text>
                      <TouchableOpacity style={[styles.step, view.perRow >= 5 && styles.off]} disabled={view.perRow >= 5} onPress={() => set({ perRow: view.perRow + 1 })} accessibilityLabel="More per row">
                        <Icon name="plus" size={18} color={p.bg} weight="bold" />
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
                <Text style={[styles.head, { marginTop: 10 }]}>Badges</Text>
                <Check on={view.badges.unread} label="Unread chapters" onPress={() => setBadge({ unread: !view.badges.unread })} />
                <Check on={view.badges.downloaded} label="Downloaded chapters" onPress={() => setBadge({ downloaded: !view.badges.downloaded })} />
                <Check on={view.badges.rating} label="Your rating" onPress={() => setBadge({ rating: !view.badges.rating })} />
                <Text style={[styles.head, { marginTop: 10 }]}>Library</Text>
                <Check on={view.continueRow} label="Continue reading row" onPress={() => set({ continueRow: !view.continueRow })} />
                <TouchableOpacity style={styles.reset} onPress={() => set({ ...DEFAULT_LIBRARY_VIEW, sort: view.sort, reverse: view.reverse, filter: view.filter })}>
                  <Text style={styles.link}>Back to the usual look</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    backdrop: { flex: 1, backgroundColor: p.backdrop },
    card: { backgroundColor: p.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '75%' },
    grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: p.separator, marginTop: 8 },
    tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: p.separator, marginTop: 6 },
    tab: { flex: 1, alignItems: 'center', paddingTop: 12 },
    tabText: { color: p.text, fontSize: 17, fontWeight: '800', paddingBottom: 12 },
    tabTextOn: { color: p.accent },
    underline: { height: 3, width: 44, borderTopLeftRadius: 3, borderTopRightRadius: 3, backgroundColor: 'transparent' },
    underlineOn: { backgroundColor: p.accent },
    body: { paddingHorizontal: 22, paddingVertical: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingVertical: 14 },
    rowText: { color: p.text, fontSize: 18, fontWeight: '700' },
    box: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    boxOn: { backgroundColor: p.accent },
    radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    radioOn: { borderWidth: 2.5 },
    radioDot: { width: 13, height: 13, borderRadius: 7, backgroundColor: p.accent },
    arrow: { width: 26, alignItems: 'center' },
    rule: { height: 1, backgroundColor: p.separator, marginVertical: 8, marginHorizontal: -22 },
    headRow: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingVertical: 10 },
    head: { color: p.text, fontSize: 16, fontWeight: '800', flex: 1 },
    link: { color: p.accent, fontSize: 15, fontWeight: '700' },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    step: { width: 34, height: 34, borderRadius: 17, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    stepValue: { color: p.text, fontSize: 17, fontWeight: '800', minWidth: 14, textAlign: 'center' },
    off: { opacity: 0.35 },
    reset: { paddingVertical: 16 },
  });
