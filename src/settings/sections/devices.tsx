import { Switch } from '@/components/ui/switch';
import type { ConnectedDevice, RemoteStatus } from '../../host/types/remote';
import { useRemoteStatus } from '../../remote/useRemoteStatus';
import { CommitInput, DesktopOnly, SettingsGroup, SettingsRow, settingControlId } from '../parts';

/** Turning on remote access, how far it reaches, what this computer is called, and who is connected. */
export function DevicesSection() {
  return (
    <DesktopOnly what="Other devices connect to Mochi running on a computer.">
      <Devices />
    </DesktopOnly>
  );
}

function Devices() {
  const { status, update } = useRemoteStatus();
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
      <SettingsGroup id="connectedDevices" title="Connected devices" footer="Pairing a device needs a Mochi account, which isn’t available yet.">
        {status.devices.length === 0 && <SettingsRow label={<span className="text-muted-foreground">No devices connected</span>} />}
        {status.devices.map((device) => (
          <DeviceRow key={`${device.id}-${device.connectedAt}`} device={device} />
        ))}
      </SettingsGroup>
    </div>
  );
}

function ListeningState({ status }: { status: RemoteStatus }) {
  if (status.error) return <span className="text-warning">{status.error}</span>;
  if (!status.settings.isEnabled) return 'Off';
  if (status.addresses.length === 0) return 'Starting…';
  return `Listening on ${new Intl.ListFormat('en', { type: 'conjunction' }).format(status.addresses)}`;
}

function DeviceRow({ device }: { device: ConnectedDevice }) {
  const since = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(device.connectedAt);
  return <SettingsRow label={<span className="block truncate">{device.name}</span>} description={`Connected since ${since} · ${new Intl.ListFormat('en', { type: 'unit' }).format(device.scopes)}`} />;
}
