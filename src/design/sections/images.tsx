import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, Global } from 'reicon-react';
import { Button } from '@/components/ui/button';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { toast } from 'sonner';
import { Block, Grid, Section } from '../layout';
import { BROKEN_PHOTO, DEMO_PHOTOS } from '../imageFixtures';
import { ImageGenCard } from '../../chat/ImageGenCard';
import { IMAGE_OUTLINE, MessageImages } from '../../chat/MessageImages';
import { CallList } from '../../WorkLog';
import { openPhotos } from '../../photo/photos';
import { cn } from '@/lib/utils';
import { ChatView } from '../../ChatView';
import { SplitContext } from '../../layout/SplitContext';
import { NOW0, type ActivityEntry } from '../../model';
import { useHarness } from '../../store';

const { dunes, screenshot, fern, coast, mochi } = DEMO_PHOTOS;
const reveal = () => toast('Would select mochi-sticker.png in Finder');

export function ImagesSection() {
  return (
    <Section
      id="images"
      title="Images"
      intro="Images you attach, images in the agent’s replies and images tools return all render the same way and open one viewer. Generated images get their own card at the size they’ll land at."
    >
      <Grid>
        <Block title="Your message, 1 / 2 / many" use="Above your bubble, right-aligned. One keeps its shape (max 320×240), two are 160px squares, three or more are 80px squares, the fourth counting the rest.">
          <div className="flex flex-col gap-6 rounded-xl border p-4">
            <YourMessage photos={[dunes]} text="Make the hero look like this" />
            <YourMessage photos={[dunes, fern]} text="Which of these two reads better at 40%?" />
            <YourMessage photos={[dunes, fern, coast, screenshot, mochi, dunes]} text="Use these six for the gallery fixture" />
          </div>
        </Block>

        <Block title="In the agent’s reply" use="Markdown images, including local paths the agent wrote. Same tile as yours, left-aligned in the prose; a sweep while it loads; a named chip when the file is gone.">
          <div className="flex flex-col gap-6 rounded-xl border p-4">
            <AgentMessage text="Here’s the chart after the fix:">
              <MessageImages photos={[screenshot]} />
            </AgentMessage>
            <AgentMessage text="Loading (slow file):">
              <LoadingTile />
            </AgentMessage>
            <AgentMessage text="The earlier capture was cleaned up:">
              <MessageImages photos={[BROKEN_PHOTO]} />
            </AgentMessage>
          </div>
        </Block>

        <Block title="Returned by a tool" use="Screenshots and image reads: folded, the group shows up to 3 thumbs at the end of its line; open, the call row opens to the image.">
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <FoldedGroup />
            <CallList>
              <li className="flex flex-col">
                <div className="flex h-9 min-w-0 items-center gap-2.5 px-3 type-meta hover:bg-accent/60">
                  <Global aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-foreground">Took a screenshot of localhost:5173</span>
                  <ChevronRight aria-hidden className="size-3.5 shrink-0 rotate-90 text-subtle-foreground" />
                </div>
                <div className="px-3 pb-3">
                  <MessageImages photos={[screenshot]} />
                </div>
              </li>
            </CallList>
          </div>
        </Block>

        <Block title="Viewer" use="The one lightbox for every chat image: arrows step through the message’s set, zoom and pan, copy, download, and Show in Finder for files on disk.">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border p-4">
            <Button variant="outline" onClick={() => openPhotos({ photos: [dunes, fern, coast], index: 0 })}>
              Open a set of 3
            </Button>
            <Button variant="outline" onClick={() => openPhotos({ photos: [{ ...mochi, reveal }], index: 0 })}>
              Open a generated image
            </Button>
          </div>
        </Block>

        <Block wide title="Generated image: generating" use="A dot grid in the frame, at the target aspect; soft light drifts through it, the dots swelling and brightening where it pools. Off-screen frames stop drawing; reduced motion holds one still frame.">
          <div className="flex flex-wrap items-start gap-6 rounded-xl border p-4">
            <GenSample label="1:1">
              <ImageGenCard image={{ status: 'running', prompt: 'A mochi mascot sticker, soft pastel, white outline' }} startedMs={SINCE_12S} />
            </GenSample>
            <GenSample label="3:2, no prompt yet">
              <ImageGenCard image={{ status: 'running', aspect: 3 / 2 }} />
            </GenSample>
            <GenSample label="2:3">
              <ImageGenCard image={{ status: 'running', aspect: 2 / 3, prompt: 'Poster for a quiet jazz night' }} startedMs={SINCE_41S} />
            </GenSample>
          </div>
        </Block>

        <Block wide title="Generated image: lands, done, failed" use="Replay generates for 4 s, then the image opens out from where the light last pooled as its blur clears (900 ms). One already done when the thread opens just shows.">
          <div className="flex flex-wrap items-start gap-6 rounded-xl border p-4">
            <LiveSample />
            <GenSample label="Done">
              <ImageGenCard image={{ status: 'done', src: mochi.src, prompt: 'A mochi mascot sticker, soft pastel, white outline, on a mint background' }} />
            </GenSample>
            <GenSample label="Failed">
              <ImageGenCard image={{ status: 'failed', prompt: 'A mochi mascot sticker, soft pastel, white outline', error: 'Image generation limit reached. Resets at 4:30 PM.' }} />
            </GenSample>
          </div>
        </Block>
        <Block wide title="In the transcript" use="The real ChatView on a demo thread: your images, a tool that returned a screenshot (folded thumbs, open the group for the row), a markdown image, and Codex-style generations running and done.">
          <TranscriptSample />
        </Block>
      </Grid>
    </Section>
  );
}

function YourMessage({ photos, text }: { photos: typeof dunes[]; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <MessageImages photos={photos} className="justify-end" />
      <Message from="user">
        <MessageContent className="type-prose">{text}</MessageContent>
      </Message>
    </div>
  );
}

function AgentMessage({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Message from="assistant">
      <MessageContent className="w-full gap-2 type-prose">
        <p>{text}</p>
        {children}
      </MessageContent>
    </Message>
  );
}

// A tile frozen in its loading state: a real one only shows this until its image decodes.
function LoadingTile() {
  return <span className={cn('relative block h-40 w-60 overflow-hidden rounded-lg skeleton-sheen', IMAGE_OUTLINE)} />;
}

function FoldedGroup() {
  return (
    <div className="-mx-2 flex min-w-0 items-center gap-2">
      <span className="flex h-7 min-w-0 items-center gap-2 rounded-lg px-2 type-meta text-muted-foreground">
        Took 2 screenshots, read 1 image
        <ChevronRight aria-hidden className="size-3 text-subtle-foreground" />
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1 pr-2">
        {[screenshot, dunes, fern].map((p) => (
          <span key={p.name} className={cn('relative h-6 w-9 overflow-hidden rounded-md bg-muted', IMAGE_OUTLINE)}>
            <img src={p.src} alt="" className="size-full object-cover" />
          </span>
        ))}
      </span>
    </div>
  );
}

const LIVE_MS = 4000;
const SINCE_12S = Date.now() - 12_000;
const SINCE_41S = Date.now() - 41_000;

function LiveSample() {
  const [run, setRun] = useState(0);
  const [isDone, setDone] = useState(false);
  useEffect(() => {
    setDone(false);
    const timer = setTimeout(() => setDone(true), LIVE_MS);
    return () => clearTimeout(timer);
  }, [run]);
  return (
    <GenSample label="Live">
      <ImageGenCard
        key={run}
        image={isDone ? { status: 'done', src: mochi.src, prompt: 'A mochi mascot sticker, soft pastel, white outline' } : { status: 'running', prompt: 'A mochi mascot sticker, soft pastel, white outline' }}
      />
      <Button variant="outline" size="sm" className="self-start" onClick={() => setRun((r) => r + 1)}>
        Replay
      </Button>
    </GenSample>
  );
}

function TranscriptSample() {
  const { state } = useHarness();
  // A thread with nothing queued, so no question tray covers the sample.
  const quiet = state.threads.find((t) => !state.queue.some((q) => q.threadId === t.id))!;
  return (
    <div className="flex h-[720px] flex-col overflow-hidden rounded-xl border">
      <SplitContext.Provider value={{ leafId: 'design-images', isFocused: false, isMulti: false, isZoomed: false, isFirst: false, isWide: true }}>
        <ChatView thread={{ ...quiet, activity: TRANSCRIPT }} />
      </SplitContext.Provider>
    </div>
  );
}

const PROMPT = 'A mochi mascot sticker, soft pastel, white outline, on a mint background';
const TRANSCRIPT: ActivityEntry[] = [
  { at: NOW0, who: 'you', kind: 'message', text: 'Make the hero feel like these, then draw me a mascot', images: [dunes.src, fern.src, coast.src] },
  { at: NOW0, who: 'claude', kind: 'tool', text: 'Mcp playwright: browser_take_screenshot', toolId: 'img-1', mcp: { server: 'playwright', tool: 'browser_take_screenshot' }, images: [screenshot.src] },
  { at: NOW0, who: 'claude', kind: 'tool', text: 'Run pnpm build', toolId: 'img-2', exitCode: 0, output: 'built in 1.2s' },
  { at: NOW0, who: 'claude', kind: 'message', text: `Here’s the hero as it renders now:\n\n![Current hero](${screenshot.src})\n\nGenerating the mascot next.` },
  { at: NOW0, who: 'claude', kind: 'tool', text: 'Generate image', toolId: 'img-3', generated: { status: 'done', prompt: PROMPT, src: mochi.src } },
  { at: NOW0, who: 'claude', kind: 'tool', text: 'Generate image', toolId: 'img-4', ms: Date.now() - 9_000, generated: { status: 'running', prompt: 'The same mascot waving, transparent background' } },
];

function GenSample({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex w-full max-w-72 flex-col gap-2">
      <span className="type-caption text-subtle-foreground">{label}</span>
      {children}
    </div>
  );
}
