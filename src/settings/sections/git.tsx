import { useHarness } from '../../store';
import { projectName } from '../../projects';
import { useAgentSettings } from '../AgentSettings';
import { CatalogRow } from '../CatalogRow';
import { CommitInput, DesktopOnly, SettingsGroup, SettingsRow } from '../parts';

export function GitSection() {
  return (
    <div className="flex flex-col gap-8">
      <DesktopOnly what="The worktrees folder and draft pull requests only work in the Mochi desktop app.">
        <SettingsGroup footer="New threads get their worktree here, never inside the project, so its own git status stays clean. Moving it leaves existing worktrees where they are.">
          <CatalogRow settingKey="worktreeRoot" />
          <CatalogRow settingKey="prDrafts" />
        </SettingsGroup>
      </DesktopOnly>
      <SettingsGroup footer="A new worktree keeps a thread's changes out of your checkout; the project folder works right in it, on its current branch. The worktree checkbox in the new-thread composer changes it too, and keeps your last choice. New branches are this prefix, then the prompt's first words.">
        <CatalogRow settingKey="workspaceMode" />
        <CatalogRow settingKey="branchPrefix" />
      </SettingsGroup>
      <DesktopOnly what="Worktree setup only runs in the Mochi desktop app.">
        <SettingsGroup footer="Before a new worktree's first turn: ignored files matching these patterns are copied from the project (gitignore patterns, comma separated; a .worktreeinclude in the project adds to them, as in Claude Code), dependencies install from the lockfile with the project's package manager, then the project's setup command runs. The agent starts once that's done.">
          <CatalogRow settingKey="prepareWorktrees" />
          <CatalogRow settingKey="worktreeInclude" />
        </SettingsGroup>
        <ProjectSetupCommands />
        <SettingsGroup footer="Only worktrees with nothing uncommitted are removed; their branches stay, and sending to the thread again makes the worktree anew.">
          <CatalogRow settingKey="worktreeCleanup" />
        </SettingsGroup>
      </DesktopOnly>
      <SettingsGroup footer="In the Changes tab and in the work log's edits. The Changes tab's own toggle changes it too.">
        <CatalogRow settingKey="diffStyle" />
      </SettingsGroup>
    </div>
  );
}

/** One setup command per project folder your threads use; without one, a project's own `.mochi/setup.sh` runs. */
function ProjectSetupCommands() {
  const { settings, update } = useAgentSettings();
  const folders = useProjectFolders(Object.keys(settings?.setupCommands ?? {}));
  if (!settings || !folders.length) return null;
  const save = (folder: string, command: string) => {
    const { [folder]: _, ...rest } = settings.setupCommands;
    void update({ setupCommands: command ? { ...rest, [folder]: command } : rest });
  };
  return (
    <SettingsGroup footer="Runs in the new worktree after the install, with MOCHI_ROOT_PATH (the project folder) and MOCHI_WORKTREE_PATH set. Empty runs the project's .mochi/setup.sh when it has one.">
      {folders.map((folder) => (
        <SettingsRow key={folder} label={`${projectName(folder)} setup command`} description={<span className="block truncate" title={folder}>{folder}</span>} control={<CommitInput aria-label={`Setup command for ${projectName(folder)}`} value={settings.setupCommands[folder] ?? ''} placeholder="pnpm build" onCommit={(command) => save(folder, command)} className="font-mono placeholder:font-sans" />} />
      ))}
    </SettingsGroup>
  );
}

function useProjectFolders(saved: string[]) {
  const { state } = useHarness();
  const used = state.threads.flatMap((t) => (t.repo?.path ? [t.repo.path] : []));
  return [...new Set([...used, ...saved])].sort((a, b) => projectName(a).localeCompare(projectName(b)));
}
