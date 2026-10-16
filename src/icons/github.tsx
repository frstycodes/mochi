/*
 * GitHub's own pull request and issue state icons, copied from Octicons 19.40.0 (16px set), and GitHub's mark from Simple
 * Icons 16.34 (CC0). Only for PR and issue state and naming GitHub; everything else uses reicon-react.
 *
 * MIT License
 *
 * Copyright (c) 2026 GitHub Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
 * documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
 * persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
 * Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
 * WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 * OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
import { forwardRef, type SVGProps } from 'react';
import { cn } from '@/lib/utils';
import { bareState, refTone, type RefKind, type RefStatus, type RefTone } from '@/chat/refs';

type OcticonProps = SVGProps<SVGSVGElement>;

function octicon(name: string, paths: string[]) {
  const Icon = forwardRef<SVGSVGElement, OcticonProps>(({ className, ...props }, ref) => (
    <svg ref={ref} viewBox="0 0 16 16" fill="currentColor" aria-hidden className={cn('size-4 shrink-0', className)} {...props}>
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  ));
  Icon.displayName = name;
  return Icon;
}

/** GitHub's mark, where a source or account is GitHub's (reicon has none). */
export function GithubMarkIcon({ className, ...props }: OcticonProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={cn('size-4 shrink-0', className)} {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

export const GitPullRequestIcon = octicon('GitPullRequestIcon', [
  'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z',
]);

export const GitPullRequestDraftIcon = octicon('GitPullRequestDraftIcon', [
  'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 14a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM14 7.5a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm0-4.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Z',
]);

export const GitMergeIcon = octicon('GitMergeIcon', [
  'M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z',
]);

export const GitPullRequestClosedIcon = octicon('GitPullRequestClosedIcon', [
  'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z',
]);

export const IssueOpenedIcon = octicon('IssueOpenedIcon', [
  'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  'M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z',
]);

export const IssueClosedIcon = octicon('IssueClosedIcon', [
  'M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5Z',
  'M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z',
]);

export const IssueDraftIcon = octicon('IssueDraftIcon', [
  'M14.307 11.655a.75.75 0 0 1 .165 1.048 8.05 8.05 0 0 1-1.769 1.77.75.75 0 0 1-.883-1.214 6.552 6.552 0 0 0 1.44-1.439.75.75 0 0 1 1.047-.165Zm-2.652-9.962a.75.75 0 0 1 1.048-.165 8.05 8.05 0 0 1 1.77 1.769.75.75 0 0 1-1.214.883 6.552 6.552 0 0 0-1.439-1.44.75.75 0 0 1-.165-1.047ZM6.749.097a8.074 8.074 0 0 1 2.502 0 .75.75 0 1 1-.233 1.482 6.558 6.558 0 0 0-2.036 0A.751.751 0 0 1 6.749.097ZM.955 6.125a.75.75 0 0 1 .624.857 6.558 6.558 0 0 0 0 2.036.75.75 0 1 1-1.482.233 8.074 8.074 0 0 1 0-2.502.75.75 0 0 1 .858-.624Zm14.09 0a.75.75 0 0 1 .858.624c.13.829.13 1.673 0 2.502a.75.75 0 1 1-1.482-.233 6.558 6.558 0 0 0 0-2.036.75.75 0 0 1 .624-.857Zm-8.92 8.92a.75.75 0 0 1 .857-.624 6.558 6.558 0 0 0 2.036 0 .75.75 0 1 1 .233 1.482c-.829.13-1.673.13-2.502 0a.75.75 0 0 1-.624-.858Zm-4.432-3.39a.75.75 0 0 1 1.048.165 6.552 6.552 0 0 0 1.439 1.44.751.751 0 0 1-.883 1.212 8.05 8.05 0 0 1-1.77-1.769.75.75 0 0 1 .166-1.048Zm2.652-9.962A.75.75 0 0 1 4.18 2.74a6.556 6.556 0 0 0-1.44 1.44.751.751 0 0 1-1.212-.883 8.05 8.05 0 0 1 1.769-1.77.75.75 0 0 1 1.048.166Z',
]);

const ICONS = {
  pr: { open: GitPullRequestIcon, draft: GitPullRequestDraftIcon, merged: GitMergeIcon, closed: GitPullRequestClosedIcon, unknown: GitPullRequestIcon },
  issue: { open: IssueOpenedIcon, draft: IssueDraftIcon, merged: IssueClosedIcon, closed: IssueClosedIcon, unknown: IssueOpenedIcon },
} satisfies Record<RefKind, Record<RefStatus, unknown>>;

export const REF_TONE_CLASS = {
  success: 'text-success',
  muted: 'text-muted-foreground',
  merged: 'text-merged',
  destructive: 'text-destructive',
  warning: 'text-warning',
  info: 'text-info',
} satisfies Record<RefTone, string>;

// Text mixes toward foreground so success and destructive clear 4.5:1 on the light tint; --ref-surface keeps the conflict mark's ring matched to the tinted fill.
export const REF_CHIP_CLASS = {
  success: 'bg-success/12 text-[color-mix(in_oklab,var(--success)_75%,var(--foreground))] hover:bg-success/20 [--ref-surface:color-mix(in_oklab,var(--success)_12%,var(--background))]',
  muted: 'bg-muted text-muted-foreground hover:bg-accent [--ref-surface:var(--muted)]',
  merged: 'bg-merged/12 text-[color-mix(in_oklab,var(--merged)_75%,var(--foreground))] hover:bg-merged/20 [--ref-surface:color-mix(in_oklab,var(--merged)_12%,var(--background))]',
  destructive: 'bg-destructive/12 text-[color-mix(in_oklab,var(--destructive)_75%,var(--foreground))] hover:bg-destructive/20 [--ref-surface:color-mix(in_oklab,var(--destructive)_12%,var(--background))]',
  warning: 'bg-warning/12 text-[color-mix(in_oklab,var(--warning)_75%,var(--foreground))] hover:bg-warning/20 [--ref-surface:color-mix(in_oklab,var(--warning)_12%,var(--background))]',
  info: 'bg-info/12 text-[color-mix(in_oklab,var(--info)_75%,var(--foreground))] hover:bg-info/20 [--ref-surface:color-mix(in_oklab,var(--info)_12%,var(--background))]',
} satisfies Record<RefTone, string>;

/** A thread's PR (sidebar card, summary row, ship bar) in its state's icon and colour. */
export function PrStateIcon({ state, className }: { state: RefStatus; className?: string }) {
  const tone = refTone(state === 'unknown' ? null : bareState('pr', state, '', ''));
  return <GithubStateIcon kind="pr" status={state} className={cn(className, REF_TONE_CLASS[tone])} />;
}

/** The PR or issue icon for `status`; `hasConflicts` adds a small mark on the bottom-right corner. Colour comes from the caller (`refTone`). */
export function GithubStateIcon({ kind, status, hasConflicts, className }: { kind: RefKind; status: RefStatus; hasConflicts?: boolean; className?: string }) {
  const Icon = ICONS[kind][status];
  if (!hasConflicts) return <Icon className={className} />;
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <Icon className="size-full" />
      <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-[45%] rounded-full bg-current ring-[1.5px] ring-(--ref-surface,var(--background))" />
    </span>
  );
}
