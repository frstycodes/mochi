const MIN_GAP_S = 0.025;
const TAP_HZ = 1200;
const TAP_DECAY_S = 0.006;
const RING_HZ = 3200;
const VOLUME = 0.55;

let out: {
  ctx: AudioContext;
  master: AudioNode;
  noise: AudioBuffer;
  impulse: AudioBuffer;
} | null = null;
let lastAt = -Infinity;

// A soft plastic picker tick, picked by ear over five other variants: a dull band-passed noise tap with a one-sample impulse
// ringing a narrow band above it. No pitch sweep (reads as a laser). Both bands jitter ±1% so repeats don't grate.
export function tick() {
  out ??= createOutput();
  const { ctx, master, noise, impulse } = out;
  // A context made before any user activation starts suspended in Chrome, and a wheel isn't one; a later press unlocks it.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  const t = ctx.currentTime;
  if (t - lastAt < MIN_GAP_S) return;
  lastAt = t;

  const tap = new AudioBufferSourceNode(ctx, { buffer: noise });
  const tapGain = new GainNode(ctx, { gain: 0 });
  tapGain.gain.setValueAtTime(0.5, t);
  tapGain.gain.exponentialRampToValueAtTime(0.0001, t + TAP_DECAY_S);
  tap
    .connect(
      new BiquadFilterNode(ctx, {
        type: 'bandpass',
        frequency: jitter(TAP_HZ),
        Q: 2,
      }),
    )
    .connect(tapGain)
    .connect(master);
  tap.start(t);
  tap.stop(t + TAP_DECAY_S * 3);

  const ring = new AudioBufferSourceNode(ctx, { buffer: impulse });
  ring
    .connect(
      new BiquadFilterNode(ctx, {
        type: 'bandpass',
        frequency: jitter(RING_HZ),
        Q: 10,
      }),
    )
    .connect(new GainNode(ctx, { gain: 2 }))
    .connect(master);
  ring.start(t);
}

function createOutput() {
  const ctx = new AudioContext();
  const master = new GainNode(ctx, { gain: VOLUME });
  master
    .connect(
      new DynamicsCompressorNode(ctx, {
        threshold: -18,
        ratio: 4,
        attack: 0.001,
        release: 0.05,
      }),
    )
    .connect(ctx.destination);
  const noise = ctx.createBuffer(
    1,
    Math.ceil(ctx.sampleRate * 0.02),
    ctx.sampleRate,
  );
  const samples = noise.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  const impulse = ctx.createBuffer(1, 64, ctx.sampleRate);
  impulse.getChannelData(0)[0] = 1;
  return { ctx, master, noise, impulse };
}

function jitter(hz: number) {
  return hz * (0.99 + Math.random() * 0.02);
}
