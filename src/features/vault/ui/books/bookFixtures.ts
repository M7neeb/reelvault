/**
 * Books for the browser preview: a short shelf and the opening of a public
 * domain novel, so the reader can be looked at without a phone.
 */

import { DEFAULT_READER, type BookRead, type ReaderPrefs } from '../../books/bookLogic';
import type { BookActions, BookUi, BooksData } from './bookTypes';

const OPENING: string[] = [
  "On an exceptionally hot evening early in July a young man came out of the garret in which he lodged in S—— Place and walked slowly, as though in hesitation, towards K—— bridge.",
  "He had successfully avoided meeting his landlady on the staircase. His garret was under the roof of a high, five-storied house and was more like a cupboard than a room. The landlady who provided him with garret, dinners, and attendance, lived on the floor below, and every time he went out he was obliged to pass her kitchen, the door of which invariably stood open. And each time he passed, the young man had a sick, frightened feeling, which made him scowl and feel ashamed. He was hopelessly in debt to his landlady, and was afraid of meeting her.",
  "This was not because he was cowardly and abject, quite the contrary; but for some time past he had been in an overstrained irritable condition, verging on hypochondria. He had become so completely absorbed in himself, and isolated from his fellows that he dreaded meeting, not only his landlady, but anyone at all. He was crushed by poverty, but the anxieties of his position had of late ceased to weigh upon him. He had given up attending to matters of practical importance; he had lost all desire to do so. Nothing that any landlady could do had a real terror for him. But to be stopped on the stairs, to be forced to listen to her trivial, irrelevant gossip, to pestering demands for payment, threats and complaints, and to rack his brains for excuses, to prevaricate, to lie—no, rather than that, he would creep down the stairs like a cat and slip out unseen.",
  "This evening, however, on coming out into the street, he became acutely aware of his fears.",
  "“I want to attempt a thing like that and am frightened by these trifles,” he thought, with an odd smile. “Hm … yes, all is in a man’s hands and he lets it all slip from cowardice, that’s an axiom. It would be interesting to know what it is men are most afraid of. Taking a new step, uttering a new word is what they fear most. … But I am talking too much. It’s because I chatter that I do nothing. Or perhaps it is that I chatter because I do nothing. I’ve learned to chatter this last month, lying for days together in my den thinking … of Jack the Giant-killer. Why am I going there now? Am I capable of that? Is that serious? It is not serious at all. It’s simply a fantasy to amuse myself; a plaything! Yes, maybe it is a plaything.”",
  "The heat in the street was terrible: and the airlessness, the bustle and the plaster, scaffolding, bricks, and dust all about him, and that special Petersburg stench, so familiar to all who are unable to get out of town in summer—all worked painfully upon the young man’s already overwrought nerves. The insufferable stench from the pothouses, which are particularly numerous in that part of the town, and the drunken men whom he met continually, although it was a working day, completed the revolting misery of the picture. An expression of the profoundest disgust gleamed for a moment in the young man’s refined face. He was, by the way, exceptionally handsome, above the average in height, slim, well-built, with beautiful dark eyes and dark brown hair. Soon he sank into deep thought, or more accurately speaking into a complete blankness of mind; he walked along not observing what was about him and not caring to observe it. From time to time, he would mutter something, from the habit of talking to himself, to which he had just confessed. At these moments he would become conscious that his ideas were sometimes in a tangle and that he was very weak; for two days he had scarcely tasted food.",
  "He was so badly dressed that even a man accustomed to shabbiness would have been ashamed to be seen in the street in such rags. In that quarter of the town, however, scarcely any shortcoming in dress would have created surprise. Owing to the proximity of the Hay Market, the number of establishments of bad character, the preponderance of the trading and working class population crowded in these streets and alleys in the heart of Petersburg, types so various were to be seen in the streets that no figure, however queer, would have caused surprise. But there was such accumulated bitterness and contempt in the young man’s heart, that, in spite of all the fastidiousness of youth, he minded his rags least of all in the street. It was a different matter when he met with acquaintances or with former fellow students, whom, indeed, he disliked meeting at any time. And yet when a drunken man who, for some unknown reason, was being taken somewhere in a huge wagon dragged by a heavy dray horse, suddenly shouted at him as he drove past: “Hey there, German hatter” bawling at the top of his voice and pointing at him—the young man stopped suddenly and clutched tremulously at his hat. It was a tall round hat from Zimmerman’s, but completely worn out, rusty with age, all torn and bespattered, brimless and bent on one side in a most unseemly fashion. Not shame, however, but quite another feeling akin to terror had overtaken him.",
  "“I knew it,” he muttered in confusion, “I thought so! That’s the worst of all! Why, a stupid thing like this, the most trivial detail might spoil the whole plan. Yes, my hat is too noticeable. … It looks absurd and that makes it noticeable. … With my rags I ought to wear a cap, any sort of old pancake, but not this grotesque thing. Nobody wears such a hat, it would be noticed a mile off, it would be remembered. … What matters is that people would remember it, and that would give them a clue. For this business one should be as little conspicuous as possible. … Trifles, trifles are what matter! Why, it’s just such trifles that always ruin everything. …”"
];

const xhtml = (heading: string, paras: string[]) =>
  `<html><body><section><h3>${heading}</h3>${paras.map((p) => `<p>${p}</p>`).join('')}</section></body></html>`;

const day = 86_400_000;
const base = (id: string, title: string, author: string, over: Partial<BookUi>): BookUi => ({
  id,
  folder: `books/${id}`,
  filename: `${id}.epub`,
  size: 1_200_000,
  title,
  author,
  language: 'en',
  description: null,
  cover: null,
  coverUri: null,
  chapterSizes: Array.from({ length: 53 }, (_, i) => (i < 5 ? 2000 : 40_000)),
  chapter: 0,
  block: 0,
  chapterFrac: 0,
  readMs: 0,
  lastReadAt: null,
  finishedAt: null,
  addedAt: Date.now() - 10 * day,
  rating: 0,
  status: null,
  notes: null,
  isPrivate: false,
  deletedAt: null,
  tags: [],
  ...over,
});

export function fixtureBooksData(empty = false): BooksData {
  let reader: ReaderPrefs = DEFAULT_READER;
  const items: BookUi[] = empty
    ? []
    : [
        base('crime', 'Crime and Punishment', 'Fyodor Dostoevsky', { tags: ['Russian', 'Classics'], notes: 'Pevear and Volokhonsky next time, to compare.', chapter: 7, block: 5, chapterFrac: 0.4, readMs: 3 * 3_600_000, lastReadAt: Date.now() - 3_600_000 }),
        base('karamazov', 'The Brothers Karamazov', 'Fyodor Dostoevsky', { addedAt: Date.now() - day, tags: ['Russian', 'Classics'] }),
        base('master', 'The Master and Margarita', 'Mikhail Bulgakov', { addedAt: Date.now() - 3 * day, tags: ['Russian'], status: 'want' }),
        base('notes', 'Notes from Underground', 'Fyodor Dostoevsky', { rating: 9, tags: ['Russian'], finishedAt: new Date(new Date().getFullYear(), 1, 20).getTime(), lastReadAt: new Date(new Date().getFullYear(), 1, 20).getTime() }),
      ];
  const actions: BookActions = {
    importFiles: async () => undefined,
    open: async () => ({
      chapters: Array.from({ length: 53 }, (_, i) => ({ title: `Part ${i + 1}`, href: `c${i}.xhtml` })),
      toc: [
        { title: 'Crime and Punishment', chapter: 3, id: null, depth: 0 },
        { title: 'Part I', chapter: 4, id: null, depth: 1 },
        ...['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'].map((t, i) => ({ title: t, chapter: 5 + i, id: null, depth: 2 })),
        { title: 'Part II', chapter: 12, id: null, depth: 1 },
      ],
      chapterText: async () => xhtml('III', OPENING),
      uriOf: () => '',
    }),
    savePlace: async () => undefined,
    setFinished: async () => undefined,
    rate: async () => undefined,
    setStatus: async () => undefined,
    addTag: async () => undefined,
    removeTag: async () => undefined,
    setPrivate: async () => undefined,
    trash: async () => undefined,
    restore: async () => undefined,
    purge: async () => undefined,
    edit: async () => undefined,
    setNotes: async () => undefined,
    setCover: async () => undefined,
    loadMarks: async (id) =>
      id === 'crime'
        ? [
            { id: 1, bookId: id, kind: 'bookmark', chapter: 7, block: 2, text: null, note: null, createdAt: Date.now() - 5 * day },
            { id: 2, bookId: id, kind: 'highlight', chapter: 7, block: 5, text: 'Taking a new step, uttering a new word is what they fear most.', note: 'The whole book in one line?', createdAt: Date.now() - 2 * day },
            { id: 3, bookId: id, kind: 'highlight', chapter: 7, block: 1, text: 'He had successfully avoided meeting his landlady on the staircase.', note: null, createdAt: Date.now() - day },
          ]
        : [],
    addMark: async (m) => ({ ...m, id: Math.round(Math.random() * 1e6) }),
    setMarkNote: async () => undefined,
    deleteMark: async () => undefined,
    loadReads: async () => (empty ? [] : fixtureReads()),
    passage: async () => OPENING,
    setSort: async () => undefined,
    setReader: async (p) => {
      reader = p;
    },
  };
  const deleted = empty ? [] : [base('idiot', 'The Idiot', 'Fyodor Dostoevsky', { deletedAt: Date.now() - 4 * day })];
  return { items, deleted, trashDays: 30, loaded: true, status: '', busy: false, reader, sort: 'shelf', actions };
}

/** Most evenings of this year, steady progress through the three books (seeded, so screenshots repeat). */
function fixtureReads(): BookRead[] {
  const out: BookRead[] = [];
  const now = Date.now();
  const year = new Date(now).getFullYear();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const plan: [string, number, number][] = [
    ['notes', new Date(year - 1, 10, 2).getTime(), new Date(year, 1, 20).getTime()],
    ['crime', new Date(year, 2, 1).getTime(), now],
  ];
  for (const [id, from, to] of plan) {
    let p = 0;
    for (let d = from; d < to; d += day) {
      if (rnd() < 0.35) continue;
      const evening = rnd() < 0.7;
      const start = new Date(d).setHours(evening ? 21 + Math.floor(rnd() * 3) : 7 + Math.floor(rnd() * 3), Math.floor(rnd() * 60));
      if (start > now) break;
      const ms = (10 + Math.floor(rnd() * 50)) * 60_000;
      const step = id === 'notes' ? 0.012 : 0.0013;
      out.push({ bookId: id, startedAt: start, endedAt: start + ms, ms, from: p, to: Math.min(1, p + step) });
      p = Math.min(1, p + step);
    }
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}
