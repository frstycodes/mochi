import { Fragment } from 'react';
import { slashTokens, type SlashItem } from './slash';

/** A sent message with a known `/name` in it: each token in colour, the rest as typed. */
export function SlashTokenText({ text, items }: { text: string; items: SlashItem[] }) {
  const tokens = slashTokens(text, items);
  if (!tokens.length) return null;
  return (
    <p className="break-words whitespace-pre-wrap">
      <TokenRuns text={text} tokens={tokens} />
    </p>
  );
}

function TokenRuns({ text, tokens }: { text: string; tokens: ReturnType<typeof slashTokens> }) {
  return tokens.map((token, i) => (
    <Fragment key={token.start}>
      {text.slice(tokens[i - 1]?.end ?? 0, token.start)}
      <span className="text-info">{text.slice(token.start, token.end)}</span>
      {i === tokens.length - 1 && text.slice(token.end)}
    </Fragment>
  ));
}
