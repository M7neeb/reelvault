/** Simkl account: sync now, stats, CSV export, sign out. Presentational only. */

import { useState } from 'react';
import { Text } from 'react-native';

import { confirmAction } from '@/features/vault/ui/confirm';
import { Chip, Section, SheetFrame, Wrap } from '@/features/vault/ui/sheets';
import { sheet, useStyles, type Palette } from '@/features/vault/ui/theme';

import { fmtAgo } from './time';
import type { SimklActions } from './types';

export function AccountSheet({
  lastSyncAt,
  syncing,
  count,
  actions,
  onStats,
  onClose,
}: {
  lastSyncAt: number | null;
  syncing: boolean;
  count: number;
  actions: SimklActions;
  onStats: () => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const [note, setNote] = useState('');

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
        </Wrap>
        <Text style={styles.hint}>
          ReelVault syncs when you open the app, at most every 15 minutes - pull down on a list to sync right away.
        </Text>
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
