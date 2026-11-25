/** What's new: the changes of the last update (or all of them, from Settings). */

import { Text, TouchableOpacity, View } from 'react-native';

import type { Release } from '../whatsNew';
import { SheetFrame } from './sheets';
import { raised, sheet, usePalette, useStyles, type Palette } from './theme';

const fmtDay = (id: string) => {
  const d = new Date(`${id}T12:00:00`);
  return Number.isNaN(d.getTime()) ? id : d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
};

export default function WhatsNewSheet({ releases, onClose }: { releases: Release[]; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <SheetFrame page title="What's new" onClose={onClose}>
      <View style={styles.body}>
        {releases.map((r) => (
          <View key={r.id} style={styles.release}>
            <Text style={styles.day}>{fmtDay(r.id)}</Text>
            <Text style={styles.title}>{r.title}</Text>
            <View style={[styles.card, { backgroundColor: raised(p) }]}>
              {r.items.map((item, i) => (
                <View key={i} style={[styles.item, i > 0 && styles.line]}>
                  <View style={[styles.dot, { backgroundColor: p.accent }]} />
                  <Text style={styles.itemText}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
        <TouchableOpacity style={styles.done} onPress={onClose} accessibilityRole="button">
          <Text style={styles.doneText}>Got it</Text>
        </TouchableOpacity>
      </View>
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    body: { gap: 28 },
    release: { gap: 6 },
    day: { color: p.textSecondary, fontSize: 14, fontWeight: '600' },
    title: { color: p.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.3, marginBottom: 6 },
    card: { borderRadius: 18, overflow: 'hidden' },
    item: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
    line: { borderTopWidth: 0.5, borderTopColor: p.separator },
    dot: { width: 7, height: 7, borderRadius: 4, marginTop: 8 },
    itemText: { flex: 1, color: p.text, fontSize: 15, lineHeight: 21 },
    done: { height: 54, borderRadius: 27, backgroundColor: p.text, alignItems: 'center', justifyContent: 'center' },
    doneText: { color: p.bg, fontSize: 17, fontWeight: '800' },
  });
