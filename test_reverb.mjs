// Mirrors SoundEngine.getReverbBus(); keep constants in sync with the REVERB_* statics.
import assert from 'node:assert/strict';

const REVERB_SECONDS = 2.2;
const REVERB_PREDELAY = 0.016;
const DECAY_EXP = 2.3;
const DAMP_START = 0.72;
const DAMP_FALL = 0.67;
const REFLECTIONS = [
  [19, 0.62],
  [37, 0.45],
  [58, 0.3],
  [97, 0.2],
  [168, 0.15],
  [247, 0.1],
  [352, 0.062],
];
const SAMPLE_RATE = 48000;

const size = Math.floor(SAMPLE_RATE * REVERB_SECONDS);
const preDelay = Math.floor(SAMPLE_RATE * REVERB_PREDELAY);
const tailLen = size - preDelay;

const envelope = (t) => (1 - t) ** DECAY_EXP;
const damping = (t) => DAMP_START - DAMP_FALL * t;

for (let i = 0; i <= 1000; i++) {
  const a = damping(i / 1000);
  assert.ok(
    a > 0,
    `damping coefficient hit ${a} at t=${i / 1000} — sqrt(a) division would produce NaN`,
  );
  assert.ok(
    a <= 1,
    `damping coefficient ${a} above 1 at t=${i / 1000} makes the one-pole unstable`,
  );
}
assert.ok(
  damping(1) < damping(0),
  'the tail must get darker as it decays, not brighter',
);

assert.ok(preDelay > 0, 'pre-delay must be a whole number of samples, got 0');
assert.ok(
  REVERB_PREDELAY < 0.05,
  'pre-delay beyond ~50ms stops reading as a room and becomes an audible slap',
);
assert.ok(tailLen > 0, 'pre-delay must not consume the whole buffer');

assert.equal(envelope(0), 1, 'the tail must start at full amplitude');
assert.ok(
  envelope(1) < 1e-6,
  `the tail must decay to silence, ended at ${envelope(1)}`,
);

let prev = Infinity;
for (let i = 0; i <= 1000; i++) {
  const v = envelope(i / 1000);
  assert.ok(
    v <= prev,
    `envelope must never rise again (rose at t=${i / 1000})`,
  );
  assert.ok(v >= 0, `envelope must never go negative (t=${i / 1000})`);
  prev = v;
}

let total = 0;
for (let i = 0; i < tailLen; i += 16) total += envelope(i / tailLen);
let acc = 0;
let halfAt = tailLen;
for (let i = 0; i < tailLen; i += 16) {
  acc += envelope(i / tailLen);
  if (acc >= total / 2) {
    halfAt = i;
    break;
  }
}
assert.ok(
  halfAt < tailLen / 3,
  `half the reverb energy must land in the first third (landed at ${((halfAt / tailLen) * 100).toFixed(1)}%) ` +
    `— a flatter decay turns the range into a cathedral`,
);

let lastAt = -1;
for (const [ms, amp] of REFLECTIONS) {
  const at = Math.floor((SAMPLE_RATE * ms) / 1000);
  assert.ok(
    at < size,
    `reflection at ${ms}ms falls outside a ${REVERB_SECONDS}s IR`,
  );
  assert.ok(
    at > lastAt,
    `reflections must be ordered in time (${ms}ms out of order)`,
  );
  assert.ok(
    amp > 0 && amp <= 1,
    `reflection amplitude ${amp} must be in (0, 1]`,
  );
  lastAt = at;
}

for (let i = 1; i < REFLECTIONS.length; i++) {
  assert.ok(
    REFLECTIONS[i][1] < REFLECTIONS[i - 1][1],
    `reflection ${i} (${REFLECTIONS[i][0]}ms) is louder than the one before it`,
  );
}

const near = REFLECTIONS.filter(([ms]) => ms <= 150);
const far = REFLECTIONS.filter(([ms]) => ms > 150);
assert.ok(near.length >= 3, 'need enough near reflections to build a room');
assert.ok(far.length >= 2, 'need late slapback, or the shot sounds indoors');
assert.ok(
  far[far.length - 1][0] < 500,
  'slapback beyond 500ms stops sounding like terrain and starts sounding like a delay pedal',
);
assert.ok(
  far[0][1] < near[near.length - 1][1],
  'distant returns must be quieter than the near ones',
);

assert.ok(
  REFLECTIONS[0][1] < 1.0,
  'the first reflection must stay below unity or normalisation will bury the tail',
);

for (const sr of [44100, 48000, 96000]) {
  const n = Math.floor(sr * REVERB_SECONDS);
  const pd = Math.floor(sr * REVERB_PREDELAY);
  assert.ok(pd > 0, `pre-delay must round to at least one sample at ${sr}Hz`);
  assert.ok(n - pd > sr, `usable tail must exceed a second at ${sr}Hz`);
  for (const [ms] of REFLECTIONS) {
    assert.ok(
      Math.floor((sr * ms) / 1000) < n,
      `reflection ${ms}ms must fit at ${sr}Hz`,
    );
  }
}

console.log(
  `OK  IR ${REVERB_SECONDS}s @${SAMPLE_RATE}Hz  pre-delay ${(REVERB_PREDELAY * 1000).toFixed(0)}ms  ` +
    `damping ${damping(0).toFixed(2)}->${damping(1).toFixed(2)}  ` +
    `half-energy at ${((halfAt / tailLen) * 100).toFixed(1)}% of tail  ` +
    `${near.length} near + ${far.length} distant reflections through ${far[far.length - 1][0]}ms`,
);
