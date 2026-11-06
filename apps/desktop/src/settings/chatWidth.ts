import { useEffect } from 'react';
import { usePrefs, type Prefs } from './prefs';

// index.css sets the medium width on :root, so the first paint has it before this runs.
const CHAT_WIDTH = {
  narrow: '720px',
  medium: '840px',
  wide: '960px',
  full: 'none',
} satisfies Record<Prefs['chatWidth'], string>;

/** Puts Settings › Appearance › Chat width on the root as `--chat-width`, the chat column's max width. */
export function useApplyChatWidth() {
  const { chatWidth } = usePrefs();
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--chat-width',
      CHAT_WIDTH[chatWidth],
    );
  }, [chatWidth]);
}
