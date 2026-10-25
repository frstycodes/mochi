import {
  isValidElement,
  useRef,
  type ComponentProps,
  type ReactNode,
} from 'react';
import {
  CodeBlockDownloadButton,
  defaultComponents,
  type ExtraProps,
} from 'streamdown';
import { Code, DiagramTree, Download } from '@/icons';
import { buttonVariants } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { EmbedFrame } from './EmbedFrame';
import { VIZ_LANGUAGES } from '@mochi/domain/viz/fence';
import { serializeSvg } from './exportVisual';
import { CopyButton, VisualFrame } from './VisualFrame';

/** Streamdown's code blocks and mermaid diagrams in the embed frame: the content flush in the hairline, its name and actions in the caption row below. */
export function CodeFrame(props: ComponentProps<'code'> & ExtraProps) {
  const DefaultCode = defaultComponents.code;
  const language = LANGUAGE.exec(props.className ?? '')?.[1] ?? '';
  const code = codeText(props.children);
  // Fenced visuals draw their own frame.
  if (VIZ_SET.has(language)) return <DefaultCode {...props} />;
  if (language === 'mermaid')
    return (
      <MermaidFrame code={code}>
        <DefaultCode {...props} />
      </MermaidFrame>
    );
  return (
    <EmbedFrame
      icon={Code}
      title={language || 'Code'}
      className={cn('my-3', FLUSH)}
      actions={<CodeActions code={code} language={language} />}
    >
      <DefaultCode {...props} />
    </EmbedFrame>
  );
}

const LANGUAGE = /language-(\S+)/;

const VIZ_SET = new Set<string>(VIZ_LANGUAGES);

// Streamdown's block always draws its card, header and floating actions; the frame replaces all three.
const FLUSH = cn(
  '[&_[data-streamdown=code-block]]:my-0 [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:rounded-none [&_[data-streamdown=code-block]]:border-0 [&_[data-streamdown=code-block]]:bg-transparent [&_[data-streamdown=code-block]]:p-0',
  '[&_[data-streamdown=code-block-header]]:hidden [&_[data-streamdown=code-block-actions]]:hidden',
  '[&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:p-3',
);

function MermaidFrame({
  code,
  children,
}: {
  code: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const svg = () => {
    const el = box.current?.querySelector<SVGSVGElement>(
      '[aria-label="Mermaid chart"] svg',
    );
    if (!el) throw new Error('Nothing to export yet');
    return serializeSvg(el);
  };
  return (
    <VisualFrame
      icon={DiagramTree}
      title="Diagram"
      source={{ text: code, ext: 'mmd', type: 'text/plain' }}
      svg={svg}
    >
      {/* Until the mermaid plugin loads, Streamdown shows the fence as a code block. */}
      <div ref={box} className={cn(FLUSH, MERMAID_FLUSH)}>
        {children}
      </div>
    </VisualFrame>
  );
}

// Streamdown's mermaid block draws a card, a "mermaid" header row (its first child, no data attribute) and floating actions; the frame replaces all three.
const MERMAID_FLUSH = cn(
  '[&_[data-streamdown=mermaid-block]]:my-0 [&_[data-streamdown=mermaid-block]]:gap-0 [&_[data-streamdown=mermaid-block]]:rounded-none [&_[data-streamdown=mermaid-block]]:border-0 [&_[data-streamdown=mermaid-block]]:bg-transparent [&_[data-streamdown=mermaid-block]]:p-0',
  '[&_[data-streamdown=mermaid-block]>div:first-child]:hidden [&_[data-streamdown=mermaid-block-actions]]:hidden',
  '[&_[data-streamdown=mermaid-block]>div:last-child]:rounded-none [&_[data-streamdown=mermaid-block]>div:last-child]:border-0',
);

function CodeActions({ code, language }: { code: string; language: string }) {
  return (
    <>
      <CopyButton text={code} label="Copy code" />
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Streamdown's button: it knows each language's file extension. */}
          <CodeBlockDownloadButton
            code={code}
            language={language}
            title={undefined}
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
          >
            <Download />
          </CodeBlockDownloadButton>
        </TooltipTrigger>
        <TooltipContent>Download</TooltipContent>
      </Tooltip>
    </>
  );
}

function codeText(children: ReactNode) {
  if (typeof children === 'string') return children;
  if (
    isValidElement<{ children?: unknown }>(children) &&
    typeof children.props.children === 'string'
  )
    return children.props.children;
  return '';
}
