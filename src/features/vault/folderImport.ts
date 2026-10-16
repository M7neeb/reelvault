import { Directory, File } from 'expo-file-system';

/** File types treated as videos when a whole folder is imported. */
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', '3gp', 'avi', 'mkv', 'webm', 'mts', 'm2ts', 'hevc']);

export type FolderVideo = { uri: string; name: string; size: number };

function isVideo(name: string): boolean {
  const i = name.lastIndexOf('.');
  return i > 0 && VIDEO_EXTENSIONS.has(name.slice(i + 1).toLowerCase());
}

function collect(dir: Directory, depth: number, out: FolderVideo[]): void {
  for (const entry of dir.list()) {
    if (entry instanceof Directory) {
      if (depth < 6) collect(entry, depth + 1, out);
    } else if (entry instanceof File && isVideo(entry.name)) {
      out.push({ uri: entry.uri, name: entry.name, size: entry.size ?? 0 });
    }
  }
}

/**
 * HashPhotos' "Import Folder": the user picks a folder in Files (sub-folders
 * included) and every video in it is listed. Returns null when cancelled.
 * The files stay where they are - the import copies them.
 */
export async function pickVideoFolder(): Promise<{ name: string; videos: FolderVideo[] } | null> {
  let dir: Directory;
  try {
    dir = await Directory.pickDirectoryAsync();
  } catch (e) {
    console.log(`[FOLDER] picker closed: ${String(e)}`);
    return null;
  }
  const videos: FolderVideo[] = [];
  collect(dir, 0, videos);
  return { name: dir.name, videos };
}
