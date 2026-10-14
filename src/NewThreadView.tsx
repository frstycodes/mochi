import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Folder, Link, Warning as TriangleAlert } from 'reicon-react';
import type { Step, Thread } from './model';
import { similarity } from './progress';
import { getPrefs, setPrefs } from './settings/prefs';
import { useHarness, useSpace, useSpaceThreads } from './store';
import { SlashMenu, useSlashItems, useSlashMenu } from './chat/SlashMenu';
import { resolveToken, typedSkills } from './chat/slash';
import { withReferences } from './chat/mentions';
import { PromptInputProvider, usePromptInputController, type PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ProviderMark, StepStatusIcon, lineColor, stepLabel } from './ui';
import { ComposerCard, ComposerInput, ComposerMeta, HANDOFF_TRANSITION, PermissionsMenu, handOffComposer, newComposerLayoutId } from './Composer';
import { useSplit } from './layout/SplitContext';
import { ProjectPicker, useRecentProjects } from './ProjectPicker';
import { projectName } from './projects';
import { host } from './host';
import { getDraft, newThreadDraftKey } from './chat/drafts';
import { useDefaultModels } from './ModelControls';
import { initialControls, type ThreadControls } from './runtime/controls';
import { contextMax } from './runtime/models';
import { ContextRing } from './ContextRing';
import type { Provider } from './model';
import { toast } from 'sonner';
import { imageProblem, sentImages } from './chat/images';
import { RunMenu, RUN_NOW, type RunChoice } from './schedule/RunMenu';
import { toWhen } from './schedule/form';
import { describeTrigger } from './schedule/describe';
import { WorkspaceControls, WorkspaceNotes, useWorkspace, type Workspace } from './git/WorkspacePicker';
import type { WorkspaceDraft } from './git/workspace';
import { RunsOnMenu } from './remote/RunsOnMenu';
import { useMachines } from './remote/useMachines';

const MATCH_THRESHOLD = 0.5;
const MAX_SHORTCUTS = 3;

interface Match {
  thread: Thread;
  step: Step;
  score: number;
}

/** The new-thread page's picks, kept with its draft. */
interface NewThreadPicks {
  provider: Provider;
  picked: ThreadControls | null;
  project: string | null;
}

export function NewThreadView() {
  return (
    <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:h-full">
      {/* One draft per profile: switching profiles swaps it. */}
      <PromptInputProvider key={useSpace().id}>
        <NewThread />
      </PromptInputProvider>
    </ScrollArea>
  );
}

function NewThread() {
  const { dispatch } = useHarness();
  const { leafId } = useSplit();
  const [layoutId] = useState(() => newComposerLayoutId(leafId));
  const { textInput, attachments } = usePromptInputController();
  const spaceId = useSpace().id;
  const draftKey = newThreadDraftKey(spaceId);
  const [saved] = useState(() => getDraft<NewThreadPicks>(draftKey)?.extra);
  const [provider, setProvider] = useState<Provider>(() => saved?.provider ?? getPrefs().agent);
  const defaults = useDefaultModels();
  // The Settings default model until you pick one here.
  const [picked, setPicked] = useState<ThreadControls | null>(saved?.picked ?? null);
  const controls = picked ?? initialControls(provider, defaults?.[provider] ?? '');
  const setControls = (next: ThreadControls, model?: { harness: Provider }) => {
    if (model) setProvider(model.harness);
    setPicked(next);
  };
  // /side needs a thread to ask about.
  const slashItems = useSlashItems(provider, spaceId).filter((i) => i.source !== 'mochi');
  const slash = useSlashMenu(slashItems);
  const recentProjects = useRecentProjects();
  const [project, setProject] = useState<string | null>(saved ? saved.project : (recentProjects[0] ?? null));
  const [workspaceDraft, setWorkspaceDraft] = useState<WorkspaceDraft>(() => ({ mode: getPrefs().workspaceMode }));
  const [dependOn, setDependOn] = useState<Match | null>(null);
  const [run, setRun] = useState<RunChoice>(RUN_NOW);
  const machines = useMachines();
  const [runsOn, setRunsOn] = useState<string | null>(null);
  const remote = machines.machines.find((m) => m.machine.id === runsOn)?.machine;
  const draft = textInput.value;
  // Picks only ride along with something typed or attached; on their own they aren't a draft.
  const hasDraft = !!draft || attachments.files.length > 0;
  const draftExtra = useMemo<NewThreadPicks | undefined>(() => (hasDraft ? { provider, picked, project } : undefined), [hasDraft, provider, picked, project]);
  const matches = useStepMatches(draft);
  const linked = dependOn && matches.some((m) => m.step.id === dependOn.step.id) ? dependOn : null;
  // The worktree checkbox remembers your last choice for the next new thread.
  const changeWorkspace = (next: WorkspaceDraft) => {
    if (next.mode !== workspaceDraft.mode) setPrefs({ workspaceMode: next.mode });
    setWorkspaceDraft(next);
  };
  const workspace = useWorkspace(project ?? '', workspaceDraft, changeWorkspace, draft);

  // Bases and branch names belong to one project.
  const changeProject = (next: string | null) => {
    setProject(next);
    setWorkspaceDraft({ mode: workspaceDraft.mode });
  };

  const start = async ({ text, files }: PromptInputMessage) => {
    const title = text.trim();
    if (!title) return;
    // GAP: a schedule's start leaves out images (`src/host/types/schedule.ts`).
    // GAP: another computer's thread starts folderless, with its defaults: its projects and models aren't listed here yet.
    if (remote) {
      if (files.length > 0) {
        toast.error(`Images can’t go to ${remote.name} yet`);
        return false;
      }
      const result = await machines.run(remote.id, { type: 'create', title, provider, project: null });
      if (!result.isOk) return false;
      return void toast.success(`Started on ${remote.name}`, { description: 'It’s in the sidebar under that computer.' });
    }
    const isScheduled = run.mode !== 'now' && run.mode !== 'background';
    const problem = (project && workspace.error) || (isScheduled && files.length > 0 ? 'Scheduled threads can’t start with images yet' : imageProblem(files));
    if (problem) {
      toast.error(problem);
      return false;
    }
    const images = await sentImages(files);
    const { prompt, skills } = withReferences(title, [], [], { isCommand: !!resolveToken(title, slashItems), provider, typedSkills: typedSkills(title, slashItems) });
    const create = { type: 'create', title, ...(skills.length > 0 && { prompt, skills }), ...(images.length > 0 && { images }), provider, project, workspace: project ? chosenWorkspace(workspace) : undefined, controls, isLive: host.isDesktop, dependOn: linked ? { threadId: linked.thread.id, stepId: linked.step.id } : undefined } as const;
    if (run.mode === 'now') {
      handOffComposer(leafId, layoutId);
      return dispatch(create);
    }
    if (run.mode === 'background') {
      dispatch({ ...create, isBackground: true });
      return void toast.success('Started in the background');
    }
    const result = toWhen(run.form);
    if ('error' in result) {
      toast.error(`Fix the schedule first: ${result.error}`);
      // Keeps your text in the composer.
      return false;
    }
    dispatch({ ...create, isBackground: true, schedule: { when: result.when, missed: run.form.missed } });
    toast.success(`Scheduled: ${describeTrigger(result.when)}`);
    setRun(RUN_NOW);
  };

  return (
    // Three rows, the composer in the middle: the greeting sits on top of it and duplicates open below it without moving it.
    <div className="mx-auto grid min-h-full max-w-[720px] grid-cols-1 grid-rows-[1fr_auto_1fr] px-4 md:px-6">
      <header className="flex flex-col items-center justify-end pt-10 pb-6 text-center">
        <h1 className="text-balance type-display">{greeting(new Date())}</h1>
      </header>

      {/* Hidden once it hands off: the thread's composer is the same card, already on its way down. */}
      <motion.div layoutId={layoutId} layoutCrossfade={false} transition={HANDOFF_TRANSITION} className="motion-safe:in-data-exiting:invisible">
        <div className="relative">
          <SlashMenu menu={slash} />
          <ComposerCard>
            <ComposerInput
              autoFocus
              draftKey={draftKey}
              draftExtra={draftExtra}
              controls={controls}
              provider={provider}
              onControlsChange={setControls}
              slashItems={slashItems}
              {...slash.textareaProps}
              onSend={start}
              submitLabel={remote ? `Start on ${remote.name}` : submitLabel(run, !!linked)}
              isTextOnly={!!remote}
              meter={!remote && <ContextRing provider={provider} spaceId={spaceId} context={{ used: 0, max: contextMax(provider) }} />}
              placeholder={remote ? `Ask anything; runs on ${remote.name}, no folder attached` : project ? `What should this thread get done in ${projectName(project)}?` : 'Ask anything, no folder attached'}
            />
          </ComposerCard>
        </div>
        <ComposerMeta>
          <RunsOnMenu value={runsOn} onChange={setRunsOn} />
          {!remote && (
            <>
              <ProjectPicker value={project} onChange={changeProject} />
              {!!project && <WorkspaceControls workspace={workspace} />}
              <RunMenu value={run} onChange={setRun} />
              {!!project && <PermissionsMenu threadId={layoutId} provider={provider} value={controls.access} onChange={(access) => setControls({ ...controls, access })} />}
            </>
          )}
        </ComposerMeta>
        {!remote && !!project && <WorkspaceNotes workspace={workspace} />}
      </motion.div>

      <div className="flex flex-col gap-5 pt-4 pb-16">
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

        {matches.length === 0 && recentProjects.length > 1 && <ProjectShortcuts projects={recentProjects.slice(0, MAX_SHORTCUTS)} value={project} onChange={changeProject} />}
      </div>
    </div>
  );
}

/** The draft with the branch spelled out: the generated name, or the folder's current branch. */
function chosenWorkspace({ draft, branch }: Workspace): WorkspaceDraft {
  return { ...draft, branch };
}

function submitLabel(run: RunChoice, isLinked: boolean) {
  if (run.mode === 'trigger') return 'Schedule thread';
  if (run.mode === 'background') return 'Start in background';
  return isLinked ? 'Start thread, linked' : 'Start thread';
}

function greeting(now: Date) {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The latest projects one click away; the picker in the meta row holds the rest. */
function ProjectShortcuts({ projects, value, onChange }: { projects: string[]; value: string | null; onChange: (project: string) => void }) {
  return (
    <div role="group" aria-label="Recent projects" className="flex flex-wrap justify-center gap-2">
      {projects.map((p) => (
        <Button
          key={p}
          variant="outline"
          size="sm"
          aria-pressed={p === value}
          onClick={() => onChange(p)}
          className="rounded-full font-normal text-muted-foreground aria-pressed:border-foreground/40 aria-pressed:bg-muted aria-pressed:text-foreground dark:aria-pressed:bg-input"
        >
          <Folder />
          {projectName(p)}
        </Button>
      ))}
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
          <span>· {stepLabel(step.status)}</span>
        </span>
      </div>
      <Button variant={isLinked ? 'default' : 'outline'} className="h-7 px-2.5 text-xs" onClick={onToggle} aria-pressed={isLinked}>
        <Link className="size-3.5" />
        {isLinked ? 'Linked' : 'Depend on it'}
      </Button>
    </div>
  );
}
