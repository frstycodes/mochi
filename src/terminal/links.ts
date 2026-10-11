// A relative or absolute path with at least one `/` and an extension, optionally `:line[:col]`. The lookbehind skips the path part of URLs (`localhost:5173/src/a.ts`), which the web-links addon owns.
const FILE_PATH = /(?<![\w:/.@-])(?:\.{1,2}\/|\/)?(?:[\w@.-]+\/)+[\w.-]+\.[A-Za-z0-9]+(?::\d+){0,2}/g;

export function filePathsIn(line: string) {
  return [...line.matchAll(FILE_PATH)].map((m) => ({ text: m[0], start: m.index }));
}
