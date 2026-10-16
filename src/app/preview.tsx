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
 * Open `/preview?view=<name>` to capture one surface; the names are the keys of
 * VIEWS below. Fixtures are neutral placeholders, never real videos.
 */

import { useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import {
  FIXTURE_DELETED,
  FIXTURE_DUPLICATE_GROUPS,
  FIXTURE_ITEMS,
  FIXTURE_SMART_FILTERS,
  FIXTURE_TAGS,
  FIXTURE_TAG_MAP,
  fixtureFrames,
  fixtureSearch,
} from '@/features/vault/ui/fixtures';
import VaultScreen from '@/features/vault/ui/VaultScreen';
import {
  DEFAULT_VIEW_OPTIONS,
  type VaultActions,
  type VaultScreenProps,
  type ViewOptions,
} from '@/features/vault/ui/types';

const noop = async () => {};

const first = FIXTURE_ITEMS[0].id;

/** Every surface the preview can open on first render. */
const VIEWS: Record<string, NonNullable<VaultScreenProps['devInitialState']>> = {
  grid: {},
  sidebar: { sidebarOpen: true },
  search: { searchOpen: true },
  viewer: { viewerId: first },
  info: { viewerId: first, infoOpen: true },
  menu: { viewerId: first, menuOpen: true },
  select: { selectMode: true },
  deleted: { filter: 'deleted' },
  'deleted-select': { filter: 'deleted', selectMode: true },
  duplicates: { filter: 'duplicates' },
  'view-options': { viewOptionsOpen: true },
  bulk: { selectMode: true, selectedIds: [first, FIXTURE_ITEMS[1].id], bulkOpen: true },
  'bulk-bar': { selectMode: true, selectedIds: [first, FIXTURE_ITEMS[1].id] },
  'smart-editor': { smartEditorOpen: true },
};

export default function PreviewRoute() {
  const { view } = useLocalSearchParams<{ view?: string }>();
  const [viewOptions, setViewOptions] = useState<ViewOptions>(DEFAULT_VIEW_OPTIONS);

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
      onRestoreMany: noop,
      onPurgeMany: noop,
      onRateMany: noop,
      onAddTagMany: noop,
      onSetStatus: noop,
      onViewOptionsChange: async (next) => setViewOptions(next),
      onSaveSmartFilter: noop,
      onDeleteSmartFilter: noop,
    }),
    []
  );

  const items = useMemo(() => {
    const list = [...FIXTURE_ITEMS];
    switch (viewOptions.sort) {
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
  }, [viewOptions.sort]);

  return (
    <VaultScreen
      items={items}
      allTags={FIXTURE_TAGS}
      tagMap={FIXTURE_TAG_MAP}
      deletedItems={FIXTURE_DELETED}
      duplicateGroups={FIXTURE_DUPLICATE_GROUPS}
      smartFilters={FIXTURE_SMART_FILTERS}
      viewOptions={viewOptions}
      // The owner's real situation: an almost full 128 GB iPhone.
      freeGb={2.1}
      busy={false}
      status=""
      actions={actions}
      enableVideo={false}
      devInitialState={VIEWS[view ?? 'grid'] ?? {}}
    />
  );
}
