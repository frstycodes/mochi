import { Schema } from 'effect';
import { event, invoke, SpaceId, Str } from '../checks.ts';

const opt = Schema.optional;
const T = Schema.Tuple;
const o = Schema.optional;
const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;

/** A finite number in `minimum`–`maximum`, as main's `number` check. */
const Num = (minimum: number, maximum: number) =>
  Schema.Finite.check(Schema.isBetween({ minimum, maximum }));
const Coord = Num(-1e5, 1e5);

const protocolOf = (url: string) =>
  URL.canParse(url) ? new URL(url).protocol : '';
/** http(s), file: or about: (`electron/browser/navigation.ts` `isAllowedUrl`). */
const isAllowedUrl = (url: string) =>
  ['http:', 'https:', 'about:', 'file:'].includes(protocolOf(url));
const Url = Str(8192).check(
  Schema.makeFilter(
    (url) => isAllowedUrl(url) || 'url must be http(s), file: or about:',
  ),
);
const HttpUrl = Url.check(
  Schema.makeFilter((url) => /^https?:/i.test(url) || 'url must be http(s)'),
);
export const AbsolutePath = Str(4096).check(
  Schema.makeFilter(
    (path) =>
      path.startsWith('/') ||
      /^[A-Za-z]:[\\/]/.test(path) ||
      'path must be absolute',
  ),
);

export const ViewId = Str(32).check(Schema.isPattern(/^view-\d+$/));
/** A ref from the latest snapshot, like `g3-e12` (`packages/core/src/browser/ariaRefs.ts` `AGENT_REF`). */
const Ref = Str(32).check(Schema.isPattern(/^g\d+-(?:f\d+)?e\d+$/));
/** It names the compare worktree's folder. */
const ThreadKey = Str(64).check(Schema.isPattern(/^[\w-]+$/));

export const BrowserBounds = Schema.Struct({
  x: Coord,
  y: Coord,
  width: Num(0, 1e5),
  height: Num(0, 1e5),
  radius: Num(0, 100),
});
export type BrowserBounds = typeof BrowserBounds.Type;

export const BrowserEmulation = Schema.Struct({
  width: Num(0, 1e4),
  height: Num(0, 1e4),
  scale: Num(0.05, 1),
  dpr: Num(0, 4),
  mobile: B,
  touch: B,
  colorScheme: Schema.NullOr(Schema.Literals(['light', 'dark'])),
  reducedMotion: B,
});
export type BrowserEmulation = typeof BrowserEmulation.Type;

export const BrowserCommand = Schema.Literals([
  'back',
  'forward',
  'reload',
  'hard-reload',
  'stop',
]);
export const BrowserDevtools = Schema.Literals([
  'docked',
  'detached',
  'closed',
]);
export const BrowserMenuCommand = Schema.Literals([
  'cut',
  'copy',
  'paste',
  'select-all',
  'copy-image',
  'save-image',
  'inspect',
]);
export const SearchEngine = Schema.Literals([
  'duckduckgo',
  'google',
  'bing',
  'kagi',
]);
export type SearchEngine = typeof SearchEngine.Type;

export const FindOptions = Schema.Struct({
  forward: B,
  isNewSearch: B,
  matchCase: B,
});

export const BrowserContextMenu = Schema.Struct({
  x: N,
  y: N,
  linkUrl: S,
  linkText: S,
  srcUrl: S,
  mediaType: Schema.Literals([
    'none',
    'image',
    'audio',
    'video',
    'canvas',
    'file',
    'plugin',
  ]),
  selectionText: S,
  isEditable: B,
  canCut: B,
  canCopy: B,
  canPaste: B,
});

export const PickedElement = Schema.Struct({
  selector: S,
  html: S,
  screenshot: S,
});

export const BrowserAct = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(['click', 'hover']), ref: Ref }),
  Schema.Struct({ kind: Schema.Literal('type'), ref: Ref, text: Str(20_000) }),
  Schema.Struct({ kind: Schema.Literal('select'), ref: Ref, value: Str(2048) }),
  Schema.Struct({ kind: Schema.Literal('drag'), from: Ref, to: Ref }),
  Schema.Struct({
    kind: Schema.Literal('upload'),
    ref: Ref,
    path: AbsolutePath,
  }),
  Schema.Struct({ kind: Schema.Literal('press'), key: Str(32) }),
  Schema.Struct({
    kind: Schema.Literal('scroll'),
    ref: opt(Ref),
    dx: Coord,
    dy: Coord,
  }),
]);
export type BrowserAct = typeof BrowserAct.Type;

// Under main's 30s limit for one Mochi call.
const MAX_WAIT_MS = 25_000;

export const BrowserWait = Schema.Struct({
  text: opt(Str(2048)),
  selector: opt(Str(2048)),
  url: opt(Str(2048)),
  timeoutMs: Num(0, MAX_WAIT_MS),
});

export const BrowserSnapshot = Schema.Struct({
  text: S,
  refs: Schema.Record(
    S,
    Schema.Struct({ role: S, name: S, isSubmit: B, isPassword: B }),
  ),
});

export const ScrollPosition = Schema.Struct({ x: N, y: N });

export const CompareBase = Schema.Struct({ origin: S, branch: S, isReused: B });

export const BrowserDialog = Schema.Struct({
  kind: Schema.Literals(['alert', 'confirm']),
  message: S,
});

export const BrowserLog = Schema.Struct({
  level: Schema.Literals(['debug', 'info', 'warning', 'error']),
  message: S,
  source: S,
  line: N,
});

const browserEvent = <const K extends string, F extends Schema.Struct.Fields>(
  type: K,
  fields: F,
) => Schema.Struct({ id: S, type: Schema.Literal(type), ...fields });

export const BrowserEvent = Schema.Union([
  browserEvent('state', {
    url: S,
    title: S,
    isLoading: B,
    canGoBack: B,
    canGoForward: B,
    error: Schema.NullOr(S),
    favicon: Schema.NullOr(S),
  }),
  browserEvent('console', {
    level: Schema.Literals(['error', 'warning']),
    message: S,
    source: S,
    line: N,
  }),
  browserEvent('popup', { viewId: S, url: S }),
  browserEvent('closed', {}),
  browserEvent('devtools', { mode: BrowserDevtools }),
  browserEvent('frame', { data: S }),
  browserEvent('found', { active: N, matches: N }),
  browserEvent('key', { key: Schema.Literals(['find', 'escape']) }),
  browserEvent('download', {
    name: S,
    path: S,
    state: Schema.Literals(['progress', 'done', 'failed']),
    received: N,
    total: N,
  }),
  browserEvent('context-menu', BrowserContextMenu.fields),
  browserEvent('dialog', BrowserDialog.fields),
  browserEvent('dialog', { kind: Schema.Null }),
]);
export type BrowserEvent = typeof BrowserEvent.Type;

/** A context menu's save target: http(s), or an image data URL. */
const SaveUrl = Str(1_000_000).check(
  Schema.makeFilter(
    (url) =>
      isAllowedUrl(url) ||
      url.startsWith('data:image/') ||
      'url must be http(s) or an image data URL',
  ),
);

/** `BrowserHost` (`src/host/types/browser.ts`). Main still checks `autoReload`'s root and `compareStart`'s cwd are folders and a download still exists. */
export const browserRpc = {
  create: invoke(
    T([
      Schema.Struct({
        url: Url,
        spaceId: SpaceId.check(Schema.isMaxLength(64)),
      }),
    ]),
    Schema.Struct({ id: S }),
  ),
  destroy: invoke(T([ViewId]), Schema.Void),
  navigate: invoke(T([ViewId, Url]), Schema.Void),
  command: invoke(T([ViewId, BrowserCommand]), Schema.Void),
  setBounds: invoke(T([ViewId, Schema.NullOr(BrowserBounds)]), Schema.Void),
  setZoom: invoke(T([ViewId, Num(0.1, 5)]), Schema.Void),
  mirror: invoke(
    T([
      ViewId,
      Schema.NullOr(
        Schema.Struct({ width: Num(1, 8192), height: Num(1, 8192) }),
      ),
    ]),
    Schema.Void,
  ),
  emulate: invoke(T([ViewId, BrowserEmulation]), Schema.Void),
  devtools: invoke(T([ViewId, BrowserDevtools]), Schema.Void),
  capture: invoke(T([ViewId, Schema.Struct({ fullPage: B })]), S),
  pick: invoke(T([ViewId]), Schema.NullOr(PickedElement)),
  cancelPick: invoke(T([ViewId]), Schema.Void),
  clearData: invoke(T([SpaceId.check(Schema.isMaxLength(64))]), Schema.Void),
  snapshot: invoke(T([ViewId]), BrowserSnapshot),
  act: invoke(T([ViewId, BrowserAct]), Schema.Struct({ note: opt(S) })),
  logs: invoke(T([ViewId]), Schema.Array(BrowserLog)),
  eval: invoke(
    T([ViewId, Str(100_000)]),
    Schema.Struct({ value: S, isTruncated: B }),
  ),
  waitFor: invoke(
    T([ViewId, BrowserWait]),
    Schema.Struct({ isMet: B, waitedMs: N }),
  ),
  answerDialog: invoke(T([ViewId, Schema.Struct({ accept: B })]), Schema.Void),
  autoReload: invoke(T([ViewId, Schema.NullOr(Str())]), Schema.Void),
  scroll: invoke(
    T([
      ViewId,
      Schema.NullOr(Schema.Struct({ x: Num(0, 1e7), y: Num(0, 1e7) })),
    ]),
    ScrollPosition,
  ),
  compareStart: invoke(T([ThreadKey, Str(), o(Str(255))]), CompareBase),
  compareStop: invoke(T([ThreadKey]), Schema.Void),
  find: invoke(T([ViewId, Str(1000), FindOptions]), Schema.Void),
  stopFind: invoke(T([ViewId]), Schema.Void),
  menuCommand: invoke(
    T([
      ViewId,
      BrowserMenuCommand,
      Schema.Struct({ x: Coord, y: Coord }),
      o(SaveUrl),
    ]),
    Schema.Void,
  ),
  peek: invoke(T([ViewId]), S),
  openExternal: invoke(T([HttpUrl]), Schema.Void),
  showDownload: invoke(T([AbsolutePath]), Schema.Void),
  defaultBrowser: invoke(T([]), S),
  suggest: invoke(T([SearchEngine, Str(500)]), Schema.Array(S)),
  onEvent: event(BrowserEvent),
};
