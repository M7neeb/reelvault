/** Search in Settings: which section a few typed words point to. */

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '');

export function matchesSetting(query: string, terms: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(terms);
  return words.every((w) => hay.includes(w));
}

/** The words each Settings section answers to, besides its own title. */
export const SETTINGS_TERMS = {
  personalise: 'personalise personalize layout accent colour color app icon rating words theme look font dark light',
  covers: 'covers cover thumbnail thumbnails best frame picture',
  private: 'private album passcode password face id fake lock hide hidden',
  log: 'who tried to get in wrong passcode log attempts',
  import: 'import folder make smaller compress quality size space',
  backup: 'backup export restore info file spreadsheet csv',
  data: 'your data export zip all data stats spreadsheets json',
  autobackups: 'weekly backups automatic restore copies',
  daily: 'daily notification notifications digest reminder reminders time morning evening',
  help: "help what's new whats new update updates changes report a problem bug crash broken",
} as const;

export type SettingsSection = keyof typeof SETTINGS_TERMS;
