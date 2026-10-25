import type { SectionId } from '../settings/sections';

/** `nonce` re-triggers the scroll-and-flash when the same setting is deep-linked twice. `subpage` is one item's own page inside the section (a connector). */
export interface SettingsRoute {
  section: SectionId;
  settingId?: string;
  subpage?: string;
  nonce: number;
}

export interface RemoteThreadRoute {
  machineId: string;
  threadId: string;
}

export interface PageLocation {
  pathname: string;
  search: unknown;
  state: object;
}

export function settingsRouteOf({
  pathname,
  search,
  state,
}: PageLocation): SettingsRoute | null {
  const [, root, section] = pathname.split('/');
  if (root !== 'settings' || !section) return null;
  const { setting, subpage } = search as {
    setting?: unknown;
    subpage?: unknown;
  };
  return {
    section: decodeURIComponent(section) as SectionId,
    settingId: setting == null ? undefined : String(setting),
    subpage: subpage == null ? undefined : String(subpage),
    nonce: (state as { nonce?: number }).nonce ?? 0,
  };
}

export function replayThreadOf({ pathname }: PageLocation) {
  const [, root, threadId] = pathname.split('/');
  return root === 'replay' && threadId ? decodeURIComponent(threadId) : null;
}

export function remoteRouteOf({
  pathname,
}: PageLocation): RemoteThreadRoute | null {
  const [, root, machineId, threadId] = pathname.split('/');
  if (root !== 'remote' || !machineId || !threadId) return null;
  return {
    machineId: decodeURIComponent(machineId),
    threadId: decodeURIComponent(threadId),
  };
}
