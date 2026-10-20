import { Check, CheckSingle, X } from '@/icons';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/toast/store';
import { TooltipIconButton } from '../ui';
import { host } from '../host';
import { authorName, type QueuedMessage, type Thread } from '../model';
import { useHarness } from '../store';
import { MessageImages } from './MessageImages';

/** Your messages the agent hasn't read yet, under the live turn. Taking one back returns it to the composer, unless the agent already has it. */
export function PendingSteers({ thread, onTakeBack }: { thread: Thread; onTakeBack: (message: QueuedMessage) => void }) {
  const { dispatch } = useHarness();
  const agent = authorName(thread.providers[0]);
  const takeBack = async (message: QueuedMessage) => {
    if (!(await host.agent.unsteer(thread.id, message.id))) return toast(`${agent} is already reading it`);
    dispatch({ type: 'steer-take-back', threadId: thread.id, id: message.id });
    onTakeBack(message);
  };
  return thread.steering?.map(({ message, entry }) => <SteerBubble key={message.id} text={message.draft} images={entry.images} agent={agent} onTakeBack={() => void takeBack(message)} />);
}

/** A message you sent while the agent works, before the agent has read it: under the live turn, dimmed; hovering floats an X over its corner, and it or the bubble takes the message back. */
export function SteerBubble({ text, images, agent, onTakeBack }: { text: string; images?: string[]; agent: string; onTakeBack?: () => void }) {
  return (
    <div data-pending-steer className="group/row flex flex-col gap-1">
      {!!images?.length && <MessageImages photos={images.map((src, i) => ({ src, name: `Image ${i + 1}` }))} className="justify-end opacity-60" />}
      <Message from="user">
        {/* The bubble takes a click too; the X is the button keyboards and screen readers get. */}
        <div onClick={onTakeBack} className="group/bubble relative self-end">
          <MessageContent className="type-prose whitespace-pre-wrap transition-colors group-[.is-user]:bg-secondary/50 group-[.is-user]:text-muted-foreground group-hover/bubble:group-[.is-user]:bg-secondary group-hover/bubble:group-[.is-user]:text-foreground">{text}</MessageContent>
          {!!onTakeBack && (
            <TooltipIconButton
              label="Take back and edit"
              hint={`${agent} hasn’t read it yet. It goes back to the message box, unsent.`}
              onClick={(e) => {
                e.stopPropagation();
                onTakeBack();
              }}
              className="absolute -top-2.5 -right-2.5 size-6 rounded-full border bg-popover text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/bubble:opacity-100 hover:bg-popover hover:text-foreground focus-visible:opacity-100 pointer-coarse:opacity-100 [&_svg]:size-3"
            >
              <X />
            </TooltipIconButton>
          )}
        </div>
      </Message>
      <div className="flex justify-end pr-1">
        <ReadMark agent={agent} isRead={false} />
      </div>
    </div>
  );
}

/** One check while the agent hasn't read your message, two once it has; revealed with the message's bar, on hover or focus inside its row. */
export function ReadMark({ agent, isRead }: { agent: string; isRead: boolean }) {
  const label = isRead ? `Seen by ${agent}` : `Not read yet: ${agent} takes it at its next step`;
  const Icon = isRead ? Check : CheckSingle;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label={label} tabIndex={0} className="inline-flex size-6 items-center justify-center rounded-sm text-subtle-foreground opacity-0 outline-none transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring">
          <Icon aria-hidden className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
