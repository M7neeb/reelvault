/**
 * The video viewer, laid out to match HashPhotos.
 *
 * HashPhotos is NOT a draggable sheet. It is a FIXED stack:
 *
 *   header (back · date+time · info · actions)
 *   media, filling everything above the bottom stack
 *   scrubber bar   (play/pause · track · time · more)
 *   filmstrip      (tap a frame to seek)
 *   album bar      (tap an album to put the video in it)
 *   toolbar        (pick flag · reject flag · stars · more · delete)
 *
 * Tapping the video hides all of it (full screen) and brings it back. The
 * metadata lives in a SEPARATE panel opened by the info button.
 *
 * Like the rest of `ui/`, this imports no native module except expo-video, which
 * has a real web implementation. `enableVideo=false` (the browser preview) skips
 * mounting the player and shows a placeholder stage instead.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { confirmAction } from './confirm';
import DateSheet from './DateSheet';
import { fmtBitrate, fmtDateTime, fmtDuration, fmtFormat, fmtSize } from './format';
import { fmtLocation, RECENTLY_DELETED_DAYS } from './logic';
import { PromptSheet } from './prompts';
import { SmallerSheet } from './smaller';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import {
  STATUSES,
  statusLabel,
  type ThumbSource,
  type UiAlbum,
  type UiFlag,
  type UiStatus,
  type UiTag,
  type VaultItem,
  type VaultScreenProps,
} from './types';

const FRAME_W = 52;
const FRAME_H = 36;
const FRAME_GAP = 3;

/** The vault's own definition of a favourite (see the sidebar). */
const FAVOURITE_RATING = 8;

export default function ViewerModal({
  item,
  actions,
  albums,
  enableVideo,
  initialInfoOpen = false,
  initialMenuOpen = false,
  initialSmallerOpen = false,
  onSlideshow,
  onNearby,
  onClose,
}: {
  item: VaultItem;
  actions: VaultScreenProps['actions'];
  /** Albums this video can go into (private ones only for private videos). */
  albums: UiAlbum[];
  enableVideo: boolean;
  /** Preview-only: open a panel on first render so it can be screenshotted. */
  initialInfoOpen?: boolean;
  initialMenuOpen?: boolean;
  initialSmallerOpen?: boolean;
  /** Play the current list as a slideshow, starting here. */
  onSlideshow: (item: VaultItem) => void;
  /** Show the videos filmed near this one. */
  onNearby: (item: VaultItem) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();

  const player = useVideoPlayer(enableVideo && item.uri ? item.uri : null, (pl) => {
    pl.loop = false;
    if (enableVideo) pl.play();
    pl.timeUpdateEventInterval = 0.2;
  });

  const [rating, setRating] = useState(item.rating);
  const [flag, setFlag] = useState<UiFlag>(item.flag);
  const [watch, setWatch] = useState<UiStatus | null>(item.status);
  const [inTray, setInTray] = useState(item.inTray);
  const [albumIds, setAlbumIds] = useState<number[]>(item.albumIds);
  const [title, setTitle] = useState(item.title ?? '');
  const [caption, setCaption] = useState(item.notes ?? '');
  const [videoTags, setVideoTags] = useState<UiTag[]>([]);
  const [draft, setDraft] = useState('');
  const [frames, setFrames] = useState<ThumbSource[]>([]);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(enableVideo);
  const [trackW, setTrackW] = useState(0);
  const [infoOpen, setInfoOpen] = useState(initialInfoOpen);
  const [menuOpen, setMenuOpen] = useState(initialMenuOpen);
  const [chrome, setChrome] = useState(true);
  const [dateOpen, setDateOpen] = useState(false);
  const [newAlbumOpen, setNewAlbumOpen] = useState(false);
  const [smallerOpen, setSmallerOpen] = useState(initialSmallerOpen);
  const [note, setNote] = useState('');

  const framesRef = useRef<ThumbSource[]>([]);
  framesRef.current = frames;
  const lastIdx = useRef(-1);
  const stripRef = useRef<ScrollView>(null);

  useEffect(() => {
    actions
      .loadTags(item.id)
      .then(setVideoTags)
      .catch((e) => console.log(`[TAG] load failed: ${String(e)}`));
  }, [item.id, actions]);

  useEffect(() => {
    actions
      .loadFrames(item)
      .then(setFrames)
      .catch((e) => console.log(`[FILM] failed: ${String(e)}`));
  }, [item, actions]);

  // Playhead + auto-scroll the strip.
  useEffect(() => {
    const sub = player.addListener('timeUpdate', (payload) => {
      const total = player.duration || (item.durationMs ?? 0) / 1000;
      if (!total) return;
      const fraction = Math.min(1, Math.max(0, payload.currentTime / total));
      setProgress(fraction);
      const count = framesRef.current.length;
      if (count) {
        const idx = Math.min(count - 1, Math.floor(fraction * count));
        if (idx !== lastIdx.current) {
          lastIdx.current = idx;
          stripRef.current?.scrollTo({ x: Math.max(0, idx * (FRAME_W + FRAME_GAP) - 60), animated: true });
        }
      }
    });
    return () => sub.remove();
  }, [player, item.durationMs]);

  /** Recently used albums first, then pinned, then the rest - HashPhotos' album bar. */
  const barAlbums = useMemo(
    () =>
      [...albums].sort(
        (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name)
      ),
    [albums]
  );

  const dt = fmtDateTime(item.createdAt);
  const imported = fmtDateTime(item.importedAt);
  const totalSec = player.duration || (item.durationMs ?? 0) / 1000;
  const elapsed = Math.round(progress * totalSec);

  function togglePlay() {
    if (!enableVideo) return;
    if (player.playing) player.pause();
    else player.play();
    setPlaying(!player.playing);
  }

  function seek(fraction: number) {
    if (!enableVideo) return;
    const d = player.duration || (item.durationMs ?? 0) / 1000;
    if (d > 0) {
      player.currentTime = d * fraction;
      player.play();
      setPlaying(true);
      console.log(`[SEEK] ${(fraction * 100).toFixed(0)}%`);
    }
  }

  async function onRate(n: number) {
    const next = n === rating ? 0 : n;
    setRating(next);
    await actions.onRate(item.id, next);
    console.log(`[RATE] ${item.filename} → ${next}`);
  }

  async function onFlag(next: UiFlag) {
    const value = next === flag ? 0 : next;
    setFlag(value);
    await actions.onSetFlag([item.id], value);
  }

  async function onStatus(next: UiStatus) {
    const value = next === watch ? null : next;
    setWatch(value);
    await actions.onSetStatus([item.id], value);
    console.log(`[STATUS] ${item.filename} → ${value ?? 'none'}`);
  }

  async function toggleAlbum(album: UiAlbum) {
    if (albumIds.includes(album.id)) {
      setAlbumIds((ids) => ids.filter((x) => x !== album.id));
      await actions.onRemoveFromAlbum([item.id], album.id);
    } else {
      setAlbumIds((ids) => [...ids, album.id]);
      await actions.onAddToAlbums([item.id], [album.id]);
    }
  }

  async function onAddTag() {
    const name = draft.trim();
    if (!name) return;
    await actions.onAddTag(item.id, name);
    setDraft('');
    setVideoTags(await actions.loadTags(item.id));
    console.log(`[TAG] +${name} @ ${item.filename}`);
  }

  async function onRemoveTag(tag: UiTag) {
    await actions.onRemoveTag(item.id, tag.id);
    setVideoTags(await actions.loadTags(item.id));
  }

  function confirmDelete() {
    confirmAction('Delete video?', `It moves to Recently Deleted for ${RECENTLY_DELETED_DAYS} days.`, () => {
      actions
        .onDeleteOne(item)
        .then(onClose)
        .catch((e) => console.log(`[DELETE] failed: ${String(e)}`));
    });
  }

  /** Moving a video in or out of Private takes it out of the current view, so close. */
  function togglePrivate() {
    actions
      .onSetPrivate([item.id], !item.isPrivate)
      .then(onClose)
      .catch((e) => console.log(`[PRIVATE] failed: ${String(e)}`));
  }

  function run(label: string, job: Promise<void>) {
    job.then(() => setNote(label)).catch((e) => setNote(`That did not work: ${String(e)}`));
  }

  const isFavourite = rating >= FAVOURITE_RATING;
  const format = fmtFormat(item.filename);
  const bitrate = fmtBitrate(item.sizeBytes, item.durationMs);
  const loc = item.meta?.location;
  const camera = [item.meta?.make, item.meta?.model].filter(Boolean).join(' ');

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.viewer, !chrome && styles.viewerBare]}>
        {/* ── media: tap to hide or show everything else ───────────────── */}
        <View style={styles.stage}>
          <TouchableOpacity activeOpacity={1} onPress={() => setChrome((c) => !c)} style={styles.stageTouch}>
            {enableVideo ? (
              <VideoView player={player} style={styles.video} contentFit="contain" nativeControls={false} />
            ) : (
              <View style={styles.videoPlaceholder}>
                <Text style={styles.videoPlaceholderText}>video</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {chrome && (
          <>
            {/* ── header ──────────────────────────────────────────────── */}
            <View style={[styles.header, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
              <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Back">
                <Text style={styles.circleIcon}>‹</Text>
              </TouchableOpacity>

              <View style={styles.titleWrap}>
                <Text style={styles.titleDate}>{item.title || dt.date}</Text>
                <Text style={styles.titleTime}>{item.title ? `${dt.date} ${dt.time}` : dt.time}</Text>
              </View>

              <View style={styles.headerRight}>
                <TouchableOpacity
                  style={[styles.circle, infoOpen && styles.circleOn]}
                  onPress={() => setInfoOpen((v) => !v)}
                  accessibilityLabel="Info">
                  <Text style={[styles.circleIcon, infoOpen && styles.circleIconOn]}>ⓘ</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.circle, menuOpen && styles.circleOn]}
                  onPress={() => setMenuOpen(true)}
                  accessibilityLabel="More">
                  <Text style={[styles.circleIcon, menuOpen && styles.circleIconOn]}>≡</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ── bottom stack ────────────────────────────────────────── */}
            <View style={styles.bottom}>
              {!!note && (
                <TouchableOpacity onPress={() => setNote('')}>
                  <Text style={styles.note}>{note}</Text>
                </TouchableOpacity>
              )}
              <View style={styles.scrub}>
                <TouchableOpacity onPress={togglePlay} hitSlop={10} accessibilityLabel="Play or pause">
                  <Text style={styles.scrubIcon}>{playing ? '❚❚' : '▶'}</Text>
                </TouchableOpacity>
                <View style={styles.scrubTrack} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
                  <View style={[styles.scrubFill, { width: `${Math.round(progress * 100)}%` }]} />
                  <View style={[styles.scrubThumb, { left: progress * Math.max(0, trackW - 3) }]} />
                </View>
                <Text style={styles.scrubTime}>
                  {fmtDuration(elapsed * 1000) ?? '0:00'} / {fmtDuration(totalSec * 1000) ?? '--:--'}
                </Text>
                <TouchableOpacity onPress={() => setMenuOpen(true)} hitSlop={10}>
                  <Text style={styles.scrubIcon}>•••</Text>
                </TouchableOpacity>
              </View>

              <ScrollView ref={stripRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                {frames.map((src, i) => (
                  <TouchableOpacity key={i} onPress={() => seek((i + 0.5) / frames.length)}>
                    <Image source={src} style={styles.stripFrame} contentFit="cover" />
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* album bar */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.albumBar}>
                {barAlbums.map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.albumChip, albumIds.includes(a.id) && styles.albumChipOn]}
                    onPress={() => void toggleAlbum(a)}>
                    <Text style={[styles.albumChipText, albumIds.includes(a.id) && styles.albumChipTextOn]} numberOfLines={1}>
                      {albumIds.includes(a.id) ? '✓ ' : ''}
                      {a.name}
                    </Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={styles.albumChip} onPress={() => setNewAlbumOpen(true)}>
                  <Text style={styles.albumChipText}>+ Album</Text>
                </TouchableOpacity>
              </ScrollView>

              <View style={[styles.toolbar, { paddingBottom: insets.bottom + 10 }]}>
                <TouchableOpacity style={styles.tool} onPress={() => void onFlag(1)} accessibilityLabel="Pick">
                  <Text style={[styles.toolIcon, flag === 1 && styles.toolPick]}>⚑</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.tool} onPress={() => void onFlag(-1)} accessibilityLabel="Reject">
                  <Text style={[styles.toolIcon, flag === -1 && styles.toolReject]}>✕</Text>
                </TouchableOpacity>
                <View style={styles.stars}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <TouchableOpacity key={n} onPress={() => onRate(n)} hitSlop={4}>
                      <Text style={[styles.star, n <= rating && styles.starOn]}>{n <= rating ? '★' : '☆'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity style={styles.tool} onPress={() => setMenuOpen(true)}>
                  <Text style={styles.toolIcon}>•••</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.tool} onPress={confirmDelete} accessibilityLabel="Delete">
                  <Text style={styles.toolDanger}>⌫</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        {/* ── info panel ────────────────────────────────────────────────── */}
        {infoOpen && (
          <View style={styles.infoRoot}>
            <TouchableOpacity style={styles.infoBackdrop} activeOpacity={1} onPress={() => setInfoOpen(false)} />
            <View style={[styles.infoSheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.infoHeader}>
                <TouchableOpacity style={styles.circle} onPress={() => setInfoOpen(false)}>
                  <Text style={styles.circleIcon}>✕</Text>
                </TouchableOpacity>
                <Text style={styles.infoTitle}>Info</Text>
                <View style={styles.circleGhost} />
              </View>

              <ScrollView contentContainerStyle={styles.infoBody} keyboardShouldPersistTaps="handled">
                <View style={styles.thumbWrap}>
                  <Image source={item.thumbSource} style={styles.thumbPreview} contentFit="cover" />
                </View>

                {/* the blue filename bar */}
                <View style={styles.fileBar}>
                  <Text style={styles.fileBarIcon}>▶</Text>
                  <Text style={styles.fileBarText} numberOfLines={1}>
                    {item.filename}
                  </Text>
                </View>

                <TextInput
                  style={styles.titleInput}
                  value={title}
                  onChangeText={setTitle}
                  onEndEditing={() => void actions.onSetText([item.id], 'title', title)}
                  placeholder="Tap here to add title"
                  placeholderTextColor={p.link}
                  keyboardAppearance={p.scheme}
                  returnKeyType="done"
                />
                <TextInput
                  style={styles.captionInput}
                  value={caption}
                  onChangeText={setCaption}
                  onEndEditing={() => void actions.onSetText([item.id], 'notes', caption)}
                  placeholder="No Caption"
                  placeholderTextColor={p.textSecondary}
                  keyboardAppearance={p.scheme}
                  multiline
                />

                <TouchableOpacity style={styles.infoRow} onPress={() => setDateOpen(true)}>
                  <Text style={styles.infoValue}>
                    {dt.date} at {dt.time}
                  </Text>
                  <Text style={styles.linkSmall}>Adjust</Text>
                </TouchableOpacity>

                <View style={styles.chipRow}>
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>
                      {item.width && item.height ? `${item.width} x ${item.height}` : 'Unknown size'}
                    </Text>
                  </View>
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{fmtSize(item.sizeBytes)}</Text>
                  </View>
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{item.durationMs ? fmtDuration(item.durationMs) : '--:--'}</Text>
                  </View>
                  {format && (
                    <View style={styles.chip}>
                      <Text style={styles.chipText}>{format}</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.section}>Details</Text>
                <Detail label="Camera" value={camera || 'No camera information'} />
                <Detail label="Software" value={item.meta?.software} />
                <Detail label="Codec" value={item.meta?.codec} />
                <Detail label="Frame rate" value={item.meta?.fps ? `${item.meta.fps} fps` : undefined} />
                <Detail label="Bitrate" value={bitrate ?? undefined} />
                <Detail
                  label="Made smaller"
                  value={item.originalSizeBytes ? `from ${fmtSize(item.originalSizeBytes)}` : undefined}
                />
                <Detail label="Imported" value={`${imported.date} at ${imported.time}`} />

                <Text style={styles.section}>Location</Text>
                {loc ? (
                  <>
                    <Text style={styles.infoValue}>{fmtLocation(loc)}</Text>
                    <View style={styles.linkRow}>
                      <TouchableOpacity onPress={() => actions.onOpenMap(loc.lat, loc.lon, item.title || item.filename)}>
                        <Text style={styles.linkSmall}>Open in Maps</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          onNearby(item);
                          onClose();
                        }}>
                        <Text style={styles.linkSmall}>Videos nearby</Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <Text style={styles.infoMuted}>No Location Data</Text>
                )}

                <Text style={styles.section}>Status</Text>
                <View style={styles.pills}>
                  {STATUSES.map((s) => (
                    <TouchableOpacity
                      key={s.key}
                      style={[styles.statusChip, watch === s.key && styles.statusChipOn]}
                      onPress={() => void onStatus(s.key)}>
                      <Text style={[styles.statusChipText, watch === s.key && styles.statusChipTextOn]}>{s.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {albumIds.length > 0 && (
                  <>
                    <Text style={styles.section}>Albums</Text>
                    <Text style={styles.infoValue}>
                      {albums
                        .filter((a) => albumIds.includes(a.id))
                        .map((a) => a.name)
                        .join(', ')}
                    </Text>
                  </>
                )}

                <Text style={styles.section}>Keywords</Text>
                <View style={styles.pills}>
                  {videoTags.length === 0 && <Text style={styles.infoMuted}>No keywords yet.</Text>}
                  {videoTags.map((t) => (
                    <TouchableOpacity key={t.id} style={styles.pill} onPress={() => onRemoveTag(t)}>
                      <Text style={styles.pillText}>{t.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.addRow}>
                  <TextInput
                    style={styles.input}
                    placeholder="add a keyword…"
                    placeholderTextColor={p.textMuted}
                    value={draft}
                    onChangeText={setDraft}
                    onSubmitEditing={onAddTag}
                    autoCapitalize="none"
                    returnKeyType="done"
                    keyboardAppearance={p.scheme}
                  />
                  <TouchableOpacity style={styles.addBtn} onPress={onAddTag}>
                    <Text style={styles.addBtnText}>Add</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        )}

        {/* ── actions sheet ─────────────────────────────────────────────── */}
        {menuOpen && (
          <View style={styles.infoRoot}>
            <TouchableOpacity style={styles.infoBackdrop} activeOpacity={1} onPress={() => setMenuOpen(false)} />
            <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 12 }]}>
              <View style={styles.grabber} />
              <Text style={styles.menuTitle} numberOfLines={1}>
                {item.filename}
              </Text>
              <ScrollView style={styles.menuScroll}>
                <MenuRow
                  label="Favourite"
                  hint={isFavourite ? 'On' : 'Off'}
                  onPress={() => {
                    setMenuOpen(false);
                    void onRate(isFavourite ? 0 : FAVOURITE_RATING);
                  }}
                />
                <MenuRow
                  label="Status"
                  hint={statusLabel(watch)}
                  onPress={() => {
                    setMenuOpen(false);
                    setInfoOpen(true);
                  }}
                />
                <MenuRow
                  label="Keyword, title, caption"
                  hint={`${videoTags.length}`}
                  onPress={() => {
                    setMenuOpen(false);
                    setInfoOpen(true);
                  }}
                />
                <MenuRow
                  label={inTray ? 'Remove from Tray' : 'Add to Tray'}
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    setInTray(!inTray);
                    run(inTray ? 'Removed from the Tray' : 'Added to the Tray', actions.onSetTray([item.id], !inTray));
                  }}
                />
                <MenuRow
                  label="Adjust Date & Time"
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    setDateOpen(true);
                  }}
                />
                <MenuRow
                  label="Share / Save to Files"
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    void actions.onShare(item);
                  }}
                />
                <MenuRow
                  label="Save to Photos"
                  hint="Copy"
                  onPress={() => {
                    setMenuOpen(false);
                    run('Saved to Photos', actions.onSaveToPhotos([item]));
                  }}
                />
                <MenuRow
                  label="Save This Frame as Image"
                  hint={fmtDuration(elapsed * 1000) ?? '0:00'}
                  onPress={() => {
                    setMenuOpen(false);
                    void actions.onExtractFrame(item, progress * totalSec * 1000);
                  }}
                />
                <MenuRow
                  label="Use This Frame as Cover"
                  hint={fmtDuration(elapsed * 1000) ?? '0:00'}
                  onPress={() => {
                    setMenuOpen(false);
                    run('Cover changed', actions.onSetCoverFrame(item, progress * totalSec * 1000));
                  }}
                />
                <MenuRow
                  label="Choose Cover Photo…"
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    actions
                      .onPickCover(item)
                      .then((picked) => picked && setNote('Cover changed'))
                      .catch((e) => setNote(`That did not work: ${String(e)}`));
                  }}
                />
                {item.customCover && (
                  <MenuRow
                    label="Reset Cover"
                    hint="First frame"
                    onPress={() => {
                      setMenuOpen(false);
                      run('Cover reset', actions.onResetCover(item));
                    }}
                  />
                )}
                <MenuRow
                  label="Make Smaller…"
                  hint={fmtSize(item.sizeBytes)}
                  onPress={() => {
                    setMenuOpen(false);
                    if (player.playing) player.pause();
                    setSmallerOpen(true);
                  }}
                />
                <MenuRow
                  label="Slideshow from Here"
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    onSlideshow(item);
                  }}
                />
                <MenuRow
                  label="Duplicate"
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    run('Duplicated - the copy is in the library', actions.onDuplicate(item));
                  }}
                />
                <MenuRow
                  label={item.isPrivate ? 'Remove from Private' : 'Move to Private'}
                  hint={item.isPrivate ? '' : 'Locked'}
                  onPress={() => {
                    setMenuOpen(false);
                    togglePrivate();
                  }}
                />
                <MenuRow
                  label="Delete"
                  danger
                  hint=""
                  onPress={() => {
                    setMenuOpen(false);
                    confirmDelete();
                  }}
                />
              </ScrollView>
            </View>
          </View>
        )}

        {dateOpen && (
          <DateSheet
            count={1}
            initial={item.createdAt}
            onApply={(change) => actions.onAdjustDates([item.id], change)}
            onClose={() => setDateOpen(false)}
          />
        )}

        {smallerOpen && (
          <SmallerSheet
            items={[item]}
            available={actions.canMakeSmaller()}
            onMakeSmaller={actions.onMakeSmaller}
            onCancel={actions.onCancelMakeSmaller}
            onClose={() => setSmallerOpen(false)}
          />
        )}

        {newAlbumOpen && (
          <PromptSheet
            title="New Album"
            message={item.isPrivate ? 'A private album, only shown when Private is unlocked.' : undefined}
            placeholder="Album name"
            confirmLabel="Create"
            onSubmit={(name) => {
              actions
                .onCreateAlbum(name, { isPrivate: item.isPrivate })
                .then((id) => actions.onAddToAlbums([item.id], [id]).then(() => setAlbumIds((ids) => [...ids, id])))
                .catch((e) => console.log(`[ALBUM] create failed: ${String(e)}`));
            }}
            onClose={() => setNewAlbumOpen(false)}
          />
        )}
      </View>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  const styles = useStyles(makeStyles);
  if (!value) return null;
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function MenuRow({
  label,
  hint,
  danger,
  onPress,
}: {
  label: string;
  hint: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <TouchableOpacity style={styles.menuRow} onPress={onPress}>
      <Text style={[styles.menuLabel, danger && styles.menuLabelDanger]}>{label}</Text>
      {!!hint && <Text style={styles.menuHint}>{hint}</Text>}
    </TouchableOpacity>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    viewer: { flex: 1, backgroundColor: p.bg },
    viewerBare: { backgroundColor: '#000' },
    stage: { flex: 1 },
    stageTouch: { flex: 1, justifyContent: 'center' },
    video: { width: '100%', height: '100%' },
    videoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    videoPlaceholderText: { color: p.textMuted, fontSize: 13, fontWeight: '700', letterSpacing: 1 },

    header: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      paddingBottom: 8,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    titleWrap: { alignItems: 'center', flex: 1, paddingHorizontal: 8 },
    titleDate: { color: p.text, fontSize: 17, fontWeight: '700' },
    titleTime: { color: p.textSecondary, fontSize: 13 },
    headerRight: { flexDirection: 'row', gap: 8 },
    circle: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.circle,
    },
    circleGhost: { width: 34, height: 34 },
    circleOn: { backgroundColor: p.accent },
    circleIcon: { color: p.icon, fontSize: 15, fontWeight: '700' },
    circleIconOn: { color: '#fff' },

    bottom: { backgroundColor: p.viewerBar },
    note: { color: p.link, fontSize: 12, textAlign: 'center', paddingTop: 8 },
    scrub: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    scrubIcon: { color: p.text, fontSize: 13, fontWeight: '700' },
    scrubTrack: {
      flex: 1,
      height: 3,
      borderRadius: 2,
      backgroundColor: p.border,
      justifyContent: 'center',
    },
    scrubFill: { height: 3, borderRadius: 2, backgroundColor: p.text },
    scrubThumb: { position: 'absolute', width: 9, height: 9, borderRadius: 5, backgroundColor: p.text },
    scrubTime: { color: p.textSecondary, fontSize: 11, fontVariant: ['tabular-nums'] },

    strip: { gap: FRAME_GAP, paddingHorizontal: 14, paddingBottom: 8, alignItems: 'center' },
    stripFrame: { width: FRAME_W, height: FRAME_H, backgroundColor: p.tile },

    albumBar: { gap: 6, paddingHorizontal: 14, paddingBottom: 8 },
    albumChip: {
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.card,
      borderRadius: 999,
      paddingHorizontal: 11,
      paddingVertical: 5,
      maxWidth: 160,
    },
    albumChipOn: { backgroundColor: p.accent, borderColor: p.accent },
    albumChipText: { color: p.textSoft, fontSize: 12, fontWeight: '600' },
    albumChipTextOn: { color: '#fff' },

    toolbar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      paddingTop: 10,
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: p.separator,
    },
    tool: { paddingVertical: 4, paddingHorizontal: 2 },
    toolIcon: { color: p.textSoft, fontSize: 17, fontWeight: '600' },
    toolPick: { color: '#34c759' },
    toolReject: { color: '#ff453a' },
    toolDanger: { color: p.dangerText, fontSize: 17, fontWeight: '700' },
    stars: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
    star: { color: p.starOff, fontSize: 14 },
    starOn: { color: p.rating },

    infoRoot: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    infoBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: p.backdrop },
    infoSheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '88%',
      backgroundColor: p.panel,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
    },
    infoHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingTop: 14,
      paddingBottom: 8,
    },
    infoTitle: { color: p.text, fontSize: 17, fontWeight: '700' },
    infoBody: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
    thumbWrap: { alignItems: 'center' },
    thumbPreview: { width: 120, height: 120, backgroundColor: p.tile },
    fileBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: p.accent,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 9,
    },
    fileBarIcon: { color: '#fff', fontSize: 11 },
    fileBarText: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
    titleInput: { color: p.text, fontSize: 15, fontWeight: '600', paddingVertical: 4 },
    captionInput: { color: p.textSoft, fontSize: 13, paddingVertical: 4, minHeight: 22 },
    infoMuted: { color: p.textSecondary, fontSize: 13 },
    infoValue: { color: p.textSoft, fontSize: 13, flexShrink: 1 },
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    linkSmall: { color: p.link, fontSize: 13, fontWeight: '600' },
    linkRow: { flexDirection: 'row', gap: 18 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { backgroundColor: p.card, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5 },
    chipText: { color: p.textSoft, fontSize: 12 },
    section: { color: p.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, paddingTop: 4 },
    detail: { flexDirection: 'row', gap: 10 },
    detailLabel: { width: 82, color: p.textSecondary, fontSize: 13 },
    detailValue: { flex: 1, color: p.textSoft, fontSize: 13 },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: { backgroundColor: p.keyword, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
    pillText: { color: '#fff', fontSize: 14, fontWeight: '600' },
    statusChip: {
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.card,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
    },
    statusChipOn: { backgroundColor: p.accent, borderColor: p.accent },
    statusChipText: { color: p.textSoft, fontSize: 13, fontWeight: '600' },
    statusChipTextOn: { color: '#fff' },
    addRow: { flexDirection: 'row', gap: 8 },
    input: {
      flex: 1,
      backgroundColor: p.card,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: p.text,
    },
    addBtn: { backgroundColor: p.accent, paddingHorizontal: 18, justifyContent: 'center', borderRadius: 10 },
    addBtnText: { color: '#fff', fontWeight: '700' },

    menuSheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '80%',
      backgroundColor: p.panel,
      borderTopLeftRadius: 18,
      borderTopRightRadius: 18,
      paddingTop: 10,
      paddingHorizontal: 8,
    },
    menuScroll: { flexGrow: 0 },
    grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: p.grabber },
    menuTitle: { color: p.textSecondary, fontSize: 12, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6 },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 14,
      borderRadius: 10,
    },
    menuLabel: { color: p.textSoft, fontSize: 16 },
    menuLabelDanger: { color: p.dangerText },
    menuHint: { color: p.textSecondary, fontSize: 14 },
  });
