/**
 * The one copy of the app's data, shared by every tab. Each tab is its own
 * route, but the vault and Simkl data layers must exist once (one database
 * connection, one sync loop), so the tab layout mounts them here and the
 * routes read them with useHome().
 */

import { createContext, useContext, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { useSimklData } from '@/features/simkl/data';
import type { SimklType } from '@/features/simkl/ui/types';
import { useVaultData } from '@/features/vault/data';
import { useAudioData } from '@/features/vault/audio/audioData';
import { useMangaData } from '@/features/vault/manga/mangaData';
import { resolveScheme } from '@/features/vault/ui/logic';
import { themeFor, type Palette } from '@/features/vault/ui/theme';
import { setRotateEverywhere } from '@/features/vault/rotate';

type Home = {
  vault: ReturnType<typeof useVaultData>;
  simkl: ReturnType<typeof useSimklData>;
  /** The Audio section (in the Videos tab). */
  audio: ReturnType<typeof useAudioData>;
  /** The Manga section (in the Videos tab). */
  manga: ReturnType<typeof useMangaData>;
  palette: Palette;
};

const HomeContext = createContext<Home | null>(null);

export const ROUTE_FOR: Record<SimklType, string> = {
  movie: '/movies',
  show: '/shows',
  anime: '/anime',
};

export function HomeDataProvider({ children }: { children: React.ReactNode }) {
  const vault = useVaultData();
  const simkl = useSimklData();
  const audio = useAudioData();
  const manga = useMangaData();
  const system = useColorScheme();
  const palette = themeFor(resolveScheme(vault.viewOptions.theme, system), vault.viewOptions);
  const router = useRouter();

  // Settings → Personalise → Turn with the phone: the whole app, or only the player.
  useEffect(() => {
    setRotateEverywhere(vault.viewOptions.rotate);
  }, [vault.viewOptions.rotate]);

  // A tapped notification jumps to that title's tab; the screen then opens it.
  useEffect(() => {
    if (simkl.openRequest) router.navigate(ROUTE_FOR[simkl.openRequest.type] as Href);
  }, [simkl.openRequest, router]);

  return <HomeContext.Provider value={{ vault, simkl, audio, manga, palette }}>{children}</HomeContext.Provider>;
}

export function useHome(): Home {
  const home = useContext(HomeContext);
  if (!home) throw new Error('useHome outside HomeDataProvider');
  return home;
}
