export function markdownPlugins(text: string) {
  return {
    code: /(?:`{3,}|~{3,})/.test(text),
    math: text.includes('$'),
    mermaid: /(?:`{3,}|~{3,})[ \t]*mermaid\b/i.test(text),
    cjk: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text),
  };
}
