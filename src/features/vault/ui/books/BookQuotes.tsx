/**
 * Quotes: the lines you highlighted, from every book, in one place. Tap one
 * to see it set as a card you can share as a picture, or to open the book
 * at that line.
 * Presentational only (see the note at the top of types.ts).
 */

import { useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { matchesQuote, quoteAsText, quoteSize, tidyQuote, type Quote } from '../../books/bookGoals';
import type { ReaderTheme } from '../../books/bookLogic';
import { shareSnap } from '../../snap';
import Icon from '../Icon';
import { OptionsSheet } from '../prompts';
import { Modal } from '../screen';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import { INKS } from './BookReader';

const SERIF = Platform.select({ ios: 'Charter', web: 'Charter, Georgia, serif', default: 'serif' });
const PAPERS: ReaderTheme[] = ['paper', 'sepia', 'night'];
const PAPER_NAMES: Record<ReaderTheme, string> = { paper: 'Paper', sepia: 'Sepia', night: 'Night' };

/** A quote set on a page, the way it is shared. */
export function QuoteCard({ quote, paper, width }: { quote: Pick<Quote, 'text' | 'title' | 'author'>; paper: ReaderTheme; width: number }) {
  const ink = INKS[paper];
  const text = tidyQuote(quote.text);
  const type = quoteSize(text);
  const pad = Math.round(width * 0.09);
  return (
    <View style={{ width, minHeight: Math.round(width * 1.25), backgroundColor: ink.bg, padding: pad, paddingTop: pad * 1.25, justifyContent: 'space-between' }}>
      <Text style={{ color: ink.text, fontFamily: SERIF, fontSize: type.size, lineHeight: type.line, letterSpacing: type.size >= 26 ? -0.3 : 0 }}>{text}</Text>
      <View style={{ marginTop: pad }}>
        <View style={{ width: 28, height: 2, backgroundColor: ink.accent, marginBottom: 12 }} />
        <Text style={{ color: ink.text, fontFamily: SERIF, fontStyle: 'italic', fontSize: 15, lineHeight: 20 }} numberOfLines={2}>
          {quote.title}
        </Text>
        {!!quote.author && (
          <Text style={{ color: ink.soft, fontSize: 13, lineHeight: 18, marginTop: 2 }} numberOfLines={1}>
            {quote.author}
          </Text>
        )}
      </View>
    </View>
  );
}

export default function BookQuotes({
  quotes,
  paper: startPaper,
  initialOpen,
  onRead,
  onRemove,
  onClose,
}: {
  quotes: Quote[];
  /** The page colour the reader is set to: the card starts on it. */
  paper: ReaderTheme;
  initialOpen?: number | null;
  onRead: (q: Quote) => void;
  onRemove: (q: Quote) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const { width, height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(initialOpen ?? null);
  const [menuFor, setMenuFor] = useState<Quote | null>(null);
  const [paper, setPaper] = useState<ReaderTheme>(startPaper);
  const card = useRef<View>(null);

  const shown = useMemo(() => quotes.filter((q) => matchesQuote(q, query)), [quotes, query]);
  const open = openId === null ? null : (quotes.find((q) => q.id === openId) ?? null);
  const bookCount = useMemo(() => new Set(quotes.map((q) => q.bookId)).size, [quotes]);
  // The card keeps its 4:5 shape and still leaves room for the buttons on a small phone.
  const cardWidth = Math.round(Math.min(width - 48, 400, (height - insets.top - insets.bottom - 250) / 1.25));

  const share = (q: Quote) => void shareSnap(card.current, quoteAsText(q)).catch(() => undefined);

  return (
    <Modal visible animationType="slide" onRequestClose={() => (open ? setOpenId(null) : onClose())}>
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.circle} onPress={() => (open ? setOpenId(null) : onClose())} accessibilityLabel={open ? 'Back to all quotes' : 'Close'}>
            <Icon name={open ? 'back' : 'close'} size={15} color={p.icon} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.title}>{open ? '' : 'Quotes'}</Text>
        </View>

        {open ? (
          <View style={[styles.stage, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.cardShadow}>
              <View ref={card} collapsable={false}>
                <QuoteCard quote={open} paper={paper} width={cardWidth} />
              </View>
            </View>
            <View style={styles.papers}>
              {PAPERS.map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setPaper(t)}
                  style={[styles.swatch, { backgroundColor: INKS[t].bg, borderColor: paper === t ? p.accent : p.border, borderWidth: paper === t ? 2 : 1 }]}
                  accessibilityLabel={`${PAPER_NAMES[t]} card`}
                  accessibilityState={{ selected: paper === t }}
                />
              ))}
            </View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.primary} onPress={() => share(open)}>
                <Icon name="share" size={15} color={p.bg} weight="bold" />
                <Text style={styles.primaryText}>Share</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondary} onPress={() => onRead(open)}>
                <Text style={styles.secondaryText}>Open in the book</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : quotes.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No quotes yet</Text>
            <Text style={styles.emptyText}>While reading, hold a paragraph and pick the sentences to keep. Every line you highlight is collected here.</Text>
          </View>
        ) : (
          <FlatList
            data={shown}
            keyExtractor={(q) => String(q.id)}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
            ListHeaderComponent={
              <View>
                <Text style={styles.count}>
                  {quotes.length} {quotes.length === 1 ? 'highlight' : 'highlights'} from {bookCount} {bookCount === 1 ? 'book' : 'books'}
                </Text>
                {quotes.length > 4 && (
                  <View style={styles.search}>
                    <Icon name="search" size={15} color={p.textSecondary} />
                    <TextInput
                      value={query}
                      onChangeText={setQuery}
                      placeholder="Words, book, author, note"
                      placeholderTextColor={p.textSecondary}
                      style={styles.searchInput}
                      clearButtonMode="while-editing"
                      returnKeyType="search"
                    />
                  </View>
                )}
              </View>
            }
            ListEmptyComponent={<Text style={styles.none}>Nothing matches “{query.trim()}”.</Text>}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            renderItem={({ item: q }) => (
              <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => setOpenId(q.id)} onLongPress={() => setMenuFor(q)} accessibilityHint="Opens the quote as a card">
                <Text style={styles.quote}>{tidyQuote(q.text)}</Text>
                {!!q.note && <Text style={styles.note}>{q.note}</Text>}
                <Text style={styles.from} numberOfLines={1}>
                  {q.title}
                  {q.author ? ` · ${q.author}` : ''}
                </Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
      {menuFor && (
        <OptionsSheet
          title="Highlight"
          options={[
            { label: 'Show as a card', onPress: () => setTimeout(() => setOpenId(menuFor.id), 250) },
            { label: 'Open in the book', onPress: () => onRead(menuFor) },
            { label: 'Remove the highlight', danger: true, onPress: () => onRemove(menuFor) },
          ]}
          onClose={() => setMenuFor(null)}
        />
      )}
    </Modal>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    screen: { flex: 1, backgroundColor: p.bg },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8, minHeight: 42 },
    circle: { width: 34, height: 34, borderRadius: 17, backgroundColor: p.card, alignItems: 'center', justifyContent: 'center' },
    title: { color: p.text, fontSize: 26, fontWeight: '800', flex: 1 },
    count: { color: p.textSecondary, fontSize: 14, paddingHorizontal: 20, marginTop: 2 },
    search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 14, backgroundColor: p.card, borderRadius: 12, paddingHorizontal: 12, height: 40 },
    searchInput: { flex: 1, color: p.text, fontSize: 16 },
    row: { paddingHorizontal: 20, paddingVertical: 20 },
    quote: { color: p.text, fontFamily: SERIF, fontSize: 18, lineHeight: 27 },
    note: { color: p.textSecondary, fontSize: 14, lineHeight: 20, fontStyle: 'italic', marginTop: 8 },
    from: { color: p.textSecondary, fontSize: 13, fontWeight: '600', marginTop: 10 },
    sep: { height: 1, backgroundColor: p.separator, marginLeft: 20 },
    none: { color: p.textSecondary, fontSize: 15, paddingHorizontal: 20, paddingTop: 28 },
    empty: { paddingHorizontal: 24, paddingTop: 40, gap: 12 },
    emptyTitle: { color: p.text, fontSize: 22, fontWeight: '800' },
    emptyText: { color: p.textSecondary, fontSize: 15, lineHeight: 22 },
    stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 },
    cardShadow: { shadowColor: '#000', shadowOpacity: p.scheme === 'dark' ? 0.5 : 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8, borderWidth: 1, borderColor: p.border },
    papers: { flexDirection: 'row', gap: 14 },
    swatch: { width: 34, height: 34, borderRadius: 17 },
    actions: { flexDirection: 'row', gap: 10 },
    primary: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.text, borderRadius: 999, paddingHorizontal: 22, height: 44 },
    primaryText: { color: p.bg, fontSize: 16, fontWeight: '700' },
    secondary: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 20, height: 44, justifyContent: 'center' },
    secondaryText: { color: p.text, fontSize: 16, fontWeight: '700' },
  });
