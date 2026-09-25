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
    pc.update(1 / 60, weapon);
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

// Facing: at facingYaw 0 the body must look down -Z (same as the camera),
// i.e. toes point -Z. Otherwise TPP shows the character's front.
{
  player.viewMode = 'tpp';
  player.facingYaw = 0;
  for (let f = 0; f < 10; f++) pc.update(1 / 60, 0);
  scene.updateMatrixWorld(true);
  const toes = bonePos('ball_l').sub(bonePos('foot_l')).setY(0).normalize();
  console.log(`facing: toes horizontal z ${toes.z.toFixed(2)} (must be < 0)`);
  assert.ok(toes.z < -0.8, 'hero must face -Z at facingYaw 0');
}

// Full loop: real controller update in third-person -> camera must sit
// behind the body (we see the back, not the face).
{
  const input = {
    consumeMouseDelta: () => ({ x: 0, y: 0 }),
    isKeyPressed: () => false,
    isKeyDown: () => false,
    isAnyKeyDown: () => false,
  };
  const bvh = { shapecast() {}, raycastFirst: () => null };
  const ctl = new PlayerController(75, 16 / 9, input, bvh);
  ctl.capsulePosition.set(0, 0.4, 0);
  ctl.viewMode = 'tpp';
  scene.add(ctl.camera);
  const pc2 = new PlayerCharacter(scene, ctl, await loadHeroAssets(), rigs);
  for (const yaw of [0, 1.2, -2.5]) {
    ctl.yaw = yaw;
    for (let f = 0; f < 90; f++) {
      ctl.update(1 / 60);
      pc2.update(1 / 60, 0);
    }
    scene.updateMatrixWorld(true);
    const chest = pc2.hero
      .bone('spine_03')
      .getWorldPosition(new THREE.Vector3());
    const toCam = ctl.camera.position.clone().sub(chest).setY(0).normalize();
    const w = (n) => pc2.hero.bone(n).getWorldPosition(new THREE.Vector3());
    const toes = w('ball_l').sub(w('foot_l')).setY(0).normalize();
    const camFwd = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(ctl.camera.quaternion)
      .setY(0)
      .normalize();
    console.log(
      `tpp yaw ${yaw}: facingYaw ${ctl.facingYaw.toFixed(2)}  toes.camFwd ${toes.dot(camFwd).toFixed(2)}  toes.toCam ${toes.dot(toCam).toFixed(2)}`,
    );
    assert.ok(
      toes.dot(camFwd) > 0.8,
      'body must face the way the camera looks',
    );
    assert.ok(toes.dot(toCam) < -0.5, 'camera must be behind the body');
  }
  scene.remove(pc2.hero.root);
}

// Third-person sprint: gun rides the right hand, left arm runs free.
{
  player.viewMode = 'tpp';
  player.stance = 'stand';
  player.isSprinting = false;
  player.velocity.set(0, 0, 0);
  container.position.set(...WEAPON_DEFS[0].idleOffset);
  for (let f = 0; f < 30; f++) pc.update(1 / 60, 0); // capture hand->gun
  player.isSprinting = true;
  player.velocity.set(0, 0, -8);
  const gun = pc.guns[0];
  const rel = [];
  let leftFar = 0;
  for (let f = 0; f < 90; f++) {
    pc.update(1 / 60, 0);
    scene.updateMatrixWorld(true);
    if (f < 45) continue; // wait for the blend
    const hand = pc.hero.bone('hand_r');
    // The TPP gun is posed via its matrix, so read the world position.
    const gunPos = new THREE.Vector3().setFromMatrixPosition(
      gun.group.matrixWorld,
    );
    rel.push(gunPos.applyMatrix4(hand.matrixWorld.clone().invert()).length());
    leftFar = Math.max(
      leftFar,
      bonePos('hand_l').distanceTo(
        gripOf(gun.leftArm).getWorldPosition(new THREE.Vector3()),
      ),
    );
  }
  const spread = Math.max(...rel) - Math.min(...rel);
  console.log(
    `tpp sprint: gun-to-right-hand drift ${(spread * 100).toFixed(1)}cm  left hand off grip ${leftFar.toFixed(2)}m`,
  );
  assert.ok(spread < 0.01, 'sprinting gun must stay locked to the right hand');
  assert.ok(leftFar > 0.15, 'left hand must be free while sprinting');
  player.isSprinting = false;
  player.velocity.set(0, 0, 0);
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
// --- Prone: lying face-down, head up looking forward, legs on the floor. ---
// Face direction in the Head bone's frame, taken while standing facing -Z.
player.viewMode = 'fpv';
player.stance = 'stand';
player.velocity.set(0, 0, 0);
for (let f = 0; f < 60; f++) pc.update(1 / 60, 0);
scene.updateMatrixWorld(true);
const headQ = () =>
  pc.hero.bone('Head').getWorldQuaternion(new THREE.Quaternion());
const faceLocal = new THREE.Vector3(0, 0, -1).applyQuaternion(headQ().invert());

player.stance = 'prone';
container.position.set(...WEAPON_DEFS[0].adsOffset); // prone holds at eye level
let minY = Infinity;
let maxFootY = -Infinity;
let lowestBone = '';
let maxKneeOut = 0;
for (let f = 0; f < 120; f++) {
  player.velocity.set(0, 0, f < 60 ? 0 : -0.5); // settle, then crawl forward
  pc.update(1 / 60, 0);
  scene.updateMatrixWorld(true);
  if (f < 60) continue; // wait for the lie-down blend
  pc.hero.model.traverse((o) => {
    if (!o.isBone) return;
    const y = o.getWorldPosition(new THREE.Vector3()).y;
    if (y < minY) {
      minY = y;
      lowestBone = `${o.name}@${f < 60 ? 'still' : 'crawl'}`;
    }
  });
  maxFootY = Math.max(maxFootY, bonePos('foot_l').y, bonePos('foot_r').y);
  const pel = bonePos('pelvis');
  maxKneeOut = Math.max(
    maxKneeOut,
    Math.abs(bonePos('calf_l').x - pel.x),
    Math.abs(bonePos('calf_r').x - pel.x),
  );
}
const face = faceLocal.clone().applyQuaternion(headQ());
const head = bonePos('Head');
const pelvis = bonePos('pelvis');
const feet = bonePos('foot_l').add(bonePos('foot_r')).multiplyScalar(0.5);
const gunQ = rigs[0].root.getWorldQuaternion(new THREE.Quaternion());
const hands = [
  measureHand('r', gripOf(rigs[0].rightArm), gunQ),
  measureHand('l', gripOf(rigs[0].leftArm), gunQ),
];
console.log(
  `prone: face fwd ${(-face.z).toFixed(2)} (down ${(-face.y).toFixed(2)})  head y ${head.y.toFixed(2)}  pelvis y ${pelvis.y.toFixed(2)}  body length ${head.distanceTo(feet).toFixed(2)}m  centre z ${((head.z + feet.z) / 2).toFixed(2)}  lowest bone ${lowestBone} y ${minY.toFixed(3)}  crawl foot max y ${maxFootY.toFixed(2)} knee out ${maxKneeOut.toFixed(2)}m  wrist err ${hands.map((h) => (h.err * 100).toFixed(1)).join('/')}cm`,
);
assert.ok(-face.z > 0.7, 'prone face must look forward, not at the ground');
assert.ok(head.y < 0.6 && pelvis.y < 0.35, 'body must lie on the ground');
assert.ok(Math.abs(head.y - feet.y) < 0.5, 'body must be horizontal');
assert.ok(head.z < feet.z, 'head must point the way the player faces');
assert.ok(
  Math.abs((head.z + feet.z) / 2) < 0.3,
  'body must be centred on the capsule',
);
assert.ok(minY > -0.05, 'no bone may sink through the floor');
assert.ok(maxKneeOut > 0.3, 'crawling must draw a knee up sideways');
assert.ok(maxFootY < 0.35, 'feet stay on the ground while crawling');
for (const h of hands)
  assert.ok(h.err < TOLERANCE_M, 'prone hands must hold the gun');

console.log('player hold: ok');
