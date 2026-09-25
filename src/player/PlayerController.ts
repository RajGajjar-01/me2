import * as THREE from 'three';
import { ExtendedTriangle, type MeshBVH } from 'three-mesh-bvh';
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

export class PlayerController {
  public camera: THREE.PerspectiveCamera;
  public onGround = false;
  public velocity: THREE.Vector3 = new THREE.Vector3();
  public stamina: number = PLAYER.MAX_STAMINA;
  public maxStamina: number = PLAYER.MAX_STAMINA;
  public isSprinting = false;

  public radius: number = PLAYER.CAPSULE_RADIUS;
  public height: number = STANCES.stand.height;
  public eyeOffset: number = STANCES.stand.eyeOffset;
  public capsulePosition: THREE.Vector3 = new THREE.Vector3(
    0,
    PLAYER.CAPSULE_START_Y,
    PLAYER.CAPSULE_START_Z,
  );

  private colliderLine: THREE.Line3 = new THREE.Line3();

  private tempBox: THREE.Box3 = new THREE.Box3();
  private point1: THREE.Vector3 = new THREE.Vector3();
  private point2: THREE.Vector3 = new THREE.Vector3();
  private tempNormal: THREE.Vector3 = new THREE.Vector3();
  private moveDir: THREE.Vector3 = new THREE.Vector3();
  private forward: THREE.Vector3 = new THREE.Vector3();
  private right: THREE.Vector3 = new THREE.Vector3();
  private upAxis: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

  private pitch = 0;
  public yaw = 0;

  private recoverPitch = 0;
  private recoverYaw = 0;
  private recoverHold = 0;

  public recoilRecovery: number = PLAYER.RECOIL_RECOVERY;

  private sprintSpeed: number = PLAYER.SPRINT_SPEED;
  private jumpForce: number = PLAYER.JUMP_FORCE;
  private gravity: number = PLAYER.GRAVITY;

  private static readonly STANCES = STANCES;
  public stance: Stance = 'stand';

  private static readonly LEAN_OFFSET = PLAYER.LEAN_OFFSET;
  private static readonly LEAN_ROLL = PLAYER.LEAN_ROLL;
  private static readonly LEAN_MARGIN = PLAYER.LEAN_MARGIN;
  public lean = 0;
  public leanLateral = 0;
  private leanRay: THREE.Ray = new THREE.Ray();

  public bobTimer = 0;

  private static readonly STRIDE = STRIDE;

  private static readonly SPRINT_STRIDE = SPRINT_STRIDE_MULT;
  private strideAccum = 0;

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
    this.syncCamera();
  }

  private updateCapsuleSegment(): void {
    this.colliderLine.start.copy(this.capsulePosition);
    this.colliderLine.end
      .copy(this.capsulePosition)
      .setY(this.capsulePosition.y + this.height);
  }

  public update(delta: number): void {
    const mouse = this.input.consumeMouseDelta();
    this.yaw -= mouse.x;
    this.pitch -= mouse.y;

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

    const wantsCrouch = this.input.isKeyPressed(INPUT.CROUCH_TOGGLE);
    const wantsProne = this.input.isKeyPressed(INPUT.PRONE_TOGGLE);
    if (!this.isMantling) {
      if (wantsCrouch)
        this.setStance(this.stance === 'crouch' ? 'stand' : 'crouch');
      if (wantsProne)
        this.setStance(this.stance === 'prone' ? 'stand' : 'prone');
    }

    const target = PlayerController.STANCES[this.stance];
    const stanceK = 1 - Math.exp(-PLAYER.STANCE_BLEND_RATE * delta);
    this.height += (target.height - this.height) * stanceK;
    this.eyeOffset += (target.eyeOffset - this.eyeOffset) * stanceK;

    const canLean =
      !this.isMantling && !this.isSprinting && this.stance !== 'prone';
    const leanInput = canLean
      ? (this.input.isKeyDown(INPUT.LEAN_RIGHT) ? 1 : 0) -
        (this.input.isKeyDown(INPUT.LEAN_LEFT) ? 1 : 0)
      : 0;
    this.lean +=
      (leanInput - this.lean) * (1 - Math.exp(-PLAYER.LEAN_BLEND_RATE * delta));

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    this.camera.rotation.z = -this.lean * PlayerController.LEAN_ROLL;

    const wantsSprint = this.input.isAnyKeyDown(...INPUT.SPRINT);
    const hasStamina = this.stamina > PLAYER.STAMINA_MIN_TO_SPRINT;
    this.isSprinting =
      wantsSprint && hasStamina && this.onGround && this.stance === 'stand';

    if (this.isSprinting) {
      this.stamina = Math.max(
        0,
        this.stamina - PLAYER.STAMINA_DRAIN_PER_S * delta,
      );
    } else {
      this.stamina = Math.min(
        this.maxStamina,
        this.stamina + PLAYER.STAMINA_REGEN_PER_S * delta,
      );
    }

    const currentSpeed = this.isSprinting ? this.sprintSpeed : target.speed;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);

    this.forward.set(-sin, 0, -cos);
    this.right.set(cos, 0, -sin);

    this.moveDir.set(0, 0, 0);

    if (!this.isMantling) {
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
    if (isMoving) {
      this.moveDir.normalize();
    }

    if (this.isMantling) {
      this.velocity.set(0, 0, 0);
    } else {
      const damping = this.onGround
        ? PLAYER.DAMPING_GROUND
        : PLAYER.DAMPING_AIR;
      this.velocity.x +=
        (this.moveDir.x * currentSpeed - this.velocity.x) * damping * delta;
      this.velocity.z +=
        (this.moveDir.z * currentSpeed - this.velocity.z) * damping * delta;
    }

    const spacePressed = this.input.isKeyPressed(INPUT.JUMP);
    if (this.stance !== 'stand') {
      if (spacePressed)
        this.setStance(this.stance === 'prone' ? 'crouch' : 'stand');
    } else {
      const wantsMantle =
        spacePressed || (!this.onGround && this.input.isKeyDown(INPUT.JUMP));

      if (!this.isMantling && wantsMantle) {
        this.tryStartMantle();
      }
      if (
        !this.isMantling &&
        this.onGround &&
        this.input.isKeyDown(INPUT.JUMP)
      ) {
        this.velocity.y = this.jumpForce;
        this.onGround = false;
      }
    }

    const prevX = this.capsulePosition.x;
    const prevZ = this.capsulePosition.z;

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
    this.syncCamera();
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

  private syncCamera(): void {
    const eyeY = this.capsulePosition.y + this.height + this.eyeOffset;

    const bobX = Math.cos(this.bobTimer * 0.5) * PLAYER.BOB_AMP_X;
    const bobY = Math.abs(Math.sin(this.bobTimer)) * PLAYER.BOB_AMP_Y;

    this.camera.position.set(
      this.capsulePosition.x + (this.bobTimer > 0 ? bobX : 0),
      eyeY + (this.bobTimer > 0 ? bobY : 0),
      this.capsulePosition.z,
    );

    this.leanLateral = 0;

    if (Math.abs(this.lean) > PLAYER.LEAN_ACTIVE_EPS) {
      let lateral = this.lean * PlayerController.LEAN_OFFSET;
      const dir = Math.sign(lateral);

      this.leanRay.origin.copy(this.camera.position);
      this.leanRay.direction.copy(this.right).multiplyScalar(dir);
      const reach = Math.abs(lateral) + PlayerController.LEAN_MARGIN;
      const hit = this.bvh.raycastFirst(
        this.leanRay,
        THREE.DoubleSide,
        0,
        reach,
      );
      if (hit) {
        const allowed = Math.max(
          0,
          hit.distance - PlayerController.LEAN_MARGIN,
        );
        lateral = dir * Math.min(Math.abs(lateral), allowed);
      }

      this.leanLateral = lateral;
      this.camera.position.addScaledVector(this.right, lateral);
      this.camera.position.y -= Math.abs(this.lean) * PLAYER.LEAN_DROP_PER_LEAN;
    }
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
