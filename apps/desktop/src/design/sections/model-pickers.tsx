import { useState } from 'react';
import { ChevronDown } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AgentModel } from '../../host/types/agent';
import { EffortPicker, ModelMenu, SpeedPicker } from '../../ModelControls';
import type { ModelOption } from '../../runtime/models';
import { ProviderMark } from '../../ui';
import { toggleStar } from '../../settings/prefs';
import { Block } from '../layout';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const FAST_TIER = [
  {
    id: 'fast',
    name: 'Fast',
    description: 'About 2.5× faster output at a higher price',
  },
];

const MODELS: ModelOption[] = [
  {
    harness: 'claude',
    id: 'claude-opus-5-5',
    name: 'Opus 5.5',
    description: 'Most capable for complex work',
    efforts: EFFORTS,
    speeds: FAST_TIER,
    isDefault: true,
  },
  {
    harness: 'claude',
    id: 'claude-sonnet-5-5',
    name: 'Sonnet 5.5',
    description: 'Fast and capable for everyday tasks',
    efforts: EFFORTS,
    speeds: [],
    isDefault: false,
  },
  {
    harness: 'claude',
    id: 'claude-haiku-5-5',
    name: 'Haiku 5.5',
    description: 'Fastest for quick answers',
    efforts: [],
    speeds: [],
    isDefault: false,
  },
  {
    harness: 'codex',
    id: 'gpt-6.1',
    name: 'GPT-6.1',
    description: 'Codex’s general model',
    efforts: ['low', 'medium', 'high'],
    speeds: [],
    isDefault: true,
  },
];

const MORE_CODEX: ModelOption[] = [
  ['gpt-6.1-mini', 'GPT-6.1 mini', 'Faster and cheaper for light tasks'],
  ['gpt-6.1-codex', 'GPT-6.1 Codex', 'Tuned for long agentic coding runs'],
  ['gpt-6.1-codex-max', 'GPT-6.1 Codex Max', 'Deepest reasoning, slowest'],
].map(([id, name, description]) => ({
  harness: 'codex',
  id,
  name,
  description,
  efforts: ['low', 'medium', 'high'],
  speeds: [],
  isDefault: false,
}));

const keyOf = (m: { harness: string; id: string }) => `${m.harness}:${m.id}`;

/** The composer's three pickers on fixture models and local state; the model menu with working tabs, stars, search and ⌘1–9. */
export function ModelPickersBlock() {
  const models = [...MODELS, ...MORE_CODEX];
  const [modelKey, setModelKey] = useState(keyOf(MODELS[0]));
  const [starred, setStarred] = useState([
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'gpt-6.1',
  ]);
  const [effort, setEffort] = useState('high');
  const [speed, setSpeed] = useState('');
  const model = models.find((m) => keyOf(m) === modelKey)!;
  const opus = MODELS[0] as AgentModel;

  return (
    <Block
      title="Model, effort and speed"
      use="The composer's pickers. In New thread, whatever you pick becomes what the next new thread starts on."
      wide
    >
      <div className="flex flex-wrap items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 px-2 text-muted-foreground"
            >
              <ProviderMark provider={model.harness} size={14} />
              {model.name}
              <ChevronDown
                data-icon="inline-end"
                className="text-subtle-foreground"
              />
            </Button>
          </DropdownMenuTrigger>
          <ModelMenu
            models={models}
            pending={[]}
            harnesses={['claude', 'codex']}
            isChecked={(m) => keyOf(m) === modelKey}
            onPick={(m) => setModelKey(keyOf(m))}
            starred={starred}
            onToggleStar={(m) => setStarred((s) => toggleStar(s, m.id))}
          />
        </DropdownMenu>
        <EffortPicker model={opus} value={effort} onChange={setEffort} />
        <SpeedPicker model={opus} value={speed} onChange={setSpeed} />
      </div>
    </Block>
  );
}
