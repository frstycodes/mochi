import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

const MOBILE_BREAKPOINT = 768;
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

const mobileStore = createStore(() => ({
  isMobile: typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
}));

if (typeof window !== 'undefined') {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', () =>
    mobileStore.setState({ isMobile: mql.matches }),
  );
}

export const useIsMobile = () => useStore(mobileStore, (s) => s.isMobile);
