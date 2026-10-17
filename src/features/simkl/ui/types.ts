/**
 * What the Simkl screens get. Like the vault UI, nothing in `simkl/ui/` imports
 * a native module: plain data and callbacks, so the same screens render in the
 * browser preview (`/preview?cat=shows`) and on the phone.
 */

import type { SimklPlan, Timeframe } from '../actions';
import type { Meta, Play, Session, WatchEvent } from '../insights';
import type { ReminderSettings } from '../reminders';
import type {
  CatalogEpisode,
  CatalogTitle,
  SimklItem,
  SimklStatus,
  SimklType,
  WatchedEpisode,
} from '../logic';

export type {
  CatalogEpisode,
  CatalogTitle,
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
  /** The library as a CSV file, through the share sheet. */
  exportCsv: () => Promise<void>;
  openUrl: (url: string) => void;
};

export type SimklScreenProps = {
  category: Exclude<Category, 'videos'>;
  /** The Videos · Movies · Shows · Anime switcher, drawn at the top. */
  categoryBar: React.ReactNode;
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
    accountOpen?: boolean;
    insightsTab?: 'overview' | 'review';
    rewatchOpen?: boolean;
    ratingOpen?: boolean;
    grid?: boolean;
    connectCode?: ConnectCode;
  };
};
