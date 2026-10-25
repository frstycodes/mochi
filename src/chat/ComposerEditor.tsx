import { createRoot, type Root } from 'react-dom/client';
import {
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type Ref,
} from 'react';
import { history, historyKeymap, standardKeymap } from '@codemirror/commands';
import { deleteMarkupBackward } from '@codemirror/lang-markdown';
import {
  HighlightStyle,
  syntaxHighlighting,
  syntaxTree,
} from '@codemirror/language';
import {
  Compartment,
  EditorState,
  Facet,
  Prec,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  placeholder as placeholderText,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import {
  usePromptInputAttachments,
  usePromptInputController,
} from '@/components/ai-elements/prompt-input';
import { Chat } from '@/icons';
import { cn } from '@/lib/utils';
import { useLatest } from '@/useLatest';
import {
  continueMarkup,
  markdownSupport,
  nestListItems,
  outdentListItems,
} from './markdownEditing';
import { mentionTokens } from './fileMentions';
import { FileMark } from './FileMark';
import type { Mention } from './mentions';
import { slashTokens, slotPlaceholder, type SlashItem } from './slash';

/** The composer's editable element: what caret-restoring code focuses. */
export const COMPOSER_EDITABLE = '[data-composer] .cm-content';

/** Where the caret sits in `text`; `null` while a range is selected. */
export type Caret = { text: string; at: number | null };

type ComposerEditorProps = {
  /** `/` commands and skills a token in the text can resolve to. */
  items: SlashItem[];
  /** Files and threads picked from `@`: each one's `@token` in the text renders as one unit. */
  inlineMentions?: InlineMention[];
  placeholder?: string;
  /** Your likely next message: shown in place of the placeholder while the text is empty; Tab or → takes it. */
  suggestion?: string;
  autoFocus?: boolean;
  className?: string;
  /** Runs before the editor's own keys; `preventDefault()` takes the key. */
  onKeyDown?: (e: KeyboardEvent, view: EditorView) => void;
  onCaret?: (caret: Caret, view: EditorView) => void;
  onKeyUp?: KeyboardEventHandler<HTMLDivElement>;
  onBlur?: FocusEventHandler<HTMLDivElement>;
  /** Set on the editable element: the open menu's ARIA, data attributes. */
  attributes?: Record<string, string | undefined>;
  ref?: Ref<EditorView | null>;
};

/**
 * The composer's text: a CodeMirror markdown editor holding exactly the text that gets sent. Markdown renders as you type
 * (lists indent with real bullets, `code`, **bold**, fences, headings, quotes) with its markup kept in the text. Enter sends,
 * Shift+Enter continues a list, Tab and Shift+Tab nest and outdent items. Its text is the `PromptInputProvider`'s.
 */
export function ComposerEditor({
  items,
  inlineMentions = NO_MENTIONS,
  placeholder = '',
  suggestion,
  autoFocus,
  className,
  onKeyDown,
  onCaret,
  onKeyUp,
  onBlur,
  attributes,
  ref,
}: ComposerEditorProps) {
  const { textInput } = usePromptInputController();
  const attachments = usePromptInputAttachments();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const latest = useLatest({
    onKeyDown,
    onCaret,
    setInput: textInput.setInput,
    attachments,
    suggestion,
  });
  const [compartments] = useState(() => ({
    items: new Compartment(),
    mentions: new Compartment(),
    placeholder: new Compartment(),
    attributes: new Compartment(),
  }));
  const contentAttributes = {
    'aria-label': placeholder,
    ...definedOnly(attributes),
  };

  const createEditor = useEffectEvent(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: textInput.value,
        selection: { anchor: textInput.value.length },
        extensions: [
          history(),
          markdownSupport,
          syntaxHighlighting(markdownHighlight),
          markupDecorations,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            spellcheck: 'true',
            autocorrect: 'on',
            autocapitalize: 'sentences',
          }),
          compartments.items.of(slashItemsFacet.of(items)),
          compartments.mentions.of(mentionsFacet.of(inlineMentions)),
          compartments.placeholder.of(
            placeholderText(suggestion || placeholder),
          ),
          compartments.attributes.of(
            EditorView.contentAttributes.of(contentAttributes),
          ),
          Prec.highest(
            EditorView.domEventHandlers({
              keydown: (event, view) => {
                // An IME's Enter, arrows and Backspace belong to the composition, never to a menu or a send.
                if (event.isComposing || view.composing) return false;
                latest.current.onKeyDown?.(event, view);
                if (event.defaultPrevented) return true;
                if (event.key === 'Enter' && !event.shiftKey)
                  return submit(view);
                if (isTakingSuggestion(event, view, latest.current.suggestion))
                  return takeSuggestion(view, latest.current.suggestion!);
                const { files, remove } = latest.current.attachments;
                if (
                  event.key !== 'Backspace' ||
                  view.state.doc.length ||
                  !files.length
                )
                  return false;
                remove(files.at(-1)!.id);
                return true;
              },
              paste: (event) => {
                const files = [...(event.clipboardData?.items ?? [])].flatMap(
                  (item) =>
                    item.kind === 'file' ? (item.getAsFile() ?? []) : [],
                );
                if (!files.length) return false;
                latest.current.attachments.add(files);
                return true;
              },
              // PromptInput's document-level drop adds dropped files; CodeMirror would paste their bytes in as text.
              drop: (event) => !!event.dataTransfer?.files.length,
            }),
          ),
          keymap.of([
            { key: 'Shift-Enter', run: continueMarkup },
            { key: 'Tab', run: nestListItems },
            { key: 'Shift-Tab', run: outdentListItems },
            { key: 'Backspace', run: deleteMarkupBackward },
            ...historyKeymap,
            ...standardKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              latest.current.setInput(update.state.doc.toString());
            if (update.docChanged || update.selectionSet)
              latest.current.onCaret?.(caretOf(update.state), update.view);
          }),
          composerTheme,
        ],
      }),
    });
    if (autoFocus) editor.focus();
    return editor;
  });
  // One editor per mount; text, items, placeholder and attributes are synced below without rebuilding it.
  useLayoutEffect(() => {
    const editor = createEditor();
    view.current = editor;
    return () => editor.destroy();
  }, []);

  useImperativeHandle(ref, () => view.current!, []);

  // A send, a draft, a picked reference or an edited queued message sets the text from outside: the caret goes to the end.
  useLayoutEffect(() => {
    const editor = view.current!;
    if (editor.state.doc.toString() === textInput.value) return;
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: textInput.value,
      },
      selection: { anchor: textInput.value.length },
    });
  }, [textInput.value]);

  const attributesKey = JSON.stringify(contentAttributes);
  useLayoutEffect(() => {
    view.current!.dispatch({
      effects: [
        compartments.items.reconfigure(slashItemsFacet.of(items)),
        compartments.mentions.reconfigure(mentionsFacet.of(inlineMentions)),
        compartments.placeholder.reconfigure(
          placeholderText(suggestion || placeholder),
        ),
        compartments.attributes.reconfigure(
          EditorView.contentAttributes.of(
            JSON.parse(attributesKey) as typeof contentAttributes,
          ),
        ),
      ],
    });
  }, [
    compartments,
    items,
    inlineMentions,
    placeholder,
    suggestion,
    attributesKey,
  ]);

  return (
    <div
      ref={host}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
      className={cn('w-full min-w-0', className)}
    />
  );
}

/** Enter sends unless the send button is off; a held mod key only changes how (`ChatView` reads it). */
function submit(view: EditorView) {
  const form = view.dom.closest('form');
  if (
    !form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled
  )
    form?.requestSubmit();
  return true;
}

const isTakingSuggestion = (
  event: KeyboardEvent,
  view: EditorView,
  suggestion?: string,
) =>
  !!suggestion &&
  !view.state.doc.length &&
  (event.key === 'Tab' || event.key === 'ArrowRight') &&
  !event.shiftKey &&
  !event.altKey &&
  !event.metaKey &&
  !event.ctrlKey;

function takeSuggestion(view: EditorView, suggestion: string) {
  view.dispatch({
    changes: { from: 0, insert: suggestion },
    selection: { anchor: suggestion.length },
    userEvent: 'input',
  });
  return true;
}

function caretOf(state: EditorState): Caret {
  const { main } = state.selection;
  return { text: state.doc.toString(), at: main.empty ? main.head : null };
}

const definedOnly = (attributes: Record<string, string | undefined> = {}) =>
  Object.fromEntries(
    Object.entries(attributes).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

const slashItemsFacet = Facet.define<SlashItem[], SlashItem[]>({
  combine: (values) => values[0] ?? [],
});
type InlineMention = Extract<Mention, { kind: 'file' | 'thread' }>;
const NO_MENTIONS: InlineMention[] = [];
const mentionsFacet = Facet.define<InlineMention[], InlineMention[]>({
  combine: (values) => values[0] ?? NO_MENTIONS,
});

/**
 * Bullets, list indents, code, `/` tokens and `@` file and thread tokens drawn over the text; the bullets stand in for their
 * markers, never change them, and a token's icon stands in for its `@`.
 */
const markupDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    markers: DecorationSet;
    constructor(view: EditorView) {
      ({ decorations: this.decorations, markers: this.markers } =
        buildDecorations(view.state));
    }
    update(update: ViewUpdate) {
      const isStale =
        update.docChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        update.startState.facet(slashItemsFacet) !==
          update.state.facet(slashItemsFacet) ||
        update.startState.facet(mentionsFacet) !==
          update.state.facet(mentionsFacet);
      if (isStale)
        ({ decorations: this.decorations, markers: this.markers } =
          buildDecorations(update.state));
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    // The caret steps over a bullet as one character; Backspace right after it removes the marker (deleteMarkupBackward).
    // An `@` token is one unit too: Backspace right after it removes it whole.
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.markers ?? Decoration.none,
      ),
  },
);

const INDENT_EM = 1.5;

function buildDecorations(state: EditorState) {
  const all: Range<Decoration>[] = [];
  const markers: Range<Decoration>[] = [];
  const { doc } = state;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'InlineCode')
        all.push(inlineCode.range(node.from, node.to));
      if (node.name === 'FencedCode') {
        const first = doc.lineAt(node.from).number;
        const last = doc.lineAt(node.to).number;
        for (let n = first; n <= last; n++)
          all.push(fenceLine(n === first, n === last).range(doc.line(n).from));
      }
      if (node.name !== 'ListMark') return;
      const line = doc.lineAt(node.from);
      // Only a marker that starts its line (after spaces) is drawn; `> - item` stays as typed.
      if (doc.sliceString(line.from, node.from).trim()) return;
      let depth = 0;
      for (let parent = node.node.parent; parent; parent = parent.parent)
        if (parent.name === 'BulletList' || parent.name === 'OrderedList')
          depth++;
      const end =
        doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to;
      const width = `${depth * INDENT_EM}em`;
      const label =
        node.node.parent?.parent?.name === 'OrderedList'
          ? doc.sliceString(node.from, node.to)
          : null;
      all.push(
        Decoration.line({
          attributes: {
            style: `padding-inline-start: ${width}; text-indent: -${width}`,
          },
        }).range(line.from),
      );
      const marker = Decoration.replace({
        widget: new ListMarker(label, depth, width),
      }).range(line.from, end);
      all.push(marker);
      markers.push(marker);
    },
  });
  const text = doc.toString();
  for (const token of mentionTokens(text, state.facet(mentionsFacet))) {
    all.push(
      Decoration.replace({ widget: new MentionTokenIcon(token.mention) }).range(
        token.start,
        token.start + 1,
      ),
    );
    all.push(mentionToken.range(token.start + 1, token.end));
    markers.push(Decoration.mark({}).range(token.start, token.end));
  }
  const tokens = slashTokens(text, state.facet(slashItemsFacet));
  for (const token of tokens)
    all.push(slashToken.range(token.start, token.end));
  const last = tokens.at(-1);
  const slots = last
    ? slotPlaceholder(text.slice(last.end), last.item.argumentHint)
    : '';
  if (slots)
    all.push(
      Decoration.widget({ widget: new SlotHint(slots), side: 1 }).range(
        doc.length,
      ),
    );
  return {
    decorations: Decoration.set(all, true),
    markers: Decoration.set(markers, true),
  };
}

const inlineCode = Decoration.mark({ class: 'cm-md-code' });
const slashToken = Decoration.mark({ class: 'text-info' });
// A path or a thread title is never a misspelling.
const mentionToken = Decoration.mark({
  class: 'text-info',
  attributes: { spellcheck: 'false' },
});
const fenceLine = (isFirst: boolean, isLast: boolean) =>
  Decoration.line({
    class: cn(
      'cm-md-fence',
      isFirst && 'cm-md-fence-start',
      isLast && 'cm-md-fence-end',
    ),
  });

/** A list item's marker as rendered: a dot (filled, then hollow when nested) or its number, right-aligned in the indent. */
class ListMarker extends WidgetType {
  constructor(
    readonly label: string | null,
    readonly depth: number,
    readonly width: string,
  ) {
    super();
  }
  eq(other: ListMarker) {
    return other.label === this.label && other.depth === this.depth;
  }
  toDOM() {
    const box = document.createElement('span');
    box.className = 'cm-md-marker';
    box.style.width = this.width;
    if (this.label) box.textContent = this.label;
    else
      box.append(
        Object.assign(document.createElement('span'), {
          className: cn(
            'cm-md-bullet',
            this.depth % 2 === 0 && 'cm-md-bullet-hollow',
          ),
        }),
      );
    return box;
  }
}

const iconRoots = new WeakMap<HTMLElement, Root>();

/** A token's icon in place of its `@`: the file's type, a folder, or a thread. */
class MentionTokenIcon extends WidgetType {
  readonly key: string;
  constructor(readonly mention: InlineMention) {
    super();
    this.key = `${mention.kind}:${mention.title}`;
  }
  eq(other: MentionTokenIcon) {
    return other.key === this.key;
  }
  toDOM() {
    const box = Object.assign(document.createElement('span'), {
      className: 'cm-mention-icon',
    });
    const root = createRoot(box);
    const { mention } = this;
    root.render(
      mention.kind === 'thread' ? (
        <Chat aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <FileMark
          name={mention.title.replace(/\/$/, '').split('/').pop()!}
          isDir={mention.isDir}
          className="size-3.5"
        />
      ),
    );
    iconRoots.set(box, root);
    return box;
  }
  destroy(dom: HTMLElement) {
    // CodeMirror can drop a widget while React renders (a draft or pick sets the text from a layout effect).
    const root = iconRoots.get(dom);
    queueMicrotask(() => root?.unmount());
  }
}

/** The last `/` token's argument slots not typed yet, muted after the end of the text. */
class SlotHint extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: SlotHint) {
    return other.text === this.text;
  }
  toDOM() {
    return Object.assign(document.createElement('span'), {
      className: 'text-subtle-foreground',
      textContent: this.text,
    });
  }
}

const markdownHighlight = HighlightStyle.define([
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.heading, fontWeight: '600' },
  { tag: t.quote, color: 'var(--muted-foreground)' },
  { tag: [t.link, t.url], color: 'var(--info)' },
  { tag: t.monospace, fontFamily: 'var(--font-mono)', fontSize: '0.9em' },
  {
    tag: [t.processingInstruction, t.contentSeparator],
    color: 'var(--subtle-foreground)',
  },
]);

// `--muted` vanishes on the glass card; a foreground tint reads in both themes.
const CODE_FILL = 'color-mix(in oklab, var(--foreground) 7%, transparent)';

const composerTheme = EditorView.theme({
  '&': { color: 'var(--foreground)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    maxHeight: '12rem',
    overflowY: 'auto',
  },
  '.cm-content': {
    minHeight: '3rem',
    padding: '12px 16px 8px',
    caretColor: 'var(--foreground)',
  },
  '.cm-line': { padding: '0' },
  '.cm-placeholder': { color: 'var(--muted-foreground)' },
  '.cm-md-marker': {
    display: 'inline-block',
    textIndent: '0',
    textAlign: 'end',
    paddingInlineEnd: '0.5em',
    color: 'var(--muted-foreground)',
    fontVariantNumeric: 'tabular-nums',
  },
  '.cm-md-bullet': {
    display: 'inline-block',
    width: '0.375em',
    height: '0.375em',
    borderRadius: '999px',
    backgroundColor: 'currentColor',
    verticalAlign: '0.15em',
  },
  '.cm-md-bullet-hollow': {
    backgroundColor: 'transparent',
    boxShadow: 'inset 0 0 0 1px currentColor',
  },
  '.cm-mention-icon': {
    display: 'inline-flex',
    verticalAlign: '-0.125em',
    marginInlineEnd: '0.2em',
  },
  '.cm-md-code': {
    backgroundColor: CODE_FILL,
    borderRadius: '4px',
    padding: '0.1em 0.3em',
  },
  '.cm-md-fence': {
    backgroundColor: CODE_FILL,
    fontFamily: 'var(--font-mono)',
    fontSize: '0.9em',
    paddingInline: '0.75em',
  },
  '.cm-md-fence-start': {
    borderStartStartRadius: '8px',
    borderStartEndRadius: '8px',
    paddingTop: '0.25em',
  },
  '.cm-md-fence-end': {
    borderEndStartRadius: '8px',
    borderEndEndRadius: '8px',
    paddingBottom: '0.25em',
  },
});
