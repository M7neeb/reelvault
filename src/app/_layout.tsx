import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { BarlowCondensed_600SemiBold, BarlowCondensed_700Bold, useFonts } from '@expo-google-fonts/barlow-condensed';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { getDb } from '@/db';
import { installLog } from '@/features/vault/errorLog';

installLog();

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
  // The display face for titles and numbers; the app never waits more than a moment for it.
  const [fontsLoaded] = useFonts({ BarlowCondensed_600SemiBold, BarlowCondensed_700Bold });
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 1500);
    return () => clearTimeout(t);
  }, []);

  // Phase 1: open the database and run any pending migrations once, at startup.
  useEffect(() => {
    getDb().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[DB] init failed: ${msg}`);
    });
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        {(fontsLoaded || waited) && (
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="preview" />
          </Stack>
        )}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
