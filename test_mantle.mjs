// Mantle reach check — run: node test_mantle.mjs
// Verifies the arithmetic that makes "jump then mantle onto a container" work.
// These constants MUST be kept in sync with PlayerController.ts
// (jumpForce, gravity, MANTLE_MAX_HEIGHT) and OutdoorRange.ts (ledge heights) -
// if a future tweak silently makes containers unreachable (or perimeter walls
// climbable), this should fail loudly.
import assert from 'node:assert/strict';

const JUMP_FORCE = 6.8;
const GRAVITY = 20.0; // magnitude; PlayerController stores it as -20.0
const MANTLE_MAX_HEIGHT = 1.5;

const CONTAINER_TOP = 2.6;
const SANDBAG_TOP = 1.0;
const PERIMETER_WALL_TOP = 4.0;

const jumpApex = (JUMP_FORCE * JUMP_FORCE) / (2 * GRAVITY);
assert.ok(Math.abs(jumpApex - 1.156) < 0.001, `jump apex should be ~1.156m, got ${jumpApex}`);

// Sandbags: reachable straight from standing (feet = 0).
assert.ok(SANDBAG_TOP <= MANTLE_MAX_HEIGHT,
  `sandbag top (${SANDBAG_TOP}) must be within standing mantle reach (${MANTLE_MAX_HEIGHT})`);

// Containers: NOT reachable from standing...
assert.ok(CONTAINER_TOP - 0 > MANTLE_MAX_HEIGHT,
  `container top (${CONTAINER_TOP}) should be out of reach when standing on the ground`);

// ...but reachable once airborne at jump apex (feet raised by jumpApex).
const containerReachAtApex = CONTAINER_TOP - jumpApex;
assert.ok(containerReachAtApex <= MANTLE_MAX_HEIGHT,
  `jump + mantle must reach containers: (${CONTAINER_TOP} - ${jumpApex.toFixed(3)}) ` +
  `= ${containerReachAtApex.toFixed(3)} must be <= ${MANTLE_MAX_HEIGHT}`);

// Perimeter walls must stay out of reach even at jump apex, so players can't escape the arena.
assert.ok(PERIMETER_WALL_TOP > jumpApex + MANTLE_MAX_HEIGHT,
  `perimeter wall (${PERIMETER_WALL_TOP}) must exceed jump apex + mantle reach ` +
  `(${(jumpApex + MANTLE_MAX_HEIGHT).toFixed(3)}) or players could climb out`);

console.log(`OK  jumpApex=${jumpApex.toFixed(3)}m  container reach at apex=${containerReachAtApex.toFixed(3)}m ` +
  `(<= ${MANTLE_MAX_HEIGHT})  perimeter wall margin=${(PERIMETER_WALL_TOP - jumpApex - MANTLE_MAX_HEIGHT).toFixed(3)}m`);
