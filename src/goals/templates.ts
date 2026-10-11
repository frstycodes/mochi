import type { DraftStep } from './edit.ts';

export interface GoalTemplate {
  id: string;
  name: string;
  steps: Omit<DraftStep, 'id' | 'isRemoved' | 'isLocked'>[];
}

const API_ENDPOINT: GoalTemplate = {
  id: 'api-endpoint',
  name: 'API endpoint',
  steps: [
    { title: 'Route and request validation', size: 1, gate: false, acceptance: { text: 'Bad input returns 400 with field errors' } },
    { title: 'Handler and data access', size: 2, gate: false },
    { title: 'Endpoint tests', size: 1, gate: false, acceptance: { text: 'Happy path and auth failure covered', command: 'pnpm --filter api test' } },
    { title: 'Document the endpoint', size: 1, gate: false },
  ],
};

const MIGRATION: GoalTemplate = {
  id: 'migration',
  name: 'Migration',
  steps: [
    { title: 'Write the migration', size: 2, gate: false, acceptance: { text: 'Up and down both run', command: 'pnpm db:migrate && pnpm db:rollback' } },
    { title: 'Backfill existing rows', size: 2, gate: true },
    { title: 'Switch reads to the new column', size: 1, gate: false },
    { title: 'Drop the old column', size: 1, gate: true },
  ],
};

const PROTOTYPE: GoalTemplate = {
  id: 'prototype',
  name: 'Prototype',
  steps: [
    { title: 'Spike the core loop', size: 2, gate: false },
    { title: 'Make it look right', size: 2, gate: false },
    { title: 'Deploy a preview', size: 1, gate: true, acceptance: { text: 'Preview URL loads on a phone' } },
  ],
};

const CLI_FLAG: GoalTemplate = {
  id: 'cli-flag',
  name: 'CLI flag',
  steps: [
    { title: 'Parse and validate the flag', size: 1, gate: false },
    { title: 'Wire it through the config', size: 2, gate: false },
    { title: 'Flag tests', size: 1, gate: false, acceptance: { text: 'Default and override covered', command: 'pnpm test' } },
  ],
};

export const GOAL_TEMPLATES = {
  latitude: [API_ENDPOINT, MIGRATION],
  personal: [PROTOTYPE, API_ENDPOINT],
  liane: [CLI_FLAG, MIGRATION],
} satisfies Record<string, GoalTemplate[]>;

export function templatesFor(spaceId: string): GoalTemplate[] {
  return GOAL_TEMPLATES[spaceId as keyof typeof GOAL_TEMPLATES] ?? [];
}
