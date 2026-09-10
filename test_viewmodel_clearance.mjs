import assert from 'node:assert';

const NEAR = 0.05;

const rigRearZ = (scale, offsetZ, rawMaxZ) => rawMaxZ * scale + offsetZ;

const weapons = [
  {
    name: 'AK-47',
    scale: 0.88,
    offsetZ: -0.53,
    rawMaxZ: 0.5,
    ads: -0.03,
    idle: -0.19,
  },
  {
    name: 'BREACHER 12G',
    scale: 0.38,
    offsetZ: -0.36,
    rawMaxZ: 0.89,
    ads: -0.1,
    idle: -0.24,
  },
];

const RELOAD_DIP_Z = 0.06;

for (const w of weapons) {
  const rear = rigRearZ(w.scale, w.offsetZ, w.rawMaxZ);
  for (const [state, containerZ] of [
    ['idle', w.idle],
    ['ads', w.ads],
  ]) {
    for (const [anim, dip] of [
      ['still', 0],
      ['reloading', RELOAD_DIP_Z],
    ]) {
      const camZ = rear + containerZ + dip;
      const dist = -camZ;
      assert.ok(
        dist > NEAR,
        `${w.name} ${state}/${anim}: rearmost point is ${dist.toFixed(3)}m from the eye, ` +
          `inside the ${NEAR}m near plane (negative = behind the camera)`,
      );
      console.log(
        `  ok  ${w.name.padEnd(14)} ${state}/${anim.padEnd(9)} clearance ${dist.toFixed(3)}m`,
      );
    }
  }
}
console.log('OK  all viewmodel geometry stays in front of the near plane');
