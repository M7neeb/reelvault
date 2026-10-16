/**
 * The vault route. Deliberately thin: it wires the native data layer to the
 * presentational screen and owns nothing else.
 *
 * All the UI lives in `@/features/vault/ui/VaultScreen`, which takes plain props
 * and imports no native modules - so the same screen renders in a browser for
 * design checks (`/preview`) and on the phone.
 */

import { useVaultData } from '@/features/vault/data';
import VaultScreen from '@/features/vault/ui/VaultScreen';

export default function VaultRoute() {
  const vault = useVaultData();

  return (
    <VaultScreen
      items={vault.items}
      allTags={vault.allTags}
      tagMap={vault.tagMap}
      deletedItems={vault.deletedItems}
      duplicateGroups={vault.duplicateGroups}
      smartFilters={vault.smartFilters}
      viewOptions={vault.viewOptions}
      freeGb={vault.freeGb}
      busy={vault.busy}
      status={vault.status}
      actions={vault.actions}
    />
  );
}
