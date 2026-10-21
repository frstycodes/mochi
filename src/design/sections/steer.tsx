import { useState } from 'react';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import { NextMoveAsk, NextMoveCard, NextMoveContent, NextMoveSummary } from '../../goals/NextMove';
import { SupersededNote } from '../../goals/ReportCard';
import { SteerBubble, ReadMark } from '../../chat/SteerBubble';
import { Block } from '../layout';
import { ComposerStub, MockFrame, WorkLine } from './next-move';

/** A message sent while the agent works: pending under the live turn, then placed where the agent read it. Mock data. */
export function SteerBlock() {
  return (
    <Block
      title="Message while working"
      use="Sent while the agent works, your message waits under the live turn, dimmed, until the agent's next step takes it. Hovering floats an X over its corner; it, or a click on the bubble, takes it back into the message box, unsent. Send now in its bar stops the turn and sends it first, the other waiting messages after it. Once read it moves to where the agent read it, after that step, and its bar shows two checks. On hover, one check means not read yet and two mean read. A report the agent wrote before reading it is kept, muted, without its answers."
      wide
    >
      <div className="flex flex-col gap-12">
        <PendingMock />
        <MockFrame label="Read · placed after the step that took it">
          <WorkLine>Edited 2 files</WorkLine>
          <p className="type-prose">The cookie test passes. Running the full suite before I wrap up.</p>
          <WorkLine>Ran pnpm test</WorkLine>
          <div className="group/row flex flex-col gap-1">
            <YourMessage>create a PR and merge</YourMessage>
            <div className="flex items-center justify-end gap-0.5 pr-1">
              <time className="mr-1 type-caption text-subtle-foreground tabular opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100">2 minutes ago</time>
              <ReadMark agent="Claude" isRead />
            </div>
          </div>
          <p className="type-prose">Opening the PR now, and merging once its checks pass.</p>
          <WorkLine>Opened #137 fix(auth): keep the session cookie name</WorkLine>
          <ComposerStub placeholder="Steer Claude while it works" />
        </MockFrame>
        <MockFrame label="Superseded · its report came before your message">
          <WorkLine>Ran pnpm test</WorkLine>
          <NextMoveCard className="opacity-60">
            <NextMoveContent>
              <SupersededNote />
              <NextMoveSummary>The session cookie keeps its name through the Better Auth migration. Every criterion passes on the branch.</NextMoveSummary>
              <NextMoveAsk question="Open a pull request for the cookie fix?" />
            </NextMoveContent>
          </NextMoveCard>
          <ComposerStub placeholder="Message Claude" />
        </MockFrame>
      </div>
    </Block>
  );
}

function PendingMock() {
  const [isTaken, setTaken] = useState(false);
  const [isSending, setSending] = useState(false);
  const reset = () => (setTaken(false), setSending(false));
  return (
    <MockFrame label="Pending · hover for the X that takes it back and Send now" control={(isTaken || isSending) && <Button size="xs" variant="outline" onClick={reset}>Reset</Button>}>
      <WorkLine>Edited 2 files</WorkLine>
      <p className="type-prose">The cookie test passes. Running the full suite before I wrap up.</p>
      {!isTaken && <SteerBubble text="create a PR and merge" agent="Claude" isSending={isSending} onTakeBack={() => setTaken(true)} onSendNow={() => setSending(true)} />}
      <ComposerStub placeholder="Steer Claude while it works" draft={isTaken ? 'create a PR and merge' : undefined} />
    </MockFrame>
  );
}

function YourMessage({ children }: { children: string }) {
  return (
    <Message from="user">
      <MessageContent className="type-prose">{children}</MessageContent>
    </Message>
  );
}
