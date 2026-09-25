import assert from 'node:assert/strict';
import { register } from 'node:module';

// Resolve extensionless TS imports (Vite style) under Node's type stripping.
register(
  `data:text/javascript,export async function resolve(s, c, next) {
    try { return await next(s, c); }
    catch (e) { if (s.startsWith('.')) return next(s + '.ts', c); throw e; }
  }`,
);

const THREE = await import('three');
const { solveArm } = await import('./src/character/armIK.ts');

// Shoulder at origin, 0.3 m upper arm and 0.28 m forearm hanging straight down.
function makeArm() {
  const root = new THREE.Object3D();
  const upper = new THREE.Object3D();
  const lower = new THREE.Object3D();
  const hand = new THREE.Object3D();
  root.add(upper);
  upper.add(lower);
  lower.add(hand);
  lower.position.set(0, -0.3, 0);
  hand.position.set(0, -0.28, 0);
  root.updateMatrixWorld(true);
  return { upper, lower, hand };
}

const pole = new THREE.Vector3(0, -1, 0);
const handAt = (arm) => arm.hand.getWorldPosition(new THREE.Vector3());

// Reachable target: hand lands on it, bones keep their lengths.
let arm = makeArm();
const target = new THREE.Vector3(0.1, -0.15, -0.35);
solveArm(arm, target, pole);
assert.ok(
  handAt(arm).distanceTo(target) < 1e-3,
  `hand missed target by ${handAt(arm).distanceTo(target)}`,
);
const elbow = arm.lower.getWorldPosition(new THREE.Vector3());
assert.ok(
  Math.abs(elbow.length() - 0.3) < 1e-4,
  'upper arm length must be preserved',
);
assert.ok(elbow.y < target.y, 'elbow must bend toward the (down) pole');

// Out of reach: arm straightens toward the target instead of breaking.
arm = makeArm();
const far = new THREE.Vector3(0, 0, -2);
solveArm(arm, far, pole);
const h = handAt(arm);
assert.ok(
  Math.abs(h.length() - 0.58) < 1e-3,
  `straight arm length ${h.length()}`,
);
assert.ok(
  h.clone().normalize().dot(far.clone().normalize()) > 0.999,
  'arm must point at the target',
);

console.log('arm IK: ok');
