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
// Mirror WeaponManager's viewmodel pose: hip offset + hip yaw, or ADS.
const holdAt = (def, aiming, view = 'fpv') => {
  const hip = view === 'tpp' ? def.tppIdleOffset : def.idleOffset;
  const fpvHip = !aiming && view !== 'tpp';
  container.position.set(...(aiming ? def.adsOffset : hip));
  // Scoped first-person ADS centres the scope axis on the eye (WeaponManager).
  const sightY = rigs[WEAPON_DEFS.indexOf(def)].scopeSightY;
  if (aiming && view !== 'tpp' && sightY !== undefined)
    container.position.set(0, -sightY, def.adsOffset[2]);
  container.rotation.set(0, fpvHip ? def.hipYaw : 0, 0);
  if (!fpvHip) return;
  // Barrel tilt about the right grip, as WeaponManager does.
  const grip = rigs[WEAPON_DEFS.indexOf(def)].rightArm.position;
  const E = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(def.hipPitch, def.hipGripYaw, 0, 'YXZ'),
  );
  container.position.add(
    grip
      .clone()
      .sub(grip.clone().applyQuaternion(E))
      .applyQuaternion(container.quaternion),
  );
  container.quaternion.multiply(E);
};
const pc = new PlayerCharacter(scene, player, await loadHeroAssets(), rigs);
// Wrist twist: the hand's roll about the forearm axis vs the rest pose. A
// big roll concentrated at the wrist pinches the skinned wrist thin.
const { Hero } = await import('./src/character/HeroModel.ts');
const restHero = new Hero(await loadHeroAssets());
const relQ = (h, side) => {
  const lower = h
    .bone(`lowerarm_${side}`)
    .getWorldQuaternion(new THREE.Quaternion());
  return lower
    .invert()
    .multiply(
      h.bone(`hand_${side}`).getWorldQuaternion(new THREE.Quaternion()),
    );
};
restHero.root.updateMatrixWorld(true);
const restRel = { r: relQ(restHero, 'r'), l: relQ(restHero, 'l') };
const wristTwistDeg = (side) => {
  const d = restRel[side].clone().invert().multiply(relQ(pc.hero, side));
  // Forearm axis in the forearm's frame: from lowerarm to hand.
  const lower = pc.hero.bone(`lowerarm_${side}`);
  const axis = pc.hero
    .bone(`hand_${side}`)
    .getWorldPosition(new THREE.Vector3())
    .sub(lower.getWorldPosition(new THREE.Vector3()))
    .applyQuaternion(lower.getWorldQuaternion(new THREE.Quaternion()).invert())
    .normalize();
  const p = axis.dot(new THREE.Vector3(d.x, d.y, d.z));
  const tw = new THREE.Quaternion(
    axis.x * p,
    axis.y * p,
    axis.z * p,
    d.w,
  ).normalize();
  const deg = (2 * Math.acos(Math.min(1, Math.abs(tw.w))) * 180) / Math.PI;
  return deg;
};

const bonePos = (n) => pc.hero.bone(n).getWorldPosition(new THREE.Vector3());
const v3 = (t) => new THREE.Vector3(...t).normalize();

/** Wrist error vs its target, and how well the real hand matches the wanted pose. */
function measureHand(side, grip, gunQ, view) {
  const tpp = view === 'tpp';
  const want = {
    fingers: v3(
      side === 'r'
        ? GUN_HOLD.RIGHT_FINGERS
        : tpp
          ? GUN_HOLD.TPP_LEFT_FINGERS
          : GUN_HOLD.LEFT_FINGERS,
    ).applyQuaternion(gunQ),
    palm: v3(
      side === 'r'
        ? GUN_HOLD.RIGHT_PALM
        : tpp
          ? GUN_HOLD.TPP_LEFT_PALM
          : GUN_HOLD.LEFT_PALM,
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
  holdAt(def, aiming, view);
  for (let f = 0; f < 60; f++) {
    // Controller normally places the camera; mimic its FPV eye so the TPP
    // camera pose doesn't matter here.
    player.camera.quaternion.setFromEuler(
      new THREE.Euler(player.pitch, player.yaw, 0, 'YXZ'),
    );
    player.camera.updateMatrixWorld(true);
    pc.update(1 / 60, weapon, false);
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
  const R = measureHand('r', grips[0], gunQ, view);
  const L = measureHand('l', grips[1], gunQ, view);
  // Fingers wrap the gun (not a fist floating beside it).
  const gripR = grips[0].getWorldPosition(new THREE.Vector3());
  const gripL = grips[1].getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(gunQ);
  const tip = (n) => bonePos(n);
  const fingers = {
    midR: tip('middle_04_leaf_r').distanceTo(gripR),
    midL: tip('middle_04_leaf_l').distanceTo(gripL),
    trigger: tip('index_04_leaf_r').sub(tip('middle_04_leaf_r')).dot(fwd),
  };
  const chest = pc.hero.bone('spine_03').getWorldPosition(new THREE.Vector3());
  const muzzle = (
    view === 'fpv' ? rig.muzzleFlash : pc.guns[weapon].muzzle
  ).getWorldPosition(new THREE.Vector3());
  // Forward is -Z at yaw 0: muzzle must be ahead of the chest.
  const ahead = chest.z - muzzle.z;
  console.log(
    `${view} ${WEAPON_DEFS[weapon].name.padEnd(15)} ${aiming ? 'ADS' : 'hip'}  wrist err R ${(R.err * 100).toFixed(1)}cm L ${(L.err * 100).toFixed(1)}cm  fingers R ${R.fingerDot.toFixed(2)} L ${L.fingerDot.toFixed(2)}  thumb R ${R.thumbDot.toFixed(2)} L ${L.thumbDot.toFixed(2)}  muzzle ${ahead.toFixed(2)}m`,
  );
  console.log(
    `   fingers: right mid tip ${(fingers.midR * 100).toFixed(0)}cm from grip, left ${(fingers.midL * 100).toFixed(0)}cm, index ahead of middle ${(fingers.trigger * 100).toFixed(0)}cm`,
  );
  const twist = { r: wristTwistDeg('r'), l: wristTwistDeg('l') };
  // FPV hip (PUBG): right hand out of view, muzzle near the crosshair.
  let fpvHip = null;
  if (view === 'fpv' && !aiming) {
    const toCam = (v) => v.applyMatrix4(player.camera.matrixWorldInverse);
    player.camera.updateMatrixWorld(true);
    const hr = toCam(bonePos('hand_r'));
    const mz = toCam(rig.muzzleFlash.getWorldPosition(new THREE.Vector3()));
    const vHalf = (player.camera.fov / 2) * (Math.PI / 180);
    fpvHip = {
      rightHandBelowDeg: (Math.atan2(-hr.y, -hr.z) * 180) / Math.PI,
      rightHandSideDeg: (Math.atan2(hr.x, -hr.z) * 180) / Math.PI,
      muzzleDownDeg: (Math.atan2(-mz.y, -mz.z) * 180) / Math.PI,
      halfFovDeg: (vHalf * 180) / Math.PI,
    };
    console.log(
      `   fpv hip: right hand ${fpvHip.rightHandBelowDeg.toFixed(0)}deg below / ${fpvHip.rightHandSideDeg.toFixed(0)}deg right (view half ${fpvHip.halfFovDeg.toFixed(0)}deg), muzzle ${fpvHip.muzzleDownDeg.toFixed(0)}deg below crosshair`,
    );
  }
  console.log(
    `   wrist twist: right ${twist.r.toFixed(0)}deg, left ${twist.l.toFixed(0)}deg`,
  );
  return { R, L, ahead, fingers, twist, fpvHip };
}

// Facing: at facingYaw 0 the body must look down -Z (same as the camera),
// i.e. toes point -Z. Otherwise TPP shows the character's front.
{
  player.viewMode = 'tpp';
  player.facingYaw = 0;
  for (let f = 0; f < 10; f++) pc.update(1 / 60, 0, false);
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
      pc2.update(1 / 60, 0, false);
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
  // Aiming: the bore converges on the crosshair point; low-ready points down.
  for (const [w, pitch] of [
    [0, 0],
    [0, -0.3],
    [2, 0.4],
  ]) {
    ctl.pitch = pitch;
    for (const aim of [true, false]) {
      ctl.aimLock = aim;
      holdAt(WEAPON_DEFS[w], aim, 'tpp');
      for (let f = 0; f < 60; f++) {
        ctl.update(1 / 60);
        pc2.update(1 / 60, w, false);
      }
      scene.updateMatrixWorld(true);
      const g = pc2.guns[w];
      const butt = g.butt.clone().applyMatrix4(g.group.matrixWorld);
      const muzzle = g.muzzle.getWorldPosition(new THREE.Vector3());
      const bore = muzzle.clone().sub(butt).normalize();
      const name = WEAPON_DEFS[w].name;
      if (aim) {
        const aimPoint = new THREE.Vector3(0, 0, -GUN_HOLD.TPP_CONVERGE_M)
          .applyQuaternion(ctl.camera.quaternion)
          .add(ctl.camera.position);
        const err = THREE.MathUtils.radToDeg(bore.angleTo(aimPoint.sub(butt)));
        const left = gripOf(g.leftArm).getWorldPosition(new THREE.Vector3());
        const frac =
          left.clone().sub(butt).dot(muzzle.clone().sub(butt)) /
          muzzle.distanceToSquared(butt);
        console.log(
          `tpp aim ${name} pitch ${pitch}: muzzle-to-aim-point ${err.toFixed(2)}deg  left grip at ${(frac * 100).toFixed(0)}% butt->muzzle`,
        );
        assert.ok(err < 0.5, 'aimed bore must converge on the crosshair');
        assert.ok(frac > 0.55 && frac < 0.7, 'left hand on the handguard');
      } else {
        const down = THREE.MathUtils.radToDeg(Math.asin(bore.y));
        console.log(
          `tpp low-ready ${name} pitch ${pitch}: muzzle pitch ${down.toFixed(0)}deg`,
        );
        assert.ok(down < -20, 'low-ready muzzle points down');
      }
    }
  }
  ctl.pitch = 0;
  ctl.aimLock = false;
  scene.remove(pc2.hero.root);
}

// Third-person sprint: long guns two-handed and carried low; small guns
// one-handed (right hand), muzzle raised, left arm running free.
for (const w of [0]) {
  player.viewMode = 'tpp';
  player.stance = 'stand';
  player.aimLock = false;
  player.isSprinting = true;
  player.velocity.set(0, 0, -8);
  holdAt(WEAPON_DEFS[w], false, 'tpp');
  for (let f = 0; f < 60; f++) pc.update(1 / 60, w, false);
  scene.updateMatrixWorld(true);
  const gun = pc.guns[w];
  const gunQ = gun.group.getWorldQuaternion(new THREE.Quaternion());
  const R = measureHand('r', gripOf(gun.rightArm), gunQ, 'tpp');
  const L = measureHand('l', gripOf(gun.leftArm), gunQ, 'tpp');
  const leftOff = bonePos('hand_l').distanceTo(
    gripOf(gun.leftArm).getWorldPosition(new THREE.Vector3()),
  );
  const muzzleUp =
    gun.muzzle.getWorldPosition(new THREE.Vector3()).y -
    gripOf(gun.rightArm).getWorldPosition(new THREE.Vector3()).y;
  console.log(
    `tpp sprint ${WEAPON_DEFS[w].name.padEnd(15)} wrist err R ${(R.err * 100).toFixed(1)}cm L ${(L.err * 100).toFixed(1)}cm  left hand off grip ${leftOff.toFixed(2)}m  muzzle ${muzzleUp > 0 ? 'above' : 'below'} hand ${Math.abs(muzzleUp).toFixed(2)}m`,
  );
  assert.ok(R.err < 0.03, 'right hand holds the gun while sprinting');
  assert.ok(L.err < 0.03, 'long gun: both hands stay on it');
  assert.ok(muzzleUp < 0, 'long gun: carried low');
}
player.isSprinting = false;
player.velocity.set(0, 0, 0);

// Third-person low-ready: the gun must stay clear of the head, and the rifle
// stance's torso twist must not turn the face off the aim.
{
  const { GUN_MODELS } = await import('./src/constants/weapons.ts');
  player.viewMode = 'tpp';
  player.stance = 'stand';
  player.aimLock = false;
  player.isSprinting = false;
  player.velocity.set(0, 0, 0);
  const headQ = () =>
    pc.hero.bone('Head').getWorldQuaternion(new THREE.Quaternion());
  let faceLocal = null;
  for (const w of [1, 0, 1, 2]) {
    holdAt(WEAPON_DEFS[w], false, 'tpp');
    for (let f = 0; f < 60; f++) pc.update(1 / 60, w, false);
    scene.updateMatrixWorld(true);
    // Pistol has no torso twist: take its head frame as "looking forward".
    if (!faceLocal) {
      faceLocal = new THREE.Vector3(0, 0, -1).applyQuaternion(headQ().invert());
      continue;
    }
    const gun = pc.guns[w];
    const muzzle = gun.muzzle.getWorldPosition(new THREE.Vector3());
    const stock = gun.muzzle.position
      .clone()
      .add(new THREE.Vector3(0, 0, GUN_MODELS[w].LENGTH_M))
      .applyMatrix4(gun.group.matrixWorld);
    const head = bonePos('Head');
    const clearance = new THREE.Line3(muzzle, stock)
      .closestPointToPoint(head, true, new THREE.Vector3())
      .distanceTo(head);
    const face = faceLocal.clone().applyQuaternion(headQ()).setY(0).normalize();
    const elbowDrop = (side) =>
      bonePos(`upperarm_${side}`).y - bonePos(`lowerarm_${side}`).y;
    console.log(
      `   elbows below shoulders: right ${(elbowDrop('r') * 100).toFixed(0)}cm, left ${(elbowDrop('l') * 100).toFixed(0)}cm`,
    );
    console.log(
      `tpp low-ready ${WEAPON_DEFS[w].name.padEnd(15)} head clearance ${(clearance * 100).toFixed(0)}cm  face fwd ${(-face.z).toFixed(2)}  muzzle y-head ${(muzzle.y - head.y).toFixed(2)}m`,
    );
    assert.ok(clearance > 0.12, 'gun must not pass through the head');
    assert.ok(
      -face.z > 0.9,
      'face must look along the aim, not off to the side',
    );
    assert.ok(muzzle.y < head.y - 0.3, 'low-ready muzzle points down');
  }
}

// Pistol: erangel-run clips + the pistol fixed in the right hand, both views.
{
  player.stance = 'stand';
  player.onGround = true;
  player.isSprinting = false;
  player.velocity.set(0, 0, 0);
  const gun = pc.guns[1];
  const clip = () => pc.hero.current?.getClip().name;
  const inHand = () => {
    scene.updateMatrixWorld(true);
    return new THREE.Vector3()
      .setFromMatrixPosition(gun.group.matrixWorld)
      .applyMatrix4(pc.hero.bone('hand_r').matrixWorld.clone().invert());
  };
  for (const view of ['tpp', 'fpv']) {
    player.viewMode = view;
    player.aimLock = false;
    for (let f = 0; f < 40; f++) pc.update(1 / 60, 1, false);
    const idleClip = clip();
    const a = inHand();
    player.aimLock = true;
    for (let f = 0; f < 40; f++) pc.update(1 / 60, 1, false);
    const aimClip = clip();
    const b = inHand();
    pc.onShot();
    pc.update(1 / 60, 1, false);
    const shootClip = clip();
    const chest = bonePos('spine_03');
    const ahead = chest.z - gun.muzzle.getWorldPosition(new THREE.Vector3()).z;
    console.log(
      `pistol ${view}: ${idleClip} -> ${aimClip} -> ${shootClip}  gun-in-hand drift ${(a.distanceTo(b) * 100).toFixed(1)}cm  visible ${gun.group.visible}  muzzle ${ahead.toFixed(2)}m ahead`,
    );
    assert.equal(idleClip, 'Pistol_Idle_Loop');
    assert.equal(aimClip, 'Pistol_Aim_Neutral');
    assert.equal(shootClip, 'Pistol_Shoot');
    assert.ok(a.distanceTo(b) < 1e-3, 'pistol stays fixed in the right hand');
    assert.ok(gun.group.visible, 'the body pistol shows in both views');
    assert.ok(ahead > 0.2, 'aimed pistol points forward');
  }
  player.aimLock = false;
}

// Third-person aim: the support (left) arm reaches out along the handguard.
{
  player.viewMode = 'tpp';
  player.aimLock = true;
  holdAt(WEAPON_DEFS[0], true, 'tpp');
  for (let f = 0; f < 60; f++) pc.update(1 / 60, 0, false);
  scene.updateMatrixWorld(true);
  const s = bonePos('upperarm_l');
  const e = bonePos('lowerarm_l');
  const h = bonePos('hand_l');
  const bend = e.clone().sub(s).angleTo(h.clone().sub(e));
  const flare = e.x - s.x;
  console.log(
    `tpp aim AK-47: left elbow bend ${THREE.MathUtils.radToDeg(bend).toFixed(0)}deg, elbow out ${(flare * -100).toFixed(0)}cm`,
  );
  player.aimLock = false;
}

// First-person roll: the long gun rides the hand, like third-person.
{
  player.viewMode = 'fpv';
  player.move = 'roll';
  player.moveTime = 0;
  holdAt(WEAPON_DEFS[0], false);
  for (let f = 0; f < 40; f++) pc.update(1 / 60, 0, false);
  assert.ok(pc.rollGun && pc.guns[0].group.visible, 'fpv roll: body gun');
  player.move = 'normal';
  for (let f = 0; f < 60; f++) pc.update(1 / 60, 0, false);
  assert.ok(!pc.rollGun, 'fpv roll: back to the viewmodel after');
}

// First-person special moves: hands stay on the camera-held gun.
for (const move of ['slide', 'mantle']) {
  player.viewMode = 'fpv';
  player.stance = 'stand';
  player.onGround = true;
  player.move = move;
  player.moveTime = 0;
  holdAt(WEAPON_DEFS[0], false);
  for (let f = 0; f < 40; f++) pc.update(1 / 60, 0, false);
  scene.updateMatrixWorld(true);
  const gunQ = rigs[0].root.getWorldQuaternion(new THREE.Quaternion());
  const R = measureHand('r', gripOf(rigs[0].rightArm), gunQ);
  const L = measureHand('l', gripOf(rigs[0].leftArm), gunQ);
  console.log(
    `fpv ${move}: wrist err R ${(R.err * 100).toFixed(1)}cm L ${(L.err * 100).toFixed(1)}cm`,
  );
  assert.ok(R.err < 0.05 && L.err < 0.05, `fpv ${move}: hands stay on the gun`);
}
player.move = 'normal';

// Sideways lean: the spine (pelvis -> neck) must stay upright sideways
// while walking/sprinting with a twisted rifle stance.
for (const [label, sprinting, speed] of [
  ['walk', false, 0.97],
  ['sprint', true, 8.25],
]) {
  player.viewMode = 'tpp';
  player.stance = 'stand';
  player.onGround = true;
  player.aimLock = false;
  player.isSprinting = sprinting;
  player.facingYaw = 0;
  player.velocity.set(0, 0, -speed);
  holdAt(WEAPON_DEFS[0], false, 'tpp');
  let worst = 0;
  const reachL = [];
  for (let f = 0; f < 120; f++) {
    pc.update(1 / 60, 0, false);
    if (f < 30) continue;
    scene.updateMatrixWorld(true);
    // Arm stretch: shoulder -> left grip distance should stay steady, not
    // pump with every stride (gun must move with the torso).
    reachL.push(
      bonePos('upperarm_l').distanceTo(
        gripOf(pc.guns[0].leftArm).getWorldPosition(new THREE.Vector3()),
      ),
    );
    const spine = bonePos('neck_01').sub(bonePos('pelvis')).normalize();
    // facing 0: right is +X; sideways lean = angle of spine toward +/-X
    worst = Math.max(worst, Math.abs(Math.asin(spine.x)) * (180 / Math.PI));
  }
  const stretch = Math.max(...reachL) - Math.min(...reachL);
  console.log(
    `lean ${label}: worst sideways spine lean ${worst.toFixed(1)}deg  left-arm stretch per stride ${(stretch * 100).toFixed(1)}cm`,
  );
  assert.ok(worst < 12, `${label}: body must not bend sideways`);
}
player.isSprinting = false;
player.velocity.set(0, 0, 0);

// Scope: mounted on the AK's receiver (not floating, not sunk), axis above bore.
{
  const rig = rigs[0];
  const gun = rig.root.children[0];
  const scope = gun.children[gun.children.length - 1];
  rig.root.updateMatrixWorld(true);
  const toRig = new THREE.Matrix4().copy(rig.root.matrixWorld).invert();
  const sb = new THREE.Box3().setFromObject(scope).applyMatrix4(toRig);
  const muzzleY = rig.muzzlePos.y;
  console.log(
    `scope: base y ${(sb.min.y * 100).toFixed(1)}cm, axis y ${(rig.scopeSightY * 100).toFixed(1)}cm, bore y ${(muzzleY * 100).toFixed(1)}cm (rig space), length ${((sb.max.z - sb.min.z) * 100).toFixed(0)}cm, width ${((sb.max.x - sb.min.x) * 100).toFixed(1)}cm`,
  );
  assert.ok(rig.scopeSightY > muzzleY, 'scope sits above the bore');
  assert.ok(
    rigs[1].scopeSightY === undefined && rigs[2].scopeSightY === undefined,
    'only the AK is scoped',
  );
}

// Fists (4th weapon): no gun, jab then cross from erangel-run's clips.
for (const view of ['fpv', 'tpp']) {
  player.viewMode = view;
  player.stance = 'stand';
  player.onGround = true;
  player.move = 'normal';
  player.aimLock = false;
  player.velocity.set(0, 0, 0);
  for (let f = 0; f < 30; f++) pc.update(1 / 60, 3, false);
  const clipName = () => pc.hero.current?.getClip().name;
  pc.onPunch();
  pc.update(1 / 60, 3, false);
  const first = clipName();
  for (let f = 0; f < 90; f++) pc.update(1 / 60, 3, false); // let the jab finish
  pc.onPunch();
  pc.update(1 / 60, 3, false);
  const second = clipName();
  const anyGunShown = pc.guns.some((g, i) => i !== 3 && g.group.visible);
  console.log(
    `fists ${view}: punch 1 ${first}, punch 2 ${second}, other guns visible ${anyGunShown}`,
  );
  assert.equal(first, 'Punch_Jab');
  assert.equal(second, 'Punch_Cross');
  assert.ok(!anyGunShown, 'fists: no gun in hand');
}

// Arm actions while moving must not freeze the legs (gliding): the legs keep
// their locomotion cycle and the action plays on the upper body.
for (const [label, weapon, sprinting, speed, act] of [
  ['punch sprint', 3, true, 8.25, () => pc.onPunch()],
  ['pistol shot walk', 1, false, 0.97, () => pc.onShot()],
  ['pistol reload walk', 1, false, 0.97, null],
]) {
  player.viewMode = 'tpp';
  player.stance = 'stand';
  player.onGround = true;
  player.move = 'normal';
  player.facingYaw = 0;
  player.isSprinting = sprinting;
  player.aimLock = weapon === 1 && !!act;
  player.velocity.set(0, 0, -speed);
  for (let f = 0; f < 30; f++) pc.update(1 / 60, weapon, false);
  act?.();
  const thigh = pc.hero.bone('thigh_l');
  const qs = [];
  let upper = '';
  for (let f = 0; f < 30; f++) {
    pc.update(1 / 60, weapon, !act);
    if (f === 5) upper = pc.hero.upper?.getClip().name ?? 'none';
    qs.push(thigh.getWorldQuaternion(new THREE.Quaternion()));
  }
  let swing = 0;
  for (const q of qs) swing = Math.max(swing, qs[0].angleTo(q));
  const legs = pc.hero.current?.getClip().name;
  console.log(
    `${label}: legs ${legs}, upper ${upper}, thigh swing ${((swing * 180) / Math.PI).toFixed(0)}deg`,
  );
  assert.match(legs, /Walk|Sprint/, `${label}: legs keep locomotion`);
  assert.notEqual(upper, 'none', `${label}: action on the upper body`);
  assert.ok(swing > (10 * Math.PI) / 180, `${label}: legs keep swinging`);
}
player.isSprinting = false;
player.aimLock = false;
player.velocity.set(0, 0, 0);
for (let f = 0; f < 60; f++) pc.update(1 / 60, 0, false);

const TOLERANCE_M = 0.03;
for (const view of ['fpv', 'tpp']) {
  for (const w of [0, 2]) {
    // long guns (pistol: erangel clips, tested below)
    for (const aiming of [false, true]) {
      const r = run(view, w, aiming);
      assert.ok(r.fingers.midR < 0.08, 'right fingers wrap the grip');
      assert.ok(r.fingers.midL < 0.09, 'left fingers wrap the handguard');
      assert.ok(
        r.fingers.trigger > 0.02,
        'right index rests forward on the trigger',
      );
      assert.ok(
        r.twist.l < 70 && r.twist.r < 70,
        'wrists must not be over-twisted (thin wrist)',
      );
      if (r.fpvHip && w !== 1) {
        const h = r.fpvHip;
        const outOfView =
          h.rightHandBelowDeg > h.halfFovDeg ||
          h.rightHandSideDeg > 60 ||
          h.rightHandBelowDeg > 90;
        assert.ok(outOfView, 'FPV hip: right hand must be out of view (PUBG)');
        assert.ok(
          h.muzzleDownDeg < 20,
          'FPV hip: muzzle ends near the crosshair',
        );
      }
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
for (let f = 0; f < 60; f++) pc.update(1 / 60, 0, false);
scene.updateMatrixWorld(true);
const headQ = () =>
  pc.hero.bone('Head').getWorldQuaternion(new THREE.Quaternion());
const faceLocal = new THREE.Vector3(0, 0, -1).applyQuaternion(headQ().invert());

player.stance = 'prone';
holdAt(WEAPON_DEFS[0], true); // prone holds at eye level
let minY = Infinity;
let maxFootY = -Infinity;
let lowestBone = '';
let maxKneeOut = 0;
for (let f = 0; f < 120; f++) {
  player.velocity.set(0, 0, f < 60 ? 0 : -0.5); // settle, then crawl forward
  pc.update(1 / 60, 0, false);
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
