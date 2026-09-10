// Footstep stride accumulator check — run: node test_footsteps.mjs
// STRIDE and the stance speeds MUST be kept in sync with PlayerController.ts
// (PlayerController.STRIDE, PlayerController.STANCES).
//
// The point of driving steps off distance rather than a timer is that the cadence
// falls out of the speed for free. This pins that: a crawl must not tick at
// walking pace, and the step count over a fixed distance must not depend on the
// frame rate.
import assert from 'node:assert/strict';

const STRIDE = { stand: 1.6, crouch: 1.3, prone: 0.9 };
const SPRINT_STRIDE = 1.35;
const SPEEDS = { stand: 5.2, crouch: 3.7, prone: 1.3, sprint: 8.6 };

// Mirrors the block in update(): accumulate horizontal distance, fire once per
// stride, carry the remainder.
function steps(stance, speed, distance, delta) {
  const stride = STRIDE[stance];
  const perFrame = speed * delta;
  if (perFrame <= 0) return 0; // a stationary player never advances, so never steps
  let accum = 0;
  let fired = 0;
  for (let travelled = 0; travelled < distance - 1e-9; travelled += perFrame) {
    accum += perFrame;
    if (accum >= stride) {
      accum %= stride;
      fired++;
    }
  }
  return fired;
}

// --- One step per stride, whatever the speed ---------------------------------
for (const [stance, stride] of Object.entries(STRIDE)) {
  const n = steps(stance, SPEEDS[stance], 100, 1 / 60);
  assert.ok(Math.abs(n - 100 / stride) <= 1,
    `${stance}: 100m should give ~${(100 / stride).toFixed(1)} steps, got ${n}`);
}

// --- Frame rate must not change the count ------------------------------------
const at60 = steps('stand', SPEEDS.stand, 100, 1 / 60);
for (const fps of [15, 30, 144, 240]) {
  assert.equal(steps('stand', SPEEDS.stand, 100, 1 / fps), at60,
    `step count must be frame-rate independent, ${fps}fps disagreed with 60fps`);
}

// --- Cadence tracks stance, which is the whole reason for the accumulator -----
// Steps per second = speed / stride. This is the constraint that bit the first
// pass: crouch stride 1.1m made a crouch-walk (3.7 / 1.1 = 3.36/s) step FASTER
// than a walk (5.2 / 1.6 = 3.25/s). Stride is not free to pick per stance —
// it has to stay above speed / walkCadence.
const cadence = (stance, speed = SPEEDS[stance], sprinting = false) =>
  speed / (STRIDE[stance] * (sprinting ? SPRINT_STRIDE : 1));
assert.ok(cadence('prone') < cadence('crouch') && cadence('crouch') < cadence('stand'),
  `cadence must descend stand > crouch > prone, got ` +
  `${cadence('stand').toFixed(2)} / ${cadence('crouch').toFixed(2)} / ${cadence('prone').toFixed(2)}`);

const sprintCadence = cadence('stand', SPEEDS.sprint, true);
assert.ok(sprintCadence > cadence('stand'), 'sprinting must step faster than walking');
// ...but a sprint lengthens the stride too. Without that the cadence hits 5.4/s,
// which reads as a machine gun rather than a run.
assert.ok(sprintCadence < 4.5,
  `sprint cadence ${sprintCadence.toFixed(2)}/s is implausibly frantic — lengthen SPRINT_STRIDE`);

// Stride must shorten as the stance lowers, independently of cadence.
assert.ok(STRIDE.prone < STRIDE.crouch && STRIDE.crouch < STRIDE.stand,
  'stride must shorten as the stance lowers');

// A crawl is the case a fixed timer got wrong: it must be dramatically slower than
// a walk, not merely a little.
assert.ok(cadence('prone') < cadence('stand') * 0.65,
  `prone cadence ${cadence('prone').toFixed(2)}/s is too close to walking ` +
  `${cadence('stand').toFixed(2)}/s — a crawl should not sound like a march`);

// --- Standing still makes no noise -------------------------------------------
assert.equal(steps('stand', 0, 100, 1 / 60), 0, 'a stationary player must never step');

console.log(
  `OK  cadence stand=${cadence('stand').toFixed(2)}/s sprint=${sprintCadence.toFixed(2)}/s ` +
  `crouch=${cadence('crouch').toFixed(2)}/s prone=${cadence('prone').toFixed(2)}/s  ` +
  `strides ${STRIDE.stand}/${STRIDE.crouch}/${STRIDE.prone}m`
);
