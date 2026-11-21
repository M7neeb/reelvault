/**
 * Simkl settings: sync, Stats and Review, import from IMDb / Letterboxd,
 * spoilers, episode ratings (OMDb key), notifications, rewatches on Simkl, CSV and calendar export, sign
 * out. Presentational only.
 */

import { useEffect, useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';

import { confirmAction } from '@/features/vault/ui/confirm';
import { Row, Rows, SheetFrame } from '@/features/vault/ui/sheets';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { DELAYS } from '../reminders';
import { fmtAgo } from './time';
import type { ReminderSettings, SimklActions, SimklPlan, SimklPrefs } from './types';

export function AccountSheet({
  lastSyncAt,
  syncing,
  count,
  actions,
  prefs,
  onStats,
  onReview,
  onImport,
  onClose,
}: {
  lastSyncAt: number | null;
  syncing: boolean;
  count: number;
  actions: SimklActions;
  prefs: SimklPrefs;
  onStats: () => void;
  onReview: () => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const [note, setNote] = useState('');
  const [reminders, setReminders] = useState<ReminderSettings | null>(null);
  const [rewatch, setRewatch] = useState<{ on: boolean; plan: SimklPlan } | null>(null);
  const [spoilers, setSpoilers] = useState(prefs.hideSpoilers);
  const p = usePalette();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyText, setKeyText] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);

  useEffect(() => {
    actions.getReminders().then(setReminders).catch(() => undefined);
    actions.getRewatchSync().then(setRewatch).catch(() => undefined);
    actions.hasOmdbKey().then(setHasKey).catch(() => setHasKey(false));
  }, [actions]);

  function saveReminders(next: ReminderSettings) {
    setReminders(next);
    actions
      .setReminders(next)
      .then((ok) => {
        if (!ok) {
          setReminders({ ...next, enabled: false });
          setNote('Notifications are off for ReelVault in iPhone Settings → Notifications.');
        } else setNote(next.enabled ? 'Reminders scheduled' : 'Reminders off');
      })
      .catch((e) => setNote(`Not saved: ${String(e?.message ?? e)}`));
  }

  function saveKey(text: string) {
    setKeyBusy(true);
    actions
      .saveOmdbKey(text)
      .then((problem) => {
        if (problem) return setNote(problem);
        setHasKey(text.trim() !== '');
        setKeyText('');
        setNote(text.trim() ? 'IMDb ratings on: open the episodes of a show to see them' : 'OMDb key removed: episodes show TVmaze ratings');
      })
      .catch((e) => setNote(`Not saved: ${String(e?.message ?? e)}`))
      .finally(() => setKeyBusy(false));
  }

  const status = syncing ? 'Syncing…' : lastSyncAt ? `Synced ${fmtAgo(new Date(lastSyncAt).toISOString())}` : 'Not synced yet';
  const delay = reminders ? (DELAYS.find((d) => d.minutes === reminders.delayMinutes) ?? DELAYS[0]) : DELAYS[0];

  return (
    <SheetFrame title="Simkl" onClose={onClose} action={{ label: 'Done', onPress: onClose }}>
      {!!note && <Text style={styles.note}>{note}</Text>}
      <Rows label="Library" footer="ReelVault syncs when you open the app, at most every 15 minutes. Pull down on a list to sync right away.">
        <Row icon="sync" tint="#30D158" title="Sync now" sub={`${count} titles on this phone · ${status}`} onPress={() => void actions.sync(true)} />
        <Row icon="stats" tint="#0A84FF" title="Stats" onPress={onStats} />
        <Row icon="calendar" tint="#FF9F0A" title="Week, month and year review" onPress={onReview} />
      </Rows>

      <Rows label="Bring your history" footer="Your ratings, watched films and watchlists, from their CSV exports.">
        <Row icon="import" tint="#5E5CE6" title="Import from IMDb or Letterboxd" onPress={onImport} />
      </Rows>

      <Rows label="Spoilers" footer={'Episode lists and Up Next show only "Episode 5" and a blurred still until you have seen it.'}>
        <Row
          icon="spoiler"
          tint="#FF375F"
          title="Hide unwatched episodes"
          sub="Titles and pictures"
          toggle={{
            value: spoilers,
            onChange: (on) => {
              setSpoilers(on);
              void actions.setPrefs({ ...prefs, hideSpoilers: on });
            },
          }}
        />
      </Rows>

      <Rows
        label="Episode ratings"
        footer={
          hasKey === false
            ? 'On the OMDb page choose FREE, enter your email and open the link in the email they send. The key is in that email.'
            : 'Your OMDb key stays on this phone.'
        }>
        <Row icon="star" tint="#FFD60A" title={hasKey ? 'IMDb ratings' : 'TVmaze ratings'} sub={hasKey === null ? undefined : hasKey ? 'Your OMDb key is saved' : 'Add a free OMDb key for IMDb ratings'} />
        {hasKey === false && (
          <View style={styles.keyRow}>
            <TextInput
              style={styles.input}
              value={keyText}
              onChangeText={setKeyText}
              placeholder="OMDb key, for example 1a2b3c4d"
              placeholderTextColor={p.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardAppearance={p.scheme}
              returnKeyType="done"
              onSubmitEditing={() => keyText.trim() && saveKey(keyText)}
              accessibilityLabel="OMDb key"
            />
          </View>
        )}
        {hasKey === false && !!keyText.trim() && <Row title={keyBusy ? 'Checking…' : 'Save key'} onPress={() => !keyBusy && saveKey(keyText)} />}
        {hasKey === false && <Row icon="globe" tint="#8E8E93" title="Get a free key" sub="omdbapi.com" onPress={() => void Linking.openURL('https://www.omdbapi.com/apikey.aspx')} />}
        {hasKey && (
          <Row
            title="Remove OMDb key"
            danger
            onPress={() => confirmAction('Remove the OMDb key?', 'Episodes then show TVmaze ratings instead of IMDb.', () => saveKey(''), { label: 'Remove', destructive: true })}
          />
        )}
      </Rows>

      {reminders && (
        <Rows
          label="Notifications"
          footer="A notification when an episode of something you watch, put on hold or plan to watch comes out, and when a movie on your Plan to Watch list is released. Planned for the next three weeks, refreshed at every sync.">
          <Row icon="bell" tint="#FF453A" title="New episodes and releases" toggle={{ value: reminders.enabled, onChange: (enabled) => saveReminders({ ...reminders, enabled }) }} />
          {reminders.enabled && (
            <Row
              icon="clock"
              tint="#8E8E93"
              title="When"
              value={delay.label}
              onPress={() => saveReminders({ ...reminders, delayMinutes: DELAYS[(DELAYS.indexOf(delay) + 1) % DELAYS.length].minutes })}
            />
          )}
          {reminders.enabled && <Row icon="tv" tint="#0A84FF" title="Shows" toggle={{ value: reminders.types.show, onChange: (show) => saveReminders({ ...reminders, types: { ...reminders.types, show } }) }} />}
          {reminders.enabled && <Row icon="anime" tint="#BF5AF2" title="Anime" toggle={{ value: reminders.types.anime, onChange: (anime) => saveReminders({ ...reminders, types: { ...reminders.types, anime } }) }} />}
          {reminders.enabled && <Row icon="movie" tint="#FF9F0A" title="Movies" toggle={{ value: reminders.types.movie, onChange: (movie) => saveReminders({ ...reminders, types: { ...reminders.types, movie } }) }} />}
        </Rows>
      )}

      {rewatch && (
        <Rows
          label="Rewatches"
          footer={`Rewatches you log are always kept in ReelVault and count in Stats and the review. Simkl keeps them only for PRO and VIP; your plan: ${rewatch.plan === 'unknown' ? 'not checked yet' : rewatch.plan.toUpperCase()}.`}>
          <Row
            icon="rewatch"
            tint="#64D2FF"
            title="Also save them on Simkl"
            toggle={{
              value: rewatch.on,
              onChange: (on) =>
                actions
                  .setRewatchSync(on)
                  .then((r) => {
                    setRewatch({ on: on && r.ok, plan: r.plan });
                    if (on && !r.ok) setNote('Saving rewatches on Simkl needs Simkl PRO or VIP (simkl.com/vip).');
                  })
                  .catch((e) => setNote(String(e?.message ?? e))),
            }}
          />
        </Rows>
      )}

      <Rows label="Export" footer="The CSV has title, status, your rating, episodes, IMDb rating and the Simkl link. The calendar file has the next two months of what you follow; no calendar permission needed.">
        <Row
          icon="share"
          tint="#30D158"
          title="Export library as CSV"
          onPress={() =>
            actions
              .exportCsv()
              .then(() => setNote('Exported'))
              .catch((e) => setNote(`Export failed: ${String(e?.message ?? e)}`))
          }
        />
        <Row
          icon="calendar"
          tint="#FF453A"
          title="Add upcoming episodes to Calendar"
          onPress={() =>
            actions
              .exportCalendar()
              .then((n) => setNote(n ? `${n} dates ready. Tap Add All on the next screen.` : 'Nothing coming up in the next two months'))
              .catch((e) => setNote(`Calendar export failed: ${String(e?.message ?? e)}`))
          }
        />
      </Rows>

      <Rows label="Account">
        <Row
          title="Sign out of Simkl"
          danger
          onPress={() =>
            confirmAction(
              'Sign out of Simkl?',
              'Your Simkl list is removed from this phone. Nothing changes on Simkl itself; sign in again any time.',
              () => {
                void actions.disconnect().then(onClose);
              },
              { label: 'Sign out', destructive: true }
            )
          }
        />
      </Rows>
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    note: { color: p.link, fontSize: 13, fontWeight: '600' },
    keyRow: { paddingHorizontal: 14, paddingVertical: 10 },
    input: { backgroundColor: p.circle, color: p.text, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  });
