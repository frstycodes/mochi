import { Switch } from '@/components/ui/switch';
import { useAgentSettings } from '../AgentSettings';
import { CommitInput, DesktopOnly, FolderInput, SettingsChoice, SettingsGroup, SettingsRow, settingControlId } from '../parts';
import { DEFAULT_PREFS, setPrefs, usePrefs } from '../prefs';

export function GitSection() {
  const { branchPrefix, diffStyle } = usePrefs();
  return (
    <div className="flex flex-col gap-8">
      <DesktopOnly what="The worktrees folder and draft pull requests only work in the Mochi desktop app.">
        <DesktopGitGroup />
      </DesktopOnly>
      <SettingsGroup footer="A new thread in a project works on its own branch: this prefix, then the thread's id.">
        <SettingsRow
          id="branchPrefix"
          label="Branch prefix"
          control={
            <CommitInput
              id={settingControlId('branchPrefix')}
              value={branchPrefix}
              placeholder={DEFAULT_PREFS.branchPrefix}
              onCommit={(prefix) => setPrefs({ branchPrefix: prefix || DEFAULT_PREFS.branchPrefix })}
              className="font-mono placeholder:font-sans"
            />
          }
        />
      </SettingsGroup>
      <SettingsGroup footer="In the Changes tab and in the work log's edits. The Changes tab's own toggle changes it too.">
        <SettingsRow id="diffStyle" label="Diffs" control={<SettingsChoice id="diffStyle" value={diffStyle} options={DIFF_STYLES} onChange={(v) => setPrefs({ diffStyle: v })} />} />
      </SettingsGroup>
    </div>
  );
}

export const DIFF_STYLES = [
  { value: 'unified', label: 'Unified' },
  { value: 'split', label: 'Split' },
] as const;

function DesktopGitGroup() {
  const { settings, update } = useAgentSettings();
  if (!settings) return null;
  return (
    <SettingsGroup footer="New threads get their worktree here, never inside the project, so its own git status stays clean. Moving it leaves existing worktrees where they are.">
      <SettingsRow
        id="worktreeRoot"
        label="Worktrees folder"
        control={
<FolderInput id="worktreeRoot" value={settings.worktreeRoot} placeholder="~/.harness/worktrees" onCommit={(worktreeRoot) => void update({ worktreeRoot })} />
        }
      />
      <SettingsRow id="prDrafts" label="Open pull requests as drafts" control={<Switch id={settingControlId('prDrafts')} checked={settings.prDrafts} onCheckedChange={(prDrafts) => void update({ prDrafts })} />} />
    </SettingsGroup>
  );
}
