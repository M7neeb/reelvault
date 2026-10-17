/**
 * Simkl settings: sync, Stats and Review, notifications, rewatches on Simkl,
 * CSV export, sign out. Presentational only.
 */

import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { confirmAction } from '@/features/vault/ui/confirm';
import { Chip, Section, SheetFrame, ToggleRow, Wrap } from '@/features/vault/ui/sheets';
import { sheet, useStyles, type Palette } from '@/features/vault/ui/theme';

import { DELAYS } from '../reminders';
import { fmtAgo } from './time';
import type { ReminderSettings, SimklActions, SimklPlan } from './types';

export function AccountSheet({
  lastSyncAt,
  syncing,
  count,
  actions,
  onStats,
  onReview,
  onClose,
}: {
  lastSyncAt: number | null;
  syncing: boolean;
  count: number;
  actions: SimklActions;
  onStats: () => void;
  onReview: () => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const [note, setNote] = useState('');
  const [reminders, setReminders] = useState<ReminderSettings | null>(null);
  const [rewatch, setRewatch] = useState<{ on: boolean; plan: SimklPlan } | null>(null);

  useEffect(() => {
    actions.getReminders().then(setReminders).catch(() => undefined);
    actions.getRewatchSync().then(setRewatch).catch(() => undefined);
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

  return (
    <SheetFrame title="Simkl" onClose={onClose} action={{ label: 'Done', onPress: onClose }}>
      {!!note && <Text style={styles.note}>{note}</Text>}
      <Section label="Library">
        <Text style={styles.body}>
          {count} titles on this phone ·{' '}
          {syncing ? 'syncing…' : lastSyncAt ? `synced ${fmtAgo(new Date(lastSyncAt).toISOString())}` : 'not synced yet'}
        </Text>
        <Wrap>
          <Chip label="Sync now" onPress={() => void actions.sync(true)} />
          <Chip label="Stats" onPress={onStats} />
          <Chip label="Week / month / year review" onPress={onReview} />
        </Wrap>
        <Text style={styles.hint}>
          ReelVault syncs when you open the app, at most every 15 minutes - pull down on a list to sync right away.
        </Text>
      </Section>

      <Section label="Notifications">
        {reminders && (
          <>
            <ToggleRow
              label="New episodes and releases"
              value={reminders.enabled}
              onChange={(enabled) => saveReminders({ ...reminders, enabled })}
            />
            {reminders.enabled && (
              <>
                <Wrap>
                  {DELAYS.map((d) => (
                    <Chip
                      key={d.minutes}
                      label={d.label}
                      on={reminders.delayMinutes === d.minutes}
                      onPress={() => saveReminders({ ...reminders, delayMinutes: d.minutes })}
                    />
                  ))}
                </Wrap>
                <Wrap>
                  <Chip label="Shows" on={reminders.types.show} onPress={() => saveReminders({ ...reminders, types: { ...reminders.types, show: !reminders.types.show } })} />
                  <Chip label="Anime" on={reminders.types.anime} onPress={() => saveReminders({ ...reminders, types: { ...reminders.types, anime: !reminders.types.anime } })} />
                  <Chip label="Movies" on={reminders.types.movie} onPress={() => saveReminders({ ...reminders, types: { ...reminders.types, movie: !reminders.types.movie } })} />
                </Wrap>
              </>
            )}
            <Text style={styles.hint}>
              A notification when an episode of something you watch, put on hold or plan to watch comes out, and when a movie on
              your Plan to Watch list is released. Planned on the phone for the next three weeks, refreshed at every sync.
            </Text>
          </>
        )}
      </Section>

      <Section label="Rewatches">
        <Text style={styles.body}>
          Rewatches you log are always kept in ReelVault and count in Stats and the review.
        </Text>
        {rewatch && (
          <>
            <ToggleRow
              label="Also save them on Simkl"
              value={rewatch.on}
              onChange={(on) =>
                actions
                  .setRewatchSync(on)
                  .then((r) => {
                    setRewatch({ on: on && r.ok, plan: r.plan });
                    if (on && !r.ok) setNote('Saving rewatches on Simkl needs Simkl PRO or VIP (simkl.com/vip).');
                  })
                  .catch((e) => setNote(String(e?.message ?? e)))
              }
            />
            <Text style={styles.hint}>
              Your Simkl plan: {rewatch.plan === 'unknown' ? 'not checked yet' : rewatch.plan.toUpperCase()}. Simkl keeps rewatches
              only for PRO and VIP; on a free account they stay in ReelVault.
            </Text>
          </>
        )}
      </Section>

      <Section label="Export">
        <Chip
          label="Export library as CSV…"
          onPress={() =>
            actions
              .exportCsv()
              .then(() => setNote('Exported'))
              .catch((e) => setNote(`Export failed: ${String(e?.message ?? e)}`))
          }
        />
        <Text style={styles.hint}>Title, status, your rating, episodes, IMDb rating and the Simkl link - save it in Files.</Text>
      </Section>

      <Section label="Account">
        <Chip
          label="Sign out of Simkl"
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
      </Section>
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    body: { color: p.textSoft, fontSize: 14 },
    hint: { color: p.textSecondary, fontSize: 12 },
    note: { color: p.link, fontSize: 13, fontWeight: '600' },
  });
