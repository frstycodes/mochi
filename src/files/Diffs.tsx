import { lazy, Suspense } from 'react';
import type { FileProps, MultiFileDiffProps, PatchDiffProps } from '@pierre/diffs/react';

export function File<A = undefined, C = undefined>(props: FileProps<A, C>) {
  return (
    <Suspense>
      <LazyFile {...props} />
    </Suspense>
  );
}

export function MultiFileDiff<A = undefined, C = undefined>(props: MultiFileDiffProps<A, C>) {
  return (
    <Suspense>
      <LazyMultiFileDiff {...props} />
    </Suspense>
  );
}

export function PatchDiff<A = undefined, C = undefined>(props: PatchDiffProps<A, C>) {
  return (
    <Suspense>
      <LazyPatchDiff {...props} />
    </Suspense>
  );
}

const LazyFile = lazy(() => import('./DiffRenderers').then((m) => ({ default: m.File }))) as typeof import('./DiffRenderers').File;
const LazyMultiFileDiff = lazy(() => import('./DiffRenderers').then((m) => ({ default: m.MultiFileDiff }))) as typeof import('./DiffRenderers').MultiFileDiff;
const LazyPatchDiff = lazy(() => import('./DiffRenderers').then((m) => ({ default: m.PatchDiff }))) as typeof import('./DiffRenderers').PatchDiff;
