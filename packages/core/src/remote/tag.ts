import { Context } from 'effect';
import type { RemoteApi } from './service.ts';

/**
 * Core's remote access (`service.ts`, `layerRemote`). Only the key here: `hosted.ts`, and through it `watch.ts`, name the
 * service without loading libsodium, `ws` and the relay client at import.
 */
export class Remote extends Context.Service<Remote, RemoteApi>()(
  'mochi/core/Remote',
) {}
