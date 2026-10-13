import type { ProfileConfig, ProviderConfig } from '../host/types/settings.ts';
import { authorName, SPACE_ICON_NAMES, type ProfileChange, type Provider, type Space, type SpaceIconName } from '../model.ts';
import { linkedAccountId, profilesUsing, signInCommand } from '../settings/accounts.ts';
import { INSTRUCTIONS_FILE, REDACTED, redactSecrets, stripSecrets, type ConfigChange, type McpEntry, type McpServerDef } from '../settings/agentConfig.ts';
import { HARNESS_IDS, HARNESSES } from '../settings/harnesses.ts';
import type { Approval, Args, ToolContext, ToolSpec } from './tools.ts';

type ProfileToolName = 'list_profiles' | 'get_profile_config' | 'update_profile' | 'link_account' | 'set_profile_instructions' | 'set_mcp_server_enabled' | 'add_mcp_server' | 'set_skill_enabled' | 'remove_mcp_server' | 'remove_profile';

/**
 * Profile tools (RUNTIME.md › Mochi tools): the caller's own profile unless the user approves another on the card. Config
 * writes go through Settings' preview → backup → stale-check path, and nothing here creates, signs in or reads a
 * credential: accounts are only linked, secrets only ever leave as variable names.
 */
export const PROFILE_TOOLS = {
  list_profiles: {
    run: async ({ env, caller }) => {
      const accounts = await env.settings.accounts();
      const logins = new Map(await Promise.all(accounts.accounts.map(async (a) => [a.id, await loginOf(env.settings, a.id)] as const)));
      const accountOf = (spaceId: string, provider: Provider) => {
        const account = accounts.accounts.find((a) => a.id === linkedAccountId(accounts.links, spaceId, provider))!;
        return { id: account.id, name: account.name, login: logins.get(account.id), isOwn: !!accounts.links[spaceId]?.[provider] };
      };
      return {
        result: {
          profiles: env.profiles.list().map((p) => ({
            id: p.id,
            name: p.name,
            icon: p.icon,
            isYours: p.id === caller.spaceId,
            accounts: { claude: accountOf(p.id, 'claude'), codex: accountOf(p.id, 'codex') },
            github: p.github || null,
          })),
          accounts: accounts.accounts.map((a) => ({ id: a.id, provider: a.provider, name: a.name, login: logins.get(a.id) })),
          icons: SPACE_ICON_NAMES,
        },
      };
    },
  },
  get_profile_config: {
    run: async (ctx) => {
      const profile = await reach(ctx, ctx.args.profileId, 'read');
      const config = await ctx.env.settings.agentConfig(profile.id);
      const providers = ctx.args.provider ? [ctx.args.provider] : HARNESS_IDS;
      const entries = await Promise.all(providers.map(async (p) => [p, await providerView(ctx, profile.id, config[p])] as const));
      return { result: { profile: { id: profile.id, name: profile.name }, ...Object.fromEntries(entries) } };
    },
  },
  update_profile: {
    ask: (ctx) => {
      const { profile, changes } = profileEdit(ctx);
      return { title: `Change ${profile.name}'s ${changes.map((c) => c.kind).join(' and ')}?`, detail: ctx.args.reason, changes, notes: elsewhere(ctx, profile), denied: `Kept ${profile.name} as it is` };
    },
    run: (ctx) => {
      const { profile, changes } = profileEdit(ctx);
      ctx.env.profiles.update(profile.id, { ...(ctx.args.name && { name: ctx.args.name }), ...(ctx.args.icon && { icon: ctx.args.icon as SpaceIconName }) });
      const said = changes.map((c) => (c.kind === 'name' ? `renamed ${c.from} to ${c.to}` : `set ${profile.name}'s icon to ${c.to}`));
      return { changed: said.join(' and '), result: { profileId: profile.id, ...(ctx.args.name && { name: ctx.args.name }), ...(ctx.args.icon && { icon: ctx.args.icon }) } };
    },
  },
  link_account: {
    ask: async (ctx) => {
      const { profile, account, current } = await accountLink(ctx);
      const login = await loginOf(ctx.env.settings, account.id);
      const signIn = login.state === 'logged-in' ? `${account.name} is signed in${login.plan ? ` (${login.plan})` : ''}.` : `${account.name} isn't signed in; run ${signInCommand(account)} yourself. Mochi never signs in.`;
      return {
        title: `Run ${profile.name}'s ${HARNESSES[account.provider].name} threads on ${account.name}?`,
        detail: ctx.args.reason,
        changes: [{ kind: 'account', provider: account.provider, from: current.name, to: account.name }],
        notes: [signIn, ...elsewhere(ctx, profile)],
        denied: `Kept ${profile.name} on ${current.name}`,
      };
    },
    run: async (ctx) => {
      const { profile, account } = await accountLink(ctx);
      await ctx.env.settings.linkAccount(profile.id, account.provider, account.id);
      return { changed: `linked ${account.name} to ${profile.name} for ${HARNESSES[account.provider].name}`, result: { profileId: profile.id, provider: account.provider, accountId: account.id } };
    },
  },
  set_profile_instructions: {
    ask: async (ctx) => {
      const { args } = ctx;
      if ((args.text === undefined) === (args.append === undefined)) throw new Error('Pass text (the whole file) or append (lines to add), not both');
      if (args.text?.includes(REDACTED)) throw new Error(`text still holds ${REDACTED} from get_profile_config; append instead, or ask the user to edit the file in Settings`);
      const profile = await reach(ctx, args.profileId, 'write');
      const config = await ctx.env.settings.agentConfig(profile.id);
      // A profile set to sync writes the same text to both files, as Settings › Profiles does.
      const providers = profile.syncInstructions ? HARNESS_IDS : [providerOf(ctx)];
      const changes = providers.map((p): ConfigChange => ({ kind: 'instructions', provider: p, text: args.text ?? appended(config[p].instructions.text, args.append!) }));
      const files = providers.map((p) => INSTRUCTIONS_FILE[p]).join(' and ');
      return configWrite(ctx, profile, changes, { title: `Update ${files} for ${profile.name}?`, denied: `Kept ${files}` });
    },
    run: (ctx) => applyWrite(ctx, 'updated the instructions'),
  },
  set_mcp_server_enabled: {
    ask: async (ctx) => {
      const { args } = ctx;
      const { profile, provider, config } = await configTarget(ctx);
      const server = userServer(config, args.name, profile);
      if (server.enabled === args.enabled) throw new Error(`${args.name} is already ${onOff(args.enabled)}`);
      const label = `MCP server ${args.name}`;
      return configWrite(ctx, profile, [{ kind: 'mcp-enabled', provider, name: args.name, enabled: args.enabled }], {
        title: `Turn ${onOff(args.enabled)} ${label} for ${profile.name}?`,
        changes: [{ kind: 'switch', label: `${label} (${HARNESSES[provider].name})`, from: server.enabled, to: args.enabled }],
        denied: `Kept ${label} ${onOff(server.enabled)}`,
      });
    },
    run: (ctx) => applyWrite(ctx, `turned ${onOff(ctx.args.enabled)} MCP server ${ctx.args.name}`),
  },
  add_mcp_server: {
    ask: async (ctx) => {
      const { args } = ctx;
      const { profile, provider, config } = await configTarget(ctx);
      if (!!args.command === !!args.url) throw new Error('Pass command (a stdio server) or url (an http server), not both');
      if (config.mcpServers.some((s) => s.def.name === args.name)) throw new Error(`${profile.name} already has a server named ${args.name}; pick another name`);
      const server: McpServerDef = { name: args.name, type: args.url ? 'http' : 'stdio', command: args.command, args: args.args, env: args.env, url: args.url, headers: args.headers };
      const { stripped } = stripSecrets(server);
      if (stripped.length)
        throw new Error(`Refused: ${stripped.join(', ')} looks like a secret, and Mochi never takes secrets from agents. Put \${VAR} in its place and ask the user to enter the value in Settings › Profiles.`);
      return configWrite(ctx, profile, [{ kind: 'mcp-set', provider, server }], { title: `Add MCP server ${args.name} to ${profile.name}?`, denied: `Didn't add ${args.name}` });
    },
    run: (ctx) => applyWrite(ctx, `added MCP server ${ctx.args.name}`),
  },
  set_skill_enabled: {
    ask: async (ctx) => {
      const { args } = ctx;
      const { profile, provider, config } = await configTarget(ctx);
      const skill = config.skills.find((s) => s.name === args.name);
      if (!skill) throw new Error(`${profile.name}'s ${HARNESSES[provider].name} account has no skill ${args.name}; get_profile_config lists them`);
      if (skill.enabled === args.enabled) throw new Error(`${args.name} is already ${onOff(args.enabled)}`);
      return configWrite(ctx, profile, [{ kind: 'skill-enabled', provider, name: args.name, enabled: args.enabled }], {
        title: `Turn ${onOff(args.enabled)} the ${args.name} skill for ${profile.name}?`,
        changes: [{ kind: 'switch', label: `Skill ${args.name} (${HARNESSES[provider].name})`, from: skill.enabled, to: args.enabled }],
        denied: `Kept the ${args.name} skill ${onOff(skill.enabled)}`,
      });
    },
    run: (ctx) => applyWrite(ctx, `turned ${onOff(ctx.args.enabled)} the ${ctx.args.name} skill`),
  },
  remove_mcp_server: {
    ask: async (ctx) => {
      const { profile, provider, config } = await configTarget(ctx);
      userServer(config, ctx.args.name, profile);
      return configWrite(ctx, profile, [{ kind: 'mcp-remove', provider, name: ctx.args.name }], {
        title: `Remove MCP server ${ctx.args.name} from ${profile.name}?`,
        isDestructive: true,
        denied: `Kept ${ctx.args.name}`,
      });
    },
    run: (ctx) => applyWrite(ctx, `removed MCP server ${ctx.args.name}`),
  },
  remove_profile: {
    ask: (ctx) => {
      const profile = removable(ctx);
      return {
        title: `Remove the profile ${profile.name}?`,
        detail: 'It leaves the sidebar. Its agent accounts, their config files and its browser data stay on disk.',
        isDestructive: true,
        denied: `Kept ${profile.name}`,
      };
    },
    run: (ctx) => {
      const profile = removable(ctx);
      ctx.env.profiles.remove(profile.id);
      if (ctx.state().spaceId === profile.id) ctx.dispatch({ type: 'space', id: ctx.env.profiles.list()[0].id });
      return { changed: `removed the profile ${profile.name}`, result: { removed: profile.id } };
    },
  },
} satisfies { [K in ProfileToolName]: ToolSpec<K> };

type Ctx<K extends ProfileToolName> = ToolContext<Args<K>>;
type ConfigCtx = ToolContext<{ profileId?: string; provider?: Provider; reason?: string }>;

/**
 * The profile a call acts on. Another profile than the caller's needs the user: writes ask on their own card anyway (it
 * names the profile), a read asks here first.
 */
async function reach(ctx: ToolContext<unknown>, profileId: string | undefined, use: 'read' | 'write') {
  const profile = profileNamed(ctx, profileId);
  if (profile.id === ctx.caller.spaceId || use === 'write') return profile;
  await ctx.confirm({
    title: `Let ${authorName(ctx.caller.providers[0])} read ${profile.name}'s agent setup?`,
    detail: `${profile.name} isn't this thread's profile. It would see that profile's instructions, MCP servers and skills, never secret values.`,
    denied: `Kept ${profile.name}'s setup private`,
  });
  return profile;
}

function profileNamed(ctx: ToolContext<unknown>, profileId: string | undefined) {
  const id = profileId ?? ctx.caller.spaceId;
  const profile = ctx.env.profiles.list().find((p) => p.id === id);
  if (!profile) throw new Error(`No profile ${id}; list_profiles lists them`);
  return profile;
}

/** A note on the card when the call reaches past the caller's own profile. */
function elsewhere(ctx: ToolContext<unknown>, profile: Space) {
  return profile.id === ctx.caller.spaceId ? [] : [`${profile.name} isn't this thread's profile.`];
}

const providerOf = (ctx: ToolContext<{ provider?: Provider }>) => ctx.args.provider ?? ctx.caller.providers[0];

async function configTarget(ctx: ConfigCtx) {
  const profile = await reach(ctx, ctx.args.profileId, 'write');
  const provider = providerOf(ctx);
  const config = (await ctx.env.settings.agentConfig(profile.id))[provider];
  if (config.error) throw new Error(`Couldn't read ${profile.name}'s ${HARNESSES[provider].name} config: ${config.error}`);
  return { profile, provider, config };
}

function userServer(config: ProviderConfig, name: string, profile: Space) {
  const server = config.mcpServers.find((s) => s.def.name === name);
  if (!server) throw new Error(`${profile.name}'s ${HARNESSES[config.provider].name} account has no MCP server ${name}; get_profile_config lists them`);
  if (server.scope !== 'user') throw new Error(`${name} comes from the project's .mcp.json, which Mochi doesn't edit`);
  return server;
}

/** Previews the edits now, so the card shows the real diff; `run` applies exactly them, refused if a file moved since. */
async function configWrite(ctx: ConfigCtx, profile: Space, changes: ConfigChange[], card: Pick<Approval, 'title' | 'denied' | 'changes' | 'isDestructive'>): Promise<Approval> {
  const preview = await ctx.env.settings.previewConfig(profile.id, changes);
  if (!preview.edits.length) throw new Error('Nothing would change; the files already read like that');
  ctx.write = { spaceId: profile.id, changes, befores: Object.fromEntries(preview.edits.map((e) => [e.path, e.before])) };
  const account = (await ctx.env.settings.agentConfig(profile.id))[changes[0].provider].account;
  const sharing = profilesUsing((await ctx.env.settings.accounts()).links, ctx.env.profiles.list().map((p) => p.id), account)
    .filter((id) => id !== profile.id)
    .map((id) => profileNamed(ctx, id).name);
  const notes = [...elsewhere(ctx, profile), ...(sharing.length ? [`${account.name} is shared: ${sharing.join(', ')} ${sharing.length === 1 ? 'gets' : 'get'} this change too.`] : []), ...preview.notes];
  return { ...card, detail: ctx.args.reason ?? '', edits: preview.edits, notes };
}

async function applyWrite(ctx: ConfigCtx, changed: string) {
  const write = ctx.write!;
  const profile = profileNamed(ctx, write.spaceId);
  const { backupDir } = await ctx.env.settings.applyConfig(write.spaceId, write.changes, write.befores);
  return { changed: `${changed} for ${profile.name}`, result: { profileId: profile.id, files: Object.keys(write.befores), backupDir } };
}

function profileEdit(ctx: Ctx<'update_profile'>) {
  const { args } = ctx;
  const profile = profileNamed(ctx, args.profileId);
  if (args.icon && !(SPACE_ICON_NAMES as readonly string[]).includes(args.icon)) throw new Error(`No icon ${args.icon}; use one of ${SPACE_ICON_NAMES.join(', ')}`);
  const changes: ProfileChange[] = [
    ...(args.name && args.name !== profile.name ? [{ kind: 'name' as const, from: profile.name, to: args.name }] : []),
    ...(args.icon && args.icon !== profile.icon ? [{ kind: 'icon' as const, from: profile.icon, to: args.icon as SpaceIconName }] : []),
  ];
  if (!changes.length) throw new Error(args.name || args.icon ? `${profile.name} already looks like that` : 'Pass name, icon, or both');
  return { profile, changes };
}

/** One account per harness per profile, never switched under running threads (RUNTIME.md › Auth). */
async function accountLink(ctx: Ctx<'link_account'>) {
  const { args, env } = ctx;
  const profile = profileNamed(ctx, args.profileId);
  const { accounts, links } = await env.settings.accounts();
  const account = accounts.find((a) => a.id === args.accountId);
  if (!account) throw new Error(`No account ${args.accountId}. Mochi only links existing accounts; the user adds one in Settings › ${HARNESSES[args.provider].name}`);
  if (account.provider !== args.provider) throw new Error(`${account.name} is a ${HARNESSES[account.provider].name} account, not ${HARNESSES[args.provider].name}`);
  const current = accounts.find((a) => a.id === linkedAccountId(links, profile.id, args.provider))!;
  if (current.id === account.id) throw new Error(`${profile.name} already runs ${HARNESSES[args.provider].name} on ${account.name}`);
  if (links[profile.id]?.[args.provider])
    throw new Error(`${profile.name} already has its own ${HARNESSES[args.provider].name} account (${current.name}). A profile keeps one account per harness; only the user changes it, in Settings › Profiles`);
  const active = ctx.state().threads.filter((t) => t.spaceId === profile.id && t.status !== 'settled' && t.providers.includes(args.provider));
  if (active.length) throw new Error(`${active.length} active ${HARNESSES[args.provider].name} ${active.length === 1 ? 'thread runs' : 'threads run'} in ${profile.name} on ${current.name}; Mochi never switches a running thread's account`);
  return { profile, account, current };
}

function removable(ctx: Ctx<'remove_profile'>) {
  const profile = profileNamed(ctx, ctx.args.profileId);
  if (ctx.env.profiles.list().length === 1) throw new Error('That is the last profile; Mochi always keeps one');
  const threads = ctx.state().threads.filter((t) => t.spaceId === profile.id);
  const live = threads.filter((t) => t.status !== 'settled').length;
  if (threads.length) throw new Error(`${profile.name} still has ${threads.length} ${threads.length === 1 ? 'thread' : 'threads'}${live ? ` (${live} live)` : ''}; the user deletes or moves them first`);
  return profile;
}

async function loginOf(settings: Pick<ToolContext['env']['settings'], 'detect'>, accountId: string) {
  return settings.detect(accountId).then(
    ({ login }) => login,
    (e: unknown) => ({ state: 'unknown' as const, reason: e instanceof Error ? e.message : String(e) }),
  );
}

/** What the agent may see of one account's setup: no env or header values, credentials in args and urls masked. */
async function providerView(ctx: ToolContext<unknown>, spaceId: string, config: ProfileConfig[Provider]) {
  const servers = await Promise.all(config.mcpServers.map((s) => serverView(ctx, spaceId, config.provider, s)));
  return {
    account: { id: config.account.id, name: config.account.name },
    instructions: { file: config.instructions.path, text: redactSecrets(config.instructions.text) },
    mcpServers: servers,
    skills: config.skills.map((s) => ({ name: s.name, description: s.description, enabled: s.enabled })),
    ...(config.error && { error: redactSecrets(config.error) }),
  };
}

async function serverView(ctx: ToolContext<unknown>, spaceId: string, provider: Provider, entry: McpEntry) {
  const { def } = stripSecrets(entry.def);
  const tools = entry.enabled && entry.scope === 'user' && !entry.needs.length ? await toolCount(ctx, spaceId, provider, def.name) : { tools: null };
  return {
    name: def.name,
    type: def.type,
    scope: entry.scope,
    enabled: entry.enabled,
    ...(def.command && { command: redactSecrets([def.command, ...(def.args ?? [])].join(' ')) }),
    ...(def.url && { url: def.url }),
    ...(entry.def.env && { envVars: Object.keys(entry.def.env) }),
    ...(entry.def.headers && { headers: Object.keys(entry.def.headers) }),
    ...(entry.needs.length && { needs: entry.needs.map((v) => `needs ${v}`) }),
    ...tools,
  };
}

/** Starts the server the way its tool would (Settings' Test); a server that won't start says why instead of a count. */
async function toolCount(ctx: ToolContext<unknown>, spaceId: string, provider: Provider, name: string) {
  return ctx.env.settings.testMcp(spaceId, provider, name).then(
    ({ tools }) => ({ tools: tools.length }),
    (e: unknown) => ({ tools: null, toolsError: redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 300) }),
  );
}

const appended = (text: string, lines: string) => `${text}${text && !text.endsWith('\n') ? '\n' : ''}${lines.trimEnd()}\n`;

const onOff = (enabled: boolean) => (enabled ? 'on' : 'off');
