import type { Manifest } from './manifest.ts';

/** A folder a profile works in, kept by main in `projects.json` (userData). */
export interface Project {
  id: string;
  name: string;
  path: string;
  /** `normalizeOrigin` of its `origin` remote, the same project on every computer; null for a folder that isn't a repo or has no remote. */
  origin: string | null;
  addedAt: number;
  /** Where its icon comes from: a favicon found in the folder (`auto`), an image you uploaded, or the letter. */
  iconMode: ProjectIconMode;
  /** The icon as a data URL, with the favicon's path in the folder when it's one; null shows the letter. */
  icon: { url: string; source: 'favicon' | 'custom'; file?: string } | null;
  /** The favicon found in the folder (its path there), whichever icon is in use. */
  favicon: string | null;
  /** The folder is gone from `path`: moved or deleted outside Mochi. Relocate fixes it. */
  isMissing: boolean;
}

export type ProjectIconMode = 'auto' | 'custom' | 'none';

/** What to clone: any git URL with your own git credentials, or `owner/repo` on GitHub as the profile's gh login. */
export type CloneSource = { url: string } | { github: string };

export interface GithubRepo {
  /** `owner/repo`. */
  name: string;
  description: string;
  isPrivate: boolean;
  updatedAt: string;
}

/** `githubUser` is the profile's GitHub account (`Space.github`); unset runs as gh's active login. */
export interface ProjectsHost {
  list(spaceId: string): Promise<Project[]>;
  /** Seeds a profile's list once from the folders it used before the registry (recents and thread folders); later calls only list. */
  migrate(spaceId: string, paths: string[]): Promise<Project[]>;
  /** An existing folder; one already listed comes back as it is. */
  addFolder(spaceId: string, path: string): Promise<Project>;
  /** Into `parentDir/<repo>`, refused if that exists. Progress lines arrive through `onProgress` under `opId`. */
  clone(spaceId: string, source: CloneSource, options: { parentDir: string; opId: string; githubUser?: string }): Promise<Project>;
  /** `git init` in `parentDir/<name>`; `publish` also creates the GitHub repository through gh and sets it as origin. */
  create(spaceId: string, name: string, options: { parentDir: string; publish?: 'private' | 'public'; githubUser?: string }): Promise<Project>;
  rename(spaceId: string, id: string, name: string): Promise<void>;
  /** From the list only; the folder stays on disk. */
  remove(spaceId: string, id: string): Promise<void>;
  /** Points a project at the folder it moved to; refused when that folder is a different repository. */
  relocate(spaceId: string, id: string, path: string): Promise<Project>;
  /** An uploaded image (a data URL, up to 512 KB), `auto` to use the folder's favicon, or `none` for the letter. */
  setIcon(spaceId: string, id: string, icon: string): Promise<Project>;
  githubRepos(githubUser?: string): Promise<GithubRepo[]>;
  onChange(listener: (spaceId: string) => void): () => void;
  onProgress(listener: (progress: { opId: string; line: string }) => void): () => void;
}

export const projectsMethods = {
  list: 'invoke',
  migrate: 'invoke',
  addFolder: 'invoke',
  clone: 'invoke',
  create: 'invoke',
  rename: 'invoke',
  remove: 'invoke',
  relocate: 'invoke',
  setIcon: 'invoke',
  githubRepos: 'invoke',
  onChange: 'event',
  onProgress: 'event',
} satisfies Manifest<ProjectsHost>;
