/** One Simkl tab (Movies, Shows or Anime): the shared Simkl data handed to SimklScreen. */

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SimklScreen from '@/features/simkl/ui/SimklScreen';
import type { SimklType } from '@/features/simkl/ui/types';
import { TAB_BAR_HEIGHT, TabBarSpace } from '@/features/vault/ui/chrome';
import { ThemeContext } from '@/features/vault/ui/theme';

import { useHome } from './HomeData';

export default function SimklRoute({ type }: { type: SimklType }) {
  const { simkl, vault, palette } = useHome();
  const insets = useSafeAreaInsets();
  return (
    <ThemeContext.Provider value={palette}>
      <TabBarSpace.Provider value={insets.bottom + TAB_BAR_HEIGHT}>
        <SimklScreen
          category={type}
          configured={simkl.configured}
          connected={simkl.connected}
          items={simkl.items}
          syncing={simkl.syncing}
          status={simkl.status}
          lastSyncAt={simkl.lastSyncAt}
          actions={simkl.actions}
          lists={simkl.lists}
          prefs={simkl.prefs}
          look={vault.viewOptions.look}
          openRequest={simkl.openRequest}
          onOpenHandled={simkl.clearOpenRequest}
        />
      </TabBarSpace.Provider>
    </ThemeContext.Provider>
  );
}
