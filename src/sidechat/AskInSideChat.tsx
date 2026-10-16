import type { Dispatch, MouseEvent } from 'react';
import { MessageQuestion } from '@/icons';
import { toast } from '@/toast/store';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { DiffFile, DiffHunk } from '../host/types/git';
import { useHarness, type Action } from '../store';
import type { Quote } from '../store/sidechat';
import { DiffStat } from '../WorkLog';

/** Terminal: quotes the current selection. */
export function AskInSideChat({ threadId, quote }: { threadId: string; quote: Quote }) {
  const ask = useAskInSideChat(threadId);
  return (
    <Button variant="secondary" size="sm" onClick={() => ask(quote)}>
      <MessageQuestion aria-hidden />
      Ask in side chat
    </Button>
  );
}

/** Changes: pick one hunk of the files on screen. */
export function AskAboutHunk({ threadId, files }: { threadId: string; files: DiffFile[] }) {
  const ask = useAskInSideChat(threadId);
  const withHunks = files.filter((f) => f.hunks.length > 0);
  if (withHunks.length === 0) return null;
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Ask in side chat about a hunk" className="text-muted-foreground">
              <MessageQuestion />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Ask in side chat</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="max-h-80 w-72">
        {withHunks.map((file) => (
          <DropdownMenuGroup key={`${file.staged}:${file.path}`}>
            <DropdownMenuLabel className="truncate font-mono text-xs">{file.path}</DropdownMenuLabel>
            {file.hunks.map((hunk, i) => (
              <DropdownMenuItem key={hunk.header + i} onSelect={() => ask(hunkQuote(file, hunk))}>
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{hunk.header}</span>
                <DiffStat added={hunk.added} removed={hunk.removed} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Files: quotes the editor's selected lines, or the cursor's line. */
export function AskAboutFileRange({ threadId, path }: { threadId: string; path: string }) {
  const ask = useAskInSideChat(threadId);
  const onClick = async (e: MouseEvent<HTMLButtonElement>) => {
    // The toolbar sits in FileView's header; its editor is the next sibling's CodeMirror root.
    const dom = e.currentTarget.closest('header')?.parentElement?.querySelector<HTMLElement>('.cm-editor');
    if (!dom) return toast('Switch to source to pick lines to ask about');
    const { EditorView } = await import('@codemirror/view');
    const view = EditorView.findFromDOM(dom);
    if (!view) return;
    const { doc, selection } = view.state;
    const first = doc.lineAt(selection.main.from);
    const last = doc.lineAt(selection.main.to);
    const label = first.number === last.number ? `${path}:${first.number}` : `${path}:${first.number}–${last.number}`;
    ask({ source: 'file', label, text: doc.sliceString(first.from, last.to) });
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Ask in side chat about the selected lines" onClick={(e) => void onClick(e)}>
          <MessageQuestion />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Ask in side chat</TooltipContent>
    </Tooltip>
  );
}

/** `/side` and the palette: the thread's side chat opens and asks `question`, or waits with its input focused. */
export function askInSideChat(dispatch: Dispatch<Action>, threadId: string, question = '') {
  dispatch({ type: 'sidechat-open', threadId, ...(question && { ask: question }) });
  if (!question) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-sidechat-input="${CSS.escape(threadId)}"]`)?.focus());
}

function useAskInSideChat(threadId: string) {
  const { dispatch } = useHarness();
  return (quote: Quote) => dispatch({ type: 'sidechat-open', threadId, quote: { ...quote, text: quote.text.slice(0, MAX_QUOTE_CHARS) } });
}

// Keeps a stray select-all from shipping a whole log or file into every later question.
const MAX_QUOTE_CHARS = 8000;

/** The hunk without git's file header: the label already names the file. */
function hunkQuote(file: DiffFile, hunk: DiffHunk): Quote {
  const body = hunk.patch.slice(hunk.patch.indexOf('\n@@') + 1);
  return { source: 'diff', label: `${file.path} ${hunk.header}`, text: body.trimEnd() };
}
