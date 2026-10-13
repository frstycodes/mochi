import { Badge } from '@/components/ui/badge';
import { TOOL_NAMES, tierOf, type Tier } from '../../runtime/toolTable';
import { CatalogRow } from '../CatalogRow';
import { SettingsGroup } from '../parts';

const TIER_COPY = {
  read: { title: 'Reads', body: 'Always allowed. They show in the work log.' },
  change: { title: 'Runs on its own', body: 'No asking: a line in the thread, and a toast with Undo where it can be put back. On sites outside your machine, typing, submitting, scripts and uploads from outside the worktree still ask.' },
  destructive: { title: 'Asks before deleting', body: "Waits for you on a card in the thread naming exactly what goes, every time. Can't be undone." },
  setting: { title: 'Suggests settings', body: 'Shows the settings in the thread as their real controls, with the agent’s value to use or ignore. Only you change them, there or here.' },
} satisfies Record<Tier, { title: string; body: string }>;

/** How far agents may change Mochi through its tools (RUNTIME.md › Mochi tools), and which tools each tier holds. */
export function ToolsSection() {
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup footer="Reads always work. Deletes wait for you in the thread, and suggested settings stay there until you close them; the Queue lists both.">
        <CatalogRow settingKey="agentControl" />
      </SettingsGroup>
      <SettingsGroup footer="Agents pick a model or effort for a thread they start only when you name one, or a cheaper one for a simple task. Agents can't change this setting.">
        <CatalogRow settingKey="threadModels" />
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
