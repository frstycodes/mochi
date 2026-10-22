import { createStore } from 'zustand/vanilla';
import { persist, type PersistStorage } from 'zustand/middleware';

export function persistedSlice<T>(key: string, fallback: T, parse = (raw: string | null): T => JSON.parse(raw ?? 'null') ?? fallback, strict = false) {
  const read = (raw: string | null) => {
    try {
      return parse(raw);
    } catch {
      return fallback;
    }
  };
  return createStore(
    persist(() => ({ value: fallback }), {
      name: key,
      version: 1,
      storage: persistStorage<T>(strict),
      migrate: (saved) => ({ value: read((saved as { value: string | null }).value) }),
      merge: (saved) => ({ value: read(JSON.stringify((saved as { value: T }).value)) }),
    }),
  );
}

export function persistedFamily<T>(prefix: string, fallback: T) {
  const slices = new Map<string, ReturnType<typeof persistedSlice<T>>>();
  return (id: string) => {
    let slice = slices.get(id);
    if (!slice) {
      slice = persistedSlice(prefix + id, fallback);
      slices.set(id, slice);
    }
    return slice;
  };
}

export const browserStorage = {
  getItem(key: string) {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    globalThis.localStorage?.setItem(key, value);
  },
  removeItem(key: string) {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {}
  },
};

export function clearUiStorage() {
  try {
    globalThis.localStorage?.clear();
  } catch {}
}

export function uiStorageEntries(): [string, string][] {
  try {
    return Object.keys(globalThis.localStorage ?? {}).map((key) => [key, browserStorage.getItem(key) ?? '']);
  } catch {
    return [];
  }
}

function persistStorage<T>(strict: boolean): PersistStorage<{ value: T }> {
  return {
    getItem(key) {
      const raw = browserStorage.getItem(key);
      try {
        const saved = JSON.parse(raw ?? 'null');
        if (saved && typeof saved.version === 'number' && saved.state && Object.hasOwn(saved.state, 'value')) return saved;
      } catch {}
      // Unwrapped entries predate persist. Version zero carries the original text to the slice's migration.
      return { state: { value: raw as T }, version: 0 };
    },
    setItem(key, value) {
      try {
        browserStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        if (strict) throw error;
      }
    },
    removeItem: (key) => browserStorage.removeItem(key),
  };
}
