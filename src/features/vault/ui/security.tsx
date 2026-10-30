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
import { Row, Rows, SheetFrame } from './sheets';
import { OptionsSheet } from './prompts';
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

  const [pick, setPick] = useState<null | 'passcode' | 'quality'>(null);
  const qualityLabel = importQuality === null ? 'Off' : (QUALITIES.find((q) => q.key === importQuality)?.label ?? 'Off');
  const wrong = log?.filter((x) => x.kind === 'wrong').length ?? 0;
  const fake = log?.filter((x) => x.kind === 'fake').length ?? 0;
  const faceFails = log?.filter((x) => x.kind === 'faceid-failed').length ?? 0;

  return (
    <SheetFrame title="Settings" onClose={onClose} action={{ label: 'Done', onPress: onClose }}>
      {onPersonalise && (
        <Rows>
          <Row icon="paint" tint="#FF9F0A" title="Personalise" sub="Layout, accent colour, app icon, rating words" onPress={onPersonalise} />
        </Rows>
      )}

      <Rows
        label="Private album"
        footer={
          on
            ? 'A fake passcode opens an empty Private album - for when someone makes you unlock it.'
            : "Private opens with Face ID or the iPhone's passcode. A ReelVault passcode gives it its own lock, and a fake one."
        }>
        <Row
          icon="lock"
          tint="#30D158"
          title="ReelVault passcode"
          value={on ? PASSCODE_KINDS.find((k) => k.key === security?.passcodeKind)?.label : undefined}
          toggle={{ value: on, onChange: (v) => (v ? setPick('passcode') : onTurnOffPasscode()) }}
        />
        {on && <Row icon="shield" tint="#0A84FF" title="Unlock with Face ID" toggle={{ value: !!security?.faceId, onChange: onFaceId }} />}
        {on && <Row icon="edit" tint="#8E8E93" title="Change passcode" onPress={onChangePasscode} />}
        {on && (
          <Row
            icon="eyeOff"
            tint="#BF5AF2"
            title="Fake passcode"
            value={security?.hasFakePasscode ? 'On - tap to remove' : 'Off'}
            onPress={security?.hasFakePasscode ? onRemoveFake : onSetFake}
          />
        )}
      </Rows>

      {log !== null && (
        <Rows label="Who tried to get in" footer={log.length ? undefined : 'Every wrong or fake passcode typed at Private shows up here, with the time.'}>
          <Row
            icon="eye"
            tint={log.length ? '#FF453A' : '#8E8E93'}
            title={log.length ? `${wrong} wrong · ${fake} fake${faceFails ? ` · ${faceFails} Face ID failed` : ''}` : 'Nobody so far'}
          />
          {(showAll ? log : log.slice(0, 5)).map((x, i) => (
            <View key={`${x.at}-${i}`} style={styles.logRow}>
              <View style={[styles.logDot, { backgroundColor: x.kind === 'fake' ? '#FF9F0A' : '#FF453A' }]} />
              <Text style={styles.logText}>{x.kind === 'wrong' ? 'Wrong passcode' : x.kind === 'fake' ? 'Fake passcode used' : 'Face ID failed'}</Text>
              <Text style={styles.logTime}>{new Date(x.at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
          ))}
          {log.length > 5 && <Row title={showAll ? 'Show fewer' : `Show all ${log.length}`} onPress={() => setShowAll((v) => !v)} />}
          {log.length > 0 && onClearPasscodeLog && <Row title="Clear the list" danger onPress={() => void onClearPasscodeLog().then(() => setLog([]))} />}
        </Rows>
      )}

      <Rows
        label="Import"
        footer={
          canMakeSmaller
            ? 'Make Smaller re-encodes each video right after it comes in, so the space is freed as the import goes. Videos that would not get at least 10% smaller stay as they are.'
            : 'Making imports smaller needs the app version with the video encoder (1.1 or later).'
        }>
        <Row icon="import" tint="#0A84FF" title="Import a whole folder" sub="Every video in it and its sub-folders" onPress={onImportFolder} />
        <Row icon="storage" tint="#64D2FF" title="Make imported videos smaller" value={qualityLabel} onPress={() => setPick('quality')} />
      </Rows>

      <Rows
        label="Backup"
        footer="Your info as one small file for Files or your PC: ratings, titles, keywords, albums, history, bookmarks, Simkl links and settings - not the videos, and no private ones. Restoring adds to what is here and never deletes anything.">
        <Row icon="share" tint="#30D158" title="Export all my info" onPress={onExportBackup} />
        <Row icon="history" tint="#FF9F0A" title="Restore from a file" onPress={onImportBackup} />
        {onExportSpreadsheet && <Row icon="list" tint="#5E5CE6" title="Export a spreadsheet (CSV)" onPress={onExportSpreadsheet} />}
      </Rows>
      {backups && <AutoBackups backups={backups} />}

      {pick === 'passcode' && (
        <OptionsSheet
          title="What kind of passcode?"
          options={PASSCODE_KINDS.map((k) => ({ label: k.label, onPress: () => onTurnOnPasscode(k.key) }))}
          onClose={() => setPick(null)}
        />
      )}
      {pick === 'quality' && (
        <OptionsSheet
          title="Make imported videos smaller"
          options={[
            { label: 'Off', hint: importQuality === null ? '✓ Keep full size' : 'Keep full size', onPress: () => onImportQuality(null) },
            ...QUALITIES.map((q) => ({ label: q.label, hint: importQuality === q.key ? '✓' : undefined, onPress: () => onImportQuality(q.key) })),
          ]}
          onClose={() => setPick(null)}
        />
      )}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    body: { color: p.textSoft, fontSize: 14 },
    subLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '700', paddingTop: 8 },
    backupRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: p.card, borderRadius: 12, padding: 10 },
    backupDay: { color: p.text, fontSize: 15, fontWeight: '700' },
    backupBtn: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: p.circle },
    backupBtnText: { color: p.link, fontSize: 13, fontWeight: '800' },
    hint: { color: p.textSecondary, fontSize: 12 },
    logRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14 },
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
    <Rows
      label="Automatic weekly backups"
      footer={`${note ? `${note} ` : ''}Made once a week, the last four kept. On a PC the Apple Devices app shows them under Files › ReelVault › Backups.`}>
      {list !== null && list.length === 0 && <Row title="None yet" sub="The first one is made a few seconds after the app opens." />}
      {(list ?? []).map((b) => (
        <Row
          key={b.uri}
          icon="clock"
          tint="#8E8E93"
          title={day(b.at)}
          sub={`${Math.max(1, Math.round(b.size / 1024))} KB`}
          right={
            confirm === b.uri ? (
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
                <Text style={[styles.backupBtnText, { color: '#fff' }]}>Tap again</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.backupBtn} onPress={() => setConfirm(b.uri)}>
                <Text style={styles.backupBtnText}>Restore</Text>
              </TouchableOpacity>
            )
          }
        />
      ))}
      <Row
        icon="sync"
        tint="#0A84FF"
        title="Back up now"
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
    </Rows>
  );
}
