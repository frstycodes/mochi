import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { toast } from '@/toast/store';
import { useMochiAccount } from '../../account/useMochiAccount';
import { useConfirm } from '../../git/useConfirm';
import { host } from '../../host';
import { SCOPES, type DeviceKind, type OtherMachine, type PairedDeviceInfo, type RemoteStatus, type Scope } from '../../host/types/remote';
import { DeviceIcon } from '../../remote/DeviceIcon';
import { PairingCode } from '../../remote/PairingCode';
import { useOtherMachines } from '../../remote/useOtherMachines';
import { useRemoteStatus } from '../../remote/useRemoteStatus';
import { ipcMessage } from '../AgentSettings';
import { openSettings } from '../open';
import { CommitInput, DesktopOnly, SettingsGroup, SettingsRow, settingControlId } from '../parts';

/** Turning on remote access, how far it reaches, what this computer is called, who is paired, and your other computers. */
export function DevicesSection() {
  return (
    <DesktopOnly what="Other devices connect to Mochi running on a computer.">
      <Devices />
    </DesktopOnly>
  );
}

function Devices() {
  const { status, update } = useRemoteStatus();
  const { account } = useMochiAccount();
  const isSignedIn = account?.status === 'signed-in';
  if (!status) return null;
  const { settings } = status;
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="Your other devices can follow and steer threads running here. While this is on, closing the window keeps Mochi running in the background so they can still reach it.">
        <SettingsRow
          id="remoteEnabled"
          label="Let devices control this computer"
          description={<ListeningState status={status} />}
          control={<Switch id={settingControlId('remoteEnabled')} checked={settings.isEnabled} onCheckedChange={(isEnabled) => void update({ isEnabled })} />}
        />
      </SettingsGroup>
      <SettingsGroup footer="Off, only this computer can connect. On, devices on your local network or Tailscale can too. On Windows, Windows Defender Firewall may ask whether to allow Mochi the first time.">
        <SettingsRow
          id="remoteNetwork"
          label="Allow devices on this network"
          control={<Switch id={settingControlId('remoteNetwork')} checked={settings.allowsNetwork} onCheckedChange={(allowsNetwork) => void update({ allowsNetwork })} />}
        />
        <SettingsRow id="machineName" label="Computer name" description="How your devices list this computer" control={<CommitInput id={settingControlId('machineName')} value={settings.machineName} placeholder={status.hostName} maxLength={64} onCommit={(machineName) => void update({ machineName })} />} />
      </SettingsGroup>
      <SettingsGroup footer="Through Mochi’s relay, your devices reach this computer when they aren’t on its network. Everything is encrypted between your devices; the relay can’t read it.">
        <SettingsRow
          id="remoteAnywhere"
          label="Reach this computer from anywhere"
          description={isSignedIn ? <RelayState status={status} /> : 'Needs your Mochi account'}
          control={<Switch id={settingControlId('remoteAnywhere')} checked={settings.reachesAnywhere} disabled={!isSignedIn || !settings.isEnabled} onCheckedChange={(reachesAnywhere) => void update({ reachesAnywhere })} />}
        />
      </SettingsGroup>
      <PairedDevices status={status} />
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

function RelayState({ status }: { status: RemoteStatus }) {
  if (!status.settings.isEnabled) return 'Turn on “Let devices control this computer” first';
  const { relay } = status;
  if (relay.status === 'error') return <span className="text-warning">{relay.error}</span>;
  if (relay.status === 'connected') return 'Connected to Mochi’s relay';
  if (relay.status === 'connecting') return 'Connecting to Mochi’s relay…';
  return 'Off';
}

function PairedDevices({ status }: { status: RemoteStatus }) {
  const { confirm, dialog } = useConfirm();
  const remove = async (device: PairedDeviceInfo) => {
    const isConfirmed = await confirm({
      title: `Remove “${device.name}”?`,
      description: 'It disconnects now and has to pair again, with your approval here, to reach this computer.',
      confirm: 'Remove device',
      cancel: 'Keep device',
      isDestructive: true,
    });
    if (isConfirmed) await host.remote.removeDevice(device.id);
  };
  return (
    <SettingsGroup id="pairedDevices" title="Paired devices" footer={PAIRED_FOOTER}>
      {dialog}
      {status.pairedDevices.length === 0 && <SettingsRow label={<span className="text-muted-foreground">No paired devices</span>} />}
      {status.pairedDevices.map((device) => (
        <SettingsRow
          key={device.id}
          label={<DeviceName kind={device.kind} name={device.name} />}
          description={pairedDescription(device, status)}
          control={
            <Button size="sm" variant="outline" onClick={() => void remove(device)}>
              Remove
            </Button>
          }
        >
          <ScopeToggles device={device} />
        </SettingsRow>
      ))}
    </SettingsGroup>
  );
}

const SCOPE_LABELS = { read: 'Read', operate: 'Operate', manage: 'Manage', code: 'Code', terminal: 'Terminal' } satisfies Record<Scope, string>;

const PAIRED_FOOTER =
  'Read follows threads and the Queue. Operate answers, sends, stops, forks and hands off. Manage starts, renames, pins and settles threads, edits goals and schedules, and commits, pushes and opens PRs. Code reads files and diffs. Terminal is a shell on this computer. A change reconnects the device. A new device pairs from its own Settings › Devices, and you approve it here.';

/** What the device may do here; terminal starts off, as a shell on this computer. */
function ScopeToggles({ device }: { device: PairedDeviceInfo }) {
  return (
    <ToggleGroup
      type="multiple"
      size="sm"
      variant="outline"
      spacing={1}
      value={device.scopes}
      aria-label={`What ${device.name} may do`}
      onValueChange={(next) => void host.remote.setDeviceScopes(device.id, SCOPES.filter((s) => next.includes(s))).catch((e: Error) => toast.error('Couldn’t change what it may do', { description: ipcMessage(e) }))}
    >
      {SCOPES.map((scope) => (
        <ToggleGroupItem key={scope} value={scope}>
          {SCOPE_LABELS[scope]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function pairedDescription(device: PairedDeviceInfo, status: RemoteStatus) {
  const isConnected = status.devices.some((d) => d.id === device.id);
  return isConnected ? 'Connected' : `Paired ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(device.pairedAt)}`;
}

function OtherComputers({ isSignedIn }: { isSignedIn: boolean }) {
  const { machines, error, refresh, pairing, pair, forget, closePairing } = useOtherMachines(isSignedIn);
  const footer = 'Pair with another computer of yours to follow and steer its threads from here. Both screens show the same code; check they match before allowing.';
  if (!isSignedIn)
    return (
      <SettingsGroup id="otherComputers" title="Your other computers" footer={footer}>
        <SettingsRow label="Sign in to see your other computers" control={<Button size="sm" variant="outline" onClick={() => openSettings('account')}>Open Account</Button>} />
      </SettingsGroup>
    );
  return (
    <SettingsGroup id="otherComputers" title="Your other computers" footer={footer}>
      {!!error && <SettingsRow label={<span className="text-warning">{error}</span>} control={<Button size="sm" variant="outline" onClick={() => void refresh()}>Try again</Button>} />}
      {!error && !machines && <SettingsRow label={<span className="text-muted-foreground">Loading…</span>} />}
      {machines?.length === 0 && <SettingsRow label={<span className="text-muted-foreground">No other computers yet</span>} description="Sign in on another computer and turn on “Reach this computer from anywhere” there." />}
      {machines?.map((machine) => (
        <SettingsRow
          key={machine.id}
          label={<DeviceName kind={machine.kind} name={machine.name} />}
          description={machineDescription(machine)}
          control={<MachineAction machine={machine} onPair={() => void pair(machine)} onForget={() => void forget(machine)} />}
        />
      ))}
      <PairingDialog pairing={pairing} onClose={closePairing} />
    </SettingsGroup>
  );
}

const machineDescription = (machine: OtherMachine) => [machine.isPaired ? 'Paired' : 'Not paired', machine.isOnline ? 'Online' : 'Offline'].join(' · ');

function MachineAction({ machine, onPair, onForget }: { machine: OtherMachine; onPair: () => void; onForget: () => void }) {
  if (machine.isPaired)
    return (
      <Button size="sm" variant="outline" onClick={onForget}>
        Forget
      </Button>
    );
  return (
    <Button size="sm" disabled={!machine.isOnline} onClick={onPair}>
      Pair
    </Button>
  );
}

/** While pairing: the code to compare with the other computer's screen, until it answers. */
function PairingDialog({ pairing, onClose }: { pairing: { machine: OtherMachine; error?: string } | null; onClose: () => void }) {
  return (
    <Dialog open={!!pairing} onOpenChange={(open) => !open && onClose()}>
      {!!pairing && (
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Pairing with {pairing.machine.name}</DialogTitle>
            <DialogDescription>On {pairing.machine.name}, allow this computer if it shows this code:</DialogDescription>
          </DialogHeader>
          <PairingCode code={pairing.machine.pairingCode} />
          {pairing.error ? (
            <p role="alert" className="type-caption text-destructive">
              {pairing.error}
            </p>
          ) : (
            <p role="status" className="flex items-center gap-2 type-meta text-muted-foreground">
              <Spinner className="size-3.5" />
              Waiting for {pairing.machine.name}…
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {pairing.error ? 'Close' : 'Cancel'}
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
