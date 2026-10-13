import { MultiFileDiff } from '@pierre/diffs/react';
import { useDiffTheme } from '../themes/highlight';
import { Badge } from '@/components/ui/badge';
import type { FileEdit } from '../host/types/settings';
import { usePrefs } from './prefs';

/** Config file edits as diffs, one per file with its path: Settings' review dialog and Mochi's settings cards. */
export function FileDiffs({ edits }: { edits: FileEdit[] }) {
  const diffTheme = useDiffTheme();
  const { diffStyle } = usePrefs();
  return edits.map((e) => (
    <section key={e.path} className="flex flex-col gap-1.5">
      <h4 className="flex items-center gap-2 type-meta text-muted-foreground [overflow-wrap:anywhere]">
        {e.path}
        {!e.before && <Badge variant="outline">New file</Badge>}
      </h4>
      <div className="overflow-hidden rounded-xl border bg-card">
        <MultiFileDiff
          oldFile={{ name: e.path, contents: e.before }}
          newFile={{ name: e.path, contents: e.after }}
          disableWorkerPool
          options={{ diffStyle, disableFileHeader: true, overflow: 'wrap', ...diffTheme }}
          style={{ '--diffs-font-family': 'var(--font-mono)', '--diffs-font-size': '12px', '--diffs-line-height': '20px' } as React.CSSProperties}
          className="max-h-80 overflow-auto"
        />
      </div>
    </section>
  ));
}
