import { useState, type ReactNode } from 'react';
import { MessageResponse } from '@/components/ai-elements/message';
import { Expand, FoldChevron } from '@/Fold';
import { cn } from '@/lib/utils';
import { CodeFrame } from '../viz/CodeFrame';
import { fenced, resultCode, type CallArg } from './callArgs';

/**
 * An expanded call, like Claude desktop's: why the agent made it, every argument it sent, then what came back. `result` is
 * the call's own view (a diff, a command's output, a file); without one, the raw `output` shows in a code frame.
 */
export function CallDetail({
  intent,
  args,
  result,
  output,
  isError,
}: {
  intent?: string;
  args: CallArg[];
  result?: ReactNode;
  output?: string;
  isError?: boolean;
}) {
  const hasRaw = !result && !!output?.trim();
  return (
    <div className="flex flex-col gap-3">
      {!!intent && (
        <p className="type-meta text-pretty text-muted-foreground">{intent}</p>
      )}
      {args.length > 0 && (
        <Section title="Arguments">
          <ArgList args={args} />
        </Section>
      )}
      {!!result && result}
      {hasRaw && (
        <Section
          title={isError ? 'Error' : 'Result'}
          className={cn(isError && 'text-destructive')}
        >
          <CodeBlock {...resultCode(output!)} />
        </Section>
      )}
    </div>
  );
}

/** Whether a call has anything to open to. */
export const hasCallDetail = ({
  intent,
  args,
  result,
  output,
}: {
  intent?: string;
  args: CallArg[];
  result?: ReactNode;
  output?: string;
}) => !!intent || args.length > 0 || !!result || !!output?.trim();

function Section({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className={cn('type-caption text-subtle-foreground', className)}>
        {title}
      </h4>
      {children}
    </section>
  );
}

/** Each argument as a key and its value; long text and objects fold to their first line and open to a code frame. */
export function ArgList({ args }: { args: CallArg[] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-4 gap-y-1 type-meta">
      {args.map((arg) =>
        arg.kind === 'inline' ? (
          <div key={arg.key} className="col-span-2 grid grid-cols-subgrid">
            <dt className="truncate text-muted-foreground">{arg.key}</dt>
            <dd className="font-mono text-xs/5 [overflow-wrap:anywhere] text-foreground">
              {arg.text}
            </dd>
          </div>
        ) : (
          <BlockArg key={arg.key} arg={arg} />
        ),
      )}
    </dl>
  );
}

function BlockArg({ arg }: { arg: Extract<CallArg, { kind: 'block' }> }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <div className="col-span-2 grid grid-cols-subgrid">
      <dt className="truncate text-muted-foreground">{arg.key}</dt>
      <dd className="min-w-0">
        <button
          type="button"
          aria-expanded={isOpen}
          aria-label={`${isOpen ? 'Hide' : 'Show'} ${arg.key}`}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full min-w-0 cursor-default items-center gap-1 text-left text-subtle-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span
            className={cn(
              'min-w-0 truncate font-mono text-xs/5',
              isOpen && 'invisible',
            )}
          >
            {arg.preview}
          </span>
          <FoldChevron isOpen={isOpen} />
        </button>
      </dd>
      <div className="col-span-2 min-w-0">
        <Expand isOpen={isOpen}>
          <CodeBlock code={arg.code} language={arg.language} />
        </Expand>
      </div>
    </div>
  );
}

/** Text in the chat's code frame: highlighted, with its language and copy in the caption row. */
function CodeBlock({ code, language }: { code: string; language: string }) {
  return (
    <MessageResponse
      components={CODE_ONLY}
      className="max-h-80 overflow-auto [&_figure]:my-0!"
    >
      {fenced(code, language)}
    </MessageResponse>
  );
}

const CODE_ONLY = { code: CodeFrame };
