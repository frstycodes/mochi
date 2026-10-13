import { Fragment, useLayoutEffect, useRef, type ComponentProps } from 'react';
import { PromptInputTextarea, usePromptInputController } from '@/components/ai-elements/prompt-input';
import { cn } from '@/lib/utils';
import { slashTokens, slotPlaceholder, type SlashItem } from './slash';

/**
 * The composer's textarea with each resolved `/name` in colour, wherever it sits, and the last one's argument slots as muted
 * placeholder text after the end of the text (anywhere else it would push the text out of line with the textarea's). A textarea
 * can't colour runs, so while a token resolves its own text goes transparent and a mirror on top (no pointer events) draws
 * it: the textarea keeps caret, selection, IME and undo; the mirror copies its box metrics and scroll offset.
 */
export function TokenTextarea({ items, className, onScroll, ...props }: ComponentProps<typeof PromptInputTextarea> & { items: SlashItem[] }) {
  const { textInput } = usePromptInputController();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const text = textInput.value;
  const tokens = slashTokens(text, items);
  const last = tokens.at(-1);

  useLayoutEffect(() => {
    if (last && textarea.current && mirror.current) syncMirror(textarea.current, mirror.current);
  });

  return (
    <div className="relative w-full">
      <PromptInputTextarea
        ref={textarea}
        // No colour transition: the text must vanish the frame the mirror shows it.
        className={cn(className, 'transition-none', !!last && 'text-transparent caret-foreground')}
        // The mirror can't show a scrollbar, so the textarea hides its own and both wrap at the same width.
        style={last ? { scrollbarWidth: 'none' } : undefined}
        onScroll={(e) => {
          if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
          onScroll?.(e);
        }}
        {...props}
      />
      {!!last && (
        <div ref={mirror} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden break-words whitespace-pre-wrap text-foreground">
          <TokenRuns text={text} tokens={tokens} />
          <span className="text-subtle-foreground">{slotPlaceholder(text.slice(last.end), last.item.argumentHint)}</span>
          {/* A trailing newline only takes up a line with something after it. */}
          {'​'}
        </div>
      )}
    </div>
  );
}

const MIRRORED = ['boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle', 'borderColor', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontFeatureSettings', 'fontVariationSettings', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'textIndent', 'textTransform'] as const;

function syncMirror(textarea: HTMLTextAreaElement, mirror: HTMLDivElement) {
  const style = getComputedStyle(textarea);
  for (const key of MIRRORED) mirror.style[key] = style[key];
  mirror.style.borderColor = 'transparent';
  mirror.scrollTop = textarea.scrollTop;
}

/** A sent message with a known `/name` in it: each token in colour, the rest as typed. */
export function SlashTokenText({ text, items }: { text: string; items: SlashItem[] }) {
  const tokens = slashTokens(text, items);
  if (!tokens.length) return null;
  return (
    <p className="break-words whitespace-pre-wrap">
      <TokenRuns text={text} tokens={tokens} />
    </p>
  );
}

function TokenRuns({ text, tokens }: { text: string; tokens: ReturnType<typeof slashTokens> }) {
  return tokens.map((token, i) => (
    <Fragment key={token.start}>
      {text.slice(tokens[i - 1]?.end ?? 0, token.start)}
      <span className="text-info">{text.slice(token.start, token.end)}</span>
      {i === tokens.length - 1 && text.slice(token.end)}
    </Fragment>
  ));
}
