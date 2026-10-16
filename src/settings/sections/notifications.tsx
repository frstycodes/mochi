import { Button } from '@/components/ui/button';
import { ALERT_KINDS } from '../../notify/model';
import { useHarness } from '../../store';
import { CatalogRow } from '../CatalogRow';
import { SettingsGroup, SettingsRow } from '../parts';
import { IDLE_ALERTS } from '../settingOptions';
import { setPrefs, usePrefs } from '../prefs';

export function NotificationsSection() {
  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup id="alertKinds" title="System alerts" action={<AllAlertsButton />} footer="An OS notification while Mochi is in the background. Watched threads also alert when their turn finishes, fails or hits the usage limit. Every notice still lands in the notification list.">
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

/** Every system alert on or off at once: off while any is on, so the first click quiets everything. */
function AllAlertsButton() {
  const { alertKinds } = usePrefs();
  const isAnyOn = alertKinds.length > 0;
  return (
    <Button variant="ghost" size="sm" onClick={() => setPrefs({ alertKinds: isAnyOn ? [] : Object.keys(ALERT_KINDS) })}>
      {isAnyOn ? 'Turn all off' : 'Turn all on'}
    </Button>
  );
}

function MutedThreadsGroup() {
  const { state, dispatch } = useHarness();
  const muted = state.notifications.muted.map((id) => ({ id, title: state.threads.find((t) => t.id === id)?.title ?? 'Deleted thread' }));
  if (!muted.length) return <NoMutedThreads />;
  return (
    <SettingsGroup id="mutedThreads" title="Muted threads" footer="Mute a thread from its row in the notification list.">
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

/** Nothing to unmute: one line where the list would be, still the target of a search for muted threads. */
function NoMutedThreads() {
  return (
    <p data-setting-id="mutedThreads" className="rounded-xl px-1 type-meta text-muted-foreground transition-colors duration-700 data-flash:bg-accent/60">
      No muted threads. Mute one from its row in the notification list.
    </p>
  );
}
