/**
 * The Audio mode of the Videos tab: the library, the mini player, the full
 * player, an item's details, the stats and the "already in your library"
 * question, put together. Playback itself lives above (AudioPlaybackProvider),
 * so it carries on when you switch to Watch or Overview.
 * Presentational only (see the note at the top of types.ts).
 */

import { useState } from 'react';
import { View } from 'react-native';

import { useTabBarSpace } from '../chrome';
import type { VideosMode } from '../overviewParts';
import { sheet, useStyles, type Palette } from '../theme';
import AudioDashboard from './AudioDashboard';
import AudioInfo from './AudioInfo';
import { AudioPlayerScreen, MiniPlayer } from './AudioPlayer';
import AudioScreen from './AudioScreen';
import type { AudioData, AudioUiItem } from './audioTypes';
import { useAudioPlayback } from './playback';

export type AudioDev = { player?: boolean; info?: boolean; dashboard?: boolean; deleted?: boolean };

export default function AudioSection({
  data,
  onMode,
  showPrivate,
  onUnlockPrivate,
  onWifi,
  dev,
}: {
  data: AudioData;
  onMode: (m: VideosMode) => void;
  showPrivate: boolean;
  onUnlockPrivate?: () => void;
  onWifi?: () => void;
  /** The browser preview opens one surface at once. */
  dev?: AudioDev;
}) {
  const styles = useStyles(makeStyles);
  const pb = useAudioPlayback();
  const tabSpace = useTabBarSpace();
  const [full, setFull] = useState(dev?.player ?? false);
  const [infoId, setInfoId] = useState<string | null>(dev?.info ? (data.items[0]?.id ?? null) : null);
  const [dash, setDash] = useState(dev?.dashboard ?? false);
  const info = infoId ? (data.items.find((i) => i.id === infoId) ?? null) : null;

  const open = (item: AudioUiItem) => {
    if (pb.item?.id !== item.id) pb.open(item);
    else if (!pb.playing) pb.resume();
    setFull(true);
  };

  return (
    <View style={styles.fill}>
      <AudioScreen
        items={data.items}
        deleted={data.deleted}
        status={data.status}
        busy={data.busy}
        currentId={pb.item?.id ?? null}
        playing={pb.playing}
        showPrivate={showPrivate}
        onUnlockPrivate={onUnlockPrivate}
        actions={data.actions}
        onOpen={open}
        onInfo={(i) => setInfoId(i.id)}
        onDashboard={() => setDash(true)}
        onMode={onMode}
        onWifi={onWifi}
        bottomSpace={pb.item ? 72 : 0}
        initialDeleted={dev?.deleted}
      />
      {pb.item && !full && <MiniPlayer bottom={tabSpace + 8} onExpand={() => setFull(true)} />}
      {full && pb.item && <AudioPlayerScreen actions={data.actions} onInfo={(i) => setInfoId(i.id)} onClose={() => setFull(false)} />}
      {info && (
        <AudioInfo
          item={info}
          actions={data.actions}
          onPlayFromStart={() => {
            pb.open(info, { track: 0, ms: 0, autoplay: true });
            setFull(true);
          }}
          onClose={() => setInfoId(null)}
        />
      )}
      {dash && (
        <AudioDashboard
          items={data.items.filter((i) => showPrivate || !i.isPrivate)}
          actions={data.actions}
          onOpen={(i) => {
            setDash(false);
            open(i);
          }}
          onClose={() => setDash(false)}
        />
      )}
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: p.bg },
  });
