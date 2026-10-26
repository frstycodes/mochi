import { matchKeybindingPress } from 'tinykeys';
import { IS_MAC, shortcutText, type Key, type Modifier } from './keys.ts';
import { getPrefs } from './settings/prefs.ts';

/**
 * Every app-level shortcut as a named command with its default chord (SETTINGS.md › Keyboard). Handlers ask `isCommand`
 * instead of matching keys inline; Settings › Keyboard and the agent's `set_keybinding` rebind them into
 * `prefs.keybindings`, which holds only the changed ones (`''` = no shortcut). Chords match on `e.code`, so they work on
 * any keyboard layout. Field-local keys (the composer's Enter, text editing, a terminal's own keys) stay out: `FIXED_KEYS`.
 */
export const COMMAND_GROUPS = [
  'General',
  'Threads',
  'Splits',
  'Side pane',
  'Profiles',
  'Lists',
  'Replay',
  'Photos',
  'Annotations',
  'Orbit',
] as const;

/** Commands clash within a scope or with a global command. Viewer shortcuts listen only while that viewer is active. */
export type CommandScope =
  | 'global'
  | 'pane'
  | 'list'
  | 'replay'
  | 'photo'
  | 'annotation'
  | 'orbit';

interface Command {
  title: string;
  group: (typeof COMMAND_GROUPS)[number];
  scope: CommandScope;
  keys: Key[] | ((isMac: boolean) => Key[]);
  inDialog?: boolean;
  whileTyping?: boolean;
}

const PINS = 5;
const PROFILES = 9;

/** The side panes mod Alt + a letter toggles: mnemonic, and clear of the browser's and macOS's own mod Alt keys. */
const PANES = {
  browser: ['Preview', 'P'],
  changes: ['Changes', 'D'],
  terminal: ['Terminal', 'T'],
  files: ['Files', 'F'],
  simulator: ['Simulator', 'S'],
  ports: ['Ports', 'O'],
  sidechat: ['Side chat', 'C'],
  agents: ['Background tasks', 'A'],
  artifacts: ['Artifacts', 'R'],
  pr: ['Pull request', 'G'],
} as const;

export type PaneCommandKind = keyof typeof PANES;

const ARROWS = {
  left: 'left',
  right: 'right',
  up: 'up',
  down: 'down',
} as const;

export const COMMANDS = {
  palette: {
    title: 'Command palette',
    group: 'General',
    scope: 'global',
    keys: ['mod', 'K'],
  },
  dismiss: {
    title: 'Dismiss the current view or gesture',
    group: 'General',
    scope: 'global',
    keys: ['Esc'],
    whileTyping: true,
  },
  'sidebar-toggle': {
    title: 'Toggle sidebar',
    group: 'General',
    scope: 'global',
    keys: ['mod', 'B'],
  },
  'toast-focus': {
    title: 'Focus the newest notification',
    group: 'General',
    scope: 'global',
    keys: (isMac) => [isMac ? 'alt' : 'nav', 'T'],
  },
  'report-take-move': {
    title: 'Take the next move',
    group: 'Threads',
    scope: 'global',
    keys: ['mod', 'Enter'],
    whileTyping: true,
  },
  'go-settings': {
    title: 'Settings',
    group: 'General',
    scope: 'global',
    keys: ['mod', ','],
  },
  'go-new': {
    title: 'New thread',
    group: 'General',
    scope: 'global',
    keys: ['mod', 'N'],
  },
  'layout-overview': {
    title: 'Show all sessions',
    group: 'General',
    scope: 'global',
    keys: ['mod', 'up'],
  },

  'thread-pin': {
    title: 'Pin or unpin thread',
    group: 'Threads',
    scope: 'global',
    keys: ['mod', 'shift', 'P'],
  },
  'thread-rename': {
    title: 'Rename thread',
    group: 'Threads',
    scope: 'global',
    keys: ['F2'],
  },
  'pinned-previous': {
    title: 'Previous pinned thread',
    group: 'Threads',
    scope: 'global',
    keys: ['mod', 'shift', '['],
  },
  'pinned-next': {
    title: 'Next pinned thread',
    group: 'Threads',
    scope: 'global',
    keys: ['mod', 'shift', ']'],
  },
  ...numbered(PINS, (n) => [
    `pinned-${n}`,
    {
      title: `Pinned thread ${n}`,
      group: 'Threads',
      scope: 'global',
      keys: ['mod', String(n)],
    },
  ]),
  ...numbered(PINS, (n) => [
    `pinned-split-${n}`,
    {
      title: `Pinned thread ${n} in a new split`,
      group: 'Threads',
      scope: 'global',
      keys: ['mod', 'alt', String(n)],
    },
  ]),

  'layout-split': {
    title: 'Split right',
    group: 'Splits',
    scope: 'global',
    keys: ['mod', '\\'],
  },
  'layout-zoom': {
    title: 'Zoom split or show all',
    group: 'Splits',
    scope: 'global',
    keys: ['mod', 'shift', 'Enter'],
  },
  'split-focus-previous': {
    title: 'Focus previous split',
    group: 'Splits',
    scope: 'global',
    keys: ['mod', '['],
  },
  'split-focus-next': {
    title: 'Focus next split',
    group: 'Splits',
    scope: 'global',
    keys: ['mod', ']'],
  },
  // ⌃ arrows belong to Mission Control on macOS, so the Mac default adds ⌘⌥ instead.
  ...(Object.fromEntries(
    Object.values(ARROWS).map((arrow) => [
      `split-focus-${arrow}`,
      {
        title: `Focus split ${arrow === 'up' ? 'above' : arrow === 'down' ? 'below' : `to the ${arrow}`}`,
        group: 'Splits',
        scope: 'global',
        keys: (isMac: boolean) =>
          isMac ? ['mod', 'alt', arrow] : ['nav', arrow],
      } satisfies Command,
    ]),
  ) as Record<`split-focus-${keyof typeof ARROWS}`, Command>),

  ...(Object.fromEntries(
    Object.entries(PANES).map(([kind, [title, letter]]) => [
      `pane-${kind}`,
      {
        title: `Toggle ${title}`,
        group: 'Side pane',
        scope: 'global',
        keys: ['mod', 'alt', letter],
      } satisfies Command,
    ]),
  ) as Record<`pane-${PaneCommandKind}`, Command>),
  'pane-next': {
    title: 'Next pane',
    group: 'Side pane',
    scope: 'pane',
    keys: (isMac) => [isMac ? 'nav' : 'mod', 'Tab'],
  },
  'pane-previous': {
    title: 'Previous pane',
    group: 'Side pane',
    scope: 'pane',
    keys: (isMac) => [isMac ? 'nav' : 'mod', 'shift', 'Tab'],
  },
  'tab-close': {
    title: 'Close tab or pane',
    group: 'Side pane',
    scope: 'pane',
    keys: ['mod', 'W'],
  },
  find: {
    title: 'Find in page or terminal',
    group: 'Side pane',
    scope: 'pane',
    keys: ['mod', 'F'],
  },
  'files-go-to': {
    title: 'Go to file',
    group: 'Side pane',
    scope: 'pane',
    keys: ['mod', 'P'],
  },
  'files-search': {
    title: 'Search in files',
    group: 'Side pane',
    scope: 'pane',
    keys: ['mod', 'shift', 'F'],
  },
  'file-save': {
    title: 'Save file',
    group: 'Side pane',
    scope: 'pane',
    keys: ['mod', 'S'],
  },

  ...numbered(PROFILES, (n) => [
    `space-${n}`,
    {
      title: `Switch to profile ${n}`,
      group: 'Profiles',
      scope: 'global',
      keys: ['nav', String(n)],
    },
  ]),

  'list-next': {
    title: 'Next item',
    group: 'Lists',
    scope: 'list',
    keys: ['J'],
  },
  'list-previous': {
    title: 'Previous item',
    group: 'Lists',
    scope: 'list',
    keys: ['K'],
  },
  'replay-toggle': {
    title: 'Play or pause replay',
    group: 'Replay',
    scope: 'replay',
    keys: ['Space'],
  },
  'replay-toggle-k': {
    title: 'Play or pause replay with K',
    group: 'Replay',
    scope: 'replay',
    keys: ['K'],
  },
  'replay-back': {
    title: 'Replay back 10 seconds',
    group: 'Replay',
    scope: 'replay',
    keys: ['J'],
  },
  'replay-forward': {
    title: 'Replay forward 10 seconds',
    group: 'Replay',
    scope: 'replay',
    keys: ['L'],
  },
  'replay-previous': {
    title: 'Previous replay event',
    group: 'Replay',
    scope: 'replay',
    keys: ['left'],
  },
  'replay-next': {
    title: 'Next replay event',
    group: 'Replay',
    scope: 'replay',
    keys: ['right'],
  },
  'replay-marker-previous': {
    title: 'Previous replay marker',
    group: 'Replay',
    scope: 'replay',
    keys: ['shift', 'left'],
  },
  'replay-marker-next': {
    title: 'Next replay marker',
    group: 'Replay',
    scope: 'replay',
    keys: ['shift', 'right'],
  },
  'replay-start': {
    title: 'Start of replay',
    group: 'Replay',
    scope: 'replay',
    keys: ['Home'],
  },
  'replay-end': {
    title: 'End of replay',
    group: 'Replay',
    scope: 'replay',
    keys: ['End'],
  },
  'photo-zoom-in': {
    title: 'Zoom photo in',
    group: 'Photos',
    scope: 'photo',
    keys: ['='],
    inDialog: true,
  },
  'photo-zoom-in-shift': {
    title: 'Zoom photo in with +',
    group: 'Photos',
    scope: 'photo',
    keys: ['shift', '='],
    inDialog: true,
  },
  'photo-zoom-out': {
    title: 'Zoom photo out',
    group: 'Photos',
    scope: 'photo',
    keys: ['-'],
    inDialog: true,
  },
  'photo-fit': {
    title: 'Fit photo',
    group: 'Photos',
    scope: 'photo',
    keys: ['0'],
    inDialog: true,
  },
  'annotation-undo': {
    title: 'Undo annotation',
    group: 'Annotations',
    scope: 'annotation',
    keys: ['mod', 'Z'],
  },
  'annotation-redo': {
    title: 'Redo annotation',
    group: 'Annotations',
    scope: 'annotation',
    keys: ['mod', 'shift', 'Z'],
  },
  'orbit-hold': {
    title: 'Hold to open Orbit',
    group: 'Orbit',
    scope: 'global',
    keys: ['alt'],
  },
  ...(numbered(4, (n) => [
    `orbit-${n}`,
    {
      title: `Choose Orbit item ${n}`,
      group: 'Orbit',
      scope: 'orbit',
      keys: [String(n)],
      whileTyping: true,
    },
  ]) as Record<`orbit-${1 | 2 | 3 | 4}`, Command>),
} satisfies Record<string, Command>;

export type CommandId = keyof typeof COMMANDS;

export const COMMAND_IDS = Object.keys(COMMANDS) as CommandId[];

export const isCommandId = (id: string): id is CommandId =>
  Object.hasOwn(COMMANDS, id);

export const paneCommand = (kind: PaneCommandKind): CommandId => `pane-${kind}`;

export const pinnedCommand = (n: number, inSplit = false) =>
  `pinned-${inSplit ? 'split-' : ''}${n}` as CommandId;

export const spaceCommand = (n: number) => `space-${n}` as CommandId;

export type Overrides = Record<string, string>;

/** Keys that work as shown and can't be rebound: they belong to a field, a viewer or a gesture, not to the app. */
export const FIXED_KEYS: { keys: Key[]; what: string }[] = [
  {
    keys: ['Enter'],
    what: 'Send from the composer (Shift Enter for a new line)',
  },
  { keys: ['mod'], what: 'Hold while sending to queue or steer the other way' },
  { keys: ['up'], what: 'Edit your last message from an empty composer' },
  {
    keys: ['Esc'],
    what: 'Close a menu or dialog, or cancel shortcut recording',
  },
  {
    keys: ['mod', '1'],
    what: 'Pick a tab in a pane with tabs (1 to 9), while it has focus',
  },
  {
    keys: ['mod', '1'],
    what: 'Pick a listed model in the model menu (1 to 9)',
  },
  { keys: ['alt', 'up'], what: 'Move a focused pinned thread up or down' },
  { keys: ['left', 'right'], what: 'Step through files and photos' },
  { keys: ['1'], what: 'Answer a drift card (1 to 3)' },
  {
    keys: ['mod', 'Enter'],
    what: 'Send a review comment or a note on a change',
  },
  {
    keys: ['mod', 'C'],
    what: 'Text editing, and every key inside a terminal or the simulator',
  },
];

const MODIFIERS = ['mod', 'nav', 'alt', 'shift'] as const satisfies Modifier[];

const CODES: Record<string, string> = {
  ...Object.fromEntries(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => [l, `Key${l}`]),
  ),
  ...Object.fromEntries('0123456789'.split('').map((d) => [d, `Digit${d}`])),
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, `F${i + 1}`]),
  ),
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
  Esc: 'Escape',
  Enter: 'Enter',
  Tab: 'Tab',
  Space: 'Space',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
};

const NAMES = Object.fromEntries(
  Object.entries(CODES).map(([name, code]) => [code, name]),
);

/** The keys a plain chord (no ⌘, ⌃ or ⌥) may end in: anything else moves focus or edits text. */
const PLAIN_OK =
  /^([A-Z0-9]|F\d+|Esc|Space|left|right|up|down|Home|End|PageUp|PageDown|=|-)$/;

const reserved = (keys: Key[], reason: string) => ({ keys, reason });

const EDITING = [
  reserved(['mod', 'C'], 'Copy'),
  reserved(['mod', 'V'], 'Paste'),
  reserved(['mod', 'X'], 'Cut'),
  reserved(['mod', 'A'], 'Select all'),
  reserved(['mod', 'Z'], 'Undo'),
  reserved(['mod', 'shift', 'Z'], 'Redo'),
].map((r) => ({ ...r, reason: `${r.reason} in every text field needs it` }));

const MAC_RESERVED = [
  ...EDITING,
  reserved(['mod', 'Q'], 'macOS quits Mochi with it'),
  reserved(['mod', 'H'], 'macOS hides Mochi with it'),
  reserved(['mod', 'alt', 'H'], 'macOS hides the other apps with it'),
  reserved(['mod', 'M'], 'macOS minimizes the window with it'),
  reserved(['mod', 'Tab'], 'macOS switches apps with it'),
  reserved(['mod', 'shift', 'Tab'], 'macOS switches apps with it'),
  reserved(['mod', '`'], "macOS cycles an app's windows with it"),
  reserved(['mod', 'Space'], 'Spotlight opens with it'),
  reserved(['mod', 'alt', 'Space'], 'Finder search opens with it'),
  reserved(['nav', 'Space'], 'macOS switches input sources with it'),
  reserved(
    ['nav', 'left'],
    'Mission Control moves to the space on the left with it',
  ),
  reserved(
    ['nav', 'right'],
    'Mission Control moves to the space on the right with it',
  ),
  reserved(['nav', 'up'], 'Mission Control opens with it'),
  reserved(['nav', 'down'], 'App Exposé opens with it'),
  reserved(['mod', 'shift', '3'], 'macOS takes a screenshot with it'),
  reserved(['mod', 'shift', '4'], 'macOS takes a screenshot with it'),
  reserved(['mod', 'shift', '5'], 'macOS opens screen capture with it'),
  reserved(['nav', 'mod', 'Q'], 'macOS locks the screen with it'),
  reserved(['nav', 'mod', 'Space'], 'macOS opens Emoji & Symbols with it'),
  reserved(['nav', 'mod', 'F'], 'macOS enters full screen with it'),
];

const PC_RESERVED = [
  ...EDITING,
  reserved(['mod', 'Y'], 'Redo in every text field needs it'),
  reserved(['nav', 'Tab'], 'The system switches windows with it'),
  reserved(['nav', 'shift', 'Tab'], 'The system switches windows with it'),
  reserved(['nav', 'F4'], 'The system closes the window with it'),
  reserved(['nav', 'Space'], 'The system opens the window menu with it'),
  reserved(
    ['mod', 'alt', 'Delete'],
    'The system keeps it for its security screen',
  ),
];

/** The default chord for `id` on this platform. */
export function defaultKeys(id: CommandId, isMac = IS_MAC): Key[] {
  const { keys } = COMMANDS[id] as Command;
  return typeof keys === 'function' ? keys(isMac) : keys;
}

/** `id`'s chord now: the saved one, or the default when nothing (or something unreadable) is saved; null when cleared. */
export function bindingOf(
  id: CommandId,
  overrides: Overrides = getPrefs().keybindings,
  isMac = IS_MAC,
): Key[] | null {
  const saved = overrides[id];
  if (saved === undefined) return defaultKeys(id, isMac);
  if (saved === '') return null;
  return parseChord(saved) ?? defaultKeys(id, isMac);
}

export const isCustom = (id: CommandId, overrides: Overrides) =>
  Object.hasOwn(overrides, id) && overrides[id] !== chordText(defaultKeys(id));

/** What Settings › Keyboard's filter narrows to. `chord` is a pressed shortcut to look up; `isChangedOnly` keeps your rebinds. */
export interface ShortcutFilter {
  query: string;
  chord: Key[] | null;
  isChangedOnly: boolean;
}

/** The commands a filter shows: words match the title or group, a chord matches what a command is bound to now. */
export function filterCommands(
  ids: CommandId[],
  { query, chord, isChangedOnly }: ShortcutFilter,
  overrides: Overrides = getPrefs().keybindings,
  isMac = IS_MAC,
) {
  const q = query.trim().toLowerCase();
  const pressed = chord && chordText(chord);
  return ids.filter((id) => {
    if (isChangedOnly && !isCustom(id, overrides)) return false;
    if (pressed && chordText(bindingOf(id, overrides, isMac)) !== pressed)
      return false;
    return (
      !q ||
      `${COMMANDS[id].title} ${COMMANDS[id].group}`.toLowerCase().includes(q)
    );
  });
}

/** `mod+shift+K` as stored and as agents write it: modifiers in a fixed order, then one key. */
export function chordText(keys: Key[] | null) {
  if (!keys) return '';
  return [
    ...MODIFIERS.filter((m) => keys.includes(m)),
    ...keys.filter((k) => !(MODIFIERS as readonly Key[]).includes(k)),
  ].join('+');
}

/** A chord from its text, or null when it isn't one: known modifiers once each, then exactly one known key. Letters in any case. */
export function parseChord(text: string): Key[] | null {
  const parts = text.split('+').map((p) => p.trim());
  // A trailing '+' leaves an empty part, and '+' is no key here (it's Shift = on most layouts).
  if (parts.some((p) => !p)) return null;
  if (parts.length === 1 && parts[0].toLowerCase() === 'alt') return ['alt'];
  const key = parts.pop()!;
  const name = keyNamed(key);
  const mods = parts.map((p) => p.toLowerCase());
  if (
    !name ||
    mods.some((m) => !(MODIFIERS as readonly string[]).includes(m)) ||
    new Set(mods).size !== mods.length
  )
    return null;
  return [...MODIFIERS.filter((m) => mods.includes(m)), name];
}

function keyNamed(key: string) {
  if (CODES[key]) return key;
  if (CODES[key.toUpperCase()]) return key.toUpperCase();
  return Object.keys(CODES).find(
    (name) => name.toLowerCase() === key.toLowerCase(),
  );
}

interface KeyEventLike {
  key?: string;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** What a chord presses on this platform: `mod` and `nav` resolved to the physical keys, then the key's code. */
function physical(keys: Key[], isMac = IS_MAC) {
  const mods = new Set(
    keys.flatMap((k) =>
      k === 'mod'
        ? [isMac ? 'meta' : 'ctrl']
        : k === 'nav'
          ? [isMac ? 'ctrl' : 'alt']
          : k === 'alt' || k === 'shift'
            ? [k]
            : [],
    ),
  );
  const key = keys.find((k) => !(MODIFIERS as readonly Key[]).includes(k));
  return `${['meta', 'ctrl', 'alt', 'shift'].filter((m) => mods.has(m)).join('+')}|${key ? CODES[key] : ''}`;
}

/**
 * The chord a key press makes, for recording one: null while only modifiers are down or for a key Mochi doesn't bind.
 * On Windows and Linux Alt is `nav` alone and `alt` beside Ctrl, the way the defaults read; the Windows key never binds.
 */
export function chordOf(e: KeyEventLike, isMac = IS_MAC): Key[] | null {
  const name = NAMES[e.code === 'NumpadEnter' ? 'Enter' : e.code];
  if (!name || (!isMac && e.metaKey)) return null;
  const mods: Key[] = isMac
    ? [
        e.metaKey && 'mod',
        e.ctrlKey && 'nav',
        e.altKey && 'alt',
        e.shiftKey && 'shift',
      ].filter((m): m is Modifier => !!m)
    : [
        e.ctrlKey && 'mod',
        e.altKey && (e.ctrlKey ? 'alt' : 'nav'),
        e.shiftKey && 'shift',
      ].filter((m): m is Modifier => !!m);
  return parseChord(chordText([...mods, name]));
}

/** Match the current binding through tinykeys, keeping physical codes and the command's typing policy. */
export function isCommand(
  e: KeyEventLike & { target?: EventTarget | null },
  id: CommandId,
  overrides?: Overrides,
  isMac = IS_MAC,
) {
  const keys = bindingOf(id, overrides, isMac);
  if (!keys || e.defaultPrevented || e.isComposing) return false;
  const [mods, code] = physical(keys, isMac).split('|');
  const modifiers: Record<string, string> = {
    meta: 'Meta',
    ctrl: 'Control',
    alt: 'Alt',
    shift: 'Shift',
  };
  const required = mods ? mods.split('+').map((m) => modifiers[m]) : [];
  const key = code || 'Alt';
  // tinykeys also accepts e.key; supplying only the code keeps layout-independent matching.
  const event = {
    key: '',
    code:
      e.code === 'NumpadEnter'
        ? 'Enter'
        : /^(AltLeft|AltRight)$/.test(e.code)
          ? 'Alt'
          : e.code,
    getModifierState: (mod: string) =>
      ({
        Meta: e.metaKey,
        Control: e.ctrlKey,
        Alt: e.altKey,
        Shift: e.shiftKey,
      })[mod] ?? false,
  } as KeyboardEvent;
  const command: Command = COMMANDS[id];
  const heldMods =
    command.scope === 'orbit'
      ? physical(bindingOf('orbit-hold', overrides, isMac) ?? [], isMac).split(
          '|',
        )[0]
      : '';
  const optional = heldMods ? heldMods.split('+').map((m) => modifiers[m]) : [];
  if (
    !matchKeybindingPress(event, [
      required.filter((m) => m !== key),
      optional,
      key,
    ])
  )
    return false;
  return (
    command.whileTyping ||
    !(isPlain(keys) && isTyping(e.target, command.inDialog))
  );
}

/** The first of `ids` whose chord `e` is. */
export function commandOf<T extends CommandId>(
  e: KeyEventLike & { target?: EventTarget | null },
  ids: readonly T[],
): T | undefined {
  return ids.find((id) => isCommand(e, id));
}

const isPlain = (keys: Key[]) =>
  !keys.some((k) => k === 'mod' || k === 'nav' || k === 'alt');

function isTyping(target: EventTarget | null | undefined, inDialog = false) {
  return (
    typeof Element !== 'undefined' &&
    target instanceof Element &&
    !!target.closest(
      `input, textarea, select, [contenteditable]:not([contenteditable=false])${inDialog ? '' : ', [role=dialog], [role=alertdialog], [role=menu]'}`,
    )
  );
}

export function listenKeydown(
  listener: (event: KeyboardEvent) => void,
  capture = false,
) {
  window.addEventListener('keydown', listener, capture);
  return () => window.removeEventListener('keydown', listener, capture);
}

/** Why `keys` can't be bound at all ("macOS quits Mochi with it"), or undefined when it can. */
export function reservedReason(
  keys: Key[],
  isMac = IS_MAC,
  scope: CommandScope = 'global',
): string | undefined {
  const name = keys.at(-1)!;
  if (isPlain(keys) && !PLAIN_OK.test(name))
    return `It needs ${isMac ? '⌘, ⌃ or ⌥' : 'Ctrl or Alt'}: on its own it moves focus or edits text`;
  const reserved = (isMac ? MAC_RESERVED : PC_RESERVED).filter(
    (r) => scope !== 'annotation' || !EDITING.includes(r),
  );
  return reserved.find((r) => physical(r.keys, isMac) === physical(keys, isMac))
    ?.reason;
}

const overlaps = (a: CommandScope, b: CommandScope) =>
  a === b || a === 'global' || b === 'global';

/** Another command that `keys` would also trigger where `id` listens. */
export function conflictOf(
  id: CommandId,
  keys: Key[],
  overrides: Overrides = getPrefs().keybindings,
  isMac = IS_MAC,
): CommandId | undefined {
  const target = physical(keys, isMac);
  const { scope } = COMMANDS[id] as Command;
  return COMMAND_IDS.find((other) => {
    if (other === id || !overlaps(scope, (COMMANDS[other] as Command).scope))
      return false;
    const bound = bindingOf(other, overrides, isMac);
    return !!bound && physical(bound, isMac) === target;
  });
}

export type BindingCheck =
  | { ok: true }
  | { ok: false; reason: string }
  | { ok: false; conflict: CommandId };

/** What binding `keys` to `id` would hit; `null` (no shortcut) always passes. */
export function checkBinding(
  id: CommandId,
  keys: Key[] | null,
  overrides: Overrides = getPrefs().keybindings,
  isMac = IS_MAC,
): BindingCheck {
  if (!keys) return { ok: true };
  const reason = reservedReason(keys, isMac, COMMANDS[id].scope);
  if (reason) return { ok: false, reason };
  const conflict = conflictOf(id, keys, overrides, isMac);
  return conflict ? { ok: false, conflict } : { ok: true };
}

export type OnConflict = 'swap' | 'replace';

/**
 * The overrides after binding `keys` to `id` (null clears it). A clash is settled by `onConflict`: `replace` leaves the
 * other command without a shortcut, `swap` gives it `id`'s old one. Throws on a reserved chord or an unsettled clash.
 */
export function rebind(
  overrides: Overrides,
  id: CommandId,
  keys: Key[] | null,
  onConflict?: OnConflict,
  isMac = IS_MAC,
): Overrides {
  const check = checkBinding(id, keys, overrides, isMac);
  if (!check.ok && 'reason' in check)
    throw new Error(
      `${shortcutText(keys!, isMac)} is reserved: ${check.reason}`,
    );
  if (!check.ok && !onConflict)
    throw new Error(
      `${shortcutText(keys!, isMac)} is already used by ${COMMANDS[check.conflict].title}`,
    );
  const before = bindingOf(id, overrides, isMac);
  let next = withBinding(overrides, id, keys, isMac);
  if (!check.ok)
    next = withBinding(
      next,
      check.conflict,
      onConflict === 'swap' ? before : null,
      isMac,
    );
  return next;
}

/** `id` back on its default; refused like `rebind` when another command took the default meanwhile, unless `onConflict` settles it. */
export const resetBinding = (
  overrides: Overrides,
  id: CommandId,
  onConflict?: OnConflict,
  isMac = IS_MAC,
) => rebind(overrides, id, defaultKeys(id, isMac), onConflict, isMac);

/** Stores only what differs from the default, so a later change of default reaches everyone who never touched it. */
function withBinding(
  overrides: Overrides,
  id: CommandId,
  keys: Key[] | null,
  isMac: boolean,
): Overrides {
  const { [id]: _, ...rest } = overrides;
  return chordText(keys) === chordText(defaultKeys(id, isMac))
    ? rest
    : { ...rest, [id]: chordText(keys) };
}

function numbered<K extends string>(
  count: number,
  entry: (n: number) => [K, Command],
) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => entry(i + 1)),
  ) as Record<K, Command>;
}
