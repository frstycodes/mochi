/**
 * Skill sources as Vercel's skills CLI (`npx skills add`) reads them, GitHub only: `owner/repo`, `owner/repo/path`,
 * `owner/repo@skill`, `github:owner/repo`, a `#ref` or `#ref@skill` fragment, and github.com repo, tree and blob URLs.
 */
export interface SkillSource {
  owner: string;
  repo: string;
  ref: string;
  /** Folder inside the repo to look under; '' for the whole repo. */
  path: string;
  /** Only the skill with this name (`@skill`); null for every skill found. */
  skill: string | null;
}

export function parseSkillSource(input: string): SkillSource | null {
  let text = input.trim().replace(/^github:/, '');
  let fragmentRef: string | undefined;
  let skill: string | null = null;
  const hash = text.indexOf('#');
  if (hash >= 0) {
    [fragmentRef, skill = null] = text.slice(hash + 1).split('@') as [
      string,
      string?,
    ];
    text = text.slice(0, hash);
  }
  text = text.replace(/\/+$/, '');
  const url = text.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(tree|blob)\/([^/]+)(?:\/(.+))?)?$/,
  );
  const short =
    !url && !text.includes(':')
      ? text.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:@(.+)|\/(.+))?$/)
      : null;
  if (!url && !short) return null;
  const [owner, repo] = (url ?? short)!.slice(1, 3) as [string, string];
  if (owner.startsWith('.')) return null;
  let path = (url ? url[5] : short![4]) ?? '';
  if (url?.[3] === 'blob') path = path.replace(/(^|\/)[^/]+$/, '');
  if (path.split('/').includes('..')) return null;
  return {
    owner,
    repo,
    ref: (url?.[4] ?? fragmentRef) || 'HEAD',
    path,
    skill: short?.[3] ?? (skill || null),
  };
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
]);
// The CLI walks these containers three levels deep, the search folder itself one level, then falls back to every
// SKILL.md up to five levels down when they hold none.
const CONTAINERS = [
  'skills',
  'skills/.curated',
  'skills/.experimental',
  'skills/.system',
];
const CONTAINER_DEPTH = 3;
const FALLBACK_DEPTH = 5;

/**
 * The folders (repo-relative, '' for the root) holding a skill under `scope`, found by the skills CLI's rules: a SKILL.md
 * at `scope` is the one skill; else the usual containers, an agent's own `.<agent>/skills`, then any depth.
 */
export function findSkillDirs(
  filePaths: Iterable<string>,
  scope: string,
): string[] {
  const prefix = scope ? `${scope}/` : '';
  const skillDirs = new Set<string>();
  for (const path of filePaths) {
    if (
      !(
        path === `${prefix}SKILL.md` ||
        (path.startsWith(prefix) && path.endsWith('/SKILL.md'))
      )
    )
      continue;
    skillDirs.add(
      path.slice(prefix.length, -'SKILL.md'.length).replace(/\/$/, ''),
    );
  }
  const full = (dir: string) => [scope, dir].filter(Boolean).join('/');
  if (skillDirs.has('')) return [scope];

  // ponytail: any `.<folder>/skills` stands in for the CLI's list of 30-odd agent folders.
  const agentContainers = [
    ...new Set(
      [...skillDirs]
        .map((dir) => dir.match(/^(\.[^/]+\/skills)\//)?.[1])
        .filter((c) => c !== undefined),
    ),
  ];
  const containers: [string, number][] = [
    ['', 1],
    ...[...CONTAINERS, ...agentContainers].map((c): [string, number] => [
      c,
      CONTAINER_DEPTH,
    ]),
  ];
  const found: string[] = [];
  for (const [container, maxDepth] of containers) {
    const head = container ? `${container}/` : '';
    for (const dir of [...skillDirs].sort()) {
      if (!dir.startsWith(head) || found.includes(dir)) continue;
      const parts = dir.slice(head.length).split('/');
      if (
        parts.length > maxDepth ||
        parts.slice(0, -1).some((p) => SKIP_DIRS.has(p))
      )
        continue;
      // The walk stops below a skill it found.
      const isUnderSkill = parts
        .slice(0, -1)
        .some((_, i) => skillDirs.has(head + parts.slice(0, i + 1).join('/')));
      if (!isUnderSkill) found.push(dir);
    }
  }
  if (found.length) return found.map(full);
  return [...skillDirs]
    .filter(
      (dir) =>
        dir.split('/').length <= FALLBACK_DEPTH &&
        !dir.split('/').some((p) => SKIP_DIRS.has(p)),
    )
    .sort()
    .map(full);
}
