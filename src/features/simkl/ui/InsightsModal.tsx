/**
 * Stats and Review. Overview = all-time detail (time, types, ratings vs IMDb,
 * genres, networks, countries, decades, when you watch, streaks, rewatches,
 * what is left). Review = one week, month or year with a bar per day / month,
 * top titles and genres, the busiest day, the biggest binge and what you
 * finished. Everything comes from the library on the phone.
 * Presentational only (see simkl/ui/types.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Segment } from '@/features/vault/ui/sheets';
import { sheet, usePalette, useStyles, type Palette } from '@/features/vault/ui/theme';

import { detailedStats, fmtChange, fmtDuration, fmtRating, periodOf, review, shiftPeriod, type PeriodKind } from '../insights';
import { SIMKL_TYPES, watchHeatmap } from '../logic';
import { BarChart, RankedBars } from './charts';
import type { Meta, SimklActions, SimklItem, WatchEvent } from './types';
import Glyph from '@/features/vault/ui/Glyph';

type Tab = 'overview' | 'review';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'review', label: 'Review' },
];
const KINDS: { key: PeriodKind; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];

const hours = (m: number) => (m >= 60 ? `${Math.round(m / 6) / 10} h` : `${m} min`);

export default function InsightsModal({
  items,
  actions,
  initialTab = 'overview',
  onClose,
}: {
  items: SimklItem[];
  actions: SimklActions;
  initialTab?: Tab;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [data, setData] = useState<{ events: WatchEvent[]; meta: Map<number, Meta> } | null>(null);
  const [kind, setKind] = useState<PeriodKind>('month');
  const [period, setPeriod] = useState(() => periodOf('month', Date.now()));
  const [filling, setFilling] = useState<string | null>(null);

  const load = () =>
    actions
      .loadInsights()
      .then(setData)
      .catch(() => setData({ events: [], meta: new Map() }));
  useEffect(() => {
    void load();
    // load once on open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => (data ? detailedStats(data.events, items, data.meta) : null), [data, items]);
  const rev = useMemo(() => (data ? review(data.events, items, data.meta, period) : null), [data, items, period]);
  const heat = useMemo(() => (data ? watchHeatmap(data.events.map((e) => new Date(e.at).toISOString()), Date.now(), 18) : null), [data]);
  const isCurrent = period.start <= Date.now() && Date.now() < period.end;

  async function fill() {
    setFilling('Starting…');
    await actions.fillMeta((done, total) => setFilling(`${done} of ${total}`)).catch(() => undefined);
    setFilling(null);
    await load();
  }

  const shade = (n: number) => {
    if (!heat || n === 0) return p.card;
    const level = Math.min(4, Math.ceil((n / Math.max(1, heat.max)) * 4));
    return ['', 'rgba(245,166,35,0.3)', 'rgba(245,166,35,0.5)', 'rgba(245,166,35,0.75)', p.rating][level];
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.circle} onPress={onClose} accessibilityLabel="Close">
            <Glyph name="close" />
          </TouchableOpacity>
          <Text style={styles.title}>Stats</Text>
        </View>
        <View style={styles.tabs}>
          <Segment options={TABS} value={tab} onChange={setTab} />
        </View>

        {!data || !stats || !rev ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={p.textSecondary} />
        ) : tab === 'overview' ? (
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
            <View style={styles.tiles}>
              <Tile value={fmtDuration(stats.minutes)} label="watched" big />
              <Tile value={String(stats.episodes)} label="episodes" />
              <Tile value={String(stats.movies)} label="movies" />
              <Tile value={String(stats.rewatches)} label="rewatches" />
            </View>

            <Section title="By type">
              {SIMKL_TYPES.map((t) => {
                const s = stats.byType[t.key];
                return (
                  <View key={t.key} style={styles.typeRow}>
                    <Text style={styles.typeName}>{t.plural}</Text>
                    <Text style={styles.typeFacts}>
                      {s.titles} titles · {fmtDuration(s.minutes)} · {s.completed} completed · {s.watching} watching · {s.plan} planned
                    </Text>
                  </View>
                );
              })}
            </Section>

            {heat && (
              <Section title="Last 18 weeks">
                <View style={styles.heat}>
                  {heat.columns.map((col, i) => (
                    <View key={i} style={styles.heatCol}>
                      {col.map((d) => (
                        <View key={d.day} style={[styles.heatCell, { backgroundColor: d.future ? 'transparent' : shade(d.count) }]} />
                      ))}
                    </View>
                  ))}
                </View>
                <Text style={styles.hint}>
                  Streak {heat.current} {heat.current === 1 ? 'day' : 'days'} · longest {heat.longest} · darker = more watched that day
                </Text>
              </Section>
            )}

            <Section title="My ratings">
              <BarChart data={stats.ratingHistogram.map((n, i) => ({ label: String(i + 1), value: n }))} format={(v) => `${v} titles`} />
              <Text style={styles.text}>
                {stats.myAverage === null ? 'No ratings yet.' : `Average ${fmtRating(stats.myAverage)}`}
                {stats.vsImdb !== null
                  ? ` · ${stats.vsImdb === 0 ? 'the same as IMDb' : `${stats.vsImdb > 0 ? '+' : '−'}${Math.abs(stats.vsImdb)} vs IMDb (${stats.vsImdb > 0 ? 'kinder' : 'harsher'})`}`
                  : ''}
              </Text>
            </Section>

            <Section title="Top genres (time)">
              <RankedBars rows={stats.topGenres.map((r) => ({ label: r.label, value: r.minutes }))} format={hours} />
            </Section>
            <Section title="Top networks">
              <RankedBars rows={stats.topNetworks.map((r) => ({ label: r.label, value: r.minutes }))} format={hours} />
            </Section>
            <Section title="Countries">
              <RankedBars rows={stats.topCountries.map((r) => ({ label: r.label, value: r.minutes }))} format={hours} />
            </Section>
            {stats.metaCoverage.have < stats.metaCoverage.total && (
              <View style={styles.fill}>
                <Text style={styles.hint}>
                  Genres and networks are known for {stats.metaCoverage.have} of {stats.metaCoverage.total} titles.
                </Text>
                <TouchableOpacity style={[styles.fillBtn, !!filling && styles.disabled]} disabled={!!filling} onPress={() => void fill()}>
                  <Text style={styles.fillText}>{filling ? `Getting details… ${filling}` : 'Get the rest from Simkl'}</Text>
                </TouchableOpacity>
              </View>
            )}

            <Section title="When you watch">
              <Text style={styles.sub}>By weekday</Text>
              <BarChart data={stats.weekday.map((b) => ({ label: b.label, value: b.minutes }))} format={hours} height={90} />
              <Text style={styles.sub}>By hour of the day</Text>
              <BarChart data={stats.hours.map((b) => ({ label: b.label, value: b.count }))} format={(v) => `${v} watched`} height={90} labelEvery={6} />
            </Section>

            <Section title="Release decades">
              <BarChart data={stats.decades.map((b) => ({ label: b.label, value: b.count }))} format={(v) => `${v} titles`} height={90} />
            </Section>

            {stats.mostRewatched.length > 0 && (
              <Section title="Most rewatched">
                <RankedBars rows={stats.mostRewatched.map((r) => ({ label: r.label, value: r.count }))} format={(v) => `${v}×`} />
              </Section>
            )}

            <Section title="Still to watch">
              <View style={styles.tiles}>
                <Tile value={fmtDuration(stats.planMinutes)} label="Plan to Watch" />
                <Tile value={fmtDuration(stats.leftMinutes)} label="left in Watching" />
                <Tile value={stats.completionRate === null ? '–' : `${stats.completionRate}%`} label="finished of started" />
              </View>
            </Section>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 30 }]}>
            <Segment
              options={KINDS}
              value={kind}
              onChange={(k) => {
                setKind(k);
                setPeriod(periodOf(k, Date.now()));
              }}
            />
            <View style={styles.periodRow}>
              <TouchableOpacity style={styles.arrow} onPress={() => setPeriod(shiftPeriod(period, -1))} accessibilityLabel="Previous">
                <Glyph name="back" size={16} />
              </TouchableOpacity>
              <Text style={styles.periodLabel}>{period.label}</Text>
              <TouchableOpacity
                style={[styles.arrow, isCurrent && styles.disabled]}
                disabled={isCurrent}
                onPress={() => setPeriod(shiftPeriod(period, 1))}
                accessibilityLabel="Next">
                <Glyph name="forward" size={16} />
              </TouchableOpacity>
            </View>

            <View style={styles.headline}>
              <Text style={styles.headlineValue}>{fmtDuration(rev.minutes)}</Text>
              <Text style={styles.headlineLabel}>
                watched
                {fmtChange(rev.minutes, rev.previousMinutes) ? ` · ${fmtChange(rev.minutes, rev.previousMinutes)} vs the ${kind} before` : ''}
              </Text>
            </View>
            <View style={styles.tiles}>
              <Tile value={String(rev.episodes)} label="episodes" />
              <Tile value={String(rev.movies)} label="movies" />
              <Tile value={String(rev.titles)} label="titles" />
              <Tile value={String(rev.activeDays)} label="days you watched" />
            </View>

            <Section title={kind === 'year' ? 'Each month' : 'Each day'}>
              <BarChart data={rev.buckets.map((b) => ({ label: b.label, value: b.minutes }))} format={hours} />
            </Section>

            <Section title="Most watched">
              <RankedBars rows={rev.topTitles.map((r) => ({ label: r.label, value: r.minutes }))} format={hours} />
            </Section>
            {rev.topGenres.length > 0 && (
              <Section title="Genres">
                <RankedBars rows={rev.topGenres.map((r) => ({ label: r.label, value: r.minutes }))} format={hours} />
              </Section>
            )}

            <Section title="Highlights">
              {rev.busiestDay && (
                <Fact label="Busiest day" value={`${rev.busiestDay.label} · ${fmtDuration(rev.busiestDay.minutes)}`} />
              )}
              {rev.biggestBinge && (
                <Fact label="Biggest binge" value={`${rev.biggestBinge.count} episodes of ${rev.biggestBinge.title} · ${rev.biggestBinge.label}`} />
              )}
              <Fact label="Rewatches" value={String(rev.rewatches)} />
              <Fact label="Added to your lists" value={String(rev.added)} />
              <Fact
                label="Ratings given"
                value={rev.rated.count ? `${rev.rated.count} · average ${fmtRating(rev.rated.average)}` : 'none'}
              />
              {rev.finished.length > 0 && (
                <Fact label="Finished" value={rev.finished.map((i) => i.title).slice(0, 8).join(', ') + (rev.finished.length > 8 ? '…' : '')} />
              )}
              {rev.minutes === 0 && <Text style={styles.hint}>Nothing watched in this {kind}.</Text>}
            </Section>
          </ScrollView>
        )}
      </View>
    </Modal>
  );

  function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {children}
      </View>
    );
  }

  function Tile({ value, label, big }: { value: string; label: string; big?: boolean }) {
    return (
      <View style={[styles.tile, big && styles.tileBig]}>
        <Text style={[styles.tileValue, big && styles.tileValueBig]}>{value}</Text>
        <Text style={styles.tileLabel}>{label}</Text>
      </View>
    );
  }

  function Fact({ label, value }: { label: string; value: string }) {
    return (
      <View style={styles.fact}>
        <Text style={styles.factLabel}>{label}</Text>
        <Text style={styles.factValue}>{value}</Text>
      </View>
    );
  }
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    circle: { width: 36, height: 36, borderRadius: 18, backgroundColor: p.circle, alignItems: 'center', justifyContent: 'center' },
    circleIcon: { color: p.icon, fontSize: 15, fontWeight: '600' },
    title: { color: p.text, fontSize: 26, fontWeight: '800' },
    tabs: { paddingHorizontal: 16, paddingBottom: 6 },
    body: { padding: 16, gap: 14 },
    section: { backgroundColor: p.panel, borderRadius: 16, padding: 14, gap: 10 },
    sectionTitle: { color: p.text, fontSize: 16, fontWeight: '800' },
    sub: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    text: { color: p.textSoft, fontSize: 14 },
    hint: { color: p.textSecondary, fontSize: 12 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    tile: { backgroundColor: p.card, borderRadius: 12, padding: 12, flexGrow: 1, minWidth: '30%' },
    tileBig: { minWidth: '100%' },
    tileValue: { color: p.text, fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'] },
    tileValueBig: { fontSize: 30 },
    tileLabel: { color: p.textSecondary, fontSize: 12 },
    typeRow: { gap: 2 },
    typeName: { color: p.text, fontSize: 15, fontWeight: '700' },
    typeFacts: { color: p.textSecondary, fontSize: 13 },
    heat: { flexDirection: 'row', gap: 3 },
    heatCol: { gap: 3 },
    heatCell: { width: 14, height: 14, borderRadius: 3 },
    fill: { gap: 8, paddingHorizontal: 4 },
    fillBtn: { alignSelf: 'flex-start', backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
    fillText: { color: p.link, fontWeight: '700', fontSize: 14 },
    disabled: { opacity: 0.4 },
    periodRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    arrow: { width: 40, height: 40, borderRadius: 20, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    arrowText: { color: p.text, fontSize: 24, fontWeight: '600', marginTop: -3 },
    periodLabel: { color: p.text, fontSize: 18, fontWeight: '800' },
    headline: { alignItems: 'center', paddingVertical: 4 },
    headlineValue: { color: p.text, fontSize: 40, fontWeight: '900', fontVariant: ['tabular-nums'] },
    headlineLabel: { color: p.textSecondary, fontSize: 14 },
    fact: { gap: 2 },
    factLabel: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    factValue: { color: p.text, fontSize: 15 },
  });
