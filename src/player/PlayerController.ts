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
  public recoilPitchOffset = 0;
  public recoilYawOffset = 0;

  // Movement parameters
  private walkSpeed = 5.2;
  private sprintSpeed = 8.6;
  private jumpForce = 6.8;
  private gravity = -20.0;

  // Head bobbing
  private bobTimer = 0;

  constructor(
    fov = 75,
    aspect = window.innerWidth / window.innerHeight,
    private input: InputManager,
    private bvh: MeshBVH
  ) {
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1000);
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
    // Clamp pitch between -85 and +85 degrees
    this.pitch = Math.max(-Math.PI / 2.1, Math.min(Math.PI / 2.1, this.pitch));

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw + this.recoilYawOffset;
    this.camera.rotation.x = this.pitch + this.recoilPitchOffset;

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

    if (this.input.isAnyKeyDown('KeyW', 'w', 'ArrowUp', 'z')) this.moveDir.add(this.forward);
    if (this.input.isAnyKeyDown('KeyS', 's', 'ArrowDown')) this.moveDir.sub(this.forward);
    if (this.input.isAnyKeyDown('KeyD', 'd', 'ArrowRight')) this.moveDir.add(this.right);
    if (this.input.isAnyKeyDown('KeyA', 'a', 'ArrowLeft', 'q')) this.moveDir.sub(this.right);

    const isMoving = this.moveDir.lengthSq() > 0.001;
    if (isMoving) {
      this.moveDir.normalize();
    }

    // 4. Horizontal velocity damping & acceleration
    const damping = this.onGround ? 12.0 : 2.5;
    this.velocity.x += (this.moveDir.x * currentSpeed - this.velocity.x) * damping * delta;
    this.velocity.z += (this.moveDir.z * currentSpeed - this.velocity.z) * damping * delta;

    // 5. Jump
    if (this.onGround && this.input.isKeyDown('Space')) {
      this.velocity.y = this.jumpForce;
      this.onGround = false;
    }

    // 6. Sub-stepping physics (2 sub-steps) for buttery smooth collision stability
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

  public getSpeed(): number {
    return Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z);
  }
}
