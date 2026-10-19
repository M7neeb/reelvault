/**
 * An audio item's details: edit its title, author, narrator, series, genre,
 * year and your notes; rate it (with decimals), set its status, add or
 * remove keywords; see what it is (files, length, size on the phone, when
 * added and last played); play from the start, mark it finished, share it
 * (a book is rebuilt as an .epub), change the cover, move it to Private, or
 * delete it (to Recently Deleted). Presentational only.
 */

import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import { AUDIO_STATUSES, displayTitle, fmtLength, fmtRating, progressOf, totalMs } from '../../audio/audioLogic';
import { fmtDateTime, fmtSize } from '../format';
import { success, tick } from '../haptics';
import Icon from '../Icon';
import { PromptSheet } from '../prompts';
import RatingPicker from '../RatingPicker';
import { SheetFrame } from '../sheets';
import { sheet, usePalette, useStyles, type Palette } from '../theme';
import AudioCover from './AudioCover';
import type { AudioActions, AudioEdit, AudioUiItem } from './audioTypes';

type Field = { key: keyof AudioEdit; label: string; placeholder: string; numeric?: boolean; multiline?: boolean };
const FIELDS: Field[] = [
  { key: 'title', label: 'Title', placeholder: 'Title' },
  { key: 'author', label: 'Author', placeholder: 'Who wrote or made it' },
  { key: 'narrator', label: 'Read by', placeholder: 'Narrator' },
  { key: 'album', label: 'Series', placeholder: 'Series or album' },
  { key: 'genre', label: 'Genre', placeholder: 'Genre' },
  { key: 'year', label: 'Year', placeholder: 'Year', numeric: true },
  { key: 'notes', label: 'Notes', placeholder: 'Your notes', multiline: true },
];

export default function AudioInfo({ item, actions, onPlayFromStart, onClose }: { item: AudioUiItem; actions: AudioActions; onPlayFromStart: () => void; onClose: () => void }) {
  const styles = useStyles(makeStyles);
  const p = usePalette();
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, item[f.key] == null ? '' : String(item[f.key])])));
  const [rating, setRating] = useState(false);
  const [tag, setTag] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = (f: Field) => {
    const raw = (draft[f.key] ?? '').trim();
    const value = f.numeric ? (raw ? Number(raw.replace(/\D/g, '')) || null : null) : raw || null;
    const now = item[f.key] ?? null;
    if (value === now) return;
    actions.update([item.id], { [f.key]: value } as AudioEdit).catch(() => undefined);
  };
  const pr = progressOf(item);
  const facts = [
    item.kind === 'book' ? (item.tracks.length ? 'EPUB 3 book with read-along' : 'EPUB book') : item.tracks.length > 1 ? `${item.tracks.length} audio files` : (item.filename.split('.').pop() ?? '').toUpperCase(),
    fmtLength(totalMs(item)),
    item.chapters.length > 1 ? `${item.chapters.length} chapters` : null,
    `${fmtSize(item.size)} on this iPhone`,
  ].filter(Boolean);

  return (
    <SheetFrame title={displayTitle(item)} onClose={onClose}>
      <View style={styles.head}>
        <TouchableOpacity onPress={() => actions.setCoverFromPhoto(item.id).catch(() => undefined)} accessibilityLabel="Change the cover">
          <AudioCover item={item} size={96} radius={16} />
          <Text style={styles.coverHint}>Change cover</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={styles.facts}>{facts.join(' · ')}</Text>
          <Text style={styles.facts}>Added {fmtDateTime(item.importedAt).date}</Text>
          {item.lastPlayedAt && <Text style={styles.facts}>Last played {fmtDateTime(item.lastPlayedAt).date}</Text>}
          {pr >= 0.01 && item.status !== 'finished' && <Text style={styles.facts}>{Math.round(pr * 100)}% listened</Text>}
          <TouchableOpacity style={styles.rate} onPress={() => setRating(true)}>
            <Icon name={item.rating ? 'star' : 'starOff'} size={16} color={item.rating ? p.rating : p.textSecondary} />
            <Text style={styles.rateText}>{item.rating ? `Your rating ${fmtRating(item.rating)}` : 'Rate it'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.section}>Status</Text>
      <View style={styles.chips}>
        {AUDIO_STATUSES.map((s) => {
          const on = item.status === s.key;
          return (
            <TouchableOpacity
              key={s.key}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => {
                tick();
                if (s.key === 'finished' && !on) actions.markFinished(item.id).catch(() => undefined);
                else actions.update([item.id], { status: on ? null : s.key }).catch(() => undefined);
              }}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{s.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.section}>Keywords</Text>
      <View style={styles.chips}>
        {item.tags.map((t) => (
          <TouchableOpacity key={t} style={styles.tag} onPress={() => actions.removeTag(item.id, t).catch(() => undefined)} accessibilityLabel={`Remove keyword ${t}`}>
            <Text style={styles.tagText}># {t}</Text>
            <Icon name="close" size={10} color={p.textSecondary} />
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.chip} onPress={() => setTag(true)}>
          <Text style={styles.chipText}>+ Keyword</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>Details</Text>
      {FIELDS.map((f) => (
        <View key={f.key} style={styles.field}>
          <Text style={styles.label}>{f.label}</Text>
          <TextInput
            value={draft[f.key]}
            onChangeText={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
            onEndEditing={() => save(f)}
            placeholder={f.placeholder}
            placeholderTextColor={p.textMuted}
            keyboardType={f.numeric ? 'number-pad' : 'default'}
            multiline={f.multiline}
            style={[styles.input, f.multiline && styles.inputMulti]}
          />
        </View>
      ))}
      {!!item.description && (
        <View style={styles.field}>
          <Text style={styles.label}>About</Text>
          <Text style={styles.about}>{item.description}</Text>
        </View>
      )}

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.action}
          onPress={() => {
            onPlayFromStart();
            onClose();
          }}>
          <Icon name="play" size={15} color={p.text} />
          <Text style={styles.actionText}>Play from the start</Text>
        </TouchableOpacity>
        {item.status === 'finished' ? (
          <TouchableOpacity style={styles.action} onPress={() => actions.reset(item.id, null).catch(() => undefined)}>
            <Icon name="repeat" size={15} color={p.text} />
            <Text style={styles.actionText}>Mark as not started</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.action}
            onPress={() => {
              success();
              actions.markFinished(item.id).catch(() => undefined);
            }}>
            <Icon name="check" size={15} color={p.text} />
            <Text style={styles.actionText}>Mark as finished</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.action} onPress={() => actions.share(item.id).catch(() => undefined)}>
          <Icon name="share" size={15} color={p.text} />
          <Text style={styles.actionText}>{item.kind === 'book' ? 'Share as .epub' : 'Share or save to Files'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.action} onPress={() => actions.update([item.id], { isPrivate: !item.isPrivate }).catch(() => undefined)}>
          <Icon name="lock" size={15} color={p.text} />
          <Text style={styles.actionText}>{item.isPrivate ? 'Remove from Private' : 'Move to Private'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.action} onPress={() => setConfirmDelete(true)}>
          <Icon name="trash" size={15} color={p.danger} />
          <Text style={[styles.actionText, { color: p.danger }]}>Delete</Text>
        </TouchableOpacity>
        {confirmDelete && (
          <View style={styles.confirm}>
            <Text style={styles.facts}>It goes to Recently Deleted; you can bring it back from there.</Text>
            <TouchableOpacity
              style={styles.danger}
              onPress={() => {
                actions.trash([item.id]).catch(() => undefined);
                onClose();
              }}>
              <Text style={styles.dangerText}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {rating && <RatingPicker title="Your rating" value={item.rating || null} onPick={(r) => actions.update([item.id], { rating: r ?? 0 }).catch(() => undefined)} onClose={() => setRating(false)} />}
      {tag && <PromptSheet title="Add a keyword" placeholder="e.g. sleep, series, favourite" onSubmit={(t) => t.trim() && actions.addTag([item.id], t.trim()).catch(() => undefined)} onClose={() => setTag(false)} />}
    </SheetFrame>
  );
}

const makeStyles = (p: Palette) =>
  sheet({
    head: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
    coverHint: { color: p.link, fontSize: 12, textAlign: 'center', marginTop: 5 },
    facts: { color: p.textSecondary, fontSize: 13 },
    rate: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, marginTop: 4 },
    rateText: { color: p.text, fontSize: 14, fontWeight: '700' },
    section: { color: p.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 14 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { backgroundColor: p.card, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
    chipOn: { backgroundColor: p.text },
    chipText: { color: p.text, fontSize: 14, fontWeight: '700' },
    chipTextOn: { color: p.bg },
    tag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: p.accentSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
    tagText: { color: p.link, fontSize: 14, fontWeight: '700' },
    field: { gap: 4 },
    label: { color: p.textSecondary, fontSize: 12, fontWeight: '700' },
    input: { color: p.text, fontSize: 16, backgroundColor: p.card, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
    inputMulti: { minHeight: 80, textAlignVertical: 'top' },
    about: { color: p.textSoft, fontSize: 14, lineHeight: 20 },
    actions: { gap: 2, marginTop: 14 },
    action: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: p.separator },
    actionText: { color: p.text, fontSize: 16 },
    confirm: { gap: 8, paddingVertical: 10 },
    danger: { backgroundColor: p.danger, borderRadius: 12, paddingVertical: 11, alignItems: 'center' },
    dangerText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  });
