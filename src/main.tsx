import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { host } from './host';
import { followZoom } from './appZoom';
import { HAS_CAPTIONS } from './windowCaptions';
import { IS_MAC } from './keys';
import { restoreFailed, restoreSaved } from './store/persist';
import { loadDrafts } from './chat/drafts';
import './index.css';

if (host.isDesktop) showWindowChrome();

// The store is created on first render, so last launch's threads are read before it.
host.data
  .load()
  .then(restoreSaved, (error: unknown) => restoreFailed(error))
  .then(() => loadDrafts())
  .then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });

// Full screen hides the native window buttons and the drag regions; the headers drop their insets for them too.
function showWindowChrome() {
  const root = document.documentElement;
  const set = (isFullScreen: boolean) => {
    root.toggleAttribute('data-window-drag', !isFullScreen);
    root.toggleAttribute('data-traffic-lights', !isFullScreen && IS_MAC);
    root.toggleAttribute('data-captions', !isFullScreen && HAS_CAPTIONS);
  };
  set(false);
  void host.windows.isFullScreen().then(set);
  host.windows.onFullScreenChange(set);
  followZoom();
}
