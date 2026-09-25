import * as THREE from 'three';
import { type Arm, rotateWorld, solveArm } from '../character/armIK';
import { Hero, type HeroAssets } from '../character/HeroModel';
import { GUN_HOLD, HERO, type HeroClip } from '../constants/character';
import { MANTLE } from '../constants/player';
import { GUN_MODELS } from '../constants/weapons';
import { gripOf, type WeaponRig } from '../weapons/WeaponModels';
import type { PlayerController } from './PlayerController';

const tuple = (t: readonly number[]) => new THREE.Vector3(t[0], t[1], t[2]);

// Scratch objects (no allocation per frame).
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _tR = new THREE.Vector3();
const _tL = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _poleR = new THREE.Vector3();
const _poleL = new THREE.Vector3();
const _qAim = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();
const _mGun = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _f = new THREE.Vector3();
const _n = new THREE.Vector3();
const _gunQ = new THREE.Quaternion();
const _basis = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

/** How a hand grips: desired finger/palm directions in the gun frame, plus
 * the hand bone's own rest-pose finger/palm basis (hand-local). */
interface HandGrip {
  fingers: THREE.Vector3;
  palm: THREE.Vector3;
  localBasis: THREE.Matrix4;
}

/** Orthonormal basis [f, n', f x n'] as matrix columns. */
function basisFrom(
  f: THREE.Vector3,
  n: THREE.Vector3,
  out: THREE.Matrix4,
): THREE.Matrix4 {
  const fn = _f.copy(f).normalize();
  const nn = _n.copy(n).addScaledVector(fn, -n.dot(fn)).normalize();
  const b = _c.crossVectors(fn, nn);
  return out.makeBasis(fn, nn, b);
}

/** Third-person copy of a viewmodel gun (no muzzle flash/light). */
interface TppGun {
  group: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  muzzle: THREE.Object3D;
}

/**
 * The player's own body: the erangel-run hero, animated from the controller's
 * movement state, both hands IK'd onto the current gun's grips.
 * - First-person: camera sits at the hero's eyes (head collapsed), hands
 *   hold the camera-attached viewmodel gun.
 * - Third-person: a copy of the gun takes the viewmodel's exact pose relative
 *   to the hero's eyes (hip/ADS offset, recoil, sway, reload), so both views
 *   hold it the same way.
 */
export class PlayerCharacter {
  public readonly hero: Hero;
  private guns: TppGun[];
  private arms: { right: Arm; left: Arm };
  private chest: THREE.Object3D;
  private head: THREE.Object3D;
  private handR: THREE.Object3D;
  /** Bones we edit after the mixer. */
  private edited: THREE.Object3D[];
  /** Their clean animated pose (the mixer only rewrites changed values). */
  private animPose = new Map<THREE.Object3D, THREE.Quaternion>();
  private ikWeight = 1;
  /** 0 standing .. 1 lying face-down. */
  private proneT = 0;
  private crawlPhase = 0;
  private neck: THREE.Object3D;
  private legs: { thigh: THREE.Object3D; calf: THREE.Object3D; out: number }[];
  private handToGun = new THREE.Matrix4();
  private hasHandToGun = false;
  private lastMove = 'normal';
  private static readonly POLE_RIGHT = tuple(GUN_HOLD.POLE_RIGHT);
  private static readonly POLE_LEFT = tuple(GUN_HOLD.POLE_LEFT);
  private static readonly EYE = tuple(HERO.FPV_EYE_OFFSET);
  private grips: { right: HandGrip; left: HandGrip };

  constructor(
    scene: THREE.Scene,
    private player: PlayerController,
    assets: HeroAssets,
    private rigs: readonly WeaponRig[],
  ) {
    this.hero = new Hero(assets);
    scene.add(this.hero.root);
    this.hero.play('Idle_Loop', 0);

    const b = (n: string) => this.hero.bone(n);
    this.arms = {
      right: {
        upper: b('upperarm_r'),
        lower: b('lowerarm_r'),
        hand: b('hand_r'),
      },
      left: {
        upper: b('upperarm_l'),
        lower: b('lowerarm_l'),
        hand: b('hand_l'),
      },
    };
    this.chest = b('spine_03');
    this.head = b('Head');
    this.neck = b('neck_01');
    // `out` = which way (about up) swings that leg outward: left leg to -X.
    this.legs = [
      { thigh: b('thigh_l'), calf: b('calf_l'), out: -1 },
      { thigh: b('thigh_r'), calf: b('calf_r'), out: 1 },
    ];
    this.handR = this.arms.right.hand;
    const { right, left } = this.arms;
    this.edited = [
      this.chest,
      right.upper,
      right.lower,
      right.hand,
      left.upper,
      left.lower,
      left.hand,
      this.neck,
      ...this.legs.flatMap((l) => [l.thigh, l.calf]),
    ];
    this.grips = {
      right: this.handGrip('r', GUN_HOLD.RIGHT_FINGERS, GUN_HOLD.RIGHT_PALM),
      left: this.handGrip('l', GUN_HOLD.LEFT_FINGERS, GUN_HOLD.LEFT_PALM),
    };

    this.guns = rigs.map((rig) => {
      const kids = rig.root.children;
      const group = rig.root.clone(true);
      const leftArm = group.children[kids.indexOf(rig.leftArm)] as THREE.Group;
      const rightArm = group.children[
        kids.indexOf(rig.rightArm)
      ] as THREE.Group;
      group.remove(group.children[kids.indexOf(rig.muzzleFlash)]);
      group.visible = false;
      group.matrixAutoUpdate = false; // posed from matrices each frame
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = true;
      });
      const muzzle = new THREE.Object3D();
      muzzle.position.copy(rig.muzzlePos);
      group.add(muzzle);
      scene.add(group);
      return { group, leftArm, rightArm, muzzle };
    });
  }

  /**
   * Measure the hand bone's rest-pose finger + palm directions in its own
   * frame (world-space, so the FBX's duplicated nested bones don't matter).
   */
  private handGrip(
    side: 'r' | 'l',
    fingers: readonly number[],
    palm: readonly number[],
  ): HandGrip {
    this.hero.model.updateMatrixWorld(true);
    const at = (n: string) =>
      this.hero.bone(`${n}_${side}`).getWorldPosition(new THREE.Vector3());
    const wrist = at('hand');
    const f = at('middle_01').sub(wrist);
    const thumbSide = at('index_01').sub(at('pinky_01'));
    // Palm normal: the right hand's thumb side is its left, so the cross flips.
    const n =
      side === 'r'
        ? new THREE.Vector3().crossVectors(thumbSide, f)
        : new THREE.Vector3().crossVectors(f, thumbSide);
    const toLocal = this.hero
      .bone(`hand_${side}`)
      .getWorldQuaternion(new THREE.Quaternion())
      .invert();
    f.applyQuaternion(toLocal);
    n.applyQuaternion(toLocal);
    return {
      fingers: tuple(fingers).normalize(),
      palm: tuple(palm).normalize(),
      localBasis: basisFrom(f, n, new THREE.Matrix4()).clone(),
    };
  }

  /** Muzzle of the third-person gun (tracers start here in TPP). */
  public muzzle(weaponIndex: number): THREE.Object3D {
    return this.guns[weaponIndex].muzzle;
  }

  public update(delta: number, weaponIndex: number): void {
    const p = this.player;
    const tpp = p.viewMode === 'tpp';
    this.head.scale.setScalar(tpp ? 1 : HERO.FPV_HEAD_SCALE);

    const root = this.hero.root;
    root.position.set(
      p.capsulePosition.x,
      p.capsulePosition.y - p.radius,
      p.capsulePosition.z,
    );
    root.rotation.y = p.facingYaw;

    // Undo last frame's edits so a frozen clip can't let them accumulate.
    for (const bone of this.edited) {
      const q = this.animPose.get(bone);
      if (q) bone.quaternion.copy(q);
    }
    this.updateAnimation();
    this.hero.update(delta);
    for (const bone of this.edited) {
      const q = this.animPose.get(bone);
      if (q) q.copy(bone.quaternion);
      else this.animPose.set(bone, bone.quaternion.clone());
    }
    this.layProne(delta);
    root.updateMatrixWorld(true);

    const k = Math.min(1, delta * GUN_HOLD.IK_BLEND_PER_S);
    // Hands leave the IK during special moves and a third-person sprint:
    // the arms run the clip and the gun rides the right hand (PUBG sprint
    // carry, left arm free). First-person keeps both hands on the gun.
    const holdsGun = p.move === 'normal' && !(tpp && p.isSprinting) ? 1 : 0;
    this.ikWeight += (holdsGun - this.ikWeight) * k;
    const w = this.ikWeight;

    // Third-person low-ready (PUBG): gun angled down across the body; it
    // comes up to the crosshair only while aiming or firing.
    const pitch =
      !tpp || p.aimLock
        ? p.pitch
        : p.isSprinting
          ? GUN_HOLD.SPRINT_PITCH
          : GUN_HOLD.LOW_READY_PITCH;
    _qYaw.setFromAxisAngle(UP, p.facingYaw);
    _euler.set(pitch, p.facingYaw, 0);
    _qAim.setFromEuler(_euler);

    if (w > 1e-3) {
      // Rifle stance: twist the torso (left shoulder forward) and bend the
      // upper spine with the aim so the shoulders follow the gun.
      _q.setFromAxisAngle(UP, GUN_MODELS[weaponIndex].TWIST * w);
      rotateWorld(this.chest, _q);
      const right = _b.copy(RIGHT).applyQuaternion(_qYaw);
      _q.setFromAxisAngle(right, pitch * GUN_HOLD.SPINE_PITCH_SHARE * w);
      rotateWorld(this.chest, _q);
    }

    this.guns.forEach((g, i) => {
      g.group.visible = tpp && i === weaponIndex;
    });

    const rig = this.rigs[weaponIndex];
    this.eyePoint(_eye);
    if (tpp) {
      const gun = this.guns[weaponIndex];
      // Mirror the viewmodel's reload choreography onto the TPP hands.
      gun.leftArm.position.copy(rig.leftArm.position);
      gun.leftArm.rotation.copy(rig.leftArm.rotation);
      gun.rightArm.position.copy(rig.rightArm.position);
      gun.rightArm.rotation.copy(rig.rightArm.rotation);
      this.placeTppGun(gun, rig);
      this.reachFor(gripOf(gun.rightArm), gripOf(gun.leftArm), gun.group);
      if (w >= 0.999) {
        // Remember the gun relative to the hand for the next special move.
        this.handToGun
          .copy(this.handR.matrixWorld)
          .invert()
          .multiply(gun.group.matrixWorld);
        this.hasHandToGun = true;
      }
    } else {
      // First-person: camera at the eyes (position only; aim stays). The
      // viewmodel is its child, so update it before the IK reads the grips.
      p.camera.position.copy(_eye);
      p.camera.updateMatrixWorld(true);
      this.reachFor(gripOf(rig.rightArm), gripOf(rig.leftArm), rig.root);
    }
  }

  private eyePoint(out: THREE.Vector3): THREE.Vector3 {
    this.head.getWorldPosition(out);
    return out.add(_c.copy(PlayerCharacter.EYE).applyQuaternion(_qYaw));
  }

  /**
   * TPP gun = eye frame (aim) x viewmodel container x rig root, i.e. exactly
   * where the first-person gun would be. Special moves blend toward the gun
   * riding on the right hand.
   */
  private placeTppGun(gun: TppGun, rig: WeaponRig): void {
    const container = rig.root.parent!;
    container.updateMatrix();
    rig.root.updateMatrix();
    _mGun
      .compose(_eye, _qAim, _one)
      .multiply(container.matrix)
      .multiply(rig.root.matrix);

    const w = this.ikWeight;
    if (w < 0.999 && this.hasHandToGun) {
      _m.multiplyMatrices(this.handR.matrixWorld, this.handToGun);
      _m.decompose(_b, _quat, _scale);
      _mGun.decompose(_c, _q, _scale);
      _b.lerp(_c, w);
      _quat.slerp(_q, w);
      _mGun.compose(_b, _quat, _one);
    }
    gun.group.matrix.copy(_mGun);
    gun.group.updateMatrixWorld(true);
  }

  /**
   * Two-hand IK onto the grips, blended by the current IK weight. Each wrist
   * is placed a palm's length behind its grip and the hand is turned so the
   * palm faces the gun.
   */
  private reachFor(
    rightGrip: THREE.Object3D,
    leftGrip: THREE.Object3D,
    gun: THREE.Object3D,
  ): void {
    const w = this.ikWeight;
    if (w <= 1e-3) return;
    gun.getWorldQuaternion(_gunQ);
    const { right, left } = this.arms;
    const poleR = _poleR
      .copy(PlayerCharacter.POLE_RIGHT)
      .applyQuaternion(_qYaw);
    const poleL = _poleL.copy(PlayerCharacter.POLE_LEFT).applyQuaternion(_qYaw);
    this.gripHand(
      right,
      this.grips.right,
      rightGrip.getWorldPosition(_tR),
      poleR,
    );
    this.gripHand(left, this.grips.left, leftGrip.getWorldPosition(_tL), poleL);
    if (w < 0.999) {
      // Blend IK result back toward the animated arms (e.g. mid-roll).
      for (const arm of [right, left]) {
        for (const bone of [arm.upper, arm.lower, arm.hand]) {
          _q.copy(bone.quaternion); // IK result
          bone.quaternion.copy(this.animPose.get(bone)!).slerp(_q, w);
        }
      }
      this.chest.updateMatrixWorld(true);
    }
  }

  private gripHand(
    arm: Arm,
    grip: HandGrip,
    gripPos: THREE.Vector3,
    pole: THREE.Vector3,
  ): void {
    const fingers = _b.copy(grip.fingers).applyQuaternion(_gunQ);
    const palm = _eye.copy(grip.palm).applyQuaternion(_gunQ);
    // Palm centre sits on the grip surface; the wrist is behind it.
    const wrist = gripPos
      .addScaledVector(palm, -GUN_HOLD.GRIP_RADIUS_M)
      .addScaledVector(fingers, -GUN_HOLD.PALM_REACH_M);
    solveArm(arm, wrist, pole);

    // World rotation taking the hand's rest basis onto the wanted one.
    basisFrom(fingers, palm, _basis).multiply(
      _m.copy(grip.localBasis).transpose(),
    );
    _quat.setFromRotationMatrix(_basis);
    arm.hand.parent!.getWorldQuaternion(_q).invert();
    arm.hand.quaternion.copy(_q.multiply(_quat));
    arm.hand.updateMatrixWorld(true);
  }

  /**
   * Prone has no clip: lay the body face-down around the capsule (pitch the
   * model -90deg about its feet, then shift it back so it's centred), lift
   * the head to look forward, and frog-kick the legs while crawling.
   * Rotations are about world axes; with the body pitched down, +angle
   * about `right` turns the face from the ground to forward, and the crawl
   * turns thigh/shin about `up` so the legs stay on the ground.
   */
  private layProne(delta: number): void {
    const p = this.player;
    const target = p.stance === 'prone' && p.move === 'normal' ? 1 : 0;
    this.proneT +=
      (target - this.proneT) * Math.min(1, delta * HERO.PRONE_BLEND_PER_S);
    const t = this.proneT;
    const body = this.hero.body;
    body.rotation.x = (-Math.PI / 2) * t;
    body.position.set(0, HERO.PRONE_HEIGHT_M * t, HERO.PRONE_BODY_SHIFT_M * t);
    this.hero.root.updateMatrixWorld(true);
    if (t < 1e-3) return;

    const right = _b.set(1, 0, 0).applyAxisAngle(UP, p.facingYaw);
    rotateWorld(
      this.neck,
      _q.setFromAxisAngle(right, HERO.PRONE_NECK_LIFT * t),
    );

    this.crawlPhase +=
      ((p.getSpeed() * delta) / HERO.CRAWL_STRIDE_M) * Math.PI * 2;
    const s = Math.sin(this.crawlPhase);
    for (const leg of this.legs) {
      // Left leg draws up on the positive half of the cycle, right on the other.
      const amount = Math.max(0, leg.out < 0 ? s : -s) * t;
      if (amount < 1e-3) continue;
      rotateWorld(
        leg.thigh,
        _q.setFromAxisAngle(UP, leg.out * HERO.CRAWL_HIP_OUT * amount),
      );
      // Shin folds back toward the body, staying flat on the ground.
      rotateWorld(
        leg.calf,
        _q.setFromAxisAngle(UP, -leg.out * HERO.CRAWL_KNEE_BEND * amount),
      );
    }
  }

  private updateAnimation(): void {
    const p = this.player;
    const hero = this.hero;
    const speed = p.getSpeed();
    const moving = speed > HERO.MOVE_ANIM_MIN_SPEED;

    // Special moves own the whole body.
    if (p.move === 'mantle') {
      if (this.lastMove !== 'mantle') {
        hero.playOnce('ClimbUp_1m');
        hero.current!.timeScale =
          hero.current!.getClip().duration / MANTLE.DURATION_S;
      }
      this.lastMove = p.move;
      return;
    }
    if (p.move === 'roll') {
      if (this.lastMove !== 'roll') hero.playOnce('Roll');
      this.lastMove = p.move;
      return;
    }
    if (p.move === 'slide') {
      const start = hero.actions.Slide_Start;
      if (this.lastMove !== 'slide') hero.playOnce('Slide_Start');
      else if (hero.current === start && !start.isRunning())
        hero.play('Slide_Loop', HERO.FADE_FAST_S);
      this.lastMove = p.move;
      return;
    }
    if (this.lastMove === 'slide') hero.playOnce('Slide_Exit');
    this.lastMove = p.move;

    // Let short one-shots finish; moving cuts them short (except the climb).
    const busy: HeroClip[] = ['Slide_Exit', 'Jump_Land', 'Roll', 'ClimbUp_1m'];
    if (
      busy.some((c) => hero.isRunning(c)) &&
      (!moving || hero.isRunning('ClimbUp_1m'))
    )
      return;

    if (!p.onGround) {
      hero.play('Jump_Loop', HERO.FADE_FAST_S);
      return;
    }
    if (p.justLanded && !moving) {
      hero.playOnce('Jump_Land');
      hero.current!.timeScale = HERO.LAND_TIME_SCALE;
      return;
    }

    let clip: HeroClip;
    let rate = 1;
    // Clips play at 1x like erangel-run (speeds come from their strides);
    // they only slow down while the body is still accelerating.
    const at = (clipSpeed: number) => Math.min(1, speed / clipSpeed);
    if (p.stance === 'prone') {
      clip = 'Idle_Loop'; // straight-legged body, laid down by layProne()
    } else if (p.stance === 'crouch') {
      clip = moving ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop';
      if (moving) rate = at(HERO.CROUCH_CLIP_SPEED);
    } else if (!moving) {
      clip = 'Idle_Loop';
    } else if (p.isSprinting) {
      clip = 'Sprint_Loop';
      rate = at(HERO.SPRINT_CLIP_SPEED);
    } else {
      clip = 'Walk_Loop';
      rate = at(HERO.WALK_CLIP_SPEED);
    }
    // The body faces the camera, so moving backwards plays the loop in
    // reverse (backpedal) instead of walking forward while sliding back.
    const fwdX = -Math.sin(p.facingYaw);
    const fwdZ = -Math.cos(p.facingYaw);
    if (moving && p.velocity.x * fwdX + p.velocity.z * fwdZ < 0) rate = -rate;
    hero.play(clip).timeScale = rate;
  }
}
