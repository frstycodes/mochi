import { isUpdatable, type LibraryItem } from '../../src/library/library.ts';
import { discoverSkills, fetchPluginBundle } from './catalog.ts';
import { marketplaces, readLibrary, updateLibrary } from './store.ts';

/**
 * Skills and plugins follow their source (LIBRARY.md Phase 3): checked a minute after launch and every 6 hours, each
 * re-read from GitHub and replaced when its content changed. An item with `autoUpdate` off stays as installed.
 * New threads load the update; running sessions keep the folder they started with.
 */
export function startLibraryUpdates() {
  setTimeout(() => void updateAll(), FIRST_CHECK_MS).unref();
  setInterval(() => void updateAll(), CHECK_EVERY_MS).unref();
}

const FIRST_CHECK_MS = 60_000;
const CHECK_EVERY_MS = 6 * 3600_000;

async function updateAll() {
  for (const item of (await readLibrary()).items) {
    if (!isUpdatable(item) || item.autoUpdate === false) continue;
    await updateItem(item.id).catch((error: Error) => console.warn(`library: ${item.id} not updated:`, error.message));
  }
}

/** Re-reads the item from its source and replaces it when anything changed; true when it did. */
export async function updateItem(id: string): Promise<boolean> {
  const item = (await readLibrary()).items.find((i) => i.id === id);
  if (!item || !isUpdatable(item)) throw new Error('Only skills from GitHub and plugins from a marketplace can update');
  const next = await latest(item);
  if (!next) return false;
  await updateLibrary((index) => ({ ...index, items: index.items.map((i) => (i.id === id ? { ...next, updatedAt: Date.now() } : i)) }));
  return true;
}

/** The item as its source has it now, or null when that's what is installed. */
async function latest(item: LibraryItem): Promise<LibraryItem | null> {
  if (item.kind === 'skill' && item.source) {
    const found = (await discoverSkills(item.source, { isFresh: true })).find((skill) => skill.name === item.name);
    if (!found) throw new Error(`${item.name} is no longer in ${item.source}`);
    if (JSON.stringify(found.files) === JSON.stringify(item.files)) return null;
    return { ...item, files: found.files, description: found.description, icon: found.icon };
  }
  if (item.kind === 'plugin') {
    const marketplace = (await marketplaces()).find((m) => m.name === item.marketplace);
    if (!marketplace) throw new Error(`The ${item.marketplace} marketplace was removed`);
    const { icon, ...bundle } = await fetchPluginBundle(marketplace.source, item.bundle.name);
    if (JSON.stringify(bundle) === JSON.stringify(item.bundle)) return null;
    return { ...item, bundle, icon };
  }
  return null;
}

export function setAutoUpdate(id: string, autoUpdate: boolean) {
  return updateLibrary((index) => ({ ...index, items: index.items.map((i) => (i.id === id ? { ...i, autoUpdate } : i)) }));
}
