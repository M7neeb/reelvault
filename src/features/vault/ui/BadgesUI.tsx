/**
 * Badges, records and your story: your level (XP from badges and watching),
 * a showcase of the three badges you are proudest of, this month's challenge,
 * personal records on the pictures of the videos that set them, badges almost
 * done, badges just earned (with the video that earned them), your journey in
 * dates, and every badge by group (secret ones show "???" until earned).
 * Tap a badge for what it takes, every step of its ladder and the video
 * behind it. Presentational only; achievements.ts and recap.ts work it out.
 */

import { useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { summarize, TIER_NAMES, type AchGroup, type Achievement } from '../achievements';
import type { Milestone, Record_ } from '../recap';
import { success, tick } from './haptics';
import Icon from './Icon';
import { Card, gradient, iconOr, Medallion, PhotoCard, Ring, SectionTitle, ShareBar, TIER_COLORS } from './insightParts';
import { enterUp, PressableScale, SPRING_POP } from './motion';
import { SheetFrame } from './sheets';
import { sheet, usePalette, useStyles, type Palette } from './theme';
import type { VaultItem } from './types';

const GROUPS: { key: AchGroup; blurb: string }[] = [
  { key: 'Watching', blurb: 'Time spent with your videos' },
  { key: 'Habits', blurb: 'When and how often you watch' },
  { key: 'Library', blurb: 'What you collect and rate' },
  { key: 'Organising', blurb: 'Keywords, albums, captions and series' },
  { key: 'Simkl', blurb: 'Movies, shows and anime' },
];

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const num = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));
const progressText = (a: Achievement) => `${num(Math.min(a.current, a.target))} / ${num(a.target)}${a.unit ? ` ${a.unit}` : ''}`;
const hidden = (a: Achievement) => !!a.secret && !a.unlocked;

export type Level = { xp: number; level: number; title: string; into: number; need: number };

export default function Badges({
  list,
  all,
  simkl,
  level,
  records,
  milestones,
  thumbs,
  showcase,
  onShowcase,
  onOpenVideo,
}: {
  list: Achievement[];
  /** The same, with every step of every ladder (for a badge's page). */
  all: Achievement[];
  simkl: boolean;
  level: Level;
  records: Record_[];
  milestones: Milestone[];
  thumbs: Map<string, VaultItem['thumbSource']>;
  /** Pinned badge ids (up to three). */
  showcase: string[];
  onShowcase: (ids: string[]) => void;
  onOpenVideo: (id: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState<Achievement | null>(null);
  const [picking, setPicking] = useState(false);
  const [showAllJourney, setShowAllJourney] = useState(false);
  const s = useMemo(() => summarize(list), [list]);
  const month = list.find((a) => a.kind === 'monthly' && a.id === currentMonthId());
  const pastMonths = list.filter((a) => a.kind === 'monthly' && a.unlocked && a.id !== currentMonthId());
  const tierCounts = [1, 2, 3, 4, 5].map((t) => list.filter((a) => a.unlocked && a.tier === t).length);
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).getTime();
  const daysLeft = Math.max(0, Math.ceil((monthEnd - Date.now()) / 86_400_000));
  const earned = list.filter((a) => a.unlocked);
  // The showcase: what you pinned, else your three best (highest tier, then newest).
  const pinned = (showcase.length ? showcase.map((id) => earned.find((a) => a.id === id)).filter((a): a is Achievement => !!a) : [])
    .concat(showcase.length ? [] : [...earned].sort((a, b) => b.tier - a.tier || (b.earnedAt ?? 0) - (a.earnedAt ?? 0)).slice(0, 3))
    .slice(0, 3);
  const cardW = Math.min(240, (width - 32 - 10) / 1.6);
  const journey = showAllJourney ? milestones : milestones.slice(0, 6);

  return (
    <>
      {/* ── level ──────────────────────────────────────────────── */}
      <Animated.View entering={enterUp(0)} style={[styles.hero, gradient('linear-gradient(140deg, #5E5CE6 0%, #2B1A6E 60%, #120A33 100%)')]}>
        <Ring size={104} stroke={9} progress={level.into / level.need} color="#FFD60A" track="rgba(255,255,255,0.18)">
          <Text style={styles.levelNum}>{level.level}</Text>
          <Text style={styles.levelWord}>LEVEL</Text>
        </Ring>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.heroKicker}>YOU ARE A</Text>
          <Text style={styles.heroTitle}>{level.title}</Text>
          <Text style={styles.heroSub}>
            {level.into.toLocaleString()} / {level.need.toLocaleString()} XP to level {level.level + 1}
          </Text>
          <View style={styles.tierRow}>
            {tierCounts.map((n, i) => (
              <View key={i} style={styles.tierItem}>
                <View style={[styles.tierDot, gradient(`linear-gradient(145deg, ${TIER_COLORS[i + 1][0]}, ${TIER_COLORS[i + 1][1]})`)]} />
                <Text style={styles.tierText}>{n}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.heroFoot}>
            {s.earned} of {s.total} badges · {level.xp.toLocaleString()} XP
          </Text>
        </View>
      </Animated.View>

      {/* ── showcase ──────────────────────────────────────────── */}
      <SectionTitle index={1} title="Showcase" action={earned.length ? { label: 'Edit', onPress: () => setPicking(true) } : undefined} />
      <Animated.View entering={enterUp(2)} style={styles.showcase}>
        {[0, 1, 2].map((n) => {
          const a = pinned[n];
          return a ? (
            <PressableScale key={a.id} style={styles.showcaseCell} onPress={() => setOpen(a)}>
              {a.videoId && thumbs.get(a.videoId) ? <Image source={thumbs.get(a.videoId)} style={styles.showcaseBg} contentFit="cover" blurRadius={10} /> : null}
              <View style={[styles.showcaseBg, gradient(`linear-gradient(180deg, ${TIER_COLORS[a.tier][1]}66 0%, rgba(0,0,0,0.75) 100%)`, 'rgba(0,0,0,0.5)')]} />
              <Medallion icon={a.icon} tier={a.tier} unlocked size={62} />
              <Text style={styles.showcaseTitle} numberOfLines={2}>
                {a.title}
              </Text>
            </PressableScale>
          ) : (
            <TouchableOpacity key={n} style={[styles.showcaseCell, styles.showcaseEmpty]} onPress={() => earned.length && setPicking(true)}>
              <Icon name="pin" size={20} color={p.textMuted} />
              <Text style={styles.muted}>{earned.length ? 'Pin a badge' : 'Earn a badge'}</Text>
            </TouchableOpacity>
          );
        })}
      </Animated.View>

      {/* ── this month ────────────────────────────────────────── */}
      {month && (
        <Animated.View entering={enterUp(3)}>
          <PressableScale onPress={() => setOpen(month)} style={styles.month}>
            <Ring size={74} stroke={7} progress={month.current / month.target} color={month.unlocked ? p.success : p.accent}>
              <Icon name="calendar" size={24} color={month.unlocked ? p.success : p.text} />
            </Ring>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.monthKicker}>
                MONTHLY CHALLENGE · {daysLeft} {daysLeft === 1 ? 'DAY' : 'DAYS'} LEFT
              </Text>
              <Text style={styles.monthTitle} numberOfLines={1}>
                {month.title.split(': ')[1] ?? month.title}
              </Text>
              <Text style={styles.muted} numberOfLines={2}>
                {month.unlocked ? `Done${month.earnedAt ? ` on ${day(month.earnedAt)}` : ''}. A new goal starts next month.` : month.detail}
              </Text>
              <Text style={styles.progress}>{progressText(month)}</Text>
            </View>
          </PressableScale>
        </Animated.View>
      )}

      {/* ── records ───────────────────────────────────────────── */}
      {records.length > 0 && (
        <>
          <SectionTitle index={4} title="Personal records" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={styles.bleed}>
            {records.map((r, i) => (
              <Animated.View key={r.key} entering={enterUp(5 + i)}>
                <PhotoCard
                  source={r.videoId ? thumbs.get(r.videoId) : undefined}
                  kicker={r.label}
                  value={r.value}
                  detail={r.detail}
                  icon={r.icon}
                  width={cardW}
                  height={168}
                  onPress={r.videoId ? () => onOpenVideo(r.videoId!) : undefined}
                />
              </Animated.View>
            ))}
          </ScrollView>
        </>
      )}

      {/* ── almost there ──────────────────────────────────────── */}
      {s.next.length > 0 && (
        <>
          <SectionTitle index={6} title="Almost there" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={styles.bleed}>
            {s.next.map((a, i) => (
              <Animated.View key={a.id} entering={enterUp(7 + i)}>
                <PressableScale onPress={() => setOpen(a)} style={styles.nextCard}>
                  <Ring size={58} stroke={5} progress={a.current / a.target} color={TIER_COLORS[a.tier][0]}>
                    <Icon name={iconOr(a.icon)} size={22} color={p.text} />
                  </Ring>
                  <Text style={styles.nextTitle} numberOfLines={1}>
                    {a.title}
                  </Text>
                  <Text style={styles.muted} numberOfLines={2}>
                    {a.detail}
                  </Text>
                  <Text style={styles.progress}>
                    {progressText(a)} · {Math.round((a.current / a.target) * 100)} %
                  </Text>
                </PressableScale>
              </Animated.View>
            ))}
          </ScrollView>
        </>
      )}

      {/* ── recently earned (with the video that did it) ──────────── */}
      {s.recent.length > 0 && (
        <>
          <SectionTitle index={8} title="Recently earned" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={styles.bleed}>
            {s.recent.map((a, i) => (
              <Animated.View key={a.id} entering={enterUp(9 + i)}>
                <PressableScale onPress={() => setOpen(a)} style={[styles.recentCard, { width: cardW }]}>
                  {a.videoId && thumbs.get(a.videoId) ? <Image source={thumbs.get(a.videoId)} style={styles.showcaseBg} contentFit="cover" /> : null}
                  <View style={[styles.showcaseBg, gradient(`linear-gradient(180deg, rgba(0,0,0,0.1) 0%, ${TIER_COLORS[a.tier][1]}CC 100%)`, 'rgba(0,0,0,0.45)')]} />
                  <Medallion icon={a.icon} tier={a.tier} unlocked size={50} />
                  <View style={{ marginTop: 'auto' }}>
                    <Text style={styles.recentTitle} numberOfLines={1}>
                      {a.title}
                    </Text>
                    <Text style={styles.recentSub}>
                      {a.kind === 'ladder' ? `${TIER_NAMES[a.tier]} · ` : ''}
                      {day(a.earnedAt!)}
                    </Text>
                  </View>
                </PressableScale>
              </Animated.View>
            ))}
          </ScrollView>
        </>
      )}

      {/* ── every badge ───────────────────────────────────────── */}
      {GROUPS.filter((g) => g.key !== 'Simkl' || simkl).map((g, gi) => {
        const items = list.filter((a) => a.group === g.key);
        if (!items.length) return null;
        const got = items.filter((a) => a.unlocked).length;
        return (
          <View key={g.key} style={{ gap: 12 }}>
            <SectionTitle index={10 + gi} title={g.key} detail={`${got} of ${items.length}`} />
            <View style={{ marginTop: -6, gap: 8 }}>
              <Text style={styles.muted}>{g.blurb}</Text>
              <ShareBar ratio={got / items.length} height={4} color={p.rating} />
            </View>
            <View style={styles.grid}>
              {items.map((a, i) => (
                <Animated.View key={a.id} entering={enterUp(11 + gi + Math.floor(i / 3))} style={styles.cell}>
                  <PressableScale
                    onPress={() => setOpen(a)}
                    style={[styles.cellInner, a.unlocked && { borderColor: `${TIER_COLORS[a.tier][0]}55` }]}
                    accessibilityLabel={hidden(a) ? 'Secret badge' : `${a.title}, ${a.unlocked ? 'earned' : progressText(a)}`}>
                    {hidden(a) ? (
                      <View style={styles.secret}>
                        <Icon name="question" size={24} color={p.textMuted} />
                      </View>
                    ) : (
                      <Medallion icon={a.icon} tier={a.tier} unlocked={a.unlocked} size={60} progress={a.current / a.target} />
                    )}
                    <Text style={[styles.cellTitle, !a.unlocked && { color: p.textSoft }]} numberOfLines={2}>
                      {hidden(a) ? '???' : a.title}
                    </Text>
                    <Text style={styles.cellSub} numberOfLines={1}>
                      {hidden(a) ? 'Secret' : a.unlocked ? (a.kind === 'ladder' ? TIER_NAMES[a.tier] : 'Earned') : progressText(a)}
                    </Text>
                  </PressableScale>
                </Animated.View>
              ))}
            </View>
          </View>
        );
      })}

      {pastMonths.length > 0 && (
        <Card index={16} title="Monthly challenges won">
          <View style={styles.grid}>
            {pastMonths.map((a) => (
              <TouchableOpacity key={a.id} style={styles.cell} onPress={() => setOpen(a)}>
                <View style={styles.cellInner}>
                  <Medallion icon={a.icon} tier={3} unlocked size={52} />
                  <Text style={styles.cellTitle} numberOfLines={2}>
                    {a.title.split(':')[0]}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </Card>
      )}

      {/* ── journey ──────────────────────────────────────────── */}
      {milestones.length > 0 && (
        <Card index={17} title="Your journey" sub="Your story with ReelVault, newest first">
          <View>
            {journey.map((m, i) => (
              <TouchableOpacity key={`${m.at}-${m.title}`} style={styles.jRow} disabled={!m.videoId} onPress={() => m.videoId && onOpenVideo(m.videoId)}>
                <View style={styles.jRail}>
                  <View style={styles.jDot}>
                    <Icon name={iconOr(m.icon)} size={12} color="#fff" />
                  </View>
                  {i < journey.length - 1 && <View style={styles.jLine} />}
                </View>
                <View style={{ flex: 1, paddingBottom: 16 }}>
                  <Text style={styles.jDate}>{day(m.at)}</Text>
                  <Text style={styles.recentTitleDark}>{m.title}</Text>
                  <Text style={styles.muted} numberOfLines={1}>
                    {m.detail}
                  </Text>
                </View>
                {m.videoId && thumbs.get(m.videoId) ? <Image source={thumbs.get(m.videoId)} style={styles.jThumb} contentFit="cover" /> : null}
              </TouchableOpacity>
            ))}
          </View>
          {milestones.length > 6 && (
            <TouchableOpacity onPress={() => setShowAllJourney(!showAllJourney)}>
              <Text style={styles.link}>{showAllJourney ? 'Show less' : `Show all ${milestones.length}`}</Text>
            </TouchableOpacity>
          )}
        </Card>
      )}

      <Text style={styles.foot}>
        Everything here is worked out from your library and what you watched in ReelVault, so it can never be lost. XP: 100 per badge tier, 10 per hour watched, 2 per video.
      </Text>

      {open && (
        <BadgeSheet
          a={open}
          family={all.filter((x) => x.family === open.family && x.kind === 'ladder')}
          thumb={open.videoId ? thumbs.get(open.videoId) : undefined}
          pinned={showcase.includes(open.id)}
          onPin={
            open.unlocked
              ? () => {
                  success();
                  onShowcase(showcase.includes(open.id) ? showcase.filter((x) => x !== open.id) : [...showcase, open.id].slice(-3));
                }
              : undefined
          }
          onPlay={open.videoId ? () => onOpenVideo(open.videoId!) : undefined}
          onClose={() => setOpen(null)}
        />
      )}
      {picking && (
        <SheetFrame title="Showcase" onClose={() => setPicking(false)} action={{ label: 'Done', onPress: () => setPicking(false) }}>
          <Text style={styles.muted}>Pick up to three badges to show at the top. Tap again to take one off.</Text>
          <View style={styles.grid}>
            {earned.map((a) => {
              const on = showcase.includes(a.id);
              return (
                <TouchableOpacity
                  key={a.id}
                  style={styles.cell}
                  onPress={() => {
                    tick();
                    onShowcase(on ? showcase.filter((x) => x !== a.id) : [...showcase, a.id].slice(-3));
                  }}>
                  <View style={[styles.cellInner, on && { borderColor: p.accent, borderWidth: 2 }]}>
                    <Medallion icon={a.icon} tier={a.tier} unlocked size={50} />
                    <Text style={styles.cellTitle} numberOfLines={2}>
                      {a.title}
                    </Text>
                    {on && <Icon name="pin" size={14} color={p.accent} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </SheetFrame>
      )}
    </>
  );
}

function currentMonthId() {
  const d = new Date();
  return `month-${d.getFullYear()}-${d.getMonth() + 1}`;
}

function BadgeSheet({
  a,
  family,
  thumb,
  pinned,
  onPin,
  onPlay,
  onClose,
}: {
  a: Achievement;
  family: Achievement[];
  thumb?: VaultItem['thumbSource'];
  pinned: boolean;
  onPin?: () => void;
  onPlay?: () => void;
  onClose: () => void;
}) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const secret = hidden(a);
  return (
    <SheetFrame title={a.unlocked ? 'Earned' : secret ? 'Secret badge' : 'Not yet'} onClose={onClose}>
      <View style={styles.sheetHero}>
        {thumb ? (
          <View style={styles.sheetPhoto}>
            <Image source={thumb} style={styles.showcaseBg} contentFit="cover" />
            <View style={[styles.showcaseBg, gradient(`linear-gradient(180deg, rgba(0,0,0,0) 30%, ${p.panel} 100%)`, 'rgba(0,0,0,0.3)')]} />
          </View>
        ) : null}
        <Animated.View entering={ZoomIn.springify().damping(SPRING_POP.damping).stiffness(SPRING_POP.stiffness)} style={thumb ? { marginTop: -70 } : undefined}>
          {secret ? (
            <View style={[styles.secret, { width: 112, height: 112, borderRadius: 56 }]}>
              <Icon name="question" size={44} color={p.textMuted} />
            </View>
          ) : (
            <Medallion icon={a.icon} tier={a.tier} unlocked={a.unlocked} size={112} />
          )}
        </Animated.View>
        <Text style={styles.sheetTitle}>{secret ? '???' : a.title}</Text>
        {a.kind === 'ladder' && <Text style={[styles.sheetTier, { color: TIER_COLORS[a.tier][1] }]}>{TIER_NAMES[a.tier]}</Text>}
        <Text style={styles.sheetDetail}>{secret ? 'A secret. Keep watching and you might stumble on it.' : a.detail}</Text>
        {a.unlocked ? (
          <Text style={styles.sheetDone}>{a.earnedAt ? `Earned on ${day(a.earnedAt)}` : 'Earned'}</Text>
        ) : secret ? null : (
          <View style={{ alignSelf: 'stretch', gap: 6 }}>
            <ShareBar ratio={a.current / a.target} height={8} />
            <Text style={[styles.progress, { textAlign: 'center' }]}>{progressText(a)}</Text>
          </View>
        )}
        <View style={styles.sheetButtons}>
          {onPlay && (
            <TouchableOpacity style={styles.sheetBtn} onPress={onPlay}>
              <Icon name="play" size={14} color={p.text} />
              <Text style={styles.sheetBtnText}>The video that did it</Text>
            </TouchableOpacity>
          )}
          {onPin && (
            <TouchableOpacity style={styles.sheetBtn} onPress={onPin}>
              <Icon name="pin" size={14} color={pinned ? p.accent : p.text} />
              <Text style={styles.sheetBtnText}>{pinned ? 'Unpin' : 'Pin to showcase'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      {family.length > 1 && (
        <Animated.View entering={FadeIn} style={{ gap: 10 }}>
          <Text style={styles.sheetSection}>Every step</Text>
          {[...family]
            .sort((x, y) => x.target - y.target)
            .map((st) => (
              <View key={st.id} style={styles.stepRow}>
                <Medallion icon={a.icon} tier={st.tier} unlocked={st.unlocked} size={34} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.recentTitleDark, !st.unlocked && { color: p.textSoft }]}>{st.title}</Text>
                  <Text style={styles.muted}>
                    {st.unlocked ? (st.earnedAt ? `Earned ${day(st.earnedAt)}` : 'Earned') : `${TIER_NAMES[st.tier]} · ${num(st.target)}${a.unit ? ` ${a.unit}` : ''}`}
                  </Text>
                </View>
                {st.unlocked && <Icon name="checkCircle" size={18} color={p.success} />}
              </View>
            ))}
        </Animated.View>
      )}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    muted: { color: p.textSecondary, fontSize: 12, lineHeight: 16 },
    progress: { color: p.textSoft, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
    link: { color: p.link, fontSize: 14, fontWeight: '700', textAlign: 'center' },
    bleed: { marginHorizontal: -16 },
    row: { gap: 10, paddingHorizontal: 16 },

    hero: { flexDirection: 'row', alignItems: 'center', gap: 18, borderRadius: 26, padding: 18 },
    levelNum: { color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: -1, marginBottom: -4 },
    levelWord: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
    heroKicker: { color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
    heroTitle: { color: '#fff', fontSize: 28, fontWeight: '900', letterSpacing: -0.6 },
    heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '700' },
    heroFoot: { color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: '700', marginTop: 2 },
    tierRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
    tierItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    tierDot: { width: 12, height: 12, borderRadius: 6 },
    tierText: { color: '#fff', fontSize: 13, fontWeight: '800' },

    showcase: { flexDirection: 'row', gap: 10 },
    showcaseCell: { flex: 1, height: 150, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8, backgroundColor: p.elevated },
    showcaseBg: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
    showcaseTitle: { color: '#fff', fontSize: 12, fontWeight: '800', textAlign: 'center' },
    showcaseEmpty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: p.border, backgroundColor: 'transparent' },

    month: { flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: p.elevated, borderRadius: 20, padding: 16 },
    monthKicker: { color: p.accent, fontSize: 11, fontWeight: '900', letterSpacing: 0.8 },
    monthTitle: { color: p.text, fontSize: 18, fontWeight: '800' },

    nextCard: { width: 168, backgroundColor: p.elevated, borderRadius: 18, padding: 14, gap: 6 },
    nextTitle: { color: p.text, fontSize: 15, fontWeight: '800', marginTop: 4 },

    recentCard: { height: 168, borderRadius: 18, overflow: 'hidden', padding: 12, backgroundColor: p.elevated },
    recentTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
    recentSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700' },
    recentTitleDark: { color: p.text, fontSize: 15, fontWeight: '700' },

    grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
    cell: { width: '33.333%', padding: 5 },
    cellInner: { alignItems: 'center', gap: 6, backgroundColor: p.elevated, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 6, minHeight: 150, borderWidth: 1, borderColor: 'transparent' },
    cellTitle: { color: p.text, fontSize: 13, fontWeight: '800', textAlign: 'center' },
    cellSub: { color: p.textSecondary, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
    secret: { width: 60, height: 60, borderRadius: 30, borderWidth: 2, borderStyle: 'dashed', borderColor: p.border, alignItems: 'center', justifyContent: 'center' },

    jRow: { flexDirection: 'row', gap: 12 },
    jRail: { width: 26, alignItems: 'center' },
    jDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' },
    jLine: { flex: 1, width: 2, backgroundColor: p.separator, marginVertical: 2 },
    jDate: { color: p.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
    jThumb: { width: 54, height: 40, borderRadius: 8 },

    foot: { color: p.textMuted, fontSize: 12, textAlign: 'center', paddingHorizontal: 20, lineHeight: 17 },

    sheetHero: { alignItems: 'center', gap: 8, paddingBottom: 8 },
    sheetPhoto: { alignSelf: 'stretch', height: 150, borderRadius: 18, overflow: 'hidden' },
    sheetTitle: { color: p.text, fontSize: 24, fontWeight: '900', textAlign: 'center', marginTop: 8 },
    sheetTier: { fontSize: 13, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase' },
    sheetDetail: { color: p.textSoft, fontSize: 15, textAlign: 'center' },
    sheetDone: { color: p.success, fontSize: 14, fontWeight: '800' },
    sheetButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 8 },
    sheetBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
    sheetBtnText: { color: p.text, fontSize: 14, fontWeight: '700' },
    sheetSection: { color: p.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  });
