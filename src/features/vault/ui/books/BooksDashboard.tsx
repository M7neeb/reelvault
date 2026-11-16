/**
 * Reading stats for Books: this week by day, all time, your streak, your
 * Books Wrapped (this year, any month, recent weeks, years before), your
 * year in days, what you read most and when you read.
 * Presentational only (see the note at the top of types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dayGoal, daysMet, stepDaily, yearGoal, MAX_YEAR_BOOKS, type BookGoals } from '../../books/bookGoals';
import { displayTitle, type BookRead } from '../../books/bookLogic';
import { bookStats, bookYears, fmtTime } from '../../books/bookStats';
import { monthRangesOf, recentWeekRanges, yearRangeOf, type ReadRange } from '../../manga/mangaInsights';
import Icon from '../Icon';
import { Card } from '../insightParts';
import { Modal } from '../screen';
import { GrowColumn } from '../storyKit';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import type { ThumbSource } from '../types';
import { PosterRow, WrappedPoster } from '../wrappedPoster';
import { YearHeatCard } from '../yearHeatUI';
import BookWrapped from './BookWrapped';
import { BookCover } from './BooksScreen';
import type { BookActions, BookUi } from './bookTypes';

const DAY = 86_400_000;

export default function BooksDashboard({ items, actions, goals, onOpen, onClose, initialReads }: { items: BookUi[]; actions: BookActions; goals: BookGoals; onOpen: (b: BookUi) => void; onClose: () => void; initialReads?: BookRead[] }) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [reads, setReads] = useState<BookRead[] | null>(initialReads ?? null);
  const [now] = useState(() => Date.now());
  const [wrapped, setWrapped] = useState<ReadRange | null>(null);

  useEffect(() => {
    actions
      .loadReads()
      .then(setReads)
      .catch(() => setReads([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(items.map((b) => [b.id, b])), [items]);
  const st = useMemo(() => (reads ? bookStats(items, reads, now) : null), [items, reads, now]);
  const years = useMemo(() => (reads ? bookYears(items, reads, now) : []), [items, reads, now]);
  const weekMax = st ? Math.max(1, ...st.week.map((d) => d.ms)) : 1;
  const hourMax = st ? Math.max(1, ...st.hours) : 1;
  const covers = (ids: string[]) => ids.map((id) => byId.get(id)?.coverUri).filter((u): u is string => !!u).map((uri): ThumbSource => ({ uri }));
  const wall = useMemo(() => covers([...(years[0]?.top ?? []), ...items.map((b) => b.id)]).slice(0, 16), [years, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const msIn = (r: ReadRange) => (reads ?? []).filter((x) => x.startedAt >= r.start && x.startedAt < r.end).reduce((a, x) => a + x.ms, 0);
  const topIn = (r: ReadRange) => {
    const per = new Map<string, number>();
    for (const x of reads ?? []) if (x.startedAt >= r.start && x.startedAt < r.end) per.set(x.bookId, (per.get(x.bookId) ?? 0) + x.ms);
    return [...per.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const rangeItems = (ranges: ReadRange[]) =>
    ranges
      .map((r) => ({ r, ms: msIn(r) }))
      .filter((x) => x.ms > 0)
      .map(({ r, ms }) => {
        const top = topIn(r);
        const b = top ? byId.get(top) : undefined;
        return { key: `${r.kind}${r.start}`, label: r.label, line: fmtTime(ms), top: b ? displayTitle(b) : undefined, source: b?.coverUri ? { uri: b.coverUri } : null, onPress: () => setWrapped(r) };
      });

  const daily = st ? dayGoal(st.todayMs, goals.dailyMin) : null;
  const metDays = reads ? daysMet(reads, goals.dailyMin, now) : 0;
  const yearly = yearGoal(items, goals.yearBooks, now);
  const setGoals = (g: BookGoals) => void actions.setGoals(g).catch(() => undefined);

  const thisYear = years[0];
  const prevOf = (r: ReadRange) => (r.kind === 'year' ? new Date(new Date(r.start).getFullYear() - 1, 0, 1).getTime() : r.kind === 'week' ? r.start - 7 * DAY : new Date(new Date(r.start).getFullYear(), new Date(r.start).getMonth() - 1, 1).getTime());

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close">
            <Icon name="close" size={15} color={p.icon} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.title}>Reading</Text>
        </View>
        {!st || !reads ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={p.textSecondary} />
        ) : (
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
            <Card index={0} title="This week" sub={st.todayMs ? `${fmtTime(st.todayMs)} today` : 'Nothing yet today'}>
              <Text style={styles.big}>{st.weekMs ? fmtTime(st.weekMs) : '-'}</Text>
              <View style={styles.week}>
                {st.week.map((d, n) => (
                  <View key={n} style={styles.weekCell}>
                    <View style={styles.weekBox}>
                      <GrowColumn ratio={d.ms / weekMax} height={80} width={18} delay={n * 50} color={d.today ? p.accent : p.textMuted} />
                    </View>
                    <Text style={[styles.weekLabel, d.today && { color: p.accent }]}>{d.label}</Text>
                  </View>
                ))}
              </View>
            </Card>

            <View style={styles.tiles}>
              <View style={styles.tile}>
                <Text style={styles.tileNum} numberOfLines={1} adjustsFontSizeToFit>
                  {st.totalMs ? fmtTime(st.totalMs) : '-'}
                </Text>
                <Text style={styles.tileLabel}>All time</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileNum}>
                  {st.streak} {st.streak === 1 ? 'day' : 'days'}
                </Text>
                <Text style={styles.tileLabel}>Streak · best {st.bestStreak}</Text>
              </View>
              <View style={styles.tile}>
                <Text style={styles.tileNum}>{st.finished}</Text>
                <Text style={styles.tileLabel}>Finished</Text>
              </View>
            </View>

            <Card index={1} title="Goals">
              <View style={styles.goal}>
                <View style={styles.goalHead}>
                  <Text style={styles.goalName}>Reading a day</Text>
                  <Stepper
                    value={goals.dailyMin ? `${goals.dailyMin} min` : 'Off'}
                    name="daily reading goal"
                    onLess={goals.dailyMin > 0 ? () => setGoals({ ...goals, dailyMin: stepDaily(goals.dailyMin, -1) }) : undefined}
                    onMore={stepDaily(goals.dailyMin, 1) !== goals.dailyMin ? () => setGoals({ ...goals, dailyMin: stepDaily(goals.dailyMin, 1) }) : undefined}
                  />
                </View>
                {daily ? (
                  <>
                    <View style={styles.goalBar}>
                      <View style={[styles.goalFill, daily.met && styles.goalDone, { width: `${Math.round(daily.ratio * 100)}%` }]} />
                    </View>
                    <Text style={styles.goalLine}>
                      {daily.line} · {metDays} of the last 7 days
                    </Text>
                  </>
                ) : (
                  <Text style={styles.goalLine}>No daily goal. Tap + to set the minutes you want to read each day.</Text>
                )}
              </View>
              <View style={[styles.goal, styles.goalNext]}>
                <View style={styles.goalHead}>
                  <Text style={styles.goalName}>Books this year</Text>
                  <Stepper
                    value={goals.yearBooks ? String(goals.yearBooks) : 'Off'}
                    name="books a year goal"
                    onLess={goals.yearBooks > 0 ? () => setGoals({ ...goals, yearBooks: goals.yearBooks - 1 }) : undefined}
                    onMore={goals.yearBooks < MAX_YEAR_BOOKS ? () => setGoals({ ...goals, yearBooks: goals.yearBooks + 1 }) : undefined}
                  />
                </View>
                {yearly ? (
                  <>
                    <View style={styles.goalBar}>
                      <View style={[styles.goalFill, yearly.ratio >= 1 && styles.goalDone, { width: `${Math.round(yearly.ratio * 100)}%` }]} />
                    </View>
                    <Text style={styles.goalLine}>{yearly.line}</Text>
                  </>
                ) : (
                  <Text style={styles.goalLine}>No goal for the year. A book counts once you mark it finished.</Text>
                )}
              </View>
            </Card>

            {thisYear && (
              <WrappedPoster
                kicker="BOOKS WRAPPED"
                title={String(thisYear.year)}
                stats={[
                  { v: thisYear.ms >= 7_200_000 ? `${Math.round(thisYear.ms / 3_600_000)} h` : fmtTime(thisYear.ms), l: 'reading' },
                  { v: String(thisYear.books), l: thisYear.books === 1 ? 'book' : 'books' },
                  { v: String(thisYear.days), l: 'days' },
                  { v: String(thisYear.finished), l: 'finished' },
                ]}
                wall={wall}
                top={thisYear.top.map((id) => ({ title: byId.get(id) ? displayTitle(byId.get(id)!) : 'A book', source: byId.get(id)?.coverUri ? { uri: byId.get(id)!.coverUri! } : null }))}
                tint="#A4522C"
                background="#1A0D08"
                tileAspect={1.5}
                playLabel={`Play ${thisYear.year}`}
                onPress={() => setWrapped(yearRangeOf(thisYear.year, now))}
                accessibilityLabel={`Open your ${thisYear.year} Books Wrapped`}
              />
            )}
            <PosterRow title="Weeks" items={rangeItems(recentWeekRanges(now, 8))} />
            <PosterRow title="Months" items={rangeItems(monthRangesOf(now))} />
            <PosterRow title="Years before" items={rangeItems(years.slice(1).map((y) => yearRangeOf(y.year, now)))} />

            <YearHeatCard
              index={1}
              plays={reads.map((x) => ({ videoId: x.bookId, startedAt: x.startedAt, watchedMs: x.ms }))}
              nameOf={(id) => (byId.get(id) ? displayTitle(byId.get(id)!) : null)}
              onOpen={(id) => {
                const b = byId.get(id);
                if (b) onOpen(b);
              }}
            />

            {st.top.length > 0 && (
              <Card index={2} title="Most read">
                {st.top.map((t) => {
                  const b = byId.get(t.id);
                  if (!b) return null;
                  return (
                    <TouchableOpacity key={t.id} style={styles.row} onPress={() => onOpen(b)}>
                      <BookCover book={b} width={36} radius={3} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {displayTitle(b)}
                        </Text>
                        <Text style={styles.sub}>{fmtTime(t.ms)}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </Card>
            )}

            {st.totalMs > 0 && (
              <Card index={3} title="When you read" sub={st.sessions ? `${st.sessions} sittings, about ${fmtTime(st.averageSessionMs)} each` : undefined}>
                <View style={styles.hours}>
                  {st.hours.map((h, n) => (
                    <View key={n} style={styles.hourCell}>
                      <GrowColumn ratio={h / hourMax} height={60} width="80%" delay={n * 15} color={p.accent} radius={3} />
                    </View>
                  ))}
                </View>
                <View style={styles.hourLabels}>
                  {['0', '6', '12', '18', '24'].map((l) => (
                    <Text key={l} style={styles.sub}>
                      {l}
                    </Text>
                  ))}
                </View>
              </Card>
            )}

            <Card index={4} title="Your shelf">
              <Text style={styles.sub}>
                {items.length} {items.length === 1 ? 'book' : 'books'} · {st.reading} reading · {st.finished} finished · {st.notStarted} not started
              </Text>
            </Card>
          </ScrollView>
        )}
      </View>
      {wrapped && reads && (
        <BookWrapped books={items} reads={reads} start={wrapped.start} end={wrapped.end} label={wrapped.label} prevStart={prevOf(wrapped)} passage={actions.passage} onClose={() => setWrapped(null)} />
      )}
    </Modal>
  );
}

function Stepper({ value, name, onLess, onMore }: { value: string; name: string; onLess?: () => void; onMore?: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  return (
    <View style={styles.stepper}>
      <TouchableOpacity style={styles.step} hitSlop={8} onPress={onLess} disabled={!onLess} accessibilityLabel={`Lower the ${name}`}>
        <Icon name="minus" size={13} color={onLess ? p.text : p.textMuted} weight="bold" />
      </TouchableOpacity>
      <Text style={styles.stepValue} accessibilityLabel={`${name}: ${value}`}>
        {value}
      </Text>
      <TouchableOpacity style={styles.step} hitSlop={8} onPress={onMore} disabled={!onMore} accessibilityLabel={`Raise the ${name}`}>
        <Icon name="plus" size={13} color={onMore ? p.text : p.textMuted} weight="bold" />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    goal: { gap: 8 },
    goalNext: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: p.separator },
    goalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    goalName: { color: p.text, fontSize: 16, fontWeight: '700' },
    goalBar: { height: 6, borderRadius: 3, backgroundColor: p.bg, overflow: 'hidden' },
    goalFill: { height: 6, borderRadius: 3, backgroundColor: p.accent },
    goalDone: { backgroundColor: p.success },
    goalLine: { color: p.textSecondary, fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] },
    stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    step: { width: 32, height: 32, borderRadius: 16, backgroundColor: p.bg, alignItems: 'center', justifyContent: 'center' },
    stepValue: { minWidth: 62, textAlign: 'center', color: p.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
    screen: { flex: 1, backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    circle: { width: 34, height: 34, borderRadius: 17, backgroundColor: p.elevated, alignItems: 'center', justifyContent: 'center' },
    title: { color: p.text, fontSize: 26, fontWeight: '800', flex: 1 },
    body: { paddingHorizontal: 16, gap: 14, paddingTop: 6 },
    big: { color: p.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.8 },
    sub: { color: p.textSecondary, fontSize: 13, lineHeight: 18 },
    week: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
    weekCell: { flex: 1, alignItems: 'center', gap: 6 },
    weekBox: { height: 80, justifyContent: 'flex-end' },
    weekLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    tiles: { flexDirection: 'row', gap: 10 },
    tile: { flex: 1, backgroundColor: p.elevated, borderRadius: 16, padding: 12, gap: 2 },
    tileNum: { color: p.text, fontSize: 17, fontWeight: '800' },
    tileLabel: { color: p.textSecondary, fontSize: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
    rowTitle: { color: p.text, fontSize: 15, fontWeight: '700' },
    hours: { flexDirection: 'row', alignItems: 'flex-end', height: 64 },
    hourCell: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
    hourLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  });
