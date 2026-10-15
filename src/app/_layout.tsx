import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { getDb } from '@/db';

SplashScreen.preventAutoHideAsync();

/**
 * Root layout - a Stack, deliberately not the tab navigator.
 *
 * The tabs used to live here. With a NativeTabs root, *every* route is a tab
 * child, and the navigator swallows siblings: requesting `/preview` rendered the
 * index screen instead. Moving the tabs into the `(tabs)` group keeps them on
 * the same URLs (group names never appear in the path) while leaving room for
 * routes that are not tabs - `/preview` being the one that matters, since it is
 * how the UI gets rendered and checked in a browser.
 */
export default function RootLayout() {
  const colorScheme = useColorScheme();

  // Phase 1: open the database and run any pending migrations once, at startup.
  useEffect(() => {
    getDb().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[DB] init failed: ${msg}`);
    });
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="preview" />
      </Stack>
    </ThemeProvider>
  );
}
