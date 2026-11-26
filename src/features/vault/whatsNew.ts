/**
 * What's new: a short list per update, shown once after the update arrives
 * (and kept under Settings). Newest first; the id is the release date.
 */

export type Release = { id: string; title: string; items: string[] };

export const WHATS_NEW_KEY = 'whatsNew.seen';

export const RELEASES: Release[] = [
  {
    id: '2026-11-28',
    title: 'Rank videos play again',
    items: [
      'Rank videos: both clips play again, and the grid\'s previews pause while you rank.',
      'Each clip has a speaker button for its sound. Turning one on mutes the other.',
      'The Library panel: the grid behind it stops its previews while the panel is open, so taps on the right-hand Browse buttons should land.',
    ],
  },
  {
    id: '2026-11-27',
    title: 'Creators',
    items: [
      'Creators: who made a video, kept apart from your keywords. Select videos, Edit, Creator. Library panel, Creators shows them with their counts; tap one for all their videos.',
      'Search @name on the Videos tab, or type a name in the Search tab. A video\'s Info shows who made it.',
      'ReelVault reads creators from file names like "@name_123.mp4" or "name - title.mp4" and suggests them (Library panel, Creators, Manage). Nothing is added until you tap Add.',
      'Tapping a playing video hides the controls again (and taps work in the slideshow and Memories while they play).',
    ],
  },
  {
    id: '2026-11-26',
    title: 'A new look, and Find the intro',
    items: [
      'Trim Start & End has Find the intro: it compares episodes next to each other by name and cuts each one exactly where its own intro ends.',
      'Filter videos by what they have or don\'t: a rating, your own cover, keywords, an album, a series, a title, notes, plays, text on screen, a Simkl link (Library panel, Filter videos). Save it as a smart filter to keep it.',
      'Skip intro: in a series, a button shows while the intro plays and jumps past it.',
      'Searching for words written in your videos now always tells you what it found, or how many videos it has read so far, instead of showing nothing.',
      'With the new app build, text on screen is read much more carefully, and the first two minutes of every video closely, so titles in intros are found. Your videos are read once more by themselves.',
      'A new look: your library as a shelf of box sets. Every series, show, book, audiobook and manga has its own spine colour down its edge; episodes carry big numbers; titles are set in a narrow display face; corners are tighter and the accent is a deep red (Personalise has the others).',
      'Your shelf (Watch and Overview): your series standing side by side with their episode count and how far you are. The one you are watching stands pulled out; tap one and it slides off the shelf.',
      'Posters, covers, shelves and cards dip a little under your finger, and the select tick pops in.',
    ],
  },
  {
    id: '2026-11-25b',
    title: 'Clips, games and smarter series',
    items: [
      'Search a word that is written in your videos (Search tab): "on screen in 37 videos", then Select all, and ••• Trim Start & End cuts the same seconds off every one.',
      'New videos named like a series you made ("series beries 4") join it by themselves. Overview, Belong together?, See all: Group or Not a series for every name.',
      'Next episode: in a series, a Next episode button with a countdown shows when the ending the episodes share starts (else in the last 15 seconds).',
      'Clips: your videos of three minutes or less in a feed you swipe up through (Library panel, Clips). Double tap to make one a favourite.',
      'Games: Which episode is this?, Higher or lower and Name that show (Library panel, Games).',
      'Switches, tabs and deleting now give the same small taps everywhere.',
    ],
  },
  {
    id: '2026-11-25',
    title: 'Rank your favourites, and more',
    items: [
      'Rank your videos, films, shows and anime two at a time. Your ratings change only when you tap Apply. Videos: Library panel, Rank your videos. The others: the card on their tab.',
      'Anime: what is airing this season, best rated first, with one tap to add.',
      'Shows and Anime: the ones you stopped watching two months ago ask whether to carry on, pause or drop them.',
      'Pick for me takes a mood (light, tense, dark, moving) and can stick to well rated titles.',
      'Videos pick up where you stopped with a short rewind after a short break and a longer one after a long break.',
      'Books: turn pages by tapping the edges, sliding or fading (Look, in the reader).',
      'Settings has a search box, this page, and Report a problem.',
      'One daily notification can replace the separate ones, at a time you choose.',
      'The Upcoming calendar, This week and the calendar export show what is coming again.',
      'Empty lists and loading pages look like the rest of the app.',
      'With the new app build: join videos into one (select them, Edit, Join into one video) and have books without an audiobook read aloud (the speaker button in the reader).',
    ],
  },
  {
    id: '2026-11-24',
    title: 'Covers, Settings and search',
    items: [
      'Videos without a cover you chose get the best frame as their cover, by themselves (Settings, Covers).',
      'New Settings page, Library panel, menus, Overview, Timeline, passcode screen and Compare.',
      'Search has All, Videos, Shows, Movies, Anime and My library, and looks on Simkl as you type.',
    ],
  },
];

/** The releases to show: newer than the last one seen; only the newest if nothing was ever seen. */
export function toShow(releases: Release[], seen: string | null): Release[] {
  if (!releases.length) return [];
  if (!seen) return [releases[0]];
  return releases.filter((r) => r.id > seen);
}
