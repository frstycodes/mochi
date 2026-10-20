import { toast } from '@/toast/store';
import type { Space } from '../model';
import { updateProfile } from '../profiles';
import { countOf } from './LibraryParts';
import { NATIVE_KIND_LABELS, withOff, type NativeItem } from './nativeItems';

/** Turns native items off (or back on) in one profile, with an undo: every bulk change is reversible, so it never asks first. */
export function setAllOff(profile: Space, items: NativeItem[], isOff: boolean, harness: string) {
  const before = profile.nativeOff;
  updateProfile(profile.id, {
    nativeOff: withOff(
      before,
      items.map((i) => i.id),
      isOff,
    ),
  });
  const what = `${countOf(items.length, items.every((i) => i.kind === items[0].kind) ? NATIVE_KIND_LABELS[items[0].kind].toLowerCase() : 'item')} from ${harness}`;
  toast(isOff ? `Turned off ${what} in ${profile.name}` : `Turned on ${what} in ${profile.name}`, {
    description: isOff ? `${harness} still loads them. New threads in ${profile.name} start without them.` : `New threads in ${profile.name} load them again.`,
    action: { label: 'Undo', onClick: () => updateProfile(profile.id, { nativeOff: before }) },
  });
}
