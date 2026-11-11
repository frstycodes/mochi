/** Shared words below this are coincidence, not the passage. */
const MIN_SHARED = 2;

// GAP: word overlap, not meaning. A passage that answers in other words than the summary loses to one that repeats them; a
// verbatim quote from the agent (`record_answer`) would be exact.
/** The block sharing the most distinct words with `about`, the earliest on a tie; -1 when none shares `MIN_SHARED`. */
export function bestPassage(blocks: string[], about: string) {
  const wanted = words(about);
  let best = -1;
  let bestShared = MIN_SHARED - 1;
  blocks.forEach((block, i) => {
    const shared = [...words(block)].filter((w) => wanted.has(w)).length;
    if (shared <= bestShared) return;
    best = i;
    bestShared = shared;
  });
  return best;
}

// Four letters and up drops most function words without a stop list.
const words = (text: string) =>
  new Set(text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
