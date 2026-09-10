import assert from 'node:assert/strict';

const JUMP_FORCE = 6.8;
const GRAVITY = 20.0;
const MANTLE_MAX_HEIGHT = 1.5;

const CONTAINER_TOP = 2.6;
const SANDBAG_TOP = 1.0;
const PERIMETER_WALL_TOP = 4.0;

const jumpApex = (JUMP_FORCE * JUMP_FORCE) / (2 * GRAVITY);
assert.ok(
  Math.abs(jumpApex - 1.156) < 0.001,
  `jump apex should be ~1.156m, got ${jumpApex}`,
);

assert.ok(
  SANDBAG_TOP <= MANTLE_MAX_HEIGHT,
  `sandbag top (${SANDBAG_TOP}) must be within standing mantle reach (${MANTLE_MAX_HEIGHT})`,
);

assert.ok(
  CONTAINER_TOP - 0 > MANTLE_MAX_HEIGHT,
  `container top (${CONTAINER_TOP}) should be out of reach when standing on the ground`,
);

const containerReachAtApex = CONTAINER_TOP - jumpApex;
assert.ok(
  containerReachAtApex <= MANTLE_MAX_HEIGHT,
  `jump + mantle must reach containers: (${CONTAINER_TOP} - ${jumpApex.toFixed(3)}) ` +
    `= ${containerReachAtApex.toFixed(3)} must be <= ${MANTLE_MAX_HEIGHT}`,
);

assert.ok(
  PERIMETER_WALL_TOP > jumpApex + MANTLE_MAX_HEIGHT,
  `perimeter wall (${PERIMETER_WALL_TOP}) must exceed jump apex + mantle reach ` +
    `(${(jumpApex + MANTLE_MAX_HEIGHT).toFixed(3)}) or players could climb out`,
);

const MANTLE_MAX_WORLD_Y = 3.0;

const STACKED_CONTAINER_TOP = 5.2;
const TOWER_PLATFORM_TOP = 4.65;

assert.ok(
  CONTAINER_TOP <= MANTLE_MAX_WORLD_Y,
  `a single container (${CONTAINER_TOP}m) must stay climbable`,
);
assert.ok(
  STACKED_CONTAINER_TOP > MANTLE_MAX_WORLD_Y,
  `a stacked container (${STACKED_CONTAINER_TOP}m) must NOT be climbable`,
);
assert.ok(
  TOWER_PLATFORM_TOP > MANTLE_MAX_WORLD_Y,
  `the tower platform (${TOWER_PLATFORM_TOP}m) must be reached by its ramp, not mantled`,
);
assert.ok(
  PERIMETER_WALL_TOP > MANTLE_MAX_WORLD_Y,
  `the perimeter wall (${PERIMETER_WALL_TOP}m) must never be mantled`,
);

console.log(
  `OK  ceiling=${MANTLE_MAX_WORLD_Y}m  container ${CONTAINER_TOP}m climbable, ` +
    `stacked ${STACKED_CONTAINER_TOP}m / tower ${TOWER_PLATFORM_TOP}m / wall ${PERIMETER_WALL_TOP}m blocked`,
);
