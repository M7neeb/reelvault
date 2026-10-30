/**
 * What the Simkl screens get. Like the vault UI, nothing in `simkl/ui/` imports
 * a native module: plain data and callbacks, so the same screens render in the
 * browser preview (`/preview?cat=shows`) and on the phone.
 */

import type { ScrobbleTarget, SimklPlan, Timeframe } from '../actions';
import type { ListEntry, SimklList, VideoLink } from '../collections';
import type { EpisodeRatings } from '../episodeRatings';
import type { ImportResult } from '../imports';
import type { Meta, Play, Session, WatchEvent } from '../insights';
import type { ReminderSettings } from '../reminders';
import type {
  CatalogEpisode,
  CatalogTitle,
  PausedItem,
  SimklItem,
  SimklSort,
  SimklStatus,
  SimklType,
  WatchedEpisode,
} from '../logic';

export type {
  ImportResult,
  ListEntry,
  SimklList,
  VideoLink,
  CatalogEpisode,
  CatalogTitle,
  PausedItem,
  Meta,
  Play,
  ReminderSettings,
  Session,
  SimklItem,
  SimklPlan,
  SimklStatus,
  SimklType,
  Timeframe,
  WatchedEpisode,
  WatchEvent,
};

export type Category = 'videos' | 'movie' | 'show' | 'anime';

export type SimklPrefs = {
  /** Blur titles, pictures and summaries of episodes you have not watched yet. */
  hideSpoilers: boolean;
  /** The last sort and status picked in each tab (Movies, Shows, Anime), kept across launches. */
  view?: SimklView;
};

export type SimklView = Partial<Record<SimklType, { sort?: SimklSort; status?: SimklStatus | 'all' }>>;

/**
 * What the Videos tab gets from Simkl: link one of your videos to a movie or an
 * episode, then scrobble while it plays (finishing it marks it watched).
 */
export type SimklBridge = {
  connected: boolean;
  search: (type: SimklType, q: string) => Promise<CatalogTitle[]>;
  loadEpisodes: (type: SimklType, id: number) => Promise<CatalogEpisode[]>;
  links: () => Promise<Map<string, VideoLink>>;
  setLink: (videoId: string, link: Omit<VideoLink, 'videoId' | 'linkedAt' | 'loggedAt'> | null) => Promise<void>;
  /** Watch history and lists, for Wrapped and badges on the Videos side. */
  insights: () => Promise<{ events: WatchEvent[]; items: SimklItem[]; meta: Map<number, Meta>; lists: number }>;
  scrobble: (
    videoId: string,
    link: ScrobbleTarget,
    action: 'start' | 'pause' | 'stop',
    progress: number
  ) => Promise<'watched' | 'paused' | 'playing' | 'already'>;
};

export type SimklDetailInfo = {
  overview: string | null;
  genres: string[];
  network: string | null;
  certification: string | null;
  runtime: number | null;
  status: string | null;
  fanart: string | null;
  poster: string | null;
  year: number | null;
  totalEpisodes: number | null;
  simklRating: number | null;
  simklVotes: number | null;
  imdbRating: number | null;
  imdbVotes: number | null;
  malRating: number | null;
  malVotes: number | null;
  rank: number | null;
  firstAired: string | null;
  years: string | null;
  language: string | null;
  country: string | null;
  trailer: string | null;
  imdb?: string | null;
  related: CatalogTitle[];
};

/** The device code to show while signing in. */
export type ConnectCode = { code: string; url: string };

export type SimklActions = {
  /** Shows the code through `onCode`, resolves true once approved (false = cancelled / expired). */
  connect: (onCode: (code: ConnectCode) => void) => Promise<boolean>;
  cancelConnect: () => void;
  disconnect: () => Promise<void>;
  /** force = pull-to-refresh */
  sync: (force: boolean) => Promise<void>;
  setStatus: (item: SimklItem, status: SimklStatus) => Promise<void>;
  setRating: (item: SimklItem, rating: number | null) => Promise<void>;
  setEpisodes: (item: SimklItem, episodes: { season: number; episode: number }[], watched: boolean) => Promise<void>;
  markMovieWatched: (item: SimklItem) => Promise<void>;
  addToLibrary: (title: CatalogTitle, status: SimklStatus) => Promise<void>;
  remove: (item: SimklItem) => Promise<void>;
  loadDetail: (type: SimklType, id: number) => Promise<SimklDetailInfo>;
  loadEpisodes: (type: SimklType, id: number) => Promise<CatalogEpisode[]>;
  loadWatched: (id: number) => Promise<WatchedEpisode[]>;
  /** IMDb (with an OMDb key) or TVmaze ratings for single episodes. */
  loadEpisodeRatings: (type: SimklType, id: number, episodes: CatalogEpisode[]) => Promise<EpisodeRatings>;
  /** Whether an OMDb key is saved, and saving one ('' removes it; returns the problem or null). */
  hasOmdbKey: () => Promise<boolean>;
  saveOmdbKey: (key: string) => Promise<string | null>;
  search: (type: SimklType, q: string) => Promise<CatalogTitle[]>;
  trending: (type: SimklType, timeframe: Timeframe) => Promise<CatalogTitle[]>;
  calendar: (type: SimklType) => Promise<CatalogTitle[]>;
  /** Every recorded watch time, for the Stats heatmap. */
  watchTimes: () => Promise<(string | null)[]>;
  /** Every watch with its runtime, plus genres / networks, for Stats and the review. */
  loadInsights: () => Promise<{ events: WatchEvent[]; meta: Map<number, Meta> }>;
  /** Fetch genres / networks for titles that have none yet (one after another). */
  fillMeta: (onProgress: (done: number, total: number) => void) => Promise<number>;
  /** Rewatches, logged in ReelVault (and on Simkl too for PRO / VIP when switched on). */
  loadSessions: (id: number) => Promise<Session[]>;
  loadPlays: (id: number) => Promise<Play[]>;
  startRewatch: (item: SimklItem) => Promise<Session>;
  endRewatch: (item: SimklItem, session: Session, finished: boolean) => Promise<void>;
  deleteRewatch: (session: Session) => Promise<void>;
  /** watched=false undoes the latest one. Movies ignore `episodes`. */
  logRewatch: (item: SimklItem, episodes: { season: number; episode: number }[], session: Session | null, watched?: boolean) => Promise<void>;
  getRewatchSync: () => Promise<{ on: boolean; plan: SimklPlan }>;
  setRewatchSync: (on: boolean) => Promise<{ ok: boolean; plan: SimklPlan }>;
  /** Notifications for new episodes and releases. setReminders resolves false when iOS permission was refused. */
  getReminders: () => Promise<ReminderSettings>;
  setReminders: (s: ReminderSettings) => Promise<boolean>;
  /** Franchise watch order (Wikidata) and each entry's Simkl title. */
  loadFranchises: (type: SimklType, id: number) => Promise<import('../franchise').Franchise[]>;
  matchFranchise: (entries: import('../franchise').FranchiseEntry[]) => Promise<import('../franchise').FranchiseItem[]>;
  /** The library as a CSV file, through the share sheet. */
  exportCsv: () => Promise<void>;
  /** Movies and episodes you stopped halfway (Simkl's paused sessions). */
  loadPlayback?: () => Promise<PausedItem[]>;
  deletePlayback?: (playbackId: number) => Promise<void>;
  /** Your own lists (kept in ReelVault). */
  createList: (name: string, icon: string | null) => Promise<number>;
  updateList: (id: number, name: string, icon: string | null) => Promise<void>;
  deleteList: (id: number) => Promise<void>;
  listEntries: (id: number) => Promise<ListEntry[]>;
  setInList: (listId: number, title: CatalogTitle, on: boolean) => Promise<void>;
  /** Many titles at once; resolves with how many were new to the list. */
  addManyToList: (listId: number, titles: CatalogTitle[]) => Promise<number>;
  /** Takes the picked titles out of the list (they stay in your library). */
  removeManyFromList: (listId: number, simklIds: number[]) => Promise<void>;
  /** Looked up on Google (or not). */
  setSearched: (listId: number, simklId: number, on: boolean) => Promise<void>;
  /** Pick an IMDb / Letterboxd CSV and send it to Simkl. null = cancelled, 'unknown' = not a known export. */
  importFile: (onProgress: (done: number, total: number) => void) => Promise<ImportResult | null | 'unknown'>;
  /** Upcoming episodes as an .ics file through the share sheet; resolves how many. */
  exportCalendar: () => Promise<number>;
  setPrefs: (p: SimklPrefs) => Promise<void>;
  openUrl: (url: string) => void;
};

export type SimklScreenProps = {
  category: Exclude<Category, 'videos'>;
  /** Your own lists, shown as a shelf. */
  lists?: SimklList[];
  /** Settings → Personalise → Layout (shared with the Videos tab). */
  look?: import('@/features/vault/ui/types').Look;
  prefs?: SimklPrefs;
  /** A client id is built in. */
  configured: boolean;
  connected: boolean;
  items: SimklItem[];
  syncing: boolean;
  status: string;
  lastSyncAt: number | null;
  actions: SimklActions;
  /** A tapped notification: open this title. */
  openRequest?: { simklId: number; type: SimklType } | null;
  onOpenHandled?: () => void;
  /** Preview only. */
  devInitialState?: {
    detailId?: number;
    episodesOpen?: boolean;
    discoverOpen?: boolean;
    calendarOpen?: boolean;
    statsOpen?: boolean;
    dashboardOpen?: boolean;
    /** The dashboard with this year's Wrapped playing. */
    wrappedOpen?: boolean;
    accountOpen?: boolean;
    insightsTab?: 'overview' | 'review';
    rewatchOpen?: boolean;
    ratingOpen?: boolean;
    grid?: boolean;
    connectCode?: ConnectCode;
    listOpen?: number;
    /** The open list starts on "Add many". */
    addManyOpen?: boolean;
    pickOpen?: boolean;
    importOpen?: boolean;
    addToListOpen?: boolean;
  };
};
