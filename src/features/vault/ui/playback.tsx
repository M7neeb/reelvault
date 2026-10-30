/**
 * Compare and Pick: two videos stacked, keep the better one. (Slideshow
 * lives in slideshow.tsx.)
 *
 * expo-video is the one native module the UI may use (it has a web version);
 * `enableVideo=false` (the browser preview) shows placeholders instead.
 */

import { friendlyName } from '../names';
import { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Modal } from './screen';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fmtDuration, fmtSize } from './format';
import { sheet, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';
import Glyph from './Glyph';

function ComparePane({ item, enableVideo, label }: { item: VaultItem; enableVideo: boolean; label: string }) {
  const styles = useStyles(makeStyles);
  const player = useVideoPlayer(enableVideo && item.uri ? item.uri : null, (pl) => {
    pl.loop = true;
    pl.muted = label === 'B';
    if (enableVideo) pl.play();
  });
  return (
    <View style={styles.pane}>
      {enableVideo ? (
        <VideoView pointerEvents="none" player={player} style={styles.full} contentFit="contain" nativeControls={false} />
      ) : (
        <Image source={item.thumbSource} style={styles.full} contentFit="contain" />
      )}
      <View style={styles.paneInfo}>
        <Text style={styles.paneLabel}>{label}</Text>
        <Text style={styles.paneText} numberOfLines={1}>
          {item.filename}
        </Text>
        <Text style={styles.paneMeta}>
          {[
            item.width && item.height ? `${item.width}×${item.height}` : null,
            fmtSize(item.sizeBytes),
            fmtDuration(item.durationMs),
            item.rating ? `${item.rating}/10` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </View>
  );
}

/** Two videos, one above the other. Keeping one moves the other to Recently Deleted. */
export function CompareModal({
  a,
  b,
  enableVideo,
  onKeep,
  onClose,
}: {
  a: VaultItem;
  b: VaultItem;
  enableVideo: boolean;
  /** The video to keep; the other one goes to Recently Deleted. */
  onKeep: (keep: VaultItem, drop: VaultItem) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  return (
    <Modal fullBleed visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.dark, { paddingTop: insets.top }]}>
        <View style={styles.compareHeader}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.headerLink}>Keep both</Text>
          </TouchableOpacity>
          <Text style={styles.compareTitle}>Compare and Pick</Text>
          <View style={styles.headerSpacer} />
        </View>
        <ComparePane item={a} enableVideo={enableVideo} label="A" />
        <ComparePane item={b} enableVideo={enableVideo} label="B" />
        <View style={[styles.compareBar, { paddingBottom: insets.bottom + 14 }]}>
          <TouchableOpacity style={styles.keep} onPress={() => onKeep(a, b)}>
            <Text style={styles.keepText}>Keep A</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.keep} onPress={() => onKeep(b, a)}>
            <Text style={styles.keepText}>Keep B</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// Players are always on black, whatever the theme - like the iOS Photos app.
const makeStyles = (p: Palette) =>
  sheet({
    dark: { flex: 1, backgroundColor: '#000' },
    full: { width: '100%', height: '100%' },
    disabled: { opacity: 0.35 },
    slideTop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      gap: 10,
    },
    slideTitleWrap: { flex: 1, alignItems: 'center' },
    slideTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
    slideCount: { color: '#9aa0a6', fontSize: 12 },
    slideBottom: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 26,
    },
    round: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(120,120,128,0.4)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    roundBig: {
      width: 62,
      height: 62,
      borderRadius: 31,
      backgroundColor: 'rgba(120,120,128,0.4)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    roundGhost: { width: 44, height: 44 },
    roundText: { color: '#fff', fontSize: 18, fontWeight: '700' },

    compareHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    compareTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
    headerLink: { color: '#4aa8ff', fontSize: 15, fontWeight: '600', width: 80 },
    headerSpacer: { width: 80 },
    pane: { flex: 1, borderBottomWidth: 1, borderBottomColor: '#222' },
    paneInfo: {
      position: 'absolute',
      left: 10,
      right: 10,
      bottom: 8,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    paneLabel: { color: p.rating, fontSize: 12, fontWeight: '800' },
    paneText: { color: '#fff', fontSize: 13, fontWeight: '600' },
    paneMeta: { color: '#c9ccd1', fontSize: 11 },
    compareBar: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 12 },
    keep: { flex: 1, backgroundColor: p.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    keepText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  });
