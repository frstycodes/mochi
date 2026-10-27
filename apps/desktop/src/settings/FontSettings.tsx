import { MessageResponse } from '@/components/ai-elements/message';
import { Button } from '@/components/ui/button';
import { CatalogRow } from './CatalogRow';
import { SettingsGroup, SettingsSection } from './parts';
import { DEFAULT_PREFS, setPrefs, usePrefs } from './prefs';

/** Settings › Appearance › Fonts: the interface and code fonts with their sizes, then the chat in them. */
export function FontSettings() {
  const prefs = usePrefs();
  const isDefault = FONT_PREFS.every(
    (key) => prefs[key] === DEFAULT_PREFS[key],
  );
  const reset = () =>
    setPrefs(
      Object.fromEntries(FONT_PREFS.map((key) => [key, DEFAULT_PREFS[key]])),
    );
  return (
    <>
      <SettingsGroup
        id="fonts"
        title="Fonts"
        action={
          !isDefault && (
            <Button variant="ghost" size="xs" onClick={reset}>
              Reset to default
            </Button>
          )
        }
        footer="A font that isn't installed falls back to the system font, or to JetBrains Mono for code."
      >
        <CatalogRow settingKey="uiFont" />
        <CatalogRow settingKey="uiTextSize" />
        <CatalogRow settingKey="monoFont" />
        <CatalogRow settingKey="codeFontSize" />
      </SettingsGroup>
      <SettingsSection title="Preview">
        <div className="px-1 type-prose">
          <MessageResponse isAnimating={false}>
            {PREVIEW_MARKDOWN}
          </MessageResponse>
        </div>
      </SettingsSection>
    </>
  );
}

const FONT_PREFS = [
  'uiFont',
  'uiTextSize',
  'monoFont',
  'codeFontSize',
] as const;

const PREVIEW_MARKDOWN = `The retry now reads \`Retry-After\` before backing off, so a 429 waits exactly as long as the server asks. I moved the loop into one helper that every provider shares:

\`\`\`ts
export async function withRetry<T>(run: () => Promise<T>, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= tries || !isRateLimit(error)) throw error;
      await sleep(retryAfterMs(error) ?? 2 ** attempt * 250);
    }
  }
}
\`\`\``;
