import { Schema } from 'effect';
import { Int, invoke, Str } from '../checks.ts';

const opt = Schema.optional;
const T = Schema.Tuple;

export const ListeningPort = Schema.Struct({
  port: Schema.Number,
  pid: Schema.Number,
  command: Schema.String,
  startedAt: Schema.Number,
});
export type ListeningPort = typeof ListeningPort.Type;

export const PortsListing = Schema.Union([
  Schema.Struct({ ports: Schema.Array(ListeningPort) }),
  Schema.Struct({ error: Schema.String }),
]);
export type PortsListing = typeof PortsListing.Type;

export const RunTarget = Schema.Struct({
  name: Schema.String,
  command: Schema.String,
  source: Schema.Literals(['package.json', 'launch.json']),
  port: opt(Schema.Number),
});
export type RunTarget = typeof RunTarget.Type;

/** `PortsHost` (`src/host/types/ports.ts`). Main still checks each cwd is a folder and a pid was listed. */
export const portsRpc = {
  list: invoke(
    T([Schema.Array(Str()).check(Schema.isMaxLength(256))]),
    Schema.Array(PortsListing),
  ),
  kill: invoke(
    T([Int.check(Schema.isBetween({ minimum: 2, maximum: 2 ** 31 }))]),
    Schema.Void,
  ),
  allocate: invoke(T([Str(128)]), Schema.Number),
  targets: invoke(T([Str()]), Schema.Array(RunTarget)),
};
