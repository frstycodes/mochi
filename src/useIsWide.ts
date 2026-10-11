import { useSyncExternalStore } from 'react';

const QUERY = '(min-width: 1024px)';

export function useIsWide() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(QUERY);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => window.matchMedia(QUERY).matches,
  );
}
