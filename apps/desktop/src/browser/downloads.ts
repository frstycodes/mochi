import { toast } from '@/toast/store';
import { host } from '@/host';
import type { BrowserEvent } from '@mochi/domain/host/types/browser';
import { IS_MAC } from '@/keys';

const REVEAL_LABEL = IS_MAC ? 'Show in Finder' : 'Show in folder';

/** A toast when a page's download lands or fails; progress shows nothing. */
export function notifyDownload({
  state,
  name,
  path,
}: Pick<
  Extract<BrowserEvent, { type: 'download' }>,
  'state' | 'name' | 'path'
>) {
  if (state === 'failed') return void toast.error(`Download failed: ${name}`);
  if (state !== 'done') return;
  toast(`Downloaded ${name}`, {
    action: {
      label: REVEAL_LABEL,
      onClick: () =>
        host.browser
          .showDownload(path)
          .catch((e: Error) => toast.error(e.message)),
    },
  });
}
