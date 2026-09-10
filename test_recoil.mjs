import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const OUT = 'node_modules/.recoil-check';
execFileSync(
  'npx',
  [
    'tsc',
    'src/player/PlayerController.ts',
    '--ignoreConfig',
    '--outDir',
    OUT,
    '--module',
    'esnext',
    '--target',
    'es2022',
    '--moduleResolution',
    'bundler',
    '--skipLibCheck',
  ],
  { stdio: 'inherit' },
);
const { PlayerController } = await import(
  `./${OUT}/player/PlayerController.js`
);

const STEP = 1 / 60;
const mouse = { x: 0, y: 0 };
const input = {
  consumeMouseDelta: () => {
    const m = { ...mouse };
    mouse.x = mouse.y = 0;
    return m;
  },
  isKeyDown: () => false,
  isKeyPressed: () => false,
  isAnyKeyDown: () => false,
};
const bvh = { shapecast: () => {} };

const p = new PlayerController(75, 1.6, input, bvh);
p.update(STEP);
const start = p.camera.rotation.x;

const KICK = 0.03,
  SHOTS = 10;
for (let i = 0; i < SHOTS; i++) {
  p.applyRecoil(KICK, 0);
  for (let f = 0; f < 6; f++) p.update(STEP);
}
const peak = p.camera.rotation.x;
assert.ok(
  peak - start > 0.15,
  `aim must actually climb during a burst, got ${peak - start}`,
);

for (let f = 0; f < 60; f++) p.update(STEP);
const settled = p.camera.rotation.x;
assert.ok(
  settled < peak - 0.05,
  `aim must drift back after the burst (peak ${peak}, settled ${settled})`,
);
assert.ok(
  settled - start > 0.15 * (peak - start),
  `recovery must be partial, not a full snap-back (left ${settled - start})`,
);

const q = new PlayerController(75, 1.6, input, bvh);
q.update(STEP);
q.applyRecoil(0.05, 0);
mouse.y = 0.01;
q.update(STEP);
const afterPull = q.camera.rotation.x;
for (let f = 0; f < 60; f++) q.update(STEP);
assert.ok(
  Math.abs(q.camera.rotation.x - afterPull) < 1e-6,
  `recovery must not drag the aim after the player moves the mouse (${afterPull} -> ${q.camera.rotation.x})`,
);

console.log(
  `OK  climb=${(peak - start).toFixed(4)} rad  settled=${(settled - start).toFixed(4)} rad ` +
    `(${Math.round(((settled - start) / (peak - start)) * 100)}% of peak retained)`,
);
