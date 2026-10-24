import { Schema, SchemaTransformation, Tuple } from 'effect';

type Fields = Schema.Struct.Fields;

// Unversioned data has no `v`; without this a newer version's record would read as unversioned, its `v` dropped as excess.
const NO_V = { v: Schema.optionalKey(Schema.Never) };

/**
 * A record at version `n`: decodes `{ v: n, ...fields }`, and data saved before versioning (no `v`) as version `n`. Encoding
 * always writes `v`.
 */
export function versioned<const N extends number, F extends Fields>(n: N, unversioned: Schema.Struct<F>) {
  return withLegacy(n, unversioned.pipe(Schema.fieldsAssign({ v: Schema.Literal(n) })), unversioned.pipe(Schema.fieldsAssign(NO_V)));
}

/** `versioned` for a union of records: each member gets `v`. */
export function versionedUnion<const N extends number, M extends ReadonlyArray<Schema.Struct<Fields>>>(n: N, unversioned: Schema.Union<M>) {
  const current = unversioned.mapMembers(Tuple.map(Schema.fieldsAssign({ v: Schema.Literal(n) })));
  // Each member is a struct, so the mapped union is a schema; TS can't see that through the generic member list.
  const legacy = unversioned.mapMembers(Tuple.map(Schema.fieldsAssign(NO_V)));
  return withLegacy(n, current as typeof current & Schema.Top, legacy as typeof legacy & Schema.Top);
}

/**
 * Reads version `from` as the next one: `up` lifts an old record. Union this with the current schema, current first, so
 * encoding writes the current version: `Schema.Union([V2, upgrade(V1, V2, up, down)])`.
 */
export function upgrade<From extends Schema.Top, To extends Schema.Top>(from: From, to: To, up: (old: From['Type']) => To['Encoded'], down: (current: To['Encoded']) => From['Type']) {
  return from.pipe(Schema.decodeTo(to, SchemaTransformation.transform({ decode: up, encode: down })));
}

function withLegacy<Current extends Schema.Top, Legacy extends Schema.Top>(n: number, current: Current, legacy: Legacy) {
  // A generic spread can't be typed against each member's shape; callers get exact types from `current`.
  const up = (old: Legacy['Type']) => ({ ...(old as object), v: n }) as Current['Encoded'];
  const down = (record: Current['Encoded']) => {
    const { v: _, ...old } = record as { v: number };
    return old as Legacy['Type'];
  };
  return Schema.Union([current, upgrade(legacy, current, up, down)]);
}
