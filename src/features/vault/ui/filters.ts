/** Which part of the library the grid is showing. Pure; no runtime imports. */

import type { SmartFilter, SmartRule, UiAlbum, UiStatus } from './types';

export type Filter =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'rated' }
  | { kind: 'untagged' }
  | { kind: 'uncategorized' }
  | { kind: 'picks' }
  | { kind: 'rejects' }
  | { kind: 'tray' }
  | { kind: 'located' }
  | { kind: 'tag'; tag: string }
  | { kind: 'status'; status: UiStatus }
  | { kind: 'smart'; id: number }
  | { kind: 'album'; id: number }
  /** A one-off search with filters (not saved). */
  | { kind: 'rule'; rule: SmartRule }
  /** One calendar day, `YYYY-MM-DD`. */
  | { kind: 'day'; day: string }
  /** Videos filmed near this one. */
  | { kind: 'nearby'; id: string }
  | { kind: 'duplicates' }
  | { kind: 'similar' }
  | { kind: 'deleted' }
  | { kind: 'private' };

const STATUS_TITLES: Record<UiStatus, string> = {
  plantowatch: 'To watch',
  watching: 'Watching',
  completed: 'Watched',
  hold: 'On hold',
  dropped: 'Dropped',
};

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function filterLabel(f: Filter, smartFilters: SmartFilter[], albums: UiAlbum[] = []): string {
  switch (f.kind) {
    case 'all':
      return 'All Videos';
    case 'favorites':
      return 'Favorites';
    case 'rated':
      return 'Rated';
    case 'untagged':
      return 'Untagged';
    case 'uncategorized':
      return 'Uncategorized';
    case 'picks':
      return 'Picks';
    case 'rejects':
      return 'Rejects';
    case 'tray':
      return 'Tray';
    case 'located':
      return 'With Location';
    case 'tag':
      return `# ${f.tag}`;
    case 'status':
      return STATUS_TITLES[f.status];
    case 'smart':
      return smartFilters.find((s) => s.id === f.id)?.name ?? 'Smart Filter';
    case 'album':
      return albums.find((a) => a.id === f.id)?.name ?? 'Album';
    case 'rule':
      return 'Search';
    case 'day': {
      const [y, m, d] = f.day.split('-').map(Number);
      return `${d} ${MONTHS_SHORT[m - 1]} ${y}`;
    }
    case 'nearby':
      return 'Nearby';
    case 'duplicates':
      return 'Duplicates';
    case 'similar':
      return 'Similar Videos';
    case 'deleted':
      return 'Recently Deleted';
    case 'private':
      return 'Private';
  }
}

export const sameFilter = (a: Filter, b: Filter): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Views with their own list that searching and sorting chips don't apply to. */
export const isSpecial = (f: Filter): boolean =>
  f.kind === 'deleted' || f.kind === 'duplicates' || f.kind === 'similar';

/** Views that live inside the unlocked Private area. */
export const isPrivateView = (f: Filter, albums: UiAlbum[]): boolean =>
  f.kind === 'private' || (f.kind === 'album' && !!albums.find((a) => a.id === f.id)?.isPrivate);
