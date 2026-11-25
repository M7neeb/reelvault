import { useMemo } from 'react';

import RankModal from '@/features/vault/ui/rank/RankModal';
import type { RankCandidate, RankGroup } from '@/features/vault/ui/rank/rankTypes';
import { STATUS_LABELS, type SimklItem, type SimklStatus, type SimklType } from '../logic';
import Poster from './Poster';
import type { SimklActions } from './types';

const RANKED: SimklStatus[] = ['completed', 'watching', 'hold', 'dropped'];

/** Rank your films, shows or anime: everything you've seen some of (Plan to Watch stays out). */
export default function SimklRank({
  type,
  items,
  actions,
  onOpen,
  onClose,
  dev,
}: {
  type: SimklType;
  items: SimklItem[];
  actions: SimklActions;
  onOpen: (item: SimklItem) => void;
  onClose: () => void;
  dev?: { step?: 'setup' | 'play' | 'results' };
}) {
  const seen = useMemo(() => items.filter((i) => i.type === type && RANKED.includes(i.status)), [items, type]);
  const byId = useMemo(() => new Map(seen.map((i) => [String(i.simklId), i])), [seen]);
  const candidates = useMemo<RankCandidate[]>(
    () =>
      seen.map((i) => ({
        id: String(i.simklId),
        title: i.title,
        sub: [i.year, i.status === 'completed' ? null : STATUS_LABELS[i.status]].filter(Boolean).join(' · ') || null,
        rating: i.rating && i.rating > 0 ? i.rating : null,
        thumb: null,
        groups: [`status:${i.status}`],
      })),
    [seen]
  );
  const groups = useMemo<RankGroup[]>(
    () =>
      RANKED.filter((s) => seen.filter((i) => i.status === s).length >= 2).map((s) => ({ key: `status:${s}`, label: STATUS_LABELS[s] })),
    [seen]
  );
  return (
    <RankModal
      kind={type}
      items={candidates}
      groups={groups}
      load={() => actions.loadRank(type)}
      save={(json) => actions.saveRank(type, json)}
      onApply={async (changes) => {
        // One at a time: each goes to Simkl too.
        for (const c of changes) {
          const item = byId.get(c.id);
          if (item) await actions.setRating(item, c.to);
        }
      }}
      onOpen={(id) => {
        const item = byId.get(id);
        if (item) onOpen(item);
      }}
      renderArt={(c, w, h) => <Poster path={byId.get(c.id)?.poster ?? null} title={c.title} width={w} height={h} radius={0} size={w > 120 ? '_m' : '_c'} />}
      enableVideo={false}
      onClose={onClose}
      dev={dev}
    />
  );
}
