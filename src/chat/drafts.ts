/**
 * What a composer holds before it's sent: per thread (`threadDraftKey`) and per profile's new-thread page (`newThreadDraftKey`).
 * Read from memory, so switching threads restores at once; written to IndexedDB in userData (debounced) for relaunches.
 * IndexedDB stores the attachment Blobs as files on disk, not as base64 in browser storage.
 */
export interface DraftFile {
  filename?: string;
  mediaType: string;
  blob: Blob;
}

export interface Draft<Extra = unknown> {
  text: string;
  files: DraftFile[];
  /** Composer state beside the text: mentions, or the new-thread page's model and project. Undefined when there's nothing to keep. */
  extra?: Extra;
}

export interface DraftStore {
  getAll(): Promise<[string, Draft][]>;
  put(key: string, draft: Draft): Promise<void>;
  delete(key: string): Promise<void>;
}

export const threadDraftKey = (threadId: string) => `thread:${threadId}`;
export const newThreadDraftKey = (spaceId: string) => `new:${spaceId}`;
/** Before the profile's settings chat exists, and what `open_settings_chat` drafts into it. */
export const settingsChatDraftKey = (spaceId: string) =>
  `settings-chat:${spaceId}`;

const SAVE_DELAY_MS = 400;
// Attachments past this stay in the composer but aren't kept across a relaunch.
export const MAX_DRAFT_BYTES = 25 * 1024 * 1024;

const drafts = new Map<string, Draft>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let store: DraftStore | undefined;
const getStore = () => (store ??= indexedDbStore());

/** Called once before the first render (`src/main.tsx`). */
export async function loadDrafts(from: DraftStore = getStore()) {
  store = from;
  try {
    for (const [key, draft] of await from.getAll()) drafts.set(key, draft);
  } catch (error) {
    console.error('Loading composer drafts failed', error);
  }
}

export function getDraft<Extra>(key: string) {
  return drafts.get(key) as Draft<Extra> | undefined;
}

export function saveDraft(key: string, draft: Draft) {
  if (isEmpty(draft)) return clearDraft(key);
  const kept = withinCap(draft);
  drafts.set(key, kept);
  schedule(key);
}

export function clearDraft(key: string) {
  if (!drafts.delete(key) && !timers.has(key)) return;
  schedule(key);
}

/** Drops the drafts of every thread not in `threadIds` (deleted here, in another window, or while no window was open). */
export function pruneDrafts(threadIds: ReadonlySet<string>) {
  const prefix = threadDraftKey('');
  // Deleting from a Map while iterating it is safe.
  for (const key of drafts.keys())
    if (key.startsWith(prefix) && !threadIds.has(key.slice(prefix.length)))
      clearDraft(key);
}

export function flushDrafts() {
  for (const key of timers.keys()) {
    clearTimeout(timers.get(key));
    timers.delete(key);
    write(key);
  }
}

function schedule(key: string) {
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      write(key);
    }, SAVE_DELAY_MS),
  );
}

// Writes whatever memory holds when the timer fires, so a put and a delete for one key can't land out of order.
function write(key: string) {
  const draft = drafts.get(key);
  (draft ? getStore().put(key, draft) : getStore().delete(key)).catch(
    (error: unknown) => console.error('Saving a composer draft failed', error),
  );
}

function isEmpty(draft: Draft) {
  return !draft.text && draft.files.length === 0 && draft.extra === undefined;
}

function withinCap(draft: Draft): Draft {
  let total = 0;
  const files = draft.files.filter(
    (f) => (total += f.blob.size) <= MAX_DRAFT_BYTES,
  );
  return files.length === draft.files.length ? draft : { ...draft, files };
}

function indexedDbStore(): DraftStore {
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('mochi-drafts', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('drafts');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const run = <T>(
    mode: IDBTransactionMode,
    request: (s: IDBObjectStore) => IDBRequest<T>,
  ) =>
    db.then(
      (d) =>
        new Promise<T>((resolve, reject) => {
          const r = request(
            d.transaction('drafts', mode).objectStore('drafts'),
          );
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        }),
    );
  return {
    async getAll() {
      const [keys, values] = await Promise.all([
        run('readonly', (s) => s.getAllKeys()),
        run('readonly', (s) => s.getAll() as IDBRequest<Draft[]>),
      ]);
      return keys.map((k, i) => [k as string, values[i]]);
    },
    put: (key, draft) =>
      run('readwrite', (s) => s.put(draft, key)).then(() => undefined),
    delete: (key) =>
      run('readwrite', (s) => s.delete(key)).then(() => undefined),
  };
}

if (typeof window !== 'undefined')
  window.addEventListener('beforeunload', flushDrafts);
