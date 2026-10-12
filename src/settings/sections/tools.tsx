import { Badge } from '@/components/ui/badge';
import { AGENT_CONTROL_LABELS } from '../../runtime/tools';
import { TOOL_NAMES, tierOf, type Tier } from '../../runtime/toolTable';
import { SettingsGroup, SettingsRow, SettingsSelect } from '../parts';
import { setPrefs, usePrefs, type AgentControl } from '../prefs';

export const AGENT_CONTROLS = (Object.keys(AGENT_CONTROL_LABELS) as AgentControl[]).map((value) => ({ value, label: AGENT_CONTROL_LABELS[value] }));

const TIER_COPY = {
  read: { title: 'Reads', body: 'Always allowed. They show in the work log.' },
  reversible: { title: 'Changes you can undo', body: 'Run on their own, with a toast to undo and a line in the thread.' },
  consequential: { title: 'Asks first', body: 'Wait until you approve them on a card, every time.' },
} satisfies Record<Tier, { title: string; body: string }>;

/** How far agents may change Mochi through its tools (RUNTIME.md › Mochi tools), and which tools each tier holds. */
export function ToolsSection() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="Reads always work. Anything that asks first still waits for you on a card in the thread and the Queue.">
        <AgentControlRow />
      </SettingsGroup>
      {(Object.keys(TIER_COPY) as Tier[]).map((tier) => (
        <SettingsGroup key={tier} title={TIER_COPY[tier].title} footer={TIER_COPY[tier].body}>
          <div className="flex flex-wrap gap-1.5 px-3.5 py-3">
            {TOOL_NAMES.filter((name) => tierOf(name) === tier).map((name) => (
              <Badge key={name} variant="secondary" className="font-mono">
                {name}
              </Badge>
            ))}
          </div>
        </SettingsGroup>
      ))}
    </div>
  );
}

export function AgentControlRow() {
  const { agentControl } = usePrefs();
  return (
    <SettingsRow
      id="agentControl"
      label="Agents can change Mochi"
      description="Threads, goals, panes and the in-app browser"
      control={<SettingsSelect id="agentControl" value={agentControl} options={AGENT_CONTROLS} onChange={(v) => setPrefs({ agentControl: v })} className="w-56" />}
    />
  );
}
