/**
 * This season's anime: a shelf on the Anime tab and a full chart page
 * (new this season / long runners), best score first, add with one tap.
 * Data: Simkl's anime calendar file.
 */

import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { tick, success } from '@/features/vault/ui/haptics';
import Icon from '@/features/vault/ui/Icon';
import { Segment, SheetFrame } from '@/features/vault/ui/sheets';
import { raised, sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';
import { seasonOf, type CatalogTitle, type SeasonAnime, type SimklItem } from '../logic';
import EmptyState from '@/features/vault/ui/EmptyState';
import Poster from './Poster';
import type { SimklActions } from './types';

export const asCatalog = (a: SeasonAnime): CatalogTitle => ({ simklId: a.simklId, type: 'anime', title: a.title, year: a.year, poster: a.poster, slug: a.slug });

function nextLine(a: SeasonAnime, now: number): string | null {
  if (!a.nextDate) return null;
  const t = Date.parse(a.nextDate);
  if (!Number.isFinite(t)) return null;
  const days = Math.round((new Date(t).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  const when = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : days < 7 ? new Date(t).toLocaleDateString(undefined, { weekday: 'long' }) : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return a.nextEpisode ? `Episode ${a.nextEpisode} ${when}` : `Next ${when}`;
}

/** Loads the chart once; null while loading, [] when it couldn't. */
export function useSeason(actions: SimklActions, on: boolean): SeasonAnime[] | null {
  const [list, setList] = useState<SeasonAnime[] | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    actions
      .loadSeason()
      .then((l) => live && setList(l))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [actions, on]);
  return list;
}

export function SeasonShelf({ list, library, onOpen, onChart }: { list: SeasonAnime[]; library: SimklItem[]; onOpen: (a: SeasonAnime) => void; onChart: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const mine = useMemo(() => new Set(library.map((i) => i.simklId)), [library]);
  const top = list.filter((a) => a.isNew).slice(0, 12);
  if (!top.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
      {top.map((a, i) => (
        <TouchableOpacity key={a.simklId} style={styles.shelfItem} onPress={() => onOpen(a)} accessibilityRole="button" accessibilityLabel={`${i + 1}. ${a.title}`}>
          <Poster path={a.poster} title={a.title} width={112} height={168} radius={12}>
            {mine.has(a.simklId) && (
              <View style={styles.inList}>
                <Icon name="check" size={11} color="#fff" weight="bold" />
              </View>
            )}
          </Poster>
          <Text style={styles.shelfTitle} numberOfLines={2}>
            {a.title}
          </Text>
          {a.score !== null && (
            <View style={styles.scoreRow}>
              <Icon name="star" size={11} color={p.rating} />
              <Text style={styles.scoreText}>{a.score.toFixed(1)}</Text>
            </View>
          )}
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.shelfMore} onPress={onChart} accessibilityRole="button">
        <View style={styles.moreCircle}>
          <Icon name="forward" size={16} color={p.text} weight="bold" />
        </View>
        <Text style={styles.moreText}>Whole chart</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

export function SeasonModal({
  list,
  library,
  actions,
  onOpen,
  onClose,
}: {
  list: SeasonAnime[] | null;
  library: SimklItem[];
  actions: SimklActions;
  onOpen: (a: SeasonAnime) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const now = Date.now();
  const [tab, setTab] = useState<'new' | 'old'>('new');
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const mine = useMemo(() => new Set(library.filter((i) => i.type === 'anime').map((i) => i.simklId)), [library]);
  const shown = (list ?? []).filter((a) => (tab === 'new' ? a.isNew : !a.isNew));
  const add = async (a: SeasonAnime) => {
    tick();
    setBusy(a.simklId);
    try {
      await actions.addToLibrary(asCatalog(a), 'plantowatch');
      success();
      setAdded((s) => new Set(s).add(a.simklId));
    } finally {
      setBusy(null);
    }
  };
  return (
    <SheetFrame page title={seasonOf(now).label} onClose={onClose}>
      <Text style={styles.lead}>Anime airing now, best rated first. Add one and it lands in Plan to Watch.</Text>
      <Segment
        options={[
          { key: 'new', label: `New (${(list ?? []).filter((a) => a.isNew).length})` },
          { key: 'old', label: `Still running (${(list ?? []).filter((a) => !a.isNew).length})` },
        ]}
        value={tab}
        onChange={setTab}
      />
      {list === null ? (
        <View style={[styles.list, { backgroundColor: raised(p) }]}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.row, i > 0 && styles.line]}>
              <View style={[styles.ghostPoster, { backgroundColor: p.tile }]} />
              <View style={{ flex: 1, gap: 8 }}>
                <View style={[styles.ghostLine, { width: '70%', backgroundColor: p.tile }]} />
                <View style={[styles.ghostLine, { width: '45%', backgroundColor: p.tile }]} />
              </View>
            </View>
          ))}
        </View>
      ) : shown.length === 0 ? (
        <EmptyState
          icon="anime"
          title={list.length ? 'Nothing here this season' : "Couldn't load the season"}
          text={list.length ? 'Try the other tab.' : 'Check the connection and open it again.'}
          tint={p.textSecondary}
        />
      ) : (
        <View style={[styles.list, { backgroundColor: raised(p) }]}>
          {shown.map((a, i) => {
            const have = mine.has(a.simklId) || added.has(a.simklId);
            const meta = [a.genres.slice(0, 2).join(', '), a.totalEpisodes ? `${a.totalEpisodes} eps` : null].filter(Boolean).join(' · ');
            const next = nextLine(a, now);
            return (
              <TouchableOpacity key={a.simklId} style={[styles.row, i > 0 && styles.line]} onPress={() => onOpen(a)} accessibilityRole="button">
                <Text style={[styles.place, i < 3 && styles.placeTop]}>{i + 1}</Text>
                <Poster path={a.poster} title={a.title} width={52} height={78} radius={8} hideTitle />
                <View style={styles.text}>
                  <Text style={styles.title} numberOfLines={2}>
                    {a.title}
                  </Text>
                  {!!meta && (
                    <Text style={styles.sub} numberOfLines={1}>
                      {meta}
                    </Text>
                  )}
                  <View style={styles.subRow}>
                    {a.score !== null && (
                      <>
                        <Icon name="star" size={11} color={p.rating} />
                        <Text style={styles.score}>{a.score.toFixed(1)}</Text>
                      </>
                    )}
                    {!!next && <Text style={styles.sub}>{a.score !== null ? ` · ${next}` : next}</Text>}
                  </View>
                </View>
                <TouchableOpacity
                  style={[styles.add, have && styles.added]}
                  disabled={have || busy !== null}
                  onPress={() => void add(a)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={have ? `${a.title} is in your list` : `Add ${a.title} to Plan to Watch`}>
                  <Icon name={have ? 'check' : 'plus'} size={14} color={have ? p.success : p.text} weight="bold" />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      <Text style={styles.credit}>Anime data from Simkl</Text>
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    shelf: { paddingHorizontal: 16, gap: 12 },
    shelfItem: { width: 112, gap: 6 },
    shelfTitle: { color: p.text, fontSize: 14, fontWeight: '600', lineHeight: 18 },
    scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    scoreText: { color: p.textSecondary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
    inList: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: p.success, alignItems: 'center', justifyContent: 'center' },
    shelfMore: { width: 92, height: 168, alignItems: 'center', justifyContent: 'center', gap: 8 },
    moreCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: raised(p), alignItems: 'center', justifyContent: 'center' },
    moreText: { color: p.text, fontSize: 13, fontWeight: '600' },
    lead: { color: p.textSoft, fontSize: 15, lineHeight: 21, marginBottom: 14 },
    list: { borderRadius: 18, overflow: 'hidden', marginTop: 16 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
    line: { borderTopWidth: 0.5, borderTopColor: p.separator },
    place: { width: 24, color: p.textSecondary, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'], textAlign: 'right' },
    placeTop: { color: p.text, fontWeight: '900' },
    text: { flex: 1, minWidth: 0, gap: 3 },
    title: { color: p.text, fontSize: 16, fontWeight: '700' },
    sub: { color: p.textSecondary, fontSize: 13 },
    subRow: { flexDirection: 'row', alignItems: 'center', gap: 3, flexWrap: 'wrap' },
    score: { color: p.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
    add: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: p.scheme === 'light' ? p.card : p.circle },
    added: { backgroundColor: 'transparent' },
    ghostPoster: { width: 52, height: 78, borderRadius: 8 },
    ghostLine: { height: 12, borderRadius: 6 },
    empty: { alignItems: 'center', gap: 8, paddingVertical: 32, paddingHorizontal: 20 },
    emptyIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
    emptyTitle: { color: p.text, fontSize: 20, fontWeight: '800', textAlign: 'center' },
    emptyText: { color: p.textSecondary, fontSize: 15, textAlign: 'center' },
    credit: { color: p.textMuted, fontSize: 12, textAlign: 'center', marginTop: 16 },
  });
