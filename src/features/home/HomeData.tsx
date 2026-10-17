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
import { resolveScheme } from '@/features/vault/ui/logic';
import { paletteFor, withAccent, type Palette } from '@/features/vault/ui/theme';

type Home = {
  vault: ReturnType<typeof useVaultData>;
  simkl: ReturnType<typeof useSimklData>;
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
  const system = useColorScheme();
  const palette = withAccent(paletteFor(resolveScheme(vault.viewOptions.theme, system)), vault.viewOptions.accent);
  const router = useRouter();

  // A tapped notification jumps to that title's tab; the screen then opens it.
  useEffect(() => {
    if (simkl.openRequest) router.navigate(ROUTE_FOR[simkl.openRequest.type] as Href);
  }, [simkl.openRequest, router]);

  return <HomeContext.Provider value={{ vault, simkl, palette }}>{children}</HomeContext.Provider>;
}

export function useHome(): Home {
  const home = useContext(HomeContext);
  if (!home) throw new Error('useHome outside HomeDataProvider');
  return home;
}
