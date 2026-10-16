/**
 * The map itself (Apple Maps through react-native-maps). The one native view
 * in ui/ besides expo-video; the browser preview uses VideoMap.web.tsx.
 */

import MapView, { Marker } from 'react-native-maps';

import { regionFor } from './logic';
import type { VaultItem } from './types';

export default function VideoMap({ items, onOpen }: { items: VaultItem[]; onOpen: (item: VaultItem) => void }) {
  const located = items.filter((v) => v.meta?.location);
  const region = regionFor(located.map((v) => v.meta!.location!));
  return (
    <MapView style={{ flex: 1 }} initialRegion={region ?? undefined} showsUserLocation={false}>
      {located.map((v) => (
        <Marker
          key={v.id}
          coordinate={{ latitude: v.meta!.location!.lat, longitude: v.meta!.location!.lon }}
          title={v.title ?? v.filename}
          description={new Date(v.createdAt).toLocaleDateString()}
          onCalloutPress={() => onOpen(v)}
        />
      ))}
    </MapView>
  );
}
