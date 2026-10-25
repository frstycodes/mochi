import { Schema } from 'effect';
import { event, Int, invoke, Str } from '../checks.ts';

const S = Schema.String;
const T = Schema.Tuple;
const Void = Schema.Void;

export const Simulator = Schema.Struct({
  udid: S,
  name: S,
  runtime: S,
  state: Schema.Literals(['Booted', 'Booting', 'Shutdown', 'Shutting Down']),
  family: Schema.Literals(['iphone', 'ipad']),
});
export type Simulator = typeof Simulator.Type;

export const SimButton = Schema.Literals(['home', 'lock', 'side', 'siri']);
export const SimTouchPhase = Schema.Literals(['down', 'move', 'up']);
export const SimAppearance = Schema.Literals(['light', 'dark']);
export const SimContentSize = Schema.Literals([
  'extra-small',
  'small',
  'medium',
  'large',
  'extra-large',
  'extra-extra-large',
  'extra-extra-extra-large',
  'accessibility-medium',
  'accessibility-large',
  'accessibility-extra-large',
  'accessibility-extra-extra-large',
  'accessibility-extra-extra-extra-large',
]);

export const SimFrame = Schema.Struct({
  udid: S,
  data: Schema.Uint8Array,
  mime: Schema.Literals(['image/jpeg', 'image/svg+xml']),
});
export type SimFrame = typeof SimFrame.Type;

export const SimLogLine = Schema.Struct({ udid: S, text: S });
export type SimLogLine = typeof SimLogLine.Type;

// Args reach execFile (`electron/sim/parse.ts`): each is checked against a closed shape.
const Udid = S.check(
  Schema.isPattern(/^[0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}$/i),
);
const Unit = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }));
const HidUsage = Int.check(Schema.isBetween({ minimum: 4, maximum: 231 }));
/** Any scheme (deep links), but parsed and never option-like. */
const Url = Str(2048).check(
  Schema.makeFilter(
    (url) => (!url.startsWith('-') && URL.canParse(url)) || `not a URL: ${url}`,
  ),
);

export const simRpc = {
  list: invoke(T([]), Schema.Array(Simulator)),
  boot: invoke(T([Udid]), Void),
  shutdown: invoke(T([Udid]), Void),
  stream: invoke(
    T([Udid]),
    Schema.Struct({ width: Schema.Number, height: Schema.Number }),
  ),
  stopStream: invoke(T([Udid]), Void),
  onFrame: event(SimFrame),
  touch: invoke(T([Udid, SimTouchPhase, Unit, Unit]), Void),
  button: invoke(T([Udid, SimButton]), Void),
  type: invoke(T([Udid, Str(10_000)]), Void),
  key: invoke(T([Udid, HidUsage]), Void),
  openUrl: invoke(T([Udid, Url]), Void),
  appearance: invoke(T([Udid]), Schema.NullOr(SimAppearance)),
  setAppearance: invoke(T([Udid, SimAppearance]), Void),
  contentSize: invoke(T([Udid]), Schema.NullOr(SimContentSize)),
  setContentSize: invoke(T([Udid, SimContentSize]), Void),
  screenshot: invoke(T([Udid]), S),
  startRecording: invoke(T([Udid]), Void),
  stopRecording: invoke(T([Udid]), S),
  buildAndRun: invoke(T([Udid, Str()]), Schema.Struct({ bundleId: S })),
  onBuildLog: event(SimLogLine),
};
