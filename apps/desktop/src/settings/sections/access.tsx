import { useState } from 'react';
import { ChevronDown, SearchAlt } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  levelPolicy,
  POLICIES_BY_TIER,
  toolPolicy,
  type ToolPolicy,
} from '../../runtime/toolPolicy';
import {
  isGoalTool,
  tierOf,
  TOOL_NAMES,
  type Tier,
  type ToolName,
} from '../../runtime/toolTable';
import { useSettingsRoute } from '../../routes/nav';
import {
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from '../parts';
import {
  AGENT_CONTROLS,
  getPrefs,
  setPrefs,
  usePrefs,
  type AgentControl,
} from '../prefs';
import { TOOL_GROUPS, TOOL_GUIDE, type ToolGroup } from '../toolGuide';

/** How far agents may change Mochi through its tools (RUNTIME.md › Mochi tools): the level, then each tool's own choice. */
export function AccessSection() {
  const [query, setQuery] = useState('');
  const route = useSettingsRoute();
  // A deep link to a tool row has to find it, whatever the filter hid.
  const [linkNonce, setLinkNonce] = useState(route?.nonce);
  if (linkNonce !== route?.nonce) {
    setLinkNonce(route?.nonce);
    setQuery('');
  }
  const groups = groupTools(query);
  return (
    <div className="flex flex-col gap-10">
      <SettingsSection
        id="agentControl"
        title="What agents can do"
        footer="Every tool below follows this level unless you choose otherwise for it. Only you change it."
      >
        <LevelPicker />
      </SettingsSection>
      <SettingsSection
        title="Tools"
        footer="Allow runs a tool without asking: a line in the thread, and an Undo where it can be put back. Ask first waits on a card in the thread showing exactly what it was given. Deletes always ask, and settings are only ever suggested."
      >
        <InputGroup>
          <InputGroupAddon>
            <SearchAlt />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter tools"
            aria-label="Filter tools"
          />
        </InputGroup>
      </SettingsSection>
      {groups.map(({ group, tools }) => (
        <ToolGroupSection key={group} group={group} tools={tools} />
      ))}
      {!groups.length && (
        <p className="px-1 type-meta text-muted-foreground">
          No tool matches “{query.trim()}”.
        </p>
      )}
    </div>
  );
}

const LEVELS = {
  read: {
    title: 'Read only',
    body: 'Agents can look at threads, goals, the browser and settings. Nothing changes.',
  },
  changes: {
    title: 'Changes',
    body: 'Agents change threads, goals, panes and the browser on their own, with Undo. No deletes or settings.',
  },
  everything: {
    title: 'Everything',
    body: 'Changes, plus deletes and settings suggestions, each waiting for you on a card first.',
  },
} satisfies Record<AgentControl, { title: string; body: string }>;

/** The agent-control level as three cards, so each says what it allows instead of a label cut short in a select. */
function LevelPicker() {
  const { agentControl } = usePrefs();
  return (
    <RadioGroup
      value={agentControl}
      onValueChange={(v) => setPrefs({ agentControl: v as AgentControl })}
      aria-label="What agents can do"
      className="@container"
    >
      <div className="grid gap-2 @lg:grid-cols-3">
        {AGENT_CONTROLS.map((level) => (
          <label
            key={level}
            htmlFor={`level-${level}`}
            className="flex cursor-pointer gap-3 rounded-xl border bg-card p-3.5 transition-colors hover:bg-accent/40 has-data-checked:border-foreground/25 has-data-checked:bg-accent/50"
          >
            <RadioGroupItem
              id={`level-${level}`}
              value={level}
              className="mt-0.5"
            />
            <span className="flex flex-col gap-0.5">
              <span className="type-body font-medium">
                {LEVELS[level].title}
              </span>
              <span className="type-meta text-muted-foreground text-pretty">
                {LEVELS[level].body}
              </span>
            </span>
          </label>
        ))}
      </div>
    </RadioGroup>
  );
}

/** The groups with the tools a filter shows, matching a tool's words, its id or its group's name. */
function groupTools(query: string) {
  const q = query.trim().toLowerCase();
  const matches = (name: ToolName) => {
    const { group, label, description } = TOOL_GUIDE[name];
    return `${label} ${name} ${description} ${group}`.toLowerCase().includes(q);
  };
  return TOOL_GROUPS.flatMap((group) => {
    const tools = TOOL_NAMES.filter(
      (name) =>
        TOOL_GUIDE[name].group === group &&
        !isGoalTool(name) &&
        (!q || matches(name)),
    );
    return tools.length ? [{ group, tools }] : [];
  });
}

function ToolGroupSection({
  group,
  tools,
}: {
  group: ToolGroup;
  tools: ToolName[];
}) {
  const { agentControl, toolPolicies } = usePrefs();
  const changed = tools.filter(
    (name) => toolPolicy(name, agentControl, toolPolicies).isChosen,
  ).length;
  return (
    <SettingsSection
      title={group}
      action={
        <div className="flex items-center gap-2">
          {changed > 0 && (
            <span className="type-caption text-muted-foreground tabular">
              {CHANGED.format(changed)} changed
            </span>
          )}
          <SetAllMenu group={group} tools={tools} />
        </div>
      }
    >
      <SettingsCard>
        {tools.map((name) => (
          <ToolRow key={name} name={name} />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}

const CHANGED = new Intl.NumberFormat();

// Radix Select reserves '': following the level gets a value of its own.
const LEVEL_DEFAULT = 'level';

function ToolRow({ name }: { name: ToolName }) {
  const { agentControl, toolPolicies } = usePrefs();
  const { label, description } = TOOL_GUIDE[name];
  const tier = tierOf(name);
  const { policy, isChosen } = toolPolicy(name, agentControl, toolPolicies);
  const options = [
    {
      value: LEVEL_DEFAULT,
      label: `Default (${policyLabel(tier, levelPolicy(tier, agentControl))})`,
    },
    ...POLICIES_BY_TIER[tier].map((p) => ({
      value: p,
      label: policyLabel(tier, p),
    })),
  ];
  return (
    <SettingsRow
      id={toolRowId(name)}
      label={
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span>{label}</span>
          <code className="truncate font-mono type-caption text-muted-foreground">
            {name}
          </code>
        </span>
      }
      description={description}
      control={
        <SettingsSelect
          id={toolRowId(name)}
          aria-label={`${label}: what agents may do`}
          value={isChosen ? policy : LEVEL_DEFAULT}
          options={options}
          onChange={(v) =>
            choose([name], v === LEVEL_DEFAULT ? null : (v as ToolPolicy))
          }
          className="w-40"
        />
      }
    />
  );
}

export const toolRowId = (name: ToolName) => `tool-${name}`;

/** Sets every tool in the group to one choice where its tier offers it (deletes never run on their own), or back to the level. */
function SetAllMenu({ group, tools }: { group: ToolGroup; tools: ToolName[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Set every tool in ${group}`}
        >
          Set all
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(['allow', 'ask', 'off'] as const).map((policy) => (
          <DropdownMenuItem key={policy} onSelect={() => choose(tools, policy)}>
            {ALL_LABELS[policy]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => choose(tools, null)}>
          Follow the level
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Where a tier doesn't offer a choice (a delete set to Allow), that tool keeps its own; the Tools footnote says why.
const ALL_LABELS = {
  allow: 'Allow',
  ask: 'Ask first',
  off: 'Off',
} satisfies Record<ToolPolicy, string>;

/** Saves `policy` for each tool whose tier offers it; null puts them back on the level. */
function choose(tools: ToolName[], policy: ToolPolicy | null) {
  const next = { ...getPrefs().toolPolicies };
  for (const name of tools) {
    if (policy === null) delete next[name];
    else if (
      (POLICIES_BY_TIER[tierOf(name)] as readonly ToolPolicy[]).includes(policy)
    )
      next[name] = policy;
  }
  setPrefs({ toolPolicies: next });
}

const policyLabel = (tier: Tier, policy: ToolPolicy) =>
  policy === 'allow'
    ? tier === 'setting'
      ? 'Suggest'
      : 'Allow'
    : policy === 'ask'
      ? 'Ask first'
      : 'Off';
