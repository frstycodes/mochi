import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/** A module-level slot for a viewer mounted once at the app root: `open` replaces the request (`null` closes), `use` reads it. */
export function createRequestStore<T>() {
  const store = createStore<{ request: T | null }>(() => ({ request: null }));
  return {
    open: (request: T | null) => store.setState({ request }),
    use: () => useStore(store, (s) => s.request),
  };
}
