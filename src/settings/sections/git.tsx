import { useHarness } from '../../store';
import { projectName } from '../../projects';
import { useAgentSettings } from '../AgentSettings';
import { CatalogRow } from '../CatalogRow';
import { CommitInput, DesktopOnly, SettingsGroup, SettingsRow } from '../parts';

export function GitSection() {
  return (
    <div className="flex flex-col gap-10">
      <SettingsGroup title="Worktrees" footer="The new-thread composer's worktree checkbox changes where each thread works, and keeps your last choice. Moving the folder leaves existing worktrees where they are.">
        <CatalogRow settingKey="workspaceMode" />
        <CatalogRow settingKey="worktreeRoot" />
        <CatalogRow settingKey="worktreeCleanup" />
      </SettingsGroup>
      <DesktopOnly what="Worktree setup only runs in the Mochi desktop app.">
        <SettingsGroup title="Worktree setup" footer="Runs before a new worktree's first turn; the agent starts once it's done. A .worktreeinclude in the project adds to the patterns, as in Claude Code.">
          <CatalogRow settingKey="prepareWorktrees" />
          <CatalogRow settingKey="worktreeInclude" />
        </SettingsGroup>
        <ProjectSetupCommands />
      </DesktopOnly>
      <SettingsGroup title="Branches and pull requests" footer="Agents' commits follow Conventional Commits, type(scope): subject; the repo's own hooks still run.">
        <CatalogRow settingKey="branchPrefix" />
        <CatalogRow settingKey="prDrafts" />
      </SettingsGroup>
      <SettingsGroup title="Changes">
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
    <SettingsGroup title="Setup commands" footer="Run in the new worktree after the install, with MOCHI_ROOT_PATH and MOCHI_WORKTREE_PATH set. Empty runs the project's .mochi/setup.sh when it has one.">
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
