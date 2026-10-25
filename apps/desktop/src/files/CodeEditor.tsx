import { useEffect, useEffectEvent, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { languageFor } from './languages';
import { useLatest } from '@/useLatest';
import { tags as t } from '@lezer/highlight';

/** `isWrapped` folds long lines instead of scrolling sideways, for reading prose-heavy files in a narrow pane. */
export default function CodeEditor({
  path,
  value,
  line,
  column,
  readOnly,
  isWrapped,
  onChange,
}: {
  path: string;
  value: string;
  line?: number;
  column?: [number, number];
  readOnly?: boolean;
  isWrapped?: boolean;
  onChange?: (text: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const onChangeRef = useLatest(onChange);

  const createEditor = useEffectEvent((path: string) => {
    const language = new Compartment();
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          editorTheme,
          syntaxHighlighting(highlightStyle),
          language.of([]),
          readOnly
            ? [EditorState.readOnly.of(true), EditorView.editable.of(false)]
            : [],
          isWrapped ? EditorView.lineWrapping : [],
          EditorView.updateListener.of(
            (update) =>
              update.docChanged &&
              onChangeRef.current?.(update.state.doc.toString()),
          ),
        ],
      }),
    });
    view.current = editor;
    void languageFor(path).then(
      (support) =>
        view.current === editor &&
        editor.dispatch({ effects: language.reconfigure(support ?? []) }),
      (error: unknown) =>
        console.error('Could not load the file language', error),
    );
    if (line) {
      const target = editor.state.doc.line(
        Math.min(line, editor.state.doc.lines),
      );
      const [from, to] = (column ?? [0, 0]).map(
        (c) => target.from + Math.min(c, target.length),
      );
      editor.dispatch({
        selection: { anchor: from, head: to },
        effects: EditorView.scrollIntoView(from, { y: 'center' }),
      });
    }
    if (!readOnly) editor.focus();
    return editor;
  });
  // A new path is a new document (fresh undo history); `value` changes are synced below without rebuilding.
  useEffect(() => {
    const editor = createEditor(path);
    return () => {
      view.current = null;
      editor.destroy();
    };
  }, [path]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
    });
  }, [value]);

  return <div ref={host} className="h-full min-h-0 overflow-hidden" />;
}

// A color theme's syntax colors (`--syntax-*`, src/themes/map.ts) when it sets them; else GitHub Primer's, AA on both
// surfaces, with light-dark() following the `color-scheme` index.css sets per theme.
const highlightStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword],
    color: 'var(--syntax-keyword, light-dark(#cf222e, #ff7b72))',
  },
  {
    tag: [t.string, t.special(t.string), t.regexp],
    color: 'var(--syntax-string, light-dark(#0a3069, #a5d6ff))',
  },
  {
    tag: [t.comment, t.lineComment, t.blockComment],
    color: 'var(--syntax-comment, light-dark(#5f6873, #8b949e))',
    fontStyle: 'italic',
  },
  {
    tag: [t.number, t.bool, t.null, t.atom],
    color: 'var(--syntax-number, light-dark(#0550ae, #79c0ff))',
  },
  {
    tag: [t.propertyName, t.attributeName],
    color: 'var(--syntax-property, light-dark(#0550ae, #79c0ff))',
  },
  {
    tag: [
      t.function(t.variableName),
      t.function(t.propertyName),
      t.definition(t.function(t.variableName)),
    ],
    color: 'var(--syntax-function, light-dark(#8250df, #d2a8ff))',
  },
  {
    tag: [t.typeName, t.className, t.namespace],
    color: 'var(--syntax-type, light-dark(#953800, #ffa657))',
  },
  {
    tag: [t.tagName, t.heading],
    color: 'var(--syntax-tag, light-dark(#116329, #7ee787))',
    fontWeight: '600',
  },
  {
    tag: [t.link, t.url],
    color: 'var(--syntax-link, light-dark(#0550ae, #79c0ff))',
    textDecoration: 'underline',
  },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.invalid, color: 'var(--destructive)' },
]);

const editorTheme: Extension = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--foreground)',
    backgroundColor: 'transparent',
    fontSize: '12px',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '20px' },
  '.cm-content': { caretColor: 'var(--foreground)', paddingBlock: '8px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
    { backgroundColor: 'color-mix(in oklch, var(--ring) 28%, transparent)' },
  '.cm-activeLine': { backgroundColor: 'var(--highlight)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--subtle-foreground)',
    border: 'none',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--foreground)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--accent)',
    border: 'none',
    color: 'var(--muted-foreground)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklch, var(--warning) 25%, transparent)',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in oklch, var(--warning) 50%, transparent)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--accent)',
    outline: '1px solid var(--border)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: 'none',
    borderRadius: 'calc(10px * var(--corner-scale))',
    boxShadow: 'var(--elev-popover)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent)',
    color: 'var(--foreground)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--sidebar)',
    color: 'var(--foreground)',
  },
  '.cm-panels.cm-panels-bottom': { borderTop: 'none' },
  '.cm-panel.cm-search': {
    padding: '6px 8px',
    fontFamily: 'inherit',
    fontSize: '12px',
  },
  '.cm-panel.cm-search label': { color: 'var(--muted-foreground)' },
  '.cm-textfield': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    border: '1px solid var(--input)',
    borderRadius: 'calc(8px * var(--corner-scale))',
    padding: '2px 6px',
    fontSize: '12px',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--secondary)',
    color: 'var(--foreground)',
    border: 'none',
    borderRadius: '999px',
    padding: '2px 10px',
    fontSize: '12px',
  },
  '.cm-panel.cm-search [name=close]': { color: 'var(--muted-foreground)' },
});
