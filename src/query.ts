import { focusManager, QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, gcTime: 5 * 60_000, retry: false, networkMode: 'always' },
    mutations: { networkMode: 'always' },
  },
});

if (typeof window !== 'undefined') focusManager.setEventListener((onFocus) => {
  const focus = () => onFocus(document.visibilityState !== 'hidden');
  window.addEventListener('focus', focus);
  window.addEventListener('visibilitychange', focus);
  return () => { window.removeEventListener('focus', focus); window.removeEventListener('visibilitychange', focus); };
});
