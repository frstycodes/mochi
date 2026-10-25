import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { host } from './host';

const zoomStore = createStore<{ zoom: number }>(() => ({ zoom: 1 }));

/** The lights stay native size under ⌘+ / ⌘−, so the headers' inset for them is `--lights-end` in CSS px; zooming changes `devicePixelRatio`. */
export function followZoom() {
  let ratio = 0;
  const sync = () => {
    if (window.devicePixelRatio === ratio) return;
    ratio = window.devicePixelRatio;
    void host.windows.zoomFactor().then((next) => {
      zoomStore.setState({ zoom: next });
      document.documentElement.style.setProperty('--app-zoom', String(next));
    });
  };
  sync();
  window.addEventListener('resize', sync);
}

/** `--lights-end` in `index.css`, in CSS px, for code that measures against it. */
export function lightsEnd() {
  return 75 / zoomStore.getState().zoom;
}

/** The app's ⌘+ / ⌘− zoom factor; always 1 off the desktop app. */
export function useAppZoom() {
  return useStore(zoomStore, (s) => s.zoom);
}
