import type { Action, State } from './types.ts';

export interface UiState {
  paused: boolean;
}

export type UiAction = { type: 'pause' };

export function initialUi(): UiState {
  return { paused: false };
}

export function uiReducer(state: State, action: Action): State {
  if (action.type === 'pause') return { ...state, paused: !state.paused };
  return state;
}
