import { Schema } from 'effect';
import { ArrayOf, event, Id, invoke, Str } from '../checks.ts';

// IPC structured clone keeps keys whose value is undefined, so optional fields accept undefined as well as absence.
const opt = Schema.optional;
const S = Schema.String;
const T = Schema.Tuple;

export const ProjectIconMode = Schema.Literals(['auto', 'custom', 'none']);
export type ProjectIconMode = typeof ProjectIconMode.Type;

export const Project = Schema.Struct({
  id: S,
  name: S,
  path: S,
  origin: Schema.NullOr(S),
  addedAt: Schema.Number,
  iconMode: ProjectIconMode,
  icon: Schema.NullOr(
    Schema.Struct({
      url: S,
      source: Schema.Literals(['favicon', 'custom']),
      file: opt(S),
    }),
  ),
  favicon: Schema.NullOr(S),
  isMissing: Schema.Boolean,
});
export type Project = typeof Project.Type;

/** `{ github }` caps at 200 chars, as main's handler does; the relay's own check is stricter (`relay.ts`). */
export const CloneSource = Schema.Union([
  Schema.Struct({ url: Str() }),
  Schema.Struct({ github: Str(200) }),
]);
export type CloneSource = typeof CloneSource.Type;

export const GithubRepo = Schema.Struct({
  name: S,
  description: S,
  isPrivate: Schema.Boolean,
  updatedAt: S,
});
export type GithubRepo = typeof GithubRepo.Type;

/** A GitHub login, or `host/login` for GitHub Enterprise (`parseGithubAccount`); empty runs as gh's active login. */
export const GithubUser = Str(128).check(
  Schema.isPattern(/^$|^(?:[\w.-]+\/)?[\w-]+$/),
);

const Name = Str(100);
const NonBlankName = Name.check(
  Schema.makeFilter((name) => !!name.trim() || 'A project needs a name'),
);
const Visibility = Schema.Literals(['private', 'public']);

export const projectsRpc = {
  list: invoke(T([Id]), Schema.Array(Project)),
  migrate: invoke(T([Id, ArrayOf(Str(), 1000)]), Schema.Array(Project)),
  addFolder: invoke(T([Id, Str()]), Project),
  clone: invoke(
    T([
      Id,
      CloneSource,
      Schema.Struct({
        parentDir: Str(),
        opId: Id,
        githubUser: opt(GithubUser),
      }),
    ]),
    Project,
  ),
  create: invoke(
    T([
      Id,
      Name,
      Schema.Struct({
        parentDir: Str(),
        publish: opt(Visibility),
        githubUser: opt(GithubUser),
      }),
    ]),
    Project,
  ),
  rename: invoke(T([Id, Id, NonBlankName]), Schema.Void),
  remove: invoke(T([Id, Id]), Schema.Void),
  relocate: invoke(T([Id, Id, Str()]), Project),
  // A data URL of an icon at its 512 KB cap, base64, with room for its header.
  setIcon: invoke(T([Id, Id, Str(720 * 1024)]), Project),
  githubRepos: invoke(
    T([Schema.optional(GithubUser)]),
    Schema.Array(GithubRepo),
  ),
  onChange: event(S),
  onProgress: event(Schema.Struct({ opId: S, line: S })),
};
