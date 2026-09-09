import * as THREE from 'three';
import { MeshBVH, ExtendedTriangle } from 'three-mesh-bvh';
import { InputManager } from '../core/InputManager';

export class PlayerController {
  public camera: THREE.PerspectiveCamera;
  public onGround = false;
  public velocity: THREE.Vector3 = new THREE.Vector3();
  public stamina = 100;
  public maxStamina = 100;
  public isSprinting = false;

  // Capsule dimensions
  public radius = 0.38;
  public height = 1.35; // distance between start and end spheres
  public eyeOffset = 0.28; // eye height above top sphere
  public capsulePosition: THREE.Vector3 = new THREE.Vector3(0, 0.4, 28); // Outdoor firing line spawn

  private colliderLine: THREE.Line3 = new THREE.Line3();

  // Pre-allocated math objects (Zero Garbage Collection)
  private tempBox: THREE.Box3 = new THREE.Box3();
  private point1: THREE.Vector3 = new THREE.Vector3();
  private point2: THREE.Vector3 = new THREE.Vector3();
  private tempNormal: THREE.Vector3 = new THREE.Vector3();
  private moveDir: THREE.Vector3 = new THREE.Vector3();
  private forward: THREE.Vector3 = new THREE.Vector3();
  private right: THREE.Vector3 = new THREE.Vector3();
  private upAxis: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

  // Rotation angles
  private pitch = 0;
  private yaw = 0;

  // Recoil recovery: how much of the applied kick is still owed back, plus a
  // short hold-off so recovery only starts once the burst stops.
  private recoverPitch = 0;
  private recoverYaw = 0;
  private recoverHold = 0;
  /** Fraction of each kick that is given back; the rest is permanent aim climb. */
  public recoilRecovery = 0.7;

  // Movement parameters
  private walkSpeed = 5.2;
  private sprintSpeed = 8.6;
  private jumpForce = 6.8;
  private gravity = -20.0;

  // Head bobbing
  private bobTimer = 0;

  // Mantle / vault: grabs a ledge up to MANTLE_MAX_HEIGHT above the player's
  // current feet. Reachable both grounded (e.g. sandbags at 1.0m) and mid-air
  // (jump apex raises the feet by ~1.156m, so a container top at 2.6m is only
  // ~1.44m above the apex feet - within reach). See test_mantle.mjs, which
  // must be kept in sync with these two constants.
  private static readonly MANTLE_MAX_HEIGHT = 1.5;
  private static readonly MANTLE_DURATION = 0.35;
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
    private bvh: MeshBVH
  ) {
    // 0.05 near plane: viewmodel geometry legitimately sits within 10cm of the eye,
    // and 0.1 was clipping into the weapon when it was pulled in for ADS.
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.05, 1000);
    this.updateCapsuleSegment();
    this.syncCamera();
  }

  private updateCapsuleSegment(): void {
    this.colliderLine.start.copy(this.capsulePosition);
    this.colliderLine.end.copy(this.capsulePosition).setY(this.capsulePosition.y + this.height);
  }

  public update(delta: number): void {
    // 1. Mouse rotation
    const mouse = this.input.consumeMouseDelta();
    this.yaw -= mouse.x;
    this.pitch -= mouse.y;

    // The player moved the mouse: drop whatever recoil we still owed back rather
    // than dragging their aim around while they compensate.
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

    // Clamp pitch between -85 and +85 degrees
    this.pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, this.pitch));

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // 2. Sprint & Stamina logic
    const wantsSprint = this.input.isKeyDown('ShiftLeft') || this.input.isKeyDown('ShiftRight');
    const hasStamina = this.stamina > 5;
    this.isSprinting = wantsSprint && hasStamina && this.onGround;

    if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - 26 * delta);
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + 20 * delta);
    }

    const currentSpeed = this.isSprinting ? this.sprintSpeed : this.walkSpeed;

    // 3. Movement input vector (Bulletproof trigonometry from yaw, 0% chance of NaN)
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);

    this.forward.set(-sin, 0, -cos);
    this.right.set(cos, 0, -sin);

    this.moveDir.set(0, 0, 0);

    if (!this.isMantling) {
      if (this.input.isAnyKeyDown('KeyW', 'w', 'ArrowUp', 'z')) this.moveDir.add(this.forward);
      if (this.input.isAnyKeyDown('KeyS', 's', 'ArrowDown')) this.moveDir.sub(this.forward);
      if (this.input.isAnyKeyDown('KeyD', 'd', 'ArrowRight')) this.moveDir.add(this.right);
      if (this.input.isAnyKeyDown('KeyA', 'a', 'ArrowLeft', 'q')) this.moveDir.sub(this.right);
    }

    const isMoving = this.moveDir.lengthSq() > 0.001;
    if (isMoving) {
      this.moveDir.normalize();
    }

    // 4. Horizontal velocity damping & acceleration
    if (this.isMantling) {
      this.velocity.set(0, 0, 0);
    } else {
      const damping = this.onGround ? 12.0 : 2.5;
      this.velocity.x += (this.moveDir.x * currentSpeed - this.velocity.x) * damping * delta;
      this.velocity.z += (this.moveDir.z * currentSpeed - this.velocity.z) * damping * delta;
    }

    // 5. Jump / mantle. Space edge-triggers a mantle attempt first (works grounded
    // or airborne); if no ledge is in reach it falls through to the normal jump.
    // Airborne, a held Space retries every frame: jumping into a container and
    // holding the key is enough to go up, with no second press to time at the apex.
    const wantsMantle =
      (this.input.isKeyPressed && this.input.isKeyPressed('Space')) ||
      (!this.onGround && this.input.isKeyDown('Space'));

    if (!this.isMantling && wantsMantle) {
      this.tryStartMantle();
    }
    if (!this.isMantling && this.onGround && this.input.isKeyDown('Space')) {
      this.velocity.y = this.jumpForce;
      this.onGround = false;
    }

    // 6. Sub-stepping physics (2 sub-steps) for buttery smooth collision stability,
    // or - while mantling - a suppressed-gravity interpolation onto the ledge.
    if (this.isMantling) {
      this.updateMantle(delta);
    } else {
      const subSteps = 2;
      const subDelta = delta / subSteps;

      for (let s = 0; s < subSteps; s++) {
        // Gravity
        this.velocity.y += this.gravity * subDelta;

        // Integrate position
        this.capsulePosition.x += this.velocity.x * subDelta;
        this.capsulePosition.y += this.velocity.y * subDelta;
        this.capsulePosition.z += this.velocity.z * subDelta;

        // Resolve BVH Collision
        this.resolveCollision();
      }
    }

    // 7. Sync camera & subtle head bobbing
    if (isMoving && this.onGround) {
      this.bobTimer += delta * (this.isSprinting ? 14 : 9);
    } else {
      this.bobTimer = 0;
    }
    this.syncCamera();
  }

  private resolveCollision(): void {
    this.onGround = false;
    this.updateCapsuleSegment();

    // Compute bounding box of capsule for broadphase
    this.tempBox.makeEmpty();
    this.tempBox.expandByPoint(this.colliderLine.start);
    this.tempBox.expandByPoint(this.colliderLine.end);
    this.tempBox.min.addScalar(-this.radius);
    this.tempBox.max.addScalar(this.radius);

    // Shapecast against BVH
    this.bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(this.tempBox),
      intersectsTriangle: (tri) => {
        const dist = (tri as any).closestPointToSegment(
          this.colliderLine,
          this.point1,
          this.point2
        );

        if (dist < this.radius) {
          const depth = this.radius - dist;
          this.tempNormal.subVectors(this.point2, this.point1);

          if (this.tempNormal.lengthSq() > 0.000001) {
            this.tempNormal.normalize();
          } else {
            tri.getNormal(this.tempNormal);
          }

          // Displace capsule away from triangle
          this.capsulePosition.addScaledVector(this.tempNormal, depth);
          this.updateCapsuleSegment();

          // Floor detection
          if (this.tempNormal.y > 0.45) {
            this.onGround = true;
          }

          // Cancel normal velocity
          const normalVel = this.velocity.dot(this.tempNormal);
          if (normalVel < 0) {
            this.velocity.addScaledVector(this.tempNormal, -normalVel);
          }
        }
      }
    });

    // Floor fail-safe
    if (this.capsulePosition.y < 0.2) {
      this.capsulePosition.y = 0.2;
      this.velocity.y = 0;
      this.onGround = true;
    }
  }

  /**
   * Attempts to grab a ledge in front of the player. Casts forward for a wall,
   * then down from above the ledge-height ceiling to find the surface, then
   * verifies the capsule actually fits there before committing. Returns false
   * (leaving movement untouched) if no valid ledge is found.
   */
  private tryStartMantle(): boolean {
    const feetY = this.capsulePosition.y - this.radius;
    const maxGrabY = feetY + PlayerController.MANTLE_MAX_HEIGHT;

    // Forward probe for a wall at roughly chest height.
    this.mantleRay.origin.set(this.capsulePosition.x, feetY + 1.0, this.capsulePosition.z);
    this.mantleRay.direction.copy(this.forward);
    const wallDist = this.radius + 0.55;
    const wallHit = this.bvh.raycastFirst(this.mantleRay, THREE.DoubleSide, 0, wallDist);
    if (!wallHit) return false;

    // Downward probe just past the wall face (inset radius + 0.1 past the lip)
    // to find the ledge's top surface.
    const lipX = wallHit.point.x + this.forward.x * (this.radius + 0.15);
    const lipZ = wallHit.point.z + this.forward.z * (this.radius + 0.15);
    const probeTop = maxGrabY + 0.3;
    this.mantleRay.origin.set(lipX, probeTop, lipZ);
    this.mantleRay.direction.set(0, -1, 0);
    const downDist = probeTop - (feetY - 0.3);
    const downHit = this.bvh.raycastFirst(this.mantleRay, THREE.DoubleSide, 0, downDist);
    if (!downHit) return false;

    const ledgeY = downHit.point.y;
    if (ledgeY > maxGrabY + 0.02) return false; // out of reach
    if (ledgeY < feetY + 0.15) return false; // not enough of a step to bother

    this.mantleEndPos.set(lipX, ledgeY + this.radius, lipZ);
    if (!this.capsuleFitsAt(this.mantleEndPos)) return false; // never teleport into solid geometry

    this.mantleStartPos.copy(this.capsulePosition);
    this.mantleTimer = 0;
    this.isMantling = true;
    this.velocity.set(0, 0, 0);
    this.onGround = false;
    return true;
  }

  /** Advances the mantle interpolation: rises first, then moves forward, clearing the lip. */
  private updateMantle(delta: number): void {
    this.mantleTimer += delta;
    const t = Math.min(1, this.mantleTimer / PlayerController.MANTLE_DURATION);

    const upT = Math.min(1, t / 0.6);
    const easeUp = 1 - (1 - upT) * (1 - upT); // ease-out

    const fwdT = Math.max(0, Math.min(1, (t - 0.4) / 0.6));
    const easeFwd = fwdT * fwdT * (3 - 2 * fwdT); // smoothstep, starts once mostly risen

    this.capsulePosition.x = this.mantleStartPos.x + (this.mantleEndPos.x - this.mantleStartPos.x) * easeFwd;
    this.capsulePosition.z = this.mantleStartPos.z + (this.mantleEndPos.z - this.mantleStartPos.z) * easeFwd;
    this.capsulePosition.y = this.mantleStartPos.y + (this.mantleEndPos.y - this.mantleStartPos.y) * easeUp;
    this.updateCapsuleSegment();

    if (t >= 1) {
      this.isMantling = false;
      this.onGround = true;
      this.velocity.set(0, 0, 0);
    }
  }

  /** Shapecast clearance check: true if the capsule at `pos` doesn't intersect any triangle. */
  private capsuleFitsAt(pos: THREE.Vector3): boolean {
    this.mantleLine.start.copy(pos);
    this.mantleLine.end.copy(pos).setY(pos.y + this.height);

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
        const dist = (tri as any).closestPointToSegment(this.mantleLine, this.point1, this.point2);
        if (dist < this.radius - margin) blocked = true;
      }
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
      this.capsulePosition.z
    );
  }

  /**
   * Kicks the player's *actual* aim. Positive pitchDelta looks up, positive
   * yawDelta looks left. A fraction (recoilRecovery) drifts back once firing
   * stops; the remainder is permanent climb the player has to pull down.
   */
  public applyRecoil(pitchDelta: number, yawDelta: number): void {
    this.pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, this.pitch + pitchDelta));
    this.yaw += yawDelta;
    this.recoverPitch += pitchDelta * this.recoilRecovery;
    this.recoverYaw += yawDelta * this.recoilRecovery;
    this.recoverHold = 0.09; // each shot pushes recovery back so bursts keep climbing
  }

  public getSpeed(): number {
    return Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
  }
}
