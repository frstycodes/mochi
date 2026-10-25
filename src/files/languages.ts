import { LanguageSupport, StreamLanguage } from '@codemirror/language';

export async function languageFor(path: string) {
  return LANGUAGES.find(([pattern]) => pattern.test(path))?.[1]();
}

const LANGUAGES = [
  [
    /\.(ts|mts|cts)$/i,
    () =>
      import('@codemirror/lang-javascript').then((m) =>
        m.javascript({ typescript: true }),
      ),
  ],
  [
    /\.tsx$/i,
    () =>
      import('@codemirror/lang-javascript').then((m) =>
        m.javascript({ typescript: true, jsx: true }),
      ),
  ],
  [
    /\.(js|mjs|cjs|jsx)$/i,
    () =>
      import('@codemirror/lang-javascript').then((m) =>
        m.javascript({ jsx: true }),
      ),
  ],
  [
    /\.(json|jsonc)$/i,
    () => import('@codemirror/lang-json').then((m) => m.json()),
  ],
  [
    /\.(css|scss|less)$/i,
    () => import('@codemirror/lang-css').then((m) => m.css()),
  ],
  [
    /\.(html?|svg|xml|vue)$/i,
    () => import('@codemirror/lang-html').then((m) => m.html()),
  ],
  [
    /\.(md|mdx|markdown)$/i,
    () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  ],
  [/\.py$/i, () => import('@codemirror/lang-python').then((m) => m.python())],
  [/\.rs$/i, () => import('@codemirror/lang-rust').then((m) => m.rust())],
  [/\.go$/i, () => import('@codemirror/lang-go').then((m) => m.go())],
  [/\.ya?ml$/i, () => import('@codemirror/lang-yaml').then((m) => m.yaml())],
  [
    /\.(sh|bash|zsh)$/i,
    () =>
      import('@codemirror/legacy-modes/mode/shell').then(
        (m) => new LanguageSupport(StreamLanguage.define(m.shell)),
      ),
  ],
] satisfies [RegExp, () => Promise<LanguageSupport>][];
