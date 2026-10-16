/** Which part of the library the grid is showing. Pure; no runtime imports. */

import type { SmartFilter, UiStatus } from './types';

export type Filter =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'rated' }
  | { kind: 'untagged' }
  | { kind: 'tag'; tag: string }
  | { kind: 'status'; status: UiStatus }
  | { kind: 'smart'; id: number }
  | { kind: 'duplicates' }
  | { kind: 'deleted' }
  | { kind: 'private' };

const STATUS_TITLES: Record<UiStatus, string> = {
  plantowatch: 'To watch',
  watching: 'Watching',
  completed: 'Watched',
  hold: 'On hold',
  dropped: 'Dropped',
};

export function filterLabel(f: Filter, smartFilters: SmartFilter[]): string {
  switch (f.kind) {
    case 'all':
      return 'All Videos';
    case 'favorites':
      return 'Favorites';
    case 'rated':
      return 'Rated';
    case 'untagged':
      return 'Untagged';
    case 'tag':
      return `# ${f.tag}`;
    case 'status':
      return STATUS_TITLES[f.status];
    case 'smart':
      return smartFilters.find((s) => s.id === f.id)?.name ?? 'Smart Filter';
    case 'duplicates':
      return 'Duplicates';
    case 'deleted':
      return 'Recently Deleted';
    case 'private':
      return 'Private';
  }
}

export const sameFilter = (a: Filter, b: Filter): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Views with their own list that searching and sorting chips don't apply to. */
export const isSpecial = (f: Filter): boolean => f.kind === 'deleted' || f.kind === 'duplicates';
