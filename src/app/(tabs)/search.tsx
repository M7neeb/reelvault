/** The Search tab: Simkl search and trending, with the shared Simkl data. */

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useHome } from '@/features/home/HomeData';
import SearchScreen from '@/features/simkl/ui/SearchScreen';
import { TAB_BAR_HEIGHT, TabBarSpace } from '@/features/vault/ui/chrome';
import { SideSafe } from '@/features/vault/ui/screen';
import { ThemeContext } from '@/features/vault/ui/theme';

export default function SearchRoute() {
  const { simkl, palette } = useHome();
  const insets = useSafeAreaInsets();
  return (
    <ThemeContext.Provider value={palette}>
      <SideSafe>
        <TabBarSpace.Provider value={insets.bottom + TAB_BAR_HEIGHT}>
          <SearchScreen connected={simkl.connected} items={simkl.items} lists={simkl.lists} prefs={simkl.prefs} actions={simkl.actions} />
        </TabBarSpace.Provider>
      </SideSafe>
    </ThemeContext.Provider>
  );
}
