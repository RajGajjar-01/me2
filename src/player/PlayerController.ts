import * as THREE from 'three';
import type { MeshBVH } from 'three-mesh-bvh';
import { HERO, MOVES, TPP_CAMERA } from '../constants/character';
import { INPUT } from '../constants/input';
import type { Stance } from '../constants/player';
import {
  CAMERA,
  MANTLE,
  PLAYER,
  SPRINT_STRIDE_MULT,
  STANCES,
  STRIDE,
} from '../constants/player';
import type { InputManager } from '../core/InputManager';

export type ViewMode = 'fpv' | 'tpp';
/** Special moves that take over locomotion (drive the matching clip). */
export type MoveState = 'normal' | 'roll' | 'slide' | 'mantle';

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class PlayerController {
  public camera: THREE.PerspectiveCamera;
  public onGround = false;
  public velocity: THREE.Vector3 = new THREE.Vector3();
  public isSprinting = false;

  public radius: number = PLAYER.CAPSULE_RADIUS;
  public height: number = STANCES.stand.height;
  public eyeOffset: number = STANCES.stand.eyeOffset;
  public capsulePosition: THREE.Vector3 = new THREE.Vector3(
    0,
    PLAYER.CAPSULE_START_Y,
    PLAYER.CAPSULE_START_Z,
  );

  public viewMode: ViewMode = 'fpv';
  public move: MoveState = 'normal';
  /** Seconds since the current special move started. */
  public moveTime = 0;
  /** True for the frame the player touches down after real airtime. */
  public justLanded = false;
  /** World yaw the body faces (-Z forward at 0, like the camera). */
  public facingYaw = 0;
  /** Set by the game each frame: aiming or firing turns the body to the camera. */
  public aimLock = false;
  /** Set by the game each frame: hands busy (reloading) -> no sprint. */
  public sprintBlocked = false;

  private colliderLine: THREE.Line3 = new THREE.Line3();

  private tempBox: THREE.Box3 = new THREE.Box3();
  private point1: THREE.Vector3 = new THREE.Vector3();
  private point2: THREE.Vector3 = new THREE.Vector3();
  private tempNormal: THREE.Vector3 = new THREE.Vector3();
  private moveDir: THREE.Vector3 = new THREE.Vector3();
  private forward: THREE.Vector3 = new THREE.Vector3();
  private right: THREE.Vector3 = new THREE.Vector3();

  public pitch = 0;
  public yaw = 0;
  private freeYaw = 0;
  private freePitch = 0;

  private recoverPitch = 0;
  private recoverYaw = 0;
  private recoverHold = 0;

  public recoilRecovery: number = PLAYER.RECOIL_RECOVERY;

  private sprintSpeed: number = PLAYER.SPRINT_SPEED;
  private jumpForce: number = PLAYER.JUMP_FORCE;
  private gravity: number = PLAYER.GRAVITY;

  private static readonly STANCES = STANCES;
  public stance: Stance = 'stand';

  public bobTimer = 0;

  private static readonly STRIDE = STRIDE;

  private static readonly SPRINT_STRIDE = SPRINT_STRIDE_MULT;
  private strideAccum = 0;
  private airTime = 0;
  private lastAirTime = 0;

  public onFootstep?: (stance: Stance, isSprinting: boolean) => void;

  private static readonly MANTLE_MAX_HEIGHT = MANTLE.MAX_HEIGHT;
  private static readonly MANTLE_DURATION = MANTLE.DURATION_S;

  private static readonly MANTLE_MAX_WORLD_Y = MANTLE.MAX_WORLD_Y;
  public isMantling = false;
  private mantleTimer = 0;
  private mantleStartPos: THREE.Vector3 = new THREE.Vector3();
  private mantleEndPos: THREE.Vector3 = new THREE.Vector3();
  private mantleRay: THREE.Ray = new THREE.Ray();
  private mantleLine: THREE.Line3 = new THREE.Line3();

  private camRay: THREE.Ray = new THREE.Ray();
  private camPivot: THREE.Vector3 = new THREE.Vector3();
  private camBack: THREE.Vector3 = new THREE.Vector3();
  private camRight: THREE.Vector3 = new THREE.Vector3();
  private camEuler: THREE.Euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    fov = CAMERA.DEFAULT_FOV,
    aspect = window.innerWidth / window.innerHeight,
    private input: InputManager,
    private bvh: MeshBVH,
  ) {
    this.camera = new THREE.PerspectiveCamera(
      fov,
      aspect,
      CAMERA.NEAR,
      CAMERA.FAR,
    );
    this.updateCapsuleSegment();
    this.syncCamera(0);
  }

  private updateCapsuleSegment(): void {
    this.colliderLine.start.copy(this.capsulePosition);
    this.colliderLine.end
      .copy(this.capsulePosition)
      .setY(this.capsulePosition.y + this.height);
  }

  public update(delta: number): void {
    const mouse = this.input.consumeMouseDelta();
    // Free look (third-person): mouse orbits the camera, body keeps its aim.
    const freeLook =
      this.viewMode === 'tpp' && this.input.isAnyKeyDown(...INPUT.FREE_LOOK);
    if (freeLook) {
      this.freeYaw -= mouse.x;
      this.freePitch = THREE.MathUtils.clamp(
        this.freePitch - mouse.y,
        -TPP_CAMERA.FREE_LOOK_PITCH_LIMIT,
        TPP_CAMERA.FREE_LOOK_PITCH_LIMIT,
      );
    } else {
      this.yaw -= mouse.x;
      this.pitch -= mouse.y;
      const k = 1 - Math.exp(-TPP_CAMERA.FREE_LOOK_RETURN_PER_S * delta);
      this.freeYaw -= wrapAngle(this.freeYaw) * k;
      this.freePitch -= this.freePitch * k;
    }

    if (
      Math.abs(mouse.x) > PLAYER.MOUSE_RECENTER_EPS ||
      Math.abs(mouse.y) > PLAYER.MOUSE_RECENTER_EPS
    ) {
      this.recoverPitch = 0;
      this.recoverYaw = 0;
    }

    if (this.recoverHold > 0) {
      this.recoverHold -= delta;
    } else if (this.recoverPitch !== 0 || this.recoverYaw !== 0) {
      const k = 1 - Math.exp(-PLAYER.RECOVER_RATE * delta);
      const dp = this.recoverPitch * k;
      const dy = this.recoverYaw * k;
      this.pitch -= dp;
      this.yaw -= dy;
      this.recoverPitch -= dp;
      this.recoverYaw -= dy;
    }

    this.pitch = Math.max(
      -Math.PI / PLAYER.PITCH_LIMIT_DIVISOR,
      Math.min(Math.PI / PLAYER.PITCH_LIMIT_DIVISOR, this.pitch),
    );

    if (this.input.isKeyPressed(INPUT.VIEW_TOGGLE)) {
      this.viewMode = this.viewMode === 'fpv' ? 'tpp' : 'fpv';
      this.freeYaw = 0;
      this.freePitch = 0;
    }

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    this.forward.set(-sin, 0, -cos);
    this.right.set(cos, 0, -sin);

    this.moveDir.set(0, 0, 0);
    if (this.move === 'normal') {
      if (this.input.isAnyKeyDown(...INPUT.MOVE_FORWARD))
        this.moveDir.add(this.forward);
      if (this.input.isAnyKeyDown(...INPUT.MOVE_BACK))
        this.moveDir.sub(this.forward);
      if (this.input.isAnyKeyDown(...INPUT.MOVE_RIGHT))
        this.moveDir.add(this.right);
      if (this.input.isAnyKeyDown(...INPUT.MOVE_LEFT))
        this.moveDir.sub(this.right);
    }
    const isMoving = this.moveDir.lengthSq() > PLAYER.MOVE_EPS_SQ;
    if (isMoving) this.moveDir.normalize();

    // C / Z toggle crouch / prone; while sprinting they slide / roll instead.
    const wantsCrouch = this.input.isKeyPressed(INPUT.CROUCH_TOGGLE);
    const wantsProne = this.input.isKeyPressed(INPUT.PRONE_TOGGLE);
    if (this.move === 'normal') {
      if (this.isSprinting && this.onGround && (wantsCrouch || wantsProne)) {
        if (wantsCrouch) this.startSlide();
        else this.startMove('roll');
      } else {
        if (wantsCrouch)
          this.setStance(this.stance === 'crouch' ? 'stand' : 'crouch');
        if (wantsProne)
          this.setStance(this.stance === 'prone' ? 'stand' : 'prone');
      }
    }

    const target = PlayerController.STANCES[this.stance];
    const stanceK = 1 - Math.exp(-PLAYER.STANCE_BLEND_RATE * delta);
    this.height += (target.height - this.height) * stanceK;
    this.eyeOffset += (target.eyeOffset - this.eyeOffset) * stanceK;

    const wantsSprint = this.input.isAnyKeyDown(...INPUT.SPRINT);
    this.isSprinting =
      this.move === 'normal' &&
      wantsSprint &&
      this.onGround &&
      this.stance === 'stand' &&
      !this.aimLock &&
      !this.sprintBlocked;

    this.updateFacing(delta);
    this.updateVelocity(isMoving, delta);

    const spacePressed = this.input.isKeyPressed(INPUT.JUMP);
    if (this.move === 'normal') {
      if (this.stance !== 'stand') {
        if (spacePressed)
          this.setStance(this.stance === 'prone' ? 'crouch' : 'stand');
      } else {
        const wantsMantle =
          spacePressed || (!this.onGround && this.input.isKeyDown(INPUT.JUMP));
        if (wantsMantle) this.tryStartMantle();
        if (
          this.move === 'normal' &&
          this.onGround &&
          this.input.isKeyDown(INPUT.JUMP)
        ) {
          this.velocity.y = this.jumpForce;
          this.onGround = false;
        }
      }
    }

    const prevX = this.capsulePosition.x;
    const prevZ = this.capsulePosition.z;
    const wasOnGround = this.onGround;

    if (this.isMantling) {
      this.updateMantle(delta);
    } else {
      const subSteps = PLAYER.PHYSICS_SUBSTEPS;
      const subDelta = delta / subSteps;

      for (let s = 0; s < subSteps; s++) {
        this.velocity.y += this.gravity * subDelta;

        this.capsulePosition.x += this.velocity.x * subDelta;
        this.capsulePosition.y += this.velocity.y * subDelta;
        this.capsulePosition.z += this.velocity.z * subDelta;

        this.resolveCollision();
      }
    }

    this.airTime = this.onGround ? 0 : this.airTime + delta;
    this.justLanded =
      this.onGround &&
      !wasOnGround &&
      this.lastAirTime >= PLAYER.LANDING_MIN_AIR_S;
    this.lastAirTime = this.airTime;

    if (isMoving && this.onGround) {
      this.bobTimer +=
        delta *
        (this.isSprinting ? PLAYER.BOB_RATE_SPRINT : PLAYER.BOB_RATE_WALK);
    } else {
      this.bobTimer = 0;
    }

    if (this.onGround && !this.isMantling) {
      const dx = this.capsulePosition.x - prevX;
      const dz = this.capsulePosition.z - prevZ;
      this.strideAccum += Math.sqrt(dx * dx + dz * dz);
      const stride =
        PlayerController.STRIDE[this.stance] *
        (this.isSprinting ? PlayerController.SPRINT_STRIDE : 1);
      if (this.strideAccum >= stride) {
        this.strideAccum %= stride;
        this.onFootstep?.(this.stance, this.isSprinting);
      }
    } else {
      this.strideAccum = 0;
    }
    this.syncCamera(delta);
  }

  /** FPV / aiming: body faces the camera. TPP: body turns toward travel. */
  private updateFacing(delta: number): void {
    if (this.move !== 'normal') return;
    // First-person: the camera sits in the body, so it can't lag behind.
    if (this.viewMode === 'fpv') {
      this.facingYaw = this.yaw;
      return;
    }
    // Third-person: the body always faces where the camera looks (moving
    // backwards backpedals instead of turning round to face the camera).
    const target = this.yaw;
    const k = Math.min(1, delta * HERO.TURN_RATE_PER_S);
    this.facingYaw += wrapAngle(target - this.facingYaw) * k;
  }

  private updateVelocity(isMoving: boolean, delta: number): void {
    this.moveTime += delta;
    const fx = -Math.sin(this.facingYaw);
    const fz = -Math.cos(this.facingYaw);

    if (this.move === 'mantle') {
      this.velocity.set(0, 0, 0);
      return;
    }
    if (this.move === 'roll') {
      const speed = this.moveTime < MOVES.ROLL_MOVE_S ? MOVES.ROLL_SPEED : 0;
      this.velocity.x = fx * speed;
      this.velocity.z = fz * speed;
      if (this.moveTime >= MOVES.ROLL_DURATION_S) this.move = 'normal';
      return;
    }
    if (this.move === 'slide') {
      const decay = Math.exp(-MOVES.SLIDE_FRICTION_PER_S * delta);
      this.velocity.x *= decay;
      this.velocity.z *= decay;
      if (this.moveTime >= MOVES.SLIDE_DURATION_S) {
        this.move = 'normal';
        this.setStance('stand');
      }
      return;
    }

    const speed = this.isSprinting
      ? this.sprintSpeed
      : PlayerController.STANCES[this.stance].speed;
    const damping = this.onGround ? PLAYER.DAMPING_GROUND : PLAYER.DAMPING_AIR;
    const vx = isMoving ? this.moveDir.x * speed : 0;
    const vz = isMoving ? this.moveDir.z * speed : 0;
    this.velocity.x += (vx - this.velocity.x) * damping * delta;
    this.velocity.z += (vz - this.velocity.z) * damping * delta;
  }

  private startMove(move: MoveState): void {
    this.move = move;
    this.moveTime = 0;
    this.isSprinting = false;
  }

  private startSlide(): void {
    this.startMove('slide');
    this.stance = 'crouch';
    const fx = -Math.sin(this.facingYaw);
    const fz = -Math.cos(this.facingYaw);
    this.velocity.x = fx * this.sprintSpeed;
    this.velocity.z = fz * this.sprintSpeed;
  }

  private resolveCollision(): void {
    this.onGround = false;
    this.updateCapsuleSegment();

    this.tempBox.makeEmpty();
    this.tempBox.expandByPoint(this.colliderLine.start);
    this.tempBox.expandByPoint(this.colliderLine.end);
    this.tempBox.min.addScalar(-this.radius);
    this.tempBox.max.addScalar(this.radius);

    this.bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(this.tempBox),
      intersectsTriangle: (tri) => {
        const dist = (tri as any).closestPointToSegment(
          this.colliderLine,
          this.point1,
          this.point2,
        );

        if (dist < this.radius) {
          const depth = this.radius - dist;
          this.tempNormal.subVectors(this.point2, this.point1);

          if (this.tempNormal.lengthSq() > PLAYER.NORMAL_EPS_SQ) {
            this.tempNormal.normalize();
          } else {
            tri.getNormal(this.tempNormal);
          }

          this.capsulePosition.addScaledVector(this.tempNormal, depth);
          this.updateCapsuleSegment();

          if (this.tempNormal.y > PLAYER.GROUND_NORMAL_Y) {
            this.onGround = true;
          }

          const normalVel = this.velocity.dot(this.tempNormal);
          if (normalVel < 0) {
            this.velocity.addScaledVector(this.tempNormal, -normalVel);
          }
        }
      },
    });

    if (this.capsulePosition.y < PLAYER.COLLISION_GROUND_Y) {
      this.capsulePosition.y = PLAYER.COLLISION_GROUND_Y;
      this.velocity.y = 0;
      this.onGround = true;
    }
  }

  private tryStartMantle(): boolean {
    const feetY = this.capsulePosition.y - this.radius;
    const maxGrabY = feetY + PlayerController.MANTLE_MAX_HEIGHT;

    this.mantleRay.origin.set(
      this.capsulePosition.x,
      feetY + MANTLE.EYE_PROBE_HEIGHT,
      this.capsulePosition.z,
    );
    this.mantleRay.direction.copy(this.forward);
    const wallDist = this.radius + MANTLE.WALL_DIST_BONUS;
    const wallHit = this.bvh.raycastFirst(
      this.mantleRay,
      THREE.DoubleSide,
      0,
      wallDist,
    );
    if (!wallHit) return false;

    const lipX =
      wallHit.point.x + this.forward.x * (this.radius + MANTLE.LIP_PUSH);
    const lipZ =
      wallHit.point.z + this.forward.z * (this.radius + MANTLE.LIP_PUSH);
    const probeTop = maxGrabY + MANTLE.PROBE_TOP_BONUS;
    this.mantleRay.origin.set(lipX, probeTop, lipZ);
    this.mantleRay.direction.set(0, -1, 0);
    const downDist = probeTop - (feetY - MANTLE.PROBE_BOTTOM_SLACK);
    const downHit = this.bvh.raycastFirst(
      this.mantleRay,
      THREE.DoubleSide,
      0,
      downDist,
    );
    if (!downHit) return false;

    const ledgeY = downHit.point.y;
    if (ledgeY > maxGrabY + MANTLE.LEDGE_TOP_SLACK) return false;
    if (ledgeY < feetY + MANTLE.LEDGE_MIN_LIFT) return false;

    if (ledgeY > PlayerController.MANTLE_MAX_WORLD_Y) return false;

    this.mantleEndPos.set(lipX, ledgeY + this.radius, lipZ);

    if (
      !this.capsuleFitsAt(
        this.mantleEndPos,
        PlayerController.STANCES[this.stance].height,
      )
    ) {
      return false;
    }

    this.mantleStartPos.copy(this.capsulePosition);
    this.mantleTimer = 0;
    this.isMantling = true;
    this.startMove('mantle');
    // Climb faces the wall, whatever the body was doing.
    this.facingYaw = this.yaw;
    this.velocity.set(0, 0, 0);
    this.onGround = false;
    return true;
  }

  private updateMantle(delta: number): void {
    this.mantleTimer += delta;
    const t = Math.min(1, this.mantleTimer / PlayerController.MANTLE_DURATION);

    const upT = Math.min(1, t / MANTLE.UP_END_T);
    const easeUp = 1 - (1 - upT) * (1 - upT);

    const fwdT = Math.max(
      0,
      Math.min(
        1,
        (t - MANTLE.FWD_START_T) / (MANTLE.FWD_END_T - MANTLE.FWD_START_T),
      ),
    );
    const easeFwd = fwdT * fwdT * (3 - 2 * fwdT);

    this.capsulePosition.x =
      this.mantleStartPos.x +
      (this.mantleEndPos.x - this.mantleStartPos.x) * easeFwd;
    this.capsulePosition.z =
      this.mantleStartPos.z +
      (this.mantleEndPos.z - this.mantleStartPos.z) * easeFwd;
    this.capsulePosition.y =
      this.mantleStartPos.y +
      (this.mantleEndPos.y - this.mantleStartPos.y) * easeUp;
    this.updateCapsuleSegment();

    if (t >= 1) {
      this.isMantling = false;
      this.move = 'normal';
      this.onGround = true;
      this.velocity.set(0, 0, 0);
    }
  }

  private setStance(next: Stance): void {
    if (next === this.stance) return;
    const nextHeight = PlayerController.STANCES[next].height;
    if (
      nextHeight > this.height &&
      !this.capsuleFitsAt(this.capsulePosition, nextHeight)
    )
      return;
    this.stance = next;
  }

  private capsuleFitsAt(
    pos: THREE.Vector3,
    height: number = this.height,
  ): boolean {
    this.mantleLine.start.copy(pos);
    this.mantleLine.end.copy(pos).setY(pos.y + height);

    this.tempBox.makeEmpty();
    this.tempBox.expandByPoint(this.mantleLine.start);
    this.tempBox.expandByPoint(this.mantleLine.end);
    this.tempBox.min.addScalar(-this.radius);
    this.tempBox.max.addScalar(this.radius);

    const margin = PLAYER.COLLISION_MARGIN;
    let blocked = false;
    this.bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(this.tempBox),
      intersectsTriangle: (tri) => {
        const dist = (tri as any).closestPointToSegment(
          this.mantleLine,
          this.point1,
          this.point2,
        );
        if (dist < this.radius - margin) blocked = true;
      },
    });
    return !blocked;
  }

  private syncCamera(_delta: number): void {
    const eyeY = this.capsulePosition.y + this.height + this.eyeOffset;
    this.camEuler.set(this.pitch + this.freePitch, this.yaw + this.freeYaw, 0);
    this.camera.quaternion.setFromEuler(this.camEuler);

    if (this.viewMode === 'fpv') {
      const bobX = Math.cos(this.bobTimer * 0.5) * PLAYER.BOB_AMP_X;
      const bobY = Math.abs(Math.sin(this.bobTimer)) * PLAYER.BOB_AMP_Y;
      this.camera.position.set(
        this.capsulePosition.x + (this.bobTimer > 0 ? bobX : 0),
        eyeY + (this.bobTimer > 0 ? bobY : 0),
        this.capsulePosition.z,
      );
      return;
    }

    // Over-the-shoulder: orbit a pivot above the head, pulled in by walls.
    this.camPivot.set(
      this.capsulePosition.x,
      eyeY + TPP_CAMERA.HEIGHT_ABOVE_EYE_M,
      this.capsulePosition.z,
    );
    this.camRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.camPivot.addScaledVector(this.camRight, TPP_CAMERA.SHOULDER_RIGHT_M);
    this.camBack.set(0, 0, 1).applyQuaternion(this.camera.quaternion);

    let dist: number = TPP_CAMERA.DISTANCE_M;
    this.camRay.origin.copy(this.camPivot);
    this.camRay.direction.copy(this.camBack);
    const hit = this.bvh.raycastFirst(this.camRay, THREE.DoubleSide, 0, dist);
    if (hit) {
      dist = Math.max(
        TPP_CAMERA.MIN_DISTANCE_M,
        hit.distance - TPP_CAMERA.COLLISION_MARGIN_M,
      );
    }
    this.camera.position
      .copy(this.camPivot)
      .addScaledVector(this.camBack, dist);
  }

  public applyRecoil(pitchDelta: number, yawDelta: number): void {
    this.pitch = Math.max(
      -Math.PI / PLAYER.PITCH_LIMIT_DIVISOR,
      Math.min(Math.PI / PLAYER.PITCH_LIMIT_DIVISOR, this.pitch + pitchDelta),
    );
    this.yaw += yawDelta;
    this.recoverPitch += pitchDelta * this.recoilRecovery;
    this.recoverYaw += yawDelta * this.recoilRecovery;
    this.recoverHold = PLAYER.RECOVER_HOLD_S;
  }

  public getSpeed(): number {
    return Math.sqrt(
      this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z,
    );
  }
}
