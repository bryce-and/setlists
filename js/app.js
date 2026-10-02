import { DB } from './db.js';
import { readTags, shrinkCover } from './id3.js';

/* ============================================================ helpers */
const $ = (s, el = document) => el.querySelector(s);
const main = $('#main'), audio = $('#audio');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const sortKey = (s) => String(s || '').toLowerCase().replace(/^(the|a|an) /, '').trim();
const lc = (s) => String(s || '').toLowerCase();
const fmt = (s) => {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
const fmtBytes = (n) => (n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; };
const initial = (s) => (String(s || '?').replace(/^(the|a|an) /i, '').trim()[0] || '?').toUpperCase();
const stripExt = (n) => n.replace(/\.[^.]+$/, '');

/* ============================================================ generated sleeves
   Anything without a photo gets a deterministic "record sleeve": flat colour,
   one geometric mark, set type. Same name, same sleeve. */
const SLEEVES = [
  { bg: '#1b2fc9', fg: '#f9f9f7', mk: '#f0c94a' }, { bg: '#e9e4d6', fg: '#141414', mk: '#d9442b' },
  { bg: '#141414', fg: '#f9f9f7', mk: '#8fa8d6' }, { bg: '#d9442b', fg: '#f9f9f7', mk: '#141414' },
  { bg: '#c9d6c3', fg: '#141414', mk: '#1b2fc9' }, { bg: '#f0c94a', fg: '#141414', mk: '#1b2fc9' },
  { bg: '#e7b8c4', fg: '#141414', mk: '#141414' }, { bg: '#8fa8d6', fg: '#141414', mk: '#f9f9f7' },
];
const sleeveOf = (seed) => SLEEVES[hash(seed) % SLEEVES.length];
const toneOfSeed = (seed) => { const p = sleeveOf(seed); return p.bg === '#141414' || p.bg === '#e9e4d6' ? p.mk : p.bg; };
function wrap(s, max) {
  const out = []; let line = '';
  for (const w of String(s).toUpperCase().split(/\s+/)) {
    if ((line + ' ' + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out.slice(0, 4);
}
function sleeveSVG(title, artist, seed, full) {
  const h = hash(seed), p = sleeveOf(seed), m = (h >> 4) % 6, a = (h >> 8) % 30, b = (h >> 13) % 20;
  let mark = '';
  if (m === 0) mark = `<circle cx="${34 + a}" cy="${50 + b / 3}" r="${20 + b / 3}" fill="${p.mk}"/>`;
  else if (m === 1) mark = `<path d="M${8 + a / 3} 78 A42 42 0 0 1 ${92 - a / 3} 78Z" fill="${p.mk}"/>`;
  else if (m === 2) mark = [0, 1, 2, 3, 4].map((i) => `<rect x="${14 + i * 17}" y="${32 + (i % 2) * 6 + b / 3}" width="9" height="${34 - (i % 3) * 6}" fill="${p.mk}"/>`).join('');
  else if (m === 3) mark = [10, 20, 30].map((r) => `<circle cx="50" cy="${54 + b / 3}" r="${r}" fill="none" stroke="${p.mk}" stroke-width="1.6"/>`).join('');
  else if (m === 4) mark = `<polygon points="100,0 100,100 ${52 + a},100" fill="${p.mk}"/>`;
  else mark = Array.from({ length: 16 }, (_, i) => `<circle cx="${22 + (i % 4) * 19}" cy="${38 + Math.floor(i / 4) * 13}" r="${2.2 + ((h >> i) & 1)}" fill="${p.mk}"/>`).join('');
  let text = '';
  if (full) {
    const lines = wrap(title, 12), size = lines.some((l) => l.length > 10) ? 7.6 : 9;
    text = lines.map((l, i) => `<text x="7" y="${15 + i * (size + 3)}" font-size="${size}" font-weight="700" letter-spacing=".9" fill="${p.fg}" font-family="Helvetica Neue,Helvetica,Arial,sans-serif">${esc(l)}</text>`).join('')
      + (artist ? `<text x="7" y="94" font-size="6" font-style="italic" fill="${p.fg}" font-family="Iowan Old Style,Palatino,Georgia,serif">${esc(String(artist).slice(0, 30))}</text>` : '');
  }
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="100" height="100" fill="${p.bg}"/>${mark}${text}</svg>`;
}
function art(url, { title, artist, seed, full = false, cls = '' }) {
  return `<div class="art ${cls}">${url ? `<img src="${url}" alt="" decoding="async" loading="lazy">` : sleeveSVG(title, artist, seed, full)}<div class="eq"><i></i><i></i><i></i></div></div>`;
}

/* ============================================================ icons */
const P_ = {
  home: '<path d="M3 11l9-8 9 8M5 9.5V20h14V9.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  dots: '<circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>',
  play: '<path d="M7 4.5v15l13-7.5z"/>',
  pause: '<rect x="6" y="4.5" width="4.2" height="15" rx="1"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1"/>',
  next: '<path d="M5 5l10 7-10 7z"/><rect x="16" y="5" width="3" height="14" rx="1"/>',
  prev: '<path d="M19 5L9 12l10 7z"/><rect x="5" y="5" width="3" height="14" rx="1"/>',
  shuffle: '<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  repeat1: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/><path d="M11 10h1.2v4.5"/>',
  down: '<path d="M6 9l6 6 6-6"/>', left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 6l6 6-6 6"/>', up: '<path d="M6 15l6-6 6 6"/>',
  queue: '<path d="M3 6h18M3 12h18M3 18h12"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  minus: '<path d="M5 12h14"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 9"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  note: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  list: '<path d="M3 6h14M3 12h14M3 18h8"/><circle cx="18" cy="18" r="2.5"/><path d="M20.5 18V9"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  zoomin: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6M11 8v6"/>',
  zoomout: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
};
const FILLED = new Set(['play', 'pause', 'next', 'prev', 'dots']);
const ic = (n, cls = '') => `<svg class="i ${FILLED.has(n) ? 'f' : ''} ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P_[n]}</svg>`;

/* ============================================================ state & indexes */
const state = { artists: [], songs: [], files: [], setlists: [], cover: new Map(), stack: [], sort: 'title', query: '' };
let artistById = new Map(), songById = new Map(), fileById = new Map(), filesBySong = new Map(), songsByArtist = new Map();

function reindex() {
  artistById = new Map(state.artists.map((a) => [a.id, a]));
  songById = new Map(state.songs.map((s) => [s.id, s]));
  fileById = new Map(state.files.map((f) => [f.id, f]));
  filesBySong = new Map(); songsByArtist = new Map();
  for (const f of state.files) { if (!filesBySong.has(f.songId)) filesBySong.set(f.songId, []); filesBySong.get(f.songId).push(f); }
  for (const s of state.songs) { if (!songsByArtist.has(s.artistId)) songsByArtist.set(s.artistId, []); songsByArtist.get(s.artistId).push(s); }
  for (const l of filesBySong.values()) l.sort((a, b) => a.added - b.added);
  for (const l of songsByArtist.values()) l.sort((a, b) => collator.compare(sortKey(a.title), sortKey(b.title)));
}
const filesOf = (sid) => filesBySong.get(sid) || [];
const chartsOf = (sid) => filesOf(sid).filter((f) => f.kind === 'chart');
const audioOf = (sid) => filesOf(sid).filter((f) => f.kind === 'audio');
const songsOf = (aid) => songsByArtist.get(aid) || [];
const artistName = (s) => artistById.get(s.artistId)?.name || 'Unknown Artist';
const sortedArtists = () => [...state.artists].sort((a, b) => collator.compare(sortKey(a.name), sortKey(b.name)));
function sortedSongs() {
  const ts = [...state.songs];
  if (state.sort === 'recent') return ts.sort((a, b) => b.added - a.added);
  if (state.sort === 'artist') return ts.sort((a, b) => collator.compare(sortKey(artistName(a)), sortKey(artistName(b))) || collator.compare(sortKey(a.title), sortKey(b.title)));
  return ts.sort((a, b) => collator.compare(sortKey(a.title), sortKey(b.title)));
}
const songSleeve = (s) => ({ title: s.title, artist: artistName(s), seed: s.title + artistName(s) });
const songArt = (s, opts = {}) => art(state.cover.get(s.id) || null, { ...songSleeve(s), ...opts });
const artistArt = (a, opts = {}) => art(state.cover.get(a.id) || null, { title: a.name, artist: '', seed: a.name, ...opts });
const setlistArt = (l, opts = {}) => art(null, { title: l.name, artist: 'Setlist', seed: l.id, ...opts });
const findArtist = (name) => state.artists.find((a) => lc(a.name) === lc(name.trim() || 'Unknown Artist')) || null;
async function ensureArtist(name) {
  const n = name.trim() || 'Unknown Artist';
  let a = findArtist(n);
  if (!a) { a = { id: uid(), name: n, added: Date.now() }; state.artists.push(a); await DB.put('artists', a); reindex(); }
  return a;
}

/* ============================================================ view pieces */
const head = (title, sub, btns = '') => `<div class="head"><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}<div class="btns">${btns}</div></div>`;
const addBtn = `<button class="iconbtn" data-act="add-menu" aria-label="Add">${ic('plus')}</button>`;
const back = `<button class="back" data-act="back">${ic('left')} Back</button>`;
const gone = `${back}<div class="empty"><h2>Not found</h2></div>`;
const sect = (label, addHTML = '') => `<div class="sect left"><span>${label}</span>${addHTML}</div>`;
const isPdf = (f) => /pdf/i.test(f.mime || '') || /\.pdf$/i.test(f.name);

function songRow(s, { num, ctx = '' } = {}) {
  const cc = chartsOf(s.id).length, ac = audioOf(s.id).length;
  const bits = [artistName(s), s.key, s.bpm && `${s.bpm} bpm`, cc && plural(cc, 'chart'), ac && `${ac} mp3`].filter(Boolean);
  const lead = num != null ? `<div class="num">${num}</div>` : songArt(s);
  return `<div class="row" data-act="play-row" data-id="${s.id}" data-ctx="${esc(ctx)}">${lead}
    <div class="meta"><div class="t">${esc(s.title)}</div><div class="s">${esc(bits.join(' | '))}</div></div>
    <button class="more chartbtn ${cc ? '' : 'off'}" data-act="song-chart" data-id="${s.id}" aria-label="Open chart">${ic('doc')}</button>
    <button class="more" data-act="song-menu" data-id="${s.id}" data-ctx="${esc(ctx)}" aria-label="More">${ic('dots')}</button></div>`;
}
function emptyHTML() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  return `<div class="empty"><h2>Nothing here yet</h2><p>Add an artist, then add songs with charts and MP3s. Or import MP3s and they'll be filed by artist and song automatically.</p>
    <div class="actions" style="padding:0"><button class="btn" data-act="new-artist">${ic('plus')} Artist</button><button class="btn ghost" data-act="import">${ic('upload')} MP3s</button></div></div>
    ${ios && !standalone && !localStorage.getItem('tipHidden') ? `<div class="tip"><span>To install: tap Share, then “Add to Home Screen”.</span><button data-act="hide-tip">Hide</button></div>` : ''}`;
}

/* ============================================================ views */
function viewHome() {
  const recent = [...state.songs].sort((a, b) => b.added - a.added).slice(0, 5);
  const sub = state.songs.length ? `${plural(state.artists.length, 'artist')} | ${plural(state.songs.length, 'song')}` : 'Charts, MP3s and setlists';
  return head('SetLists', sub, addBtn) +
    `<label class="search big">${ic('search')}<input id="q" type="search" placeholder="Search artists, songs, charts" value="${esc(state.query)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
    <div id="homebody">
      <div class="home">
        <button class="hbtn solid" data-act="home-go" data-to="artists"><div><div class="n">Artists</div><div class="c">${state.artists.length}</div></div>${ic('right')}</button>
        <button class="hbtn" data-act="home-go" data-to="songs"><div><div class="n">Songs</div><div class="c">${state.songs.length}</div></div>${ic('right')}</button>
        <button class="hbtn" data-act="home-go" data-to="setlists"><div><div class="n">Setlists</div><div class="c">${state.setlists.length}</div></div>${ic('right')}</button>
      </div>
      ${state.songs.length ? `<div class="recent-h">Recently added</div>${recent.map((s) => songRow(s)).join('')}` : emptyHTML()}
    </div><div id="results"></div>`;
}
function viewArtists() {
  const as = sortedArtists();
  if (!as.length) return head('Artists', '', addBtn) + emptyHTML();
  return head('Artists', plural(as.length, 'artist'), `<button class="iconbtn" data-act="new-artist" aria-label="New artist">${ic('plus')}</button>`) +
    `<div class="names">${as.map((a) => `<div class="name" data-act="open-artist" data-id="${a.id}">${esc(a.name)}<small>${plural(songsOf(a.id).length, 'song')}</small></div>`).join('')}</div>`;
}
function viewSongs() {
  const ts = sortedSongs();
  if (!ts.length) return head('Songs', '', addBtn) + emptyHTML();
  const seg = [['title', 'Title'], ['artist', 'Artist'], ['recent', 'Recent']].map(([k, l]) => `<button class="${state.sort === k ? 'on' : ''}" data-act="sort" data-k="${k}">${l}</button>`).join('');
  let body = '', last = '';
  for (const s of ts) {
    if (state.sort !== 'recent') {
      let L = initial(sortKey(state.sort === 'title' ? s.title : artistName(s))); if (!/[A-Z]/.test(L)) L = '#';
      if (L !== last) { body += `<div class="letter">${L}</div>`; last = L; }
    }
    body += songRow(s, { ctx: 'all' });
  }
  return head('Songs', plural(ts.length, 'song'), addBtn) + `<div class="seg">${seg}</div>` + body;
}
function viewArtist(id) {
  const a = artistById.get(id); if (!a) return gone;
  const ss = songsOf(id), charts = ss.reduce((n, s) => n + chartsOf(s.id).length, 0), mp3 = ss.reduce((n, s) => n + audioOf(s.id).length, 0);
  return `${back}<div class="hero">${artistArt(a, { full: true })}<h2>${esc(a.name)}</h2>
    <div class="sub">${[plural(ss.length, 'song'), charts && plural(charts, 'chart'), mp3 && plural(mp3, 'mp3')].filter(Boolean).join(' | ')}</div></div>
    <div class="actions"><button class="btn" data-act="add-song" data-artist="${a.id}">${ic('plus')} Add song</button><button class="btn ghost" style="flex:0 0 52px" data-act="artist-menu" data-id="${a.id}" aria-label="Artist options">${ic('dots')}</button></div>
    ${ss.length ? ss.map((s) => songRow(s, { ctx: 'ar:' + id })).join('') : `<div class="empty" style="padding-top:30px"><p>No songs yet. Add the first one.</p></div>`}`;
}
function chartRow(f) {
  return `<div class="row" data-act="open-chart" data-id="${f.id}"><div class="ficon">${isPdf(f) ? 'PDF' : 'IMG'}</div>
    <div class="meta"><div class="t plain">${esc(f.label || stripExt(f.name))}</div><div class="s">${fmtBytes(f.size)}</div></div>
    <button class="more" data-act="file-menu" data-id="${f.id}" aria-label="More">${ic('dots')}</button></div>`;
}
function audioRow(f) {
  const s = songById.get(f.songId);
  return `<div class="row" data-act="play-file" data-id="${f.id}">${songArt(s)}
    <div class="meta"><div class="t plain">${esc(f.label || stripExt(f.name))}</div><div class="s">${f.duration ? fmt(f.duration) + ' | ' : ''}${fmtBytes(f.size)}</div></div>
    <button class="more" data-act="file-menu" data-id="${f.id}" aria-label="More">${ic('dots')}</button></div>`;
}
function viewSong(id) {
  const s = songById.get(id); if (!s) return gone;
  const a = artistById.get(s.artistId), charts = chartsOf(id), tracks = audioOf(id);
  const pills = [s.key && `Key ${esc(s.key)}`, s.bpm && `${esc(s.bpm)} bpm`].filter(Boolean).map((p) => `<span class="pill">${p}</span>`).join('');
  const addIn = (kind, accept, label) => `<label class="add">${ic('plus')} ${label}<input type="file" class="addfile" data-song="${id}" data-kind="${kind}" accept="${accept}" multiple hidden></label>`;
  return `${back}<div class="hero">${songArt(s, { full: true })}<h2>${esc(s.title)}</h2>
    <div class="sub"><a class="link" data-act="open-artist" data-id="${s.artistId}">${esc(a?.name || 'Unknown Artist')}</a></div>
    ${pills ? `<div class="pills">${pills}</div>` : ''}
    <button class="textbtn" data-act="song-art" data-id="${id}">Change artwork</button></div>
    ${s.notes ? `<div class="notes">${esc(s.notes)}</div>` : ''}
    <div class="actions">${tracks.length ? `<button class="btn" data-act="play-song" data-id="${id}">${ic('play')} Play</button>` : ''}<button class="btn ghost" data-act="song-to-setlist" data-id="${id}">${ic('list')} Setlist</button><button class="btn ghost" style="flex:0 0 52px" data-act="song-menu" data-id="${id}" data-ctx="page" aria-label="Song options">${ic('dots')}</button></div>
    ${sect('Charts', addIn('chart', 'application/pdf,.pdf,image/*', 'Add chart'))}
    ${charts.length ? charts.map(chartRow).join('') : `<div class="empty" style="padding:22px 30px"><p style="margin:0">No charts yet. Add a PDF or a photo of the chart.</p></div>`}
    ${sect('Audio', addIn('audio', 'audio/mpeg,.mp3,audio/*', 'Add MP3'))}
    ${tracks.length ? tracks.map(audioRow).join('') : `<div class="empty" style="padding:22px 30px"><p style="margin:0">No MP3s yet. Add the record, a demo or a reference track.</p></div>`}`;
}
function viewSetlists() {
  const ls = [...state.setlists].sort((a, b) => b.created - a.created);
  return head('Setlists', plural(ls.length, 'setlist'), `<button class="iconbtn" data-act="new-setlist" aria-label="New setlist">${ic('plus')}</button>`) +
    (ls.length ? ls.map((l) => `<div class="row" data-act="open-setlist" data-id="${l.id}">${setlistArt(l)}<div class="meta"><div class="t">${esc(l.name)}</div><div class="s">${plural(l.songIds.filter((i) => songById.has(i)).length, 'song')}</div></div>${ic('right')}</div>`).join('')
      : `<div class="empty"><p>Build a setlist for a gig: pick songs and put them in order.</p><button class="btn" data-act="new-setlist">${ic('plus')} New setlist</button></div>`);
}
const setlistSongs = (l) => l.songIds.map((i) => songById.get(i)).filter(Boolean);
function viewSetlist(id) {
  const l = state.setlists.find((x) => x.id === id); if (!l) return gone;
  const ss = setlistSongs(l), playable = ss.filter((s) => audioOf(s.id).length).length;
  return `${back}<div class="hero">${setlistArt(l, { full: true })}<h2>${esc(l.name)}</h2><div class="sub">${plural(ss.length, 'song')}${playable ? ` | ${playable} with audio` : ''}</div></div>
    <div class="actions">${playable ? `<button class="btn" data-act="play-setlist" data-id="${id}">${ic('play')} Play</button>` : ''}<button class="btn ghost" data-act="sl-add" data-id="${id}">${ic('plus')} Add songs</button><button class="btn ghost" style="flex:0 0 52px" data-act="sl-menu" data-id="${id}" aria-label="Setlist options">${ic('dots')}</button></div>
    ${ss.length ? ss.map((s, i) => songRow(s, { num: i + 1, ctx: 'sl:' + id })).join('') : `<div class="empty" style="padding-top:30px"><p>Nothing in this setlist yet.</p></div>`}`;
}
function renderResults() {
  const q = lc(state.query).trim(), el = $('#results'); if (!el) return;
  const hb = $('#homebody'); if (hb) hb.hidden = !!q;
  if (!q) { el.innerHTML = ''; return; }
  const has = (...f) => f.some((x) => lc(x).includes(q));
  const ss = state.songs.filter((s) => has(s.title, artistName(s), s.key) || filesOf(s.id).some((f) => has(f.label, f.name))).sort((a, b) => collator.compare(sortKey(a.title), sortKey(b.title)));
  const as = sortedArtists().filter((a) => has(a.name));
  let h = '';
  if (as.length) h += `<div class="sect">Artists</div><div class="names" style="padding:0">${as.slice(0, 6).map((a) => `<div class="name" data-act="open-artist" data-id="${a.id}">${esc(a.name)}</div>`).join('')}</div>`;
  if (ss.length) h += `<div class="sect">Songs</div>` + ss.slice(0, 40).map((s) => songRow(s)).join('');
  el.innerHTML = h || `<div class="empty" style="padding-top:40px"><p>No results for “${esc(state.query)}”.</p></div>`;
  markPlaying();
}

const TOP_PAGES = { songs: viewSongs, artists: viewArtists, setlists: viewSetlists };
function render(keepScroll = false) {
  const top = state.stack.at(-1), sy = keepScroll ? main.scrollTop : 0;
  if (!top) main.innerHTML = viewHome();
  else if (TOP_PAGES[top.name]) main.innerHTML = back + TOP_PAGES[top.name]();
  else main.innerHTML = { artist: viewArtist, song: viewSong, setlist: viewSetlist }[top.name](top.id);
  main.scrollTop = sy;
  if (!top) renderResults();
  renderDock(); markPlaying();
}
function renderDock() {
  const h = $('#homebtn'); h.innerHTML = ic('home');
  h.classList.toggle('on', !state.stack.length && !state.query.trim());
}
const goto = (name, id) => { closeNP(); closeViewer(); state.stack.push({ name, id }); render(); };

/* ============================================================ sheets & toast */
const overlay = $('#overlay');
function sheet(build) {
  const bd = document.createElement('div'); bd.className = 'backdrop';
  const el = document.createElement('div'); el.className = 'sheet';
  bd.append(el); overlay.append(bd);
  requestAnimationFrame(() => bd.classList.add('open'));
  let closed = false;
  const close = () => { if (closed) return; closed = true; bd.classList.remove('open'); setTimeout(() => bd.remove(), 280); };
  bd.addEventListener('click', (e) => { if (e.target === bd) close(); });
  build(el, close);
  return close;
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
function actionSheet(title, sub, items) {
  const list = items.filter(Boolean);
  sheet((el, close) => {
    el.innerHTML = `<div class="sh-title"><b>${esc(title)}</b><span>${esc(sub || '')}</span></div>` +
      list.map((it, i) => `<button class="item ${it.danger ? 'danger' : ''}" data-i="${i}">${ic(it.icon || 'dots')}${esc(it.label)}</button>`).join('');
    el.addEventListener('click', (e) => { const b = e.target.closest('.item'); if (!b) return; close(); setTimeout(() => list[+b.dataset.i].run(), 140); });
  });
}
function waitClosed(el, onGone) { new MutationObserver((_, o) => { if (!el.isConnected) { o.disconnect(); onGone(); } }).observe(overlay, { childList: true, subtree: true }); }
function promptSheet({ title, value = '', placeholder = '', cta = 'Save' }) {
  return new Promise((resolve) => {
    let done = false;
    sheet((el, close) => {
      el.innerHTML = `<div class="sh-title"><b>${esc(title)}</b></div><div class="body"><label class="field"><input type="text" id="pv" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" maxlength="80"></label></div>
        <div class="foot"><button class="btn ghost" data-r="0">Cancel</button><button class="btn" data-r="1">${esc(cta)}</button></div>`;
      const input = $('#pv', el); setTimeout(() => { input.focus(); input.select(); }, 300);
      const fin = (ok) => { if (done) return; done = true; close(); resolve(ok ? input.value.trim() : null); };
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) fin(b.dataset.r === '1'); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') fin(true); });
      waitClosed(el, () => { if (!done) { done = true; resolve(null); } });
    });
  });
}
function confirmSheet(title, msg, cta) {
  return new Promise((resolve) => {
    let done = false;
    sheet((el, close) => {
      el.innerHTML = `<div class="sh-title"><b>${esc(title)}</b></div><div class="body"><p>${esc(msg)}</p></div><div class="foot"><button class="btn ghost" data-r="0">Cancel</button><button class="btn" style="background:#c22" data-r="1">${esc(cta)}</button></div>`;
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { done = true; close(); resolve(b.dataset.r === '1'); } });
      waitClosed(el, () => { if (!done) { done = true; resolve(false); } });
    });
  });
}
function failSheet(failed) {
  sheet((el) => { el.innerHTML = `<div class="sh-title"><b>Couldn't add ${plural(failed.length, 'file')}</b></div><div class="body">${failed.slice(0, 20).map((x) => `<p style="margin-bottom:8px">${esc(x)}</p>`).join('')}</div>`; });
}

/* ============================================================ player (plays attached MP3s) */
const Q = { queue: [], orig: [], idx: -1, shuffle: false, repeat: 'off', token: 0, url: null, dragging: false };
const cur = () => fileById.get(Q.queue[Q.idx]);
const curSong = () => { const f = cur(); return f && songById.get(f.songId); };
const shuffled = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

async function playList(ids, startId) {
  if (!ids.length) return;
  Q.orig = [...ids]; Q.shuffle = false; Q.queue = [...ids]; Q.idx = startId ? Math.max(0, ids.indexOf(startId)) : 0;
  await loadCurrent(true);
}
async function loadCurrent(autoplay) {
  const f = cur(); if (!f) return;
  const tok = ++Q.token;
  updateUI();
  const blob = await DB.blob(f.id);
  if (tok !== Q.token) return;
  if (!blob) { toast('Audio file missing'); return; }
  const old = Q.url; Q.url = URL.createObjectURL(blob); audio.src = Q.url; if (old) URL.revokeObjectURL(old);
  if (autoplay) { try { await audio.play(); } catch (e) { if (e.name !== 'AbortError') toast('Tap play to start'); } }
  saveSession();
}
function next(auto) {
  if (auto && Q.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
  if (Q.idx < Q.queue.length - 1) { Q.idx++; loadCurrent(true); }
  else if (Q.repeat === 'all' && Q.queue.length) { Q.idx = 0; loadCurrent(true); }
  else if (auto) { audio.pause(); audio.currentTime = 0; }
}
function prev() { if (audio.currentTime > 3 || Q.idx <= 0) { audio.currentTime = 0; return; } Q.idx--; loadCurrent(true); }
function togglePlay() { if (!cur()) return; if (!audio.src) { loadCurrent(true); return; } audio.paused ? audio.play().catch(() => {}) : audio.pause(); }
function toggleShuffle() {
  Q.shuffle = !Q.shuffle;
  if (!Q.queue.length) return updateUI();
  const c = Q.queue[Q.idx];
  if (Q.shuffle) Q.queue = [...Q.queue.slice(0, Q.idx + 1), ...shuffled(Q.queue.slice(Q.idx + 1))];
  else { Q.queue = Q.orig.filter((x) => fileById.has(x)); Q.idx = Math.max(0, Q.queue.indexOf(c)); }
  updateUI(); saveSession();
}
function cycleRepeat() { Q.repeat = { off: 'all', all: 'one', one: 'off' }[Q.repeat]; updateUI(); saveSession(); }
function saveSession() { try { localStorage.setItem('session', JSON.stringify({ q: Q.queue, o: Q.orig, i: Q.idx, s: Q.shuffle, r: Q.repeat })); } catch { /* storage unavailable */ } }
async function restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem('session') || 'null'); if (!s) return;
    Q.queue = s.q.filter((id) => fileById.has(id)); Q.orig = s.o.filter((id) => fileById.has(id));
    Q.idx = Math.min(s.i, Q.queue.length - 1); Q.shuffle = !!s.s; Q.repeat = s.r || 'off';
    if (cur()) { updateUI(); const blob = await DB.blob(cur().id); if (blob) { Q.url = URL.createObjectURL(blob); audio.src = Q.url; } }
  } catch { /* ignore corrupt session */ }
}
function dropFromPlayer(ids) {
  const set = new Set(ids); if (!Q.queue.some((x) => set.has(x))) return;
  const wasCur = set.has(Q.queue[Q.idx]), before = Q.queue.slice(0, Q.idx).filter((x) => !set.has(x)).length;
  Q.queue = Q.queue.filter((x) => !set.has(x)); Q.orig = Q.orig.filter((x) => !set.has(x));
  Q.idx = Math.min(before, Q.queue.length - 1);
  if (wasCur) { audio.pause(); if (Q.queue.length) loadCurrent(false); else { audio.removeAttribute('src'); updateUI(); } }
  saveSession();
}

audio.addEventListener('ended', () => next(true));
audio.addEventListener('play', () => { document.body.classList.remove('paused'); updatePlayState(); });
audio.addEventListener('pause', () => { document.body.classList.add('paused'); updatePlayState(); });
audio.addEventListener('error', () => { if (audio.src) toast('Could not play this file'); });
audio.addEventListener('loadedmetadata', () => {
  const f = cur();
  if (f && Number.isFinite(audio.duration) && Math.abs((f.duration || 0) - audio.duration) > 2) { f.duration = audio.duration; DB.put('files', f).catch(() => {}); }
  updateTime();
});
audio.addEventListener('timeupdate', updateTime);
document.body.classList.add('paused');

/* ---------- mini + now playing ---------- */
const mini = $('#mini'), np = $('#np');
const avgCache = new Map();
function avgColor(url) {
  if (avgCache.has(url)) return Promise.resolve(avgCache.get(url));
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 8;
        const x = c.getContext('2d'); x.drawImage(img, 0, 0, 8, 8);
        const d = x.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        const n = d.length / 4, v = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
        avgCache.set(url, v); res(v);
      } catch { res(null); }
    };
    img.onerror = () => res(null); img.src = url;
  });
}
function setTone(s) {
  document.documentElement.style.setProperty('--line', s ? toneOfSeed(songSleeve(s).seed) : '#1b2fc9');
  const url = s && state.cover.get(s.id);
  if (url) avgColor(url).then((c) => { if (c && curSong() === s) document.documentElement.style.setProperty('--line', c); });
}
function updateUI() {
  const f = cur(), s = curSong();
  setTone(s);
  mini.hidden = !f || !s;
  if (f && s) {
    mini.innerHTML = `<div data-act="open-np" style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">${songArt(s, { cls: 'sm' })}
      <div class="meta"><div class="t">${esc(s.title)}</div><div class="s">${esc(artistName(s))}</div></div></div>
      <button class="pp" data-act="toggle" aria-label="Play or pause">${ic(audio.paused ? 'play' : 'pause')}</button>
      <button data-act="next" aria-label="Next">${ic('next')}</button>`;
    renderNP(f, s); updateMediaSession(f, s);
  } else np.classList.remove('open');
  markPlaying(); updateTime();
}
function updatePlayState() {
  const pp = mini.querySelector('.pp'); if (pp) pp.innerHTML = ic(audio.paused ? 'play' : 'pause');
  const m = $('#np-pp'); if (m) m.innerHTML = ic(audio.paused ? 'play' : 'pause');
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
}
function renderNP(f, s) {
  np.innerHTML = `<div class="bar"><button data-act="close-np" aria-label="Close">${ic('down')}</button>
      <div class="lbl">Now playing<b>${esc(f.label || stripExt(f.name))}</b></div>
      <button data-act="np-menu" aria-label="More">${ic('dots')}</button></div>
    <div class="cover">${songArt(s, { full: true })}</div>
    <div class="info"><div class="meta"><div class="t">${esc(s.title)}</div><div class="s">${esc(artistName(s))}</div></div></div>
    <div class="seekwrap"><input type="range" id="seek" min="0" max="1000" value="0" aria-label="Seek"><div class="times"><span id="tcur">0:00</span><span id="tdur">${fmt(f.duration)}</span></div></div>
    <div class="ctrls">
      <button class="sm ${Q.shuffle ? 'on' : ''}" data-act="shuffle" aria-label="Shuffle">${ic('shuffle')}</button>
      <button data-act="prev" aria-label="Previous">${ic('prev')}</button>
      <button class="main" id="np-pp" data-act="toggle" aria-label="Play or pause">${ic(audio.paused ? 'play' : 'pause')}</button>
      <button data-act="next" aria-label="Next">${ic('next')}</button>
      <button class="sm ${Q.repeat !== 'off' ? 'on' : ''}" data-act="repeat" aria-label="Repeat">${ic(Q.repeat === 'one' ? 'repeat1' : 'repeat')}</button></div>
    <div class="np-foot"><button data-act="queue">${ic('queue')} Up next</button><button data-act="np-song">${ic('doc')} Charts</button></div>`;
  const seek = $('#seek');
  seek.addEventListener('input', () => { Q.dragging = true; seek.style.setProperty('--p', seek.value / 10 + '%'); $('#tcur').textContent = fmt((seek.value / 1000) * (audio.duration || 0)); });
  seek.addEventListener('change', () => { if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration; Q.dragging = false; });
}
function updateTime() {
  const d = audio.duration, c = audio.currentTime || 0, pct = d > 0 ? (c / d) * 100 : 0;
  mini.style.setProperty('--pf', (pct / 100).toFixed(4));
  const seek = $('#seek');
  if (seek && !Q.dragging) {
    seek.value = pct * 10; seek.style.setProperty('--p', pct + '%');
    $('#tcur').textContent = fmt(c); $('#tdur').textContent = fmt(Number.isFinite(d) && d > 0 ? d : cur()?.duration);
  }
  if ('mediaSession' in navigator && d > 0 && navigator.mediaSession.setPositionState) {
    try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(c, d), playbackRate: audio.playbackRate }); } catch { /* ignore */ }
  }
}
function markPlaying() {
  const id = Q.queue[Q.idx];
  const sid = curSong()?.id;
  document.querySelectorAll('.row[data-id]').forEach((r) => r.classList.toggle('playing', (r.dataset.act === 'play-file' && r.dataset.id === id) || (r.dataset.act === 'play-row' && r.dataset.id === sid)));
}
function updateMediaSession(f, s) {
  if (!('mediaSession' in navigator)) return;
  const url = state.cover.get(s.id);
  navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: artistName(s), album: f.label || '', artwork: url ? [{ src: url, sizes: '480x480' }] : [] });
  const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* unsupported */ } };
  set('play', () => audio.play()); set('pause', () => audio.pause());
  set('previoustrack', prev); set('nexttrack', () => next(false));
  set('seekto', (e) => { audio.currentTime = e.seekTime; });
}
function openNP() { if (!cur()) return; np.classList.add('open'); np.setAttribute('aria-hidden', 'false'); }
function closeNP() { np.classList.remove('open'); np.setAttribute('aria-hidden', 'true'); }
function queueSheet() {
  sheet((el, close) => {
    const upcoming = Q.queue.slice(Q.idx + 1), f = cur(), s = curSong();
    const line = (file, i) => { const sg = songById.get(file.songId); return `<div class="row" ${i != null ? `data-q="${i}"` : ''}>${songArt(sg)}<div class="meta"><div class="t">${esc(sg.title)}</div><div class="s">${esc(artistName(sg))} | ${esc(file.label || stripExt(file.name))}</div></div></div>`; };
    el.innerHTML = `<div class="sh-title"><b>Up next</b><span>${plural(upcoming.length, 'track')} remaining</span></div>
      <div class="qlabel">Now playing</div>${f && s ? line(f) : ''}<div class="qlabel">Next</div>` +
      (upcoming.slice(0, 100).map((id, i) => { const u = fileById.get(id); return u ? line(u, Q.idx + 1 + i) : ''; }).join('') || '<div class="body"><p>Nothing queued after this.</p></div>');
    el.addEventListener('click', (e) => { const r = e.target.closest('[data-q]'); if (r) { Q.idx = +r.dataset.q; close(); loadCurrent(true); } });
  });
}

/* ============================================================ chart viewer (PDF + images) */
const viewer = $('#viewer');
const V = { file: null, blob: null, zoom: 1, token: 0, doc: null, pages: null, imgUrl: null, lock: null, io: null };
const ZOOMS = [1, 1.5, 2, 3];
let pdfjsP;
function loadPdfjs() {
  return (pdfjsP ||= import('./vendor/pdf.min.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
    return m;
  }));
}
async function keepAwake() { try { V.lock = await navigator.wakeLock?.request('screen'); } catch { /* not supported or denied */ } }
async function openChart(fid) {
  const f = fileById.get(fid); if (!f) return;
  const blob = await DB.blob(fid); if (!blob) { toast('File missing'); return; }
  const s = songById.get(f.songId);
  Object.assign(V, { file: f, blob, zoom: 1, doc: null, pages: null });
  viewer.innerHTML = `<div class="vbar"><button data-act="close-viewer" aria-label="Close">${ic('close')}</button>
    <div class="vt"><b>${esc(f.label || stripExt(f.name))}</b><span>${esc(s?.title || '')}</span></div>
    <button data-act="zoom-out" aria-label="Zoom out">${ic('zoomout')}</button><span class="zoomtxt" id="ztxt">100%</span><button data-act="zoom-in" aria-label="Zoom in">${ic('zoomin')}</button></div>
    <div class="vbody" id="vbody"><div class="vpages" id="vpages"><div class="vmsg">Loading…</div></div></div>
    <div class="vauto" id="vauto">
      <div class="vrow"><button class="asbtn" id="asbtn" data-act="as-toggle"></button>
        <div class="asseg"><button data-act="as-mode" data-m="sync">Sync</button><button data-act="as-mode" data-m="manual">Manual</button></div></div>
      <div class="vrow"><span class="aslbl" id="aslbl"></span><input type="range" id="asrange" aria-label="Auto scroll speed"></div>
    </div>`;
  viewer.classList.add('open'); viewer.setAttribute('aria-hidden', 'false');
  keepAwake();
  asStop(); AS.offset = 0; asUI(); asBindTouch();
  await new Promise((r) => requestAnimationFrame(r));
  drawChart();
}
async function drawChart() {
  const tok = ++V.token, pagesEl = $('#vpages'), body = $('#vbody'); if (!pagesEl) return;
  const cssW = Math.max(200, Math.round((body.clientWidth - 24) * V.zoom));
  try {
    if (isPdf(V.file)) {
      if (!V.doc) {
        const pdfjs = await loadPdfjs();
        V.doc = await pdfjs.getDocument({ data: new Uint8Array(await V.blob.arrayBuffer()) }).promise;
        V.pages = [];
        for (let n = 1; n <= V.doc.numPages; n++) V.pages.push(await V.doc.getPage(n));
      }
      if (tok !== V.token) return;
      V.io?.disconnect();
      pagesEl.innerHTML = '';
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      V.io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting && !e.target.dataset.done) { e.target.dataset.done = '1'; renderPage(e.target, tok, dpr); }
      }, { root: body, rootMargin: '900px 0px' });
      V.pages.forEach((p, i) => {
        const vp = p.getViewport({ scale: 1 }), c = document.createElement('canvas');
        c.style.width = cssW + 'px'; c.style.height = Math.round((vp.height / vp.width) * cssW) + 'px';
        c.dataset.i = i; pagesEl.append(c); V.io.observe(c);
      });
    } else {
      if (!V.imgUrl) V.imgUrl = URL.createObjectURL(V.blob);
      pagesEl.innerHTML = `<img src="${V.imgUrl}" alt="" style="width:${cssW}px">`;
    }
  } catch (err) {
    console.error(err);
    if (tok === V.token) pagesEl.innerHTML = `<div class="vmsg">Couldn't open this file (${esc(err.message || err)}).</div>`;
  }
}
async function renderPage(canvas, tok, dpr) {
  const p = V.pages[+canvas.dataset.i], cssW = parseFloat(canvas.style.width);
  const base = p.getViewport({ scale: 1 }), vp = p.getViewport({ scale: (cssW / base.width) * dpr });
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  try { if (tok === V.token) await p.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise; } catch (e) { if (e?.name !== 'RenderingCancelledException') console.error(e); }
}

/* ---------- auto scroll ---------- */
// sync:   scroll position follows song progress, so the chart's end lines up with the song's end.
//         The slider is a pace multiplier (0.5x to 2x) if the chart should run slower or faster than the track.
// manual: constant speed in px/s from the slider. Touching the chart pauses auto scroll; it resumes from where you left it.
const AS = { on: false, mode: 'sync', mult: 1, speed: 30, raf: 0, last: 0, offset: 0, pos: 0, setTop: 0, touching: false, wheelT: 0 };
try { Object.assign(AS, JSON.parse(localStorage.getItem('autoscroll') || '{}')); AS.on = false; } catch { /* defaults */ }
const saveAS = () => { try { localStorage.setItem('autoscroll', JSON.stringify({ mode: AS.mode, mult: AS.mult, speed: AS.speed })); } catch { /* ignore */ } };
const asBody = () => $('#vbody');
const asMax = () => { const b = asBody(); return b ? Math.max(0, b.scrollHeight - b.clientHeight) : 0; };
const asSyncable = () => V.file && audioOf(V.file.songId).length > 0;
function asMapped() { // scroll position implied by the song's progress, before the user's nudge
  const d = audio.duration;
  return d > 0 ? Math.min(1, (audio.currentTime / d) * AS.mult) * asMax() : 0;
}
function asUI() {
  const r = $('#asrange'); if (!r) return;
  const sync = AS.mode === 'sync';
  r.min = sync ? 0.5 : 5; r.max = sync ? 2 : 150; r.step = sync ? 0.05 : 1; r.value = sync ? AS.mult : AS.speed;
  r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min)) * 100 + '%');
  $('#aslbl').textContent = sync ? `Pace ${AS.mult.toFixed(2)}x` : `Speed ${AS.speed}`;
  viewer.querySelectorAll('.asseg button').forEach((b) => b.classList.toggle('on', b.dataset.m === AS.mode));
  $('#asbtn').innerHTML = `${ic(AS.on ? 'pause' : 'play')} ${AS.on ? 'Stop scroll' : 'Auto scroll'}`;
  $('#asbtn').classList.toggle('on', AS.on);
}
async function asStart() {
  if (AS.mode === 'sync' && !asSyncable()) { AS.mode = 'manual'; toast('No MP3 on this song, using manual speed'); }
  if (AS.mode === 'sync') {
    const ids = audioOf(V.file.songId).map((f) => f.id);
    if (curSong()?.id !== V.file.songId) await playList(ids);
    else if (audio.paused) audio.play().catch(() => {});
  }
  const b = asBody(); if (!b) return;
  AS.on = true; AS.offset = 0; AS.last = 0; AS.pos = AS.setTop = b.scrollTop; asUI();
  cancelAnimationFrame(AS.raf); AS.raf = requestAnimationFrame(asFrame);
}
function asStop() { AS.on = false; cancelAnimationFrame(AS.raf); AS.raf = 0; if ($('#asbtn')) asUI(); }
function asFrame(ts) {
  if (!AS.on) return;
  const b = asBody(); if (!b) return asStop();
  const dt = AS.last ? Math.min(0.1, (ts - AS.last) / 1000) : 0; AS.last = ts;
  if (!AS.touching) {
    const max = asMax();
    if (AS.mode === 'sync') {
      if (curSong()?.id === V.file.songId) { AS.pos = Math.max(0, Math.min(max, asMapped() + AS.offset)); b.scrollTop = AS.pos; AS.setTop = b.scrollTop; }
    } else {
      AS.pos += AS.speed * dt; b.scrollTop = AS.pos; AS.setTop = b.scrollTop;
      if (AS.pos >= max) { asStop(); toast('End of chart'); return; }
    }
  }
  AS.raf = requestAnimationFrame(asFrame);
}
function asHandBack() { // user finished touching: keep auto scroll going from where they left the chart
  const b = asBody(); if (!b) return;
  AS.touching = false; AS.pos = b.scrollTop;
  if (AS.mode === 'sync') AS.offset = b.scrollTop - asMapped();
}
function asBindTouch() {
  const b = asBody(); if (!b) return;
  const hold = () => { AS.touching = true; };
  b.addEventListener('touchstart', hold, { passive: true });
  b.addEventListener('touchend', asHandBack, { passive: true });
  b.addEventListener('touchcancel', asHandBack, { passive: true });
  // any scroll we didn't make (scrollbar drag, keyboard, assistive tech) counts as the user taking over
  b.addEventListener('scroll', () => { if (AS.on && !AS.touching && Math.abs(b.scrollTop - AS.setTop) > 2) asHandBack(); }, { passive: true });
  b.addEventListener('wheel', () => { hold(); clearTimeout(AS.wheelT); AS.wheelT = setTimeout(asHandBack, 350); }, { passive: true });
}
function asSetMode(m) {
  if (m === 'sync' && !asSyncable()) { toast('This song has no MP3 to sync to'); return; }
  AS.mode = m; AS.offset = 0; const b = asBody(); if (b) AS.pos = b.scrollTop; saveAS(); asUI();
}
function asSlider(v) {
  if (AS.mode === 'sync') { const before = asMapped(); AS.mult = v; AS.offset += before - asMapped(); } // no jump when the pace changes
  else AS.speed = v;
  saveAS(); asUI();
}
function zoomChart(dir) {
  const i = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(V.zoom) + dir));
  if (ZOOMS[i] === V.zoom) return;
  const body = $('#vbody'), ratio = ZOOMS[i] / V.zoom;
  V.zoom = ZOOMS[i]; $('#ztxt').textContent = Math.round(V.zoom * 100) + '%';
  drawChart().then(() => { body.scrollTop *= ratio; AS.pos = body.scrollTop; AS.offset *= ratio; });
}
function closeViewer() {
  if (!viewer.classList.contains('open')) return;
  viewer.classList.remove('open'); viewer.setAttribute('aria-hidden', 'true');
  asStop(); V.token++; V.io?.disconnect(); V.doc?.destroy?.(); V.doc = null; V.pages = null;
  if (V.imgUrl) { URL.revokeObjectURL(V.imgUrl); V.imgUrl = null; }
  V.lock?.release?.().catch(() => {}); V.lock = null;
  setTimeout(() => { if (!viewer.classList.contains('open')) viewer.innerHTML = ''; }, 350);
}

/* ============================================================ artwork */
async function applyCover(id, blob) {
  const small = (await shrinkCover(blob)) || blob;
  await DB.put('covers', { id, blob: small });
  const old = state.cover.get(id); if (old) URL.revokeObjectURL(old);
  state.cover.set(id, URL.createObjectURL(small));
  render(true); updateUI();
}
async function removeCover(id) {
  await DB.del('covers', id);
  const old = state.cover.get(id); if (old) URL.revokeObjectURL(old);
  state.cover.delete(id); render(true); updateUI();
}
function artworkSheet(kind, id) {
  const ent = kind === 'song' ? songById.get(id) : artistById.get(id); if (!ent) return;
  const has = state.cover.has(id), name = kind === 'song' ? ent.title : ent.name;
  sheet((el, close) => {
    el.innerHTML = `<div class="sh-title"><b>Artwork</b><span>${esc(name)}</span></div>
      <div class="body" style="display:grid;place-items:center">${kind === 'song' ? songArt(ent, { full: true }) : artistArt(ent, { full: true })}</div>
      ${kind === 'song' ? `<button class="item" data-a="find">${ic('globe')} Find artwork online</button>` : ''}
      <label class="item">${ic('image')} Choose from photos<input type="file" accept="image/*" hidden id="artpick"></label>
      ${has ? `<button class="item danger" data-a="remove">${ic('trash')} Remove artwork</button>` : ''}`;
    $('.body .art', el).style.cssText = 'width:150px;height:150px';
    $('#artpick', el).addEventListener('change', async (e) => {
      const f = e.target.files[0]; if (!f) return; close();
      try { await applyCover(id, f); toast('Artwork saved'); } catch (err) { console.error(err); toast('Could not use that image'); }
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return; close();
      if (b.dataset.a === 'find') setTimeout(() => findArtwork(ent), 160);
      else removeCover(id).then(() => toast('Artwork removed'));
    });
  });
}
/* iTunes Search API: free, no key, CORS-enabled. */
async function itunesSearch(term) {
  const r = await fetch(`https://itunes.apple.com/search?${new URLSearchParams({ term, media: 'music', entity: 'song', limit: '12' })}`);
  if (!r.ok) throw new Error(`Catalog returned ${r.status}`);
  const seen = new Set();
  return (await r.json()).results.filter((x) => x.artworkUrl100 && !seen.has(x.artworkUrl100) && seen.add(x.artworkUrl100));
}
function findArtwork(song) {
  sheet((el, close) => {
    el.innerHTML = `<div class="sh-title"><b>Find artwork</b><span>Apple's public catalog</span></div>
      <label class="search">${ic('search')}<input id="aq" type="search" value="${esc(`${song.title} ${artistName(song)}`)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <div class="body" id="astatus"><p>Searching…</p></div><div class="artgrid" id="ares"></div>`;
    const status = $('#astatus', el), grid = $('#ares', el), input = $('#aq', el);
    let n = 0;
    const run = async () => {
      const my = ++n, term = input.value.trim(); if (!term) return;
      status.hidden = false; status.innerHTML = '<p>Searching…</p>'; grid.innerHTML = '';
      try {
        const res = await itunesSearch(term);
        if (my !== n) return;
        if (!res.length) { status.innerHTML = '<p>No matches. Try fewer words, or just the artist name.</p>'; return; }
        status.hidden = true;
        grid.innerHTML = res.map((x) => `<button data-u="${esc(x.artworkUrl100)}"><div class="art"><img src="${esc(x.artworkUrl100.replace('100x100bb', '300x300bb'))}" alt=""></div><div class="c">${esc(x.collectionName || x.trackName)}<br>${esc(x.artistName)}</div></button>`).join('');
      } catch (err) {
        if (my !== n) return;
        console.error(err); status.innerHTML = `<p>Couldn't reach the catalog (${esc(err.message)}). Check your connection and try again.</p>`;
      }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); run(); } });
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-u]'); if (!b) return;
      b.style.opacity = '.4'; toast('Saving artwork…');
      try {
        const r = await fetch(b.dataset.u.replace('100x100bb', '1000x1000bb')); if (!r.ok) throw new Error(`Image returned ${r.status}`);
        await applyCover(song.id, await r.blob()); close(); toast('Artwork saved');
      } catch (err) { console.error(err); b.style.opacity = ''; toast('Could not download that image'); }
    });
    run();
  });
}

/* ============================================================ create / edit / delete */
async function newArtist() {
  const name = await promptSheet({ title: 'New artist', placeholder: 'Artist or band name', cta: 'Create' });
  if (!name) return null;
  const exists = findArtist(name), a = await ensureArtist(name);
  toast(exists ? 'That artist already exists' : `Added ${a.name}`);
  goto('artist', a.id); return a;
}
function songSheet(song, artistId) {
  const isNew = !song, s = song || { title: '', key: '', bpm: '', notes: '' };
  const aName = song ? artistName(song) : artistById.get(artistId)?.name || '';
  sheet((el, close) => {
    const f = (k, l, type = 'text', ph = '') => `<label class="field"><span>${l}</span><input type="${type}" data-k="${k}" value="${esc(s[k] || '')}" placeholder="${ph}" ${type === 'number' ? 'inputmode="numeric"' : ''}></label>`;
    el.innerHTML = `<div class="sh-title"><b>${isNew ? 'New song' : 'Edit song'}</b>${isNew ? '' : `<span>${esc(s.title)}</span>`}</div>
      <div class="body">${f('title', 'Title')}<label class="field"><span>Artist</span><input type="text" id="sa" value="${esc(aName)}" placeholder="Artist or band"></label>
        <div class="two">${f('key', 'Key', 'text', 'G, F#m')}${f('bpm', 'BPM', 'number')}</div>
        <label class="field"><span>Notes</span><textarea data-k="notes" placeholder="Intro count, cues, who plays what">${esc(s.notes || '')}</textarea></label></div>
      <div class="foot"><button class="btn ghost" data-r="0">Cancel</button><button class="btn" data-r="1">${isNew ? 'Create' : 'Save'}</button></div>`;
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-r]'); if (!b) return;
      if (b.dataset.r !== '1') return close();
      const get = (k) => (el.querySelector(`[data-k="${k}"]`).value || '').trim();
      const title = get('title'); if (!title) { toast('Give the song a title'); return; }
      close();
      const a = await ensureArtist($('#sa', el).value);
      const rec = song || { id: uid(), added: Date.now() };
      Object.assign(rec, { title, artistId: a.id, key: get('key'), bpm: parseInt(get('bpm'), 10) || '', notes: get('notes') });
      if (isNew) state.songs.push(rec);
      await DB.put('songs', rec); reindex();
      if (isNew) { toast('Song added'); goto('song', rec.id); } else { render(true); updateUI(); toast('Saved'); }
    });
  });
}
async function deleteFiles(files) {
  if (!files.length) return;
  const ids = files.map((f) => f.id);
  await DB.tx(['files', 'blobs'], (s) => ids.forEach((id) => { s.files.delete(id); s.blobs.delete(id); }));
  state.files = state.files.filter((f) => !ids.includes(f.id));
  dropFromPlayer(ids); reindex();
}
async function deleteSong(song) {
  if (!await confirmSheet('Delete song?', `“${song.title}” and its ${plural(filesOf(song.id).length, 'file')} will be deleted.`, 'Delete')) return;
  await deleteFiles(filesOf(song.id));
  await DB.tx(['songs', 'covers'], (s) => { s.songs.delete(song.id); s.covers.delete(song.id); });
  const u = state.cover.get(song.id); if (u) { URL.revokeObjectURL(u); state.cover.delete(song.id); }
  state.songs = state.songs.filter((x) => x.id !== song.id);
  for (const l of state.setlists) if (l.songIds.includes(song.id)) { l.songIds = l.songIds.filter((x) => x !== song.id); await DB.put('setlists', l); }
  reindex(); if (state.stack.at(-1)?.name === 'song') state.stack.pop();
  render(true); toast('Deleted');
}
async function deleteArtist(a) {
  const ss = songsOf(a.id);
  if (!await confirmSheet('Delete artist?', `“${a.name}” and ${plural(ss.length, 'song')} with all their charts and MP3s will be deleted.`, 'Delete')) return;
  for (const s of ss) { await deleteFiles(filesOf(s.id)); await DB.tx(['songs', 'covers'], (x) => { x.songs.delete(s.id); x.covers.delete(s.id); }); state.cover.delete(s.id); }
  state.songs = state.songs.filter((s) => s.artistId !== a.id);
  for (const l of state.setlists) { const k = l.songIds.filter((i) => state.songs.some((s) => s.id === i)); if (k.length !== l.songIds.length) { l.songIds = k; await DB.put('setlists', l); } }
  await DB.tx(['artists', 'covers'], (x) => { x.artists.delete(a.id); x.covers.delete(a.id); });
  state.cover.delete(a.id); state.artists = state.artists.filter((x) => x.id !== a.id);
  reindex(); state.stack.pop(); render(); toast('Deleted');
}
function mimeFor(file, kind) {
  if (file.type) return file.type;
  if (/\.pdf$/i.test(file.name)) return 'application/pdf';
  if (/\.png$/i.test(file.name)) return 'image/png';
  if (/\.jpe?g$/i.test(file.name)) return 'image/jpeg';
  return kind === 'audio' ? 'audio/mpeg' : 'application/octet-stream';
}
const quotaMsg = (e, name) => (e?.name === 'QuotaExceededError' ? `${name}: out of storage` : `${name}: ${e?.message || 'unreadable'}`);
async function addFiles(song, kind, fileList) {
  const files = [...fileList]; if (!files.length) return;
  navigator.storage?.persist?.().catch(() => {});
  let added = 0; const failed = [];
  for (const file of files) {
    try {
      const rec = { id: uid(), songId: song.id, kind, name: file.name, label: stripExt(file.name), mime: mimeFor(file, kind), size: file.size, added: Date.now() + added };
      if (kind === 'chart') {
        if (!(/pdf/i.test(rec.mime) || /^image\//i.test(rec.mime))) throw new Error('Charts must be PDFs or images');
      } else {
        const t = await readTags(file); rec.duration = t.duration;
        if (t.cover && !state.cover.has(song.id)) { await DB.put('covers', { id: song.id, blob: t.cover }); state.cover.set(song.id, URL.createObjectURL(t.cover)); }
      }
      await DB.putFile(rec, new Blob([file], { type: rec.mime }));
      state.files.push(rec); reindex(); added++;
    } catch (e) {
      console.error('add failed', file.name, e);
      failed.push(quotaMsg(e, file.name));
      if (e?.name === 'QuotaExceededError') break;
    }
  }
  render(true); updateUI();
  toast([added && `Added ${plural(added, kind === 'chart' ? 'chart' : 'MP3')}`, failed.length && `${failed.length} failed`].filter(Boolean).join(' | '));
  if (failed.length) failSheet(failed);
}
/* Home "Import MP3s": read each file's tags, let the user set one artist for the group and a key per song,
   then file every MP3 under its artist and song. */
const fileInput = $('#file');
function reviewImport(items) {
  return new Promise((resolve) => {
    let done = false;
    const tagged = [...new Set(items.map((x) => x.t.artist).filter((a) => a && a !== 'Unknown Artist'))];
    const prefill = tagged.length === 1 && items.every((x) => x.t.artist === tagged[0]) ? tagged[0] : '';
    sheet((el, close) => {
      el.innerHTML = `<div class="sh-title"><b>Review import</b><span>${plural(items.length, 'MP3')}</span></div>
        <div class="body"><label class="field"><span>Artist for the whole group</span><input type="text" id="ga" value="${esc(prefill)}" placeholder="${tagged.length > 1 ? 'Leave blank to keep each file’s own artist' : 'Artist or band'}" autocomplete="off"></label>
          <div class="qlabel" style="padding:6px 0 4px;display:flex;justify-content:space-between"><span>Song</span><span style="width:64px">Key</span></div>
          ${items.map((x, i) => `<div class="brow"><div class="bname"><div class="t">${esc(x.t.title)}</div><div class="s">${esc(x.file.name)}</div></div><input type="text" class="bk" data-i="${i}" placeholder="Key" maxlength="4" autocapitalize="characters"></div>`).join('')}</div>
        <div class="foot"><button class="btn ghost" data-r="0">Cancel</button><button class="btn" data-r="1">Import ${items.length}</button></div>`;
      const fin = (ok) => {
        if (done) return; done = true; close();
        resolve(ok ? { artist: $('#ga', el).value.trim(), keys: items.map((_, i) => (el.querySelector(`.bk[data-i="${i}"]`).value || '').trim()) } : null);
      };
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) fin(b.dataset.r === '1'); });
      waitClosed(el, () => { if (!done) { done = true; resolve(null); } });
    });
  });
}
async function importMp3s(fileList) {
  const files = [...fileList]; if (!files.length) return;
  navigator.storage?.persist?.().catch(() => {});
  const sigs = new Set(state.files.map((f) => `${f.name}|${f.size}`));
  const fresh = files.filter((f) => !sigs.has(`${f.name}|${f.size}`)), dups = files.length - fresh.length;
  if (!fresh.length) { toast(`${dups} already here`); return; }
  // 1) read tags
  let closeSheet, bar, label;
  sheet((el, close) => {
    closeSheet = close;
    el.innerHTML = `<div class="sh-title"><b>Reading MP3s</b><span id="ilabel"></span></div><div class="body"><div class="bar-prog"><i id="ibar"></i></div></div>`;
    bar = $('#ibar', el); label = $('#ilabel', el);
  });
  const items = [], failed = [];
  for (let i = 0; i < fresh.length; i++) {
    label.textContent = `${i + 1} of ${fresh.length} | ${fresh[i].name}`; bar.style.width = (i / fresh.length) * 100 + '%';
    try { items.push({ file: fresh[i], t: await readTags(fresh[i]) }); } catch (e) { console.error('read failed', fresh[i].name, e); failed.push(`${fresh[i].name}: ${e?.message || 'unreadable'}`); }
    await new Promise((r) => setTimeout(r, 0));
  }
  closeSheet();
  if (!items.length) { if (failed.length) failSheet(failed); return; }
  // 2) review: group artist + key per song
  await new Promise((r) => setTimeout(r, 300));
  const choice = await reviewImport(items);
  if (!choice) return;
  // 3) write
  sheet((el, close) => {
    closeSheet = close;
    el.innerHTML = `<div class="sh-title"><b>Importing MP3s</b><span id="ilabel"></span></div><div class="body"><div class="bar-prog"><i id="ibar"></i></div></div>`;
    bar = $('#ibar', el); label = $('#ilabel', el);
  });
  let added = 0, newSongs = 0;
  for (let i = 0; i < items.length; i++) {
    const { file, t } = items[i];
    label.textContent = `${i + 1} of ${items.length} | ${file.name}`; bar.style.width = (i / items.length) * 100 + '%';
    try {
      const a = await ensureArtist(choice.artist || (t.artist === 'Unknown Artist' ? '' : t.artist));
      let song = songsOf(a.id).find((s) => lc(s.title) === lc(t.title));
      if (!song) { song = { id: uid(), artistId: a.id, title: t.title, key: '', bpm: '', notes: '', added: Date.now() + i }; state.songs.push(song); newSongs++; }
      if (choice.keys[i]) song.key = choice.keys[i];
      await DB.put('songs', song); reindex();
      const rec = { id: uid(), songId: song.id, kind: 'audio', name: file.name, label: stripExt(file.name), mime: mimeFor(file, 'audio'), size: file.size, duration: t.duration, added: Date.now() + i };
      await DB.putFile(rec, new Blob([file], { type: rec.mime }));
      if (t.cover && !state.cover.has(song.id)) { await DB.put('covers', { id: song.id, blob: t.cover }); state.cover.set(song.id, URL.createObjectURL(t.cover)); }
      state.files.push(rec); reindex(); added++;
    } catch (e) {
      console.error('import failed', file.name, e);
      failed.push(quotaMsg(e, file.name));
      if (e?.name === 'QuotaExceededError') break;
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  bar.style.width = '100%'; closeSheet(); render(true);
  toast([added && `${plural(added, 'MP3')} filed${newSongs ? `, ${plural(newSongs, 'new song')}` : ''}`, dups && `${dups} already here`, failed.length && `${failed.length} failed`].filter(Boolean).join(' | ') || 'Nothing added');
  if (failed.length) failSheet(failed);
}

/* Add several songs by hand: one artist for the group, a title and key for each song. */
function bulkSongsSheet(artistId) {
  const row = () => `<div class="brow"><input type="text" class="bt" placeholder="Song title" autocomplete="off"><input type="text" class="bk" placeholder="Key" maxlength="4" autocapitalize="characters"></div>`;
  sheet((el, close) => {
    el.innerHTML = `<div class="sh-title"><b>Add songs</b><span>One artist, a key for each song</span></div>
      <div class="body"><label class="field"><span>Artist for the whole group</span><input type="text" id="ga" value="${esc(artistById.get(artistId)?.name || '')}" placeholder="Artist or band" autocomplete="off"></label>
        <div class="qlabel" style="padding:6px 0 4px;display:flex;justify-content:space-between"><span>Song</span><span style="width:64px">Key</span></div>
        <div id="brows">${row().repeat(4)}</div><button class="textbtn" id="baddrow" style="padding-top:2px">+ Add row</button></div>
      <div class="foot"><button class="btn ghost" data-r="0">Cancel</button><button class="btn" data-r="1">Add songs</button></div>`;
    el.addEventListener('click', async (e) => {
      if (e.target.closest('#baddrow')) { $('#brows', el).insertAdjacentHTML('beforeend', row()); $('#brows', el).lastElementChild.querySelector('.bt').focus(); return; }
      const b = e.target.closest('[data-r]'); if (!b) return;
      if (b.dataset.r !== '1') return close();
      const name = $('#ga', el).value.trim(); if (!name) { toast('Enter an artist for the group'); return; }
      const rows = [...el.querySelectorAll('.brow')].map((r) => ({ title: r.querySelector('.bt').value.trim(), key: r.querySelector('.bk').value.trim() })).filter((r) => r.title);
      if (!rows.length) { toast('Enter at least one song title'); return; }
      close();
      const a = await ensureArtist(name); let made = 0, skipped = 0;
      for (const r of rows) {
        const existing = songsOf(a.id).find((s) => lc(s.title) === lc(r.title));
        if (existing) { skipped++; if (r.key && !existing.key) { existing.key = r.key; await DB.put('songs', existing); } continue; }
        const song = { id: uid(), artistId: a.id, title: r.title, key: r.key, bpm: '', notes: '', added: Date.now() + made };
        state.songs.push(song); await DB.put('songs', song); reindex(); made++;
      }
      toast([made && `Added ${plural(made, 'song')}`, skipped && `${skipped} already existed`].filter(Boolean).join(' | '));
      goto('artist', a.id);
    });
  });
}

/* ---------- setlists ---------- */
const getSetlist = (id) => state.setlists.find((l) => l.id === id);
const saveSetlist = (l) => DB.put('setlists', l);
async function newSetlist(songIds = []) {
  const name = await promptSheet({ title: 'New setlist', placeholder: 'Gig or set name', cta: 'Create' });
  if (!name) return null;
  const l = { id: uid(), name, songIds: [...songIds], created: Date.now() };
  state.setlists.push(l); await saveSetlist(l); toast(`Created “${name}”`); return l;
}
function addSongsToSetlist(songIds) {
  sheet((el, close) => {
    el.innerHTML = `<div class="sh-title"><b>Add to setlist</b><span>${plural(songIds.length, 'song')}</span></div><button class="item" data-p="new">${ic('plus')} New setlist</button>` +
      [...state.setlists].sort((a, b) => b.created - a.created).map((l) => `<button class="item" data-p="${l.id}">${setlistArt(l, { cls: 'sm' })} ${esc(l.name)}</button>`).join('');
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('.item'); if (!b) return; close();
      if (b.dataset.p === 'new') { setTimeout(async () => { const l = await newSetlist(songIds); if (l) render(true); }, 160); return; }
      const l = getSetlist(b.dataset.p), fresh = songIds.filter((id) => !l.songIds.includes(id));
      l.songIds.push(...fresh); await saveSetlist(l);
      toast(fresh.length ? `Added to ${l.name}` : `Already in ${l.name}`); render(true);
    });
  });
}
function pickSongsFor(l) {
  const chosen = new Set();
  sheet((el, close) => {
    const avail = sortedSongs().filter((s) => !l.songIds.includes(s.id));
    el.innerHTML = `<div class="sh-title"><b>Add songs</b><span>${esc(l.name)}</span></div>
      <label class="search">${ic('search')}<input id="pq" type="search" placeholder="Filter" autocomplete="off"></label>
      <div id="plist">${avail.map((s) => `<button class="pick" data-id="${s.id}" data-s="${esc(lc(s.title + ' ' + artistName(s)))}"><span class="box">${ic('check')}</span><div class="meta"><div class="t">${esc(s.title)}</div><div class="s">${esc(artistName(s))}</div></div></button>`).join('') || '<div class="body"><p>Every song is already in this setlist.</p></div>'}</div>
      <div class="foot" style="padding-top:14px"><button class="btn" id="padd" disabled>Add</button></div>`;
    const btn = $('#padd', el);
    $('#pq', el).addEventListener('input', (e) => { const q = lc(e.target.value); el.querySelectorAll('.pick').forEach((p) => { p.hidden = !!q && !p.dataset.s.includes(q); }); });
    el.addEventListener('click', async (e) => {
      const p = e.target.closest('.pick');
      if (p) { const on = !chosen.has(p.dataset.id); on ? chosen.add(p.dataset.id) : chosen.delete(p.dataset.id); p.classList.toggle('on', on); btn.disabled = !chosen.size; btn.textContent = chosen.size ? `Add ${chosen.size}` : 'Add'; return; }
      if (e.target.closest('#padd') && chosen.size) { l.songIds.push(...chosen); await saveSetlist(l); close(); toast(`Added ${plural(chosen.size, 'song')}`); render(true); }
    });
  });
}
function playSetlist(l) {
  const ids = setlistSongs(l).map((s) => audioOf(s.id)[0]?.id).filter(Boolean);
  if (!ids.length) { toast('No songs here have an MP3 yet'); return; }
  playList(ids);
}

/* ---------- menus ---------- */
/* Tapping a song plays it; the queue is the rest of the list it was tapped in (setlist, artist catalog, all songs). */
function playSongRow(id, ctx = '') {
  const s = songById.get(id); if (!s) return;
  const first = audioOf(id)[0];
  if (!first) { toast('No MP3 on this song yet'); goto('song', id); return; }
  let list = [s];
  if (ctx.startsWith('sl:')) list = setlistSongs(getSetlist(ctx.slice(3)) || { songIds: [] });
  else if (ctx.startsWith('ar:')) list = songsOf(ctx.slice(3));
  else if (ctx === 'all') list = sortedSongs();
  playList(list.map((x) => audioOf(x.id)[0]?.id).filter(Boolean), first.id);
}
function openSongChart(id) {
  const s = songById.get(id), ch = chartsOf(id); if (!s) return;
  if (!ch.length) { toast('No chart yet. Add one on the song page'); goto('song', id); return; }
  if (ch.length === 1) return openChart(ch[0].id);
  actionSheet('Open chart', s.title, ch.map((f) => ({ icon: 'doc', label: f.label || stripExt(f.name), run: () => openChart(f.id) })));
}
function songMenu(id, ctx) {
  const s = songById.get(id); if (!s) return;
  const slId = ctx?.startsWith('sl:') ? ctx.slice(3) : null, l = slId && getSetlist(slId);
  const pos = l ? l.songIds.indexOf(id) : -1;
  const move = (d) => async () => { const j = pos + d; [l.songIds[pos], l.songIds[j]] = [l.songIds[j], l.songIds[pos]]; await saveSetlist(l); render(true); };
  actionSheet(s.title, artistName(s), [
    { icon: 'list', label: 'Add to setlist', run: () => addSongsToSetlist([id]) },
    l && pos > 0 && { icon: 'up', label: 'Move up', run: move(-1) },
    l && pos < l.songIds.length - 1 && { icon: 'down', label: 'Move down', run: move(1) },
    l && { icon: 'minus', label: 'Remove from this setlist', run: async () => { l.songIds = l.songIds.filter((x) => x !== id); await saveSetlist(l); render(true); toast('Removed'); } },
    ctx !== 'page' && { icon: 'doc', label: 'Song details (charts, MP3s, notes)', run: () => goto('song', id) },
    { icon: 'user', label: 'Go to artist', run: () => goto('artist', s.artistId) },
    { icon: 'edit', label: 'Edit song', run: () => songSheet(s) },
    { icon: 'image', label: 'Artwork', run: () => artworkSheet('song', id) },
    { icon: 'trash', label: 'Delete song', danger: true, run: () => deleteSong(s) },
  ]);
}
function fileMenu(id) {
  const f = fileById.get(id); if (!f) return;
  actionSheet(f.label || f.name, f.kind === 'chart' ? 'Chart' : 'MP3', [
    f.kind === 'chart' ? { icon: 'doc', label: 'Open chart', run: () => openChart(id) } : { icon: 'play', label: 'Play', run: () => playList(audioOf(f.songId).map((x) => x.id), id) },
    { icon: 'edit', label: 'Rename', run: async () => { const n = await promptSheet({ title: 'Rename', value: f.label || stripExt(f.name) }); if (n) { f.label = n; await DB.put('files', f); render(true); updateUI(); } } },
    { icon: 'trash', label: 'Delete', danger: true, run: async () => { if (await confirmSheet('Delete file?', `“${f.label || f.name}” will be deleted.`, 'Delete')) { await deleteFiles([f]); render(true); toast('Deleted'); } } },
  ]);
}
function artistMenu(id) {
  const a = artistById.get(id); if (!a) return;
  actionSheet(a.name, plural(songsOf(id).length, 'song'), [
    { icon: 'edit', label: 'Rename', run: async () => { const n = await promptSheet({ title: 'Rename artist', value: a.name }); if (n) { a.name = n; await DB.put('artists', a); reindex(); render(true); updateUI(); } } },
    { icon: 'image', label: 'Photo', run: () => artworkSheet('artist', id) },
    { icon: 'trash', label: 'Delete artist', danger: true, run: () => deleteArtist(a) },
  ]);
}
function addMenu() {
  const top = state.stack.at(-1);
  actionSheet('Add', '', [
    { icon: 'user', label: 'New artist', run: () => newArtist() },
    { icon: 'note', label: 'New song', run: () => songSheet(null, top?.name === 'artist' ? top.id : null) },
    { icon: 'queue', label: 'Add several songs', run: () => bulkSongsSheet(top?.name === 'artist' ? top.id : null) },
    { icon: 'upload', label: 'Import MP3s (auto-file by tags)', run: () => fileInput.click() },
    { icon: 'list', label: 'New setlist', run: async () => { const l = await newSetlist(); if (l) goto('setlist', l.id); } },
  ]);
}

/* ============================================================ events */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  // taps on a row's "more" button are handled by that button, not the row
  if (el.classList.contains('row') && e.target.closest('.more')) return;
  const d = el.dataset;
  switch (d.act) {
    case 'home': closeNP(); closeViewer(); state.stack = []; state.query = ''; render(); break;
    case 'back': state.stack.pop(); render(); break;
    case 'home-go': state.stack.push({ name: d.to }); render(); break;
    case 'sort': state.sort = d.k; render(true); break;
    case 'add-menu': addMenu(); break;
    case 'new-artist': newArtist(); break;
    case 'add-song': songSheet(null, d.artist); break;
    case 'import': fileInput.click(); break;
    case 'hide-tip': localStorage.setItem('tipHidden', '1'); render(true); break;
    case 'open-artist': goto('artist', d.id); break;
    case 'open-song': goto('song', d.id); break;
    case 'play-row': playSongRow(d.id, d.ctx); break;
    case 'song-chart': e.stopPropagation(); openSongChart(d.id); break;
    case 'open-setlist': goto('setlist', d.id); break;
    case 'song-menu': e.stopPropagation(); songMenu(d.id, d.ctx); break;
    case 'file-menu': e.stopPropagation(); fileMenu(d.id); break;
    case 'artist-menu': artistMenu(d.id); break;
    case 'song-art': artworkSheet('song', d.id); break;
    case 'song-to-setlist': addSongsToSetlist([d.id]); break;
    case 'play-song': playList(audioOf(d.id).map((f) => f.id)); break;
    case 'play-file': playList(audioOf(fileById.get(d.id).songId).map((f) => f.id), d.id); break;
    case 'open-chart': openChart(d.id); break;
    case 'close-viewer': closeViewer(); break;
    case 'as-toggle': AS.on ? asStop() : asStart(); break;
    case 'as-mode': asSetMode(d.m); break;
    case 'zoom-in': zoomChart(1); break;
    case 'zoom-out': zoomChart(-1); break;
    case 'new-setlist': { const l = await newSetlist(); if (l) goto('setlist', l.id); break; }
    case 'sl-add': pickSongsFor(getSetlist(d.id)); break;
    case 'play-setlist': playSetlist(getSetlist(d.id)); break;
    case 'sl-menu': {
      const l = getSetlist(d.id);
      actionSheet(l.name, plural(l.songIds.length, 'song'), [
        { icon: 'edit', label: 'Rename', run: async () => { const n = await promptSheet({ title: 'Rename setlist', value: l.name }); if (n) { l.name = n; await saveSetlist(l); render(true); } } },
        { icon: 'trash', label: 'Delete setlist', danger: true, run: async () => { if (await confirmSheet('Delete setlist?', `“${l.name}” will be deleted. Your songs stay in the library.`, 'Delete')) { await DB.del('setlists', l.id); state.setlists = state.setlists.filter((x) => x !== l); state.stack.pop(); render(); } } },
      ]); break;
    }
    case 'open-np': openNP(); break;
    case 'close-np': closeNP(); break;
    case 'toggle': e.stopPropagation(); togglePlay(); break;
    case 'next': e.stopPropagation(); next(false); break;
    case 'prev': prev(); break;
    case 'shuffle': toggleShuffle(); break;
    case 'repeat': cycleRepeat(); break;
    case 'queue': queueSheet(); break;
    case 'np-song': { const s = curSong(); if (s) goto('song', s.id); break; }
    case 'np-menu': { const s = curSong(); if (s) songMenu(s.id, ''); break; }
  }
});
document.addEventListener('input', (e) => { if (e.target.id === 'asrange') { asSlider(+e.target.value); return; } if (e.target.id === 'q') { state.query = e.target.value; renderResults(); renderDock(); } });
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.classList?.contains('addfile')) { const song = songById.get(t.dataset.song), fl = [...t.files], kind = t.dataset.kind; t.value = ''; if (song) addFiles(song, kind, fl); }
  else if (t === fileInput) { const fl = [...fileInput.files]; fileInput.value = ''; importMp3s(fl); }
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !/INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)) { e.preventDefault(); togglePlay(); }
  if (e.key === 'Escape') closeViewer();
});

/* ============================================================ boot */
async function boot() {
  try {
    const [artists, songs, files, setlists, covers] = await Promise.all(['artists', 'songs', 'files', 'setlists', 'covers'].map((s) => DB.all(s)));
    Object.assign(state, { artists, songs, files, setlists });
    for (const c of covers) state.cover.set(c.id, URL.createObjectURL(c.blob));
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="empty"><h2>Storage unavailable</h2><p>SetLists needs browser storage to keep your library. Private browsing blocks it.</p></div>`;
    return;
  }
  reindex(); render(); await restoreSession();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
}
boot();
window.__app = { state, Q, openChart, importMp3s, addFiles };
