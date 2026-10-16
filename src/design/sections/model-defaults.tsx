import { useState } from 'react';
import { ChevronDown } from '@/icons';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { AgentModel } from '../../host/types/agent';
import { EffortPicker, ModelMenu, SpeedPicker } from '../../ModelControls';
import type { ModelOption } from '../../runtime/models';
import { ProviderMark } from '../../ui';
import { Block } from '../layout';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const FAST_TIER = [{ id: 'fast', name: 'Fast', description: 'About 2.5× faster output at a higher price' }];

const MODELS: ModelOption[] = [
  { harness: 'claude', id: 'claude-opus-5-5', name: 'Opus 5.5', description: 'Most capable for complex work', efforts: EFFORTS, speeds: FAST_TIER, isDefault: true },
  { harness: 'claude', id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', description: 'Fast and capable for everyday tasks', efforts: EFFORTS, speeds: [], isDefault: false },
  { harness: 'claude', id: 'claude-haiku-5-5', name: 'Haiku 5.5', description: 'Fastest for quick answers', efforts: [], speeds: [], isDefault: false },
  { harness: 'codex', id: 'gpt-6.1', name: 'GPT-6.1', description: 'Codex’s general model', efforts: ['low', 'medium', 'high'], speeds: [], isDefault: true },
];

const keyOf = (m: { harness: string; id: string }) => `${m.harness}:${m.id}`;

/** The composer's three pickers with "Default" and "Make default", on fixture models and local state. */
export function ModelDefaultsBlock() {
  const [modelKey, setModelKey] = useState(keyOf(MODELS[0]));
  const [defaultModel, setDefaultModel] = useState(keyOf(MODELS[0]));
  const [effort, setEffort] = useState('high');
  const [defaultEffort, setDefaultEffort] = useState('high');
  const [speed, setSpeed] = useState('');
  const [defaultSpeed, setDefaultSpeed] = useState('');
  const model = MODELS.find((m) => keyOf(m) === modelKey)!;
  const opus = MODELS[0] as AgentModel;

  return (
    <Block title="Model, effort and speed defaults" use="Each composer picker badges what new threads start on; hover or arrow to another item for Make default, or press ⌘↵ on it." wide>
      <div className="flex flex-wrap items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 px-2 text-muted-foreground">
              <ProviderMark provider={model.harness} size={14} />
              {model.name}
              <ChevronDown data-icon="inline-end" className="text-subtle-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <ModelMenu
            models={MODELS}
            pending={[]}
            harnesses={['claude', 'codex']}
            isChecked={(m) => keyOf(m) === modelKey}
            onPick={(m) => setModelKey(keyOf(m))}
            starred={['claude-opus-5-5', 'claude-sonnet-5-5']}
            onToggleStar={() => {}}
            defaults={{ isDefault: (m) => keyOf(m) === defaultModel, make: (m) => setDefaultModel(keyOf(m)) }}
          />
        </DropdownMenu>
        <EffortPicker model={opus} value={effort} onChange={setEffort} defaults={{ isDefault: (e) => e === defaultEffort, make: setDefaultEffort }} />
        <SpeedPicker model={opus} value={speed} onChange={setSpeed} defaults={{ isDefault: (s) => s === defaultSpeed, make: setDefaultSpeed }} />
      </div>
    </Block>
  );
}
