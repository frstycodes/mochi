import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { host } from './host';
import { restoreFailed, restoreSaved } from './store/persist';
import { loadDrafts } from './chat/drafts';
import './index.css';

if (host.isDesktop) showTrafficLights();

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

// macOS hides the traffic lights in full screen; the headers drop their inset for them too.
function showTrafficLights() {
  const set = (isFullScreen: boolean) => document.documentElement.toggleAttribute('data-traffic-lights', !isFullScreen);
  set(false);
  void host.windows.isFullScreen().then(set);
  host.windows.onFullScreenChange(set);
  followZoom();
}

/** The lights stay native size under ⌘+ / ⌘−, so the headers' inset for them is `--lights-end` in CSS px; zooming changes `devicePixelRatio`. */
function followZoom() {
  let ratio = 0;
  const sync = () => {
    if (window.devicePixelRatio === ratio) return;
    ratio = window.devicePixelRatio;
    void host.windows.zoomFactor().then((zoom) => document.documentElement.style.setProperty('--app-zoom', String(zoom)));
  };
  sync();
  window.addEventListener('resize', sync);
}
