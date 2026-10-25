import { customIcon } from './glyph';

// A bare prompt `>_` and a square holding ±, drawn on Solar's 24px grid at its 1.5 stroke, for the Terminal and Changes panes.
export const TerminalIcon = customIcon(
  'TerminalIcon',
  `<path d="M5 7l5 5-5 5M12.5 17.25h6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
);

export const DiffIcon = customIcon(
  'DiffIcon',
  `<rect x="4" y="4" width="16" height="16" rx="4" stroke="currentColor" stroke-width="1.5"/><path d="M12 7.75v5M9.5 10.25h5M9.5 15.75h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
);
