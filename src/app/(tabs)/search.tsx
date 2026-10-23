/**
 * The Search tab: your whole library (videos, audio, books, manga, the
 * Simkl titles you follow) as you type, then Simkl search and trending.
 * Picking something of your own jumps to the Videos tab and opens it there.
 * Before you type: recent searches, Jump back in and this week's numbers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { findEverything, jumpBackIn, rememberSearch, weekSummary, type FindInput, type WeekSummary } from '@/features/home/everything';
import { useHome } from '@/features/home/HomeData';
import type { LocalSearch } from '@/features/simkl/ui/EverythingParts';
import SearchScreen from '@/features/simkl/ui/SearchScreen';
import { pushJump } from '@/features/vault/jump';
import { getSetting, setSetting } from '@/features/vault/library';
import { TAB_BAR_HEIGHT, TabBarSpace } from '@/features/vault/ui/chrome';
import { SideSafe } from '@/features/vault/ui/screen';
import { ThemeContext } from '@/features/vault/ui/theme';
import { resumeSavedAt } from '@/features/vault/watching';

const RECENT_KEY = 'search.recent';

export default function SearchRoute() {
  const { vault, simkl, audio, manga, palette } = useHome();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Recent searches, kept in the settings table.
  const [recent, setRecent] = useState<string[]>([]);
  const recentRef = useRef<string[]>([]);
  useEffect(() => {
    getSetting(RECENT_KEY)
      .then((v) => {
        const list = v ? (JSON.parse(v) as unknown) : [];
        if (Array.isArray(list)) {
          recentRef.current = list.filter((x): x is string => typeof x === 'string');
          setRecent(recentRef.current);
        }
      })
      .catch(() => undefined);
  }, []);
  const saveRecent = useCallback((next: string[]) => {
    if (next === recentRef.current) return;
    recentRef.current = next;
    setRecent(next);
    setSetting(RECENT_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  // This week across every section, worked out again each time you open the tab.
  const [week, setWeek] = useState<WeekSummary | null>(null);
  const loadWeek = useCallback(() => {
    let live = true;
    (async () => {
      const shown = new Set(vault.items.filter((v) => !v.isPrivate).map((v) => v.id));
      const privateAudio = new Set(audio.items.filter((a) => a.isPrivate).map((a) => a.id));
      const [videoPlays, audioPlays, sk] = await Promise.all([
        vault.actions.loadPlays().catch(() => []),
        audio.actions.loadPlays().catch(() => []),
        simkl.connected ? simkl.bridge.insights().catch(() => null) : Promise.resolve(null),
      ]);
      if (!live) return;
      setWeek(
        weekSummary(
          {
            videoPlays: videoPlays.filter((x) => shown.has(x.videoId)),
            audioPlays: audioPlays.filter((x) => !privateAudio.has(x.itemId)),
            chapterTimes: manga.items.filter((m) => !m.isPrivate && !m.deletedAt).flatMap((m) => m.chapters.map((c) => c.readAt).filter((t): t is number => t !== null)),
            watches: (sk?.events ?? []).map((e) => ({ at: e.at, minutes: e.minutes, type: e.type })),
          },
          Date.now()
        )
      );
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [vault.items, vault.actions, audio.items, audio.actions, manga.items, simkl.connected, simkl.bridge]);
  useFocusEffect(loadWeek);

  const local = useMemo<LocalSearch>(() => {
    const input: FindInput = { videos: vault.items, audio: audio.items, manga: manga.items, titles: simkl.items };
    const videoThumb = new Map(vault.items.map((v) => [v.id, v.thumbSource]));
    const audioThumb = new Map(audio.items.map((a) => [a.id, a.coverSource]));
    const mangaThumb = new Map(manga.items.map((m) => [m.id, m.coverSource]));
    const posters = new Map(simkl.items.map((t) => [t.simklId, t.poster]));
    const resume = [...vault.resume].map(([id, ms]) => ({ id, ms, at: resumeSavedAt(id) }));
    return {
      find: (q) => findEverything(q, input),
      jump: jumpBackIn({ ...input, resume }),
      thumb: (kind, id) => (kind === 'video' ? videoThumb.get(id) : kind === 'manga' ? mangaThumb.get(id) : audioThumb.get(id)) ?? null,
      poster: (simklId) => posters.get(simklId) ?? null,
      open: (kind, id, resume) => {
        router.navigate('/' as Href);
        if (kind === 'video') pushJump({ kind: 'video', id });
        else if (kind === 'manga') pushJump({ kind: 'manga', id, read: resume });
        else pushJump({ kind: 'audio', id, play: resume });
      },
      week,
      recent,
      remember: (q) => saveRecent(rememberSearch(recentRef.current, q)),
      clearRecent: () => saveRecent([]),
    };
  }, [vault.items, vault.resume, audio.items, manga.items, simkl.items, router, week, recent, saveRecent]);

  return (
    <ThemeContext.Provider value={palette}>
      <SideSafe>
        <TabBarSpace.Provider value={insets.bottom + TAB_BAR_HEIGHT}>
          <SearchScreen connected={simkl.connected} items={simkl.items} lists={simkl.lists} prefs={simkl.prefs} actions={simkl.actions} local={local} />
        </TabBarSpace.Provider>
      </SideSafe>
    </ThemeContext.Provider>
  );
}
