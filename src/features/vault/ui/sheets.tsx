/**
 * Bottom sheets used by the vault screen: bulk edit, View Options and the
 * smart filter editor. Presentational only (see the rule in types.ts).
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { matchesRule } from './logic';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import {
  LAYOUTS,
  SORTS,
  STATUSES,
  THEMES,
  THUMB_INFOS,
  THUMB_SIZES,
  type SmartRule,
  type UiStatus,
  type UiTag,
  type VaultItem,
  type ViewOptions,
} from './types';

/* -------------------------------------------------------------------- frame */

function SheetFrame({
  title,
  onClose,
  action,
  children,
}: {
  title: string;
  onClose: () => void;
  /** Optional blue button on the right of the header. */
  action?: { label: string; onPress: () => void; disabled?: boolean };
  children: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />
          <View style={styles.sheet}>
            <View style={styles.header}>
              <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close">
                <Text style={styles.circleIcon}>✕</Text>
              </TouchableOpacity>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {action ? (
                <TouchableOpacity
                  style={[styles.primary, action.disabled && styles.disabled]}
                  disabled={action.disabled}
                  onPress={action.onPress}>
                  <Text style={styles.primaryText}>{action.label}</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.circleGhost} />
              )}
            </View>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

function Chip({
  label,
  on,
  danger,
  onPress,
}: {
  label: string;
  on?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <TouchableOpacity style={[styles.chip, on && styles.chipOn]} onPress={onPress}>
      <Text style={[styles.chipText, on && styles.chipTextOn, danger && styles.chipTextDanger]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/** A row of options where exactly one is chosen. */
function Segment<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.segment}>
      {options.map((o) => (
        <TouchableOpacity
          key={o.key}
          style={[styles.segmentItem, value === o.key && styles.segmentOn]}
          onPress={() => onChange(o.key)}>
          <Text style={[styles.segmentText, value === o.key && styles.chipTextOn]} numberOfLines={1}>
            {o.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: p.switchOff, true: p.accent }}
        thumbColor="#fff"
      />
    </View>
  );
}

/* ---------------------------------------------------------------- bulk edit */

export function BulkEditSheet({
  count,
  tags,
  privateAction,
  onRate,
  onAddTag,
  onStatus,
  onPrivate,
  onClose,
}: {
  count: number;
  tags: UiTag[];
  /** 'add' outside the Private album, 'remove' inside it. */
  privateAction: 'add' | 'remove';
  onRate: (rating: number) => Promise<void>;
  onAddTag: (name: string) => Promise<void>;
  onStatus: (status: UiStatus | null) => Promise<void>;
  onPrivate: () => Promise<void>;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [draft, setDraft] = useState('');
  const [done, setDone] = useState('');

  async function run(label: string, job: Promise<void>) {
    try {
      await job;
      setDone(label);
    } catch (e) {
      setDone('That did not work - check the dev log');
      console.log(`[BULK] failed: ${String(e)}`);
    }
  }

  function addTag(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setDraft('');
    void run(`Added #${trimmed}`, onAddTag(trimmed));
  }

  const videos = `${count} video${count === 1 ? '' : 's'}`;

  return (
    <SheetFrame title={`Edit ${videos}`} onClose={onClose} action={{ label: 'Done', onPress: onClose }}>
      {!!done && <Text style={styles.done}>{done}</Text>}

      <Section label="Rating">
        <View style={styles.ratingRow}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <TouchableOpacity
              key={n}
              style={styles.ratingBtn}
              onPress={() => void run(`Rated ${n}/10`, onRate(n))}>
              <Text style={styles.ratingText}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Chip label="Clear rating" onPress={() => void run('Rating cleared', onRate(0))} />
      </Section>

      <Section label="Status">
        <View style={styles.wrap}>
          {STATUSES.map((s) => (
            <Chip key={s.key} label={s.label} onPress={() => void run(s.label, onStatus(s.key))} />
          ))}
          <Chip label="No status" onPress={() => void run('Status cleared', onStatus(null))} />
        </View>
      </Section>

      <Section label="Add a keyword">
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="new keyword…"
            placeholderTextColor={p.textMuted}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => addTag(draft)}
            autoCapitalize="none"
            returnKeyType="done"
            keyboardAppearance={p.scheme}
          />
          <TouchableOpacity style={styles.primary} onPress={() => addTag(draft)}>
            <Text style={styles.primaryText}>Add</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.wrap}>
          {tags.map((t) => (
            <Chip key={t.id} label={`# ${t.name}`} onPress={() => addTag(t.name)} />
          ))}
        </View>
      </Section>

      <Section label="Private">
        <Chip
          label={privateAction === 'add' ? 'Move to Private' : 'Remove from Private'}
          onPress={() => void run(privateAction === 'add' ? 'Moved to Private' : 'Removed from Private', onPrivate())}
        />
        <Text style={styles.hint}>
          {privateAction === 'add'
            ? 'Private videos disappear from every other view and only show after Face ID.'
            : 'They go back to the normal library.'}
        </Text>
      </Section>
    </SheetFrame>
  );
}

/* ------------------------------------------------------------- view options */

export function ViewOptionsSheet({
  options,
  onChange,
  onClose,
}: {
  options: ViewOptions;
  onChange: (next: ViewOptions) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<ViewOptions>) => onChange({ ...options, ...patch });
  const styles = useStyles(makeStyles);

  return (
    <SheetFrame title="View Options" onClose={onClose} action={{ label: 'Done', onPress: onClose }}>
      <Section label="Layout style">
        <Segment options={LAYOUTS} value={options.layout} onChange={(layout) => set({ layout })} />
      </Section>

      <Section label="Thumbnail size">
        <View style={styles.wrap}>
          {THUMB_SIZES.map((s) => (
            <Chip key={s.key} label={s.label} on={options.size === s.key} onPress={() => set({ size: s.key })} />
          ))}
        </View>
      </Section>

      <Section label="Sort by">
        <View style={styles.wrap}>
          {SORTS.map((s) => (
            <Chip key={s.key} label={s.label} on={options.sort === s.key} onPress={() => set({ sort: s.key })} />
          ))}
        </View>
      </Section>

      <Section label="Thumbnail info">
        <View style={styles.wrap}>
          {THUMB_INFOS.map((s) => (
            <Chip key={s.key} label={s.label} on={options.info === s.key} onPress={() => set({ info: s.key })} />
          ))}
        </View>
      </Section>

      <Section label="Show on thumbnails">
        <ToggleRow label="Rating" value={options.showRating} onChange={(v) => set({ showRating: v })} />
        <ToggleRow
          label="Keyword mark"
          value={options.showKeywords}
          onChange={(v) => set({ showKeywords: v })}
        />
      </Section>

      <Section label="Appearance">
        <Segment options={THEMES} value={options.theme} onChange={(theme) => set({ theme })} />
      </Section>
    </SheetFrame>
  );
}

/* ------------------------------------------------------- smart filter editor */

const MIN_RATINGS = [5, 6, 7, 8, 9, 10];

export function SmartFilterSheet({
  initial,
  tags,
  items,
  onSave,
  onDelete,
  onClose,
}: {
  /** An existing filter to edit, or a starting rule for a new one. */
  initial: { id?: number; name: string; rule: SmartRule };
  tags: UiTag[];
  /** Live videos, to show how many match while editing. */
  items: VaultItem[];
  onSave: (filter: { id?: number; name: string; rule: SmartRule }) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [name, setName] = useState(initial.name);
  const [rule, setRule] = useState<SmartRule>(initial.rule);

  const matches = useMemo(() => items.filter((v) => matchesRule(v, rule)).length, [items, rule]);
  const set = (patch: Partial<SmartRule>) => setRule((r) => ({ ...r, ...patch }));

  function toggleTag(t: string) {
    const current = rule.tags ?? [];
    const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t];
    set({ tags: next.length ? next : undefined, untagged: undefined });
  }

  function save() {
    onSave({ id: initial.id, name: name.trim(), rule })
      .then(onClose)
      .catch((e) => console.log(`[SMART] save failed: ${String(e)}`));
  }

  return (
    <SheetFrame
      title={initial.id !== undefined ? 'Edit Smart Filter' : 'New Smart Filter'}
      onClose={onClose}
      action={{ label: 'Save', onPress: save, disabled: !name.trim() }}>
      <Text style={styles.done}>
        Matches {matches} video{matches === 1 ? '' : 's'} right now
      </Text>

      <Section label="Name">
        <TextInput
          style={styles.input}
          placeholder="e.g. Best travel clips"
          placeholderTextColor={p.textMuted}
          value={name}
          onChangeText={setName}
          keyboardAppearance={p.scheme}
        />
      </Section>

      <Section label="Rating at least">
        <View style={styles.wrap}>
          <Chip label="Any" on={!rule.minRating} onPress={() => set({ minRating: undefined })} />
          {MIN_RATINGS.map((n) => (
            <Chip
              key={n}
              label={n === 10 ? '10' : `${n}+`}
              on={rule.minRating === n}
              onPress={() => set({ minRating: n })}
            />
          ))}
        </View>
      </Section>

      <Section label="Status">
        <View style={styles.wrap}>
          <Chip label="Any" on={!rule.status} onPress={() => set({ status: undefined })} />
          {STATUSES.map((s) => (
            <Chip key={s.key} label={s.label} on={rule.status === s.key} onPress={() => set({ status: s.key })} />
          ))}
        </View>
      </Section>

      <Section label="Keywords (all of them)">
        <View style={styles.wrap}>
          {tags.length === 0 && <Text style={styles.muted}>No keywords yet.</Text>}
          {tags.map((t) => (
            <Chip
              key={t.id}
              label={`# ${t.name}`}
              on={rule.tags?.includes(t.name)}
              onPress={() => toggleTag(t.name)}
            />
          ))}
        </View>
        <ToggleRow
          label="Only videos without keywords"
          value={!!rule.untagged}
          onChange={(v) => set({ untagged: v || undefined, tags: v ? undefined : rule.tags })}
        />
      </Section>

      <Section label="Name contains">
        <TextInput
          style={styles.input}
          placeholder="part of the filename (optional)"
          placeholderTextColor={p.textMuted}
          value={rule.text ?? ''}
          onChangeText={(t) => set({ text: t || undefined })}
          autoCapitalize="none"
          keyboardAppearance={p.scheme}
        />
      </Section>

      {initial.id !== undefined && onDelete && (
        <TouchableOpacity
          style={styles.deleteRow}
          onPress={() => {
            onDelete(initial.id as number)
              .then(onClose)
              .catch((e) => console.log(`[SMART] delete failed: ${String(e)}`));
          }}>
          <Text style={styles.deleteText}>Delete this Smart Filter</Text>
        </TouchableOpacity>
      )}
    </SheetFrame>
  );
}

/** The starting point for "New Smart Filter": empty, or the search the user just typed. */
export function newSmartFilterDraft(query: string): { name: string; rule: SmartRule } {
  const text = query.trim();
  return { name: text ? `"${text}"` : '', rule: text ? { text } : {} };
}

/* -------------------------------------------------------------------- styles */

const makeStyles = (p: Palette) =>
  sheet({
    kav: { flex: 1 },
    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: p.backdrop },
    backdropTap: { flex: 1 },
    sheet: {
      backgroundColor: p.panel,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingTop: 16,
      maxHeight: '85%',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 8,
      gap: 10,
    },
    title: { flex: 1, color: p.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
    circle: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.circle,
    },
    circleGhost: { width: 34, height: 34 },
    circleIcon: { color: p.icon, fontSize: 15, fontWeight: '700' },
    primary: { backgroundColor: p.accent, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
    primaryText: { color: '#fff', fontWeight: '700' },
    disabled: { opacity: 0.4 },
    body: { paddingHorizontal: 16, paddingBottom: 36, gap: 18 },
    done: { color: p.link, fontSize: 13, fontWeight: '600' },
    hint: { color: p.textSecondary, fontSize: 12 },

    section: { gap: 10 },
    sectionLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

    chip: {
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.card,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    chipOn: { backgroundColor: p.accent, borderColor: p.accent },
    chipText: { color: p.textSoft, fontSize: 13, fontWeight: '600' },
    chipTextOn: { color: '#fff' },
    chipTextDanger: { color: p.dangerText },

    ratingRow: { flexDirection: 'row', justifyContent: 'space-between' },
    ratingBtn: {
      width: 30,
      height: 34,
      borderRadius: 8,
      backgroundColor: p.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ratingText: { color: p.rating, fontWeight: '800', fontSize: 14 },

    inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    input: {
      flex: 1,
      backgroundColor: p.card,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 11,
      color: p.text,
    },

    segment: { flexDirection: 'row', backgroundColor: p.card, borderRadius: 10, padding: 3 },
    segmentItem: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
    segmentOn: { backgroundColor: p.accent },
    segmentText: { color: p.textSoft, fontWeight: '600', fontSize: 13 },

    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 4,
    },
    toggleLabel: { color: p.textSoft, fontSize: 15 },

    muted: { color: p.textMuted, fontStyle: 'italic' },
    deleteRow: { paddingVertical: 12, alignItems: 'center' },
    deleteText: { color: p.dangerText, fontWeight: '700' },
  });
