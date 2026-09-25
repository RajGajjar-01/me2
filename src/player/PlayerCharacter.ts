import * as THREE from 'three';
import { type Arm, rotateWorld, solveArm } from '../character/armIK';
import { Hero, type HeroAssets } from '../character/HeroModel';
import {
  GUN_GRIPS,
  GUN_HOLD,
  HERO,
  type HeroClip,
} from '../constants/character';
import { MANTLE } from '../constants/player';
import type { WeaponRig } from '../weapons/WeaponModels';
import type { PlayerController } from './PlayerController';

const tuple = (t: readonly number[]) => new THREE.Vector3(t[0], t[1], t[2]);

// Scratch objects (no allocation per frame).
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _tR = new THREE.Vector3();
const _tL = new THREE.Vector3();
const _gunPos = new THREE.Vector3();
const _anchor = new THREE.Vector3();
const _poleR = new THREE.Vector3();
const _poleL = new THREE.Vector3();
const _qAim = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

interface TppGun {
  group: THREE.Group;
  rightGrip: THREE.Vector3;
  leftGrip: THREE.Vector3;
  muzzle: THREE.Object3D;
}

/**
 * The player's own body: the erangel-run hero, animated from the controller's
 * movement state, holding the current weapon with two-hand IK. Visible in
 * third-person; in first-person it only casts the shadow.
 */
export class PlayerCharacter {
  public readonly hero: Hero;
  private guns: TppGun[];
  private arms: { right: Arm; left: Arm };
  private chest: THREE.Object3D;
  private handR: THREE.Object3D;
  private ikWeight = 1;
  private handToGun = new THREE.Matrix4();
  private hasHandToGun = false;
  private lastMove = 'normal';
  private savedArmQuats = new Map<THREE.Object3D, THREE.Quaternion>();
  private static readonly ANCHOR = tuple(GUN_HOLD.RIGHT_HAND_ANCHOR);
  private static readonly POLE_RIGHT = tuple(GUN_HOLD.POLE_RIGHT);
  private static readonly POLE_LEFT = tuple(GUN_HOLD.POLE_LEFT);

  constructor(
    scene: THREE.Scene,
    private player: PlayerController,
    assets: HeroAssets,
    rigs: readonly WeaponRig[],
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
    this.handR = this.arms.right.hand;

    // Third-person guns: the viewmodel gun meshes without the FPV hands/flash.
    this.guns = rigs.map((rig, i) => {
      const group = rig.root.clone(true);
      const strip = [rig.leftArm, rig.rightArm, rig.muzzleFlash].map((o) =>
        rig.root.children.indexOf(o),
      );
      group.remove(...strip.map((idx) => group.children[idx]));
      group.position.set(0, 0, 0);
      group.rotation.set(0, 0, 0);
      group.visible = false;
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = true;
      });
      const grip = GUN_GRIPS[i];
      const muzzle = new THREE.Object3D();
      muzzle.position.copy(tuple(grip.MUZZLE));
      group.add(muzzle);
      scene.add(group);
      return {
        group,
        rightGrip: tuple(grip.RIGHT),
        leftGrip: tuple(grip.LEFT),
        muzzle,
      };
    });
  }

  /** Muzzle of the third-person gun (tracers start here in TPP). */
  public muzzle(weaponIndex: number): THREE.Object3D {
    return this.guns[weaponIndex].muzzle;
  }

  public update(delta: number, weaponIndex: number, aiming: boolean): void {
    const p = this.player;
    const tpp = p.viewMode === 'tpp';
    this.hero.setHidden(!tpp);

    const root = this.hero.root;
    root.position.set(
      p.capsulePosition.x,
      p.capsulePosition.y - p.radius,
      p.capsulePosition.z,
    );
    root.rotation.y = p.facingYaw;

    this.updateAnimation();
    this.hero.update(delta);
    // Swim_Fwd_Loop (prone crawl) is authored below the rig's zero.
    this.hero.model.position.y =
      this.hero.current === this.hero.actions.Swim_Fwd_Loop
        ? HERO.PRONE_LIFT_M
        : 0;
    root.updateMatrixWorld(true);

    const holdsGun = p.move === 'normal';
    const k = Math.min(1, delta * GUN_HOLD.IK_BLEND_PER_S);
    this.ikWeight += ((holdsGun ? 1 : 0) - this.ikWeight) * k;

    this.guns.forEach((g, i) => {
      g.group.visible = tpp && i === weaponIndex;
    });
    this.holdGun(this.guns[weaponIndex], aiming || !tpp);
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
    if (p.stance === 'prone') {
      clip = 'Swim_Fwd_Loop';
      rate = speed / HERO.PRONE_CLIP_SPEED; // 0 when still: frozen crawl pose
    } else if (p.stance === 'crouch') {
      clip = moving ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop';
      if (moving) rate = speed / HERO.CROUCH_CLIP_SPEED;
    } else if (!moving) {
      clip = 'Idle_Loop';
    } else if (p.isSprinting) {
      clip = 'Sprint_Loop';
      rate = speed / HERO.SPRINT_CLIP_SPEED;
    } else {
      clip = 'Walk_Loop';
      rate = speed / HERO.WALK_CLIP_SPEED;
    }
    hero.play(clip).timeScale = rate;
  }

  /**
   * Places the gun in the aim frame (carried low unless aiming) and pulls
   * both hands onto its grips. Special moves blend the IK out and the gun
   * rides on the right hand instead.
   */
  private holdGun(gun: TppGun, aiming: boolean): void {
    const p = this.player;
    const w = this.ikWeight;
    const pitch = aiming
      ? p.pitch
      : p.isSprinting
        ? GUN_HOLD.SPRINT_PITCH
        : GUN_HOLD.LOWERED_PITCH;

    _qYaw.setFromAxisAngle(UP, p.facingYaw);
    _euler.set(pitch, p.facingYaw, 0);
    _qAim.setFromEuler(_euler);

    if (w > 1e-3) {
      // Bend the upper spine with the aim so the shoulders follow.
      const right = _b.copy(RIGHT).applyQuaternion(_qYaw);
      _q.setFromAxisAngle(right, pitch * GUN_HOLD.SPINE_PITCH_SHARE * w);
      rotateWorld(this.chest, _q);
    }

    // Gun pose from the chest: the right-hand grip lands on the anchor.
    this.chest.getWorldPosition(_pos);
    const anchor = _anchor
      .copy(PlayerCharacter.ANCHOR)
      .applyQuaternion(_qAim)
      .add(_pos);
    const gunPos = _gunPos
      .copy(gun.rightGrip)
      .applyQuaternion(_qAim)
      .negate()
      .add(anchor);

    if (w >= 0.999 || !this.hasHandToGun) {
      gun.group.position.copy(gunPos);
      gun.group.quaternion.copy(_qAim);
    } else {
      // Blend toward "gun rides the right hand" during rolls/slides/climbs.
      _m.multiplyMatrices(this.handR.matrixWorld, this.handToGun);
      _m.decompose(_c, _quat, _scale);
      gun.group.position.copy(_c).lerp(gunPos, w);
      gun.group.quaternion.copy(_quat).slerp(_qAim, w);
    }
    gun.group.updateMatrixWorld(true);

    if (w > 1e-3) {
      const targetR = _tR
        .copy(gun.rightGrip)
        .applyMatrix4(gun.group.matrixWorld);
      const targetL = _tL
        .copy(gun.leftGrip)
        .applyMatrix4(gun.group.matrixWorld);
      const poleR = _poleR
        .copy(PlayerCharacter.POLE_RIGHT)
        .applyQuaternion(_qYaw);
      const poleL = _poleL
        .copy(PlayerCharacter.POLE_LEFT)
        .applyQuaternion(_qYaw);

      const { right, left } = this.arms;
      const bones = [right.upper, right.lower, left.upper, left.lower];
      if (w < 0.999) for (const bone of bones) this.saveQuat(bone);
      solveArm(right, targetR, poleR);
      solveArm(left, targetL, poleL);
      if (w < 0.999) {
        for (const bone of bones) {
          _q.copy(bone.quaternion); // IK result
          bone.quaternion.copy(this.savedArmQuats.get(bone)!).slerp(_q, w);
        }
        this.chest.updateMatrixWorld(true);
      }
    }

    if (w >= 0.999) {
      // Remember the gun relative to the hand for the next special move.
      this.handToGun
        .copy(this.handR.matrixWorld)
        .invert()
        .multiply(gun.group.matrixWorld);
      this.hasHandToGun = true;
    }
  }

  private saveQuat(bone: THREE.Object3D): void {
    let q = this.savedArmQuats.get(bone);
    if (!q) {
      q = new THREE.Quaternion();
      this.savedArmQuats.set(bone, q);
    }
    q.copy(bone.quaternion);
  }
}
