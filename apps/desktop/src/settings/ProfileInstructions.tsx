import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { FolderOpen, Edit } from '@/icons';
import mochiIcon from '../../build/icon.svg';
import { Button } from '@/components/ui/button';
import { plural } from '@mochi/domain/lib/format';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  EDITOR_NAMES,
  openInEditor,
  REVEAL_IN,
  revealPath,
  useInstalledEditors,
} from '../files/editors';
import { host } from '../host';
import type { Space } from '../model';
import { ProviderMark } from '../ui';
import { HARNESSES } from './harnesses';
import { SettingsGroup, SettingsRow } from './parts';
import type { InstructionsFile } from './instructionFiles';
import { queryKeys } from '../queryKeys';
import { InstructionsEditor } from './InstructionsEditor';

/**
 * The profile's own instructions: files in its folder, edited here or in your editor. Mochi adds them to each new
 * thread; Claude Code's and Codex's own CLAUDE.md and AGENTS.md live in `AccountInstructions` and keep loading as they
 * always do.
 */
export function ProfileInstructions({ profile }: { profile: Space }) {
  const folder = useProfileFolder(profile.id);
  const [editor] = useInstalledEditors();
  const [editing, setEditing] = useState<string | null>(null);
  const open = (name: string) =>
    editor
      ? openInEditor(editor, folder!.dir, name)
      : revealPath(folder!.dir, name);
  return (
    <SettingsGroup
      id="instructionsFiles"
      title="Mochi’s instructions"
      action={
        !!folder &&
        host.isDesktop && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => revealPath(folder.dir, '')}
          >
            <FolderOpen data-icon="inline-start" />
            Show in {REVEAL_IN}
          </Button>
        )
      }
      footer={
        <>
          Edit them here or in any editor; new threads in {profile.name} get
          them. Your own CLAUDE.md and AGENTS.md load too unless you turn them
          off below.
          {!!folder && (
            <span className="mt-1 block truncate font-mono">{folder.dir}</span>
          )}
        </>
      }
    >
      {!folder && <SettingsRow label="Reading the profile’s folder…" />}
      {folder?.files.map((file) => (
        <SettingsRow
          key={file.name}
          label={
            <span className="flex items-center gap-2">
              {file.provider ? (
                <ProviderMark provider={file.provider} size={14} />
              ) : (
                <img
                  src={mochiIcon}
                  alt=""
                  aria-hidden
                  className="size-3.5 shrink-0 rounded-[22%]"
                />
              )}
              <span className="font-mono">{file.name}</span>
            </span>
          }
          description={`${readBy(file)} · ${file.lines ? `${file.lines} ${plural(file.lines, 'line', 'lines')}` : 'empty'}`}
          control={
            host.isDesktop && (
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={editing === file.name}
                  onClick={() => setEditing(file.name)}
                >
                  <Edit data-icon="inline-start" />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => open(file.name)}
                >
                  {editor ? `Open in ${EDITOR_NAMES[editor]}` : 'Open'}
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Show ${file.name} in ${REVEAL_IN}`}
                      onClick={() => revealPath(folder!.dir, file.name)}
                    >
                      <FolderOpen />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Show in {REVEAL_IN}</TooltipContent>
                </Tooltip>
              </div>
            )
          }
        >
          {editing === file.name && (
            <InstructionsEditor
              spaceId={profile.id}
              name={file.name}
              onClose={() => setEditing(null)}
            />
          )}
        </SettingsRow>
      ))}
    </SettingsGroup>
  );
}

const readBy = (file: InstructionsFile) =>
  file.provider ? `${HARNESSES[file.provider].name} only` : 'Every harness';

/** The folder and its files, read again when the window regains focus (after an edit in the editor). */
export function useProfileFolder(spaceId: string) {
  const folderQuery = useQuery({
    queryKey: queryKeys.profile.folder(spaceId),
    queryFn: () => host.settings.profileFolder(spaceId),
    staleTime: 0,
  });
  return folderQuery.data;
}
