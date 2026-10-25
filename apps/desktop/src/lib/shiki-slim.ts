// Stands in for bare `shiki` (aliased in vite.config.ts). The full bundle ships every grammar, which the
// single-file artifact inlines (about 7 MB); @pierre/diffs only needs these. Add a language here when a diff needs it.
import {
  createBundledHighlighter,
  createSingletonShorthands,
  type BundledLanguageInfo,
  type DynamicImportLanguageRegistration,
  type DynamicImportThemeRegistration,
} from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

export * from 'shiki/core';
export { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
export { createOnigurumaEngine } from 'shiki/engine/oniguruma';

export const bundledLanguages = {
  typescript: () => import('shiki/dist/langs/typescript.mjs'),
  ts: () => import('shiki/dist/langs/typescript.mjs'),
  tsx: () => import('shiki/dist/langs/tsx.mjs'),
  javascript: () => import('shiki/dist/langs/javascript.mjs'),
  js: () => import('shiki/dist/langs/javascript.mjs'),
  jsx: () => import('shiki/dist/langs/jsx.mjs'),
  json: () => import('shiki/dist/langs/json.mjs'),
  css: () => import('shiki/dist/langs/css.mjs'),
  sql: () => import('shiki/dist/langs/sql.mjs'),
  bash: () => import('shiki/dist/langs/bash.mjs'),
  shellscript: () => import('shiki/dist/langs/shellscript.mjs'),
  yaml: () => import('shiki/dist/langs/yaml.mjs'),
  markdown: () => import('shiki/dist/langs/markdown.mjs'),
} satisfies Record<string, DynamicImportLanguageRegistration>;

export const bundledLanguagesInfo: BundledLanguageInfo[] = [];
export const bundledThemes: Record<string, DynamicImportThemeRegistration> = {};

export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine(),
});
export const {
  codeToHtml,
  codeToHast,
  codeToTokens,
  codeToTokensBase,
  codeToTokensWithThemes,
  getSingletonHighlighter,
  getLastGrammarState,
} = createSingletonShorthands(createHighlighter);
