import type { FallbackProps } from 'react-error-boundary';
import { AlertTriangle, Refresh } from '@/icons';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

/** What a pane, transcript row, tool card or page shows in place of a part that threw while rendering; the rest of the window keeps working. */
export function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <Empty role="alert" className="h-full gap-3 border p-4">
      <EmptyHeader className="gap-1">
        <EmptyMedia variant="icon" className="mb-1 text-destructive">
          <AlertTriangle />
        </EmptyMedia>
        <EmptyTitle>This part failed to show</EmptyTitle>
        <EmptyDescription className="line-clamp-3 font-mono type-caption break-words">{errorMessage(error)}</EmptyDescription>
      </EmptyHeader>
      <Button size="sm" variant="outline" onClick={resetErrorBoundary}>
        <Refresh data-icon="inline-start" />
        Try again
      </Button>
    </Empty>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
