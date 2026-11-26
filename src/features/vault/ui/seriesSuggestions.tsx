/**
 * Every "belong together?" suggestion in one page: names that differ only by
 * a number. Group makes the series right away (new videos with that name then
 * join it by themselves); Not a series is remembered and never asked again.
 */

import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import type { OvVideo } from '../overview';
import EmptyState from './EmptyState';
import { success, tick } from './haptics';
import { Cover } from './overviewParts';
import { Rows, SheetFrame } from './sheets';
import { sheet, usePalette, useStyles, type Palette } from './theme';

type Suggestion = { name: string; videoIds: string[] };

export function SuggestionsSheet({
  suggestions,
  videos,
  onGroup,
  onEdit,
  onRefuse,
  onClose,
}: {
  suggestions: Suggestion[];
  videos: OvVideo[];
  onGroup: (s: Suggestion) => Promise<void>;
  onEdit: (s: Suggestion) => void;
  onRefuse: (s: Suggestion) => Promise<void>;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const byId = new Map(videos.map((v) => [v.id, v]));
  const run = async (s: Suggestion, job: (s: Suggestion) => Promise<void>, grouped: boolean) => {
    tick();
    setBusy(s.name);
    try {
      await job(s);
      if (grouped) {
        success();
        setDone((n) => n + 1);
      }
    } finally {
      setBusy(null);
    }
  };
  return (
    <SheetFrame page title="Belong together?" onClose={onClose}>
      <Text style={styles.lead}>
        Videos whose names differ only by a number. Group makes them a series, and new videos with that name join it by themselves. Not a series is remembered, for names like "sd 1" and "sd 2" that are different videos.
      </Text>
      {suggestions.length === 0 ? (
        <EmptyState icon="checkCircle" title={done ? `${done} series made` : 'Nothing left to sort'} text="Every name with a number is in a series or marked as not one." tint={p.success} />
      ) : (
        <Rows>
          {suggestions.map((s) => {
            const first = byId.get(s.videoIds[0]);
            return (
              <View key={s.name} style={[styles.row, busy === s.name && styles.busy]}>
                <TouchableOpacity style={styles.top} onPress={() => onEdit(s)} accessibilityRole="button" accessibilityHint="Choose which videos go in it">
                  <Cover source={first?.thumb ?? null} title={s.name} width={44} height={60} radius={7} hideTitle />
                  <View style={styles.text}>
                    <Text style={styles.name} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={styles.sub}>{s.videoIds.length} videos</Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.buttons}>
                  <TouchableOpacity style={[styles.btn, styles.main]} disabled={busy !== null} onPress={() => void run(s, onGroup, true)} accessibilityRole="button">
                    <Text style={styles.mainText}>Group</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btn} disabled={busy !== null} onPress={() => void run(s, onRefuse, false)} accessibilityRole="button">
                    <Text style={styles.btnText}>Not a series</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </Rows>
      )}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    lead: { color: p.textSoft, fontSize: 15, lineHeight: 21, marginBottom: 16 },
    row: { padding: 12, gap: 10 },
    busy: { opacity: 0.5 },
    top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    text: { flex: 1, minWidth: 0, gap: 2 },
    name: { color: p.text, fontSize: 16, fontWeight: '700' },
    sub: { color: p.textSecondary, fontSize: 13 },
    buttons: { flexDirection: 'row', gap: 8 },
    btn: { flex: 1, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: p.scheme === 'light' ? p.card : p.circle },
    main: { backgroundColor: p.text },
    btnText: { color: p.text, fontSize: 14, fontWeight: '700' },
    mainText: { color: p.bg, fontSize: 14, fontWeight: '800' },
  });
