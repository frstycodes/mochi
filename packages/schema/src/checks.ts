import { Schema } from 'effect';

/** A string up to `max` chars: the limits main's IPC handlers enforce today (`electron/ipc/handlers.ts` `string`). */
export const Str = (max = 4096) => Schema.String.check(Schema.isMaxLength(max));

/** Thread, request, tool and task ids. */
export const Id = Str(256);

/** A profile id: it names folders on disk (`spaceIdOf`). */
export const SpaceId = Str(128).check(Schema.isPattern(/^[a-z0-9-]+$/));

export const Int = Schema.Number.check(Schema.isInt());

export const JsonObject = Schema.Record(Schema.String, Schema.Unknown);

/** A `T[]` of at most `max` items. */
export const ArrayOf = <S extends Schema.Top>(item: S, max: number) =>
  Schema.Array(item).check(Schema.isMaxLength(max));

/** A method's arguments, in order, and what its promise resolves to. */
export const invoke = <I extends Schema.Top, O extends Schema.Top>(
  input: I,
  output: O,
) => ({ input, output });

/** A push channel (`on*` methods): what each callback gets. */
export const event = <E extends Schema.Top>(payload: E) => ({ event: payload });
