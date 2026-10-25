import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
} from '@tanstack/react-router';

// Pages load lazily so importing the router (every `openSettings` caller does) doesn't pull the pages, which import it back.
const load = () => import('./pages');

const rootRoute = createRootRoute();
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(load, 'PinnedPager'),
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/$section',
  validateSearch: (
    search: Record<string, unknown>,
  ): { setting?: string; subpage?: string } => ({
    setting: search.setting == null ? undefined : String(search.setting),
    subpage: search.subpage == null ? undefined : String(search.subpage),
  }),
  component: lazyRouteComponent(load, 'SettingsPage'),
});
const replayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/replay/$threadId',
  component: lazyRouteComponent(load, 'ReplayView'),
});
const remoteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/remote/$machineId/$threadId',
  component: lazyRouteComponent(load, 'RemoteThreadView'),
});
const developerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/developer',
  component: lazyRouteComponent(load, 'DeveloperPage'),
});

const routeTree = rootRoute.addChildren([
  workspaceRoute,
  settingsRoute,
  replayRoute,
  remoteRoute,
  developerRoute,
]);

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}

function makeRouter() {
  return createRouter({ routeTree, history: createHashHistory() });
}

let router: ReturnType<typeof makeRouter> | undefined;

/** Created on first use: `createHashHistory` needs `window`, which the node tests that import the store don't have. */
export function getRouter() {
  return (router ??= makeRouter());
}
