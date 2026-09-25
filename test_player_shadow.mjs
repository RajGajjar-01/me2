import assert from 'node:assert/strict';

const STANCES = {
  stand: { height: 1.35 },
  crouch: { height: 0.35 },
  prone: { height: 0.1 },
};

const scaleY = (h) => Math.max(0.25, Math.min(1, h / 1.35));

const standScale = scaleY(STANCES.stand.height);
const crouchScale = scaleY(STANCES.crouch.height);
const proneScale = scaleY(STANCES.prone.height);

assert.ok(
  proneScale < crouchScale && crouchScale < standScale,
  `body scale must descend stand > crouch > prone, got ${standScale} / ${crouchScale} / ${proneScale}`,
);
assert.equal(standScale, 1, 'standing scale must be full height');

const lean = 0.8;
const leanLateral = lean * 0.38;
assert.ok(
  Math.sign(leanLateral) === Math.sign(lean),
  'lean lateral offset must match lean sign, same as camera',
);

const swing = (speed, bobTimer) => (speed > 0.1 ? Math.sin(bobTimer) * 0.5 : 0);
assert.equal(swing(0, 1.2), 0, 'leg swing must be zero when standing still');
assert.notEqual(swing(3, 1.2), 0, 'leg swing must be nonzero while moving');

console.log('player shadow pose math OK');
