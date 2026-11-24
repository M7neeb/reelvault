/**
 * The "Time to read" reminder, kept right from anywhere in the app: listening to a linked audiobook
 * in the Audio tab can reach the day's goal without Books ever being opened, and the evening
 * reminder must not come then. Planned again when the app goes to the background and when the
 * player pauses (the day's time is read fresh each time).
 */

import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { listeningAsReads } from '../../books/bookAudio';
import { dayGoal, reminderTimes } from '../../books/bookGoals';
import { planReadReminders } from '../../books/bookReminder';
import { todayByBook } from '../../books/bookStats';
import type { AudioData } from '../audio/audioTypes';
import { useAudioControlsOptional } from '../audio/playback';
import type { BooksData } from './bookTypes';

/** Whether today's reading goal is met, counting every book on the shelf (private ones too). */
export function goalMetToday(data: Pick<BooksData, 'items' | 'goals' | 'audioLinks'>, reads: Parameters<typeof todayByBook>[0], plays: Parameters<typeof listeningAsReads>[0], now: number): boolean {
  const all = [...reads, ...listeningAsReads(plays, data.audioLinks, reads)];
  const byBook = todayByBook(all, now);
  let ms = 0;
  for (const b of data.items) ms += byBook.get(b.id) ?? 0;
  return !!dayGoal(ms, data.goals.dailyMin)?.met;
}

export function useReadReminder(books: BooksData | undefined, audio: AudioData | undefined): void {
  const controls = useAudioControlsOptional();
  const playing = !!controls?.playing;
  const live = useRef({ books, audio });
  live.current = { books, audio };
  const [goals, loaded] = [books?.goals, !!books?.loaded];

  useEffect(() => {
    if (Platform.OS === 'web' || !loaded) return;
    let alive = true;
    const plan = async () => {
      const b = live.current.books;
      if (!b?.loaded) return;
      const [reads, plays] = await Promise.all([b.actions.loadReads().catch(() => []), live.current.audio?.actions.loadPlays().catch(() => []) ?? Promise.resolve([])]);
      if (!alive) return;
      const met = goalMetToday(b, reads, plays, Date.now());
      await planReadReminders(reminderTimes(b.goals, met, Date.now()), b.goals.dailyMin);
    };
    // The player writes the sitting as it pauses: give it a moment.
    const t = playing ? null : setTimeout(() => void plan().catch(() => undefined), 600);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') void plan().catch(() => undefined);
    });
    return () => {
      alive = false;
      if (t) clearTimeout(t);
      sub.remove();
    };
  }, [loaded, goals, playing]);
}
