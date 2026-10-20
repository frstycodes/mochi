import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { toast } from '@/toast/store';
import { useMochiAccount } from '../../account/useMochiAccount';
import { useConfirm } from '../../git/useConfirm';
import { host } from '../../host';
import { SCOPES, type DeviceKind, type MemberInfo, type OtherMachine, type RemoteStatus, type Scope } from '../../host/types/remote';
import { DeviceIcon } from '../../remote/DeviceIcon';
import { PairingCode } from '../../remote/PairingCode';
import { useOtherMachines } from '../../remote/useOtherMachines';
import { useRemoteStatus } from '../../remote/useRemoteStatus';
import { ipcMessage } from '../AgentSettings';
import { CommitInput, DesktopOnly, SettingsGroup, SettingsRow, settingControlId } from '../parts';

/** Turning on remote access, how far it reaches, what this computer is called, your computers, and joining them. */
export function RemoteSection() {
  return (
    <DesktopOnly what="Other devices connect to Mochi running on a computer.">
      <RemoteAccess />
    </DesktopOnly>
  );
}

function RemoteAccess() {
  const { status, update } = useRemoteStatus();
  const { account } = useMochiAccount();
  const isSignedIn = account?.status === 'signed-in';
  if (!status) return null;
  const { settings } = status;
  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup title="This computer" footer="While devices can control it, closing the window keeps Mochi running in the background. The relay is encrypted between your devices; it can’t read anything.">
        <SettingsRow
          id="remoteEnabled"
          label="Let devices control this computer"
          description={<ListeningState status={status} />}
          control={<Switch id={settingControlId('remoteEnabled')} checked={settings.isEnabled} onCheckedChange={(isEnabled) => void update({ isEnabled })} />}
        />
        <SettingsRow
          id="remoteNetwork"
          label="Allow devices on this network"
          description="Your local network or Tailscale; Windows Firewall may ask once"
          control={<Switch id={settingControlId('remoteNetwork')} checked={settings.allowsNetwork} onCheckedChange={(allowsNetwork) => void update({ allowsNetwork })} />}
        />
        <SettingsRow
          id="remoteAnywhere"
          label="Reach this computer from anywhere"
          description={isSignedIn ? <RelayState status={status} /> : 'Needs your Mochi account'}
          control={<Switch id={settingControlId('remoteAnywhere')} checked={settings.reachesAnywhere} disabled={!isSignedIn || !settings.isEnabled} onCheckedChange={(reachesAnywhere) => void update({ reachesAnywhere })} />}
        />
        <SettingsRow
          id="keepAwake"
          label="Keep this computer awake"
          description={<AwakeState status={status} />}
          control={<Switch id={settingControlId('keepAwake')} checked={settings.keepsAwake} disabled={!settings.isEnabled} onCheckedChange={(keepsAwake) => void update({ keepsAwake })} />}
        />
        <SettingsRow id="machineName" label="Computer name" description="How your devices list this computer" control={<CommitInput id={settingControlId('machineName')} value={settings.machineName} placeholder={status.hostName} maxLength={64} onCommit={(machineName) => void update({ machineName })} />} />
      </SettingsGroup>
      <Members status={status} />
      <OtherComputers isSignedIn={isSignedIn} />
    </div>
  );
}

function ListeningState({ status }: { status: RemoteStatus }) {
  if (status.error) return <span className="text-warning">{status.error}</span>;
  if (!status.settings.isEnabled) return 'Off';
  if (status.addresses.length === 0) return 'Starting…';
  return `Listening on ${new Intl.ListFormat('en', { type: 'conjunction' }).format(status.addresses)}`;
}

function AwakeState({ status }: { status: RemoteStatus }) {
  if (status.isOnBattery && status.settings.isEnabled && status.settings.keepsAwake) return <span className="text-warning">On battery, it drains the charge while a thread works or a device is connected</span>;
  return 'While a thread works or a device is connected, so it doesn’t sleep under them';
}

function RelayState({ status }: { status: RemoteStatus }) {
  if (!status.settings.isEnabled) return 'Turn on “Let devices control this computer” first';
  const { relay } = status;
  if (relay.status === 'error') return <span className="text-warning">{relay.error}</span>;
  if (relay.status === 'connected') return 'Connected to Mochi’s relay';
  if (relay.status === 'connecting') return 'Connecting to Mochi’s relay…';
  return 'Off';
}

function Members({ status }: { status: RemoteStatus }) {
  const { confirm, dialog } = useConfirm();
  const remove = async (member: MemberInfo) => {
    const isConfirmed = await confirm({
      title: `Remove “${member.name}” from your computers?`,
      description: 'It disconnects from every computer of yours, and has to join again, with an approval on one of them.',
      confirm: 'Remove computer',
      cancel: 'Keep computer',
      isDestructive: true,
    });
    if (isConfirmed) await host.remote.removeMember(member.id).catch((e: Error) => toast.error('Couldn’t remove it', { description: ipcMessage(e) }));
  };
  return (
    <SettingsGroup id="members" title="Your computers" footer={MEMBERS_FOOTER}>
      {dialog}
      {status.isRemoved && <SettingsRow label={<span className="text-warning">Another of your computers removed this one</span>} description="Join again below to reach your computers." />}
      {!status.isRemoved && status.members.length === 0 && <SettingsRow label={<span className="text-muted-foreground">Only this computer so far</span>} description="Join one of your other computers below; the rest follow on their own." />}
      {status.members.map((member) => (
        <SettingsRow
          key={member.id}
          label={<DeviceName kind={member.kind} name={member.name} />}
          description={memberDescription(member, status)}
          control={
            <Button size="sm" variant="outline" onClick={() => void remove(member)}>
              Remove
            </Button>
          }
        >
          <ScopeToggles member={member} />
        </SettingsRow>
      ))}
    </SettingsGroup>
  );
}

const SCOPE_LABELS = { read: 'Read', operate: 'Operate', manage: 'Manage', code: 'Code', terminal: 'Terminal' } satisfies Record<Scope, string>;

const MEMBERS_FOOTER =
  'Each reaches the others with no more approvals. What each may do here: Read follows threads and the Queue. Operate answers, sends, stops, forks and hands off. Manage starts, renames, pins and settles threads, edits goals and schedules, and commits, pushes and opens PRs. Code reads files and diffs. Terminal is a shell on this computer. A change reconnects that computer. Removing one removes it everywhere.';

/** What the member may do here; terminal starts off, as a shell on this computer. */
function ScopeToggles({ member }: { member: MemberInfo }) {
  return (
    <ToggleGroup
      type="multiple"
      size="sm"
      variant="outline"
      value={member.scopes}
      aria-label={`What ${member.name} may do here`}
      onValueChange={(next) => void host.remote.setDeviceScopes(member.id, SCOPES.filter((s) => next.includes(s))).catch((e: Error) => toast.error('Couldn’t change what it may do', { description: ipcMessage(e) }))}
    >
      {SCOPES.map((scope) => (
        <ToggleGroupItem key={scope} value={scope}>
          {SCOPE_LABELS[scope]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function memberDescription(member: MemberInfo, status: RemoteStatus) {
  if (status.devices.some((d) => d.id === member.id) || member.machineStatus === 'online') return 'Connected';
  return `Joined ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(member.addedAt)}`;
}

function OtherComputers({ isSignedIn }: { isSignedIn: boolean }) {
  const { machines, error, refresh, joining, join, closeJoining } = useOtherMachines(isSignedIn);
  const { signIn } = useMochiAccount();
  const footer = 'Join through any one of your computers and you reach all of them. Both screens show the same code; check they match before allowing.';
  if (!isSignedIn)
    return (
      <SettingsGroup id="otherComputers" title="Join your computers" footer={footer}>
        <SettingsRow label="Sign in to see your other computers" control={<Button size="sm" variant="outline" onClick={() => void signIn()}>Sign in</Button>} />
      </SettingsGroup>
    );
  return (
    <SettingsGroup id="otherComputers" title="Join your computers" footer={footer}>
      {!!error && <SettingsRow label={<span className="text-warning">{error}</span>} control={<Button size="sm" variant="outline" onClick={() => void refresh()}>Try again</Button>} />}
      {!error && !machines && <SettingsRow label={<span className="text-muted-foreground">Loading…</span>} />}
      {machines?.length === 0 && <SettingsRow label={<span className="text-muted-foreground">No other computers to join</span>} description="Sign in on another computer and turn on “Reach this computer from anywhere” there." />}
      {machines?.map((machine) => (
        <SettingsRow
          key={machine.id}
          label={<DeviceName kind={undefined} name={machine.name} />}
          description={machine.isOnline ? 'Online' : 'Offline'}
          control={
            <Button size="sm" disabled={!machine.isOnline} onClick={() => void join(machine)}>
              Join
            </Button>
          }
        />
      ))}
      <JoiningDialog joining={joining} onClose={closeJoining} />
    </SettingsGroup>
  );
}

/** While joining: the code to compare with the other computer's screen, until it answers. */
function JoiningDialog({ joining, onClose }: { joining: { machine: OtherMachine; error?: string } | null; onClose: () => void }) {
  return (
    <Dialog open={!!joining} onOpenChange={(open) => !open && onClose()}>
      {!!joining && (
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Joining through {joining.machine.name}</DialogTitle>
            <DialogDescription>On {joining.machine.name}, let this computer join if it shows this code:</DialogDescription>
          </DialogHeader>
          <PairingCode code={joining.machine.pairingCode} />
          {joining.error ? (
            <p role="alert" className="type-caption text-destructive">
              {joining.error}
            </p>
          ) : (
            <p role="status" className="flex items-center gap-2 type-meta text-muted-foreground">
              <Spinner className="size-3.5" />
              Waiting for {joining.machine.name}…
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {joining.error ? 'Close' : 'Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

function DeviceName({ kind, name }: { kind: DeviceKind | undefined; name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <DeviceIcon kind={kind} className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{name}</span>
    </span>
  );
}
