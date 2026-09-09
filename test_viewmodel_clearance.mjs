// Nothing in a weapon viewmodel may reach the camera's near plane, in ANY state.
// The AK's stock butt used to land 0.32m BEHIND the eye at ADS, which sliced the
// mesh open. Bounds below are the GLB extents measured from their accessor min/max.
import assert from 'node:assert';

const NEAR = 0.05;

// [modelScale, modelOffsetZ, rawMaxZ] -> rearmost point in rig space
const rigRearZ = (scale, offsetZ, rawMaxZ) => rawMaxZ * scale + offsetZ;

const weapons = [
  { name: 'AK-47',        scale: 1.0,  offsetZ: -0.48, rawMaxZ: 0.5,   ads: -0.18, idle: -0.26 },
  { name: 'BREACHER 12G', scale: 0.38, offsetZ: -0.36, rawMaxZ: 0.89,  ads: -0.16, idle: -0.24 }
];

// Worst case: ADS pull + the reload animation's forward dip (+0.06 on Z).
const RELOAD_DIP_Z = 0.06;

for (const w of weapons) {
  const rear = rigRearZ(w.scale, w.offsetZ, w.rawMaxZ);
  for (const [state, containerZ] of [['idle', w.idle], ['ads', w.ads]]) {
    for (const [anim, dip] of [['still', 0], ['reloading', RELOAD_DIP_Z]]) {
      const camZ = rear + containerZ + dip;      // camera sits at origin looking down -Z
      const dist = -camZ;                         // distance in front of the eye
      assert.ok(
        dist > NEAR,
        `${w.name} ${state}/${anim}: rearmost point is ${dist.toFixed(3)}m from the eye, ` +
        `inside the ${NEAR}m near plane (negative = behind the camera)`
      );
      console.log(`  ok  ${w.name.padEnd(14)} ${state}/${anim.padEnd(9)} clearance ${dist.toFixed(3)}m`);
    }
  }
}
console.log('OK  all viewmodel geometry stays in front of the near plane');
