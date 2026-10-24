import { useState } from 'react';
import { PromptInputProvider, type PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import { ChatView } from '../ChatView';
import { ComposerCard, ComposerInput } from '../Composer';
import { settingsChatDraftKey } from '../chat/drafts';
import { host } from '../host';
import { SplitContext } from '../layout/SplitContext';
import type { ThreadControls } from '../runtime/controls';
import { initialControls } from '../runtime/startOptions';
import { useSideChatDefault } from '../sidechat/useSideChat';
import { useHarness, type State } from '../store';

// Reading and suggesting settings needs little thought; main swaps it for the model's own if the model doesn't take it.
const SETTINGS_CHAT_EFFORT = 'medium';

const SUGGESTIONS = ['Change the default model', 'Use the dark theme', 'Ask before deleting anything', 'Add an MCP server'];

// The chat isn't in the workspace: one fixed leaf, wide enough to dock what a thread docks.
const SETTINGS_LEAF = { leafId: 'settings-chat', isFocused: true, isMulti: false, isZoomed: false, isFirst: false, isWide: true };

/** Settings' first page: the profile's settings chat, the only thread with Mochi's settings tools (RUNTIME.md › Mochi tools). */
export function SettingsChat() {
  const { state } = useHarness();
  const thread = settingsChatOf(state);
  if (!thread) return <SettingsChatStart />;
  return (
    <SplitContext.Provider value={SETTINGS_LEAF}>
      <ChatView key={thread.id} thread={thread} />
    </SplitContext.Provider>
  );
}

export const settingsChatOf = (state: State) => state.threads.find((t) => t.spaceId === state.spaceId && t.isSettingsChat);

/** Before the first message: what the chat is for, a few starters and the composer; sending starts the chat. */
function SettingsChatStart() {
  const { state, dispatch } = useHarness();
  const [choice] = useSideChatDefault();
  const [picked, setPicked] = useState<ThreadControls | null>(null);
  const provider = choice?.provider ?? 'claude';
  const controls = picked ?? { ...initialControls(provider, choice?.model ?? ''), effort: SETTINGS_CHAT_EFFORT, speed: '' };
  const start = ({ text }: PromptInputMessage) => {
    const title = text.trim();
    if (!title || !choice) return false;
    dispatch({ type: 'create', title, provider, project: null, controls, isLive: host.isDesktop, isBackground: true, isSettingsChat: true });
  };

  return (
    <div className="mx-auto flex w-full max-w-180 flex-col gap-6 px-4 pt-[20vh] pb-16 md:px-8">
      <header className="flex flex-col gap-2 px-1">
        <h1 className="type-display">Ask Mochi</h1>
        <p className="text-pretty text-muted-foreground">Say what you want to change. Mochi shows each setting here with its suggested value, and nothing changes until you pick it.</p>
      </header>
      <PromptInputProvider key={state.spaceId}>
        <ComposerCard>
          <ComposerInput autoFocus draftKey={settingsChatDraftKey(state.spaceId)} controls={controls} provider={provider} isLocked isModelOnly onControlsChange={setPicked} slashItems={[]} onSend={start} placeholder="Change a setting…" />
        </ComposerCard>
      </PromptInputProvider>
      <div className="flex flex-wrap gap-2 px-1">
        {SUGGESTIONS.map((text) => (
          <Button key={text} variant="outline" size="sm" disabled={!choice} onClick={() => start({ text, files: [] })}>
            {text}
          </Button>
        ))}
      </div>
    </div>
  );
}
