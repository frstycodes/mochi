import { CatalogRow } from '../CatalogRow';
import { DesktopOnly, SettingsGroup } from '../parts';

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
      <SettingsGroup footer="In the Changes tab and in the work log's edits. The Changes tab's own toggle changes it too.">
        <CatalogRow settingKey="diffStyle" />
      </SettingsGroup>
    </div>
  );
}
