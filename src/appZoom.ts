import { useSyncExternalStore } from 'react';
import { host } from './host';

let zoom = 1;
const listeners = new Set<() => void>();

/** The lights stay native size under ⌘+ / ⌘−, so the headers' inset for them is `--lights-end` in CSS px; zooming changes `devicePixelRatio`. */
export function followZoom() {
  let ratio = 0;
  const sync = () => {
    if (window.devicePixelRatio === ratio) return;
    ratio = window.devicePixelRatio;
    void host.windows.zoomFactor().then((next) => {
      zoom = next;
      document.documentElement.style.setProperty('--app-zoom', String(next));
      for (const listener of listeners) listener();
    });
  };
  sync();
  window.addEventListener('resize', sync);
}

/** `--lights-end` in `index.css`, in CSS px, for code that measures against it. */
export function lightsEnd() {
  return 75 / zoom;
}

/** The app's ⌘+ / ⌘− zoom factor; always 1 off the desktop app. */
export function useAppZoom() {
  return useSyncExternalStore(subscribe, () => zoom);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
