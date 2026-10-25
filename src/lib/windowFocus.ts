import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

const read = () => ({
  hasFocus: document.hasFocus(),
  isActive: document.hasFocus() && !document.hidden,
});

const focusStore = createStore(() =>
  typeof document === 'undefined'
    ? { hasFocus: false, isActive: false }
    : read(),
);

if (typeof window !== 'undefined') {
  const sync = () => focusStore.setState(read());
  window.addEventListener('focus', sync);
  window.addEventListener('blur', sync);
  document.addEventListener('visibilitychange', sync);
}

/** Whether this window has focus. */
export const useHasFocus = () => useStore(focusStore, (s) => s.hasFocus);

/** Focused and not hidden. */
export const useIsWindowActive = () => useStore(focusStore, (s) => s.isActive);
