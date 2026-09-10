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

  // Capsule dimensions. height/eyeOffset are driven by the active stance (see
  // STANCES) rather than being fixed — they lerp toward the target on a change.
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
  private sprintSpeed = 8.6;
  private jumpForce = 6.8;
  private gravity = -20.0;

  // Stance ladder (PUBG: C crouch, Z prone, both toggles).
  //
  // Eye height above the feet is radius + height + eyeOffset, so the numbers below
  // put the crouched eye at 0.95m — deliberately just under the 1.0m sandbag bunkers
  // in OutdoorRange, which is the whole reason a crouch exists here. Speeds are
  // PUBG's measured stance ratios (crouch run 3.4 / crawl 1.2 against a 4.7 standing
  // run) applied to this game's 5.2 walk baseline. test_stance.mjs pins all of it.
  //
  // ponytail: prone is a short *vertical* capsule, not a horizontal body, so the
  // player still occupies a 0.76m-tall column (2 * radius) and cannot crawl under
  // anything lower. A real prone body means a yaw-aligned horizontal capsule that
  // has to re-clear itself every time you turn — only worth it if crawling under
  // geometry ever becomes a thing.
  private static readonly STANCES = {
    stand: { height: 1.35, eyeOffset: 0.28, speed: 5.2 },
    crouch: { height: 0.35, eyeOffset: 0.22, speed: 3.7 },
    prone: { height: 0.10, eyeOffset: -0.03, speed: 1.3 }
  } as const;
  public stance: 'stand' | 'crouch' | 'prone' = 'stand';

  // Lean / peek (Q and E, hold-to-lean so releasing snaps you back behind cover).
  // The collision capsule deliberately does NOT move — only the eye and, because the
  // viewmodel is parented to the camera, the muzzle and the shot ray with it.
  private static readonly LEAN_OFFSET = 0.38; // metres of lateral travel at full lean
  private static readonly LEAN_ROLL = 0.22; // radians of view roll (~12.6 degrees)
  private static readonly LEAN_MARGIN = 0.15; // keep the eye this far off a wall
  private lean = 0; // smoothed, -1 (left) .. +1 (right)
  private leanRay: THREE.Ray = new THREE.Ray();

  // Head bobbing
  private bobTimer = 0;

  // Footsteps are driven by distance travelled, not a timer: one step per stride
  // length of ground covered. That self-corrects for every speed the player can
  // move at — sprint, walk, crouch, crawl — without a second cadence table to keep
  // in sync with STANCES. Stride shortens with stance because a crawl advances the
  // body in short shuffles. See test_footsteps.mjs.
  //
  // The strides are constrained, not free: cadence is speed / stride, so a stride
  // that is too short for its stance's speed makes the lower stance step *faster*
  // than the higher one. Crouch has to stay above 3.7 / 3.25 = 1.14m to stay
  // slower-footed than a walk. test_footsteps.mjs asserts the ordering.
  private static readonly STRIDE = { stand: 1.6, crouch: 1.3, prone: 0.9 } as const;
  /** A run lengthens the stride as well as speeding it up — without this, sprinting
   *  hits 5.4 steps/s and reads as a machine gun rather than a sprint. */
  private static readonly SPRINT_STRIDE = 1.35;
  private strideAccum = 0;
  /** Fired each time a full stride has been covered on the ground. main.ts wires audio. */
  public onFootstep?: (stance: 'stand' | 'crouch' | 'prone', isSprinting: boolean) => void;

  // Mantle / vault: grabs a ledge up to MANTLE_MAX_HEIGHT above the player's
  // current feet. Reachable both grounded (e.g. sandbags at 1.0m) and mid-air
  // (jump apex raises the feet by ~1.156m, so a container top at 2.6m is only
  // ~1.44m above the apex feet - within reach). See test_mantle.mjs, which
  // must be kept in sync with these two constants.
  private static readonly MANTLE_MAX_HEIGHT = 1.5;
  private static readonly MANTLE_DURATION = 0.35;
  /** No mantle may finish above this world Y — see the check in tryStartMantle(). */
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

    // 1b. Stance ladder. C toggles crouch, Z toggles prone; standing back up is
    // gated on the taller capsule actually fitting, so you can't grow through a
    // container roof. Going *down* never needs a check — capsulePosition is the
    // bottom sphere, so shrinking height only lowers the top of the capsule.
    // isKeyPressed is consuming, so these must be read unconditionally and the
    // result discarded while mantling — guarding the *call* would leave the press
    // queued and fire it the instant the vault ends, a third of a second late.
    const wantsCrouch = this.input.isKeyPressed('KeyC');
    const wantsProne = this.input.isKeyPressed('KeyZ');
    if (!this.isMantling) {
      if (wantsCrouch) this.setStance(this.stance === 'crouch' ? 'stand' : 'crouch');
      if (wantsProne) this.setStance(this.stance === 'prone' ? 'stand' : 'prone');
    }

    // Ease the capsule toward the active stance's dimensions.
    const target = PlayerController.STANCES[this.stance];
    const stanceK = 1 - Math.exp(-10 * delta);
    this.height += (target.height - this.height) * stanceK;
    this.eyeOffset += (target.eyeOffset - this.eyeOffset) * stanceK;

    // 1c. Lean / peek. Hold Q or E. Prone cannot lean at all — you have no shoulder
    // to roll onto with your body on the ground — and sprinting or mantling also
    // forces you upright. Crouched leaning is allowed, same as PUBG.
    // (isSprinting is last frame's value — a single frame of lag on an eased
    // value that is about to be driven to zero anyway.)
    const canLean = !this.isMantling && !this.isSprinting && this.stance !== 'prone';
    const leanInput = canLean
      ? (this.input.isKeyDown('KeyE') ? 1 : 0) - (this.input.isKeyDown('KeyQ') ? 1 : 0)
      : 0;
    this.lean += (leanInput - this.lean) * (1 - Math.exp(-14 * delta));

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    // Order is YXZ, so Z is the innermost term — a true roll about the view axis.
    this.camera.rotation.z = -this.lean * PlayerController.LEAN_ROLL;

    // 2. Sprint & Stamina logic. Only an upright operator sprints.
    const wantsSprint = this.input.isKeyDown('ShiftLeft') || this.input.isKeyDown('ShiftRight');
    const hasStamina = this.stamina > 5;
    this.isSprinting = wantsSprint && hasStamina && this.onGround && this.stance === 'stand';

    if (this.isSprinting) {
      this.stamina = Math.max(0, this.stamina - 26 * delta);
    } else {
      this.stamina = Math.min(this.maxStamina, this.stamina + 20 * delta);
    }

    const currentSpeed = this.isSprinting ? this.sprintSpeed : target.speed;

    // 3. Movement input vector (Bulletproof trigonometry from yaw, 0% chance of NaN)
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);

    this.forward.set(-sin, 0, -cos);
    this.right.set(cos, 0, -sin);

    this.moveDir.set(0, 0, 0);

    if (!this.isMantling) {
      // Physical key codes only — no e.key aliases. Layout-independent bindings are
      // what every FPS does, and mixing the two is what broke AZERTY here: that
      // layout's strafe-left key emits code KeyQ, so an 'a' alias would let it
      // strafe while code KeyQ simultaneously leaned the camera left.
      if (this.input.isAnyKeyDown('KeyW', 'ArrowUp')) this.moveDir.add(this.forward);
      if (this.input.isAnyKeyDown('KeyS', 'ArrowDown')) this.moveDir.sub(this.forward);
      if (this.input.isAnyKeyDown('KeyD', 'ArrowRight')) this.moveDir.add(this.right);
      if (this.input.isAnyKeyDown('KeyA', 'ArrowLeft')) this.moveDir.sub(this.right);
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
    //
    // Crouched or prone, Space stands you up one rung instead — you have to be
    // upright before you can jump or mantle.
    const spacePressed = this.input.isKeyPressed('Space');
    if (this.stance !== 'stand') {
      if (spacePressed) this.setStance(this.stance === 'prone' ? 'crouch' : 'stand');
    } else {
      const wantsMantle = spacePressed || (!this.onGround && this.input.isKeyDown('Space'));

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

    // 7b. Footsteps, from ground actually covered — walking into a wall moves the
    // capsule nowhere and so makes no noise, whatever the input says.
    if (this.onGround && !this.isMantling) {
      const dx = this.capsulePosition.x - prevX;
      const dz = this.capsulePosition.z - prevZ;
      this.strideAccum += Math.sqrt(dx * dx + dz * dz);
      const stride =
        PlayerController.STRIDE[this.stance] * (this.isSprinting ? PlayerController.SPRINT_STRIDE : 1);
      if (this.strideAccum >= stride) {
        this.strideAccum %= stride; // carry the remainder so fast steps don't drift late
        this.onFootstep?.(this.stance, this.isSprinting);
      }
    } else {
      this.strideAccum = 0; // airborne/mantling: no leftover step waiting to fire on landing
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

    // Absolute ceiling. Reach alone cannot separate the first container from a
    // second stacked on top of it: both are the same 2.6m step, so once you are
    // standing on one, jumping puts the next within the same 1.5m grab. Capping
    // the world height a mantle may finish at keeps single containers climbable
    // while stacked ones, the tower platform and the perimeter walls are not.
    // The tower stays reachable the intended way, up its ramp.
    if (ledgeY > PlayerController.MANTLE_MAX_WORLD_Y) return false;

    this.mantleEndPos.set(lipX, ledgeY + this.radius, lipZ);
    // Check against the stance's *nominal* height, not this.height: height is an
    // animated value, so mantling during a stand-up transition would otherwise test
    // a capsule up to 0.37m shorter than the one the player is about to have, and
    // accept a ledge whose headroom they don't actually fit under.
    if (!this.capsuleFitsAt(this.mantleEndPos, PlayerController.STANCES[this.stance].height)) {
      return false; // never teleport into solid geometry
    }

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

  /**
   * Requests a stance change. Standing up is refused if the taller capsule wouldn't
   * fit where the player is (under a container, inside a bunker), which is the only
   * direction that can collide — shrinking never can.
   */
  private setStance(next: 'stand' | 'crouch' | 'prone'): void {
    if (next === this.stance) return;
    const nextHeight = PlayerController.STANCES[next].height;
    if (nextHeight > this.height && !this.capsuleFitsAt(this.capsulePosition, nextHeight)) return;
    this.stance = next;
  }

  /** Shapecast clearance check: true if the capsule at `pos` doesn't intersect any triangle. */
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

    // Lean: slide the eye (and with it the viewmodel and the shot ray, both parented
    // to the camera) sideways past cover, clamped so it never passes through the wall
    // you are peeking around. `right` is this frame's basis, already built in update().
    if (Math.abs(this.lean) > 0.001) {
      let lateral = this.lean * PlayerController.LEAN_OFFSET;
      const dir = Math.sign(lateral);

      this.leanRay.origin.copy(this.camera.position);
      this.leanRay.direction.copy(this.right).multiplyScalar(dir);
      const reach = Math.abs(lateral) + PlayerController.LEAN_MARGIN;
      const hit = this.bvh.raycastFirst(this.leanRay, THREE.DoubleSide, 0, reach);
      if (hit) {
        const allowed = Math.max(0, hit.distance - PlayerController.LEAN_MARGIN);
        lateral = dir * Math.min(Math.abs(lateral), allowed);
      }

      this.camera.position.addScaledVector(this.right, lateral);
      this.camera.position.y -= Math.abs(this.lean) * 0.03; // shoulder dip
    }
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
