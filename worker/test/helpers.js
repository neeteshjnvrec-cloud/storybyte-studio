/** Replaces modules in require's cache so tests run without Firebase or the network. */
const path = require('path');

function stub(relPath, exports) {
  const file = require.resolve(path.join(__dirname, '..', 'src', relPath));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

/** A tiny in-memory Firestore: enough of doc()/collectionGroup()/runTransaction() for run.js. */
function fakeDb(store = {}) {
  const ref = (p) => ({
    id: p.split('/').pop(), path: p,
    get parent() {
      const parts = p.split('/');
      return { id: parts[parts.length - 2], parent: parts.length > 2 ? ref(parts.slice(0, -2).join('/')) : null };
    },
    get: async () => ({ exists: !!store[p], id: p.split('/').pop(), ref: ref(p), data: () => store[p] }),
    set: async (d, o) => { store[p] = o?.merge ? { ...store[p], ...d } : { ...d }; },
    update: async (d) => { store[p] = { ...store[p], ...d }; },
    create: async (d) => {
      if (store[p]) throw Object.assign(new Error('exists'), { code: 6 });
      store[p] = { ...d };
    },
  });
  const group = (name) => ({
    filters: [],
    where(field, op, value) { this.filters.push([field, op, value]); return this; },
    async get() {
      const docs = Object.keys(store)
        .filter((p) => p.split('/').slice(-2)[0] === name)
        .filter((p) => this.filters.every(([f, , v]) => store[p][f] === v))
        .map((p) => ({ id: p.split('/').pop(), ref: ref(p), data: () => store[p] }));
      return { docs, size: docs.length };
    },
  });
  return {
    store,
    doc: ref,
    collectionGroup: group,
    runTransaction: async (fn) => fn({ get: (r) => r.get(), update: (r, d) => { store[r.path] = { ...store[r.path], ...d }; } }),
  };
}

const Timestamp = { fromMillis: (ms) => ({ toMillis: () => ms }), now: () => ({ toMillis: () => Date.now() }) };
const FieldValue = { serverTimestamp: () => 'SERVER_TS', delete: () => undefined };

module.exports = { stub, fakeDb, Timestamp, FieldValue };
