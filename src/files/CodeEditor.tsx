import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { css } from '@codemirror/lang-css';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, syntaxHighlighting, type LanguageSupport } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

export default function CodeEditor({ path, value, line, onChange }: { path: string; value: string; line?: number; onChange: (text: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const lang = languageFor(path);
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          editorTheme,
          syntaxHighlighting(highlightStyle),
          lang ? lang() : [],
          EditorView.updateListener.of((update) => update.docChanged && onChangeRef.current(update.state.doc.toString())),
        ],
      }),
    });
    view.current = editor;
    if (line) {
      const at = editor.state.doc.line(Math.min(line, editor.state.doc.lines)).from;
      editor.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) });
    }
    editor.focus();
    return () => editor.destroy();
    // A new path is a new document (fresh undo history); `value` changes are synced below without rebuilding.
  }, [path]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}

const LANGUAGES: [RegExp, () => LanguageSupport][] = [
  [/\.(ts|mts|cts)$/i, () => javascript({ typescript: true })],
  [/\.tsx$/i, () => javascript({ typescript: true, jsx: true })],
  [/\.(js|mjs|cjs|jsx)$/i, () => javascript({ jsx: true })],
  [/\.(json|jsonc)$/i, json],
  [/\.(css|scss|less)$/i, css],
  [/\.(html?|svg|xml|vue)$/i, html],
  [/\.(md|mdx|markdown)$/i, markdown],
  [/\.py$/i, python],
  [/\.rs$/i, rust],
  [/\.go$/i, go],
  [/\.ya?ml$/i, yaml],
];

function languageFor(path: string) {
  return LANGUAGES.find(([re]) => re.test(path))?.[1];
}

// light-dark() follows the `color-scheme` index.css sets per theme. GitHub Primer syntax colours, AA on both surfaces.
const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: 'light-dark(#cf222e, #ff7b72)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'light-dark(#0a3069, #a5d6ff)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'light-dark(#5f6873, #8b949e)', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null, t.atom, t.propertyName, t.attributeName], color: 'light-dark(#0550ae, #79c0ff)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: 'light-dark(#8250df, #d2a8ff)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'light-dark(#953800, #ffa657)' },
  { tag: [t.tagName, t.heading], color: 'light-dark(#116329, #7ee787)', fontWeight: '600' },
  { tag: [t.link, t.url], color: 'light-dark(#0550ae, #79c0ff)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.invalid, color: 'var(--destructive)' },
]);

const editorTheme: Extension = EditorView.theme({
  '&': { height: '100%', color: 'var(--foreground)', backgroundColor: 'transparent', fontSize: '12px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '20px' },
  '.cm-content': { caretColor: 'var(--foreground)', paddingBlock: '8px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in oklch, var(--ring) 28%, transparent)' },
  '.cm-activeLine': { backgroundColor: 'var(--highlight)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--subtle-foreground)', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--foreground)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--accent)', border: 'none', color: 'var(--muted-foreground)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklch, var(--warning) 25%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklch, var(--warning) 50%, transparent)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent)', outline: '1px solid var(--border)' },
  '.cm-tooltip': { backgroundColor: 'var(--popover)', color: 'var(--popover-foreground)', border: 'none', borderRadius: 'calc(10px * var(--corner-scale))', boxShadow: 'var(--elev-popover)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--foreground)' },
  '.cm-panels': { backgroundColor: 'var(--sidebar)', color: 'var(--foreground)' },
  '.cm-panels.cm-panels-bottom': { borderTop: 'none' },
  '.cm-panel.cm-search': { padding: '6px 8px', fontFamily: 'inherit', fontSize: '12px' },
  '.cm-panel.cm-search label': { color: 'var(--muted-foreground)' },
  '.cm-textfield': { backgroundColor: 'var(--background)', color: 'var(--foreground)', border: '1px solid var(--input)', borderRadius: 'calc(8px * var(--corner-scale))', padding: '2px 6px', fontSize: '12px' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--secondary)', color: 'var(--foreground)', border: 'none', borderRadius: '999px', padding: '2px 10px', fontSize: '12px' },
  '.cm-panel.cm-search [name=close]': { color: 'var(--muted-foreground)' },
});
