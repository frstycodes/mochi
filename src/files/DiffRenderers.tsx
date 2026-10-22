import { useEffect, useState } from 'react';
import { DEFAULT_THEMES, getHighlighterIfLoaded, getHighlighterOptions, getSharedHighlighter } from '@pierre/diffs';
import {
  File as PierreFile,
  MultiFileDiff as PierreMultiFileDiff,
  PatchDiff as PierrePatchDiff,
  type FileProps,
  type MultiFileDiffProps,
  type PatchDiffProps,
} from '@pierre/diffs/react';
import { useDiffTheme } from '../themes/highlight';

export function File<A = undefined, C = undefined>(props: FileProps<A, C>) {
  const theme = useDiffTheme();
  const isReady = useHighlighterReady();
  return isReady && <PierreFile {...props} options={{ ...props.options, ...theme }} />;
}

export function MultiFileDiff<A = undefined, C = undefined>(props: MultiFileDiffProps<A, C>) {
  const theme = useDiffTheme();
  const isReady = useHighlighterReady();
  return isReady && <PierreMultiFileDiff {...props} options={{ ...props.options, ...theme }} />;
}

export function PatchDiff<A = undefined, C = undefined>(props: PatchDiffProps<A, C>) {
  const theme = useDiffTheme();
  const isReady = useHighlighterReady();
  return isReady && <PierrePatchDiff {...props} options={{ ...props.options, ...theme }} />;
}

// Pierre 1.5.2 can leave its first render blank until the shared highlighter is ready.
function useHighlighterReady() {
  const [isReady, setReady] = useState(() => !!getHighlighterIfLoaded(HIGHLIGHTER));
  useEffect(() => {
    if (isReady) return;
    let isCurrent = true;
    void getSharedHighlighter(getHighlighterOptions(HIGHLIGHTER.lang, { theme: HIGHLIGHTER.theme })).then(() => isCurrent && setReady(true));
    return () => void (isCurrent = false);
  }, [isReady]);
  return isReady;
}

const HIGHLIGHTER = { theme: DEFAULT_THEMES, lang: 'text' } as const;
