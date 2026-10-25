import { lazy, Suspense } from 'react';
import type { PaneTabProps } from './tabs';

export function TerminalTab(props: PaneTabProps) {
  return (
    <Suspense>
      <Terminal {...props} />
    </Suspense>
  );
}

const Terminal = lazy(() => import('../terminal/TerminalTab'));
