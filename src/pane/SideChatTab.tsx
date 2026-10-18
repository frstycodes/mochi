import { ArrowUp, Broom, File, MessagePlus, MessageQuestion, SendAlt, X, type IconComponent } from '@/icons';
import { DiffIcon, TerminalIcon } from '../icons/panes';
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { Message, MessageActions, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputHeader, PromptInputProvider, PromptInputSubmit, PromptInputTools } from '@/components/ai-elements/prompt-input';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ComposerCard } from '../Composer';
import { ComposerEditor } from '../chat/ComposerEditor';
import type { SlashItem } from '../chat/slash';
import { ModelPicker } from '../ModelControls';
import { useSideChat } from '../sidechat/useSideChat';
import { SOURCE_NAMES, type Quote, type QuoteSource, type SideMessage } from '../store/sidechat';
import { VIZ_COMPONENTS, VIZ_PLUGINS, VIZ_REHYPE_PLUGINS } from '../viz/FenceVisual';
import { VizThreadProvider } from '../viz/WidgetVisual';
import { PaneActions } from './PaneHeader';
import type { PaneTabProps } from './tabs';

export function SideChatTab({ thread, tab }: PaneTabProps) {
  const side = useSideChat(thread, tab.id);
  const isEmpty = side.chat.messages.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="shrink-0 truncate px-3 pb-1 type-meta text-muted-foreground">
        Aside from <span className="text-foreground">{thread.title}</span>
      </p>
      <PaneActions>
        <HeaderAction label="Clear side chat" icon={Broom} disabled={isEmpty || side.isStreaming} onClick={side.clear} />
      </PaneActions>
      {isEmpty ? (
        <EmptySideChat />
      ) : (
        <Conversation className="min-h-0 flex-1">
          <VizThreadProvider value={thread.id}>
            <ConversationContent className="gap-5 px-4 pt-2 pb-4">
              {side.chat.messages.map((m) => (m.role === 'user' ? <Question key={m.id} message={m} /> : <Answer key={m.id} message={m} onPromote={(to) => side.promote(m.id, to)} />))}
            </ConversationContent>
          </VizThreadProvider>
          <ConversationScrollButton />
        </Conversation>
      )}
      <div className="shrink-0 px-3 pb-3">
        <ComposerCard>
          <PromptInputProvider>
          <PromptInput onSubmit={({ text }) => void (text.trim() && side.ask(text.trim()))}>
            {!!side.chat.draft && (
              <PromptInputHeader className="px-3 pt-3">
                <QuoteCard quote={side.chat.draft} onRemove={() => side.setDraft(undefined)} />
              </PromptInputHeader>
            )}
            <PromptInputBody>
              <ComposerEditor items={NO_SLASH_ITEMS} attributes={{ 'data-sidechat-input': thread.id }} autoFocus={!!side.chat.draft} placeholder={side.chat.draft ? 'Ask about this selection' : 'Ask about this thread'} className="type-prose max-md:text-base" />
            </PromptInputBody>
            <PromptInputFooter className="px-2 pb-2">
              <PromptInputTools>
                <ModelPicker value={side.model.model} provider={side.model.provider} onChange={(m) => side.setModel({ provider: m.harness, model: m.id })} />
              </PromptInputTools>
              <PromptInputTools>
                <PromptInputSubmit aria-label="Ask" disabled={side.isStreaming}>
                  <ArrowUp className="size-4" />
                </PromptInputSubmit>
              </PromptInputTools>
            </PromptInputFooter>
          </PromptInput>
          </PromptInputProvider>
        </ComposerCard>
      </div>
    </div>
  );
}

const NO_SLASH_ITEMS: SlashItem[] = [];

function HeaderAction({ label, icon: Icon, ...props }: { label: string; icon: IconComponent } & Omit<React.ComponentProps<typeof Button>, 'children'>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} className="text-muted-foreground" {...props}>
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function EmptySideChat() {
  return (
    <ConversationEmptyState className="min-h-0 flex-1">
      <MessageQuestion className="size-6 text-muted-foreground" aria-hidden />
      <div className="flex max-w-64 flex-col gap-1">
        <h3 className="type-title">Ask without derailing the thread</h3>
        <p className="type-meta text-muted-foreground">Answers see the goal, steps, recent activity and diff, but nothing here reaches the agent unless you send it.</p>
      </div>
    </ConversationEmptyState>
  );
}

export function Question({ message }: { message: SideMessage }) {
  return (
    <Message from="user">
      <MessageContent className="type-prose">
        {!!message.quote && <QuoteCard quote={message.quote} />}
        <p className="whitespace-pre-wrap">{message.text}</p>
      </MessageContent>
    </Message>
  );
}

/** `onPromote` unset: another computer's answer, which can't be sent on from here. */
export function Answer({ message, onPromote }: { message: SideMessage; onPromote?: (to: 'message' | 'thread') => void }) {
  const isThinking = !!message.isStreaming && !message.text;
  const canPromote = !!onPromote && !message.isStreaming && !message.promotedTo;
  return (
    <Message from="assistant" className="max-w-full">
      <MessageContent className="w-full type-prose">
        {isThinking && <Shimmer className="type-meta">Reading the thread</Shimmer>}
        <MessageResponse plugins={VIZ_PLUGINS} components={VIZ_COMPONENTS} rehypePlugins={VIZ_REHYPE_PLUGINS} isAnimating={!!message.isStreaming}>
          {message.text}
        </MessageResponse>
      </MessageContent>
      {canPromote && (
        <MessageActions className="-ml-2">
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onPromote?.('message')}>
            <SendAlt aria-hidden />
            Send to thread
          </Button>
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => onPromote?.('thread')}>
            <MessagePlus aria-hidden />
            New thread
          </Button>
        </MessageActions>
      )}
      {!!message.promotedTo && <p className="type-caption text-subtle-foreground">{message.promotedTo === 'message' ? 'Sent to the thread' : 'Started a new thread'}</p>}
    </Message>
  );
}

const SOURCE_ICONS = { diff: DiffIcon, terminal: TerminalIcon, file: File } satisfies Record<QuoteSource, IconComponent>;

function QuoteCard({ quote, onRemove }: { quote: Quote; onRemove?: () => void }) {
  const Icon = SOURCE_ICONS[quote.source];
  return (
    <figure className="flex w-full min-w-0 flex-col overflow-hidden rounded-lg border">
      <figcaption className="flex h-7 items-center gap-1.5 pr-1 pl-2.5 type-caption text-subtle-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="shrink-0 font-medium text-muted-foreground">{SOURCE_NAMES[quote.source]}</span>
        <span className="min-w-0 truncate font-mono" title={quote.label}>
          {quote.label}
        </span>
        {!!onRemove && (
          <Button variant="ghost" size="icon-xs" aria-label="Remove selection" className="ml-auto" onClick={onRemove}>
            <X />
          </Button>
        )}
      </figcaption>
      <pre className="max-h-32 overflow-auto px-2.5 pb-2 font-mono text-xs leading-5 text-foreground">{quote.text}</pre>
    </figure>
  );
}
