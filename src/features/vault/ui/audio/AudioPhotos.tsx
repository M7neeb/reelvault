/**
 * Photos to look at while you listen: a row of thumbnails under the cover,
 * and a full-screen viewer to swipe (or tap the sides) through them while the
 * audio keeps playing. Presentational only (see the rule in ../types.ts).
 */

import { useEffect, useRef, useState } from 'react';
import { FlatList, Text, TouchableOpacity, View, type ViewToken } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmAction } from '../confirm';
import { tick } from '../haptics';
import Icon from '../Icon';
import { showFailure } from '../oops';
import { GatedModal as Modal, useWindowDimensions } from '../screen';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { AudioActions } from './audioTypes';

/** The thumbnails and their viewer for one item; loads and keeps its own list. */
export function AudioPhotos({
  itemId,
  actions,
  playing,
  onToggle,
  title,
}: {
  itemId: string;
  actions: Pick<AudioActions, 'listPhotos' | 'addPhotos' | 'removePhoto'>;
  playing: boolean;
  onToggle: () => void;
  title: string;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [photos, setPhotos] = useState<string[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  const load = () => {
    actions.listPhotos?.(itemId).then(setPhotos).catch(() => undefined);
  };
  useEffect(load, [itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!actions.listPhotos || !actions.addPhotos) return null;
  const add = () =>
    actions
      .addPhotos?.(itemId)
      .then(load)
      .catch(showFailure);

  return (
    <>
      <View style={styles.strip}>
        {photos.length === 0 ? (
          <TouchableOpacity style={styles.addWide} onPress={add} accessibilityLabel="Add photos to look at while listening">
            <Icon name="photo" size={15} color={p.textSecondary} />
            <Text style={styles.addText}>Add photos</Text>
          </TouchableOpacity>
        ) : (
          <FlatList
            horizontal
            data={[...photos, '+']}
            keyExtractor={(u) => u}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.row}
            renderItem={({ item, index }) =>
              item === '+' ? (
                <TouchableOpacity style={[styles.thumb, styles.addThumb]} onPress={add} accessibilityLabel="Add more photos">
                  <Icon name="plus" size={18} color={p.textSecondary} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => {
                    tick();
                    setOpen(index);
                  }}
                  accessibilityLabel={`Photo ${index + 1} of ${photos.length}`}>
                  <Image source={{ uri: item }} style={styles.thumb} contentFit="cover" transition={120} />
                </TouchableOpacity>
              )
            }
          />
        )}
      </View>
      {open !== null && photos.length > 0 && (
        <PhotoViewer
          photos={photos}
          start={Math.min(open, photos.length - 1)}
          title={title}
          playing={playing}
          onToggle={onToggle}
          onAdd={add}
          onRemove={(uri) =>
            confirmAction('Remove this photo?', 'Only the copy in ReelVault goes; the audio stays.', () => {
              const left = photos.filter((x) => x !== uri);
              setPhotos(left);
              if (!left.length) setOpen(null);
              actions.removePhoto?.(itemId, uri).catch(showFailure);
            }, { label: 'Remove', destructive: true })
          }
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

/** Full screen, one photo at a time: swipe, or tap the left / right side. */
function PhotoViewer({
  photos,
  start,
  title,
  playing,
  onToggle,
  onAdd,
  onRemove,
  onClose,
}: {
  photos: string[];
  start: number;
  title: string;
  playing: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onRemove: (uri: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(start);
  const list = useRef<FlatList<string>>(null);
  const shown = Math.min(index, photos.length - 1);

  const go = (i: number) => {
    const to = Math.max(0, Math.min(photos.length - 1, i));
    if (to === shown) return;
    tick();
    list.current?.scrollToIndex({ index: to, animated: true });
    setIndex(to);
  };
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setIndex(first.index);
  }).current;

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.viewer}>
        <FlatList
          ref={list}
          data={photos}
          horizontal
          pagingEnabled
          initialScrollIndex={start}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(u) => u}
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          renderItem={({ item }) => (
            <View style={{ width, height }}>
              <Image source={{ uri: item }} style={{ width, height }} contentFit="contain" transition={150} />
              {/* Tap the left or right third to go back or on. */}
              <View style={styles.taps}>
                <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => go(shown - 1)} accessibilityLabel="Previous photo" />
                <View style={{ flex: 1 }} />
                <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => go(shown + 1)} accessibilityLabel="Next photo" />
              </View>
            </View>
          )}
        />

        <View style={[styles.viewerTop, { paddingTop: insets.top + 6 }]}>
          <TouchableOpacity style={styles.round} onPress={onClose} accessibilityLabel="Close the photos">
            <Icon name="close" size={16} color="#fff" weight="bold" />
          </TouchableOpacity>
          <Text style={styles.counter}>
            {shown + 1} of {photos.length}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={styles.round} onPress={onAdd} accessibilityLabel="Add more photos">
              <Icon name="plus" size={16} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.round} onPress={() => onRemove(photos[shown])} accessibilityLabel="Remove this photo">
              <Icon name="trash" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.viewerBottom, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity style={styles.round} disabled={shown === 0} onPress={() => go(shown - 1)} accessibilityLabel="Previous photo">
            <Icon name="back" size={16} color={shown === 0 ? 'rgba(255,255,255,0.35)' : '#fff'} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.nowPlaying} onPress={onToggle} accessibilityLabel={playing ? 'Pause' : 'Play'}>
            <Icon name={playing ? 'pause' : 'play'} size={16} color="#fff" />
            <Text style={styles.nowText} numberOfLines={1}>
              {title}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.round} disabled={shown >= photos.length - 1} onPress={() => go(shown + 1)} accessibilityLabel="Next photo">
            <Icon name="forward" size={16} color={shown >= photos.length - 1 ? 'rgba(255,255,255,0.35)' : '#fff'} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    strip: { marginTop: 14, alignSelf: 'stretch', alignItems: 'center' },
    row: { gap: 8, paddingHorizontal: 30 },
    thumb: { width: 54, height: 54, borderRadius: 10, backgroundColor: p.card },
    addThumb: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: p.border, borderStyle: 'dashed' },
    addWide: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: p.card },
    addText: { color: p.textSecondary, fontSize: 14, fontWeight: '600' },

    // The viewer is always dark, like Photos.
    viewer: { flex: 1, backgroundColor: '#000' },
    taps: { ...({ position: 'absolute', left: 0, right: 0, top: 90, bottom: 90 } as const), flexDirection: 'row' },
    viewerTop: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
    viewerBottom: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
    round: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(40,40,40,0.75)', alignItems: 'center', justifyContent: 'center' },
    counter: { color: '#fff', fontSize: 15, fontWeight: '600' },
    nowPlaying: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 38, borderRadius: 19, paddingHorizontal: 14, backgroundColor: 'rgba(40,40,40,0.75)' },
    nowText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  });
