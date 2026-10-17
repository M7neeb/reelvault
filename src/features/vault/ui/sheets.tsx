/**
 * Bottom sheets used by the vault screen: bulk edit, View Options and the
 * filter editor (Smart Filters and one-off searches with filters).
 * Presentational only (see the rule in types.ts).
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

import { dayKey, matchesRule } from './logic';
import { tick } from './haptics';
import Icon from './Icon';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import {
  GROUPINGS,
  LAYOUTS,
  SORTS,
  STATUSES,
  THEMES,
  THUMB_INFOS,
  THUMB_SIZES,
  type Orientation,
  type SmartRule,
  type UiAlbum,
  type UiFlag,
  type UiStatus,
  type UiTag,
  type VaultItem,
  type ViewOptions,
} from './types';

/* -------------------------------------------------------------------- frame */

export function SheetFrame({
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
  const p = usePalette();
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.kav} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={styles.backdropTap} activeOpacity={1} onPress={onClose} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close">
                <Icon name="close" size={15} color={p.icon} weight="bold" />
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

export function Section({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

export function Chip({
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
    <TouchableOpacity
      style={[styles.chip, on && styles.chipOn]}
      onPress={() => {
        tick();
        onPress();
      }}>
      <Text style={[styles.chipText, on && styles.chipTextOn, danger && styles.chipTextDanger]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Wrap({ children }: { children: ReactNode }) {
  const styles = useStyles(makeStyles);
  return <View style={styles.wrap}>{children}</View>;
}

/** A row of options where exactly one is chosen. */
export function Segment<K extends string>({
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

export function ToggleRow({
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
      <Switch value={value} onValueChange={onChange} trackColor={{ false: p.switchOff, true: p.accent }} thumbColor="#fff" />
    </View>
  );
}

/** A small number box; empty means "no limit". */
function NumberBox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [text, setText] = useState(value === undefined ? '' : String(value));
  return (
    <View style={styles.numberWrap}>
      <TextInput
        style={styles.number}
        value={text}
        placeholder="any"
        placeholderTextColor={p.textMuted}
        keyboardType="decimal-pad"
        keyboardAppearance={p.scheme}
        onChangeText={(t) => {
          const clean = t.replace(/[^0-9.]/g, '');
          setText(clean);
          const n = Number(clean);
          onChange(clean === '' || !Number.isFinite(n) ? undefined : n);
        }}
      />
      <Text style={styles.numberLabel}>{label}</Text>
    </View>
  );
}

/** `YYYY-MM-DD` box for date limits. */
function DayBox({
  label,
  value,
  endOfDay,
  onChange,
}: {
  label: string;
  value: number | undefined;
  /** The "to" box means the end of that day. */
  endOfDay?: boolean;
  onChange: (v: number | undefined) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [text, setText] = useState(value === undefined ? '' : dayKey(value));
  return (
    <View style={styles.numberWrap}>
      <TextInput
        style={[styles.number, styles.dayBox]}
        value={text}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={p.textMuted}
        keyboardType="numbers-and-punctuation"
        keyboardAppearance={p.scheme}
        onChangeText={(t) => {
          setText(t);
          const m = t.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
          if (!m) return onChange(undefined);
          const d = endOfDay
            ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999)
            : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
          onChange(Number.isFinite(d.getTime()) ? d.getTime() : undefined);
        }}
      />
      <Text style={styles.numberLabel}>{label}</Text>
    </View>
  );
}

/* ---------------------------------------------------------------- bulk edit */

export function BulkEditSheet({
  count,
  tags,
  albums,
  privateAction,
  onRate,
  onFlag,
  onAddTag,
  onStatus,
  onAddToAlbums,
  onNewAlbum,
  onTray,
  onText,
  onDate,
  onPrivate,
  onMakeSmaller,
  onClose,
}: {
  count: number;
  tags: UiTag[];
  /** Albums the selection can go into (public ones, or private ones inside Private). */
  albums: UiAlbum[];
  /** 'add' outside the Private album, 'remove' inside it. */
  privateAction: 'add' | 'remove';
  onRate: (rating: number) => Promise<void>;
  onFlag: (flag: UiFlag) => Promise<void>;
  onAddTag: (name: string) => Promise<void>;
  onStatus: (status: UiStatus | null) => Promise<void>;
  onAddToAlbums: (albumIds: number[]) => Promise<void>;
  onNewAlbum: () => void;
  onTray: (inTray: boolean) => Promise<void>;
  onText: (field: 'title' | 'notes', value: string) => Promise<void>;
  onDate: () => void;
  onPrivate: () => Promise<void>;
  /** Opens the Make Smaller sheet for the selection. */
  onMakeSmaller: () => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [draft, setDraft] = useState('');
  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [chosenAlbums, setChosenAlbums] = useState<number[]>([]);
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
            <TouchableOpacity key={n} style={styles.ratingBtn} onPress={() => void run(`Rated ${n}/10`, onRate(n))}>
              <Text style={styles.ratingText}>{n}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Wrap>
          <Chip label="Favorite (8)" onPress={() => void run('Marked as favorites', onRate(8))} />
          <Chip label="Clear rating" onPress={() => void run('Rating cleared', onRate(0))} />
        </Wrap>
      </Section>

      <Section label="Flag">
        <Wrap>
          <Chip label="⚑ Pick" onPress={() => void run('Flagged as picks', onFlag(1))} />
          <Chip label="✕ Reject" onPress={() => void run('Flagged as rejects', onFlag(-1))} />
          <Chip label="No flag" onPress={() => void run('Flags cleared', onFlag(0))} />
        </Wrap>
      </Section>

      <Section label="Status">
        <Wrap>
          {STATUSES.map((s) => (
            <Chip key={s.key} label={s.label} onPress={() => void run(s.label, onStatus(s.key))} />
          ))}
          <Chip label="No status" onPress={() => void run('Status cleared', onStatus(null))} />
        </Wrap>
      </Section>

      <Section label="Add to albums">
        <Wrap>
          {albums.map((a) => (
            <Chip
              key={a.id}
              label={a.name}
              on={chosenAlbums.includes(a.id)}
              onPress={() =>
                setChosenAlbums((ids) => (ids.includes(a.id) ? ids.filter((x) => x !== a.id) : [...ids, a.id]))
              }
            />
          ))}
          <Chip label="+ New album" onPress={onNewAlbum} />
        </Wrap>
        {chosenAlbums.length > 0 && (
          <TouchableOpacity
            style={[styles.primary, styles.selfStart]}
            onPress={() => {
              const n = chosenAlbums.length;
              void run(`Added to ${n} album${n === 1 ? '' : 's'}`, onAddToAlbums(chosenAlbums));
              setChosenAlbums([]);
            }}>
            <Text style={styles.primaryText}>Add to {chosenAlbums.length} album{chosenAlbums.length === 1 ? '' : 's'}</Text>
          </TouchableOpacity>
        )}
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
        <Wrap>
          {tags.map((t) => (
            <Chip key={t.id} label={`# ${t.name}`} onPress={() => addTag(t.name)} />
          ))}
        </Wrap>
      </Section>

      <Section label="Title and caption">
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="title for all"
            placeholderTextColor={p.textMuted}
            value={title}
            onChangeText={setTitle}
            keyboardAppearance={p.scheme}
          />
          <TouchableOpacity style={styles.primary} onPress={() => void run('Title set', onText('title', title))}>
            <Text style={styles.primaryText}>Set</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="caption for all"
            placeholderTextColor={p.textMuted}
            value={caption}
            onChangeText={setCaption}
            keyboardAppearance={p.scheme}
          />
          <TouchableOpacity style={styles.primary} onPress={() => void run('Caption set', onText('notes', caption))}>
            <Text style={styles.primaryText}>Set</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>Leave a box empty and tap Set to clear it.</Text>
      </Section>

      <Section label="Date">
        <Chip label="Adjust date & time…" onPress={onDate} />
      </Section>

      <Section label="Tray">
        <Wrap>
          <Chip label="Add to Tray" onPress={() => void run('Added to the Tray', onTray(true))} />
          <Chip label="Remove from Tray" onPress={() => void run('Removed from the Tray', onTray(false))} />
        </Wrap>
      </Section>

      <Section label="Storage">
        <Chip label="Make Smaller…" onPress={onMakeSmaller} />
        <Text style={styles.hint}>Re-encode the videos so they take less space.</Text>
      </Section>

      <Section label="Private">
        <Chip
          label={privateAction === 'add' ? 'Move to Private' : 'Remove from Private'}
          onPress={() => void run(privateAction === 'add' ? 'Moved to Private' : 'Removed from Private', onPrivate())}
        />
        <Text style={styles.hint}>
          {privateAction === 'add'
            ? 'Private videos disappear from every other view and only show after unlocking.'
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

  function toggleInfo(key: ViewOptions['infos'][number]) {
    const has = options.infos.includes(key);
    const next = has ? options.infos.filter((i) => i !== key) : [...options.infos, key];
    // Keep the order of the list, not the order of tapping.
    set({ infos: THUMB_INFOS.map((i) => i.key).filter((k) => next.includes(k)) });
  }

  return (
    <SheetFrame title="View Options" onClose={onClose} action={{ label: 'Done', onPress: onClose }}>
      <Section label="Layout style">
        <Segment options={LAYOUTS} value={options.layout} onChange={(layout) => set({ layout })} />
      </Section>

      <Section label="Thumbnail size">
        <Wrap>
          {THUMB_SIZES.map((s) => (
            <Chip key={s.key} label={s.label} on={options.size === s.key} onPress={() => set({ size: s.key })} />
          ))}
        </Wrap>
      </Section>

      <Section label="Sort by">
        <Wrap>
          {SORTS.map((s) => (
            <Chip key={s.key} label={s.label} on={options.sort === s.key} onPress={() => set({ sort: s.key })} />
          ))}
        </Wrap>
      </Section>

      <Section label="Group by date">
        <Segment options={GROUPINGS} value={options.groupBy} onChange={(groupBy) => set({ groupBy })} />
      </Section>

      <Section label="Thumbnail info (pick any)">
        <Wrap>
          {THUMB_INFOS.map((s) => (
            <Chip key={s.key} label={s.label} on={options.infos.includes(s.key)} onPress={() => toggleInfo(s.key)} />
          ))}
        </Wrap>
      </Section>

      <Section label="Show on thumbnails">
        <ToggleRow label="Rating & flag" value={options.showRating} onChange={(v) => set({ showRating: v })} />
        <ToggleRow label="Keyword mark" value={options.showKeywords} onChange={(v) => set({ showKeywords: v })} />
      </Section>

      <Section label="Appearance">
        <Segment options={THEMES} value={options.theme} onChange={(theme) => set({ theme })} />
      </Section>
    </SheetFrame>
  );
}

/* ------------------------------------------------------------ filter editor */

const MIN_RATINGS = [5, 6, 7, 8, 9, 10];
const ORIENTATIONS: { key: Orientation; label: string }[] = [
  { key: 'landscape', label: 'Landscape' },
  { key: 'portrait', label: 'Portrait' },
  { key: 'square', label: 'Square' },
];

/**
 * The filter editor. `mode: 'save'` edits a Smart Filter (needs a name);
 * `mode: 'search'` is HashPhotos' built-in search filters: apply once, or save.
 */
export function SmartFilterSheet({
  initial,
  tags,
  items,
  mode = 'save',
  onSave,
  onApply,
  onDelete,
  onClose,
}: {
  /** An existing filter to edit, or a starting rule for a new one. */
  initial: { id?: number; name: string; rule: SmartRule };
  tags: UiTag[];
  /** Live videos, to show how many match while editing. */
  items: VaultItem[];
  mode?: 'save' | 'search';
  onSave: (filter: { id?: number; name: string; rule: SmartRule }) => Promise<void>;
  /** Search mode: show the results without saving. */
  onApply?: (rule: SmartRule) => void;
  onDelete?: (id: number) => Promise<void>;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [name, setName] = useState(initial.name);
  const [rule, setRule] = useState<SmartRule>(initial.rule);

  const matches = useMemo(() => items.filter((v) => matchesRule(v, rule)).length, [items, rule]);
  const formats = useMemo(
    () =>
      [...new Set(items.map((v) => v.filename.split('.').pop()?.toUpperCase()).filter((x): x is string => !!x && x.length <= 5))].sort(),
    [items]
  );
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

  const searching = mode === 'search';

  return (
    <SheetFrame
      title={searching ? 'Search Filters' : initial.id !== undefined ? 'Edit Smart Filter' : 'New Smart Filter'}
      onClose={onClose}
      action={
        searching
          ? {
              label: 'Show',
              onPress: () => {
                onApply?.(rule);
                onClose();
              },
            }
          : { label: 'Save', onPress: save, disabled: !name.trim() }
      }>
      <Text style={styles.done}>
        Matches {matches} video{matches === 1 ? '' : 's'} right now
      </Text>

      <Section label={searching ? 'Save as Smart Filter (optional)' : 'Name'}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="e.g. Best travel clips"
            placeholderTextColor={p.textMuted}
            value={name}
            onChangeText={setName}
            keyboardAppearance={p.scheme}
          />
          {searching && (
            <TouchableOpacity style={[styles.primary, !name.trim() && styles.disabled]} disabled={!name.trim()} onPress={save}>
              <Text style={styles.primaryText}>Save</Text>
            </TouchableOpacity>
          )}
        </View>
      </Section>

      <Section label="Name, title or caption contains">
        <TextInput
          style={styles.input}
          placeholder={rule.regex ? 'regular expression, e.g. ^IMG_\\d+' : 'text (optional)'}
          placeholderTextColor={p.textMuted}
          value={rule.text ?? ''}
          onChangeText={(t) => set({ text: t || undefined })}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardAppearance={p.scheme}
        />
        <ToggleRow label="Regular expression" value={!!rule.regex} onChange={(v) => set({ regex: v || undefined })} />
      </Section>

      <Section label="Rating at least">
        <Wrap>
          <Chip label="Any" on={!rule.minRating} onPress={() => set({ minRating: undefined })} />
          {MIN_RATINGS.map((n) => (
            <Chip key={n} label={n === 10 ? '10' : `${n}+`} on={rule.minRating === n} onPress={() => set({ minRating: n })} />
          ))}
        </Wrap>
        <Wrap>
          <Chip label="Unrated only" on={rule.maxRating === 0} onPress={() => set({ maxRating: rule.maxRating === 0 ? undefined : 0, minRating: undefined })} />
        </Wrap>
      </Section>

      <Section label="Flag">
        <Wrap>
          <Chip label="Any" on={!rule.flag} onPress={() => set({ flag: undefined })} />
          <Chip label="Picks" on={rule.flag === 'pick'} onPress={() => set({ flag: 'pick' })} />
          <Chip label="Rejects" on={rule.flag === 'reject'} onPress={() => set({ flag: 'reject' })} />
          <Chip label="No flag" on={rule.flag === 'none'} onPress={() => set({ flag: 'none' })} />
        </Wrap>
      </Section>

      <Section label="Status">
        <Wrap>
          <Chip label="Any" on={!rule.status} onPress={() => set({ status: undefined })} />
          {STATUSES.map((s) => (
            <Chip key={s.key} label={s.label} on={rule.status === s.key} onPress={() => set({ status: s.key })} />
          ))}
        </Wrap>
      </Section>

      <Section label="Keywords (all of them)">
        <Wrap>
          {tags.length === 0 && <Text style={styles.muted}>No keywords yet.</Text>}
          {tags.map((t) => (
            <Chip key={t.id} label={`# ${t.name}`} on={rule.tags?.includes(t.name)} onPress={() => toggleTag(t.name)} />
          ))}
        </Wrap>
        <ToggleRow
          label="Only videos without keywords"
          value={!!rule.untagged}
          onChange={(v) => set({ untagged: v || undefined, tags: v ? undefined : rule.tags })}
        />
        <View style={styles.numbers}>
          <NumberBox label="min keywords" value={rule.minKeywords} onChange={(v) => set({ minKeywords: v })} />
          <NumberBox label="max keywords" value={rule.maxKeywords} onChange={(v) => set({ maxKeywords: v })} />
          <NumberBox label="min albums" value={rule.minAlbums} onChange={(v) => set({ minAlbums: v })} />
          <NumberBox label="max albums" value={rule.maxAlbums} onChange={(v) => set({ maxAlbums: v })} />
        </View>
      </Section>

      <Section label="Filmed between">
        <View style={styles.numbers}>
          <DayBox label="from" value={rule.dateFrom} onChange={(v) => set({ dateFrom: v })} />
          <DayBox label="to" value={rule.dateTo} endOfDay onChange={(v) => set({ dateTo: v })} />
        </View>
      </Section>

      <Section label="Length and file size">
        <View style={styles.numbers}>
          <NumberBox label="min seconds" value={rule.minDurationSec} onChange={(v) => set({ minDurationSec: v })} />
          <NumberBox label="max seconds" value={rule.maxDurationSec} onChange={(v) => set({ maxDurationSec: v })} />
          <NumberBox label="min MB" value={rule.minSizeMb} onChange={(v) => set({ minSizeMb: v })} />
          <NumberBox label="max MB" value={rule.maxSizeMb} onChange={(v) => set({ maxSizeMb: v })} />
        </View>
      </Section>

      <Section label="Shape">
        <Wrap>
          <Chip label="Any" on={!rule.orientation} onPress={() => set({ orientation: undefined })} />
          {ORIENTATIONS.map((o) => (
            <Chip key={o.key} label={o.label} on={rule.orientation === o.key} onPress={() => set({ orientation: o.key })} />
          ))}
        </Wrap>
      </Section>

      {formats.length > 1 && (
        <Section label="Format">
          <Wrap>
            <Chip label="Any" on={!rule.format} onPress={() => set({ format: undefined })} />
            {formats.map((f) => (
              <Chip key={f} label={f} on={rule.format === f} onPress={() => set({ format: f })} />
            ))}
          </Wrap>
        </Section>
      )}

      <Section label="More">
        <Wrap>
          <Chip label="Any location" on={rule.hasLocation === undefined} onPress={() => set({ hasLocation: undefined })} />
          <Chip label="With location" on={rule.hasLocation === true} onPress={() => set({ hasLocation: true })} />
          <Chip label="No location" on={rule.hasLocation === false} onPress={() => set({ hasLocation: false })} />
        </Wrap>
        <ToggleRow label="Only videos in the Tray" value={!!rule.inTray} onChange={(v) => set({ inTray: v || undefined })} />
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
      borderTopLeftRadius: 30,
      borderTopRightRadius: 30,
      paddingTop: 6,
      maxHeight: '90%',
    },
    grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: p.grabber, marginBottom: 8 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingBottom: 8,
      gap: 10,
    },
    title: { flex: 1, color: p.text, fontSize: 18, fontWeight: '800', textAlign: 'center', letterSpacing: -0.2 },
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
    selfStart: { alignSelf: 'flex-start' },
    disabled: { opacity: 0.4 },
    body: { paddingHorizontal: 16, paddingBottom: 40, gap: 18 },
    done: { color: p.link, fontSize: 13, fontWeight: '600' },
    hint: { color: p.textSecondary, fontSize: 12 },

    section: { gap: 10 },
    sectionLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

    chip: {
      alignSelf: 'flex-start',
      backgroundColor: p.card,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    chipOn: { backgroundColor: p.accent },
    chipText: { color: p.textSoft, fontSize: 14, fontWeight: '600' },
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
    numbers: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    numberWrap: { alignItems: 'center', gap: 4 },
    number: {
      width: 72,
      backgroundColor: p.card,
      borderRadius: 10,
      paddingVertical: 9,
      color: p.text,
      textAlign: 'center',
      borderWidth: 1,
      borderColor: p.border,
    },
    dayBox: { width: 128 },
    numberLabel: { color: p.textMuted, fontSize: 11 },

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
    toggleLabel: { color: p.textSoft, fontSize: 15, flex: 1, paddingRight: 10 },

    muted: { color: p.textMuted, fontStyle: 'italic' },
    deleteRow: { paddingVertical: 12, alignItems: 'center' },
    deleteText: { color: p.dangerText, fontWeight: '700' },
  });
