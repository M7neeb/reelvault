import { useMemo } from 'react';

import { friendlyName } from '../../names';
import type { UiAlbum, VaultActions, VaultItem } from '../types';
import RankModal from './RankModal';
import type { RankCandidate, RankGroup } from './rankTypes';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (ms: number) => {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

/** Where a round starts playing: a third in, so it isn't the black first second. */
const startOf = (durationMs: number | null) => (durationMs && durationMs >= 6000 ? Math.round(durationMs * 0.3) : 0);

/** Rank your videos: every video in the library, rated or not (private ones stay out). */
export default function VideoRank({
  items,
  albums,
  actions,
  enableVideo,
  onOpen,
  onClose,
  dev,
}: {
  items: VaultItem[];
  albums: UiAlbum[];
  actions: VaultActions;
  enableVideo: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  dev?: { step?: 'setup' | 'play' | 'results' };
}) {
  const live = useMemo(() => items.filter((v) => !v.deletedAt && !v.isPrivate), [items]);
  const candidates = useMemo<RankCandidate[]>(
    () =>
      live.map((v) => ({
        id: v.id,
        title: friendlyName(v),
        sub: day(v.createdAt),
        rating: v.rating > 0 ? v.rating : null,
        thumb: v.thumbSource,
        uri: v.uri,
        startMs: startOf(v.durationMs),
        durationMs: v.durationMs,
        groups: [...v.tagNames.map((t) => `tag:${t}`), ...v.albumIds.map((a) => `album:${a}`)],
      })),
    [live]
  );
  const groups = useMemo<RankGroup[]>(() => {
    const tags = new Map<string, number>();
    const inAlbum = new Map<number, number>();
    for (const v of live) {
      for (const t of v.tagNames) tags.set(t, (tags.get(t) ?? 0) + 1);
      for (const a of v.albumIds) inAlbum.set(a, (inAlbum.get(a) ?? 0) + 1);
    }
    const albumGroups = albums
      .filter((a) => !a.isPrivate && (inAlbum.get(a.id) ?? 0) >= 2)
      .sort((x, y) => (inAlbum.get(y.id) ?? 0) - (inAlbum.get(x.id) ?? 0))
      .slice(0, 8)
      .map((a) => ({ key: `album:${a.id}`, label: a.name }));
    const tagGroups = [...tags.entries()]
      .filter(([, n]) => n >= 2)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 10)
      .map(([t]) => ({ key: `tag:${t}`, label: `#${t}` }));
    return [...albumGroups, ...tagGroups];
  }, [live, albums]);

  return (
    <RankModal
      kind="video"
      items={candidates}
      groups={groups}
      load={() => actions.loadRank('video')}
      save={(json) => actions.saveRank('video', json)}
      onApply={async (changes) => {
        // One bulk edit per new rating, so each value is a single write.
        const byValue = new Map<number, string[]>();
        for (const c of changes) byValue.set(c.to, [...(byValue.get(c.to) ?? []), c.id]);
        for (const [rating, ids] of byValue) await actions.onRateMany(ids, rating);
      }}
      onOpen={onOpen}
      enableVideo={enableVideo}
      onClose={onClose}
      dev={dev}
    />
  );
}
