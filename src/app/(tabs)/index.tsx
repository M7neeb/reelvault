/**
 * The Videos tab: your own video library. Deliberately thin: it hands the
 * shared vault data (see features/home/HomeData) to the presentational screen.
 *
 * All the UI lives in `@/features/vault/ui` and `@/features/simkl/ui`, which
 * take plain props and import no native modules - so the same screens render
 * in a browser for design checks (`/preview`) and on the phone.
 */

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useHome } from '@/features/home/HomeData';
import { TAB_BAR_HEIGHT, TabBarSpace } from '@/features/vault/ui/chrome';
import { SideSafe } from '@/features/vault/ui/screen';
import { ThemeContext } from '@/features/vault/ui/theme';
import VaultScreen from '@/features/vault/ui/VaultScreen';
import { AudioPlaybackProvider } from '@/features/vault/ui/audio/playback';

export default function VideosRoute() {
  const { vault, simkl, audio, manga, palette } = useHome();
  const insets = useSafeAreaInsets();
  return (
    <ThemeContext.Provider value={palette}>
    <SideSafe>
    <TabBarSpace.Provider value={insets.bottom + TAB_BAR_HEIGHT}>
    <AudioPlaybackProvider items={audio.items} actions={audio.actions} rewind={audio.prefs?.rewind ?? 1}>
      <VaultScreen
        audio={audio}
        manga={manga}
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
        duplicateAsk={vault.duplicateAsk}
        simkl={simkl.bridge}
        resume={vault.resume}
        prefs={vault.prefs}
        wrappedRequest={vault.wrappedRequest}
        onWrappedHandled={vault.clearWrappedRequest}
        openRequest={vault.openRequest}
        onOpenRequestHandled={vault.clearOpenRequest}
        overview={{ kept: vault.kept, series: vault.series, members: vault.members }}
      />
    </AudioPlaybackProvider>
    </TabBarSpace.Provider>
    </SideSafe>
    </ThemeContext.Provider>
  );
}
