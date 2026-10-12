import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BranchDown as GitMerge, Warning as TriangleAlert } from 'reicon-react';
import type { Step, Thread } from './model';
import { similarity } from './progress';
import { getPrefs } from './settings/prefs';
import { useHarness, useSpaceThreads } from './store';
import { PromptInputProvider, usePromptInputController, type PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ProviderMark, StepStatusIcon, lineColor, stepLabel } from './ui';
import { ComposerCard, ComposerInput, ComposerMeta, PermissionsMenu, RunOnMenu } from './Composer';
import { ProjectPicker, useRecentProjects } from './ProjectPicker';
import { projectName } from './projects';
import { showsDemoData } from './demoData';
import { host } from './host';
import { useDefaultModels } from './ModelControls';
import { initialControls, type ThreadControls } from './runtime/controls';
import type { Provider } from './model';

const MATCH_THRESHOLD = 0.5;
const EXAMPLES = ['Cache admin usage queries with a Redis client', 'Retry failed Stripe webhooks', 'Rate limit the search endpoint'];

interface Match {
  thread: Thread;
  step: Step;
  score: number;
}

export function NewThreadView() {
  return (
    <ScrollArea className="h-full">
      <PromptInputProvider>
        <NewThread />
      </PromptInputProvider>
    </ScrollArea>
  );
}

function NewThread() {
  const { dispatch } = useHarness();
  const { textInput } = usePromptInputController();
  const [provider, setProvider] = useState<Provider>(() => getPrefs().agent);
  const defaults = useDefaultModels();
  // The Settings default model until you pick one here.
  const [picked, setPicked] = useState<ThreadControls | null>(null);
  const controls = picked ?? initialControls(provider, defaults?.[provider] ?? '');
  const setControls = (next: ThreadControls, model?: { harness: Provider }) => {
    if (model) setProvider(model.harness);
    setPicked(next);
  };
  const recentProjects = useRecentProjects();
  const [project, setProject] = useState<string | null>(recentProjects[0] ?? null);
  const [dependOn, setDependOn] = useState<Match | null>(null);
  const draft = textInput.value;
  const matches = useStepMatches(draft);
  const linked = dependOn && matches.some((m) => m.step.id === dependOn.step.id) ? dependOn : null;

  const start = ({ text, files }: PromptInputMessage) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const title = files.length ? `${trimmed} (${files.length} attached)` : trimmed;
    dispatch({ type: 'create', title, provider, project, controls, isLive: host.isDesktop, dependOn: linked ? { threadId: linked.thread.id, stepId: linked.step.id } : undefined });
  };

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5 px-4 pt-8 pb-16 md:px-6 md:pt-16">
      <h1 className="type-heading">New thread</h1>
      <div>
        <ComposerCard>
          <ComposerInput
            autoFocus
            controls={controls}
            provider={provider}
            onControlsChange={setControls}
            onSend={start}
            submitLabel={linked ? 'Start thread, linked' : 'Start thread'}
            placeholder={project ? `What should this thread get done in ${projectName(project)}?` : 'Ask anything, no folder attached'}
            className="min-h-24"
          />
        </ComposerCard>
        <ComposerMeta>
          <ProjectPicker value={project} onChange={setProject} />
          {!!project && <RunOnMenu />}
          {!!project && <PermissionsMenu value={controls.access} onChange={(access) => setControls({ ...controls, access })} />}
        </ComposerMeta>
      </div>

      <AnimatePresence initial={false}>
        {matches.length > 0 && (
          <motion.section
            aria-label="Possible duplicates"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
            className="flex flex-col gap-2"
          >
            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <TriangleAlert className="size-4 text-warning" />
              Some of this is already planned
            </p>
            {matches.map((m) => (
              <MatchRow key={m.step.id} match={m} isLinked={linked?.step.id === m.step.id} onToggle={() => setDependOn(linked?.step.id === m.step.id ? null : m)} />
            ))}
            <p className="text-xs text-subtle-foreground">Link a step and this thread waits for it instead of building it again. You can still start without linking.</p>
          </motion.section>
        )}
      </AnimatePresence>

      {!draft && showsDemoData() && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-subtle-foreground">Try one of these to see duplicate detection</p>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((e) => (
              <Button key={e} variant="outline" className="h-7 text-xs font-normal" onClick={() => textInput.setInput(e)}>
                {e}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function useStepMatches(draft: string): Match[] {
  const threads = useSpaceThreads();
  if (draft.trim().length < 6) return [];
  return threads
    .filter((t) => t.status !== 'settled')
    .flatMap((thread) => thread.steps.filter((s) => s.status !== 'dropped' && s.status !== 'done' && !s.link).map((step) => ({ thread, step, score: similarity(draft, step.title) })))
    .filter((m) => m.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function MatchRow({ match, isLinked, onToggle }: { match: Match; isLinked: boolean; onToggle: () => void }) {
  const { thread, step } = match;
  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border p-3', isLinked ? 'border-subtle-foreground bg-muted' : 'border-border')}>
      <StepStatusIcon status={step.status} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{step.title}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-subtle-foreground">
          <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: lineColor(thread.line) }} />
          <span className="truncate">{thread.title}</span>
          <ProviderMark provider={thread.providers[0]} size={12} />
          <span className="tabular">
            · {stepLabel(step.status)}
            {step.status === 'running' && ` ${Math.round(step.progress * 100)}%`}
          </span>
        </span>
      </div>
      <Button variant={isLinked ? 'default' : 'outline'} className="h-7 px-2.5 text-xs" onClick={onToggle} aria-pressed={isLinked}>
        <GitMerge className="size-3.5" />
        {isLinked ? 'Linked' : 'Depend on it'}
      </Button>
    </div>
  );
}
