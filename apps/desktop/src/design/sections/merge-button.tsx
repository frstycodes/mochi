import { useState } from 'react';
import { ArrowUpRight } from '@/icons';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { toast } from '@/toast/store';
import type { MergeMethod, PrCheck } from '../../host/types/git';
import { checkTally, MergeButton, MERGE_METHODS } from '../../git/MergeButton';
import { Block } from '../layout';

export function MergeButtonBlock() {
  const [scenario, setScenario] = useState<Scenario>('running');
  const [method, setMethod] = useState<MergeMethod>('squash');
  const [isBusy, setBusy] = useState(false);
  const fake = (message: string) => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      toast.success(message);
    }, 1200);
  };
  return (
    <Block
      title="Merge button"
      use="The PR pane's merge, GitHub-style: the primary merges with the chosen method, the chevron changes it. Running or failing checks ask first: bypass them, or (while running) merge when ready."
      wide
    >
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={scenario}
        onValueChange={(v) => v && setScenario(v as Scenario)}
        aria-label="Checks"
      >
        {(Object.keys(SCENARIOS) as Scenario[]).map((s) => (
          <ToggleGroupItem key={s} value={s}>
            {SCENARIOS[s].label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="flex h-9 items-center gap-1 rounded-xl border bg-card px-3">
        <span className="type-meta font-medium text-foreground">
          Pull request
        </span>
        <div className="ml-auto flex items-center gap-1">
          <MergeButton
            head="mochi/4275df48"
            base="main"
            tally={checkTally(SCENARIOS[scenario].checks)}
            checks={SCENARIOS[scenario].checks}
            isConflicting={scenario === 'conflicts'}
            method={method}
            allowed={['squash', 'merge']}
            isBusy={isBusy}
            onMethodChange={setMethod}
            onMerge={(m, mode) =>
              mode === 'auto'
                ? toast('Merges #384 once its checks pass')
                : fake(
                    `Merged #384 · ${MERGE_METHODS[m].action}${mode === 'bypass' ? ', checks bypassed' : ''}`,
                  )
            }
          />
          <Button size="xs" variant="ghost" className="text-muted-foreground">
            GitHub
            <ArrowUpRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </Block>
  );
}

type Scenario = 'passed' | 'running' | 'failing' | 'conflicts';

const PASSED: PrCheck[] = [
  { name: 'typecheck', state: 'pass' },
  { name: 'lint', state: 'pass' },
  { name: 'test (macos)', state: 'pass' },
  { name: 'test (linux)', state: 'pass' },
];

const SCENARIOS = {
  passed: { label: 'Checks passed', checks: PASSED },
  running: {
    label: 'Running',
    checks: [
      PASSED[0],
      PASSED[1],
      { name: 'test (macos)', state: 'pending' },
      { name: 'test (linux)', state: 'pending' },
    ],
  },
  failing: {
    label: 'Failing',
    checks: [
      PASSED[0],
      { name: 'lint', state: 'fail' },
      { name: 'test (macos)', state: 'pending' },
      PASSED[3],
    ],
  },
  conflicts: { label: 'Conflicts', checks: PASSED },
} satisfies Record<Scenario, { label: string; checks: PrCheck[] }>;
