import { Schema } from 'effect';
import { event, Int, invoke, Str } from '../checks.ts';
import { CommandResult, DeviceKind, RemoteCommand, RemoteCommandRequest, Scope, StreamFrame } from '../relay.ts';

const opt = Schema.optional;
const S = Schema.String;
const N = Schema.Number;
const B = Schema.Boolean;
const T = Schema.Tuple;
const Void = Schema.Void;


export const RemoteSettings = Schema.Struct({ isEnabled: B, allowsNetwork: B, machineName: S, reachesAnywhere: B, keepsAwake: B });
export type RemoteSettings = typeof RemoteSettings.Type;

export const RelayState = Schema.Union([
  Schema.Struct({ status: Schema.Literal('off') }),
  Schema.Struct({ status: Schema.Literal('connecting') }),
  Schema.Struct({ status: Schema.Literal('connected') }),
  Schema.Struct({ status: Schema.Literal('error'), error: S }),
]);
export type RelayState = typeof RelayState.Type;

const MachineStatus = Schema.Literals(['connecting', 'online', 'offline', 'refused']);

export const FollowedMachine = Schema.Struct({
  id: S,
  name: S,
  kind: opt(DeviceKind),
  status: MachineStatus,
  route: opt(Schema.Literals(['lan', 'relay'])),
  scopes: Schema.Array(Scope),
  error: opt(S),
  lastSeenAt: opt(N),
});
export type FollowedMachine = typeof FollowedMachine.Type;

export const MemberInfo = Schema.Struct({ id: S, name: S, kind: opt(DeviceKind), scopes: Schema.Array(Scope), addedAt: N, machineStatus: opt(MachineStatus) });
export type MemberInfo = typeof MemberInfo.Type;

export const OtherMachine = Schema.Struct({ id: S, name: S, isOnline: B, pairingCode: S });
export type OtherMachine = typeof OtherMachine.Type;


export const ApprovalRequest = Schema.Struct({ id: S, name: S, pairingCode: S, expiresAt: N });
export type ApprovalRequest = typeof ApprovalRequest.Type;

export const ConnectedDevice = Schema.Struct({ id: S, name: S, kind: opt(DeviceKind), scopes: Schema.Array(Scope), connectedAt: N });
export type ConnectedDevice = typeof ConnectedDevice.Type;

export const RemoteStatus = Schema.Struct({
  settings: RemoteSettings,
  hostName: S,
  addresses: Schema.Array(S),
  devices: Schema.Array(ConnectedDevice),
  members: Schema.Array(MemberInfo),
  isRemoved: B,
  relay: RelayState,
  isOnBattery: B,
  error: opt(S),
});
export type RemoteStatus = typeof RemoteStatus.Type;

const MAX_ACTION_CHARS = 64 * 1024 * 1024;
const MachineId = Str(64);
const Epoch = Str(64);
const Seq = Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));

export const remoteRpc = {
  status: invoke(T([]), RemoteStatus),
  set: invoke(T([Schema.Struct({ isEnabled: opt(B), allowsNetwork: opt(B), machineName: opt(Str(64)), reachesAnywhere: opt(B), keepsAwake: opt(B) })]), RemoteStatus),
  onStatus: event(RemoteStatus),
  push: invoke(T([Epoch, Seq.check(Schema.isGreaterThanOrEqualTo(1)), Str(MAX_ACTION_CHARS)]), Void),
  snapshot: invoke(T([Str(64), Epoch, Seq, Str(MAX_ACTION_CHARS)]), Void),
  onSnapshotRequest: event(S),
  onCommand: event(RemoteCommandRequest),
  commandResult: invoke(T([Str(128), CommandResult]), Void),
  removeMember: invoke(T([MachineId]), RemoteStatus),
  setDeviceScopes: invoke(T([MachineId, Schema.Array(Scope)]), RemoteStatus),
  onApproval: event(ApprovalRequest),
  answerApproval: invoke(T([MachineId, B]), Void),
  otherMachines: invoke(T([]), Schema.Array(OtherMachine)),
  join: invoke(T([MachineId]), Void),
  machines: invoke(T([]), Schema.Array(FollowedMachine)),
  onMachines: event(Schema.Array(FollowedMachine)),
  follow: invoke(T([]), Void),
  onMachineFrame: event(Schema.Struct({ machineId: S, frame: StreamFrame })),
  cacheMachine: invoke(T([MachineId, Str(MAX_ACTION_CHARS)]), Void),
  cachedMachines: invoke(T([]), Schema.Array(Schema.Struct({ machineId: S, saved: S }))),
  command: invoke(T([MachineId, RemoteCommand]), CommandResult),
};

export { CatalogProject, CommandResult, DeviceKind, MachineCatalog, RemoteCommand, RemoteCommandRequest, Scope, StreamFrame, TerminalOutput, ThreadPoint } from '../relay.ts';
