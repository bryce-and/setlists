// Minimal, dependency-free MP3 reader: ID3v2 (2.2/2.3/2.4), ID3v1 fallback,
// cover art extraction and MP3 duration estimation (Xing/VBRI/CBR).

const synchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u24 = (b, o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));

function decodeText(bytes, enc) {
  if (enc === 1) {
    let le = true, o = 0;
    if (bytes[0] === 0xfe && bytes[1] === 0xff) { le = false; o = 2; }
    else if (bytes[0] === 0xff && bytes[1] === 0xfe) { o = 2; }
    return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(bytes.subarray(o));
  }
  if (enc === 2) return new TextDecoder('utf-16be').decode(bytes);
  if (enc === 3) return new TextDecoder('utf-8').decode(bytes);
  return new TextDecoder('windows-1252').decode(bytes);
}

function textFrame(data) {
  if (!data.length) return '';
  const s = decodeText(data.subarray(1), data[0]);
  return s.split('\u0000').map((x) => x.trim()).filter(Boolean).join(', ');
}

function findTerm(b, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return b.length;
  }
  for (let i = start; i < b.length; i++) if (b[i] === 0) return i;
  return b.length;
}

function parseApic(data, v2) {
  const enc = data[0];
  let p = 1, mime;
  if (v2) {
    const fmt = ascii(data, 1, 3).toLowerCase();
    mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
    p = 4;
  } else {
    const e = findTerm(data, 1, 0);
    mime = ascii(data, 1, e - 1) || 'image/jpeg';
    if (mime === 'image/jpg') mime = 'image/jpeg';
    p = e + 1;
  }
  p += 1; // picture type
  const dEnd = findTerm(data, p, enc);
  p = dEnd + (enc === 1 || enc === 2 ? 2 : 1);
  const img = data.subarray(p);
  if (img.length < 100) return null;
  return new Blob([img], { type: mime });
}

function removeUnsync(b) {
  const out = new Uint8Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i++) {
    out[n++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, n);
}

const FRAME_MAP = {
  TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TPE2: 'albumArtist', TP2: 'albumArtist',
  TALB: 'album', TAL: 'album', TRCK: 'track', TRK: 'track', TPOS: 'disc', TPA: 'disc',
  TYER: 'year', TYE: 'year', TDRC: 'year', TCON: 'genre', TCO: 'genre',
};

function parseID3v2(buf) {
  const tags = {};
  const v = buf[3], flags = buf[5];
  let body = buf.subarray(10, Math.min(10 + synchsafe(buf, 6), buf.length));
  if ((flags & 0x80) && v < 4) body = removeUnsync(body);
  let pos = 0;
  if ((flags & 0x40) && v >= 3) pos += v === 4 ? synchsafe(body, 0) : u32(body, 0) + 4;
  const v2 = v === 2;
  const hdr = v2 ? 6 : 10;
  while (pos + hdr <= body.length) {
    if (body[pos] === 0) break;
    const id = ascii(body, pos, v2 ? 3 : 4);
    const size = v2 ? u24(body, pos + 3) : v === 4 ? synchsafe(body, pos + 4) : u32(body, pos + 4);
    const f1 = v2 ? 0 : body[pos + 8], f2 = v2 ? 0 : body[pos + 9];
    if (size <= 0 || pos + hdr + size > body.length) break;
    let data = body.subarray(pos + hdr, pos + hdr + size);
    pos += hdr + size;
    if (v === 3 && (f2 & 0xc0)) continue; // compressed / encrypted
    if (v === 4) {
      if (f2 & 0x01) data = data.subarray(4);
      if (f2 & 0x02) data = removeUnsync(data);
      if (f2 & 0x0c) continue;
    }
    void f1;
    if (id === 'APIC' || id === 'PIC') {
      if (!tags.cover) { try { tags.cover = parseApic(data, v2); } catch { /* ignore bad art */ } }
    } else if (FRAME_MAP[id] && !tags[FRAME_MAP[id]]) {
      tags[FRAME_MAP[id]] = textFrame(data);
    }
  }
  return tags;
}

function parseID3v1(b) {
  if (b.length < 128 || ascii(b, 0, 3) !== 'TAG') return null;
  const s = (o, n) => new TextDecoder('windows-1252').decode(b.subarray(o, o + n)).replace(/\u0000.*$/s, '').trim();
  const t = { title: s(3, 30), artist: s(33, 30), album: s(63, 30), year: s(93, 4) };
  if (b[125] === 0 && b[126] !== 0) t.track = String(b[126]);
  return t;
}

const BR = {
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
};
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function mp3Duration(b, audioBytes) {
  for (let i = 0; i + 4 < b.length; i++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) continue;
    const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3;
    const bi = b[i + 2] >> 4, si = (b[i + 2] >> 2) & 3;
    if (ver === 1 || layer === 0 || bi === 0 || bi === 15 || si === 3) continue;
    const L = 4 - layer; // 1,2,3
    const kbps = BR[`${ver === 3 ? 1 : 2}-${L}`][bi];
    const sr = SR[ver][si];
    const spf = L === 1 ? 384 : L === 2 ? 1152 : ver === 3 ? 1152 : 576;
    const mono = ((b[i + 3] >> 6) & 3) === 3;
    if (L === 3) {
      const off = i + 4 + (ver === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17));
      const tag = ascii(b, off, 4);
      if ((tag === 'Xing' || tag === 'Info') && (b[off + 7] & 1)) return (u32(b, off + 8) * spf) / sr;
    }
    if (ascii(b, i + 36, 4) === 'VBRI') return (u32(b, i + 36 + 14) * spf) / sr;
    return (audioBytes * 8) / (kbps * 1000);
  }
  return 0;
}

function elementDuration(file) {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = 'metadata';
    const u = URL.createObjectURL(file);
    const done = (d) => { clearTimeout(t); a.removeAttribute('src'); a.load(); URL.revokeObjectURL(u); resolve(Number.isFinite(d) ? d : 0); };
    const t = setTimeout(() => done(0), 3000);
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    a.src = u;
  });
}

export async function shrinkCover(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const max = 480, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const out = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
    return out || blob;
  } catch {
    return blob.size < 1.5e6 ? blob : null;
  }
}

function fromFilename(name) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const m = base.match(/^(?:(\d{1,3})[\s.\-]+)?(.+?)\s+-\s+(.+)$/);
  if (m) return { track: m[1] || '', artist: m[2].trim(), title: m[3].trim() };
  const t = base.match(/^(\d{1,3})[\s.\-]+(.+)$/);
  return t ? { track: t[1], title: t[2].trim() } : { title: base };
}

const num = (s) => { const n = parseInt(String(s || '').split('/')[0], 10); return Number.isFinite(n) ? n : 0; };

export async function readTags(file) {
  let tags = {}, tagSize = 0, hasV1 = false;
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (ascii(head, 0, 3) === 'ID3') {
      tagSize = 10 + synchsafe(head, 6) + (head[5] & 0x10 ? 10 : 0);
      if (tagSize < 60 * 1024 * 1024) tags = parseID3v2(new Uint8Array(await file.slice(0, tagSize).arrayBuffer()));
    }
    const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 128)).arrayBuffer());
    const v1 = parseID3v1(tail);
    if (v1) { hasV1 = true; for (const k in v1) if (!tags[k] && v1[k]) tags[k] = v1[k]; }
  } catch (e) { console.warn('tag parse failed', e); }

  let duration = 0;
  try {
    const frames = new Uint8Array(await file.slice(tagSize, tagSize + 16384).arrayBuffer());
    duration = mp3Duration(frames, file.size - tagSize - (hasV1 ? 128 : 0));
  } catch { /* fall through */ }
  if (!duration) duration = await elementDuration(file);

  const fn = fromFilename(file.name);
  const cover = tags.cover ? await shrinkCover(tags.cover) : null;
  const year = parseInt(String(tags.year || '').slice(0, 4), 10);
  return {
    title: tags.title || fn.title || file.name,
    artist: tags.artist || fn.artist || 'Unknown Artist',
    album: tags.album || 'Unknown Album',
    albumArtist: tags.albumArtist || '',
    track: num(tags.track) || num(fn.track),
    disc: num(tags.disc) || 1,
    year: Number.isFinite(year) ? year : 0,
    genre: /^\(?\d+\)?$/.test(tags.genre || '') ? '' : tags.genre || '',
    duration,
    cover,
  };
}
