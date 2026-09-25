// Headless check that the player's hero actually holds the gun: runs the real
// PlayerCharacter + WeaponModels code (no browser) and measures how far each
// hand ends up from its grip, in first- and third-person.
// Run: node --experimental-transform-types test_player_hold.mjs
// Needs the synced assets (python3 scripts/sync-quaternius.py).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import path from 'node:path';

const ROOT = path.dirname(new URL(import.meta.url).pathname);

// Vite shims: asset URL imports -> file paths, import.meta.glob -> fs reads,
// extensionless TS imports -> .ts.
register(
  `data:text/javascript,
  export async function resolve(s, c, next) {
    if (s.includes('?url') || /\\.(jpg|png)$/.test(s)) {
      const file = new URL(s.split('?')[0], c.parentURL).pathname;
      return { url: 'shim:' + file, shortCircuit: true };
    }
    try { return await next(s, c); }
    catch (e) { if (s.startsWith('.')) return next(s + '.ts', c); throw e; }
  }
  export async function load(url, c, next) {
    if (url.startsWith('shim:')) {
      return { format: 'module', source: 'export default ' + JSON.stringify(url.slice(5)), shortCircuit: true };
    }
    const r = await next(url, c);
    if (url.endsWith('.ts') && r.source) {
      const src = String(r.source).replaceAll('import.meta.glob(', 'globalThis.__viteGlob(');
      return { ...r, source: src };
    }
    return r;
  }`,
);

globalThis.window = globalThis;
// Canvas 2D calls (procedural textures) are no-ops headlessly.
const noop2d = new Proxy({}, { get: () => () => noop2d });
const element = () => ({
  addEventListener() {},
  removeEventListener() {},
  style: {},
  width: 1,
  height: 1,
  getContext: () => noop2d,
});
globalThis.document = { createElementNS: element, createElement: element };
globalThis.fetch = async (file) => ({
  arrayBuffer: async () => {
    const b = fs.readFileSync(file);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  },
  json: async () => JSON.parse(fs.readFileSync(file, 'utf8')),
});
globalThis.__viteGlob = (pattern) => {
  const dir = path.join(ROOT, 'src/weapons', path.dirname(pattern));
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    out[`${path.dirname(pattern)}/${f}`] = async () =>
      fs.readFileSync(path.join(dir, f), 'utf8');
  }
  return out;
};
const warn = console.warn;
console.warn = (...a) =>
  String(a[0]).includes('FBXLoader') ? undefined : warn(...a);

const THREE = await import('three');
const { loadHeroAssets } = await import('./src/character/HeroModel.ts');
const { WeaponModels, gripOf } = await import('./src/weapons/WeaponModels.ts');
const { PlayerController } = await import('./src/player/PlayerController.ts');
const { PlayerCharacter } = await import('./src/player/PlayerCharacter.ts');
const { WEAPON_DEFS } = await import('./src/constants/weapons.ts');
const { GUN_HOLD } = await import('./src/constants/character.ts');

const scene = new THREE.Scene();
const player = new PlayerController(75, 16 / 9, {}, null);
player.capsulePosition.set(0, 0.4, 0);
scene.add(player.camera);
const container = new THREE.Group();
player.camera.add(container);
const rigs = await Promise.all(
  WEAPON_DEFS.map((_, i) => WeaponModels.loadGunRig(i)),
);
for (const rig of rigs) container.add(rig.root);
const pc = new PlayerCharacter(scene, player, await loadHeroAssets(), rigs);
const bonePos = (n) => pc.hero.bone(n).getWorldPosition(new THREE.Vector3());
const v3 = (t) => new THREE.Vector3(...t).normalize();

/** Wrist error vs its target, and how well the real hand matches the wanted pose. */
function measureHand(side, grip, gunQ) {
  const want = {
    fingers: v3(
      side === 'r' ? GUN_HOLD.RIGHT_FINGERS : GUN_HOLD.LEFT_FINGERS,
    ).applyQuaternion(gunQ),
    palm: v3(
      side === 'r' ? GUN_HOLD.RIGHT_PALM : GUN_HOLD.LEFT_PALM,
    ).applyQuaternion(gunQ),
  };
  const target = grip
    .getWorldPosition(new THREE.Vector3())
    .addScaledVector(want.palm, -GUN_HOLD.GRIP_RADIUS_M)
    .addScaledVector(want.fingers, -GUN_HOLD.PALM_REACH_M);
  const wrist = bonePos(`hand_${side}`);
  const fingers = bonePos(`middle_01_${side}`).sub(wrist).normalize();
  // Thumb side of the knuckle line. Right hand, palm down, fingers forward:
  // thumb points left = fingers x palm; the left hand is the mirror image.
  const thumbSide = bonePos(`index_01_${side}`)
    .sub(bonePos(`pinky_01_${side}`))
    .normalize();
  const wantThumb =
    side === 'r'
      ? new THREE.Vector3().crossVectors(want.fingers, want.palm).normalize()
      : new THREE.Vector3().crossVectors(want.palm, want.fingers).normalize();
  return {
    err: wrist.distanceTo(target),
    fingerDot: fingers.dot(want.fingers),
    thumbDot: thumbSide.dot(wantThumb),
  };
}

function run(view, weapon, aiming) {
  player.viewMode = view;
  const def = WEAPON_DEFS[weapon];
  container.position.set(...(aiming ? def.adsOffset : def.idleOffset));
  for (let f = 0; f < 60; f++) {
    // Controller normally places the camera; mimic its FPV eye so the TPP
    // camera pose doesn't matter here.
    player.camera.quaternion.setFromEuler(
      new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'),
    );
    player.camera.updateMatrixWorld(true);
    pc.update(1 / 60, weapon, aiming);
  }
  scene.updateMatrixWorld(true);
  const rig = rigs[weapon];
  const grips =
    view === 'fpv'
      ? [gripOf(rig.rightArm), gripOf(rig.leftArm)]
      : [gripOf(pc.guns[weapon].rightArm), gripOf(pc.guns[weapon].leftArm)];
  const gunQ = (
    view === 'fpv' ? rig.root : pc.guns[weapon].group
  ).getWorldQuaternion(new THREE.Quaternion());
  const R = measureHand('r', grips[0], gunQ);
  const L = measureHand('l', grips[1], gunQ);
  const chest = pc.hero.bone('spine_03').getWorldPosition(new THREE.Vector3());
  const muzzle = (
    view === 'fpv' ? rig.muzzleFlash : pc.guns[weapon].muzzle
  ).getWorldPosition(new THREE.Vector3());
  // Forward is -Z at yaw 0: muzzle must be ahead of the chest.
  const ahead = chest.z - muzzle.z;
  console.log(
    `${view} ${WEAPON_DEFS[weapon].name.padEnd(15)} ${aiming ? 'ADS' : 'hip'}  wrist err R ${(R.err * 100).toFixed(1)}cm L ${(L.err * 100).toFixed(1)}cm  fingers R ${R.fingerDot.toFixed(2)} L ${L.fingerDot.toFixed(2)}  thumb R ${R.thumbDot.toFixed(2)} L ${L.thumbDot.toFixed(2)}  muzzle ${ahead.toFixed(2)}m`,
  );
  return { R, L, ahead };
}

const TOLERANCE_M = 0.03;
for (const view of ['fpv', 'tpp']) {
  for (let w = 0; w < WEAPON_DEFS.length; w++) {
    for (const aiming of [false, true]) {
      const r = run(view, w, aiming);
      for (const h of [r.R, r.L]) {
        assert.ok(h.err < TOLERANCE_M, 'wrist must reach its grip target');
        assert.ok(
          h.fingerDot > 0.95,
          'fingers must point the way the grip wants',
        );
        assert.ok(h.thumbDot > 0.9, 'palm must face the gun (not mirrored)');
      }
      assert.ok(r.ahead > 0.2, 'gun must point out in front of the body');
    }
  }
}
console.log('player hold: ok');
