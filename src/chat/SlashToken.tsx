import { useLayoutEffect, useRef, type ComponentProps } from 'react';
import { PromptInputTextarea, usePromptInputController } from '@/components/ai-elements/prompt-input';
import { cn } from '@/lib/utils';
import { resolveToken, slotPlaceholder, type SlashItem } from './slash';

/**
 * The composer's textarea with a resolved `/name` in colour and its argument slots as muted placeholder text. A textarea
 * can't colour runs, so while a token resolves its own text goes transparent and a mirror on top (no pointer events) draws
 * it: the textarea keeps caret, selection, IME and undo; the mirror copies its box metrics and scroll offset.
 */
export function TokenTextarea({ items, className, onScroll, ...props }: ComponentProps<typeof PromptInputTextarea> & { items: SlashItem[] }) {
  const { textInput } = usePromptInputController();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const text = textInput.value;
  const token = resolveToken(text, items);

  useLayoutEffect(() => {
    if (token && textarea.current && mirror.current) syncMirror(textarea.current, mirror.current);
  });

  return (
    <div className="relative w-full">
      <PromptInputTextarea
        ref={textarea}
        // No colour transition: the text must vanish the frame the mirror shows it.
        className={cn(className, 'transition-none', !!token && 'text-transparent caret-foreground')}
        // The mirror can't show a scrollbar, so the textarea hides its own and both wrap at the same width.
        style={token ? { scrollbarWidth: 'none' } : undefined}
        onScroll={(e) => {
          if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
          onScroll?.(e);
        }}
        {...props}
      />
      {!!token && (
        <div ref={mirror} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden break-words whitespace-pre-wrap text-foreground">
          <span className="text-info">{text.slice(0, token.end)}</span>
          {token.rest}
          <span className="text-subtle-foreground">{slotPlaceholder(token.rest, token.item.argumentHint)}</span>
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

/** A sent message that opens with a known `/name`: the token in colour, the rest as typed. */
export function SlashTokenText({ text, items }: { text: string; items: SlashItem[] }) {
  const token = resolveToken(text, items);
  if (!token) return null;
  return (
    <p className="break-words whitespace-pre-wrap">
      <span className="text-info">{text.slice(0, token.end)}</span>
      {token.rest}
    </p>
  );
}
