// IndexedDB wrapper for SetLists.
//   artists   {id, name}
//   songs     {id, artistId, title, key, bpm, notes, added}
//   files     {id, songId, kind: 'chart' | 'audio', name, label, mime, size, duration, added}
//   blobs     id -> Blob          (file contents; kept apart so listing never loads them)
//   covers    {id, blob}          (id is a song id or an artist id)
//   setlists  {id, name, songIds, created}
let dbp;
function open() {
  return (dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open('setlists', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of ['artists', 'songs', 'files', 'covers', 'setlists']) d.createObjectStore(s, { keyPath: 'id' });
      d.createObjectStore('blobs');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const DB = {
  async all(store) { const db = await open(); return req(db.transaction(store).objectStore(store).getAll()); },
  async get(store, key) { const db = await open(); return req(db.transaction(store).objectStore(store).get(key)); },
  // Run several writes atomically: DB.tx(['songs','files'], (s) => { s.songs.put(x); s.files.delete(id); })
  async tx(stores, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, 'readwrite');
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaction aborted'));
      fn(Object.fromEntries(stores.map((s) => [s, t.objectStore(s)])));
    });
  },
  put(store, value) { return this.tx([store], (s) => s[store].put(value)); },
  del(store, key) { return this.tx([store], (s) => s[store].delete(key)); },
  putFile(meta, blob) { return this.tx(['files', 'blobs'], (s) => { s.blobs.put(blob, meta.id); s.files.put(meta); }); },
  blob(id) { return this.get('blobs', id); },
};
