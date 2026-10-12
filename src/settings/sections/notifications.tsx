import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { ALERT_KINDS, hourLabel } from '../../notify/model';
import { useHarness } from '../../store';
import { SettingsChoice, SettingsGroup, SettingsRow, settingControlId } from '../parts';
import { setPrefs, usePrefs } from '../prefs';

export function NotificationsSection() {
  const { alertKinds, watchedToasts, dockBadge } = usePrefs();
  const toggleKind = (kind: string, isOn: boolean) => setPrefs({ alertKinds: isOn ? [...alertKinds, kind] : alertKinds.filter((k) => k !== kind) });
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup id="alertKinds" title="System alerts" footer="An OS notification while Mochi is in the background. Every notice still lands in the notification list.">
        {Object.entries(ALERT_KINDS).map(([kind, label]) => (
          <SettingsRow
            key={kind}
            id={`alert-${kind}`}
            label={label}
            control={<Switch id={settingControlId(`alert-${kind}`)} checked={alertKinds.includes(kind)} onCheckedChange={(on) => toggleKind(kind, on)} />}
          />
        ))}
      </SettingsGroup>
      <SettingsGroup footer="Toasts show while Mochi is in front, only for threads you watch.">
        <SettingsRow id="watchedToasts" label="Toasts for watched threads" control={<Switch id={settingControlId('watchedToasts')} checked={watchedToasts} onCheckedChange={(on) => setPrefs({ watchedToasts: on })} />} />
        <SettingsRow
          id="dockBadge"
          label="Dock badge counts"
          control={<SettingsChoice id="dockBadge" value={dockBadge ? 'on' : 'off'} options={BADGE} onChange={(v) => setPrefs({ dockBadge: v === 'on' })} />}
        />
      </SettingsGroup>
      <QuietHoursGroup />
      <MutedThreadsGroup />
    </div>
  );
}

const BADGE = [
  { value: 'on', label: 'Needs you' },
  { value: 'off', label: 'Off' },
] as const;

const HOURS = Array.from({ length: 24 }, (_, h) => h);

function QuietHoursGroup() {
  const { state, dispatch } = useHarness();
  const { quiet } = state.notifications;
  const setQuiet = (patch: Partial<typeof quiet>) => dispatch({ type: 'notify-quiet', quiet: { ...quiet, ...patch } });
  return (
    <SettingsGroup footer="No alerts or toasts in these hours; the notification list still fills.">
      <SettingsRow id="quietHours" label="Quiet hours" control={<Switch id={settingControlId('quietHours')} checked={quiet.isOn} onCheckedChange={(isOn) => setQuiet({ isOn })} />}>
        {quiet.isOn && (
          <div className="flex items-center gap-2 type-meta text-muted-foreground">
            <NativeSelect size="sm" aria-label="Quiet from" value={quiet.start} onChange={(e) => setQuiet({ start: Number(e.target.value) })}>
              {HOURS.map((h) => (
                <NativeSelectOption key={h} value={h}>
                  {hourLabel(h)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            to
            <NativeSelect size="sm" aria-label="Quiet until" value={quiet.end} onChange={(e) => setQuiet({ end: Number(e.target.value) })}>
              {HOURS.map((h) => (
                <NativeSelectOption key={h} value={h}>
                  {hourLabel(h)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        )}
      </SettingsRow>
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
