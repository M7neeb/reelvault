/**
 * The native iOS tab bar (Liquid Glass on iOS 26): Videos, Movies, Shows,
 * Anime, and Search as the separate round search tab. It shrinks while you
 * scroll down a list and comes back when you scroll up.
 */

import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { useHome } from '@/features/home/HomeData';

export default function AppTabs() {
  const { palette: p, simkl } = useHome();
  const due = (type: 'show' | 'anime') =>
    simkl.items.filter((i) => i.type === type && i.status === 'watching' && !!i.nextToWatch).length;
  const shows = due('show');
  const anime = due('anime');

  return (
    <NativeTabs minimizeBehavior="onScrollDown" tintColor={p.accent} iconColor={p.textSecondary}>
      <NativeTabs.Trigger name="index" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Videos</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'film.stack', selected: 'film.stack.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="movies" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Movies</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'popcorn', selected: 'popcorn.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="shows" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Shows</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'tv', selected: 'tv.fill' }} />
        <NativeTabs.Trigger.Badge hidden={shows === 0}>{String(Math.min(shows, 99))}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="anime" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Anime</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sparkles" />
        <NativeTabs.Trigger.Badge hidden={anime === 0}>{String(Math.min(anime, 99))}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="search" role="search" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
