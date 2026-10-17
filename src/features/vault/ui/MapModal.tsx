/** HashPhotos' Places map: every video that knows where it was filmed, as a pin. */

import { Modal, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { plural } from './confirm';
import { sheet, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';
import VideoMap from './VideoMap';
import Glyph from './Glyph';

export function MapModal({
  items,
  onOpen,
  onClose,
}: {
  items: VaultItem[];
  /** Tapping a pin's bubble: play that video. */
  onOpen: (item: VaultItem) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const count = items.filter((v) => v.meta?.location).length;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close">
            <Glyph name="close" />
          </TouchableOpacity>
          <Text style={styles.title}>Places</Text>
          <Text style={styles.count}>{plural(count, 'video')}</Text>
        </View>
        {count === 0 ? (
          <Text style={styles.empty}>
            No video has a location yet. iPhone videos filmed with Location Services on carry one; it is read when they are
            imported.
          </Text>
        ) : (
          <VideoMap items={items} onOpen={onOpen} />
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
    circle: { width: 34, height: 34, borderRadius: 17, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    circleIcon: { color: p.text, fontSize: 15, fontWeight: '600' },
    title: { color: p.text, fontSize: 20, fontWeight: '700', flex: 1 },
    count: { color: p.textSecondary, fontSize: 13 },
    empty: { color: p.textSecondary, fontSize: 14, padding: 24 },
  });
