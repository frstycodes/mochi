import { FileText, MessageText } from '@/icons';
import type { RewindMode } from './checkpoints.ts';

export const REWIND_MODES = {
  chat: {
    label: 'Rewind chat',
    hint: 'The conversation and the agent’s context go back. Files stay as they are.',
    icon: MessageText,
  },
  files: {
    label: 'Rewind chat and files',
    hint: 'Files in the worktree go back too. You see which ones before confirming.',
    icon: FileText,
  },
} satisfies Record<RewindMode, unknown>;

export const REWIND_MODE_ORDER: RewindMode[] = ['chat', 'files'];
