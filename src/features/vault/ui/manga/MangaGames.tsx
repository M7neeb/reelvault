/**
 * Games with your manga: a Knockout cup of covers, Zoom detective (a close-up
 * of a page zooms out: which manga?) and Put the pages in order. The screens
 * are the shared ones in ../gamesKit.tsx; best scores and the daily streak go
 * in the same place as the video games'.
 */

import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import type { MangaChapter } from '../../manga/mangaLogic';
import { emptyGames, parseGames, recordGame, type GameKind, type GamesState } from '../../games';
import { orderRound, zoomRound } from '../../gameRules';
import { CupGame, OrderGame, ZoomGame, type CupEntry } from '../gamesKit';
import type { IconName } from '../icons';
import { Row, Rows, SheetFrame } from '../sheets';
import { sheet, useStyles, type Palette } from '../theme';
import type { MangaActions, MangaUiSeries } from './mangaTypes';

type Kind = Extract<GameKind, 'mangaCup' | 'mangaZoom' | 'mangaOrder'>;

const GAMES: { kind: Kind; icon: IconName; tint: string; title: string; sub: string }[] = [
  { kind: 'mangaCup', icon: 'trophy', tint: '#FF5A36', title: 'Knockout cup', sub: 'Your manga in a bracket, two covers at a time.' },
  { kind: 'mangaZoom', icon: 'search', tint: '#30D158', title: 'Zoom detective', sub: 'A close-up of a page zooms out. Which manga?' },
  { kind: 'mangaOrder', icon: 'sort', tint: '#64D2FF', title: 'Put the pages in order', sub: 'Four pages of one chapter, shuffled.' },
];

const STATUS_LABEL: Record<string, string> = { reading: 'Reading', completed: 'Completed', planned: 'Plan to read', onHold: 'On hold', dropped: 'Dropped' };

export default function MangaGames({
  items,
  actions,
  games,
  onOpen,
  onClose,
}: {
  items: MangaUiSeries[];
  actions: Pick<MangaActions, 'loadPages'>;
  games: { load: () => Promise<string | null>; save: (json: string) => Promise<void> };
  onOpen: (s: MangaUiSeries) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const [state, setState] = useState<GamesState>(emptyGames());
  const [playing, setPlaying] = useState<Kind | null>(null);
  useEffect(() => {
    games
      .load()
      .then((j) => setState(parseGames(j)))
      .catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const live = useMemo(() => items.filter((s) => !s.deletedAt && !s.isPrivate), [items]);
  const byId = useMemo(() => new Map(live.map((s) => [s.id, s])), [live]);
  // Chapters with pages: the ones on the phone first (no waiting on a source).
  const withPages = useMemo(() => live.filter((s) => s.chapters.some((c) => c.pageCount >= 4 || c.sourceKey)), [live]);
  const onPhone = (s: MangaUiSeries) => s.chapters.filter((c) => c.folder && c.pageCount >= 4);
  const chapterOf = (s: MangaUiSeries): MangaChapter | null => {
    const local = onPhone(s);
    const list = local.length ? local : s.chapters.filter((c) => c.sourceKey);
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  };

  const entries = useMemo(
    () => new Map<string, CupEntry>(live.map((s) => [s.id, { id: s.id, title: s.title, sub: s.rating ? `Rated ${s.rating}` : undefined, pic: s.coverSource }])),
    [live]
  );
  const pools = useMemo(() => {
    const ids = (list: MangaUiSeries[]) => list.map((s) => s.id);
    const statuses = Object.keys(STATUS_LABEL).map((k) => ({ key: `status:${k}`, label: STATUS_LABEL[k], ids: ids(live.filter((s) => s.status === k)) }));
    const tags = new Map<string, string[]>();
    for (const s of live) for (const t of s.tags) tags.set(t, [...(tags.get(t) ?? []), s.id]);
    return [
      { key: 'all', label: 'All manga', ids: ids(live) },
      { key: 'fav', label: 'Rated 8+', ids: ids(live.filter((s) => s.rating >= 8)) },
      ...statuses,
      ...[...tags.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6).map(([t, list]) => ({ key: `tag:${t}`, label: `#${t}`, ids: list })),
    ].filter((x) => x.key === 'all' || x.ids.length >= 4);
  }, [live]);

  const pagesOf = async (s: MangaUiSeries) => {
    const c = chapterOf(s);
    if (!c) return null;
    const pages = await actions.loadPages(s, c).catch(() => []);
    return pages.length >= 4 ? { chapter: c, pages } : null;
  };
  const makeZoom = async () => {
    const r = zoomRound(withPages.map((s) => s.id));
    const s = r && byId.get(r.answer);
    if (!r || !s) return null;
    const got = await pagesOf(s);
    if (!got) return null;
    // A page from the middle of the chapter: the first ones are often credits or a title page.
    const { pages } = got;
    const page = pages[Math.floor(pages.length * (0.25 + Math.random() * 0.6))] ?? pages[0];
    return { pic: page, answer: r.answer, options: r.options.map((id) => ({ key: id, label: byId.get(id)!.title })), focus: r.focus };
  };
  const makeOrder = async () => {
    const s = withPages[Math.floor(Math.random() * withPages.length)];
    if (!s) return null;
    const got = await pagesOf(s);
    const r = got && orderRound(got.pages.length);
    if (!got || !r) return null;
    const ch = got.chapter;
    return {
      title: s.title,
      sub: `${ch.number !== null ? `Chapter ${ch.number}` : (ch.title ?? 'A chapter')}. Tap the pages in reading order.`,
      pics: r.shown.map((i) => ({ key: i, pic: got.pages[i] })),
      truth: r.truth,
    };
  };

  const can: Record<Kind, boolean> = { mangaCup: live.length >= 4, mangaZoom: withPages.length >= 4, mangaOrder: withPages.length >= 1 };
  const why: Record<Kind, string> = {
    mangaCup: 'Needs four or more manga.',
    mangaZoom: 'Needs four or more manga with chapters to read.',
    mangaOrder: 'Needs a chapter with four or more pages.',
  };
  const finish = (kind: Kind, score: number) => {
    const next = recordGame(state, kind, score, Date.now());
    setState(next);
    void games.save(JSON.stringify(next)).catch(() => undefined);
  };

  return (
    <SheetFrame page title={GAMES.find((g) => g.kind === playing)?.title ?? 'Games'} onClose={playing ? () => setPlaying(null) : onClose}>
      {!playing ? (
        <View style={styles.body}>
          <Text style={styles.lead}>
            {state.streak > 1 ? `${state.streak} days in a row. Play one today to keep it going.` : 'Little games with your own manga. The streak is shared with the video games.'}
          </Text>
          <Rows>
            {GAMES.map((g) => (
              <Row
                key={g.kind}
                icon={g.icon}
                tint={g.tint}
                title={g.title}
                sub={can[g.kind] ? `${g.sub}${state.best[g.kind] ? (g.kind === 'mangaCup' ? ` Cups played: ${state.best.mangaCup}` : ` Best: ${state.best[g.kind]}`) : ''}` : why[g.kind]}
                onPress={can[g.kind] ? () => setPlaying(g.kind) : undefined}
              />
            ))}
          </Rows>
        </View>
      ) : playing === 'mangaCup' ? (
        <CupGame
          entries={entries}
          pools={pools}
          videos={false}
          enableVideo={false}
          onFinished={() => finish('mangaCup', state.best.mangaCup + 1)}
          onOpen={(id) => byId.get(id) && onOpen(byId.get(id)!)}
        />
      ) : playing === 'mangaZoom' ? (
        <ZoomGame make={makeZoom} aspect={2 / 3} best={state.best.mangaZoom} intro="Which manga is this page from?" onDone={(s) => finish('mangaZoom', s)} />
      ) : (
        <OrderGame make={makeOrder} aspect={2 / 3} best={state.best.mangaOrder} onDone={(s) => finish('mangaOrder', s)} />
      )}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    body: { gap: 16 },
    lead: { color: p.textSoft, fontSize: 15, lineHeight: 21 },
  });
