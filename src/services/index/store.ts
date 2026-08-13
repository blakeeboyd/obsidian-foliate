import { openDB, IDBPDatabase } from "idb";

/**
 * IndexedDB persistence for the mention index.
 *
 * data.json is wrong at this scale: it is one JSON blob rewritten atomically on
 * every save, so a multi-MB index would be rewritten on every note edit, which
 * is the exact cost incremental updates exist to avoid. IndexedDB is
 * browser-native (no bundle cost beyond the ~1KB idb wrapper) and supports
 * keyed partial writes, so a one-note change touches one record.
 *
 * Only the per-note mention sets are stored. Document frequency, co-occurrence
 * and NPMI are derived views: on the measured vault they rebuild from the
 * stored sets in 0.1s, so persisting them would trade a real consistency
 * hazard for a saving too small to notice. This is also the plan's checksum
 * path, made structural rather than optional.
 */

const DB_VERSION = 1;
const MENTIONS = "mentions";
const META = "meta";

/** One note's mention set, plus what it was derived from. */
export interface MentionRecord {
  /** Vault path of the note. The primary key. */
  path: string;
  /** Vault paths of the taxa files this note mentions. */
  mentions: string[];
  /** mtime of the note when scanned, so an unchanged note can be skipped. */
  mtime: number;
}

export interface IndexMeta {
  key: string;
  value: unknown;
}

/**
 * One database per vault. Obsidian gives every vault its own origin-scoped
 * storage, but the name carries the vault id anyway so two vaults open in one
 * session cannot collide.
 */
export async function openIndexDb(vaultId: string): Promise<IDBPDatabase> {
  return openDB(`foliate-index-${vaultId}`, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(MENTIONS)) {
        db.createObjectStore(MENTIONS, { keyPath: "path" });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: "key" });
      }
    },
  });
}

/**
 * Write many records in one transaction. Batching matters: a large-vault user
 * reported excessive IndexedDB operations on vault open, and one transaction
 * per note during a full build is exactly that failure.
 */
export async function putMentionRecords(
  db: IDBPDatabase,
  records: MentionRecord[]
): Promise<void> {
  const tx = db.transaction(MENTIONS, "readwrite");
  await Promise.all(records.map((r) => tx.store.put(r)));
  await tx.done;
}

export async function getMentionRecord(
  db: IDBPDatabase,
  path: string
): Promise<MentionRecord | undefined> {
  return db.get(MENTIONS, path);
}

export async function getAllMentionRecords(db: IDBPDatabase): Promise<MentionRecord[]> {
  return db.getAll(MENTIONS);
}

export async function deleteMentionRecord(db: IDBPDatabase, path: string): Promise<void> {
  await db.delete(MENTIONS, path);
}

export async function clearIndex(db: IDBPDatabase): Promise<void> {
  const tx = db.transaction([MENTIONS, META], "readwrite");
  await Promise.all([tx.objectStore(MENTIONS).clear(), tx.objectStore(META).clear()]);
  await tx.done;
}

export async function setMeta(db: IDBPDatabase, key: string, value: unknown): Promise<void> {
  await db.put(META, { key, value });
}

export async function getMeta<T>(db: IDBPDatabase, key: string): Promise<T | undefined> {
  const row = (await db.get(META, key)) as IndexMeta | undefined;
  return row?.value as T | undefined;
}
