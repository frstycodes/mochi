import { Schema } from 'effect';
import { event, Id, Int, invoke, Str } from '../checks.ts';
import { AgentImage } from '../model.ts';

const opt = Schema.optional;
const S = Schema.String;
const T = Schema.Tuple;
const Void = Schema.Void;

export const ScreenAccess = Schema.Literals([
  'granted',
  'denied',
  'restricted',
  'not-determined',
  'unknown',
  'unsupported',
]);
export type ScreenAccess = typeof ScreenAccess.Type;

export const AppWindow = Schema.Struct({
  id: S,
  title: S,
  app: opt(S),
  icon: opt(S),
});
export type AppWindow = typeof AppWindow.Type;

export const Appearance = Schema.Literals(['system', 'light', 'dark']);
export type Appearance = typeof Appearance.Type;

/** Leading slashes are dropped before the check (`electron/ipc/windows.ts`), so they pass here. */
const Route = Str(200).check(Schema.isPattern(/^\/*[\w\-/.]*$/));
const Coordinate = Int.check(
  Schema.isBetween({ minimum: 0, maximum: 100_000 }),
);

export const windowsRpc = {
  open: invoke(T([Route]), Void),
  // Main refuses anything but a plain object; the type stays `unknown` as the renderer's message bus has it.
  broadcast: invoke(
    T([
      Schema.Unknown.check(
        Schema.makeFilter(
          (m) =>
            (typeof m === 'object' && m !== null && !Array.isArray(m)) ||
            'message must be an object',
        ),
      ),
    ]),
    Void,
  ),
  onMessage: event(Schema.Unknown),
  isFullScreen: invoke(T([]), Schema.Boolean),
  onFullScreenChange: event(Schema.Boolean),
  zoomFactor: invoke(T([]), Schema.Number),
  showAppMenu: invoke(T([Coordinate, Coordinate]), Void),
  resetZoom: invoke(T([]), Void),
  setAppearance: invoke(T([Appearance]), Void),
  listApps: invoke(
    T([]),
    Schema.Struct({ access: ScreenAccess, windows: Schema.Array(AppWindow) }),
  ),
  captureApp: invoke(T([Id]), Schema.NullOr(AgentImage)),
  openScreenRecordingSettings: invoke(T([]), Void),
};
