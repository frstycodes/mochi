import { contextBridge, ipcRenderer } from 'electron';
import { manifest } from '../src/host/types/index.ts';

// Built from the manifest so the renderer only ever sees whitelisted `<namespace>:<method>` channels, never ipcRenderer itself.
const bridge = Object.fromEntries(
  Object.entries(manifest).map(([ns, methods]) => [
    ns,
    Object.fromEntries(
      Object.entries(methods).map(([method, kind]) => {
        const channel = `${ns}:${method}`;
        if (kind === 'invoke') return [method, (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)];
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
