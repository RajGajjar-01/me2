import * as THREE from 'three';
import { ExtendedTriangle, type MeshBVH } from 'three-mesh-bvh';
import type { InputManager } from '../core/InputManager';

export class PlayerController {
  public camera: THREE.PerspectiveCamera;
  public onGround = false;
  public velocity: THREE.Vector3 = new THREE.Vector3();
  public stamina = 100;
  public maxStamina = 100;
  public isSprinting = false;

  public radius = 0.38;
  public height = 1.35;
  public eyeOffset = 0.28;
  public capsulePosition: THREE.Vector3 = new THREE.Vector3(0, 0.4, 28);

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
  private yaw = 0;

  private recoverPitch = 0;
  private recoverYaw = 0;
  private recoverHold = 0;

  public recoilRecovery = 0.7;

  private sprintSpeed = 8.6;
  private jumpForce = 6.8;
  private gravity = -20.0;

  private static readonly STANCES = {
    stand: { height: 1.35, eyeOffset: 0.28, speed: 5.2 },
    crouch: { height: 0.35, eyeOffset: 0.22, speed: 3.7 },
    prone: { height: 0.1, eyeOffset: -0.03, speed: 1.3 },
  } as const;
  public stance: 'stand' | 'crouch' | 'prone' = 'stand';

  private static readonly LEAN_OFFSET = 0.38;
  private static readonly LEAN_ROLL = 0.22;
  private static readonly LEAN_MARGIN = 0.15;
  private lean = 0;
  private leanRay: THREE.Ray = new THREE.Ray();

  private bobTimer = 0;

  private static readonly STRIDE = {
    stand: 1.6,
    crouch: 1.3,
    prone: 0.9,
  } as const;

  private static readonly SPRINT_STRIDE = 1.35;
  private strideAccum = 0;

  public onFootstep?: (
    stance: 'stand' | 'crouch' | 'prone',
    isSprinting: boolean,
  ) => void;

  private static readonly MANTLE_MAX_HEIGHT = 1.5;
  private static readonly MANTLE_DURATION = 0.35;

  private static readonly MANTLE_MAX_WORLD_Y = 3.0;
  public isMantling = false;
  private mantleTimer = 0;
  private mantleStartPos: THREE.Vector3 = new THREE.Vector3();
  private mantleEndPos: THREE.Vector3 = new THREE.Vector3();
  private mantleRay: THREE.Ray = new THREE.Ray();
  private mantleLine: THREE.Line3 = new THREE.Line3();

  constructor(
    fov = 75,
    aspect = window.innerWidth / window.innerHeight,
    private input: InputManager,
    private bvh: MeshBVH,
  ) {
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.05, 1000);
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

    if (Math.abs(mouse.x) > 0.0004 || Math.abs(mouse.y) > 0.0004) {
      this.recoverPitch = 0;
      this.recoverYaw = 0;
    }

    if (this.recoverHold > 0) {
      this.recoverHold -= delta;
    } else if (this.recoverPitch !== 0 || this.recoverYaw !== 0) {
      const k = 1 - Math.exp(-9 * delta);
      const dp = this.recoverPitch * k;
      const dy = this.recoverYaw * k;
      this.pitch -= dp;
      this.yaw -= dy;
      this.recoverPitch -= dp;
      this.recoverYaw -= dy;
    }

    this.pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, this.pitch));

    const wantsCrouch = this.input.isKeyPressed('KeyC');
    const wantsProne = this.input.isKeyPressed('KeyZ');
    if (!this.isMantling) {
      if (wantsCrouch)
        this.setStance(this.stance === 'crouch' ? 'stand' : 'crouch');
      if (wantsProne)
        this.setStance(this.stance === 'prone' ? 'stand' : 'prone');
    }

    const target = PlayerController.STANCES[this.stance];
    const stanceK = 1 - Math.exp(-10 * delta);
    this.height += (target.height - this.height) * stanceK;
    this.eyeOffset += (target.eyeOffset - this.eyeOffset) * stanceK;

    const canLean =
      !this.isMantling && !this.isSprinting && this.stance !== 'prone';
    const leanInput = canLean
      ? (this.input.isKeyDown('KeyE') ? 1 : 0) -
        (this.input.isKeyDown('KeyQ') ? 1 : 0)
      : 0;
    this.lean += (leanInput - this.lean) * (1 - Math.exp(-14 * delta));

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    this.camera.rotation.z = -this.lean * PlayerController.LEAN_ROLL;

    const wantsSprint =
      this.input.isKeyDown('ShiftLeft') || this.input.isKeyDown('ShiftRight');
    const hasStamina = this.stamina > 5;
    this.isSprinting =
      wantsSprint && hasStamina && this.onGround && this.stance === 'stand';

    if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - 26 * delta);
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + 20 * delta);
    }

    const currentSpeed = this.isSprinting ? this.sprintSpeed : target.speed;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);

    this.forward.set(-sin, 0, -cos);
    this.right.set(cos, 0, -sin);

    this.moveDir.set(0, 0, 0);

    if (!this.isMantling) {
      if (this.input.isAnyKeyDown('KeyW', 'ArrowUp'))
        this.moveDir.add(this.forward);
      if (this.input.isAnyKeyDown('KeyS', 'ArrowDown'))
        this.moveDir.sub(this.forward);
      if (this.input.isAnyKeyDown('KeyD', 'ArrowRight'))
        this.moveDir.add(this.right);
      if (this.input.isAnyKeyDown('KeyA', 'ArrowLeft'))
        this.moveDir.sub(this.right);
    }

    const isMoving = this.moveDir.lengthSq() > 0.001;
    if (isMoving) {
      this.moveDir.normalize();
    }

    if (this.isMantling) {
      this.velocity.set(0, 0, 0);
    } else {
      const damping = this.onGround ? 12.0 : 2.5;
      this.velocity.x +=
        (this.moveDir.x * currentSpeed - this.velocity.x) * damping * delta;
      this.velocity.z +=
        (this.moveDir.z * currentSpeed - this.velocity.z) * damping * delta;
    }

    const spacePressed = this.input.isKeyPressed('Space');
    if (this.stance !== 'stand') {
      if (spacePressed)
        this.setStance(this.stance === 'prone' ? 'crouch' : 'stand');
    } else {
      const wantsMantle =
        spacePressed || (!this.onGround && this.input.isKeyDown('Space'));

      if (!this.isMantling && wantsMantle) {
        this.tryStartMantle();
      }
      if (!this.isMantling && this.onGround && this.input.isKeyDown('Space')) {
        this.velocity.y = this.jumpForce;
        this.onGround = false;
      }
    }

    const prevX = this.capsulePosition.x;
    const prevZ = this.capsulePosition.z;

    if (this.isMantling) {
      this.updateMantle(delta);
    } else {
      const subSteps = 2;
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
      this.bobTimer += delta * (this.isSprinting ? 14 : 9);
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

          if (this.tempNormal.lengthSq() > 0.000001) {
            this.tempNormal.normalize();
          } else {
            tri.getNormal(this.tempNormal);
          }

          this.capsulePosition.addScaledVector(this.tempNormal, depth);
          this.updateCapsuleSegment();

          if (this.tempNormal.y > 0.45) {
            this.onGround = true;
          }

          const normalVel = this.velocity.dot(this.tempNormal);
          if (normalVel < 0) {
            this.velocity.addScaledVector(this.tempNormal, -normalVel);
          }
        }
      },
    });

    if (this.capsulePosition.y < 0.2) {
      this.capsulePosition.y = 0.2;
      this.velocity.y = 0;
      this.onGround = true;
    }
  }

  private tryStartMantle(): boolean {
    const feetY = this.capsulePosition.y - this.radius;
    const maxGrabY = feetY + PlayerController.MANTLE_MAX_HEIGHT;

    this.mantleRay.origin.set(
      this.capsulePosition.x,
      feetY + 1.0,
      this.capsulePosition.z,
    );
    this.mantleRay.direction.copy(this.forward);
    const wallDist = this.radius + 0.55;
    const wallHit = this.bvh.raycastFirst(
      this.mantleRay,
      THREE.DoubleSide,
      0,
      wallDist,
    );
    if (!wallHit) return false;

    const lipX = wallHit.point.x + this.forward.x * (this.radius + 0.15);
    const lipZ = wallHit.point.z + this.forward.z * (this.radius + 0.15);
    const probeTop = maxGrabY + 0.3;
    this.mantleRay.origin.set(lipX, probeTop, lipZ);
    this.mantleRay.direction.set(0, -1, 0);
    const downDist = probeTop - (feetY - 0.3);
    const downHit = this.bvh.raycastFirst(
      this.mantleRay,
      THREE.DoubleSide,
      0,
      downDist,
    );
    if (!downHit) return false;

    const ledgeY = downHit.point.y;
    if (ledgeY > maxGrabY + 0.02) return false;
    if (ledgeY < feetY + 0.15) return false;

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

    const upT = Math.min(1, t / 0.6);
    const easeUp = 1 - (1 - upT) * (1 - upT);

    const fwdT = Math.max(0, Math.min(1, (t - 0.4) / 0.6));
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

  private setStance(next: 'stand' | 'crouch' | 'prone'): void {
    if (next === this.stance) return;
    const nextHeight = PlayerController.STANCES[next].height;
    if (
      nextHeight > this.height &&
      !this.capsuleFitsAt(this.capsulePosition, nextHeight)
    )
      return;
    this.stance = next;
  }

  private capsuleFitsAt(pos: THREE.Vector3, height = this.height): boolean {
    this.mantleLine.start.copy(pos);
    this.mantleLine.end.copy(pos).setY(pos.y + height);

    this.tempBox.makeEmpty();
    this.tempBox.expandByPoint(this.mantleLine.start);
    this.tempBox.expandByPoint(this.mantleLine.end);
    this.tempBox.min.addScalar(-this.radius);
    this.tempBox.max.addScalar(this.radius);

    const margin = 0.02;
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

    const bobX = Math.cos(this.bobTimer * 0.5) * 0.022;
    const bobY = Math.abs(Math.sin(this.bobTimer)) * 0.032;

    this.camera.position.set(
      this.capsulePosition.x + (this.bobTimer > 0 ? bobX : 0),
      eyeY + (this.bobTimer > 0 ? bobY : 0),
      this.capsulePosition.z,
    );

    if (Math.abs(this.lean) > 0.001) {
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

      this.camera.position.addScaledVector(this.right, lateral);
      this.camera.position.y -= Math.abs(this.lean) * 0.03;
    }
  }

  public applyRecoil(pitchDelta: number, yawDelta: number): void {
    this.pitch = Math.max(
      -Math.PI / 2.1,
      Math.min(Math.PI / 2.1, this.pitch + pitchDelta),
    );
    this.yaw += yawDelta;
    this.recoverPitch += pitchDelta * this.recoilRecovery;
    this.recoverYaw += yawDelta * this.recoilRecovery;
    this.recoverHold = 0.09;
  }

  public getSpeed(): number {
    return Math.sqrt(
      this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z,
    );
  }
}
