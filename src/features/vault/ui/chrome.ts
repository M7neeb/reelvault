/**
 * How much room the floating iOS tab bar takes at the bottom of a screen,
 * counted from the bottom edge (home indicator included), so lists can scroll
 * their last row clear of it. A screen rendered on its own (no tab bar) gets 0.
 */

import { createContext, useContext } from 'react';

export const TabBarSpace = createContext(0);

export const useTabBarSpace = (): number => useContext(TabBarSpace);

/** The iOS 26 tab bar's height above the home-indicator inset. */
export const TAB_BAR_HEIGHT = 56;
