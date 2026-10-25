import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { cached } from '../cache.ts';

/** Where web, app and desktop projects keep their icon, most specific first. Relative to the project's folder. */
export const FAVICON_PATHS = [
  'favicon.svg',
  'favicon.ico',
  'favicon.png',
  'public/favicon.svg',
  'public/favicon.ico',
  'public/favicon.png',
  'public/icon.svg',
  'public/icon.png',
  'public/logo.svg',
  'public/logo.png',
  'public/apple-touch-icon.png',
  'app/icon.svg',
  'app/icon.png',
  'app/favicon.ico',
  'src/app/icon.svg',
  'src/app/icon.png',
  'src/app/favicon.ico',
  'static/favicon.svg',
  'static/favicon.ico',
  'static/favicon.png',
  'src/assets/icon.svg',
  'src/assets/icon.png',
  'src/assets/logo.svg',
  'src/assets/logo.png',
  'assets/icon.svg',
  'assets/icon.png',
  'assets/logo.svg',
  'assets/logo.png',
  'build/icon.svg',
  'build/icon.png',
  'resources/icon.png',
  'docs/public/favicon.svg',
  'docs/public/favicon.ico',
  'apps/web/public/favicon.svg',
  'apps/web/public/favicon.ico',
  'apps/web/app/favicon.ico',
];

export const ICON_TYPES = {
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
} satisfies Record<string, string>;

/** Bigger than any icon needs to be; a file past it is a screenshot, not an icon. */
export const MAX_ICON_BYTES = 512 * 1024;

/** The first favicon in `FAVICON_PATHS` that exists and is small enough, relative to `folder`. */
export async function findFavicon(folder: string) {
  for (const relative of FAVICON_PATHS) {
    const size = await stat(join(folder, relative)).then(
      (s) => (s.isFile() ? s.size : 0),
      () => 0,
    );
    if (size > 0 && size <= MAX_ICON_BYTES) return relative;
  }
  return null;
}

// The key carries the mtime, so a changed file is read again; the TTL only bounds how long old ones linger.
const ICON_TTL = '1 day';

/** A data URL for an icon file, read again only when the file changes. Null when it's gone or too big. */
export async function iconUrl(file: string) {
  const info = await stat(file).catch(() => null);
  const type =
    ICON_TYPES[extname(file).toLowerCase() as keyof typeof ICON_TYPES];
  if (!info?.isFile() || info.size > MAX_ICON_BYTES || !type) return null;
  return cached(
    `icon:${file}:${info.mtimeMs}`,
    ICON_TTL,
    async () =>
      `data:${type};base64,${(await readFile(file)).toString('base64')}`,
  );
}

/** An uploaded icon, stored as `<dir>/<projectId>.<ext>` (any earlier one with another extension removed). */
export async function saveCustomIcon(
  dir: string,
  projectId: string,
  dataUrl: string,
) {
  const match = dataUrl.match(/^data:([\w.+/-]+);base64,([A-Za-z0-9+/=]+)$/);
  const ext =
    match &&
    Object.entries(ICON_TYPES).find(([, type]) => type === match[1])?.[0];
  if (!match || !ext)
    throw new Error(
      'An icon must be an SVG, PNG, JPEG, WebP, GIF or ICO image',
    );
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_ICON_BYTES)
    throw new Error(
      `That image is ${Math.round(bytes.length / 1024)} KB; an icon can be up to ${MAX_ICON_BYTES / 1024} KB`,
    );
  await removeCustomIcon(dir, projectId);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${projectId}${ext === '.jpeg' ? '.jpg' : ext}`);
  await writeFile(file, bytes);
  return file;
}

export async function removeCustomIcon(dir: string, projectId: string) {
  await Promise.all(
    Object.keys(ICON_TYPES).map((ext) =>
      rm(join(dir, `${projectId}${ext}`), { force: true }),
    ),
  );
}

export async function customIconFile(dir: string, projectId: string) {
  for (const ext of Object.keys(ICON_TYPES)) {
    const file = join(dir, `${projectId}${ext}`);
    if (
      await stat(file).then(
        (s) => s.isFile(),
        () => false,
      )
    )
      return file;
  }
  return null;
}
