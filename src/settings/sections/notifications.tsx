import { Button } from '@/components/ui/button';
import { ALERT_KINDS } from '../../notify/model';
import { useHarness } from '../../store';
import { CatalogRow } from '../CatalogRow';
import { SettingsGroup, SettingsRow } from '../parts';
import { IDLE_ALERTS } from '../settingOptions';

export function NotificationsSection() {
  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup id="alertKinds" title="System alerts" footer="An OS notification while Mochi is in the background. Watched threads also alert when their turn finishes, fails or hits the usage limit. Every notice still lands in the notification list.">
        {Object.keys(ALERT_KINDS).map((kind) => (
          <CatalogRow key={kind} settingKey={`alert.${kind}`} />
        ))}
      </SettingsGroup>
      <SettingsGroup title="While Mochi is open">
        <CatalogRow settingKey="watchedToasts" />
        <CatalogRow settingKey="dockBadge" />
      </SettingsGroup>
      <SettingsGroup title="Idle threads" footer="When a thread you aren't looking at goes idle with one of these.">
        {IDLE_ALERTS.map(({ value }) => (
          <CatalogRow key={value} settingKey={`idleAlert.${value}`} />
        ))}
      </SettingsGroup>
      <QuietHoursGroup />
      <MutedThreadsGroup />
    </div>
  );
}

function QuietHoursGroup() {
  const { state } = useHarness();
  return (
    <SettingsGroup title="Quiet hours">
      <CatalogRow settingKey="quietHours" />
      {state.notifications.quiet.isOn && (
        <>
          <CatalogRow settingKey="quietFrom" />
          <CatalogRow settingKey="quietUntil" />
        </>
      )}
    </SettingsGroup>
  );
}

function MutedThreadsGroup() {
  const { state, dispatch } = useHarness();
  const muted = state.notifications.muted.map((id) => ({ id, title: state.threads.find((t) => t.id === id)?.title ?? 'Deleted thread' }));
  return (
    <SettingsGroup id="mutedThreads" title="Muted threads" footer="Mute a thread from its row in the notification list.">
      {muted.length === 0 && <SettingsRow label={<span className="text-muted-foreground">No muted threads</span>} />}
      {muted.map((t) => (
        <SettingsRow
          key={t.id}
          label={<span className="block truncate">{t.title}</span>}
          control={
            <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'notify-mute', threadId: t.id })}>
              Unmute
            </Button>
          }
        />
      ))}
    </SettingsGroup>
  );
}
