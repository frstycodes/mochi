import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { getPrefs, setPrefs, usePrefs } from './settings/prefs';
import { useHarness, useSpace, useSpaceThreads } from './store';
import { SlashMenu, useSlashItems, useSlashMenu, useThreadServers, useThreadSkills } from './chat/SlashMenu';
import { MentionChips, MentionMenu, useMentionMenu } from './chat/MentionMenu';
import { resolveToken, typedSkills } from './chat/slash';
import { withReferences, type Mention } from './chat/mentions';
import { PromptInputProvider, usePromptInputController, type PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ComposerCard, ComposerInput, ComposerMeta, HANDOFF_TRANSITION, PermissionsMenu, handOffComposer, newComposerLayoutId } from './Composer';
import { useSplit } from './layout/SplitContext';
import { ProjectChooser, ProjectPicker, type PickerProject } from './ProjectPicker';
import { projectName, repoFor, takeRequestedProject, useProjects, useRequestedProject } from './projects';
import { projectRoot } from './host/cwd';
import { host } from './host';
import { getDraft, newThreadDraftKey } from './chat/drafts';
import { MachineModelsContext, useDefaultModels } from './ModelControls';
import { initialControls, type ThreadControls } from './runtime/controls';
import { contextMax } from './runtime/models';
import { ContextRing } from './ContextRing';
import type { Provider } from './model';
import { toast } from '@/toast/store';
import { imageProblem, sentImages } from './chat/images';
import { WorkspaceControls, WorkspaceNotes, useWorkspace, type Workspace } from './git/WorkspacePicker';
import type { WorkspaceDraft } from './git/workspace';
import { RunsOnMenu } from './remote/RunsOnMenu';
import { useMachineCatalog, useMachines } from './remote/useMachines';

/** The new-thread page's picks, kept with its draft. */
interface NewThreadPicks {
  provider: Provider;
  picked: ThreadControls | null;
  project: string | null;
  mentions: Mention[];
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
  const { state, dispatch } = useHarness();
  const { leafId } = useSplit();
  const [layoutId] = useState(() => newComposerLayoutId(leafId));
  const { textInput, attachments } = usePromptInputController();
  const spaceId = useSpace().id;
  const draftKey = newThreadDraftKey(spaceId);
  const [saved] = useState(() => getDraft<NewThreadPicks>(draftKey)?.extra);
  const [provider, setProvider] = useState<Provider>(() => saved?.provider ?? getPrefs().agent);
  const localDefaults = useDefaultModels();
  // Subscribed so the defaults below follow Make default in the pickers; `initialControls` reads them once.
  usePrefs();
  // The Settings default model until you pick one here.
  const [picked, setPicked] = useState<ThreadControls | null>(saved?.picked ?? null);
  const setControls = (next: ThreadControls, model?: { harness: Provider }) => {
    if (model) setProvider(model.harness);
    setPicked(next);
  };
  const projects = useProjectRows(spaceId);
  // Projects first, then the composer, so a thread starts without the mouse; a kept draft already has its project.
  const [step, setStep] = useState<'project' | 'compose'>(saved ? 'compose' : 'project');
  // Unset until you pick: the most recently used project, once the list has loaded.
  const [chosenProject, setProject] = useState<string | null | undefined>(saved?.project);
  const project = chosenProject === undefined ? (projects.find((p) => !p.isMissing)?.ref ?? null) : chosenProject;
  // /side needs a thread to ask about.
  const slashItems = useSlashItems(provider, spaceId, project).filter((i) => i.source !== 'mochi');
  const slash = useSlashMenu(slashItems);
  // No thread is this page's own, so none is left out.
  const mentionFiles = useMemo(() => ({ root: project && projectRoot(repoFor(project, '')), recent: [] }), [project]);
  const mention = useMentionMenu(layoutId, useThreadSkills(provider, spaceId, project), useThreadServers(provider, spaceId, project), mentionFiles);
  // Slash tracks the caret always; the open menu owns the listbox attributes.
  const menuProps = { ...slash.editorProps, ...(mention.isOpen && mention.editorProps) };
  useEffect(() => {
    mention.restore(saved?.mentions ?? []);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [workspaceDraft, setWorkspaceDraft] = useState<WorkspaceDraft>(() => ({ mode: getPrefs().workspaceMode }));
  const machines = useMachines();
  const [runsOn, setRunsOn] = useState<string | null>(null);
  const remote = machines.machines.find((m) => m.machine.id === runsOn)?.machine;
  const { catalog, reload: reloadCatalog } = useMachineCatalog(remote);
  const [remoteProject, setRemoteProject] = useState<string | null>(null);
  // Another computer's projects and models are its own: picks made for this one don't carry over, either way.
  const changeRunsOn = (next: string | null) => {
    setRunsOn(next);
    setRemoteProject(null);
    setPicked(null);
  };
  const defaults = remote ? catalog?.defaults : localDefaults;
  const controls = picked ?? initialControls(provider, defaults?.[provider] ?? '');
  const draft = textInput.value;
  // Picks only ride along with something typed or attached; on their own they aren't a draft.
  const hasDraft = !!draft || attachments.files.length > 0 || mention.mentions.length > 0;
  const draftExtra = useMemo<NewThreadPicks | undefined>(() => (hasDraft ? { provider, picked, project, mentions: mention.mentions } : undefined), [hasDraft, provider, picked, project, mention.mentions]);
  // The worktree checkbox remembers your last choice for the next new thread.
  const changeWorkspace = (next: WorkspaceDraft) => {
    if (next.mode !== workspaceDraft.mode) setPrefs({ workspaceMode: next.mode });
    setWorkspaceDraft(next);
  };
  const workspace = useWorkspace(project ?? '', workspaceDraft, changeWorkspace);

  // Bases and branch names belong to one project.
  const changeProject = (next: string | null) => {
    setProject(next);
    setWorkspaceDraft({ mode: workspaceDraft.mode });
  };
  // The sidebar's Projects: a new thread here, in that project, whatever was picked before.
  const requestedProject = useRequestedProject();
  useEffect(() => {
    if (!requestedProject) return;
    const ref = takeRequestedProject();
    if (!ref) return;
    changeRunsOn(null);
    changeProject(ref);
    setStep('compose');
  }, [requestedProject]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseFirst = (next: string | null) => {
    if (remote) changeRunsOn(null);
    changeProject(next);
    setStep('compose');
  };

  const start = async ({ text, files }: PromptInputMessage) => {
    const title = text.trim();
    if (!title) return;
    // Worktree or folder is that computer's default, which follows yours (`workspaceMode` is shared).
    if (remote) {
      // A reference names a thread or file on this computer, which means nothing there.
      const problem = mention.mentions.length > 0 ? `References can’t go to ${remote.name}` : imageProblem(files);
      if (problem) {
        toast.error(problem);
        return false;
      }
      const images = await sentImages(files, (type, base64) => host.data.saveImage(type, base64));
      const result = await machines.run(remote.id, { type: 'create', title, provider, project: remoteProject, ...(picked && { controls }), ...(images.length > 0 && { images }) });
      if (!result.isOk) return false;
      return void toast.success(`Started on ${remote.name}`, { description: 'It’s in the sidebar under that computer.' });
    }
    const problem = (project && workspace.error) || imageProblem(files);
    if (problem) {
      toast.error(problem);
      return false;
    }
    const images = await sentImages(files, (type, base64) => host.data.saveImage(type, base64));
    const references = withReferences(title, mention.mentions, state.threads, { isCommand: !!resolveToken(title, slashItems), provider, typedSkills: typedSkills(title, slashItems) });
    handOffComposer(leafId, layoutId);
    mention.clear();
    return dispatch({
      type: 'create',
      title,
      ...(references.prompt !== title && { prompt: references.prompt }),
      ...(references.skills.length > 0 && { skills: references.skills }),
      ...(images.length > 0 && { images }),
      ...(references.images.length > 0 && { referenceImages: references.images }),
      provider,
      project,
      workspace: project ? chosenWorkspace(workspace) : undefined,
      controls,
      isLive: host.isDesktop,
    });
  };

  return (
    // The greeting row has a fixed height, so the card's top stays put whichever step it holds and however tall it grows.
    <div className="mx-auto grid min-h-full max-w-[720px] grid-cols-1 grid-rows-[auto_auto_1fr] px-4 md:px-6">
      <header className="flex min-h-[30vh] flex-col items-center justify-end pt-10 pb-6 text-center">
        <h1 className="text-balance type-display">{greeting(new Date())}</h1>
      </header>

      {/* Hidden once it hands off: the thread's composer is the same card, already on its way down. A constant layoutDependency keeps its resizes (project step to composer) instant; the handoff still animates. */}
      <motion.div layoutId={layoutId} layoutDependency={layoutId} layoutCrossfade={false} transition={HANDOFF_TRANSITION} className="motion-safe:in-data-exiting:invisible">
        {step === 'project' && (
          // Static: the list resizes on every keystroke while filtering.
          <ComposerCard isStatic>
            {/* Keyed so the highlight starts on the latest project once the list loads. */}
            <ProjectChooser key={project} value={project} projects={projects} placeholder="Start a thread in…" onChoose={chooseFirst} />
          </ComposerCard>
        )}
        {step === 'compose' && (
          <>
            <div className="relative">
              <SlashMenu menu={slash} />
              <MentionMenu menu={mention} />
              <ComposerCard>
                <MentionChips menu={mention} />
                <MachineModelsContext.Provider value={remote ? (catalog ?? NO_CATALOG) : null}>
                  <ComposerInput
                    autoFocus
                    draftKey={draftKey}
                    draftExtra={draftExtra}
                    controls={controls}
                    provider={provider}
                    onControlsChange={setControls}
                    slashItems={slashItems}
                    inlineMentions={mention.inlineMentions}
                    {...menuProps}
                    onKeyDown={(e, view) => {
                      mention.editorProps.onKeyDown(e, view);
                      if (!e.defaultPrevented) slash.editorProps.onKeyDown(e, view);
                      if (e.defaultPrevented || e.key !== 'Escape' || hasDraft) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setStep('project');
                    }}
                    onSend={start}
                    submitLabel={remote ? `Start on ${remote.name}` : 'Start thread'}
                    meter={!remote && <ContextRing provider={provider} spaceId={spaceId} context={{ used: 0, max: contextMax(provider) }} />}
                    placeholder={placeholder(remote?.name, remote ? (catalog?.projects.find((p) => p.ref === remoteProject)?.name ?? null) : (projects.find((p) => p.ref === project)?.name ?? (project && projectName(project))))}
                  />
                </MachineModelsContext.Provider>
              </ComposerCard>
            </div>
            <ComposerMeta>
              <RunsOnMenu value={runsOn} onChange={changeRunsOn} />
              {!!remote && (
                <>
                  <ProjectPicker value={remoteProject} onChange={setRemoteProject} projects={catalog?.projects ?? NO_PROJECTS} machine={remote} onAdded={reloadCatalog} />
                  {!!remoteProject && <PermissionsMenu threadId={layoutId} provider={provider} value={controls.access} onChange={(access) => setControls({ ...controls, access })} />}
                </>
              )}
              {!remote && (
                <>
                  <ProjectPicker value={project} onChange={changeProject} projects={projects} />
                  {!!project && <WorkspaceControls workspace={workspace} />}
                  {!!project && <PermissionsMenu threadId={layoutId} provider={provider} value={controls.access} onChange={(access) => setControls({ ...controls, access })} />}
                </>
              )}
            </ComposerMeta>
          </>
        )}
      </motion.div>

      {/* In the bottom row, so a note coming or going never re-centres the composer. */}
      <div className="flex flex-col gap-5 pt-4 pb-16">
        {step === 'compose' && !remote && !!project && <WorkspaceNotes workspace={workspace} />}
      </div>
    </div>
  );
}

/** Keep whether the displayed branch was automatic when committing the draft. */
function chosenWorkspace({ draft, branch }: Workspace): WorkspaceDraft {
  return { ...draft, branch, ...(draft.mode === 'worktree' && !draft.isExisting && !draft.branch && { autoBranch: branch }) };
}

const NO_CATALOG = { models: {}, defaults: { claude: '', codex: '' } };
const NO_PROJECTS: PickerProject[] = [];

/** This computer's projects as the picker lists them: by folder, which is what a thread here starts in. */
function useProjectRows(spaceId: string): PickerProject[] {
  const projects = useProjects(spaceId, useSpaceThreads());
  return useMemo(() => projects?.map((p) => ({ ref: p.path, name: p.name, ...(p.path !== p.name && { detail: p.path }), isMissing: p.isMissing, icon: p.icon })) ?? NO_PROJECTS, [projects]);
}

function placeholder(machineName: string | undefined, projectLabel: string | null) {
  if (projectLabel) return `What should this thread get done in ${projectLabel}?${machineName ? ` Runs on ${machineName}` : ''}`;
  return machineName ? `Ask anything; runs on ${machineName}, no folder attached` : 'Ask anything, no folder attached';
}

function greeting(now: Date) {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}
