# ReelVault extensions

An extension adds a manga or comics source to ReelVault's Manga section. Extensions are listed in a
**repo**: a web address with an `index.json` that people add in **Manga → Browse → Extensions →
Add a repo**.

> Only make extensions for sources that have the right to share what they host: official
> publishers, creators who publish their own work, public-domain archives, or your own server.

## The repo: `index.json`

```json
{
  "name": "My repo",
  "extensions": [
    {
      "id": "public-domain-comics",
      "name": "Public Domain Comics",
      "version": 1,
      "lang": "en",
      "nsfw": false,
      "file": "public-domain-comics.js",
      "domains": ["api.example.org", "images.example.org"],
      "description": "Golden-age comics that are free to share"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | Lower case letters, digits, `.`, `_` or `-`. Stays the same between versions. |
| `version` | A number. Raise it and ReelVault offers the update. |
| `file` | The code, next to `index.json` (or a full `https://` address). |
| `domains` | The only sites the code may contact. `example.org` also allows its sub-domains. |

Repos and code must be served over `https://`. A GitHub repo page works as the repo link when
`index.json` sits on its `main` branch.

## The code

The file is the body of a function. It receives `api` and **returns** the source:

```js
const base = 'https://api.example.org';

return {
  async popular(page) {
    const r = await api.http.json(`${base}/comics?page=${page}`);
    return { items: r.items.map((c) => ({ key: c.id, title: c.title, cover: c.coverUrl, author: c.author })), hasMore: r.hasMore };
  },
  async latest(page) { /* optional, same shape as popular */ },
  async search(query, page) {
    const r = await api.http.json(`${base}/search?q=${encodeURIComponent(query)}&page=${page}`);
    return { items: r.items.map((c) => ({ key: c.id, title: c.title, cover: c.coverUrl })), hasMore: false };
  },
  async details(key) {
    const c = await api.http.json(`${base}/comics/${key}`);
    return { title: c.title, cover: c.coverUrl, author: c.author, description: c.summary, genres: c.tags, kind: 'comic', webUrl: c.url };
  },
  async chapters(key) {
    const list = await api.http.json(`${base}/comics/${key}/issues`);
    // First to last.
    return list.map((i) => ({ key: i.id, number: i.number, title: i.title, uploadedAt: i.date }));
  },
  async pages(chapterKey) {
    const issue = await api.http.json(`${base}/issues/${chapterKey}`);
    return issue.pages; // ["https://images.example.org/1.jpg", …] or [{ uri, headers }]
  },
};
```

`details`, `chapters` and `pages` are required. `popular` is what a source shows when opened and
`search` powers its search box; `latest` is optional (its tab shows only when it is there).

What comes back is checked: missing keys and titles are dropped, text is trimmed, and only
`http(s)` picture addresses are kept. `kind` is `manga`, `manhwa` (read as a webtoon strip) or
`comic`. A chapter with `externalUrl` opens in the browser.

### What `api` offers

| | |
| --- | --- |
| `api.http.json(url, { method, headers, body })` | A request whose answer is JSON. Only to `domains`. |
| `api.http.text(url, …)` | The same, the answer as text. |
| `api.html.parse(text)` | Reads HTML (or XML) into elements. |
| `api.html.select(root, 'div.item > a[href]')` | Elements matching a selector: tag, `#id`, `.class`, `[attr]`, `[attr=value]`, descendant, `>` and `,`. |
| `api.html.attr(el, 'href')`, `api.html.text(el)` | An attribute; the text inside. |
| `api.xml.parse`, `api.xml.findAll`, `api.xml.findFirst`, `api.xml.text` | The same reader for XML feeds. |
| `api.util.resolveUrl(base, href)` | A relative link made absolute. |
| `api.util.parseChapterName(name)` | Series, chapter number, volume and title from a name like "Title v02 c013". |

The code gets nothing else: no general network access, no files, no library.
