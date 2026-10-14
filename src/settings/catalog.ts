import { hourLabel, type QuietHours } from '../notify/model.ts';
import { ALERT_KINDS } from '../notify/model.ts';
import { SPACE_ICON_NAMES, type Provider, type Space } from '../model.ts';
import { SHARED_ACCESS } from '../runtime/access.ts';
import { EFFORTS } from '../runtime/controls.ts';
import { effortName } from '../runtime/models.ts';
import type { RemoteSettings } from '../host/types/remote.ts';
import { MOCHI_THEME_ID, slotOf, type ColorTheme, type ThemeSlot } from '../themes/model.ts';
import { UTILITY_TASK_LABELS, UTILITY_TASKS } from '../utility/prompts.ts';
import { CONCURRENCY_RANGE, type AccountsState, type AgentSettings, type AgentSettingsPatch, type ModelChoice, type ProfileConfig } from '../host/types/settings.ts';
import { linkedAccountId } from './accounts.ts';
import { INSTRUCTIONS_FILE, type ConfigChange } from './agentConfig.ts';
import { HARNESS_IDS, HARNESSES } from './harnesses.ts';
import { bindingOf, chordText, COMMAND_IDS, COMMANDS, parseChord, rebind, type CommandId } from '../keymap.ts';
import { shortcutText } from '../keys.ts';
import { DEFAULT_PREFS, type Prefs } from './prefs.ts';
import type { SettingSection } from './settingSections.ts';
import { AGENT_CONTROL, AGENTS, BRANCH_FROM, DIFF_STYLES, ENGINES, MOTION, SPEEDS, THREAD_MODELS, WHILE_WORKING, WORKSPACE_MODES, WORKTREE_CLEANUP } from './settingOptions.ts';

/**
 * Every setting in Mochi, once: its label, its control, where its value lives, and how a value is read and written.
 * Settings › sections and the settings widget in a thread both draw rows from it (`CatalogRow`), and the agent's
 * `get_settings` / `update_settings` read and propose through it. Values travel as strings: "true"/"false" for switches,
 * an option's value, a number, or free text.
 */
export interface Setting {
  key: string;
  label: string;
  section: SettingSection;
  description?: string;
  /** What the row needs to say outside its section, where the group title is missing (a settings widget). */
  context?: string;
  control: Control;
  /** The value as a string; undefined while its source isn't loaded (host settings on the web build, a profile's files). */
  read: (s: SettingSources) => string | undefined;
  /** What setting `value` writes, or null when it isn't a value this setting takes. */
  write: (value: string, s: SettingSources) => SettingWrite | null;
  /** Why an agent can't propose it; it still shows, read-only to the agent. */
  locked?: string;
}

/** `tone: 'warning'` marks an option that must never be on unnoticed (Full access). */
type Option = { readonly value: string; readonly label: string; readonly tone?: 'warning' };

export type Control =
  | { type: 'choice' | 'select'; options: readonly Option[] }
  | { type: 'switch' }
  | { type: 'number'; min: number; max: number; step: number }
  /** `fallback` is what an emptied field saves; without it, empty is a value of its own ("use $SHELL"). */
  | { type: 'text'; placeholder: string; fallback?: string; isPath?: boolean; isMono?: boolean; isMultiline?: boolean }
  /** A model id; `provider` limits it to one harness, else the value is `provider:model`. */
  | { type: 'model'; provider?: Provider; emptyLabel?: string }
  | { type: 'starredModels' }
  | { type: 'colorTheme'; slot: ThemeSlot }
  | { type: 'simulator' }
  | { type: 'icon' }
  | { type: 'github' }
  | { type: 'account'; provider: Provider }
  | { type: 'instructions'; provider: Provider }
  | { type: 'mcp'; provider: Provider; name: string }
  | { type: 'skill'; provider: Provider; name: string }
  /** A command's chord as `chordText` writes it; '' is no shortcut. */
  | { type: 'shortcut'; command: CommandId };

/** Everything a value can live in. Optional parts aren't loaded everywhere (the web build has no host settings). */
export interface SettingSources {
  prefs: Prefs;
  theme: string;
  quiet: QuietHours;
  host?: AgentSettings;
  profile?: Space;
  accounts?: AccountsState;
  config?: ProfileConfig;
  /** Installed color themes; while unread, any theme id is taken. */
  colorThemes?: Pick<ColorTheme, 'id' | 'label' | 'kind'>[];
  remote?: RemoteSettings;
}

export type SettingWrite =
  | { to: 'prefs'; patch: Partial<Prefs> }
  | { to: 'theme'; theme: string }
  | { to: 'quiet'; patch: Partial<QuietHours> }
  | { to: 'host'; patch: AgentSettingsPatch }
  | { to: 'remote'; patch: Partial<RemoteSettings> }
  | { to: 'profile'; patch: Partial<Pick<Space, 'name' | 'icon' | 'github' | 'syncInstructions'>> }
  | { to: 'account'; provider: Provider; accountId: string }
  | { to: 'config'; title: string; changes: ConfigChange[] };

/** App-wide settings, then the profile's when `profile` is given (its MCP servers and skills once `config` is read). */
export function settingsCatalog({ profile, config }: { profile?: Space; config?: ProfileConfig } = {}): Setting[] {
  return [...APP_SETTINGS, ...(profile ? profileSettings(config) : [])];
}

export function findSetting(catalog: Setting[], key: string) {
  return catalog.find((s) => s.key === key);
}

/** A value as the user reads it: an option's label, On / Off, or the value itself. */
export function valueLabel(setting: Setting, value: string | undefined) {
  if (value === undefined) return '…';
  const { control } = setting;
  if (control.type === 'switch' || control.type === 'mcp' || control.type === 'skill') return value === 'true' ? 'On' : 'Off';
  if (control.type === 'choice' || control.type === 'select') return control.options.find((o) => o.value === value)?.label ?? value;
  if (control.type === 'instructions') return `${value.trimEnd().split('\n').length} lines`;
  if (control.type === 'shortcut') return value ? shortcutText(parseChord(value) ?? []) : 'No shortcut';
  // Ids are `ext:<namespace>.<name>:<label>` or `custom:<file>`: the last part names it.
  if (control.type === 'colorTheme') return value === MOCHI_THEME_ID ? 'Mochi' : value.split(':').pop()!;
  return value || 'Not set';
}

/**
 * A value as the widget's Done record compares it. Instructions go by length and a hash, never their text: the widget is
 * saved with the thread.
 */
export function recordValue(setting: Setting, value: string) {
  if (setting.control.type !== 'instructions') return value;
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return `${value.length}:${hash}`;
}

// {APP}

const SWITCH = { type: 'switch' } as const;

const choice = (options: readonly Option[]) => ({ type: 'choice', options }) as const;
const select = (options: readonly Option[]) => ({ type: 'select', options }) as const;

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;

const BADGE = [
  { value: 'on', label: 'Needs you' },
  { value: 'off', label: 'Off' },
] as const;

const SIMPLIFY_LENGTHS = [
  { value: 'short', label: 'Short' },
  { value: 'detailed', label: 'Detailed' },
] as const;

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: hourLabel(h) }));

type PrefKey = { [K in keyof Prefs]: Prefs[K] extends string | number | boolean ? K : never }[keyof Prefs];

/** A pref whose stored value is the control's own value: a string option, a number, a boolean switch or text. */
function pref(key: PrefKey, label: string, section: SettingSection, control: Control, extra: Partial<Setting> = {}): Setting {
  return {
    key,
    label,
    section,
    control,
    read: ({ prefs }) => String(prefs[key]),
    write: (value) => {
      const parsed = parseValue(control, value);
      return parsed === null ? null : { to: 'prefs', patch: { [key]: parsed } as Partial<Prefs> };
    },
    ...extra,
  };
}

/** A host (main-process) setting at the top level of `AgentSettings`. */
function hostSetting(key: 'concurrency' | 'worktreeRoot' | 'shell' | 'prDrafts' | 'prepareWorktrees' | 'worktreeInclude', label: string, section: SettingSection, control: Control, extra: Partial<Setting> = {}): Setting {
  return {
    key,
    label,
    section,
    control,
    read: ({ host }) => host && String(host[key]),
    write: (value) => {
      const parsed = parseValue(control, value);
      return parsed === null ? null : { to: 'host', patch: { [key]: parsed } };
    },
    ...extra,
  };
}

/** The control's typed value for `value`, or null when the control can't take it. */
function parseValue(control: Control, value: string): string | number | boolean | null {
  if (control.type === 'switch') return value === 'true' ? true : value === 'false' ? false : null;
  if (control.type === 'choice' || control.type === 'select') return control.options.some((o) => o.value === value) ? value : null;
  if (control.type === 'number') {
    const n = Number(value);
    return Number.isInteger(n) && n >= control.min && n <= control.max ? n : null;
  }
  if (control.type === 'text') return value.trim() || control.fallback || '';
  return value;
}

/** A model choice as one value, `provider:model`; model ids can hold colons. */
const modelValue = ({ provider, model }: ModelChoice) => `${provider}:${model}`;

function parseModelChoice(value: string): ModelChoice | null {
  const [provider, ...model] = value.split(':');
  return HARNESS_IDS.includes(provider as Provider) && model.length ? { provider: provider as Provider, model: model.join(':') } : null;
}

const AGENT_REACH = "An agent can't widen its own reach.";

function colorTheme(slot: ThemeSlot): Setting {
  const key = slot === 'light' ? 'lightTheme' : 'darkTheme';
  return {
    key,
    label: slot === 'light' ? 'Light theme' : 'Dark theme',
    section: 'themes',
    description: 'Mochi, or an installed VS Code color theme',
    control: { type: 'colorTheme', slot },
    read: ({ prefs }) => prefs[key],
    write: (value, { colorThemes }) => {
      const isKnown = value === MOCHI_THEME_ID || !colorThemes || colorThemes.some((t) => t.id === value && slotOf(t.kind) === slot);
      return isKnown ? { to: 'prefs', patch: { [key]: value } } : null;
    },
  };
}

const REMOTE_KEYS = { isEnabled: 'remoteEnabled', allowsNetwork: 'remoteNetwork', reachesAnywhere: 'remoteAnywhere', machineName: 'machineName' } satisfies Record<keyof RemoteSettings, string>;

function remoteSetting(key: keyof RemoteSettings, label: string, control: Control, extra: Partial<Setting> = {}): Setting {
  return {
    key: REMOTE_KEYS[key],
    label,
    section: 'devices',
    control,
    read: ({ remote }) => remote && String(remote[key]),
    write: (value) => {
      const parsed = parseValue(control, value);
      return parsed === null || (typeof parsed === 'string' && parsed.length > 64) ? null : { to: 'remote', patch: { [key]: parsed } };
    },
    ...extra,
  };
}

/**
 * One row per keymap command. A write takes the chord from whichever command holds it (the widget's Use, after
 * `set_keybinding` showed that command's row too); Settings › Keyboard asks first instead (`ShortcutRecorder`).
 */
function keybinding(id: CommandId): Setting {
  return {
    key: `keybinding.${id}`,
    label: COMMANDS[id].title,
    section: 'keyboard',
    context: 'Keyboard shortcut',
    control: { type: 'shortcut', command: id },
    read: ({ prefs }) => chordText(bindingOf(id, prefs.keybindings)),
    write: (value, { prefs }) => {
      const keys = value === '' ? null : parseChord(value);
      if (value !== '' && !keys) return null;
      try {
        return { to: 'prefs', patch: { keybindings: rebind(prefs.keybindings, id, keys, 'replace') } };
      } catch {
        return null;
      }
    },
  };
}

const REMOTE_REACH = "It opens this computer to other devices; only you do that.";

const APP_SETTINGS: Setting[] = [
  {
    key: 'theme',
    label: 'Theme',
    section: 'general',
    control: choice(THEMES),
    read: ({ theme }) => theme,
    write: (value) => (THEMES.some((t) => t.value === value) ? { to: 'theme', theme: value } : null),
  },
  colorTheme('light'),
  colorTheme('dark'),
  pref('reduceMotion', 'Reduce motion', 'general', choice(MOTION)),
  pref('projectsFolder', 'Projects folder', 'general', { type: 'text', placeholder: DEFAULT_PREFS.projectsFolder, fallback: DEFAULT_PREFS.projectsFolder, isPath: true }),
  pref('restoreLayout', 'Restore layout on launch', 'general', SWITCH),
  ...Object.entries(ALERT_KINDS).map(
    ([kind, label]): Setting => ({
      key: `alert.${kind}`,
      label,
      section: 'notifications',
      context: 'System alert',
      control: SWITCH,
      read: ({ prefs }) => String(prefs.alertKinds.includes(kind)),
      write: (value, { prefs }) => {
        const isOn = parseValue(SWITCH, value);
        if (isOn === null) return null;
        return { to: 'prefs', patch: { alertKinds: isOn ? [...new Set([...prefs.alertKinds, kind])] : prefs.alertKinds.filter((k) => k !== kind) } };
      },
    }),
  ),
  pref('watchedToasts', 'Toasts for watched threads', 'notifications', SWITCH),
  {
    key: 'dockBadge',
    label: 'App icon badge counts',
    section: 'notifications',
    control: choice(BADGE),
    read: ({ prefs }) => (prefs.dockBadge ? 'on' : 'off'),
    write: (value) => (value === 'on' || value === 'off' ? { to: 'prefs', patch: { dockBadge: value === 'on' } } : null),
  },
  {
    key: 'quietHours',
    label: 'Quiet hours',
    section: 'notifications',
    control: SWITCH,
    read: ({ quiet }) => String(quiet.isOn),
    write: (value) => (value === 'true' || value === 'false' ? { to: 'quiet', patch: { isOn: value === 'true' } } : null),
  },
  ...(['start', 'end'] as const).map(
    (edge): Setting => ({
      key: edge === 'start' ? 'quietFrom' : 'quietUntil',
      label: edge === 'start' ? 'Quiet from' : 'Quiet until',
      section: 'notifications',
      control: select(HOURS),
      read: ({ quiet }) => String(quiet[edge]),
      write: (value) => (HOURS.some((h) => h.value === value) ? { to: 'quiet', patch: { [edge]: Number(value) } } : null),
    }),
  ),
  remoteSetting('isEnabled', 'Let devices control this computer', SWITCH, { locked: REMOTE_REACH }),
  remoteSetting('allowsNetwork', 'Allow devices on this network', SWITCH, { locked: REMOTE_REACH }),
  remoteSetting('reachesAnywhere', 'Reach this computer from anywhere', SWITCH, { locked: REMOTE_REACH }),
  remoteSetting('machineName', 'Computer name', { type: 'text', placeholder: 'This computer’s host name' }, { description: 'How your devices list this computer; empty uses the host name' }),
  pref('agent', 'Agent', 'defaults', choice(AGENTS)),
  pref('permissions', 'Permissions', 'defaults', choice(SHARED_ACCESS.map((a) => ({ value: a, label: a, ...(a === 'Full access' && { tone: 'warning' as const }) }))), { locked: AGENT_REACH }),
  {
    key: 'sideChatModel',
    label: 'Side chat model',
    section: 'defaults',
    control: { type: 'model' },
    read: ({ host }) => host && modelValue(host.sideChatModel),
    write: (value) => {
      const sideChatModel = parseModelChoice(value);
      return sideChatModel && { to: 'host', patch: { sideChatModel } };
    },
  },
  pref('whileWorking', 'While the agent is working, new messages', 'defaults', select(WHILE_WORKING)),
  pref('simplifyLength', 'Length', 'simplify', choice(SIMPLIFY_LENGTHS)),
  pref('simplifyNeedsFirst', 'Put what needs you first', 'simplify', SWITCH),
  pref('simplifyRules', 'Your rules', 'simplify', { type: 'text', placeholder: 'Keep numbers, no jargon, one line per file', isMultiline: true }),
  pref('simplifyAuto', 'Simplify long replies automatically', 'simplify', SWITCH),
  pref('simplifyAutoWords', 'Long means more than (words)', 'simplify', { type: 'number', min: 50, max: 2000, step: 50 }),
  hostSetting('concurrency', 'Agents running at once', 'defaults', { type: 'number', ...CONCURRENCY_RANGE, step: 1 }),
  ...UTILITY_TASKS.map(
    (task): Setting => ({
      key: `utility.${task}`,
      label: UTILITY_TASK_LABELS[task],
      section: 'background',
      context: 'Background task model',
      control: { type: 'model' },
      read: ({ host }) => host && modelValue(host.utilityModels[task]),
      write: (value) => {
        const choice = parseModelChoice(value);
        return choice && { to: 'host', patch: { utilityModels: { [task]: choice } } };
      },
    }),
  ),
  pref('driftGuard', 'Drift guard', 'goals', SWITCH),
  pref('branchFrom', 'Off-goal work branches from', 'goals', choice(BRANCH_FROM)),
  hostSetting('worktreeRoot', 'Worktrees folder', 'git', { type: 'text', placeholder: '~/.mochi/worktrees', isPath: true }),
  hostSetting('prDrafts', 'Open pull requests as drafts', 'git', SWITCH),
  hostSetting('prepareWorktrees', 'Prepare worktrees before starting', 'git', SWITCH),
  hostSetting('worktreeInclude', 'Ignored files to copy', 'git', { type: 'text', placeholder: '.env*, .claude/settings.local.json', isMono: true }),
  pref('worktreeCleanup', 'Remove settled worktrees', 'git', select(WORKTREE_CLEANUP)),
  pref('workspaceMode', 'New threads work in', 'git', choice(WORKSPACE_MODES)),
  pref('branchPrefix', 'Branch prefix', 'git', { type: 'text', placeholder: 'None', fallback: DEFAULT_PREFS.branchPrefix, isMono: true }),
  pref('diffStyle', 'Diffs', 'git', choice(DIFF_STYLES)),
  hostSetting('shell', 'Shell', 'terminal', { type: 'text', placeholder: '$SHELL', isMono: true }),
  pref('restoreTerminals', 'Restore terminals on launch', 'terminal', SWITCH),
  pref('terminalFontSize', 'Font size', 'terminal', { type: 'number', min: 9, max: 24, step: 1 }),
  pref('terminalScrollback', 'Scrollback lines', 'terminal', { type: 'number', min: 1000, max: 100_000, step: 1000 }),
  pref('searchEngine', 'Search engine', 'browser', select(ENGINES)),
  pref('simulator', 'Default simulator', 'browser', { type: 'simulator' }),
  pref('agentControl', AGENT_CONTROL.label, 'tools', select(AGENT_CONTROL.options), { locked: AGENT_REACH, description: 'Threads, goals, panes, settings and the in-app browser' }),
  pref('threadModels', THREAD_MODELS.label, 'tools', select(THREAD_MODELS.options), { locked: AGENT_REACH, description: "Compared with the starting thread's model and effort" }),
  pref('demoData', 'Show demo data', 'data', SWITCH, { description: 'Mochi reloads to apply' }),
  pref('recordReplays', 'Record threads for replay', 'data', SWITCH),
  pref('effort', 'Default effort', 'harnesses', select(EFFORTS.map((level) => ({ value: level, label: effortName(level) })))),
  {
    key: 'speed',
    label: 'Default speed',
    section: 'harnesses',
    context: 'New threads',
    control: choice(SPEEDS),
    read: ({ prefs }) => prefs.speed || 'standard',
    write: (value) => (value === 'standard' || value === 'fast' ? { to: 'prefs', patch: { speed: value === 'fast' ? 'fast' : '' } } : null),
    locked: "An agent can't raise what you pay.",
  },
  {
    key: 'starredModels',
    label: 'Starred models',
    section: 'harnesses',
    description: 'Model ids, comma-separated',
    control: { type: 'starredModels' },
    read: ({ prefs }) => prefs.starredModels.join(','),
    write: (value) => ({ to: 'prefs', patch: { starredModels: value.split(',').map((m) => m.trim()).filter(Boolean) } }),
  },
  ...HARNESS_IDS.flatMap((provider): Setting[] => {
    const name = HARNESSES[provider].name;
    const harness = (field: 'path' | 'model' | 'secondOpinionModel', label: string, control: Control, extra: Partial<Setting> = {}): Setting => ({
      key: `${provider}.${field}`,
      label: `${name} ${label}`,
      section: 'harnesses',
      control,
      read: ({ host }) => host?.harnesses[provider][field],
      write: (value) => ({ to: 'host', patch: { harnesses: { [provider]: { [field]: value } } } }),
      ...extra,
    });
    return [
      harness('path', 'custom path', { type: 'text', placeholder: 'Found on your PATH', isMono: true }, { locked: `It picks the program that runs every agent with your login.`, description: 'Leave empty to use the one on your PATH.' }),
      harness('model', 'default model', { type: 'model', provider }, { description: 'New threads start on this model.' }),
      harness('secondOpinionModel', 'second opinion model', { type: 'model', provider, emptyLabel: 'Default model' }, { description: `What ${name} reviews other threads on.` }),
    ];
  }),
  ...COMMAND_IDS.map(keybinding),
];

// {PROFILE}

function profileSettings(config: ProfileConfig | undefined): Setting[] {
  const field = (key: 'name' | 'github', label: string, control: Control): Setting => ({
    key: `profile.${key}`,
    label,
    section: 'profile',
    control,
    read: ({ profile }) => profile?.[key],
    write: (value) => (key === 'name' && !value.trim() ? null : { to: 'profile', patch: { [key]: value.trim() } }),
  });
  return [
    field('name', 'Name', { type: 'text', placeholder: 'Profile name' }),
    {
      key: 'profile.icon',
      label: 'Icon',
      section: 'profile',
      control: { type: 'icon' },
      read: ({ profile }) => profile?.icon,
      write: (value) => ((SPACE_ICON_NAMES as readonly string[]).includes(value) ? { to: 'profile', patch: { icon: value as Space['icon'] } } : null),
    },
    field('github', 'GitHub account', { type: 'github' }),
    ...HARNESS_IDS.map(
      (provider): Setting => ({
        key: `profile.${provider}Account`,
        label: `${HARNESSES[provider].name} account`,
        section: 'profile',
        control: { type: 'account', provider },
        read: ({ profile, accounts }) => profile && accounts && linkedAccountId(accounts.links, profile.id, provider),
        write: (value, { accounts }) => (accounts?.accounts.some((a) => a.id === value && a.provider === provider) ? { to: 'account', provider, accountId: value } : null),
      }),
    ),
    {
      key: 'profile.syncInstructions',
      label: 'Keep CLAUDE.md and AGENTS.md the same',
      section: 'profile',
      control: SWITCH,
      read: ({ profile }) => profile && String(!!profile.syncInstructions),
      write: (value) => (value === 'true' || value === 'false' ? { to: 'profile', patch: { syncInstructions: value === 'true' } } : null),
    },
    ...HARNESS_IDS.map(
      (provider): Setting => ({
        key: `profile.${provider}.instructions`,
        label: INSTRUCTIONS_FILE[provider],
        section: 'profile',
        description: `${HARNESSES[provider].name}'s instructions for every session in this profile`,
        control: { type: 'instructions', provider },
        read: ({ config: c }) => c?.[provider].instructions.text,
        write: (value) => ({ to: 'config', title: `Save ${INSTRUCTIONS_FILE[provider]}`, changes: [{ kind: 'instructions', provider, text: value }] }),
      }),
    ),
    ...HARNESS_IDS.flatMap((provider) => [
      ...(config?.[provider].mcpServers.filter((s) => s.scope === 'user') ?? []).map(
        ({ def }): Setting => ({
          key: `profile.${provider}.mcp.${def.name}`,
          label: `MCP server ${def.name}`,
          section: 'profile',
          context: HARNESSES[provider].name,
          control: { type: 'mcp', provider, name: def.name },
          read: ({ config: c }) => {
            const server = c?.[provider].mcpServers.find((s) => s.def.name === def.name);
            return server && String(server.enabled);
          },
          write: (value) => (value === 'true' || value === 'false' ? { to: 'config', title: `${value === 'true' ? 'Turn on' : 'Turn off'} ${def.name}`, changes: [{ kind: 'mcp-enabled', provider, name: def.name, enabled: value === 'true' }] } : null),
        }),
      ),
      ...(config?.[provider].skills ?? []).map(
        (skill): Setting => ({
          key: `profile.${provider}.skill.${skill.name}`,
          label: `Skill ${skill.name}`,
          section: 'profile',
          context: HARNESSES[provider].name,
          control: { type: 'skill', provider, name: skill.name },
          read: ({ config: c }) => {
            const found = c?.[provider].skills.find((s) => s.name === skill.name);
            return found && String(found.enabled);
          },
          write: (value) => (value === 'true' || value === 'false' ? { to: 'config', title: `${value === 'true' ? 'Turn on' : 'Turn off'} ${skill.name}`, changes: [{ kind: 'skill-enabled', provider, name: skill.name, enabled: value === 'true' }] } : null),
        }),
      ),
    ]),
  ];
}
