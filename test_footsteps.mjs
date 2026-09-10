import assert from 'node:assert/strict';

const STRIDE = { stand: 1.6, crouch: 1.3, prone: 0.9 };
const SPRINT_STRIDE = 1.35;
const SPEEDS = { stand: 5.2, crouch: 3.7, prone: 1.3, sprint: 8.6 };

function steps(stance, speed, distance, delta) {
  const stride = STRIDE[stance];
  const perFrame = speed * delta;
  if (perFrame <= 0) return 0;
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

for (const [stance, stride] of Object.entries(STRIDE)) {
  const n = steps(stance, SPEEDS[stance], 100, 1 / 60);
  assert.ok(
    Math.abs(n - 100 / stride) <= 1,
    `${stance}: 100m should give ~${(100 / stride).toFixed(1)} steps, got ${n}`,
  );
}

const at60 = steps('stand', SPEEDS.stand, 100, 1 / 60);
for (const fps of [15, 30, 144, 240]) {
  assert.equal(
    steps('stand', SPEEDS.stand, 100, 1 / fps),
    at60,
    `step count must be frame-rate independent, ${fps}fps disagreed with 60fps`,
  );
}

const cadence = (stance, speed = SPEEDS[stance], sprinting = false) =>
  speed / (STRIDE[stance] * (sprinting ? SPRINT_STRIDE : 1));
assert.ok(
  cadence('prone') < cadence('crouch') && cadence('crouch') < cadence('stand'),
  `cadence must descend stand > crouch > prone, got ` +
    `${cadence('stand').toFixed(2)} / ${cadence('crouch').toFixed(2)} / ${cadence('prone').toFixed(2)}`,
);

const sprintCadence = cadence('stand', SPEEDS.sprint, true);
assert.ok(
  sprintCadence > cadence('stand'),
  'sprinting must step faster than walking',
);

assert.ok(
  sprintCadence < 4.5,
  `sprint cadence ${sprintCadence.toFixed(2)}/s is implausibly frantic — lengthen SPRINT_STRIDE`,
);

assert.ok(
  STRIDE.prone < STRIDE.crouch && STRIDE.crouch < STRIDE.stand,
  'stride must shorten as the stance lowers',
);

assert.ok(
  cadence('prone') < cadence('stand') * 0.65,
  `prone cadence ${cadence('prone').toFixed(2)}/s is too close to walking ` +
    `${cadence('stand').toFixed(2)}/s — a crawl should not sound like a march`,
);

assert.equal(
  steps('stand', 0, 100, 1 / 60),
  0,
  'a stationary player must never step',
);

console.log(
  `OK  cadence stand=${cadence('stand').toFixed(2)}/s sprint=${sprintCadence.toFixed(2)}/s ` +
    `crouch=${cadence('crouch').toFixed(2)}/s prone=${cadence('prone').toFixed(2)}/s  ` +
    `strides ${STRIDE.stand}/${STRIDE.crouch}/${STRIDE.prone}m`,
);
