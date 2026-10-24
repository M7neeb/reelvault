/**
 * AniList for one title: find it on AniList and link it, fill in what the
 * title is missing, and (signed in) keep your AniList list in step with what
 * you read here. Presentational only.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';

import type { AniListActions, AniListState } from '../../manga/anilistData';
import type { AniMedia } from '../../manga/anilistLogic';
import { tick } from '../haptics';
import Icon from '../Icon';
import { SheetFrame } from '../sheets';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { MangaUiSeries } from './mangaTypes';

const plain = (e: unknown) => String(e).replace(/^Error:\s*/, '');

export default function AniListSheet({
  series,
  state,
  actions,
  onOpenUrl,
  onClose,
}: {
  series: MangaUiSeries;
  state: AniListState;
  actions: AniListActions;
  onOpenUrl?: (url: string) => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const linkedId = state.links[series.id] ?? null;
  const [linked, setLinked] = useState<AniMedia | null>(null);
  const [q, setQ] = useState(series.title);
  const [results, setResults] = useState<AniMedia[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!linkedId) {
      setLinked(null);
      return;
    }
    let live = true;
    actions
      .get(linkedId)
      .then((m) => live && setLinked(m))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [linkedId, actions]);

  const run = async (label: string, job: () => Promise<string | void>) => {
    tick();
    setBusy(label);
    setNote(null);
    try {
      const msg = await job();
      if (msg) setNote(msg);
    } catch (e) {
      setNote(plain(e));
    } finally {
      setBusy(null);
    }
  };
  const search = () =>
    run('search', async () => {
      const r = await actions.search(q.trim() || series.title);
      setResults(r);
      if (!r.length) return 'Nothing on AniList by that name. Try the original or English title.';
    });
  // Search straight away when the title isn't linked yet.
  useEffect(() => {
    if (!linkedId) void search();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SheetFrame title="AniList" onClose={onClose}>
      {/* Account */}
      <View style={styles.card}>
        {state.user ? (
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Signed in as {state.user}</Text>
              <Text style={styles.meta}>
                {state.syncing ? 'Updating your AniList list…' : 'Linked titles update your AniList list as you read: status, chapters read and score.'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => run('out', actions.signOut)} hitSlop={8}>
              <Text style={[styles.link, { color: p.textSecondary }]}>Sign out</Text>
            </TouchableOpacity>
          </View>
        ) : state.configured ? (
          <>
            <Text style={styles.cardTitle}>Keep your AniList list up to date</Text>
            <Text style={styles.meta}>Sign in once; linked titles then update on AniList by themselves as you read.</Text>
            <TouchableOpacity style={[styles.btn, { backgroundColor: p.accent }]} onPress={() => run('in', actions.signIn)} disabled={!!busy}>
              {busy === 'in' ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Sign in to AniList</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.cardTitle}>Updating your AniList list isn't set up yet</Text>
            <Text style={styles.meta}>
              Finding titles and filling in their details works now. To also update your AniList list, this build needs an AniList app ID (free): anilist.co → Settings →
              Developer → Create New Client, redirect URL reelvault://auth/anilist.
            </Text>
          </>
        )}
        {state.error && <Text style={styles.error}>{state.error}</Text>}
      </View>

      {/* Linked */}
      {linkedId && (
        <View style={styles.card}>
          <Text style={styles.section}>Linked to</Text>
          <View style={styles.result}>
            <Cover uri={linked?.cover ?? null} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {linked?.title ?? `AniList #${linkedId}`}
              </Text>
              {linked && <Text style={styles.meta}>{describe(linked)}</Text>}
            </View>
          </View>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.smallBtn} onPress={() => run('fill', async () => (await actions.fill(series.id), 'Filled in what was missing.'))} disabled={!!busy}>
              {busy === 'fill' ? <ActivityIndicator color={p.text} /> : <Text style={styles.smallText}>Fill in details</Text>}
            </TouchableOpacity>
            {state.user && (
              <TouchableOpacity style={styles.smallBtn} onPress={() => run('sync', async () => (await actions.syncNow(series.id), 'Sent to AniList.'))} disabled={!!busy}>
                {busy === 'sync' ? <ActivityIndicator color={p.text} /> : <Text style={styles.smallText}>Update now</Text>}
              </TouchableOpacity>
            )}
            {onOpenUrl && (
              <TouchableOpacity style={styles.smallBtn} onPress={() => onOpenUrl(linked?.url ?? `https://anilist.co/manga/${linkedId}`)}>
                <Text style={styles.smallText}>Open</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.smallBtn} onPress={() => run('unlink', () => actions.unlink(series.id))} disabled={!!busy}>
              <Text style={[styles.smallText, { color: p.danger }]}>Unlink</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {note && <Text style={styles.note}>{note}</Text>}

      {/* Search */}
      <Text style={styles.section}>{linkedId ? 'Link to a different title' : 'Find it on AniList'}</Text>
      <View style={styles.searchBox}>
        <Icon name="search" size={15} color={p.textMuted} />
        <TextInput
          style={styles.input}
          value={q}
          onChangeText={setQ}
          onSubmitEditing={search}
          returnKeyType="search"
          placeholder="Title"
          placeholderTextColor={p.textMuted}
          keyboardAppearance={p.scheme}
          autoCorrect={false}
        />
        {busy === 'search' && <ActivityIndicator color={p.textSecondary} />}
      </View>
      {results?.map((m) => (
        <TouchableOpacity
          key={m.id}
          style={[styles.result, styles.resultRow, m.id === linkedId && { borderColor: p.accent }]}
          onPress={() =>
            run('link', async () => {
              const marked = await actions.link(series.id, m);
              setResults(null);
              return marked ? `Linked. ${marked} ${marked === 1 ? 'chapter' : 'chapters'} marked read, as on AniList.` : 'Linked.';
            })
          }>
          <Cover uri={m.cover} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {m.title}
            </Text>
            {!!m.altTitles[0] && (
              <Text style={styles.meta} numberOfLines={1}>
                {m.altTitles[0]}
              </Text>
            )}
            <Text style={styles.meta}>{describe(m)}</Text>
          </View>
          {m.id === linkedId ? <Icon name="checkCircle" size={18} color={p.accent} /> : <Icon name="link" size={15} color={p.textMuted} />}
        </TouchableOpacity>
      ))}
      <Text style={styles.footer}>Title information from AniList.</Text>
    </SheetFrame>
  );
}

function describe(m: AniMedia): string {
  const fmt = m.format === 'ONE_SHOT' ? 'One shot' : m.format === 'NOVEL' ? 'Novel' : m.country === 'KR' ? 'Manhwa' : m.country === 'CN' ? 'Manhua' : 'Manga';
  return [fmt, m.year, m.chapters ? `${m.chapters} ch` : m.status === 'RELEASING' ? 'ongoing' : null, m.averageScore ? `${m.averageScore}%` : null].filter(Boolean).join(' · ');
}

function Cover({ uri }: { uri: string | null }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return <View style={styles.cover}>{uri ? <Image source={{ uri }} style={styles.cover} contentFit="cover" /> : <Icon name="bookOpen" size={16} color={p.textMuted} />}</View>;
}

const makeStyles = (p: Palette) =>
  sheet({
    card: { backgroundColor: p.card, borderRadius: 14, padding: 14, gap: 8, marginBottom: 12 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    cardTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    meta: { color: p.textSecondary, fontSize: 13, lineHeight: 18 },
    link: { color: p.accent, fontSize: 14, fontWeight: '700' },
    error: { color: p.dangerText, fontSize: 13 },
    btn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
    btnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
    btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    smallBtn: { backgroundColor: p.elevated, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minWidth: 60, alignItems: 'center' },
    smallText: { color: p.text, fontSize: 13, fontWeight: '700' },
    section: { color: p.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 4, marginBottom: 6 },
    note: { color: p.text, fontSize: 14, marginBottom: 10 },
    searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 12, marginBottom: 8 },
    input: { flex: 1, color: p.text, fontSize: 16, paddingVertical: 11 },
    result: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    resultRow: { backgroundColor: p.card, borderRadius: 12, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: 'transparent' },
    cover: { width: 44, height: 64, borderRadius: 6, overflow: 'hidden', backgroundColor: p.elevated, alignItems: 'center', justifyContent: 'center' },
    footer: { color: p.textMuted, fontSize: 12, textAlign: 'center', marginTop: 10 },
  });
