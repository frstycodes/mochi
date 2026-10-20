import { useEffect, useState } from 'react';
import { FolderOpen } from '@/icons';
import mochiIcon from '../../build/icon.svg';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EDITOR_NAMES, openInEditor, REVEAL_IN, revealPath, useInstalledEditors } from '../files/editors';
import { host } from '../host';
import type { Space } from '../model';
import { ProviderMark } from '../ui';
import { HARNESSES } from './harnesses';
import { SettingsGroup, SettingsRow } from './parts';
import type { InstructionsFile, ProfileFolder } from './instructionFiles';

/**
 * The profile's own instructions: files in its folder, opened in your editor. Mochi adds them to each new thread; it
 * never writes Claude Code's or Codex's own CLAUDE.md or AGENTS.md, which keep loading as they always do.
 */
export function ProfileInstructions({ profile }: { profile: Space }) {
  const folder = useProfileFolder(profile.id);
  const [editor] = useInstalledEditors();
  const open = (name: string) => (editor ? openInEditor(editor, folder!.dir, name) : revealPath(folder!.dir, name));
  return (
    <SettingsGroup
      title="Instructions"
      action={
        !!folder &&
        host.isDesktop && (
          <Button variant="ghost" size="xs" onClick={() => revealPath(folder.dir, '')}>
            <FolderOpen data-icon="inline-start" />
            Show in {REVEAL_IN}
          </Button>
        )
      }
      footer={
        <>
          Edit them in any editor; new threads in {profile.name} get them. Claude Code’s and Codex’s own CLAUDE.md and AGENTS.md still load too.
          {!!folder && <span className="mt-1 block truncate font-mono">{folder.dir}</span>}
        </>
      }
    >
      {!folder && <SettingsRow label="Reading the profile’s folder…" />}
      {folder?.files.map((file) => (
        <SettingsRow
          key={file.name}
          label={
            <span className="flex items-center gap-2">
              {file.provider ? <ProviderMark provider={file.provider} size={14} /> : <img src={mochiIcon} alt="" aria-hidden className="size-3.5 shrink-0 rounded-[22%]" />}
              <span className="font-mono">{file.name}</span>
            </span>
          }
          description={`${readBy(file)} · ${file.lines ? `${file.lines} ${LINES.select(file.lines) === 'one' ? 'line' : 'lines'}` : 'empty'}`}
          control={
            host.isDesktop && (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => open(file.name)}>
                  {editor ? `Open in ${EDITOR_NAMES[editor]}` : 'Open'}
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label={`Show ${file.name} in ${REVEAL_IN}`} onClick={() => revealPath(folder!.dir, file.name)}>
                      <FolderOpen />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Show in {REVEAL_IN}</TooltipContent>
                </Tooltip>
              </div>
            )
          }
        />
      ))}
    </SettingsGroup>
  );
}

const LINES = new Intl.PluralRules('en');

const readBy = (file: InstructionsFile) => (file.provider ? `${HARNESSES[file.provider].name} only` : 'Every harness');

/** The folder and its files, read again when the window regains focus (after an edit in the editor). */
function useProfileFolder(spaceId: string) {
  const [folder, setFolder] = useState<ProfileFolder>();
  useEffect(() => {
    let isCurrent = true;
    const read = () => void host.settings.profileFolder(spaceId).then((next) => isCurrent && setFolder(next), () => {});
    read();
    addEventListener('focus', read);
    return () => {
      isCurrent = false;
      removeEventListener('focus', read);
    };
  }, [spaceId]);
  return folder;
}
