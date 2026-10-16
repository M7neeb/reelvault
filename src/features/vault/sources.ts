/**
 * Getting videos in and out through the iPhone itself: the Photos library
 * (pick to import, Save to Photos), the camera, and a pasted link.
 * Every function hands back plain { uri, name, size } files for importAssets.
 */

import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library/legacy';
import { Directory, File, Paths } from 'expo-file-system';

import { fileNameFromUrl, isHttpUrl } from './sourceNames';

export type PickedFile = { uri: string; name: string; size?: number };

function toPicked(assets: ImagePicker.ImagePickerAsset[], prefix: string): PickedFile[] {
  return assets.map((a, i) => ({
    uri: a.uri,
    name: a.fileName ?? `${prefix}_${Date.now()}_${i + 1}.mov`,
    size: a.fileSize,
  }));
}

/** The Photos picker, videos only, original files (no re-encoding, iCloud ones downloaded). */
export async function pickFromPhotos(): Promise<PickedFile[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: true,
    selectionLimit: 0,
    videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    shouldDownloadFromNetwork: true,
  });
  if (result.canceled) return [];
  return toPicked(result.assets, 'Photos');
}

/** Film a new video with the camera. `null` = no permission. */
export async function recordWithCamera(): Promise<PickedFile[] | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['videos'],
    videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
    videoMaxDuration: 0,
  });
  if (result.canceled) return [];
  return toPicked(result.assets, 'Camera');
}

/** A link on the clipboard, if there is one. */
export async function clipboardUrl(): Promise<string | null> {
  try {
    const text = (await Clipboard.getStringAsync()).trim();
    return isHttpUrl(text) ? text : null;
  } catch {
    return null;
  }
}

/** Downloads a direct link to a video file into the cache, ready to import. */
export async function downloadVideo(url: string): Promise<PickedFile> {
  const dir = new Directory(Paths.cache, `download-${Date.now()}`);
  dir.create({ intermediates: true });
  const target = new File(dir, fileNameFromUrl(url));
  await File.downloadFileAsync(url, target);
  return { uri: target.uri, name: target.name, size: target.size ?? undefined };
}

/** Save copies into the Photos app. Returns how many were saved; null = no permission. */
export async function saveToPhotos(uris: string[]): Promise<number | null> {
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) return null;
  let saved = 0;
  for (const uri of uris) {
    await MediaLibrary.saveToLibraryAsync(uri);
    saved++;
  }
  return saved;
}
