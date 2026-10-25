import { Schema } from 'effect';
import { Int, invoke, Str } from '../checks.ts';

const opt = Schema.optional;
const S = Schema.String;
const T = Schema.Tuple;
const Void = Schema.Void;

export const ThemeKind = Schema.Literals([
  'light',
  'dark',
  'hc-light',
  'hc-dark',
]);
export type ThemeKind = typeof ThemeKind.Type;

export const TokenColor = Schema.Struct({
  name: opt(S),
  scope: opt(Schema.Union([S, Schema.Array(S)])),
  settings: Schema.Struct({
    foreground: opt(S),
    background: opt(S),
    fontStyle: opt(S),
  }),
});
export type TokenColor = typeof TokenColor.Type;

/** A VS Code color theme after its `include` chain is merged (`src/themes/model.ts`). */
export const VsCodeTheme = Schema.Struct({
  name: opt(S),
  type: opt(S),
  colors: Schema.Record(S, S),
  tokenColors: Schema.Array(TokenColor),
  semanticTokenColors: opt(Schema.Record(S, Schema.Unknown)),
  semanticHighlighting: opt(Schema.Boolean),
});
export type VsCodeTheme = typeof VsCodeTheme.Type;

export const ThemeSource = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('mochi') }),
  Schema.Struct({
    kind: Schema.Literal('marketplace'),
    namespace: S,
    name: S,
    version: S,
    displayName: S,
    publisher: S,
  }),
  Schema.Struct({ kind: Schema.Literal('custom'), file: S }),
]);
export type ThemeSource = typeof ThemeSource.Type;

/** Also what the web build keeps in browser storage (`src/host/web/themes.ts`); `stored.ts` versions it there. */
export const ColorTheme = Schema.Struct({
  id: S,
  label: S,
  kind: ThemeKind,
  source: ThemeSource,
  theme: VsCodeTheme,
});
export type ColorTheme = typeof ColorTheme.Type;

export const MarketplaceExtension = Schema.Struct({
  namespace: S,
  name: S,
  version: S,
  displayName: S,
  description: S,
  downloadCount: Schema.Number,
  iconUrl: opt(S),
  themes: Schema.Array(Schema.Struct({ label: S, kind: ThemeKind })),
});
export type MarketplaceExtension = typeof MarketplaceExtension.Type;

export const SearchResult = Schema.Struct({
  total: Schema.Number,
  extensions: Schema.Array(MarketplaceExtension),
});
export type SearchResult = typeof SearchResult.Type;

// An extension reference becomes part of an Open VSX URL (`checkRef`); a custom file a path under userData (`checkCustomFile`).
const Segment = S.check(Schema.isPattern(/^[\w-][\w.-]{0,127}$/));
const Version = S.check(Schema.isPattern(/^[\w.+-]{1,64}$/));
const CustomFile = S.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}\.jsonc?$/i),
);
const DisplayName = Str(256);
/** `LIMITS.fileBytes` in `src/themes/vsix.ts`. */
const MAX_THEME_CHARS = 4 * 1024 * 1024;

export const themesRpc = {
  list: invoke(T([]), Schema.Array(ColorTheme)),
  search: invoke(
    T([
      Str(128),
      Int.check(Schema.isBetween({ minimum: 0, maximum: 100_000 })),
    ]),
    SearchResult,
  ),
  inspect: invoke(
    T([Segment, Segment, Version, DisplayName]),
    Schema.Array(ColorTheme),
  ),
  install: invoke(
    T([Segment, Segment, Version, DisplayName]),
    Schema.Array(ColorTheme),
  ),
  uninstall: invoke(T([Segment, Segment]), Void),
  importFile: invoke(T([]), Schema.NullOr(ColorTheme)),
  saveCustom: invoke(
    T([Str(MAX_THEME_CHARS), Schema.optional(CustomFile)]),
    ColorTheme,
  ),
  readCustom: invoke(T([CustomFile]), S),
  openCustom: invoke(T([CustomFile]), Void),
  removeCustom: invoke(T([CustomFile]), Void),
};
