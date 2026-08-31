/* ─── IndexedDB-backed cache storage ─────────────────────────────────────────
 * Replaces localStorage for the bulky, unbounded caches (activities, intervals,
 * and per-activity HR/altitude streams). localStorage caps out around 5-10MB
 * per origin and was hitting QuotaExceededError once enough activity streams
 * accumulated; IndexedDB's quota is tied to available disk space (typically
 * hundreds of MB to GBs), so this removes that ceiling in practice.
 *
 * Two object stores, both keyed out-of-line by an explicit string key:
 *  - IDB_KV_STORE:     whole-array blobs (the activities cache, the intervals
 *                      cache) — mirrors the old "one big JSON blob" shape.
 *  - IDB_STREAM_STORE: one entry per cached HR/altitude stream, keyed the same
 *                      way the old `HR_STREAM_LS_PREFIX + cacheKey` localStorage
 *                      keys were.
 * Settings/tokens/small flags stay in localStorage — they're tiny and benefit
 * from staying synchronous. */

const IDB_DB_NAME = "intervals_spa_db";
const IDB_DB_VERSION = 1;
const IDB_KV_STORE = "kv";
const IDB_STREAM_STORE = "streams";
const IDB_MIGRATION_FLAG_KEY = "intervals_idb_migrated_v1";

let idbOpenPromise = null;

/** Opens (or returns the cached open handle to) the app's IndexedDB database. */
function idbOpen() {
  if (idbOpenPromise) return idbOpenPromise;
  idbOpenPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB not supported in this browser"));
      return;
    }
    const req = indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_KV_STORE)) db.createObjectStore(IDB_KV_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(IDB_STREAM_STORE)) db.createObjectStore(IDB_STREAM_STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB"));
  });
  return idbOpenPromise;
}

async function idbStore(storeName, mode) {
  const db = await idbOpen();
  return db.transaction(storeName, mode).objectStore(storeName);
}

/** Reads a single value by key from the given store; returns `fallback` if missing,
 *  corrupt, or IndexedDB is unavailable (private mode, unsupported, quota errors, etc). */
async function idbGetValue(storeName, key, fallback = null) {
  try {
    const store = await idbStore(storeName, "readonly");
    return await new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return fallback;
  }
}

/** Writes a single value by key into the given store. Silently no-ops on failure
 *  (quota exceeded, unsupported, private mode) — in-memory state still holds the data. */
async function idbSetValue(storeName, key, value) {
  try {
    const store = await idbStore(storeName, "readwrite");
    await new Promise((resolve, reject) => {
      const req = store.put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return true;
  } catch {
    return false;
  }
}

/** Deletes a single value by key from the given store. Silently no-ops on failure. */
async function idbDeleteValue(storeName, key) {
  try {
    const store = await idbStore(storeName, "readwrite");
    await new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch { /* ignore */ }
}

/** Returns every key currently stored in the given store (empty array on failure). */
async function idbGetAllKeys(storeName) {
  try {
    const store = await idbStore(storeName, "readonly");
    return await new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** One-time migration of the legacy localStorage-backed caches (activities,
 *  intervals, HR/altitude streams) into IndexedDB. Guarded by a flag so it only
 *  runs once per browser profile; safe to call on every boot. */
async function migrateLocalStorageCachesToIndexedDb() {
  if (localStorage.getItem(IDB_MIGRATION_FLAG_KEY) === "true") return;
  try {
    const rawActivities = localStorage.getItem(ACTIVITIES_CACHE_KEY);
    if (rawActivities) {
      try {
        const parsed = JSON.parse(rawActivities);
        if (Array.isArray(parsed)) await idbSetValue(IDB_KV_STORE, ACTIVITIES_CACHE_KEY, parsed);
      } catch { /* corrupt cache — drop it */ }
      localStorage.removeItem(ACTIVITIES_CACHE_KEY);
    }

    const rawIntervals = localStorage.getItem(INTERVALS_CACHE_KEY);
    if (rawIntervals) {
      try {
        const parsed = JSON.parse(rawIntervals);
        if (Array.isArray(parsed)) await idbSetValue(IDB_KV_STORE, INTERVALS_CACHE_KEY, parsed);
      } catch { /* corrupt cache — drop it */ }
      localStorage.removeItem(INTERVALS_CACHE_KEY);
    }

    const streamPrefixes = [
      HR_STREAM_LS_PREFIX,
      "intervals_hr_stream:",
      "intervals_hr_stream_v2:",
      "intervals_hr_stream_v3:",
      "intervals_hr_stream_v4:",
    ];
    const keysToMigrate = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && streamPrefixes.some((prefix) => k.startsWith(prefix))) keysToMigrate.push(k);
    }
    for (const lsKey of keysToMigrate) {
      const prefix = streamPrefixes.find((p) => lsKey.startsWith(p));
      const cacheKey = lsKey.slice(prefix.length);
      try {
        const raw = localStorage.getItem(lsKey);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed) await idbSetValue(IDB_STREAM_STORE, cacheKey, parsed);
      } catch { /* corrupt entry — drop it */ }
      localStorage.removeItem(lsKey);
    }
  } finally {
    // Mark migrated even on partial failure so we don't retry forever against
    // an IndexedDB that isn't working — the app still functions, just without
    // the higher storage ceiling.
    try { localStorage.setItem(IDB_MIGRATION_FLAG_KEY, "true"); } catch { /* ignore */ }
  }
}
