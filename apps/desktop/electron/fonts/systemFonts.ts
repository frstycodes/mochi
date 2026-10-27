import { runCommand } from '@mochi/core/runClient';
import type { SystemFont } from '../../src/host/types/settings.ts';
import { cached } from '../cache.ts';
import { nativeHelper } from '../native.ts';
import helperSource from './fonts.swift?raw';

const HELPER_TIMEOUT_MS = 30_000;
// fontconfig's %{spacing}: 100 is monospace, 110 character cell.
const FIXED_SPACINGS = new Set(['100', '110']);

/** Installed font families, or null where this platform can't list them. Only a successful listing is cached. */
export async function listSystemFonts(): Promise<SystemFont[] | null> {
  try {
    return await cached('systemFonts', '10 minutes', loadSystemFonts);
  } catch {
    return null;
  }
}

async function loadSystemFonts(): Promise<SystemFont[]> {
  if (process.platform === 'darwin') return macFonts();
  if (process.platform === 'linux') return linuxFonts();
  // GAP: Windows isn't listed yet.
  throw new Error('Listing fonts is not supported on this platform');
}

async function macFonts(): Promise<SystemFont[]> {
  const helper = await nativeHelper('fonts', helperSource);
  if (!helper) throw new Error('No font helper');
  const { stdout } = await runCommand(helper, [], {
    timeout: HELPER_TIMEOUT_MS,
  });
  return JSON.parse(stdout) as SystemFont[];
}

async function linuxFonts(): Promise<SystemFont[]> {
  const { stdout } = await runCommand(
    'fc-list',
    ['--format', '%{family[0]}\t%{spacing}\n'],
    { timeout: HELPER_TIMEOUT_MS },
  );
  const families = new Map<string, boolean>();
  for (const line of stdout.split('\n')) {
    const [family, spacing] = line.split('\t');
    if (!family) continue;
    families.set(
      family,
      !!families.get(family) || FIXED_SPACINGS.has(spacing?.trim() ?? ''),
    );
  }
  return [...families]
    .map(([family, isMono]) => ({ family, isMono }))
    .sort((a, b) =>
      a.family.localeCompare(b.family, undefined, { sensitivity: 'base' }),
    );
}
