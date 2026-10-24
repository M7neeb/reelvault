/**
 * Settings (security, backup, import) and the passcode screen.
 *
 * The passcode itself never reaches the UI's state for longer than typing it:
 * checking and storing happen in the native layer (`security.ts`).
 * Presentational only (see the rule in types.ts).
 */

import { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Modal } from './screen';

import { QUALITIES } from '../smaller';
import { Chip, Section, SheetFrame, ToggleRow, Wrap } from './sheets';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import { PASSCODE_KINDS, type CompressQuality, type PasscodeKind, type SecurityState } from './types';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
const MAX_TRIES = 5;
const LOCKOUT_MS = 30_000;

const lengthOf = (kind: PasscodeKind): number | null => (kind === '4' ? 4 : kind === '6' ? 6 : null);

export type PasscodeMode =
  /** Opening Private. */
  | { kind: 'unlock'; passcode: PasscodeKind; faceId: boolean }
  /** Choosing a new passcode (entered twice). */
  | { kind: 'create'; passcode: PasscodeKind; label: string };

/**
 * HashPhotos-style passcode screen: a number pad for 4 / 6 digit codes, a text
 * box for longer numbers or letters, a Face ID button when allowed, and a
 * 30 second pause after five wrong tries.
 */
export function PasscodeSheet({
  mode,
  onCheck,
  onFaceId,
  onCreate,
  onClose,
}: {
  mode: PasscodeMode;
  /** Unlock: 'ok' closes the screen, 'wrong' shakes. */
  onCheck?: (code: string) => Promise<'ok' | 'wrong'>;
  onFaceId?: () => Promise<boolean>;
  /** Create: called once the code was typed the same way twice. */
  onCreate?: (code: string) => Promise<void>;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [code, setCode] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [tries, setTries] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  const kind = mode.passcode;
  const length = lengthOf(kind);
  const locked = now < lockedUntil;

  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [locked]);

  // Face ID straight away when it is allowed, like HashPhotos.
  useEffect(() => {
    if (mode.kind !== 'unlock' || !mode.faceId || !onFaceId) return;
    onFaceId()
      .then((ok) => ok && onClose())
      .catch(() => {});
    // Only once, when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(value: string) {
    if (!value) return;
    if (mode.kind === 'unlock') {
      const result = (await onCheck?.(value)) ?? 'wrong';
      if (result === 'ok') {
        onClose();
        return;
      }
      const n = tries + 1;
      setTries(n);
      setCode('');
      if (n >= MAX_TRIES) {
        setLockedUntil(Date.now() + LOCKOUT_MS);
        setNow(Date.now());
        setTries(0);
        setMessage('Too many tries. Wait 30 seconds.');
      } else {
        setMessage(`Wrong passcode (${MAX_TRIES - n} ${MAX_TRIES - n === 1 ? 'try' : 'tries'} left before a pause)`);
      }
      return;
    }
    // create: twice the same
    if (first === null) {
      if (length === null && value.length < 4) {
        setMessage('Use at least 4 characters.');
        return;
      }
      setFirst(value);
      setCode('');
      setMessage('Type it again to confirm.');
      return;
    }
    if (value !== first) {
      setFirst(null);
      setCode('');
      setMessage('They did not match. Start again.');
      return;
    }
    await onCreate?.(value);
    onClose();
  }

  function press(key: string) {
    if (locked) return;
    if (key === '⌫') {
      setCode((c) => c.slice(0, -1));
      return;
    }
    if (!key) return;
    const next = code + key;
    setCode(next);
    if (length !== null && next.length === length) void submit(next);
  }

  const title =
    mode.kind === 'unlock'
      ? 'Enter Passcode'
      : first === null
        ? mode.label
        : 'Confirm Passcode';

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <TouchableOpacity style={styles.cancel} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{locked ? `Try again in ${Math.ceil((lockedUntil - now) / 1000)} s` : message}</Text>

        {length !== null ? (
          <>
            <View style={styles.dots}>
              {Array.from({ length }, (_, i) => (
                <View key={i} style={[styles.dot, i < code.length && styles.dotOn]} />
              ))}
            </View>
            <View style={styles.pad}>
              {DIGITS.map((d, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.key, !d && styles.keyEmpty]}
                  disabled={!d || locked}
                  onPress={() => press(d)}
                  accessibilityLabel={d === '⌫' ? 'Delete' : d}>
                  <Text style={styles.keyText}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : (
          <View style={styles.textEntry}>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              secureTextEntry
              autoFocus
              editable={!locked}
              keyboardType={kind === 'numeric' ? 'number-pad' : 'default'}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardAppearance={p.scheme}
              onSubmitEditing={() => void submit(code)}
              returnKeyType="done"
            />
            <TouchableOpacity style={styles.ok} disabled={locked} onPress={() => void submit(code)}>
              <Text style={styles.okText}>OK</Text>
            </TouchableOpacity>
          </View>
        )}

        {mode.kind === 'unlock' && mode.faceId && onFaceId && (
          <TouchableOpacity
            style={styles.faceId}
            onPress={() =>
              onFaceId()
                .then((ok) => ok && onClose())
                .catch(() => {})
            }>
            <Text style={styles.faceIdText}>Use Face ID</Text>
          </TouchableOpacity>
        )}
      </View>
    </Modal>
  );
}

/** Settings: security for Private, the library-info backup and folder import. */
export function SettingsSheet({
  security,
  onTurnOnPasscode,
  onChangePasscode,
  onTurnOffPasscode,
  onFaceId,
  onSetFake,
  onRemoveFake,
  onImportFolder,
  onExportBackup,
  onExportSpreadsheet,
  onImportBackup,
  canMakeSmaller,
  importQuality,
  onImportQuality,
  onPersonalise,
  loadPasscodeLog,
  onClearPasscodeLog,
  backups,
  onClose,
}: {
  /** The automatic weekly backups (list, make one now, restore one). */
  backups?: {
    list: () => Promise<{ name: string; uri: string; at: number; size: number }[]>;
    now: () => Promise<unknown>;
    restore: (uri: string) => Promise<{ matched: number; total: number; plays: number } | null>;
  };
  security: SecurityState | null;
  /** Wrong and fake passcodes typed at Private (newest first). */
  loadPasscodeLog?: () => Promise<{ at: number; kind: 'wrong' | 'fake' | 'faceid-failed' }[]>;
  onClearPasscodeLog?: () => Promise<void>;
  onTurnOnPasscode: (kind: PasscodeKind) => void;
  onChangePasscode: () => void;
  onTurnOffPasscode: () => void;
  onFaceId: (enabled: boolean) => void;
  onSetFake: () => void;
  onRemoveFake: () => void;
  onImportFolder: () => void;
  onExportBackup: () => void;
  onExportSpreadsheet?: () => void;
  onImportBackup: () => void;
  canMakeSmaller: boolean;
  /** Make Smaller quality for every import; null = off. */
  importQuality: CompressQuality | null;
  onImportQuality: (quality: CompressQuality | null) => void;
  onPersonalise?: () => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const [kind, setKind] = useState<PasscodeKind>('6');
  const [log, setLog] = useState<{ at: number; kind: 'wrong' | 'fake' | 'faceid-failed' }[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const on = !!security?.passcodeKind;
  useEffect(() => {
    loadPasscodeLog?.()
      .then(setLog)
      .catch(() => setLog([]));
  }, [loadPasscodeLog]);

  return (
    <SheetFrame title="Settings" onClose={onClose} action={{ label: 'Done', onPress: onClose }}>
      {onPersonalise && (
        <Section label="Personalise">
          <Chip label="Layout, accent colour, app icon, rating words…" onPress={onPersonalise} />
        </Section>
      )}
      <Section label="Private album">
        {on ? (
          <>
            <Text style={styles.body}>
              Passcode on ({PASSCODE_KINDS.find((k) => k.key === security?.passcodeKind)?.label.toLowerCase()}).
            </Text>
            <ToggleRow label="Unlock with Face ID" value={!!security?.faceId} onChange={onFaceId} />
            <Wrap>
              <Chip label="Change passcode" onPress={onChangePasscode} />
              <Chip label="Turn passcode off" danger onPress={onTurnOffPasscode} />
            </Wrap>
            <Text style={styles.subLabel}>Fake passcode</Text>
            <Text style={styles.hint}>
              A second passcode that opens an empty Private album - for when someone makes you unlock it.
            </Text>
            <Wrap>
              {security?.hasFakePasscode ? (
                <Chip label="Remove fake passcode" danger onPress={onRemoveFake} />
              ) : (
                <Chip label="Set fake passcode" onPress={onSetFake} />
              )}
            </Wrap>
          </>
        ) : (
          <>
            <Text style={styles.body}>
              Private opens with Face ID or the iPhone's passcode. Add a ReelVault passcode for its own lock and a fake
              passcode.
            </Text>
            <Wrap>
              {PASSCODE_KINDS.map((k) => (
                <Chip key={k.key} label={k.label} on={kind === k.key} onPress={() => setKind(k.key)} />
              ))}
            </Wrap>
            <Chip label="Turn passcode on" onPress={() => onTurnOnPasscode(kind)} />
          </>
        )}
      </Section>

      {log !== null && (
        <Section label="Who tried to get in">
          {log.length === 0 ? (
            <Text style={styles.hint}>No wrong passcodes so far. Every wrong or fake passcode typed at Private shows up here, with the time.</Text>
          ) : (
            <>
              <Text style={styles.body}>
                {log.filter((x) => x.kind === 'wrong').length} wrong · {log.filter((x) => x.kind === 'fake').length} fake passcode
                {log.filter((x) => x.kind === 'faceid-failed').length ? ` · ${log.filter((x) => x.kind === 'faceid-failed').length} Face ID failed` : ''}
              </Text>
              {(showAll ? log : log.slice(0, 6)).map((x, i) => (
                <View key={`${x.at}-${i}`} style={styles.logRow}>
                  <View style={[styles.logDot, { backgroundColor: x.kind === 'fake' ? '#FF9F0A' : '#FF453A' }]} />
                  <Text style={styles.logText}>{x.kind === 'wrong' ? 'Wrong passcode' : x.kind === 'fake' ? 'Fake passcode used' : 'Face ID failed'}</Text>
                  <Text style={styles.logTime}>{new Date(x.at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
                </View>
              ))}
              <Wrap>
                {log.length > 6 && <Chip label={showAll ? 'Show fewer' : `Show all ${log.length}`} onPress={() => setShowAll((v) => !v)} />}
                {onClearPasscodeLog && (
                  <Chip
                    label="Clear the list"
                    danger
                    onPress={() => {
                      void onClearPasscodeLog().then(() => setLog([]));
                    }}
                  />
                )}
              </Wrap>
            </>
          )}
        </Section>
      )}

      <Section label="Import">
        <Chip label="Import a whole folder from Files…" onPress={onImportFolder} />
        <Text style={styles.hint}>Copies every video in the folder and its sub-folders; the originals stay where they are.</Text>
        <Text style={styles.subLabel}>Make imported videos smaller</Text>
        <Wrap>
          <Chip label="Off" on={importQuality === null} onPress={() => onImportQuality(null)} />
          {QUALITIES.map((q) => (
            <Chip key={q.key} label={q.label} on={importQuality === q.key} onPress={() => onImportQuality(q.key)} />
          ))}
        </Wrap>
        <Text style={styles.hint}>
          {canMakeSmaller
            ? 'Each video is re-encoded right after it comes in, before the next one, so the space is freed as the import goes. Videos that would not get at least 10% smaller stay as they are.'
            : 'Needs the new app version (1.1) - until then imports keep their full size.'}
        </Text>
      </Section>

      <Section label="Backup">
        <Wrap>
          <Chip label="Export all my info" onPress={onExportBackup} />
          <Chip label="Restore from a file" onPress={onImportBackup} />
          {onExportSpreadsheet && <Chip label="Export a spreadsheet (CSV)" onPress={onExportSpreadsheet} />}
        </Wrap>
        <Text style={styles.hint}>
          Everything you added, as one small file to save in Files or on your PC: ratings, titles, captions, keywords,
          albums, flags, status, smart filters, series, your watch history, bookmarks, where to continue, Simkl links and
          your settings (goals, memories, badges, pins, the player). It does not contain the videos, and leaves out
          private ones. Restoring adds to what is here and never deletes anything; videos are matched even if renamed.
        </Text>
        {backups && <AutoBackups backups={backups} />}
      </Section>
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    body: { color: p.textSoft, fontSize: 14 },
    subLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '700', paddingTop: 8 },
    backupRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: p.card, borderRadius: 12, padding: 10 },
    backupDay: { color: p.text, fontSize: 15, fontWeight: '700' },
    backupBtn: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: p.elevated },
    backupBtnText: { color: p.link, fontSize: 13, fontWeight: '800' },
    hint: { color: p.textSecondary, fontSize: 12 },
    logRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 3 },
    logDot: { width: 8, height: 8, borderRadius: 4 },
    logText: { color: p.text, fontSize: 14, flex: 1 },
    logTime: { color: p.textSecondary, fontSize: 12, fontVariant: ['tabular-nums'] },

    screen: { flex: 1, backgroundColor: p.bg, alignItems: 'center', paddingTop: 70, paddingHorizontal: 24 },
    cancel: { position: 'absolute', top: 56, left: 20, padding: 8 },
    cancelText: { color: p.link, fontSize: 17 },
    title: { color: p.text, fontSize: 22, fontWeight: '700', marginTop: 40 },
    message: { color: p.textSecondary, fontSize: 14, marginTop: 10, minHeight: 20, textAlign: 'center' },
    dots: { flexDirection: 'row', gap: 16, marginTop: 28, marginBottom: 36 },
    dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: p.text },
    dotOn: { backgroundColor: p.text },
    pad: { width: 270, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 },
    key: { width: 78, height: 78, borderRadius: 39, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    keyEmpty: { backgroundColor: 'transparent' },
    keyText: { color: p.text, fontSize: 30, fontWeight: '400' },
    textEntry: { flexDirection: 'row', gap: 10, marginTop: 30, alignSelf: 'stretch' },
    input: {
      flex: 1,
      backgroundColor: p.card,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 13,
      color: p.text,
      fontSize: 18,
      borderWidth: 1,
      borderColor: p.border,
    },
    ok: { backgroundColor: p.accent, borderRadius: 12, paddingHorizontal: 22, justifyContent: 'center' },
    okText: { color: '#fff', fontWeight: '700', fontSize: 16 },
    faceId: { marginTop: 30, padding: 10 },
    faceIdText: { color: p.link, fontSize: 16, fontWeight: '600' },
  });

/** The weekly copies of your info kept on the phone: when, restore one, or make one now. */
function AutoBackups({ backups }: { backups: NonNullable<Parameters<typeof SettingsSheet>[0]['backups']> }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [list, setList] = useState<{ name: string; uri: string; at: number; size: number }[] | null>(null);
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const load = () =>
    backups
      .list()
      .then(setList)
      .catch(() => setList([]));
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const day = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <View style={{ gap: 8, marginTop: 6 }}>
      <Text style={styles.subLabel}>Automatic weekly backups</Text>
      {list === null ? null : list.length === 0 ? (
        <Text style={styles.hint}>None yet. The first one is made a few seconds after the app opens.</Text>
      ) : (
        list.map((b) => (
          <View key={b.uri} style={styles.backupRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.backupDay}>{day(b.at)}</Text>
              <Text style={styles.hint}>{Math.max(1, Math.round(b.size / 1024))} KB</Text>
            </View>
            {confirm === b.uri ? (
              <TouchableOpacity
                style={[styles.backupBtn, { backgroundColor: p.accent }]}
                onPress={() => {
                  setConfirm(null);
                  setNote('Restoring…');
                  backups
                    .restore(b.uri)
                    .then((r) => setNote(r ? `Restored info for ${r.matched} of ${r.total} videos${r.plays ? `, with ${r.plays} plays of history` : ''}.` : 'Nothing restored.'))
                    .catch((e) => setNote(`That did not work: ${String(e)}`));
                }}>
                <Text style={[styles.backupBtnText, { color: '#fff' }]}>Tap again to restore</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.backupBtn} onPress={() => setConfirm(b.uri)}>
                <Text style={styles.backupBtnText}>Restore</Text>
              </TouchableOpacity>
            )}
          </View>
        ))
      )}
      <Chip
        label="Back up now"
        onPress={() => {
          setNote('Backing up…');
          backups
            .now()
            .then(() => {
              setNote('Backed up.');
              return load();
            })
            .catch((e) => setNote(`That did not work: ${String(e)}`));
        }}
      />
      {!!note && <Text style={[styles.hint, { color: p.text }]}>{note}</Text>}
      <Text style={styles.hint}>
        Made once a week, the last four kept. They live inside ReelVault; on a PC, the Apple Devices app shows them under Files › ReelVault › Backups, so you can copy them off the phone.
      </Text>
    </View>
  );
}
