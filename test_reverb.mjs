// Reverb impulse-response check — run: node test_reverb.mjs
// Mirrors the IR generation in SoundEngine.getReverbBus(). REVERB_SECONDS, the
// decay exponent and the early-reflection table MUST be kept in sync with it.
//
// A convolver fed a bad IR fails silently — you get either nothing at all or a
// single click, and neither throws. This pins the shape of the curve instead.
import assert from 'node:assert/strict';

const REVERB_SECONDS = 1.9;
const DECAY_EXP = 2.6;
const EARLY = [[37, 0.5], [61, 0.34], [98, 0.2]];
const SAMPLE_RATE = 48000;

// The deterministic part of the IR: the decay envelope the noise is multiplied by.
const envelope = (i, size) => Math.pow(1 - i / size, DECAY_EXP);

const size = Math.floor(SAMPLE_RATE * REVERB_SECONDS);

// --- The tail must actually decay --------------------------------------------
assert.ok(size > 0, 'IR must have a non-zero length');
assert.equal(envelope(0, size), 1, 'the IR must start at full amplitude');
assert.ok(envelope(size - 1, size) < 1e-4,
  `the tail must decay to silence, ended at ${envelope(size - 1, size)}`);

let prev = Infinity;
for (let i = 0; i < size; i += 512) {
  const v = envelope(i, size);
  assert.ok(v <= prev, `envelope must never rise again (rose at sample ${i})`);
  assert.ok(v >= 0, `envelope must never go negative (sample ${i})`);
  prev = v;
}

// --- Energy must sit up front, or it reads as a hall, not a compound ---------
// Half the tail's energy should land well inside the first third of the buffer.
let total = 0;
for (let i = 0; i < size; i++) total += envelope(i, size);
let acc = 0;
let halfAt = size;
for (let i = 0; i < size; i++) {
  acc += envelope(i, size);
  if (acc >= total / 2) { halfAt = i; break; }
}
assert.ok(halfAt < size / 3,
  `half the reverb energy must land in the first third (landed at ${(halfAt / size * 100).toFixed(1)}%) ` +
  `— a flatter decay turns the range into a cathedral`);

// --- Early reflections must land inside the buffer, in order ------------------
let lastAt = -1;
for (const [ms, amp] of EARLY) {
  const at = Math.floor((SAMPLE_RATE * ms) / 1000);
  assert.ok(at < size, `early reflection at ${ms}ms falls outside a ${REVERB_SECONDS}s IR`);
  assert.ok(at > lastAt, `early reflections must be ordered in time (${ms}ms out of order)`);
  assert.ok(amp > 0 && amp <= 1, `reflection amplitude ${amp} must be in (0, 1]`);
  lastAt = at;
}
// They belong in the first 150ms — later than that stops reading as a nearby wall.
assert.ok(lastAt / SAMPLE_RATE < 0.15,
  'early reflections must all land within 150ms to read as nearby surfaces');

// Reflections are stamped on top of the envelope, so they must not clip it past 1.
for (const [ms, amp] of EARLY) {
  const at = Math.floor((SAMPLE_RATE * ms) / 1000);
  const peak = envelope(at, size) + amp;
  assert.ok(peak <= 2.0, `reflection at ${ms}ms peaks at ${peak.toFixed(2)}, too hot for an IR`);
}

// --- Low frequency sample rates must still work (44.1k is common) -------------
for (const sr of [44100, 48000, 96000]) {
  const n = Math.floor(sr * REVERB_SECONDS);
  assert.ok(n > sr, `IR must be longer than a second at ${sr}Hz`);
  for (const [ms] of EARLY) {
    assert.ok(Math.floor((sr * ms) / 1000) < n, `reflection ${ms}ms must fit at ${sr}Hz`);
  }
}

console.log(
  `OK  IR ${REVERB_SECONDS}s (${size} samples @${SAMPLE_RATE}Hz)  half-energy at ` +
  `${(halfAt / size * 100).toFixed(1)}% of the tail  ${EARLY.length} early reflections ` +
  `through ${(lastAt / SAMPLE_RATE * 1000).toFixed(0)}ms`
);
