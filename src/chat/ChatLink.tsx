import { isValidElement, type ComponentProps, type ReactNode } from 'react';
import { FileIcon } from '@react-symbols/icons/utils';
import { defaultComponents, type ExtraProps } from 'streamdown';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { threadCwd } from '@/host/cwd';
import { GithubStateIcon, REF_TONE_CLASS } from '@/icons/github';
import { cn } from '@/lib/utils';
import { copyText } from '../clipboard';
import { worktreeLink } from '../files/kinds';
import { useWorktreeFiles } from '../files/useWorktreeFiles';
import { useThreadFiles } from '../files/viewer';
import { fileLink } from '../terminal/links';
import { useProfiles } from '../profiles';
import { useHarness, useThread } from '../store';
import { useVizThreadId } from '../viz/WidgetVisual';
import { refDescription, refFromUrl, refLabel, refStatus, refTone, refUrl, type GithubRef } from './refs';
import { useRefState, useRepoSlug } from './useRefState';

const DefaultLink = defaultComponents.a!;

type LinkProps = ComponentProps<'a'> & ExtraProps & { 'data-ref'?: string; 'data-path'?: string };

/**
 * Streamdown's link, except GitHub PRs and issues become state chips and paths to files in the thread's folder open the viewer.
 * `data-ref` / `data-path` come from `rehypeRefs` (refs and paths in prose); URLs and markdown links arrive as plain `href`s.
 */
export function ChatLink(props: LinkProps) {
  const { href = '', children, 'data-ref': textRef, 'data-path': textPath } = props;
  if (textRef !== undefined) return <TextRef refKey={textRef}>{children}</TextRef>;
  const urlRef = refFromUrl(href);
  // An autolinked URL shows as the compact label; a named link keeps its words.
  if (urlRef) return <RefChip githubRef={urlRef}>{textOf(children) === href ? undefined : children}</RefChip>;
  if (textPath !== undefined || isRelative(href)) return <PathLink path={href}>{children}</PathLink>;
  return <DefaultLink {...props} />;
}

/** `owner/repo#n` or `#n` from prose; an empty owner is the thread's own repo, so `#n` stays text in a thread without one. */
function TextRef({ refKey, children }: { refKey: string; children: ReactNode }) {
  const { cwd } = useThreadGithub();
  const home = useRepoSlug(cwd);
  const [, owner, repo, number] = refKey.match(/^([^/]*)\/([^#]*)#(\d+)$/)!;
  if (!owner && !home) return children;
  return <RefChip githubRef={owner ? { owner, repo, number: Number(number) } : { ...home!, number: Number(number) }} />;
}

/** A PR or issue: its state icon in the state's colour, `#n` (own repo) or `owner/repo#n`, the title on hover. */
export function RefChip({ githubRef, children }: { githubRef: GithubRef; children?: ReactNode }) {
  const { threadId, cwd, githubUser } = useThreadGithub();
  const home = useRepoSlug(cwd);
  const state = useRefState(githubRef, { cwd, githubUser });
  const { dispatch } = useHarness();
  const url = state?.url ?? refUrl(githubRef);
  const kind = state?.kind ?? githubRef.kind ?? 'pr';
  const description = refDescription(githubRef, state);
  const label = refLabel(githubRef, home);

  return (
    <ContextMenu>
      <Tooltip>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild>
            <a
              href={url}
              onClick={(e) => {
                e.preventDefault();
                dispatch({ type: 'pane-open-tab', threadId, kind: 'browser', url });
              }}
              aria-label={`${children ? textOf(children) : label}: ${state?.title ? `${state.title}, ` : ''}${description}`}
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-1.5 align-baseline font-medium text-foreground no-underline transition-colors [--ref-surface:var(--muted)] hover:bg-accent hover:[--ref-surface:var(--accent)]"
            >
              <GithubStateIcon kind={kind} status={refStatus(state)} hasConflicts={state?.hasConflicts} className={cn('size-3.5', REF_TONE_CLASS[refTone(state)])} />
              <span className="truncate tabular">{children ?? label}</span>
              {!!state?.isFailing && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-destructive" />}
            </a>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent className="max-w-72 flex-col items-start gap-0.5">
          <span className="block font-medium">{state?.title ?? refLabel(githubRef, null)}</span>
          <span className="block opacity-80">{description}</span>
        </TooltipContent>
      </Tooltip>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => dispatch({ type: 'pane-open-tab', threadId, kind: 'browser', url })}>Open in the side pane</ContextMenuItem>
        {/* The main process sends a new window's http(s) URL to the system browser (electron/window.ts). */}
        <ContextMenuItem onSelect={() => window.open(url, '_blank', 'noreferrer')}>Open in your browser</ContextMenuItem>
        <ContextMenuItem onSelect={() => copyText(url, 'Link copied')}>Copy link</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** A path that exists in the thread's folder opens the viewer at its line; anything else stays plain text. */
function PathLink({ path, children }: { path: string; children: ReactNode }) {
  const link = useWorktreeLink(path);
  if (!link) return children;
  return (
    <FileLinkButton link={link} className="font-medium underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground">
      {children}
    </FileLinkButton>
  );
}

/** The viewer link (`src/a.ts:12`) for `text` when it names a file in the thread's folder, else null. */
export function useWorktreeLink(text: string) {
  const base = useThreadFiles();
  const files = useWorktreeFiles(base?.root ?? null);
  return base && files ? worktreeLink(text, base.root, files) : null;
}

/** Opens `link` (`src/a.ts:12`) in the side pane's Files tab at its line; the file-type icon leads. */
export function FileLinkButton({ link, className, children }: { link: string; className?: string; children: ReactNode }) {
  const threadId = useVizThreadId();
  const { dispatch } = useHarness();
  const file = fileLink(link);
  return (
    <button type="button" data-file-link={link} onClick={() => dispatch({ type: 'pane-open-tab', threadId, kind: 'files', file })} className={cn('inline-flex max-w-full cursor-pointer items-baseline gap-1 text-left align-baseline', className)}>
      <FileIcon fileName={file.path.split('/').pop()!} autoAssign aria-hidden className="size-3.5 shrink-0 self-center" />
      {children}
    </button>
  );
}

function useThreadGithub() {
  const threadId = useVizThreadId();
  const thread = useThread(threadId);
  const githubUser = useProfiles().find((p) => p.id === thread?.spaceId)?.github || undefined;
  return { threadId, cwd: thread ? threadCwd(thread) : null, githubUser };
}

function isRelative(href: string) {
  return !!href && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#|\?)/i.test(href);
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  // Streamed words arrive wrapped in spans.
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}
