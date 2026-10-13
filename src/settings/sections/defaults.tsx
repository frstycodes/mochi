import { Input } from '@/components/ui/input';
import { ModelPicker, useUnavailableHarnesses } from '../../ModelControls';
import { useSpace } from '../../store';
import { useSideChatDefault } from '../../sidechat/useSideChat';
import { SHARED_ACCESS } from '../../runtime/access';
import { CONCURRENCY_RANGE } from '../../host/types/settings';
import { useAgentSettings } from '../AgentSettings';
import { DesktopOnly, SettingsChoice, SettingsGroup, SettingsRow, SettingsSelect, settingControlId } from '../parts';
import { Shortcut } from '../../Shortcut';
import { setPrefs, usePrefs } from '../prefs';
import { AGENTS, WHILE_WORKING } from '../settingOptions';

const FULL_ACCESS_TOGGLE = 'text-warning hover:text-warning data-[state=on]:border-warning/60 data-[state=on]:bg-warning/12 data-[state=on]:text-warning dark:data-[state=on]:bg-warning/12';

export function DefaultsSection() {
  const { agent, permissions } = usePrefs();
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="Where a new thread starts; the composer can still change each one.">
        <SettingsRow id="agent" label="Agent" control={<SettingsChoice id="agent" value={agent} options={AGENTS} onChange={(v) => setPrefs({ agent: v })} />} />
        <SettingsRow
          id="permissions"
          label="Permissions"
          control={<SettingsChoice id="permissions" value={permissions} options={SHARED_ACCESS.map((a) => ({ value: a, label: a, className: a === 'Full access' ? FULL_ACCESS_TOGGLE : undefined }))} onChange={(v) => setPrefs({ permissions: v })} />}
        />
      </SettingsGroup>
      <WhileWorkingGroup />
      <SideChatGroup />
      <DesktopOnly what="The concurrency limit only works in the Mochi desktop app.">
        <ConcurrencyGroup />
      </DesktopOnly>
      <SettingsGroup footer="Continuing on your API key or handing off to another harness is your call, per thread. Mochi never switches a thread to another account.">
        <SettingsRow id="usageLimit" label="When a usage limit hits" control={<span className="type-body text-muted-foreground">Pause until reset</span>} />
      </SettingsGroup>
    </div>
  );
}

function WhileWorkingGroup() {
  const { whileWorking } = usePrefs();
  return (
    <SettingsGroup
      footer={
        <span className="inline-flex flex-wrap items-center gap-1">
          Hold <Shortcut keys={['mod']} /> while sending to do the other for that one message. Queued messages go out one per turn, in order.
        </span>
      }
    >
      <SettingsRow id="whileWorking" label="While the agent is working, new messages" control={<SettingsSelect id="whileWorking" value={whileWorking} options={WHILE_WORKING} onChange={(v) => setPrefs({ whileWorking: v })} className="w-52" />} />
    </SettingsGroup>
  );
}

function SideChatGroup() {
  const [model, setModel] = useSideChatDefault();
  const unavailable = useUnavailableHarnesses(useSpace().id);
  if (!model) return null;
  return (
    <SettingsGroup footer="New side chats answer on this model, Claude or Codex, through this profile's account; the side chat's own model button can still change each one.">
      <SettingsRow
        id="sideChatModel"
        label="Side chat model"
        control={<ModelPicker id={settingControlId('sideChatModel')} value={model.model} provider={model.provider} unavailable={unavailable} onChange={(m) => setModel({ provider: m.harness, model: m.id })} />}
      />
    </SettingsGroup>
  );
}

function ConcurrencyGroup() {
  const { settings, update } = useAgentSettings();
  if (!settings) return null;
  return (
    <SettingsGroup footer="A thread with its own process (Claude Code runs one per thread) waits its turn past this limit.">
      <SettingsRow
        id="concurrency"
        label="Agents running at once"
        control={
          <Input
            id={settingControlId('concurrency')}
            key={settings.concurrency}
            type="number"
            inputMode="numeric"
            min={CONCURRENCY_RANGE.min}
            max={CONCURRENCY_RANGE.max}
            defaultValue={settings.concurrency}
            onBlur={(e) => Number(e.target.value) !== settings.concurrency && void update({ concurrency: Number(e.target.value) })}
            className="w-20 tabular"
          />
        }
      />
    </SettingsGroup>
  );
}
