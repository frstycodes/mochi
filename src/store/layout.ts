import type { Action, State } from './index.tsx';

export type View = { kind: 'queue' } | { kind: 'board' } | { kind: 'new' } | { kind: 'thread'; id: string };

export interface LayoutState {
  spaceId: string;
  views: Record<string, View>;
}

export type LayoutAction = { type: 'go'; view: View } | { type: 'space'; id: string };

export function initialLayout(): LayoutState {
  return { spaceId: 'latitude', views: { latitude: { kind: 'thread', id: 'adm' }, personal: { kind: 'thread', id: 'lobby' }, liane: { kind: 'board' } } };
}

export function layoutReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'go': {
      const view = action.view;
      const spaceId = view.kind === 'thread' ? (state.threads.find((t) => t.id === view.id)?.spaceId ?? state.spaceId) : state.spaceId;
      return { ...state, spaceId, views: { ...state.views, [spaceId]: view } };
    }
    case 'space':
      return { ...state, spaceId: action.id };
    default:
      return state;
  }
}
