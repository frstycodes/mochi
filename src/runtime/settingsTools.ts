import type { ProviderConfig } from '../host/types/settings.ts';
import { authorName, settingRef, type Provider, type Space } from '../model.ts';
import { linkedAccountId, profilesUsing } from '../settings/accounts.ts';
import { redactSecrets, stripSecrets, type ConfigChange, type McpEntry, type McpServerDef } from '../settings/agentConfig.ts';
import { findSetting, settingsCatalog, valueLabel, type Setting, type SettingSources } from '../settings/catalog.ts';
import { HARNESSES } from '../settings/harnesses.ts';
import { bindingOf, checkBinding, chordText, COMMAND_IDS, COMMANDS, defaultKeys, FIXED_KEYS, isCommandId, isCustom, parseChord, type CommandId } from '../keymap.ts';
import { IS_MAC } from '../keys.ts';
import { appProviderFor, CONNECTORS, connectorFor, freeAlias, isSameServer } from '../library/connectors.ts';
import { BUILT_IN_RECIPES, type SetupResult, type SetupTarget } from '../library/recipes.ts';
import { openInNewTab, refView, tabView } from './browserTools.ts';
import { ownAppSetup } from '../library/ownApps.ts';
import { MOCHI_THEME_ID, slotOf } from '../themes/model.ts';
import { card, cardId, open, type Approval, type Args, type ToolContext, type ToolSpec } from './tools.ts';

type SettingsToolName = 'get_settings' | 'update_settings' | 'get_keybindings' | 'set_keybinding' | 'list_profiles' | 'add_mcp_server' | 'list_connectors' | 'connect_account' | 'run_setup' | 'update_setup_step' | 'remove_mcp_server' | 'remove_profile';

/**
 * Settings tools (RUNTIME.md › Mochi tools). Reads go through the settings catalog; a suggestion opens one live settings
 * widget in the caller's thread and returns, so only the user ever sets anything. Deletes wait on their card and take
 * Settings' preview → backup → stale-check path. No tool creates, signs in or reads an account's login, and secrets only
 * ever leave as variable names.
 */
export const SETTINGS_TOOLS = {
  get_settings: {
    run: async (ctx) => {
      const { section, profileId } = ctx.args;
      const profile = await reach(ctx, profileId);
      const sources = await sourcesFor(ctx, profile);
      // Shortcuts have their own pair of tools, which check clashes; listed here only when asked for.
      const catalog = settingsCatalog({ profile, config: sources.config }).filter((s) => (section ? s.section === section : s.section !== 'keyboard'));
      const settings = await Promise.all(catalog.map((s) => settingView(ctx, s, sources, section === 'profile')));
      return { result: { profile: { id: profile.id, name: profile.name }, settings } };
    },
  },
  update_settings: {
    run: async (ctx) => {
      const { args, caller } = ctx;
      const loaded = new Map<string, Promise<{ sources: SettingSources; catalog: Setting[] }>>();
      const load = (profile: Space) => {
        if (!loaded.has(profile.id)) loaded.set(profile.id, sourcesFor(ctx, profile).then((sources) => ({ sources, catalog: settingsCatalog({ profile, config: sources.config }) })));
        return loaded.get(profile.id)!;
      };
      const changes: { key: string; value: string; profileId?: string }[] = [];
      const before: Record<string, string> = {};
      const labels: string[] = [];
      for (const change of args.changes) {
        const isProfileKey = change.key.startsWith('profile.');
        if (!isProfileKey && change.profileId) throw new Error(`${change.key} isn't a profile setting; leave profileId out`);
        const profile = profileNamed(ctx, change.profileId);
        const { sources, catalog } = await load(profile);
        const setting = findSetting(catalog, change.key);
        if (!setting) throw new Error(`No setting ${change.key}${isProfileKey ? ` in ${profile.name}` : ''}; get_settings lists them`);
        if (setting.locked) throw new Error(`${setting.label} is the user's alone: ${setting.locked}`);
        if (setting.control.type === 'shortcut') throw new Error(`${change.key} is a shortcut; suggest it with set_keybinding, which checks clashes and reserved chords`);
        const current = setting.read(sources);
        if (current === undefined) throw new Error(`${setting.label} can't be read here, so it can't be suggested (it needs the desktop app)`);
        if (!setting.write(change.value, sources)) throw new Error(`"${change.value}" isn't a value of ${change.key}${allowedHint(setting)}`);
        if (current === change.value) throw new Error(`${setting.label} is already ${valueLabel(setting, current)}`);
        await checkSuggestion(ctx, setting, change.value, profile, sources);
        const row = { key: change.key, value: change.value, ...(isProfileKey && { profileId: profile.id }) };
        if (changes.some((c) => settingRef(c) === settingRef(row))) throw new Error(`${change.key} appears twice; suggest one value`);
        changes.push(row);
        before[settingRef(row)] = current;
        labels.push(isProfileKey && profile.id !== caller.spaceId ? `${setting.label} (${profile.name})` : setting.label);
      }
      const by = caller.providers[0];
      const title = changes.length === 1 ? `${authorName(by)} suggests changing ${labels[0]}` : `${authorName(by)} suggests ${changes.length} setting changes`;
      open(ctx, card(ctx, cardId('setting', caller.id), 'setting', { title, detail: args.reason, settings: { by, reason: args.reason, changes, before } }));
      return { result: { shown: labels, note: SHOWN_NOTE } };
    },
  },
  get_keybindings: {
    run: ({ env }) => {
      const overrides = env.prefs.get().keybindings;
      return {
        result: {
          platform: IS_MAC ? 'macOS' : 'Windows or Linux',
          commands: COMMAND_IDS.map((id) => ({ id, title: COMMANDS[id].title, group: COMMANDS[id].group, scope: COMMANDS[id].scope, keys: chordText(bindingOf(id, overrides)), default: chordText(defaultKeys(id)), isCustom: isCustom(id, overrides) })),
          fixed: FIXED_KEYS.map(({ keys, what }) => ({ keys: chordText(keys), what })),
          reserved: RESERVED_NOTE,
        },
      };
    },
  },
  set_keybinding: {
    run: (ctx) => {
      const { args, caller, env } = ctx;
      const { command, onConflict } = args;
      if (!isCommandId(command)) throw new Error(`No command ${command}; get_keybindings lists them`);
      const keys = args.keys.trim() === '' ? null : parseChord(args.keys);
      if (args.keys.trim() !== '' && !keys) throw new Error(`"${args.keys}" isn't a chord: modifiers from mod, nav, alt, shift, then one key, joined by +, like "mod+shift+K"`);
      const overrides = env.prefs.get().keybindings;
      const current = bindingOf(command, overrides);
      if (chordText(current) === chordText(keys)) throw new Error(`${COMMANDS[command].title} is already ${keys ? chordText(keys) : 'without a shortcut'}`);
      const check = checkBinding(command, keys, overrides);
      if (!check.ok && 'reason' in check) throw new Error(`${chordText(keys)} is reserved: ${check.reason}`);
      const holder = check.ok ? undefined : check.conflict;
      if (holder && !onConflict) throw new Error(`${chordText(keys)} is already used by ${COMMANDS[holder].title} (${holder}); pass onConflict "swap" (it gets ${chordText(current) || 'no shortcut'}) or "replace" (it loses its shortcut)`);
      const changes = [{ key: `keybinding.${command}`, value: chordText(keys) }, ...(holder ? [{ key: `keybinding.${holder}`, value: onConflict === 'swap' ? chordText(current) : '' }] : [])];
      const before = Object.fromEntries(changes.map((c) => [c.key, chordText(bindingOf(c.key.slice('keybinding.'.length) as CommandId, overrides))]));
      const by = caller.providers[0];
      const target = `${keys ? 'a new shortcut' : 'removing the shortcut'} for ${COMMANDS[command].title}`;
      open(ctx, card(ctx, cardId('setting', caller.id), 'setting', { title: `${authorName(by)} suggests ${target}`, detail: args.reason, settings: { by, reason: args.reason, changes, before } }));
      return { result: { shown: changes.map((c) => c.key), note: SHOWN_NOTE } };
    },
  },
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
        },
      };
    },
  },
  add_mcp_server: {
    run: async (ctx) => {
      const { args, caller } = ctx;
      const { profile, provider, config } = await configTarget(ctx);
      if (!!args.command === !!args.url) throw new Error('Pass command (a stdio server) or url (an http server), not both');
      if (config.mcpServers.some((s) => s.def.name === args.name)) throw new Error(`${profile.name} already has a server named ${args.name}; pick another name`);
      const server: McpServerDef = { name: args.name, type: args.url ? 'http' : 'stdio', command: args.command, args: args.args, env: args.env, url: args.url, headers: args.headers };
      const { stripped } = stripSecrets(server);
      if (stripped.length) throw new Error(`Refused: ${stripped.join(', ')} looks like a secret, and Mochi never takes secrets from agents. Put \${VAR} in its place; the user sets the variable.`);
      const by = caller.providers[0];
      const title = `${authorName(by)} suggests adding MCP server ${args.name}${profile.id === caller.spaceId ? '' : ` to ${profile.name}`}`;
      open(ctx, card(ctx, cardId('setting', caller.id), 'setting', { title, detail: args.reason, settings: { by, reason: args.reason, changes: [], addServer: { profileId: profile.id, provider, server }, before: {} } }));
      return { result: { shown: [`MCP server ${args.name}`], note: SHOWN_NOTE } };
    },
  },
  list_connectors: {
    run: async (ctx) => {
      const profile = profileNamed(ctx, ctx.args.profileId);
      const [entries, apps, redirectUrl] = await Promise.all([ctx.env.library.list(profile.id), ctx.env.library.oauthApps(), ctx.env.library.ownAppRedirect()]);
      const directory = CONNECTORS.map(({ id, name, description, serverUrl }) => {
        const provider = appProviderFor(serverUrl);
        const needsOwnApp = !!provider && !apps.includes(provider);
        return { id, name, description, ...(needsOwnApp && { needsOwnApp, setup: ownAppSetup(id, redirectUrl) }) };
      });
      return {
        result: {
          accounts: entries.flatMap((e) => (e.kind === 'connector' ? [{ service: e.title, url: e.source, account: e.alias, isSignedIn: e.isLinked, isOnProfile: e.isEnabled }] : [])),
          directory,
        },
      };
    },
  },
  connect_account: {
    run: async (ctx) => {
      const { args, env } = ctx;
      const profile = profileNamed(ctx, args.profileId);
      const url = connectorUrl(args.connector);
      const name = connectorFor(url)?.name ?? new URL(url).hostname;
      const taken = (await env.library.list(profile.id)).flatMap((e) => (e.kind === 'connector' && !!e.alias && !!e.source && isSameServer(e.source, url) ? [e.alias] : []));
      const alias = args.alias ?? freeAlias(taken);
      if (taken.includes(alias)) throw new Error(`There is already a ${alias} account on ${name}; list_connectors lists them`);
      if (args.clientId && looksLikeSecret(args.clientId)) throw new Error('That looks like a client secret, not a Client ID. Never pass the secret itself: pass secretRef and Mochi reads it');
      if (args.configTokenRef && appProviderFor(url) !== 'slack') throw new Error('configTokenRef is for Slack only');
      if (args.fromSetup && !['slack', 'google'].includes(appProviderFor(url) ?? '')) throw new Error('fromSetup is for Slack and Google Workspace only');
      const needsSecret = !!args.clientId && appProviderFor(url) !== 'github';
      if (needsSecret && !args.secretRef) throw new Error('Pass secretRef: the ref of the Client Secret on the page, from browser_snapshot (reveal it first if it is hidden). Mochi reads it itself; you never see it');
      const secretFrom = args.secretRef ? { viewId: refView(ctx, args.secretRef, args.tabId), ref: args.secretRef } : undefined;
      const account = `${name} (${alias})`;
      const page = signInPage(env, url);
      const slackTokenFrom = args.configTokenRef ? { viewId: refView(ctx, args.configTokenRef, args.tabId), ref: args.configTokenRef } : undefined;
      const connecting = env.library.addConnector(profile.id, { url, alias, ...(args.clientId && { clientId: args.clientId }) }, { inPane: true, ...(secretFrom && { secretFrom }), ...(slackTokenFrom && { slackTokenFrom }), ...(args.fromSetup && { fromSetup: true }) });
      // The sign-in goes on after this call returns, while the agent works the page; its end shows in the thread.
      let isHandedOff = false;
      void connecting.then(
        () => isHandedOff && say(ctx, `Connected ${account}`),
        (error: unknown) => isHandedOff && say(ctx, `Couldn't connect ${account}: ${error instanceof Error ? error.message : String(error)}`),
      );
      const slow = timeout(SIGN_IN_START_MS);
      const first = await Promise.race([page.next, connecting.then(() => null), slow.done.then(() => 'slow' as const)]).finally(() => (page.stop(), slow.cancel()));
      if (first === null) return { changed: `connected ${account}`, result: { account: alias, isSignedIn: true } };
      isHandedOff = true;
      if (first === 'slow') return { changed: `started connecting ${account}`, result: { account: alias, note: `${name} is still starting; call list_connectors in a minute` } };
      const tab = await openInNewTab(ctx, first.url);
      return {
        changed: `opened ${name}'s sign-in page`,
        result: { account: alias, ...tab, ...('userCode' in first && { userCode: first.userCode }), next: 'userCode' in first ? CODE_NEXT : SIGN_IN_NEXT },
      };
    },
  },
  run_setup: {
    run: async (ctx) => {
      const { args, env } = ctx;
      const recipe = BUILT_IN_RECIPES[args.connector];
      const start = recipe?.steps.find((s) => s.kind === 'goto');
      if (!recipe || !start || start.kind !== 'goto') throw new Error(`Mochi has no setup recipe for ${args.connector}; list_connectors gives its manual steps`);
      const viewId = await tabView(ctx, args.tabId, start.url);
      let params = args.params ?? {};
      let fromStep = args.fromStep;
      // A value only the user knows (which workspace) is asked on Mochi's own card, and the run goes on from that step.
      for (let asked = 0; ; asked++) {
        const result = await env.library.runSetup(args.connector, viewId, { params, ...(fromStep && { fromStep }) });
        // With nothing to pick from (which Google account), the agent asks in chat instead.
        if (result.status !== 'needs' || !result.options.length || asked === MAX_QUESTIONS) return { changed: `ran ${args.connector}'s setup`, isFinal: true, result: { ...result, next: setupNext(args.connector, result) } };
        params = { ...params, [result.param]: await ctx.choose({ title: result.question, options: result.options }) };
        fromStep = result.stepId;
      }
    },
  },
  update_setup_step: {
    run: async (ctx) => {
      const { connector, stepId, target } = ctx.args;
      const { before, after } = await ctx.env.library.updateSetupStep(connector, stepId, target);
      const changed = `updated ${connector}'s setup step "${stepId}": ${describeTarget(before)} → ${describeTarget(after)}`;
      return { changed, isFinal: true, result: { stepId, before, after } };
    },
  },
  remove_mcp_server: {
    ask: async (ctx) => {
      const { profile, provider, config } = await configTarget(ctx);
      if (!config.mcpServers.some((s) => s.def.name === ctx.args.name && s.scope === 'user')) throw new Error(`${profile.name}'s ${HARNESSES[provider].name} account has no MCP server ${ctx.args.name}; get_settings lists them`);
      return configWrite(ctx, profile, [{ kind: 'mcp-remove', provider, name: ctx.args.name }], { title: `Remove MCP server ${ctx.args.name} from ${profile.name}?`, isDestructive: true, denied: `Kept ${ctx.args.name}` });
    },
    run: async (ctx) => {
      const write = ctx.write!;
      const profile = profileNamed(ctx, write.spaceId);
      const { backupDir } = await ctx.env.settings.applyConfig(write.spaceId, write.changes, write.befores);
      return { changed: `removed MCP server ${ctx.args.name} from ${profile.name}`, result: { profileId: profile.id, files: Object.keys(write.befores), backupDir } };
    },
  },
  remove_profile: {
    ask: (ctx) => {
      const profile = removable(ctx);
      return { title: `Remove the profile ${profile.name}?`, detail: 'It leaves the sidebar. Its agent accounts, their config files and its browser data stay on disk.', isDestructive: true, denied: `Kept ${profile.name}` };
    },
    run: (ctx) => {
      const profile = removable(ctx);
      ctx.env.profiles.remove(profile.id);
      if (ctx.state().spaceId === profile.id) ctx.dispatch({ type: 'space', id: ctx.env.profiles.list()[0].id });
      return { changed: `removed the profile ${profile.name}`, result: { removed: profile.id } };
    },
  },
} satisfies { [K in SettingsToolName]: ToolSpec<K> };

const RESERVED_NOTE = IS_MAC
  ? 'Refused on macOS: mod+Q, mod+H, mod+alt+H, mod+M, mod+Tab, mod+`, mod+Space, nav+Space, nav+left/right/up/down (Mission Control), mod+shift+3/4/5, Copy, Paste, Cut, Select all, Undo, Redo; and a chord without mod, nav or alt unless it ends in a letter, digit or F-key'
  : 'Refused on Windows and Linux: nav+Tab, nav+F4, nav+Space, mod+alt+Delete, Copy, Paste, Cut, Select all, Undo, Redo (mod+Y too); the Windows key; and a chord without mod, nav or alt unless it ends in a letter, digit or F-key';

const SHOWN_NOTE = "The user sees these as live settings in your thread and changes them there if they want. You won't get their answer; get_settings reads the values later.";

const SIGN_IN_NEXT = "Approve on this page in your tab: pick the account if asked and click Allow, Continue or Approve (for a Google project of the user's own, Advanced, then Go to Mochi, is expected: say so in chat). Then call list_connectors until the account isSignedIn. Ask the user in chat only to sign in to the site or choose between accounts.";
const CODE_NEXT = 'Type userCode on this page in your tab and approve, then call list_connectors until the account isSignedIn.';
// The local Google Workspace server's first start downloads Python and its packages.
const SIGN_IN_START_MS = 3 * 60_000;
function timeout(ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return { done: new Promise((resolve) => (timer = setTimeout(resolve, ms))), cancel: () => clearTimeout(timer) };
}

/** The first sign-in page (or one-time code) main sends for `url`'s connect; `stop` unsubscribes. */
function signInPage(env: ToolContext<unknown>['env'], url: string) {
  let resolve!: (page: { url: string } | { url: string; userCode: string }) => void;
  const next = new Promise<{ url: string } | { url: string; userCode: string }>((r) => (resolve = r));
  const offPage = env.library.onAuthorize((p) => p.url === url && resolve({ url: p.authorizationUrl }));
  const offCode = env.library.onDeviceCode((c) => c.url === url && resolve({ url: c.verificationUri, userCode: c.userCode }));
  return { next, stop: () => (offPage(), offCode()) };
}

const MAX_QUESTIONS = 3;

/** What the agent does after a setup run, in its words. */
function setupNext(connector: string, result: SetupResult) {
  if (result.status === 'done') return `connect_account with connector "${connector}", an account name and fromSetup: true`;
  if (result.status === 'needs') return `Ask the user in chat: ${result.question}${result.options.length ? ` (${result.options.join(', ')})` : ''}. Then run_setup again with params.${result.param} set to their answer`;
  return `${stoppedNext(result)}. Pass params ${JSON.stringify(result.params)} each time, so the run keeps the same project instead of making another`;
}

function stoppedNext(result: Extract<SetupResult, { status: 'stopped' }>) {
  if (result.isExpected) return `${result.reason} Tell the user in chat, ask for what it needs, then run_setup again with it`;
  if (result.kind === 'goto' || /left .*sign in/.test(result.reason)) return `${result.reason}. Ask the user to sign in in this tab, then run_setup again`;
  const fix = `update_setup_step with the role and name of the element that worked`;
  if (result.kind === 'capture') return `Find the element for "${result.stepId}" (${result.note}) with browser_snapshot, ${fix}, then run_setup with fromStep "${result.stepId}"`;
  const then = result.nextStepId ? `run_setup with fromStep "${result.nextStepId}"` : `connect_account with fromSetup: true`;
  return `Do step "${result.stepId}" (${result.note}) yourself in this tab (browser_snapshot, then act), then ${fix}, then ${then}`;
}

const describeTarget = (t: SetupTarget): string => `${t.role} "${t.name}"${t.within ? ` in ${describeTarget(t.within)}` : ''}`;

function say(ctx: ToolContext<unknown>, text: string) {
  ctx.dispatch({ type: 'say', threadId: ctx.caller.id, entry: { who: ctx.caller.providers[0], kind: 'event', text } });
}

type Ctx<K extends SettingsToolName> = ToolContext<Args<K>>;

// Google's secrets start GOCSPX-, Slack's are 32 hex digits; their client IDs look like neither.
const looksLikeSecret = (value: string) => value.startsWith('GOCSPX-') || /^[0-9a-f]{32}$/i.test(value);

/** A directory id's server, else an https URL as given. */
function connectorUrl(connector: string) {
  const known = CONNECTORS.find((c) => c.id === connector);
  if (known) return known.serverUrl;
  if (URL.canParse(connector) && new URL(connector).protocol === 'https:') return connector;
  throw new Error(`${connector} is neither a directory id (list_connectors lists them) nor an https URL`);
}

/** Everything a setting's value can live in, read now. Host settings and accounts are main's; a profile's files only when asked. */
async function sourcesFor(ctx: ToolContext<unknown>, profile: Space): Promise<SettingSources> {
  const { env } = ctx;
  const [host, accounts, config, colorThemes, remote] = await Promise.all([
    env.settings.get().catch(() => undefined),
    env.settings.accounts().catch(() => undefined),
    env.settings.agentConfig(profile.id).catch(() => undefined),
    env.themes.list().catch(() => undefined),
    env.remote.status().then((s) => s.settings, () => undefined),
  ]);
  return { prefs: env.prefs.get(), theme: env.theme(), quiet: ctx.state().notifications.quiet, host: env.isDesktop ? host : undefined, profile, accounts, config, colorThemes, remote: env.isDesktop ? remote : undefined };
}

/** Another profile than the caller's: its settings show only after the user lets the agent see them. */
async function reach(ctx: ToolContext<unknown>, profileId: string | undefined) {
  const profile = profileNamed(ctx, profileId);
  if (profile.id === ctx.caller.spaceId) return profile;
  await ctx.confirm({
    title: `Let ${authorName(ctx.caller.providers[0])} read ${profile.name}'s settings?`,
    detail: `${profile.name} isn't this thread's profile. It would see that profile's accounts, instructions, MCP servers and skills, never secret values.`,
    denied: `Kept ${profile.name}'s settings private`,
  });
  return profile;
}

function profileNamed(ctx: ToolContext<unknown>, profileId: string | undefined) {
  const id = profileId ?? ctx.caller.spaceId;
  const profile = ctx.env.profiles.list().find((p) => p.id === id);
  if (!profile) throw new Error(`No profile ${id}; list_profiles lists them`);
  return profile;
}

/** One setting as the agent reads it: never a secret, instructions with credentials masked. */
async function settingView(ctx: ToolContext<unknown>, setting: Setting, sources: SettingSources, withToolCounts: boolean) {
  const { control } = setting;
  const value = setting.read(sources);
  const view = {
    key: setting.key,
    label: setting.label,
    section: setting.section,
    ...(setting.group && { group: setting.group }),
    type: control.type,
    value: value ?? null,
    ...('options' in control && { allowed: control.options.map((o) => o.value) }),
    ...(control.type === 'number' && { min: control.min, max: control.max }),
    ...(control.type === 'colorTheme' && { allowed: [MOCHI_THEME_ID, ...(sources.colorThemes ?? []).filter((t) => slotOf(t.kind) === control.slot).map((t) => t.id)] }),
    ...((control.type === 'switch' || control.type === 'mcp' || control.type === 'skill') && { allowed: ['true', 'false'] }),
    ...(setting.description && { description: setting.description }),
    ...(setting.locked && { locked: setting.locked }),
  };
  if (control.type !== 'mcp') return view;
  const entry = sources.config?.[control.provider].mcpServers.find((s) => s.def.name === control.name);
  return entry ? { ...view, server: await serverView(ctx, sources.profile!.id, control.provider, entry, withToolCounts) } : view;
}

async function serverView(ctx: ToolContext<unknown>, spaceId: string, provider: Provider, entry: McpEntry, withToolCounts: boolean) {
  const { def } = stripSecrets(entry.def);
  const isStartable = withToolCounts && entry.enabled && !entry.needs.length;
  return {
    type: def.type,
    ...(def.command && { command: redactSecrets([def.command, ...(def.args ?? [])].join(' ')) }),
    ...(def.url && { url: def.url }),
    ...(entry.def.env && { envVars: Object.keys(entry.def.env) }),
    ...(entry.def.headers && { headers: Object.keys(entry.def.headers) }),
    ...(entry.needs.length && { needs: entry.needs.map((v) => `needs ${v}`) }),
    ...(isStartable && (await toolCount(ctx, spaceId, provider, def.name))),
  };
}

/** Starts the server the way its tool would (Settings' Test); one that won't start says why instead of a count. */
async function toolCount(ctx: ToolContext<unknown>, spaceId: string, provider: Provider, name: string) {
  return ctx.env.settings.testMcp(spaceId, provider, name).then(
    ({ tools }) => ({ tools: tools.length }),
    (e: unknown) => ({ tools: null, toolsError: redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 300) }),
  );
}

const allowedHint = (setting: Setting) => {
  const { control } = setting;
  if ('options' in control) return `; allowed: ${control.options.map((o) => o.value).join(', ')}`;
  if (control.type === 'number') return `; a whole number from ${control.min} to ${control.max}`;
  if (control.type === 'switch' || control.type === 'mcp' || control.type === 'skill') return '; "true" or "false"';
  return '';
};

/** Rules a valid value can still break: accounts are never switched under running threads, model ids come from the account. */
async function checkSuggestion(ctx: ToolContext<unknown>, setting: Setting, value: string, profile: Space, sources: SettingSources) {
  const { control } = setting;
  if (control.type === 'account') return checkAccount(ctx, profile, control.provider, sources);
  if (control.type === 'model' && value) {
    const [provider, model] = control.provider ? [control.provider, value] : [value.split(':')[0] as Provider, value.split(':').slice(1).join(':')];
    const models = await ctx.env.models(provider, ctx.caller.spaceId);
    if (models.length && !models.some((m) => m.id === model)) throw new Error(`${model} isn't offered on this profile's ${HARNESSES[provider].name} account; use one of ${models.map((m) => m.id).join(', ')}`);
  }
}

/** One account per harness per profile, never switched under running threads (RUNTIME.md › Auth). */
function checkAccount(ctx: ToolContext<unknown>, profile: Space, provider: Provider, sources: SettingSources) {
  const name = HARNESSES[provider].name;
  const current = sources.accounts?.accounts.find((a) => a.id === linkedAccountId(sources.accounts!.links, profile.id, provider));
  if (sources.accounts?.links[profile.id]?.[provider])
    throw new Error(`${profile.name} already has its own ${name} account (${current?.name}). A profile keeps one account per harness; only the user changes it`);
  const active = ctx.state().threads.filter((t) => t.spaceId === profile.id && t.status !== 'settled' && t.providers.includes(provider));
  if (active.length) throw new Error(`${active.length} active ${name} ${active.length === 1 ? 'thread runs' : 'threads run'} in ${profile.name} on ${current?.name}; Mochi never switches a running thread's account`);
}

async function configTarget(ctx: Ctx<'add_mcp_server' | 'remove_mcp_server'>) {
  const profile = profileNamed(ctx, ctx.args.profileId);
  const provider = ctx.args.provider ?? ctx.caller.providers[0];
  const config: ProviderConfig = (await ctx.env.settings.agentConfig(profile.id))[provider];
  if (config.error) throw new Error(`Couldn't read ${profile.name}'s ${HARNESSES[provider].name} config: ${config.error}`);
  return { profile, provider, config };
}

/** Previews the edits now, so the card shows the real diff; `run` applies exactly them, refused if a file moved since. */
async function configWrite(ctx: Ctx<'remove_mcp_server'>, profile: Space, changes: ConfigChange[], approval: Pick<Approval, 'title' | 'denied' | 'isDestructive'>): Promise<Approval> {
  const preview = await ctx.env.settings.previewConfig(profile.id, changes);
  if (!preview.edits.length) throw new Error('Nothing would change; the files already read like that');
  ctx.write = { spaceId: profile.id, changes, befores: Object.fromEntries(preview.edits.map((e) => [e.path, e.before])) };
  const account = (await ctx.env.settings.agentConfig(profile.id))[changes[0].provider].account;
  const sharing = profilesUsing((await ctx.env.settings.accounts()).links, ctx.env.profiles.list().map((p) => p.id), account)
    .filter((id) => id !== profile.id)
    .map((id) => profileNamed(ctx, id).name);
  const notes = [
    ...(profile.id === ctx.caller.spaceId ? [] : [`${profile.name} isn't this thread's profile.`]),
    ...(sharing.length ? [`${account.name} is shared: ${sharing.join(', ')} ${sharing.length === 1 ? 'loses' : 'lose'} it too.`] : []),
    ...preview.notes,
  ];
  return { ...approval, detail: '', edits: preview.edits, notes };
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
