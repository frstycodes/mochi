const BOUNDARY = '/._- ';

/** Files whose path contains the query as a subsequence, best first: basename hits, runs and word starts score higher. */
export function fuzzyFiles(files: string[], query: string, limit = 50) {
  return fuzzyMatches(files, query, limit).map((m) => m.file);
}

/** Like `fuzzyFiles`, with the matched character indices of each path for highlighting. */
export function fuzzyMatches(files: string[], query: string, limit = 50) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return files.slice(0, limit).map((file) => ({ file, score: 0, indices: [] as number[] }));
  return files
    .flatMap((file) => {
      const match = fuzzyMatch(file, q);
      return match ? [{ file, ...match }] : [];
    })
    .sort((a, b) => b.score - a.score || a.file.length - b.file.length)
    .slice(0, limit);
}

function fuzzyMatch(file: string, q: string) {
  const inBase = subsequence(file, q, file.lastIndexOf('/') + 1);
  const anywhere = subsequence(file, q, 0);
  if (inBase && (!anywhere || inBase.score + 10 >= anywhere.score)) return { score: inBase.score + 10, indices: inBase.indices };
  return anywhere;
}

function subsequence(file: string, q: string, from: number) {
  const lower = file.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let prev = -2;
  for (const ch of q) {
    const at = lower.indexOf(ch, Math.max(from, prev + 1));
    if (at < 0) return null;
    if (at === prev + 1) score += 3;
    if (at === 0 || BOUNDARY.includes(file[at - 1]) || (file[at] !== lower[at] && file[at - 1] === lower[at - 1])) score += 2;
    indices.push(at);
    prev = at;
  }
  return { score, indices };
}
