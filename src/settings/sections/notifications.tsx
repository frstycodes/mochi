import { Button } from '@/components/ui/button';
import { ALERT_KINDS } from '../../notify/model';
import { useHarness } from '../../store';
import { CatalogRow } from '../CatalogRow';
import { SettingsGroup, SettingsRow } from '../parts';

export function NotificationsSection() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup id="alertKinds" title="System alerts" footer="An OS notification while Mochi is in the background. Watched threads also alert when their turn finishes, fails or hits the usage limit, and with every window closed. Every notice still lands in the notification list.">
        {Object.keys(ALERT_KINDS).map((kind) => (
          <CatalogRow key={kind} settingKey={`alert.${kind}`} />
        ))}
      </SettingsGroup>
      <SettingsGroup footer="Toasts show while Mochi is in front, only for threads you watch.">
        <CatalogRow settingKey="watchedToasts" />
        <CatalogRow settingKey="dockBadge" />
      </SettingsGroup>
      <QuietHoursGroup />
      <MutedThreadsGroup />
    </div>
  );
}

function QuietHoursGroup() {
  const { state } = useHarness();
  return (
    <SettingsGroup footer="No alerts or toasts in these hours; the notification list still fills.">
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
