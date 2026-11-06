// Several frames of the fold's spring: a gap between two of its resizes never reads as settled.
export const COMPOSER_SETTLE_MS = 150;

/**
 * Pins the chat's bottom padding at the composer's height while a reader is scrolled back, so folding the composer or its tray doesn't
 * shrink the padding: the shrink would clamp the scroll, moving the rows under the reader.
 * `release` lets go once the composer grows back to the held height or stops resizing. Letting go at once, while it is still folded,
 * would shrink the padding under the unfold, and the list, following the end a frame behind, would bounce the rows.
 */
export function composerHold(setHold: (px: number | undefined) => void) {
  let held = 0;
  let settling: ReturnType<typeof setTimeout> | undefined;

  const stopSettling = () => {
    clearTimeout(settling);
    settling = undefined;
  };
  const releaseNow = () => {
    stopSettling();
    held = 0;
    setHold(undefined);
  };
  const release = () => {
    if (!held) return;
    clearTimeout(settling);
    settling = setTimeout(releaseNow, COMPOSER_SETTLE_MS);
  };
  const hold = (height: number) => {
    stopSettling();
    if (held) return;
    held = height;
    setHold(height);
  };
  const resized = (height: number) => {
    if (!held) return;
    if (height >= held) return releaseNow();
    if (settling) release();
  };

  return { hold, release, resized, dispose: stopSettling };
}
