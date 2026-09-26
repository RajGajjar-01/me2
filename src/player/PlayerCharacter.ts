import * as THREE from 'three';
import {
  type Arm,
  elbowHinge,
  rotateWorld,
  solveArm,
} from '../character/armIK';
import { Hero, type HeroAssets } from '../character/HeroModel';
import {
  ERANGEL_PISTOL,
  FISTS,
  GUN_HOLD,
  HERO,
  type HeroClip,
  MOVES,
} from '../constants/character';
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
const _m2 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _f = new THREE.Vector3();
const _n = new THREE.Vector3();
const _gunQ = new THREE.Quaternion();
const _basis = new THREE.Matrix4();
const _fa = new THREE.Vector3();
const _fb = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _fq = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _twist = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

/** How a hand grips: desired finger/palm directions in the gun frame, plus
 * the hand bone's own rest-pose finger/palm basis (hand-local). */
const FINGERS = ['index', 'middle', 'ring', 'pinky', 'thumb'] as const;

interface HandGrip {
  fingers: THREE.Vector3;
  palm: THREE.Vector3;
  /** Third-person pose (support hand cups the handguard). */
  tppFingers: THREE.Vector3;
  tppPalm: THREE.Vector3;
  localBasis: THREE.Matrix4;
  side: 'r' | 'l';
  /** Elbow bend axis (upper-arm space), measured once from the clip. */
  hinge: THREE.Vector3 | null;
  /** Per finger: joints 01..03 plus the tip, and each joint's rest rotation. */
  fingers3: {
    name: (typeof FINGERS)[number];
    joints: THREE.Object3D[];
    tip: THREE.Object3D;
    rest: THREE.Quaternion[];
  }[];
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
  /** Pistols: hand-local -> gun transform, as erangel-run attaches it. */
  handFit: THREE.Matrix4 | null;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  muzzle: THREE.Object3D;
  /** Back of the stock on the bore line (gun space). */
  butt: THREE.Vector3;
  /** Third-person left grip minus the viewmodel's (gun space). */
  leftShift: THREE.Vector3;
}

/**
 * The player's own body: the erangel-run hero, animated from the controller's
 * movement state, both hands IK'd onto the current gun's grips.
 * - First-person: camera sits at the hero's eyes (head collapsed), hands
 *   hold the camera-attached viewmodel gun.
 * - Third-person: a copy of the gun takes the viewmodel's exact pose relative
 *   to the hero's eyes (hip/ADS offset, recoil, sway, reload), moved so the
 *   stock rests in the right shoulder.
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
  private shotPending = false;
  private punchPending = false;
  private nextPunchCross = false;
  /** Hidden while looking through a scope (the body would block the lens). */
  public hidden = false;
  private wasReloading = false;
  /** Third-person carry pitch (rad) or null when the gun is up on target. */
  private carry: number | null = null;
  /** 0 standing .. 1 lying face-down. */
  private proneT = 0;
  private crawlPhase = 0;
  private neck: THREE.Object3D;
  private legs: {
    thigh: THREE.Object3D;
    calf: THREE.Object3D;
    foot: THREE.Object3D;
    out: number;
  }[];
  private handToGun = new THREE.Matrix4();
  private hasHandToGun = false;
  private lastMove = 'normal';
  private rollHeadInv: THREE.Quaternion | null = null;
  /** Long gun rides the hand (TPP, or a first-person roll blending out). */
  public rollGun = false;
  private static readonly POLE_RIGHT = tuple(GUN_HOLD.POLE_RIGHT);
  private static readonly POLE_LEFT = tuple(GUN_HOLD.POLE_LEFT);
  private static readonly EYE = tuple(HERO.FPV_EYE_OFFSET);
  private static readonly LOW_READY = tuple(GUN_HOLD.LOW_READY_OFFSET);
  private static readonly POCKET = tuple(GUN_HOLD.SHOULDER_POCKET_M);
  /** Right shoulder joint in chest space (ignores the clip's shrugs). */
  private shoulder: THREE.Vector3;
  /** Shoulder pocket in hero-root space, damped against stride bob. */
  private pocket = new THREE.Vector3();
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
      { thigh: b('thigh_l'), calf: b('calf_l'), foot: b('foot_l'), out: -1 },
      { thigh: b('thigh_r'), calf: b('calf_r'), foot: b('foot_r'), out: 1 },
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
      ...this.legs.flatMap((l) => [l.thigh, l.calf, l.foot]),
    ];
    this.hero.model.updateMatrixWorld(true);
    this.shoulder = this.chest.worldToLocal(
      right.upper.getWorldPosition(new THREE.Vector3()),
    );
    this.grips = {
      right: this.handGrip('r', GUN_HOLD.RIGHT_FINGERS, GUN_HOLD.RIGHT_PALM),
      left: this.handGrip(
        'l',
        GUN_HOLD.LEFT_FINGERS,
        GUN_HOLD.LEFT_PALM,
        GUN_HOLD.TPP_LEFT_FINGERS,
        GUN_HOLD.TPP_LEFT_PALM,
      ),
    };
    // Finger joints too: our grip must not stick when the clip takes back
    // over (the mixer only rewrites values that changed).
    for (const g of [this.grips.right, this.grips.left]) {
      for (const f of g.fingers3) this.edited.push(...f.joints);
    }

    this.guns = rigs.map((rig, i) => {
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
      group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(group);
      const butt = box.isEmpty()
        ? new THREE.Vector3()
        : new THREE.Vector3(0, rig.muzzlePos.y, box.max.z);
      const def = GUN_MODELS[i];
      const leftShift =
        'TPP_LEFT_GRIP_MODEL' in def
          ? tuple(def.TPP_LEFT_GRIP_MODEL)
              .applyMatrix4(group.children[0].matrix)
              .sub(rig.leftArmBase)
          : new THREE.Vector3();
      const muzzle = new THREE.Object3D();
      muzzle.position.copy(rig.muzzlePos);
      group.add(muzzle);
      scene.add(group);
      return {
        group,
        leftArm,
        rightArm,
        muzzle,
        butt,
        leftShift,
        handFit: GUN_MODELS[i].PISTOL_CLIPS
          ? PlayerCharacter.pistolFit(group)
          : null,
      };
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
    tppFingers = fingers,
    tppPalm = palm,
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
    const fingers3 = FINGERS.map((name) => {
      const joints = [1, 2, 3].map((j) =>
        this.hero.bone(`${name}_0${j}_${side}`),
      );
      return {
        name,
        joints,
        tip: this.hero.bone(`${name}_04_leaf_${side}`),
        rest: joints.map((b) => b.quaternion.clone()),
      };
    });
    return {
      fingers: tuple(fingers).normalize(),
      palm: tuple(palm).normalize(),
      tppFingers: tuple(tppFingers).normalize(),
      tppPalm: tuple(tppPalm).normalize(),
      localBasis: basisFrom(f, n, new THREE.Matrix4()).clone(),
      side,
      hinge: null,
      fingers3,
    };
  }

  /**
   * erangel-run's attachPistol: grip point (16% along from the back, 22% up
   * the bounds) onto the origin, GUN_FIT nudge, turned +90deg about X, then
   * offset in the hand bone's frame.
   */
  private static pistolFit(group: THREE.Group): THREE.Matrix4 {
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const grip = new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      box.min.y + size.y * ERANGEL_PISTOL.GRIP_UP,
      box.max.z - size.z * ERANGEL_PISTOL.GRIP_ALONG, // barrel is -Z, back is +Z
    );
    const [ox, oy, oz] = ERANGEL_PISTOL.HAND_OFFSET;
    const [fx, fy, fz] = ERANGEL_PISTOL.FIT;
    return new THREE.Matrix4()
      .makeTranslation(ox, oy, oz)
      .multiply(new THREE.Matrix4().makeRotationX(ERANGEL_PISTOL.HAND_ROT_X))
      .multiply(new THREE.Matrix4().makeTranslation(fx, fy, fz))
      .multiply(new THREE.Matrix4().makeTranslation(-grip.x, -grip.y, -grip.z));
  }

  /** Fists: throw the next punch (jab, cross, jab, ...). */
  public onPunch(): void {
    this.punchPending = true;
  }

  /** Called when the current gun fires (pistol plays its shoot clip). */
  public onShot(): void {
    this.shotPending = true;
  }

  /** Muzzle of the third-person gun (tracers start here in TPP). */
  public muzzle(weaponIndex: number): THREE.Object3D {
    return this.guns[weaponIndex].muzzle;
  }

  public update(delta: number, weaponIndex: number, reloading: boolean): void {
    const p = this.player;
    const tpp = p.viewMode === 'tpp';
    const pistol = GUN_MODELS[weaponIndex].PISTOL_CLIPS;
    const fists = 'FISTS' in GUN_MODELS[weaponIndex];
    this.head.scale.setScalar(tpp ? 1 : HERO.FPV_HEAD_SCALE);

    const root = this.hero.root;
    root.visible = !this.hidden;
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
    this.updateAnimation(pistol, fists, reloading);
    this.hero.update(delta);
    for (const bone of this.edited) {
      const q = this.animPose.get(bone);
      if (q) q.copy(bone.quaternion);
      else this.animPose.set(bone, bone.quaternion.clone());
    }
    _qYaw.setFromAxisAngle(UP, p.facingYaw);
    this.layProne(delta);
    root.updateMatrixWorld(true);

    const k = Math.min(1, delta * GUN_HOLD.IK_BLEND_PER_S);
    // Third-person: hands leave the IK during special moves (the arms run
    // the clip and the gun rides the right hand). First-person keeps both
    // hands on the camera-held gun through slides/rolls/climbs. Pistols never
    // use IK: erangel-run's pistol clips pose the arms.
    this.rollGun =
      !tpp && (p.move === 'roll' || (this.rollGun && this.ikWeight < 0.999));
    const bodyGun = tpp || this.rollGun;
    const holdsGun =
      (p.move === 'normal' || !bodyGun) && !pistol && !fists ? 1 : 0;
    this.ikWeight += (holdsGun - this.ikWeight) * k;
    const w = this.ikWeight;

    // The aim frame always follows the crosshair; the third-person carry
    // (low-ready / sprint) is applied later by pivoting the gun at the hand.
    const pitch = p.pitch;
    this.carry =
      tpp && !p.aimLock && !pistol
        ? p.isSprinting
          ? GUN_HOLD.SPRINT_PITCH
          : GUN_HOLD.LOW_READY_PITCH
        : null;
    _euler.set(pitch, p.facingYaw, 0);
    _qAim.setFromEuler(_euler);

    if (w > 1e-3) {
      // Rifle stance: twist the torso (left shoulder forward) and bend the
      // upper spine with the aim so the shoulders follow the gun.
      const twist =
        GUN_MODELS[weaponIndex].TWIST *
        w *
        (tpp ? GUN_HOLD.TPP_TWIST_SCALE : 1);
      // Twist about the spine's own axis, not world up: with the sprint
      // clip's forward lean, a world-up turn swings the torso sideways.
      rotateWorld(
        this.chest,
        _q.setFromAxisAngle(this.boneAxis(this.chest, this.neck), twist),
      );
      // Counter-turn the neck (about its own axis) so the face stays on aim.
      rotateWorld(
        this.neck,
        _q.setFromAxisAngle(this.boneAxis(this.neck, this.head), -twist),
      );
      const right = _b.copy(RIGHT).applyQuaternion(_qYaw);
      _q.setFromAxisAngle(right, pitch * GUN_HOLD.SPINE_PITCH_SHARE * w);
      rotateWorld(this.chest, _q);
    }

    // The pistol is the body's own in both views; long guns use the
    // camera-attached viewmodel in first-person.
    this.guns.forEach((g, i) => {
      g.group.visible =
        (bodyGun || pistol) && i === weaponIndex && !this.hidden;
    });

    const rig = this.rigs[weaponIndex];
    this.eyePoint(_eye);
    root.worldToLocal(this.chest.localToWorld(_c.copy(this.shoulder)));
    this.pocket.lerp(
      _c.add(PlayerCharacter.POCKET),
      Math.min(1, delta * GUN_HOLD.SHOULDER_DAMP_PER_S),
    );
    if (!tpp) {
      // First-person: camera at the eyes (position only; aim stays). The
      // viewmodel is its child, so update it before the IK reads the grips.
      p.camera.position.copy(_eye);
      this.followRollSpin();
      p.camera.updateMatrixWorld(true);
    }
    if (pistol) {
      const gun = this.guns[weaponIndex];
      this.handR.matrixWorld.decompose(_b, _quat, _scale);
      _m.compose(_b, _quat, _one); // hand frame without the rig's bone scale
      gun.group.matrix.multiplyMatrices(_m, gun.handFit!);
      gun.group.updateMatrixWorld(true);
    } else if (bodyGun) {
      const gun = this.guns[weaponIndex];
      // Mirror the viewmodel's reload choreography onto the TPP hands.
      gun.leftArm.position.copy(rig.leftArm.position).add(gun.leftShift);
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
      this.reachFor(gripOf(rig.rightArm), gripOf(rig.leftArm), rig.root);
      if (w >= 0.999) {
        this.handToGun
          .copy(this.handR.matrixWorld)
          .invert()
          .multiply(rig.root.matrixWorld);
        this.hasHandToGun = true;
      }
    }
  }

  /**
   * Twist axis for a spine bone: its own long axis while upright (a world-up
   * turn would swing a forward-leaning sprint torso sideways), blending to
   * world up when lying prone (a spine-axis turn there would roll the body).
   */
  private boneAxis(from: THREE.Object3D, to: THREE.Object3D): THREE.Vector3 {
    from.getWorldPosition(_fa);
    return to
      .getWorldPosition(_axis)
      .sub(_fa)
      .normalize()
      .lerp(UP, this.proneT)
      .normalize();
  }

  /** First-person roll: the camera tumbles with the head. */
  private followRollSpin(): void {
    const p = this.player;
    if (p.move !== 'roll') {
      this.rollHeadInv = null;
      return;
    }
    this.head.getWorldQuaternion(_fq);
    this.rollHeadInv ??= _fq.clone().invert();
    _fq.multiply(this.rollHeadInv);
    const w = Math.min(
      1,
      (MOVES.ROLL_DURATION_S - p.moveTime) / MOVES.ROLL_CAM_FADE_S,
    );
    p.camera.quaternion.premultiply(_q.identity().slerp(_fq, Math.max(0, w)));
  }

  private eyePoint(out: THREE.Vector3): THREE.Vector3 {
    this.head.getWorldPosition(out);
    return out.add(_c.copy(PlayerCharacter.EYE).applyQuaternion(_qYaw));
  }

  /**
   * TPP gun = eye frame (aim) x viewmodel container x rig root, i.e. exactly
   * where the first-person gun would be; third-person then slides it so the
   * butt sits in the right shoulder. Special moves blend toward the gun
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
    const p = this.player;
    if (p.viewMode === 'tpp') {
      // Shoulder the gun: slide it so the butt lands in the pocket, then
      // turn it about the butt.
      const butt = _b.copy(gun.butt).applyMatrix4(_mGun);
      const pocket = _c
        .copy(this.pocket)
        .applyMatrix4(this.hero.root.matrixWorld);
      _mGun.premultiply(
        _m2.makeTranslation(
          pocket.x - butt.x,
          pocket.y - butt.y,
          pocket.z - butt.z,
        ),
      );
      if (this.carry === null) {
        // Aim: the bore converges on the crosshair point.
        const bore = _f
          .copy(gun.muzzle.position)
          .applyMatrix4(_mGun)
          .sub(pocket)
          .normalize();
        const want = _b
          .set(0, 0, -GUN_HOLD.TPP_CONVERGE_M)
          .applyQuaternion(_q.setFromEuler(_euler.set(p.pitch, p.yaw, 0)))
          .add(p.camera.position)
          .sub(pocket)
          .normalize();
        _quat.setFromUnitVectors(bore, want);
      } else {
        // Low-ready: muzzle down and across the body.
        const right = _b.set(1, 0, 0).applyQuaternion(_qYaw);
        _quat
          .setFromAxisAngle(UP, GUN_HOLD.LOW_READY_YAW)
          .multiply(_q.setFromAxisAngle(right, this.carry - p.pitch));
      }
      _mGun
        .premultiply(_m2.makeTranslation(-pocket.x, -pocket.y, -pocket.z))
        .premultiply(_m.makeRotationFromQuaternion(_quat))
        .premultiply(_m2.makeTranslation(pocket.x, pocket.y, pocket.z));
      if (this.carry !== null) {
        const drop = _b.copy(PlayerCharacter.LOW_READY).applyQuaternion(_qYaw);
        _mGun.premultiply(_m2.makeTranslation(drop.x, drop.y, drop.z));
      }
    }

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
    this.blendArm(right, w);
    this.gripHand(left, this.grips.left, leftGrip.getWorldPosition(_tL), poleL);
    this.blendArm(left, w);
  }

  /** Blend an IK'd arm back toward its animated pose (e.g. mid-roll). */
  private blendArm(arm: Arm, w: number): void {
    if (w >= 0.999) return;
    for (const bone of [arm.upper, arm.lower, arm.hand]) {
      _q.copy(bone.quaternion); // IK result
      bone.quaternion.copy(this.animPose.get(bone)!).slerp(_q, w);
    }
    arm.upper.updateMatrixWorld(true);
  }

  private gripHand(
    arm: Arm,
    grip: HandGrip,
    gripPos: THREE.Vector3,
    pole: THREE.Vector3,
  ): void {
    const tpp = this.player.viewMode === 'tpp';
    const fingers = _b
      .copy(tpp ? grip.tppFingers : grip.fingers)
      .applyQuaternion(_gunQ);
    const palm = _eye
      .copy(tpp ? grip.tppPalm : grip.palm)
      .applyQuaternion(_gunQ);
    // Palm centre sits on the grip surface; the wrist is behind it.
    const wrist = gripPos
      .addScaledVector(palm, -GUN_HOLD.GRIP_RADIUS_M)
      .addScaledVector(fingers, -GUN_HOLD.PALM_REACH_M);
    // Third-person: bend the elbow about its hinge so the upper arm takes
    // its natural roll (no sideways-twisted elbow / ballooned shoulder).
    if (tpp) {
      grip.hinge ??= elbowHinge(arm, GUN_HOLD.HINGE_MIN_BEND_SIN);
      solveArm(arm, wrist, pole, grip.hinge);
    } else solveArm(arm, wrist, pole);

    // World rotation taking the hand's rest basis onto the wanted one.
    basisFrom(fingers, palm, _basis).multiply(
      _m.copy(grip.localBasis).transpose(),
    );
    _quat.setFromRotationMatrix(_basis);

    // Swing-twist: move most of the roll about the forearm axis into the
    // forearm itself (turning it about its own axis keeps the wrist in place).
    arm.hand.getWorldQuaternion(_qc);
    _q.copy(_quat).multiply(_qc.invert()); // world delta current -> wanted
    arm.lower.getWorldPosition(_fa);
    const axis = arm.hand.getWorldPosition(_fb).sub(_fa).normalize();
    const proj = axis.dot(_axis.set(_q.x, _q.y, _q.z));
    _twist.set(axis.x * proj, axis.y * proj, axis.z * proj, _q.w).normalize();
    rotateWorld(
      arm.lower,
      _fq.identity().slerp(_twist, GUN_HOLD.FOREARM_TWIST_SHARE),
    );

    arm.hand.parent!.getWorldQuaternion(_q).invert();
    arm.hand.quaternion.copy(_q.multiply(_quat));
    arm.hand.updateMatrixWorld(true);
    this.curlFingers(grip, palm);
  }

  /**
   * Wrap the fingers around the gun: start from the straight rest pose and
   * curl each joint toward the palm (axis = finger x palm normal).
   */
  private curlFingers(grip: HandGrip, palm: THREE.Vector3): void {
    const curls = GUN_HOLD.FINGER_CURL[grip.side];
    for (const f of grip.fingers3) {
      f.joints.forEach((j, i) => {
        j.quaternion.copy(f.rest[i]);
      });
      f.joints[0].updateMatrixWorld(true);
      f.joints.forEach((joint, i) => {
        const next = f.joints[i + 1] ?? f.tip;
        joint.getWorldPosition(_fa);
        next.getWorldPosition(_fb).sub(_fa);
        _axis.crossVectors(_fb, palm).normalize();
        rotateWorld(joint, _fq.setFromAxisAngle(_axis, curls[f.name][i]));
      });
    }
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
    // Straighten both legs back along the ground: the idle clip stands with
    // a bent, weight-shifted knee that would stick up in the air when lying.
    for (const leg of this.legs) {
      this.alignBone(leg.thigh, leg.calf, leg.out, t);
      this.alignBone(leg.calf, leg.foot, leg.out, t);
    }
    // Feet point back (toes down -> toes behind): -angle about `right`.
    for (const leg of this.legs) {
      rotateWorld(
        leg.foot,
        _q.setFromAxisAngle(right, -HERO.PRONE_FOOT_POINT * t),
      );
    }

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

  /**
   * Turn `bone` so the segment to `child` lies back along the ground behind
   * the prone body (slightly splayed by `side`, dropping toward the floor).
   */
  private alignBone(
    bone: THREE.Object3D,
    child: THREE.Object3D,
    side: number,
    t: number,
  ): void {
    bone.getWorldPosition(_tR);
    const current = child.getWorldPosition(_tL).sub(_tR).normalize();
    const [x, y, z] = HERO.PRONE_LEG_DIR;
    const want = _c
      .set(x * side, y, z)
      .normalize()
      .applyQuaternion(_qYaw);
    _q.setFromUnitVectors(current, want);
    rotateWorld(bone, _quat.identity().slerp(_q, t));
  }

  private updateAnimation(
    pistol: boolean,
    fists: boolean,
    reloading: boolean,
  ): void {
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

    // erangel-run pistol: shoot / reload one-shots own the body until done.
    const reloadStarted = reloading && !this.wasReloading;
    this.wasReloading = reloading;
    const shot = this.shotPending;
    this.shotPending = false;
    const punch = this.punchPending;
    this.punchPending = false;
    if (fists) {
      if (punch) {
        hero.playOnce(
          this.nextPunchCross ? 'Punch_Cross' : 'Punch_Jab',
          FISTS.PUNCH_FADE_S,
        );
        this.nextPunchCross = !this.nextPunchCross;
      }
      if (hero.isRunning('Punch_Jab') || hero.isRunning('Punch_Cross')) return;
    }
    if (pistol) {
      if (reloadStarted)
        hero.playOnce('Pistol_Reload', ERANGEL_PISTOL.RELOAD_FADE_S);
      else if (shot) hero.playOnce('Pistol_Shoot', ERANGEL_PISTOL.SHOOT_FADE_S);
      if (hero.isRunning('Pistol_Reload') || hero.isRunning('Pistol_Shoot'))
        return;
    }

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
    } else if (pistol && p.aimLock) {
      clip = 'Pistol_Aim_Neutral'; // erangel-run: aiming overrides moving
    } else if (pistol && !moving) {
      clip = 'Pistol_Idle_Loop';
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
