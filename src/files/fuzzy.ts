const BOUNDARY = '/._- ';

/** Files whose path contains the query as a subsequence, best first: basename hits, runs and word starts score higher. */
export function fuzzyFiles(files: string[], query: string, limit = 50) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return files.slice(0, limit);
  return files
    .flatMap((file) => {
      const base = file.lastIndexOf('/') + 1;
      const score = Math.max(subsequence(file, q, base) + 10, subsequence(file, q, 0));
      return score >= 0 ? [{ file, score }] : [];
    })
    .sort((a, b) => b.score - a.score || a.file.length - b.file.length)
    .slice(0, limit)
    .map((r) => r.file);
}

function subsequence(file: string, q: string, from: number) {
  const lower = file.toLowerCase();
  let score = 0;
  let prev = -2;
  for (const ch of q) {
    const at = lower.indexOf(ch, Math.max(from, prev + 1));
    if (at < 0) return -Infinity;
    if (at === prev + 1) score += 3;
    if (at === 0 || BOUNDARY.includes(file[at - 1]) || (file[at] !== lower[at] && file[at - 1] === lower[at - 1])) score += 2;
    prev = at;
  }
  return score;
}
