// Stance + lean geometry check — run: node test_stance.mjs
// These constants MUST be kept in sync with PlayerController.ts (STANCES, radius,
// LEAN_OFFSET, LEAN_MARGIN) and OutdoorRange.ts (sandbag bunker height).
//
// The crouch numbers are load-bearing: the whole point of a crouch in this level is
// that it drops your eye below the 1.0m sandbag bunkers. If someone retunes the
// crouch height and silently re-exposes the head, this fails instead of shipping.
import assert from 'node:assert/strict';

const RADIUS = 0.38;
const STANCES = {
  stand: { height: 1.35, eyeOffset: 0.28, speed: 5.2 },
  crouch: { height: 0.35, eyeOffset: 0.22, speed: 3.7 },
  prone: { height: 0.10, eyeOffset: -0.03, speed: 1.3 }
};

const SANDBAG_TOP = 1.0; // OutdoorRange "Sandbag Bunkers (Low crouch cover)"

// Matches syncCamera(): eye = capsulePosition.y + height + eyeOffset, and the capsule
// rests with its bottom sphere centre one radius above the feet.
const eyeHeight = (s) => RADIUS + s.height + s.eyeOffset;

const standEye = eyeHeight(STANCES.stand);
const crouchEye = eyeHeight(STANCES.crouch);
const proneEye = eyeHeight(STANCES.prone);

// --- Stance ladder is strictly ordered -------------------------------------
assert.ok(proneEye < crouchEye && crouchEye < standEye,
  `eye heights must descend stand > crouch > prone, got ` +
  `${standEye.toFixed(2)} / ${crouchEye.toFixed(2)} / ${proneEye.toFixed(2)}`);

assert.ok(STANCES.prone.speed < STANCES.crouch.speed && STANCES.crouch.speed < STANCES.stand.speed,
  'stance speeds must descend stand > crouch > prone');

// The eye must never sink to or below the ground plane.
assert.ok(proneEye > 0.1, `prone eye (${proneEye.toFixed(2)}m) must stay above the ground`);

// --- Cover actually works ---------------------------------------------------
assert.ok(crouchEye < SANDBAG_TOP,
  `crouched eye (${crouchEye.toFixed(2)}m) must sit below the sandbag top (${SANDBAG_TOP}m) ` +
  `or crouching behind the bunkers leaves your head exposed`);
assert.ok(standEye > SANDBAG_TOP,
  `standing eye (${standEye.toFixed(2)}m) must clear the sandbags, or crouch is pointless`);

// --- Speeds track PUBG's measured stance ratios ------------------------------
// PUBG: standing run 4.7, crouch run 3.4, crawl 1.2 m/s.
const ratio = (s) => s.speed / STANCES.stand.speed;
assert.ok(Math.abs(ratio(STANCES.crouch) - 3.4 / 4.7) < 0.03,
  `crouch speed ratio ${ratio(STANCES.crouch).toFixed(3)} should track PUBG's ${(3.4 / 4.7).toFixed(3)}`);
assert.ok(Math.abs(ratio(STANCES.prone) - 1.2 / 4.7) < 0.03,
  `prone speed ratio ${ratio(STANCES.prone).toFixed(3)} should track PUBG's ${(1.2 / 4.7).toFixed(3)}`);

// --- Prone capsule floor ------------------------------------------------------
// ponytail: prone is a short vertical capsule, so it can never be flatter than the
// two end spheres. Asserted so nobody "fixes" prone by driving height negative.
assert.ok(STANCES.prone.height >= 0,
  'prone height cannot go negative — the capsule would invert');

// --- Lean wall clamp ----------------------------------------------------------
const LEAN_OFFSET = 0.38;
const LEAN_MARGIN = 0.15;

// Mirrors the clamp in syncCamera(): lean sideways, but never closer than
// LEAN_MARGIN to whatever the ray hit.
const clampLean = (lean, wallDist) => {
  let lateral = lean * LEAN_OFFSET;
  const dir = Math.sign(lateral);
  const reach = Math.abs(lateral) + LEAN_MARGIN;
  if (wallDist !== null && wallDist <= reach) {
    const allowed = Math.max(0, wallDist - LEAN_MARGIN);
    lateral = dir * Math.min(Math.abs(lateral), allowed);
  }
  return lateral;
};

// Open air: full travel, both directions.
assert.equal(clampLean(1, null), LEAN_OFFSET, 'unobstructed right lean must reach full offset');
assert.equal(clampLean(-1, null), -LEAN_OFFSET, 'unobstructed left lean must reach full offset');

// A distant wall does not restrict anything.
assert.equal(clampLean(1, 2.0), LEAN_OFFSET, 'a wall beyond reach must not clamp the lean');

// A near wall clamps to the margin, and the eye never crosses it.
const clamped = clampLean(1, 0.30);
assert.ok(Math.abs(clamped - 0.15) < 1e-9, `wall at 0.30m should clamp to 0.15m, got ${clamped}`);

// Flush against a wall: no lateral movement at all, and never backwards.
assert.equal(clampLean(1, 0.10), 0, 'a wall inside the margin must block the lean entirely');
assert.equal(clampLean(-1, 0.0), -0, 'a wall at zero distance must never push the eye backwards');

// Monotonic: leaning harder never moves you less, and never past the cap.
let prev = -Infinity;
for (let l = 0; l <= 1.0001; l += 0.05) {
  const v = clampLean(l, 1.0);
  assert.ok(v >= prev, `lean must be monotonic in input, ${l.toFixed(2)} regressed`);
  assert.ok(v <= LEAN_OFFSET + 1e-9, `lean must never exceed LEAN_OFFSET, got ${v}`);
  prev = v;
}

console.log(
  `OK  eye stand=${standEye.toFixed(2)}m crouch=${crouchEye.toFixed(2)}m prone=${proneEye.toFixed(2)}m ` +
  `(sandbag ${SANDBAG_TOP}m)  speeds ${STANCES.stand.speed}/${STANCES.crouch.speed}/${STANCES.prone.speed} m/s  ` +
  `lean ±${LEAN_OFFSET}m clamped at ${LEAN_MARGIN}m`
);
