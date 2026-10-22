import { contextBridge, ipcRenderer } from 'electron';
import { manifest } from '../src/host/types/index.ts';

// Only the `event` methods cross here, as whitelisted `<namespace>:<method>` channels, never ipcRenderer itself.
// Request/response methods go over the `host:port` RPC port (`src/host/desktop/rpc.ts`).
const bridge = Object.fromEntries(
  Object.entries(manifest).map(([ns, methods]) => [
    ns,
    Object.fromEntries(
      Object.entries(methods)
        .filter(([, kind]) => kind === 'event')
        .map(([method]) => {
          const channel = `${ns}:${method}`;
          return [
            method,
            (listener: (payload: unknown) => void) => {
              const forward = (_event: unknown, payload: unknown) => listener(payload);
              ipcRenderer.on(channel, forward);
              return () => void ipcRenderer.off(channel, forward);
            },
          ];
        }),
    ),
  ]),
);

contextBridge.exposeInMainWorld('harnessHost', bridge);
// A port can't cross contextBridge: re-post it to the page.
for (const channel of ['core:port', 'host:port']) ipcRenderer.on(channel, (event) => window.postMessage(channel, '*', event.ports));
