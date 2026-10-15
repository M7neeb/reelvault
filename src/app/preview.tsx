/**
 * Design preview - the render loop.
 *
 * Renders the REAL vault UI (`@/features/vault/ui/VaultScreen`) against fixture
 * data, with no database and no native modules. It exists so the layout can be
 * built in a browser: `npx expo export -p web`, serve `dist/`, screenshot at
 * phone dimensions, look, fix, repeat.
 *
 * Before this existed the UI could only be seen by loading it on a physical
 * iPhone, which meant it was written blind.
 *
 * Open `/preview?view=grid|sidebar|search|viewer` to capture each surface.
 * Fixtures are neutral placeholders, never real videos.
 */

import { useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import {
  FIXTURE_ITEMS,
  FIXTURE_TAGS,
  FIXTURE_TAG_MAP,
  fixtureFrames,
  fixtureSearch,
} from '@/features/vault/ui/fixtures';
import VaultScreen from '@/features/vault/ui/VaultScreen';
import type { VaultActions, VaultSort } from '@/features/vault/ui/types';

const noop = async () => {};

export default function PreviewRoute() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  const [sort, setSort] = useState<VaultSort>('recent');

  const actions = useMemo<VaultActions>(
    () => ({
      onImport: () => {},
      search: async (q) => fixtureSearch(q),
      loadTags: async (id) => {
        const names = FIXTURE_ITEMS.find((i) => i.id === id)?.tagNames ?? [];
        return FIXTURE_TAGS.filter((t) => names.includes(t.name));
      },
      loadFrames: async (item) => fixtureFrames(item),
      onRate: noop,
      onAddTag: noop,
      onRemoveTag: noop,
      onDeleteOne: noop,
      onDeleteMany: noop,
    }),
    []
  );

  const items = useMemo(() => {
    const list = [...FIXTURE_ITEMS];
    switch (sort) {
      case 'oldest':
        return list.sort((a, b) => a.importedAt - b.importedAt);
      case 'rating':
        return list.sort((a, b) => b.rating - a.rating);
      case 'name':
        return list.sort((a, b) => a.filename.localeCompare(b.filename));
      case 'size':
        return list.sort((a, b) => b.sizeBytes - a.sizeBytes);
      default:
        return list.sort((a, b) => b.importedAt - a.importedAt);
    }
  }, [sort]);

  // Whatever surface the URL asked for, opened on first render.
  const initial =
    view === 'sidebar'
      ? { sidebarOpen: true }
      : view === 'search'
        ? { searchOpen: true }
        : view === 'viewer'
          ? { viewerId: FIXTURE_ITEMS[0].id }
          : view === 'info'
            ? { viewerId: FIXTURE_ITEMS[0].id, infoOpen: true }
            : view === 'menu'
              ? { viewerId: FIXTURE_ITEMS[0].id, menuOpen: true }
              : view === 'select'
                ? { selectMode: true }
                : {};

  return (
    <VaultScreen
      items={items}
      allTags={FIXTURE_TAGS}
      tagMap={FIXTURE_TAG_MAP}
      freeGb={42.5}
      busy={false}
      status=""
      sort={sort}
      onSortChange={setSort}
      actions={actions}
      enableVideo={false}
      devInitialState={initial}
    />
  );
}
