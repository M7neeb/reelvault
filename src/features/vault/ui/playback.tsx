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
import Icon from './Icon';

function ComparePane({ item, enableVideo, label, notes }: { item: VaultItem; enableVideo: boolean; label: string; /** What this one has over the other ("More pixels", "Longer"). */ notes: string[] }) {
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
      <View style={styles.paneBadge}>
        <Text style={styles.paneBadgeText}>{label}</Text>
      </View>
      <View style={styles.paneInfo}>
        <Text style={styles.paneText} numberOfLines={1}>
          {item.filename}
        </Text>
        {notes.length > 0 && (
          <View style={styles.notes}>
            {notes.map((n) => (
              <Text key={n} style={styles.note}>
                {n}
              </Text>
            ))}
          </View>
        )}
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

/** What `x` has over `y`, in a few words. */
function edge(x: VaultItem, y: VaultItem): string[] {
  const out: string[] = [];
  const px = (v: VaultItem) => (v.width ?? 0) * (v.height ?? 0);
  if (px(x) > px(y) * 1.1) out.push('More pixels');
  if ((x.durationMs ?? 0) > (y.durationMs ?? 0) + 1500) out.push('Longer');
  if (x.rating > y.rating) out.push('Rated higher');
  return out;
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
          <TouchableOpacity style={styles.headerClose} onPress={onClose} accessibilityLabel="Close, keep both" hitSlop={8}>
            <Icon name="close" size={14} color="#fff" weight="bold" />
          </TouchableOpacity>
          <Text style={styles.compareTitle} accessibilityRole="header">
            Which one stays?
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button">
            <Text style={styles.headerLink}>Keep both</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.panes}>
          <ComparePane item={a} enableVideo={enableVideo} label="A" notes={edge(a, b)} />
          <ComparePane item={b} enableVideo={enableVideo} label="B" notes={edge(b, a)} />
        </View>
        <Text style={styles.compareHint}>The one you don't keep goes to Recently Deleted.</Text>
        <View style={[styles.compareBar, { paddingBottom: insets.bottom + 14 }]}>
          <TouchableOpacity style={styles.keep} onPress={() => onKeep(a, b)} accessibilityRole="button">
            <Text style={styles.keepText}>Keep A</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.keep} onPress={() => onKeep(b, a)} accessibilityRole="button">
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

    compareHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
    headerClose: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(120,120,128,0.36)' },
    compareTitle: { flex: 1, color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
    headerLink: { color: '#fff', fontSize: 15, fontWeight: '600', opacity: 0.8 },
    panes: { flex: 1, gap: 8, paddingHorizontal: 10 },
    pane: { flex: 1, borderRadius: 20, overflow: 'hidden', backgroundColor: '#111' },
    paneBadge: { position: 'absolute', top: 10, left: 10, width: 32, height: 32, borderRadius: 16, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
    paneBadgeText: { color: '#000', fontSize: 16, fontWeight: '900' },
    paneInfo: { position: 'absolute', left: 10, right: 10, bottom: 10, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
    paneText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    paneMeta: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontVariant: ['tabular-nums'] },
    notes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 2 },
    note: { color: '#30D158', fontSize: 12, fontWeight: '800' },
    compareHint: { color: 'rgba(255,255,255,0.6)', fontSize: 13, textAlign: 'center', paddingTop: 12 },
    compareBar: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12 },
    keep: { flex: 1, backgroundColor: '#fff', borderRadius: 26, height: 52, alignItems: 'center', justifyContent: 'center' },
    keepText: { color: '#000', fontWeight: '800', fontSize: 17 },
  });
