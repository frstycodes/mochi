import { Capabilities } from '@mochi/schema';
import type { Provider } from '../../../../apps/desktop/src/model.ts';
import { main, type SessionLibrary } from '../agents/main.ts';
import { sessionLibrary } from './store.ts';

/** What a new session of the profile loads: plugins and servers from the library here, connectors from main when it serves them. */
export async function librarySession(
  spaceId: string,
  provider: Provider,
): Promise<SessionLibrary> {
  const [library, connected] = await Promise.all([
    sessionLibrary(spaceId, provider),
    // Under `mochi serve` nothing serves connector accounts yet.
    main
      .connectors(spaceId)
      .catch((error: unknown) =>
        error instanceof Capabilities.CapabilityUnavailable
          ? { connectors: [], rules: {} }
          : Promise.reject(error),
      ),
  ]);
  return { ...library, ...connected };
}
