import { toast } from '@/toast/store';
import { host } from './host';
import { favoritesFirst } from './projects';
import { toggleStar } from './settings/prefsDefaults';

/** Stars the project at the end of the favorites, or takes it out of them. */
export function toggleFavorite(
  spaceId: string,
  projects: readonly { id: string; favoriteOrder: number | null }[],
  id: string,
): Promise<void> {
  const favorites = favoritesFirst([...projects])
    .filter((p) => p.favoriteOrder !== null)
    .map((p) => p.id);
  return host.projects
    .setFavorites(spaceId, toggleStar(favorites, id))
    .catch((e: unknown) => {
      toast.error('Favorites not saved', {
        description: e instanceof Error ? e.message : String(e),
      });
    });
}
