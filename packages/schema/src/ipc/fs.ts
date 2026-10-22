import { Schema } from 'effect';
import { event, Int, invoke, Str } from '../checks.ts';

const T = Schema.Tuple;
const o = Schema.optional;
const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const SearchId = Str(64);

export const FileContent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('text'), text: S, mtimeMs: N }),
  // Structured clone carries the bytes over IPC; a JSON transport needs `Schema.Uint8ArrayFromBase64` here.
  Schema.Struct({ kind: Schema.Literal('binary'), bytes: Schema.Uint8Array, mtimeMs: N }),
]);
export type FileContent = typeof FileContent.Type;

export const WriteResult = Schema.Union([Schema.Struct({ status: Schema.Literal('saved'), mtimeMs: N }), Schema.Struct({ status: Schema.Literal('conflict'), text: S, mtimeMs: N })]);
export type WriteResult = typeof WriteResult.Type;

export const SearchOptions = Schema.Struct({ isCaseSensitive: B, isRegex: B, isWholeWord: B });

export const SearchLine = Schema.Struct({ line: N, text: S, isCut: B, ranges: Schema.Array(Schema.Tuple([N, N])), column: Schema.Tuple([N, N]) });

export const SearchHits = Schema.Struct({ id: S, path: S, lines: Schema.Array(SearchLine) });
export type SearchHits = typeof SearchHits.Type;

export const SearchSummary = Schema.Struct({ isTruncated: B });

export const FsChange = Schema.Struct({ root: S, path: S });

export const DiskFile = Schema.Struct({ root: S, path: S });
export type DiskFile = typeof DiskFile.Type;

export const Editor = Schema.Literals(['vscode', 'cursor', 'zed']);
export type Editor = typeof Editor.Type;

/** `FsHost` (`src/host/types/fs.ts`). Main still resolves each path inside its root. */
export const fsRpc = {
  list: invoke(T([Str()]), Schema.Array(S)),
  read: invoke(T([Str(), Str()]), FileContent),
  write: invoke(T([Str(), Str(), Str(5 * 1024 * 1024), Schema.Struct({ baseMtimeMs: Schema.Finite, force: Schema.optional(B) })]), WriteResult),
  watch: invoke(T([Str()]), Schema.Void),
  unwatch: invoke(T([Str()]), Schema.Void),
  onChange: event(FsChange),
  search: invoke(T([Str(), SearchId, Str(1024), SearchOptions]), SearchSummary),
  cancelSearch: invoke(T([SearchId]), Schema.Void),
  onSearchHits: event(SearchHits),
  editors: invoke(T([]), Schema.Array(Editor)),
  openIn: invoke(T([Editor, Str(), Str(), o(Int.check(Schema.isGreaterThan(0)))]), Schema.Void),
  reveal: invoke(T([Str(), Str()]), Schema.Void),
  pickFolder: invoke(T([o(Str())]), Schema.NullOr(S)),
  folders: invoke(T([Str()]), Schema.NullOr(Schema.Struct({ path: S, names: Schema.Array(S) }))),
  entries: invoke(T([Str()]), Schema.NullOr(Schema.Struct({ path: S, dirs: Schema.Array(S), files: Schema.Array(S) }))),
};
