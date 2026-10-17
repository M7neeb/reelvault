/**
 * The home route: your own videos, or Movies / Shows / Anime from Simkl.
 * Deliberately thin: it wires the native data layers to the presentational
 * screens and owns nothing but which category is showing.
 *
 * All the UI lives in `@/features/vault/ui` and `@/features/simkl/ui`, which
 * take plain props and import no native modules - so the same screens render
 * in a browser for design checks (`/preview`) and on the phone.
 */

import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

import { useSimklData } from '@/features/simkl/data';
import CategoryBar from '@/features/simkl/ui/CategoryBar';
import SimklScreen from '@/features/simkl/ui/SimklScreen';
import type { Category } from '@/features/simkl/ui/types';
import { useVaultData } from '@/features/vault/data';
import { resolveScheme } from '@/features/vault/ui/logic';
import { paletteFor, ThemeContext } from '@/features/vault/ui/theme';
import VaultScreen from '@/features/vault/ui/VaultScreen';

export default function HomeRoute() {
  const vault = useVaultData();
  const simkl = useSimklData();
  const [category, setCategory] = useState<Category>('videos');
  // A tapped notification switches to its category; SimklScreen then opens the title.
  useEffect(() => {
    if (simkl.openRequest) setCategory(simkl.openRequest.type);
  }, [simkl.openRequest]);
  const system = useColorScheme();
  const palette = paletteFor(resolveScheme(vault.viewOptions.theme, system));

  const bar = (
    <ThemeContext.Provider value={palette}>
      <CategoryBar value={category} onChange={setCategory} />
    </ThemeContext.Provider>
  );

  if (category !== 'videos') {
    return (
      <ThemeContext.Provider value={palette}>
        <SimklScreen
          category={category}
          categoryBar={bar}
          configured={simkl.configured}
          connected={simkl.connected}
          items={simkl.items}
          syncing={simkl.syncing}
          status={simkl.status}
          lastSyncAt={simkl.lastSyncAt}
          actions={simkl.actions}
          openRequest={simkl.openRequest}
          onOpenHandled={simkl.clearOpenRequest}
        />
      </ThemeContext.Provider>
    );
  }

  return (
    <VaultScreen
      categoryBar={bar}
      items={vault.items}
      allTags={vault.allTags}
      tagMap={vault.tagMap}
      deletedItems={vault.deletedItems}
      duplicateGroups={vault.duplicateGroups}
      smartFilters={vault.smartFilters}
      albums={vault.albums}
      folders={vault.folders}
      viewOptions={vault.viewOptions}
      freeGb={vault.freeGb}
      busy={vault.busy}
      status={vault.status}
      actions={vault.actions}
    />
  );
}
