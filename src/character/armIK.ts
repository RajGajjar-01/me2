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
const _h = new THREE.Vector3();
const _n = new THREE.Vector3();

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

/** Elbow bend axis in upper-arm space, read from a bent (animated) pose. */
export function elbowHinge(arm: Arm, minSin: number): THREE.Vector3 | null {
  arm.upper.getWorldPosition(_a);
  arm.lower.getWorldPosition(_b);
  arm.hand.getWorldPosition(_c);
  _c.sub(_b).normalize();
  _b.sub(_a).normalize();
  const h = new THREE.Vector3().crossVectors(_b, _c);
  if (h.length() < minSin) return null;
  return h
    .normalize()
    .applyQuaternion(arm.upper.getWorldQuaternion(_q).invert());
}

/**
 * Analytic two-bone IK (law of cosines), solved in world space so it doesn't
 * depend on each bone's local axes. The elbow bends toward `pole`. With a
 * `hinge` (elbowHinge), the upper arm rolls so the elbow bends about it
 * instead of twisting sideways.
 */
export function solveArm(
  arm: Arm,
  target: THREE.Vector3,
  pole: THREE.Vector3,
  hinge: THREE.Vector3 | null = null,
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

  if (hinge && sinA > 1e-3) {
    // _c = upper-arm axis; wanted bend normal = axis x (reach - elbow).
    _n.copy(_a).addScaledVector(_d, dist).sub(_e);
    _n.crossVectors(_c, _n).normalize();
    _h.copy(hinge).applyQuaternion(arm.upper.getWorldQuaternion(_q));
    _h.addScaledVector(_c, -_h.dot(_c));
    const roll = Math.atan2(_c.dot(_b.crossVectors(_h, _n)), _h.dot(_n));
    rotateWorld(arm.upper, _q.setFromAxisAngle(_c, roll));
  }

  // Forearm: current hand direction -> target (clamped to reach).
  arm.lower.getWorldPosition(_b);
  arm.hand.getWorldPosition(_c);
  _e.copy(_a).addScaledVector(_d, dist); // reachable target
  _q.setFromUnitVectors(_c.sub(_b).normalize(), _e.sub(_b).normalize());
  rotateWorld(arm.lower, _q);
}
