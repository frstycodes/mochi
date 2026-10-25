import { connectorName } from '@mochi/domain/library/connectorTools';
import {
  connectorKey,
  OAUTH_PROVIDER_IDS,
} from '@mochi/domain/library/connectors';
import {
  FEATURED_MARKETPLACES,
  libraryEntries,
  ownSkillItem,
  removeItem,
  setItemEnabled,
  skillPlacementDir,
  type LibraryIndex,
  type LibraryItem,
} from '../../library/library.ts';
import { parseSkillSource } from '@mochi/domain/library/skillSource';
import type { LibraryHost } from '../types/library.ts';
import {
  CONNECTOR_TOOLS,
  fixtureParts,
  fixtureSkillFiles,
  MARKETPLACE_CATALOGS,
  SKILL_CATALOGS,
  SKILLS_SH_POPULAR,
  UPLOAD_REVIEW,
} from './libraryFixtures.ts';

// The web build has no agents to load a library into: it browses fixed catalogs and installs into memory, starting
// with a few items in the demo's first profile, so every state of the Library page can be seen and tried.
const DAY = 86_400_000;

let index: LibraryIndex = seed();

const install = (spaceId: string, item: LibraryItem) => {
  index = {
    ...index,
    items: [...index.items.filter((i) => i.id !== item.id), item],
  };
  index = setItemEnabled(index, spaceId, item.id, true);
  return libraryEntries(index, spaceId);
};

export const library: LibraryHost = {
  async list(spaceId) {
    return libraryEntries(index, spaceId);
  },
  async setEnabled(spaceId, id, isEnabled) {
    index = setItemEnabled(index, spaceId, id, isEnabled);
    return libraryEntries(index, spaceId);
  },
  async remove(spaceId, id) {
    index = removeItem(index, id);
    return libraryEntries(index, spaceId);
  },
  async importFromAccount() {
    throw new Error('Importing from an account needs the desktop app');
  },
  async addSkill(spaceId, files) {
    const item = ownSkillItem(
      files,
      `own-${index.items.length + 1}`,
      Date.now(),
    );
    if (
      index.items.some(
        (other) => other.kind === 'skill' && other.name === item.name,
      )
    )
      throw new Error(`Your library already has a skill named ${item.name}`);
    index = setItemEnabled(
      { ...index, items: [...index.items, item] },
      spaceId,
      item.id,
      true,
    );
    return libraryEntries(index, spaceId);
  },
  async discoverSkills(source) {
    await pause();
    return fixtureSkills(source);
  },
  async skillFiles(source, name) {
    await pause();
    const skill = fixtureSkills(source).find((s) => s.name === name);
    if (!skill) throw new Error(`${name} isn't in ${source}`);
    return fixtureSkillFiles(skill.name, skill.description);
  },
  async installSkill(
    spaceId,
    source,
    name,
    destination = { scope: 'library' },
  ) {
    await pause();
    const skill = fixtureSkills(source).find((s) => s.name === name);
    if (!skill) throw new Error(`${name} isn't in ${source}`);
    const placements =
      destination.scope === 'library'
        ? []
        : destination.providers.map((provider) => ({
            provider,
            scope: destination.scope,
            dir: skillPlacementDir(provider, destination.scope, name, {
              home: '~',
              claudeDir: '~/.claude',
              project:
                destination.scope === 'project'
                  ? destination.project
                  : undefined,
            }),
          }));
    const item: LibraryItem = {
      kind: 'skill',
      id: `skill-${name}`,
      name,
      description: skill.description,
      files: {},
      source: skill.source,
      commit: skill.commit,
      placements,
      icon: skill.icon,
      targets: ['claude', 'codex'],
      addedAt: Date.now(),
    };
    if (destination.scope === 'library') return install(spaceId, item);
    index = {
      ...index,
      items: [...index.items.filter((i) => i.id !== item.id), item],
    };
    return libraryEntries(index, spaceId);
  },
  async searchSkillsSh(query) {
    await pause();
    const q = query.trim().toLowerCase();
    return q.length < 2
      ? []
      : SKILLS_SH_POPULAR.filter((s) => s.id.includes(q));
  },
  async popularSkillsSh() {
    await pause();
    return SKILLS_SH_POPULAR;
  },
  async marketplaces() {
    return [...FEATURED_MARKETPLACES, ...index.marketplaces];
  },
  async addMarketplace() {
    throw new Error('Adding a marketplace needs the desktop app');
  },
  async removeMarketplace(name) {
    index = {
      ...index,
      marketplaces: index.marketplaces.filter((m) => m.name !== name),
    };
    return FEATURED_MARKETPLACES;
  },
  async marketplaceCatalog(name) {
    await pause();
    const catalog = MARKETPLACE_CATALOGS[name];
    if (!catalog) throw new Error(`No marketplace named ${name}`);
    return catalog;
  },
  async installPlugin(spaceId, marketplace, name) {
    await pause();
    const plugin = MARKETPLACE_CATALOGS[marketplace]?.plugins.find(
      (p) => p.name === name,
    );
    if (!plugin) throw new Error(`${name} isn't in ${marketplace}`);
    return install(spaceId, pluginItem(marketplace, plugin.name));
  },
  // A file named like an archive gets the fixture review; "no-manifest" in its name shows that error.
  async reviewUpload({ name }) {
    await pause();
    if (!/\.(plugin|zip|tar\.gz|tgz|tar)$/i.test(name))
      throw new Error(
        'Not a plugin archive: upload a .plugin, .zip, .tar.gz or .tgz file',
      );
    if (name.includes('no-manifest'))
      throw new Error(
        'No plugin manifest: a plugin has .claude-plugin/plugin.json (Claude Code) or plugin.json (Codex) at its root',
      );
    const existing = index.items.find(
      (i) => i.kind === 'plugin' && i.bundle.name === UPLOAD_REVIEW.name,
    );
    return {
      ...UPLOAD_REVIEW,
      file: name,
      existing: existing
        ? { id: existing.id, title: UPLOAD_REVIEW.title, isUpload: true }
        : null,
    };
  },
  async installUpload(spaceId, { name }, { sha256, targets, profileIds }) {
    await pause();
    const { title, description, version } = UPLOAD_REVIEW;
    const { skills, subagents, remotes } = fixtureParts(
      UPLOAD_REVIEW.name,
      'development',
    );
    const bundle = {
      name: UPLOAD_REVIEW.name,
      title,
      description,
      version,
      skills,
      subagents,
      hooks: [],
      servers: [],
      remotes,
      files: {},
      unsupported: [],
    };
    const item: LibraryItem = {
      kind: 'plugin',
      id: `plugin-${UPLOAD_REVIEW.name}`,
      bundle,
      marketplace: null,
      upload: { file: name, sha256 },
      icon: null,
      targets,
      addedAt: Date.now(),
    };
    index = {
      ...index,
      items: [...index.items.filter((i) => i.id !== item.id), item],
    };
    for (const profileId of profileIds)
      index = setItemEnabled(index, profileId, item.id, true);
    return libraryEntries(index, spaceId);
  },
  async addConnector(spaceId, { url, alias, name }) {
    await pause();
    const sibling = index.items.find(
      (i) => i.kind === 'connector' && i.key === connectorKey(url),
    );
    return install(
      spaceId,
      connectorItem(
        url,
        alias,
        true,
        name?.trim() ||
          (sibling?.kind === 'connector' ? sibling.title : undefined),
      ),
    );
  },
  onDeviceCode() {
    return () => {};
  },
  onAuthorize() {
    return () => {};
  },
  async runSetup() {
    throw new Error('Setup runs need the desktop app');
  },
  async updateSetupStep() {
    throw new Error('Setup runs need the desktop app');
  },
  async oauthApps() {
    return [...OAUTH_PROVIDER_IDS, 'google' as const];
  },
  async ownAppRedirect() {
    return 'https://mochi-relay.example.workers.dev/oauth/callback';
  },
  async signIn(spaceId, id) {
    await pause();
    index = {
      ...index,
      items: index.items.map((i) =>
        i.id === id && i.kind === 'connector' ? { ...i, isLinked: true } : i,
      ),
    };
    return libraryEntries(index, spaceId);
  },
  async update(spaceId, id, autoUpdate) {
    await pause();
    index = {
      ...index,
      items: index.items.map((i) =>
        i.id !== id
          ? i
          : autoUpdate === undefined
            ? { ...i, updatedAt: Date.now() }
            : { ...i, autoUpdate },
      ),
    };
    return libraryEntries(index, spaceId);
  },
  async renameConnector(spaceId, key, name) {
    index = {
      ...index,
      items: index.items.map((i) =>
        i.kind === 'connector' && i.key === key
          ? { ...i, title: name.trim() }
          : i,
      ),
    };
    return libraryEntries(index, spaceId);
  },
  async connectorSettings() {
    return index.connectors ?? {};
  },
  async listConnectorTools(key) {
    await pause();
    const isLinked = index.items.some(
      (i) => i.kind === 'connector' && i.key === key && i.isLinked,
    );
    const tools = CONNECTOR_TOOLS[key];
    const error = !isLinked
      ? 'No account on it is signed in.'
      : !tools
        ? 'The web preview lists tools only for Linear.'
        : null;
    const toolList = { tools: tools ?? [], listedAt: Date.now(), error };
    index = {
      ...index,
      connectors: {
        ...index.connectors,
        [key]: { ...index.connectors?.[key], toolList },
      },
    };
    return toolList;
  },
  async setConnectorSettings(key, settings) {
    const { toolList } = index.connectors?.[key] ?? {};
    index = {
      ...index,
      connectors: {
        ...index.connectors,
        [key]: { ...settings, ...(toolList && { toolList }) },
      },
    };
    return index.connectors ?? {};
  },
};

const pause = () => new Promise((resolve) => setTimeout(resolve, 400));

// The web build reads its fixture repos the way main reads GitHub: `owner/repo`, a path in it, or `owner/repo@skill`.
function fixtureSkills(source: string) {
  const parsed = parseSkillSource(source);
  const repo = parsed && `${parsed.owner}/${parsed.repo}`;
  const key = parsed && [repo, parsed.path].filter(Boolean).join('/');
  const skills =
    parsed && key && repo
      ? (SKILL_CATALOGS[key] ??
        SKILL_CATALOGS[repo]?.filter((s) => s.source.startsWith(key)))
      : undefined;
  if (!parsed || !skills?.length)
    throw new Error(
      `The web preview only browses ${Object.keys(SKILL_CATALOGS).join(', ')}`,
    );
  const picked = parsed.skill
    ? skills.filter((s) => s.name === parsed.skill)
    : skills;
  if (!picked.length)
    throw new Error(`No skill named ${parsed.skill} in ${repo}`);
  return picked;
}

function pluginItem(marketplace: string, name: string): LibraryItem {
  const plugin = MARKETPLACE_CATALOGS[marketplace].plugins.find(
    (p) => p.name === name,
  )!;
  const { skills, subagents, remotes } = fixtureParts(name, plugin.category);
  const bundle = {
    name,
    title: plugin.title,
    description: plugin.description,
    version: plugin.version,
    skills,
    subagents,
    hooks: [],
    servers: [],
    remotes,
    files: {},
    unsupported: [],
  };
  return {
    kind: 'plugin',
    id: `plugin-${name}`,
    bundle,
    marketplace,
    icon: plugin.icon,
    targets: ['claude', 'codex'],
    addedAt: Date.now(),
  };
}

function connectorItem(
  url: string,
  alias: string,
  isLinked: boolean,
  title = connectorName(url),
): LibraryItem {
  const key = connectorKey(url);
  return {
    kind: 'connector',
    id: `connector-${key}-${alias}`,
    key,
    title,
    url,
    alias,
    isLinked,
    targets: ['claude', 'codex'],
    addedAt: Date.now(),
  };
}

/** The demo's first profile starts with a little of everything, one account signed out and one plugin updated. */
function seed(): LibraryIndex {
  const skills = SKILL_CATALOGS['anthropics/skills'];
  const items: LibraryItem[] = [
    ...['pdf', 'frontend-design'].map((name): LibraryItem => {
      const s = skills.find((k) => k.name === name)!;
      return {
        kind: 'skill',
        id: `skill-${name}`,
        name,
        description: s.description,
        files: {},
        source: s.source,
        icon: s.icon,
        targets: ['claude', 'codex'],
        addedAt: Date.now() - 9 * DAY,
      };
    }),
    {
      ...pluginItem('claude-plugins-official', 'code-review'),
      updatedAt: Date.now() - 2 * DAY,
    },
    pluginItem('claude-plugins-official', 'linear'),
    connectorItem('https://mcp.linear.app/mcp', 'work', true),
    connectorItem('https://mcp.linear.app/mcp', 'personal', true),
    connectorItem('https://mcp.notion.com/mcp', 'work', false),
  ];
  return {
    items,
    profiles: { latitude: items.map((i) => i.id) },
    marketplaces: [],
  };
}
