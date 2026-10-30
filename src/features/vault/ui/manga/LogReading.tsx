/**
 * "Log reading": time you read a title somewhere else (another app, on paper),
 * so it counts in the Dashboard, Wrapped and Memories like reading here.
 * Optionally marks the next chapters read too.
 * Presentational only (see the rule in ../types.ts).
 */

import { useState } from 'react';
import { Text, TextInput } from 'react-native';

import { loggedRead, nextUnread, sortChapters } from '../../manga/mangaLogic';
import { success } from '../haptics';
import { Chip, Section, SheetFrame, Wrap } from '../sheets';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { MangaActions, MangaUiSeries } from './mangaTypes';

const MINUTES = [10, 15, 20, 30, 45, 60, 90, 120];
const DAYS: { key: number; label: string }[] = [
  { key: 0, label: 'Today' },
  { key: 1, label: 'Yesterday' },
  { key: 2, label: '2 days ago' },
  { key: 3, label: '3 days ago' },
  { key: 7, label: 'A week ago' },
];
const CHAPTERS = [0, 1, 2, 3, 5, 10];

export default function LogReadingSheet({
  series,
  actions,
  onDone,
  onClose,
}: {
  series: MangaUiSeries;
  actions: Pick<MangaActions, 'addRead' | 'setRead'>;
  /** A line for the screen, e.g. "Logged 30 min". */
  onDone: (note: string) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [minutes, setMinutes] = useState(30);
  const [typed, setTyped] = useState('');
  const [daysAgo, setDaysAgo] = useState(0);
  const [chapters, setChapters] = useState(0);
  const [saving, setSaving] = useState(false);
  const custom = Number(typed.replace(',', '.'));
  const total = typed.trim() && Number.isFinite(custom) && custom > 0 ? Math.min(24 * 60, Math.round(custom)) : minutes;
  const unread = series.chapters.filter((c) => !c.readAt).length;

  async function save() {
    setSaving(true);
    try {
      await actions.addRead(loggedRead(series.id, total, daysAgo, Date.now()));
      const ids = nextUnread(sortChapters(series.chapters), chapters);
      if (ids.length) await actions.setRead(ids, true);
      success();
      onDone(`Logged ${total} min${ids.length ? ` · ${ids.length} ${ids.length === 1 ? 'chapter' : 'chapters'} marked read` : ''}`);
      onClose();
    } catch (e) {
      onDone(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
      setSaving(false);
    }
  }

  return (
    <SheetFrame title="Log reading" onClose={onClose} action={{ label: 'Save', onPress: () => void save(), disabled: saving || total <= 0 }}>
      <Text style={styles.hint}>Time you read {series.title} somewhere else. It counts in your Dashboard, Wrapped and Memories.</Text>
      <Section label="How long">
        <Wrap>
          {MINUTES.map((m) => (
            <Chip
              key={m}
              label={m >= 60 ? `${m / 60} h` : `${m} min`}
              on={!typed.trim() && minutes === m}
              onPress={() => {
                setTyped('');
                setMinutes(m);
              }}
            />
          ))}
        </Wrap>
        <TextInput
          style={styles.input}
          value={typed}
          onChangeText={setTyped}
          placeholder="Other: minutes"
          placeholderTextColor={p.textMuted}
          keyboardType="number-pad"
          returnKeyType="done"
        />
      </Section>
      <Section label="When">
        <Wrap>
          {DAYS.map((d) => (
            <Chip key={d.key} label={d.label} on={daysAgo === d.key} onPress={() => setDaysAgo(d.key)} />
          ))}
        </Wrap>
      </Section>
      {unread > 0 && (
        <Section label="Also mark chapters read">
          <Wrap>
            {CHAPTERS.filter((n) => n <= unread).map((n) => (
              <Chip key={n} label={n === 0 ? 'None' : `Next ${n}`} on={chapters === n} onPress={() => setChapters(n)} />
            ))}
          </Wrap>
        </Section>
      )}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    hint: { color: p.textSecondary, fontSize: 13 },
    input: { backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: p.text, fontSize: 16, marginTop: 8 },
  });
