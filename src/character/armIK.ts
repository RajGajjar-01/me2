import * as THREE from 'three';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e = new THREE.Vector3();
const _d = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qw = new THREE.Quaternion();

/** Apply a world-space rotation to a bone, keeping its hierarchy. */
export function rotateWorld(bone: THREE.Object3D, q: THREE.Quaternion): void {
  bone.getWorldQuaternion(_qw);
  bone.parent!.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_qr.copy(q).multiply(_qw)));
  bone.updateMatrixWorld(true);
}

export interface Arm {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  hand: THREE.Object3D;
}

/**
 * Analytic two-bone IK (law of cosines), solved in world space so it doesn't
 * depend on each bone's local axes. The elbow bends toward `pole`.
 */
export function solveArm(
  arm: Arm,
  target: THREE.Vector3,
  pole: THREE.Vector3,
): void {
  arm.upper.getWorldPosition(_a);
  arm.lower.getWorldPosition(_b);
  arm.hand.getWorldPosition(_c);
  const l1 = _a.distanceTo(_b);
  const l2 = _b.distanceTo(_c);
  _d.subVectors(target, _a);
  const dist = THREE.MathUtils.clamp(_d.length(), 1e-4, l1 + l2 - 1e-4);
  _d.normalize();

  const cosA = THREE.MathUtils.clamp(
    (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist),
    -1,
    1,
  );
  const sinA = Math.sqrt(1 - cosA * cosA);
  _pole.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  _e.copy(_a)
    .addScaledVector(_d, l1 * cosA)
    .addScaledVector(_pole, l1 * sinA);

  // Upper arm: current elbow direction -> solved elbow direction.
  _q.setFromUnitVectors(
    _b.sub(_a).normalize(),
    _c.copy(_e).sub(_a).normalize(),
  );
  rotateWorld(arm.upper, _q);

  // Forearm: current hand direction -> target (clamped to reach).
  arm.lower.getWorldPosition(_b);
  arm.hand.getWorldPosition(_c);
  _e.copy(_a).addScaledVector(_d, dist); // reachable target
  _q.setFromUnitVectors(_c.sub(_b).normalize(), _e.sub(_b).normalize());
  rotateWorld(arm.lower, _q);
}
