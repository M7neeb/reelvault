/**
 * Browse: where manga come from besides your own files.
 *  - Sources: MangaDex, your servers (Komga, Kavita and others through OPDS;
 *    Suwayomi with the extensions installed on it) and installed extensions.
 *    Your languages and whether adult titles show.
 *  - Extensions: repos you add by link (after a warning about what may be
 *    shared), the extensions in them, install, update and remove.
 * Presentational only (see types.ts).
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { GatedModal as Modal } from '../screen';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RepoExtension } from '../../manga/sources/extensions';
import { LANGUAGES, updatesFor, type ServerKind } from '../../manga/sources/prefs';
import type { SourceInfo } from '../../manga/sources/types';
import { success, tick } from '../haptics';
import Icon from '../Icon';
import { OptionsSheet } from '../prompts';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import SourceScreen from './SourceScreen';
import type { BrowseData, SourceGroup } from './mangaTypes';

type Tab = 'sources' | 'extensions';

const err = (e: unknown) => String(e).replace(/^Error:\s*/, '');

function Letter({ name, kind }: { name: string; kind: SourceInfo['kind'] }) {
  const styles = useStyles(makeStyles);
  const bg = kind === 'builtin' ? '#FF6740' : kind === 'server' ? '#30A46C' : '#5E5CE6';
  return (
    <View style={[styles.letter, { backgroundColor: bg }]}>
      <Text style={styles.letterText}>{name.trim().charAt(0).toUpperCase() || '?'}</Text>
    </View>
  );
}

export default function BrowseScreen({
  browse,
  libraryIdOf,
  onOpenInLibrary,
  onClose,
  initialTab = 'sources',
  initialSourceId = null,
  initialOpenKey = null,
  initialForm = null,
}: {
  browse: BrowseData;
  libraryIdOf: (sourceId: string, key: string) => string | null;
  onOpenInLibrary: (seriesId: string) => void;
  onClose: () => void;
  initialTab?: Tab;
  /** The preview opens a source straight away. */
  initialSourceId?: string | null;
  initialOpenKey?: string | null;
  initialForm?: null | 'server' | 'repo' | 'languages';
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { prefs, actions } = browse;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [groups, setGroups] = useState<SourceGroup[] | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [openId, setOpenId] = useState<string | null>(initialSourceId);
  const [form, setForm] = useState<null | 'server' | 'repo' | 'languages'>(initialForm);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [removeServer, setRemoveServer] = useState<SourceGroup | null>(null);

  const reload = useCallback(
    (again = false) => {
      setLoadingGroups(true);
      actions
        .groups(again)
        .then(setGroups)
        .catch((e) => setMessage(err(e)))
        .finally(() => setLoadingGroups(false));
    },
    [actions]
  );
  // Sources follow the settings (languages, adult, servers, extensions).
  useEffect(() => reload(), [reload, prefs]);

  const open = openId ? actions.source(openId) : null;
  const updates = updatesFor(prefs);

  const run = async (label: string, job: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    setMessage(null);
    try {
      await job();
      if (done) {
        success();
        setMessage(done);
      }
    } catch (e) {
      setMessage(err(e));
    } finally {
      setBusy(null);
    }
  };

  const sourcesTab = (
    <>
      {loadingGroups && !groups && <ActivityIndicator style={{ marginTop: 20 }} color={p.textSecondary} />}
      {(groups ?? []).map((g) => (
        <View key={g.title + (g.serverId ?? '')} style={styles.group}>
          <View style={styles.groupHead}>
            <Text style={styles.section}>{g.title}</Text>
            {g.serverId && (
              <TouchableOpacity hitSlop={10} onPress={() => setRemoveServer(g)} accessibilityLabel={`Remove ${g.title}`}>
                <Icon name="more" size={15} color={p.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          {g.error && <Text style={styles.warnText}>Could not reach it: {g.error}</Text>}
          <View style={styles.card}>
            {g.items.map((s) => (
              <TouchableOpacity key={s.id} style={styles.row} onPress={() => setOpenId(s.id)} accessibilityLabel={`Open ${s.name}`}>
                <Letter name={s.name} kind={s.kind} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {s.hint}
                  </Text>
                </View>
                {s.lang && s.lang !== 'multi' && <Text style={styles.badge}>{s.lang.toUpperCase()}</Text>}
                {s.nsfw && <Text style={[styles.badge, styles.badgeWarn]}>18+</Text>}
                <Icon name="forward" size={13} color={p.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      <TouchableOpacity style={styles.addRow} onPress={() => setForm('server')}>
        <Icon name="plus" size={15} color={p.link} />
        <Text style={styles.addText}>Add your server (Komga, Kavita, Suwayomi…)</Text>
      </TouchableOpacity>

      <Text style={[styles.section, { marginTop: 22 }]}>Settings</Text>
      <View style={styles.card}>
        <TouchableOpacity style={styles.row} onPress={() => setForm('languages')}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Languages</Text>
            <Text style={styles.rowMeta}>{prefs.languages.map((c) => LANGUAGES.find((l) => l[0] === c)?.[1] ?? c).join(', ')}</Text>
          </View>
          <Icon name="forward" size={13} color={p.textMuted} />
        </TouchableOpacity>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Show adult titles</Text>
            <Text style={styles.rowMeta}>Off: 18+ titles and sources stay hidden</Text>
          </View>
          <Switch value={prefs.adult} onValueChange={(v) => actions.setAdult(v).catch(() => undefined)} />
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Smaller pages</Text>
            <Text style={styles.rowMeta}>Downloads take about half the space, still sharp on the iPhone</Text>
          </View>
          <Switch value={prefs.smallerPages} onValueChange={(v) => actions.setOption('smallerPages', v).catch(() => undefined)} />
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Check for new chapters</Text>
            <Text style={styles.rowMeta}>When the app opens (every 6 hours at most), with a notification</Text>
          </View>
          <Switch value={prefs.checkOnOpen} onValueChange={(v) => actions.setOption('checkOnOpen', v).catch(() => undefined)} />
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Skip Completed and Dropped</Text>
            <Text style={styles.rowMeta}>The check for new chapters leaves those titles out (faster, fewer requests)</Text>
          </View>
          <Switch value={prefs.skipFinished} onValueChange={(v) => actions.setOption('skipFinished', v).catch(() => undefined)} />
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Download new chapters</Text>
            <Text style={styles.rowMeta}>By themselves, for titles you are reading or plan to read</Text>
          </View>
          <Switch value={prefs.autoDownload} onValueChange={(v) => actions.setOption('autoDownload', v).catch(() => undefined)} />
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Send reading progress to your servers</Text>
            <Text style={styles.rowMeta}>Suwayomi, Komga and Kavita show the page you reached in ReelVault</Text>
          </View>
          <Switch value={prefs.syncProgress} onValueChange={(v) => actions.setOption('syncProgress', v).catch(() => undefined)} />
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Remove downloads after reading</Text>
            <Text style={styles.rowMeta}>Read chapters give their space back (they stay readable online)</Text>
          </View>
          <Switch value={prefs.removeAfterRead} onValueChange={(v) => actions.setOption('removeAfterRead', v).catch(() => undefined)} />
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Download on Wi-Fi only</Text>
            <Text style={styles.rowMeta}>{browse.canTellWifi ? 'Waits while the phone is on mobile data' : 'Works from the next app build (17)'}</Text>
          </View>
          <Switch value={prefs.wifiOnly} onValueChange={(v) => actions.setOption('wifiOnly', v).catch(() => undefined)} />
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Be patient with busy sites</Text>
            <Text style={styles.rowMeta}>Each page is tried 6 times instead of 3, with longer waits</Text>
          </View>
          <Switch value={prefs.patient} onValueChange={(v) => actions.setOption('patient', v).catch(() => undefined)} />
        </View>
        {actions.setParallel && (
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              tick();
              void actions.setParallel!(prefs.parallel === 1 ? 3 : prefs.parallel === 3 ? 5 : 1);
            }}
            accessibilityLabel={`Pages at once: ${prefs.parallel}. Tap to change`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Pages at once</Text>
              <Text style={styles.rowMeta}>Fewer is kinder to a slow site; more is faster</Text>
            </View>
            <Text style={styles.rowTitle}>{prefs.parallel}</Text>
          </TouchableOpacity>
        )}
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Update extensions by themselves</Text>
            <Text style={styles.rowMeta}>Once a day, when the app opens</Text>
          </View>
          <Switch value={prefs.autoUpdateExt} onValueChange={(v) => actions.setOption('autoUpdateExt', v).catch(() => undefined)} />
        </View>
      </View>
    </>
  );

  const installedIds = new Set(prefs.installed.map((i) => i.id));
  const extensionsTab = (
    <>
      <View style={styles.notice}>
        <Icon name="shield" size={18} color={p.rating} />
        <Text style={styles.noticeText}>
          Use only sources that have the right to share what they host. You are responsible for what you add. ReelVault comes with no such sites and doesn't check what a repo offers.
        </Text>
      </View>
      <View style={styles.buttonsRow}>
        <TouchableOpacity style={styles.pill} onPress={() => setForm('repo')}>
          <Icon name="plus" size={14} color="#fff" />
          <Text style={styles.pillText}>Add a repo</Text>
        </TouchableOpacity>
        {prefs.repos.length > 0 && (
          <TouchableOpacity
            style={styles.pillGhost}
            onPress={() =>
              run('Checking repos…', async () => {
                const failed = await actions.refreshRepos();
                setMessage(failed.length ? `Could not check ${failed.join(', ')}` : 'Repos are up to date');
              })
            }>
            <Icon name="sync" size={14} color={p.text} />
            <Text style={styles.pillGhostText}>Check for updates</Text>
          </TouchableOpacity>
        )}
      </View>
      {updates.length > 0 && <Text style={styles.updateText}>{updates.length === 1 ? '1 extension has an update' : `${updates.length} extensions have updates`}</Text>}
      {!prefs.repos.length && <Text style={styles.empty}>No repos yet. A repo is a link to a list of extensions made for ReelVault.</Text>}
      {prefs.repos.map((r) => (
        <View key={r.url} style={styles.group}>
          <View style={styles.groupHead}>
            <View style={{ flex: 1 }}>
              <Text style={styles.section}>{r.name}</Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {r.url}
              </Text>
            </View>
            <TouchableOpacity hitSlop={10} onPress={() => run('Removing…', () => actions.removeRepo(r.url), 'Repo removed')}>
              <Text style={styles.danger}>Remove</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.card}>
            {!r.extensions.length && <Text style={[styles.rowMeta, { padding: 14 }]}>This repo lists no extensions.</Text>}
            {r.extensions.map((e: RepoExtension) => {
              const installed = prefs.installed.find((i) => i.id === e.id);
              const update = installed && e.version > installed.version;
              const other = installedIds.has(e.id) && installed?.repoUrl !== r.url;
              return (
                <View key={e.id} style={styles.row}>
                  <Letter name={e.name} kind="extension" />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {e.name}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={2}>
                      {[e.lang.toUpperCase(), `v${e.version}`, e.nsfw ? '18+' : null, e.description].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  {installed && !other ? (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {update && (
                        <TouchableOpacity style={styles.smallBtn} onPress={() => run(`Updating ${e.name}…`, () => actions.install(r.url, e), `${e.name} updated`)}>
                          <Text style={styles.smallBtnText}>Update</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity style={styles.smallBtnGhost} onPress={() => run('Removing…', () => actions.uninstall(e.id), `${e.name} removed`)}>
                        <Text style={styles.danger}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.smallBtn} disabled={other} onPress={() => run(`Installing ${e.name}…`, () => actions.install(r.url, e), `${e.name} installed`)}>
                      <Text style={styles.smallBtnText}>{other ? 'From another repo' : 'Install'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </>
  );

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <View style={styles.bar}>
          <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close Browse">
            <Icon name="close" size={15} color={p.icon} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.title}>Browse</Text>
          {tab === 'sources' && (
            <TouchableOpacity style={styles.circle} onPress={() => reload(true)} accessibilityLabel="Reload sources">
              <Icon name="sync" size={15} color={p.icon} />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.tabs}>
          {(['sources', 'extensions'] as Tab[]).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabOn]}
              onPress={() => {
                tick();
                setTab(t);
                setMessage(null);
              }}>
              <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
                {t === 'sources' ? 'Sources' : `Extensions${updates.length ? ` · ${updates.length}` : ''}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {(busy || message) && (
          <View style={styles.status}>
            {busy && <ActivityIndicator size="small" color={p.textSecondary} />}
            <Text style={styles.statusText}>{busy ?? message}</Text>
          </View>
        )}
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          {tab === 'sources' ? sourcesTab : extensionsTab}
        </ScrollView>
      </View>

      {form === 'server' && (
        <ServerForm
          onCancel={() => setForm(null)}
          onSave={async (input) => {
            await actions.addServer(input);
            setForm(null);
            success();
            setMessage(`${input.name || 'Server'} added`);
          }}
        />
      )}
      {form === 'repo' && (
        <RepoForm
          onCancel={() => setForm(null)}
          onSave={async (url) => {
            await actions.addRepo(url);
            setForm(null);
            success();
            setMessage('Repo added. Install the extensions you want from it below.');
          }}
        />
      )}
      {form === 'languages' && <LanguagesForm value={prefs.languages} onSave={(codes) => actions.setLanguages(codes).catch(() => undefined)} onClose={() => setForm(null)} />}
      {removeServer?.serverId && (
        <OptionsSheet
          title={removeServer.title}
          options={[
            { label: 'Remove this server', danger: true, hint: 'Titles you added from it stay in your library', onPress: () => run('Removing…', () => actions.removeServer(removeServer.serverId!), 'Server removed') },
          ]}
          onClose={() => setRemoveServer(null)}
        />
      )}
      {open && (
        <SourceScreen
          source={open}
          initialOpenKey={initialOpenKey}
          browse={actions}
          libraryIdOf={libraryIdOf}
          onOpenInLibrary={(id) => {
            setOpenId(null);
            onOpenInLibrary(id);
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </Modal>
  );
}

/* ---------------------------------------------------------------- forms */

function FormFrame({ title, children, onCancel, onSave, saveLabel, disabled, saving }: { title: string; children: React.ReactNode; onCancel: () => void; onSave: () => void; saveLabel: string; disabled?: boolean; saving?: boolean }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onCancel}>
      <View style={[styles.screen, { paddingTop: 14 }]}>
        <View style={styles.bar}>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.cancel}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { fontSize: 17, textAlign: 'center' }]}>{title}</Text>
          <TouchableOpacity onPress={onSave} disabled={disabled || saving}>
            {saving ? <ActivityIndicator color={p.accent} /> : <Text style={[styles.save, (disabled || saving) && { opacity: 0.4 }]}>{saveLabel}</Text>}
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Field({ label, value, onChange, placeholder, secure, hint }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; secure?: boolean; hint?: string }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <View style={{ gap: 5 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={p.textMuted}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      {hint && <Text style={styles.rowMeta}>{hint}</Text>}
    </View>
  );
}

function ServerForm({ onCancel, onSave }: { onCancel: () => void; onSave: (i: { kind: ServerKind; name: string; url: string; user: string; password: string }) => Promise<void> }) {
  const styles = useStyles(makeStyles);
  const [kind, setKind] = useState<ServerKind>('opds');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormFrame
      title="Add your server"
      saveLabel="Add"
      disabled={!url.trim()}
      saving={saving}
      onCancel={onCancel}
      onSave={async () => {
        setSaving(true);
        setError(null);
        try {
          await onSave({ kind, name, url, user, password });
        } catch (e) {
          setError(err(e));
        } finally {
          setSaving(false);
        }
      }}>
      <View style={styles.kindRow}>
        {(
          [
            ['opds', 'Komga, Kavita, OPDS'],
            ['suwayomi', 'Suwayomi'],
          ] as [ServerKind, string][]
        ).map(([k, label]) => (
          <TouchableOpacity key={k} style={[styles.kind, kind === k && styles.kindOn]} onPress={() => setKind(k)}>
            <Text style={[styles.kindText, kind === k && styles.kindTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.rowMeta}>
        {kind === 'opds'
          ? 'Komga: the address of the server (it adds /opds/v1.2/catalog). Kavita: the OPDS link from its settings (with your API key). Other servers: their OPDS address.'
          : 'The address of your Suwayomi server, for example http://192.168.1.20:4567. The extensions you installed on it appear as sources. It has to be on (and the phone on the same Wi-Fi, unless you made it reachable from outside).'}
      </Text>
      <Field label="Address" value={url} onChange={setUrl} placeholder={kind === 'opds' ? 'http://192.168.1.20:25600' : 'http://192.168.1.20:4567'} />
      <Field label="Name" value={name} onChange={setName} placeholder="My PC" />
      <Field label="User name" value={user} onChange={setUser} placeholder="Leave empty if it has no login" />
      <Field label="Password" value={password} onChange={setPassword} placeholder="Kept in the iPhone's keychain" secure />
      {error && <Text style={styles.errorText}>{error}</Text>}
    </FormFrame>
  );
}

function RepoForm({ onCancel, onSave }: { onCancel: () => void; onSave: (url: string) => Promise<void> }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [url, setUrl] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormFrame
      title="Add a repo"
      saveLabel="Add"
      disabled={!agreed || !url.trim()}
      saving={saving}
      onCancel={onCancel}
      onSave={async () => {
        setSaving(true);
        setError(null);
        try {
          await onSave(url);
        } catch (e) {
          setError(err(e));
        } finally {
          setSaving(false);
        }
      }}>
      <View style={styles.warnBox}>
        <Icon name="shield" size={22} color={p.rating} />
        <Text style={styles.warnTitle}>Before you add a repo</Text>
        <Text style={styles.warnBody}>
          A repo is someone else's list of extensions. ReelVault doesn't check what they connect to.{'\n\n'}
          • Use only sources that have the right to share what they host: official publishers, your own server, or sites whose creators allow it.{'\n'}
          • Don't use extensions for sites that post manga or comics without the publisher's permission.{'\n'}
          • You are responsible for what you add and read.{'\n'}
          • An extension runs code on your iPhone. ReelVault only gives it the web sites it names, not your library or files, but add repos only from people you trust.
        </Text>
      </View>
      <TouchableOpacity style={styles.agree} onPress={() => setAgreed((x) => !x)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
        <View style={[styles.box, agreed && styles.boxOn]}>{agreed && <Icon name="check" size={12} color="#fff" weight="bold" />}</View>
        <Text style={styles.agreeText}>I understand and will only use sources I'm allowed to</Text>
      </TouchableOpacity>
      <Field label="Repo link" value={url} onChange={setUrl} placeholder="https://example.org/reelvault/index.json" hint="A link to its index.json, or a GitHub repo page with an index.json on its main branch." />
      {error && <Text style={styles.errorText}>{error}</Text>}
    </FormFrame>
  );
}

function LanguagesForm({ value, onSave, onClose }: { value: string[]; onSave: (codes: string[]) => void; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const [picked, setPicked] = useState<string[]>(value);
  return (
    <FormFrame
      title="Languages"
      saveLabel="Done"
      disabled={!picked.length}
      onCancel={onClose}
      onSave={() => {
        onSave(picked);
        onClose();
      }}>
      <Text style={styles.rowMeta}>Chapters in these languages show (MangaDex). The first one wins when a chapter is in several.</Text>
      <View style={styles.chipsWrap}>
        {LANGUAGES.map(([code, name]) => {
          const on = picked.includes(code);
          return (
            <TouchableOpacity key={code} style={[styles.kind, on && styles.kindOn]} onPress={() => setPicked((x) => (on ? x.filter((c) => c !== code) : [...x, code]))}>
              <Text style={[styles.kindText, on && styles.kindTextOn]}>
                {on ? `${picked.indexOf(code) + 1}. ` : ''}
                {name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </FormFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    circle: { width: 34, height: 34, borderRadius: 17, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    title: { flex: 1, color: p.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
    tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
    tab: { flex: 1, backgroundColor: p.elevated, borderRadius: 999, paddingVertical: 9, alignItems: 'center' },
    tabOn: { backgroundColor: p.text },
    tabText: { color: p.textSoft, fontSize: 14, fontWeight: '700' },
    tabTextOn: { color: p.bg },
    status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 6, backgroundColor: p.card, borderRadius: 12, padding: 10 },
    statusText: { flex: 1, color: p.text, fontSize: 13, lineHeight: 18 },
    group: { marginTop: 16, gap: 8 },
    groupHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    section: { color: p.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
    card: { backgroundColor: p.card, borderRadius: 14, overflow: 'hidden' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: p.separator },
    rowTitle: { color: p.text, fontSize: 16, fontWeight: '700' },
    rowMeta: { color: p.textSecondary, fontSize: 12, lineHeight: 16 },
    letter: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    letterText: { color: '#fff', fontSize: 17, fontWeight: '900' },
    badge: { color: p.textSecondary, fontSize: 11, fontWeight: '800', backgroundColor: p.elevated, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
    badgeWarn: { color: p.danger },
    warnText: { color: p.danger, fontSize: 13 },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14 },
    addText: { color: p.link, fontSize: 15, fontWeight: '700' },
    notice: { flexDirection: 'row', gap: 10, backgroundColor: p.card, borderRadius: 14, padding: 14, marginTop: 8 },
    noticeText: { flex: 1, color: p.textSoft, fontSize: 13, lineHeight: 19 },
    buttonsRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
    pillText: { color: '#fff', fontSize: 14, fontWeight: '800' },
    pillGhost: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
    pillGhostText: { color: p.text, fontSize: 14, fontWeight: '700' },
    updateText: { color: p.accent, fontSize: 13, fontWeight: '700', marginTop: 10 },
    empty: { color: p.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 16 },
    danger: { color: p.danger, fontSize: 14, fontWeight: '700' },
    smallBtn: { backgroundColor: p.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    smallBtnText: { color: '#fff', fontSize: 13, fontWeight: '800' },
    smallBtnGhost: { backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    cancel: { color: p.link, fontSize: 16 },
    save: { color: p.link, fontSize: 16, fontWeight: '800' },
    label: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    input: { color: p.text, fontSize: 16, backgroundColor: p.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11 },
    kindRow: { flexDirection: 'row', gap: 8 },
    kind: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    kindOn: { backgroundColor: p.text },
    kindText: { color: p.text, fontSize: 14, fontWeight: '700' },
    kindTextOn: { color: p.bg },
    chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    errorText: { color: p.danger, fontSize: 14, lineHeight: 20 },
    warnBox: { backgroundColor: p.card, borderRadius: 14, padding: 16, gap: 8 },
    warnTitle: { color: p.text, fontSize: 18, fontWeight: '800' },
    warnBody: { color: p.textSoft, fontSize: 14, lineHeight: 21 },
    agree: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    agreeText: { flex: 1, color: p.text, fontSize: 15, fontWeight: '600' },
    box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: p.textMuted, alignItems: 'center', justifyContent: 'center' },
    boxOn: { backgroundColor: p.accent, borderColor: p.accent },
  });
