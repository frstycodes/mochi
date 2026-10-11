import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { host } from './host';
import './index.css';

if (host.isDesktop) showTrafficLights();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// macOS hides the traffic lights in full screen; the headers drop their inset for them too.
function showTrafficLights() {
  const set = (isFullScreen: boolean) => document.documentElement.toggleAttribute('data-traffic-lights', !isFullScreen);
  set(false);
  void host.windows.isFullScreen().then(set);
  host.windows.onFullScreenChange(set);
}
