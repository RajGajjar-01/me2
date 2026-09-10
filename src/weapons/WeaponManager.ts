import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WeaponModels, WeaponRig, HandAsset, HAND_MODEL_PATH } from './WeaponModels';
import { SoundEngine } from '../audio/SoundEngine';
import { BulletTracerManager } from '../effects/BulletTracer';
import { TargetManager } from '../targets/TargetManager';
import { DummyManager } from '../targets/DummyManager';
import { DecalManager } from '../effects/DecalManager';
import { InputManager } from '../core/InputManager';
import { MODELS, SOUNDS } from '../assets';

export interface WeaponData {
  name: string;
  fireMode: string;
  isAuto: boolean;
  fireRate: number;
  magSize: number;
  currentAmmo: number;
  reserveAmmo: number;
  damage: number;
  adsOffset: THREE.Vector3;
  idleOffset: THREE.Vector3;
  /**
   * posZ/rotX drive the viewmodel spring. camPitch/camYaw are the real per-shot
   * aim kick in radians; `spray` picks the pattern the kick follows during a burst.
   */
  recoilForce: {
    posZ: number;
    rotX: number;
    camPitch: number;
    camYaw: number;
    spray: 'ak' | 'simple';
  };
  /** Seconds for a full reload cycle — drives both the animation and the audio cues. */
  reloadTime: number;
  /** 'mag' = detach/insert/charge cycle. 'shells' = thumb rounds into a tube, then rack. */
  reloadStyle: 'mag' | 'shells';
  /** Projectiles per trigger pull (buckshot). Defaults to 1. */
  pellets?: number;
  /** Cone half-angle in NDC units applied to pellets beyond the first. */
  pelletSpread?: number;
}

export class WeaponManager {
  public viewmodelContainer: THREE.Group = new THREE.Group();
  public currentWeaponIndex = 0;
  public isAiming = false;
  public isReloading = false;
  public isSwapping = false;

  public cameraRecoilPitch = 0;
  public cameraRecoilYaw = 0;

  /**
   * Recoil scale from the player's stance — bracing is the main reason to get low.
   * Driven from main.ts each frame; 1 standing, 0.75 crouched, 0.5 prone.
   */
  public stanceKickMult = 1;

  public totalShots = 0;
  public totalHits = 0;

  private weapons: WeaponData[] = [
    {
      name: 'AK-47',
      fireMode: 'AUTO // 7.62x39mm',
      isAuto: true,
      fireRate: 10.0, // ~600 RPM
      magSize: 30,
      currentAmmo: 30,
      reserveAmmo: 120,
      damage: 48,
      idleOffset: new THREE.Vector3(0.25, -0.285, -0.19),
      // ADS (right-click): sight height -0.125 centres the old-gun sights; Z -0.03
      // pulls the rear close so the stock drops below the frame.
      adsOffset: new THREE.Vector3(0.0, -0.125, -0.03),
      recoilForce: { posZ: 0.052, rotX: 0.08, camPitch: 0.026, camYaw: 0.012, spray: 'ak' },
      reloadTime: 2.0,
      reloadStyle: 'mag'
    },
    {
      name: 'TACTICAL GHOST',
      fireMode: 'SEMI // 9x19mm SUPPRESSED',
      isAuto: false,
      fireRate: 7.0,
      magSize: 15,
      currentAmmo: 15,
      reserveAmmo: 60,
      damage: 36,
      idleOffset: new THREE.Vector3(0.15, -0.125, -0.24),
      // ADS unchanged: grip rear (9cm behind the root, the closest point on any
      // rig to the eye) already projects below the frame while the slide/sights
      // stay centred — moving Z any closer would slice the grip on the near plane.
      adsOffset: new THREE.Vector3(0.0, -0.055, -0.18),
      recoilForce: { posZ: 0.038, rotX: 0.06, camPitch: 0.014, camYaw: 0.005, spray: 'simple' },
      reloadTime: 1.9,
      reloadStyle: 'mag'
    },
    {
      name: 'BREACHER 12G',
      fireMode: 'PUMP // 12 GAUGE BUCK',
      isAuto: false,
      fireRate: 1.2,
      magSize: 6,
      currentAmmo: 6,
      reserveAmmo: 30,
      damage: 22, // per pellet — 8 pellets on target is a one-shot kill up close
      idleOffset: new THREE.Vector3(0.20, -0.26, -0.24),
      // ADS: bead (rig top +0.0425) centred on the crosshair (was ~6% low), breech
      // drops to a bottom-edge sliver like looking down a real rib. Z pulled closer
      // (-0.10) so the butt (rear only 22mm behind the root) clears the frame bottom
      // while staying clear of the near plane even under the reload dip.
      adsOffset: new THREE.Vector3(0.0, -0.075, -0.10),
      recoilForce: { posZ: 0.085, rotX: 0.14, camPitch: 0.085, camYaw: 0.018, spray: 'simple' },
      reloadTime: 2.8,
      reloadStyle: 'shells',
      pellets: 8,
      pelletSpread: 0.055
    }
  ];

  private weaponRigs: WeaponRig[] = [];
  public soundEngine: SoundEngine;
  public tracerManager: BulletTracerManager;
  public decalManager: DecalManager;
  public targetManager: TargetManager;
  public dummyManager: DummyManager;

  private raycaster: THREE.Raycaster = new THREE.Raycaster();

  // Recoil spring
  private recoilPos = new THREE.Vector3();
  private recoilVel = new THREE.Vector3();
  private recoilRot = new THREE.Vector3();
  private recoilRotVel = new THREE.Vector3();

  // Bobbing
  private bobTimer = 0;

  // Timers
  private lastFireTime = 0;
  private flashTimer = 0;
  private reloadTimer = 0;
  private canFireSemi = true;

  // Reload choreography: gun + left-hand keyframes, with audio cues fired on the
  // exact phase boundary they belong to instead of one canned reload blob.
  private reloadDuration = 1;
  private reloadCues: { t: number; play: () => void }[] = [];
  private nextReloadCue = 0;
  private reloadAnimOffset = new THREE.Vector3();
  private reloadAnimRot = new THREE.Euler();
  private reloadArmOffset = new THREE.Vector3();
  private reloadArmRot = new THREE.Euler();
  private boltPull = 0;

  // Valorant-style Weapon Switch State Machine
  private swapState: 'idle' | 'holster' | 'equip' = 'idle';
  private swapTimer = 0;
  private swapDuration = 0;
  private pendingWeaponIndex = 0;
  private previousWeaponIndex = 0;
  private swapAnimOffset = new THREE.Vector3();
  private swapAnimRot = new THREE.Euler();

  // Visual offsets
  private currentOffset = new THREE.Vector3();
  private targetOffset = new THREE.Vector3();

  // Zero-allocation pre-allocated math cache (0 bytes GC churn during full-auto)
  private readonly _muzzleWorld = new THREE.Vector3();
  private readonly _chamberWorld = new THREE.Vector3();
  private readonly _rayDir = new THREE.Vector3();
  private readonly _targetPoint = new THREE.Vector3();
  private readonly _normalFallback = new THREE.Vector3(0, 1, 0);
  private readonly _shotPoint = new THREE.Vector2(0, 0);

  // Events
  public onAmmoChange?: (current: number, reserve: number, name: string, mode: string) => void;
  public onStatsUpdate?: (shots: number, hits: number, accuracy: number) => void;
  public onRecoilTelemetry?: (spreadX: number, spreadY: number, isHit: boolean) => void;
  /** Per-shot aim kick in radians (+pitch = up, +yaw = left). Wired to PlayerController.applyRecoil. */
  public onRecoil?: (pitchDelta: number, yawDelta: number) => void;

  // Sustained-fire escalation: index of the current shot within the burst.
  private burstShot = 0;
  private static readonly BURST_RESET = 0.35;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private input: InputManager,
    private scene: THREE.Scene,
    private worldCollider: THREE.Mesh
  ) {
    this.camera.add(this.viewmodelContainer);
    (this.raycaster as any).firstHitOnly = true;

    this.soundEngine = new SoundEngine();
    this.tracerManager = new BulletTracerManager(scene);
    this.decalManager = new DecalManager(scene);
    this.targetManager = new TargetManager(scene, this.soundEngine);
    this.dummyManager = new DummyManager(scene, this.soundEngine);

    // Build initial 3D rigs
    const akRig = WeaponModels.createRifleRig();
    const pistolRig = WeaponModels.createPistolRig();
    const shotgunRig = WeaponModels.createRifleRig(); // placeholder until the GLB lands

    this.weaponRigs.push(akRig, pistolRig, shotgunRig);
    this.viewmodelContainer.add(akRig.root);
    this.viewmodelContainer.add(pistolRig.root);
    this.viewmodelContainer.add(shotgunRig.root);

    this.selectWeapon(0, false);
  }

  /**
   * Loads high-fidelity 3D weapon models asynchronously.
   * Hot-swaps the authentic photorealistic AK-47 and Tactical Silenced Ghost Sidearm models into the viewmodel.
   */
  public async loadAssets(onProgress?: (status: string) => void): Promise<void> {
    onProgress?.('LOADING OPERATOR HANDS...');
    let handAsset: HandAsset | undefined;
    try {
      const handLoader = new GLTFLoader();
      const handGltf = await handLoader.loadAsync(HAND_MODEL_PATH);
      handAsset = { scene: handGltf.scene, clip: handGltf.animations[0] };
    } catch (err) {
      console.warn('Failed to load hand model, falling back to block-glove arms:', err);
    }

    onProgress?.('LOADING AUTHENTIC AK-47 3D MODEL...');
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(MODELS.ak47);

      // Build real AK-47 rig with articulated operator arms and calibrated sightline
      const realAkRig = WeaponModels.createRealAKRig(gltf.scene, handAsset);

      // Swap out procedural rig
      const oldRig = this.weaponRigs[0];
      if (oldRig) {
        this.viewmodelContainer.remove(oldRig.root);
      }

      this.weaponRigs[0] = realAkRig;
      this.viewmodelContainer.add(realAkRig.root);
      realAkRig.root.visible = (this.currentWeaponIndex === 0);

      onProgress?.('AUTHENTIC AK-47 EQUIPPED');
    } catch (err) {
      console.warn('Failed to load authentic AK-47 GLB model, using procedural fallback:', err);
    }

    onProgress?.('LOADING TACTICAL SILENCED SIDEARM...');
    try {
      const loader = new GLTFLoader();
      const pistolGltf = await loader.loadAsync(MODELS.pistol);

      // Build real pistol rig with operator arms & suppressed muzzle alignment
      const realPistolRig = WeaponModels.createRealPistolRig(pistolGltf.scene, handAsset);

      const oldRig = this.weaponRigs[1];
      if (oldRig) {
        this.viewmodelContainer.remove(oldRig.root);
      }

      this.weaponRigs[1] = realPistolRig;
      this.viewmodelContainer.add(realPistolRig.root);
      realPistolRig.root.visible = (this.currentWeaponIndex === 1);

      onProgress?.('TACTICAL GHOST SIDEARM EQUIPPED');
    } catch (err) {
      console.warn('Failed to load pistol.glb model, using procedural fallback:', err);
    }

    onProgress?.('LOADING 12-GAUGE BREACHING SHOTGUN...');
    try {
      const loader = new GLTFLoader();
      const shotgunGltf = await loader.loadAsync(MODELS.shotgun);

      const realShotgunRig = WeaponModels.createRealShotgunRig(shotgunGltf.scene, handAsset);

      const oldRig = this.weaponRigs[2];
      if (oldRig) {
        this.viewmodelContainer.remove(oldRig.root);
      }

      this.weaponRigs[2] = realShotgunRig;
      this.viewmodelContainer.add(realShotgunRig.root);
      realShotgunRig.root.visible = (this.currentWeaponIndex === 2);

      onProgress?.('BREACHER 12G EQUIPPED');
    } catch (err) {
      console.warn('Failed to load shotgun.glb model, using procedural fallback:', err);
    }

    await this.soundEngine.loadSamples(
      SOUNDS,
      onProgress
    );

    onProgress?.('DEPLOYING TACTICAL COMBAT DUMMIES...');
    await this.dummyManager.loadCharacterModel();
  }

  /**
   * Triggers Valorant-style two-phase weapon switch:
   * 1. Holster phase: Current weapon quickly dips down and rolls away (120ms)
   * 2. Equip phase: New weapon whips up with snappy cocking flourish and mechanical audio (360ms)
   */
  public selectWeapon(index: number, playSound = true): void {
    if (index < 0 || index >= this.weapons.length) return;
    if (index === this.currentWeaponIndex && this.swapState === 'idle') return;
    if (this.swapState === 'holster' && this.pendingWeaponIndex === index) return;

    if (this.isReloading) this.clearReloadAnim(this.weaponRigs[this.currentWeaponIndex]);
    this.isReloading = false;
    this.isSwapping = true;
    this.pendingWeaponIndex = index;

    // Begin fast holster drop
    this.swapState = 'holster';
    this.swapTimer = 0.12;
    this.swapDuration = 0.12;

    if (playSound) {
      // Trigger subtle movement rustle if needed
    }
  }

  public update(delta: number, playerSpeed: number, onGround: boolean): void {
    const weapon = this.weapons[this.currentWeaponIndex];
    const rig = this.weaponRigs[this.currentWeaponIndex];

    // 1. Weapon swap inputs (Keys 1, 2, Q quick-switch, and Mouse Scroll Wheel)
    if (this.input.isKeyPressed('Digit1')) this.selectWeapon(0);
    if (this.input.isKeyPressed('Digit2')) this.selectWeapon(1);
    if (this.input.isKeyPressed('Digit3')) this.selectWeapon(2);
    if (this.input.isKeyPressed('KeyX')) {
      this.selectWeapon(
        this.previousWeaponIndex === this.currentWeaponIndex
          ? (this.currentWeaponIndex + 1) % this.weapons.length
          : this.previousWeaponIndex
      );
    }
    const wheel = this.input.consumeWheelDelta();
    if (wheel !== 0) {
      const n = this.weapons.length;
      this.selectWeapon((this.currentWeaponIndex + (wheel > 0 ? 1 : n - 1)) % n);
    }

    // 2. Handle ADS
    this.isAiming = this.input.isMouseDown(2) && !this.isReloading && !this.isSwapping;
    this.targetOffset.copy(this.isAiming ? weapon.adsOffset : weapon.idleOffset);

    // ADS zoom (right-click): 48° FOV.
    const targetFov = this.isAiming ? 48 : 75;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 14 * delta);
    this.camera.updateProjectionMatrix();

    // 3. Firing Logic
    const isFireDown = this.input.isMouseDown(0);
    const now = performance.now() / 1000;
    const fireInterval = 1.0 / weapon.fireRate;

    const canFire = isFireDown && !this.isReloading && !this.isSwapping;

    if (canFire) {
      if (weapon.isAuto || this.canFireSemi) {
        if (now - this.lastFireTime >= fireInterval) {
          this.shoot(now);
          if (!weapon.isAuto) this.canFireSemi = false;
        }
      }
    } else {
      this.canFireSemi = true;
    }


    // 4. Reload Logic
    if (this.input.isKeyPressed('KeyR') && !this.isReloading && !this.isSwapping) {
      if (weapon.currentAmmo < weapon.magSize && weapon.reserveAmmo > 0) {
        this.startReload();
      }
    }

    if (this.isReloading) {
      this.reloadTimer -= delta;
      const t = Math.min(1, Math.max(0, 1 - this.reloadTimer / this.reloadDuration));

      while (this.nextReloadCue < this.reloadCues.length && t >= this.reloadCues[this.nextReloadCue].t) {
        this.reloadCues[this.nextReloadCue++].play();
      }
      this.updateReloadAnim(t, weapon, rig);

      if (this.reloadTimer <= 0) {
        this.completeReload();
      }
    }

    // 5. Valorant-Style Weapon Switch Animation Update
    if (this.swapState === 'holster') {
      this.swapTimer -= delta;
      const t = Math.min(1.0, Math.max(0.0, 1.0 - this.swapTimer / this.swapDuration));
      const ease = t * t;
      // Gun dips down and rolls away
      this.swapAnimOffset.set(0.03 * ease, -0.25 * ease, 0.05 * ease);
      this.swapAnimRot.set(0.35 * ease, -0.12 * ease, -0.22 * ease);

      if (this.swapTimer <= 0) {
        // Swap active mesh
        this.weaponRigs[this.currentWeaponIndex].root.visible = false;
        this.previousWeaponIndex = this.currentWeaponIndex;
        this.currentWeaponIndex = this.pendingWeaponIndex;
        this.weaponRigs[this.currentWeaponIndex].root.visible = true;

        // Enter equip phase with Valorant snappy flourish
        this.swapState = 'equip';
        this.swapTimer = 0.36;
        this.swapDuration = 0.36;

        this.soundEngine.playWeaponEquip(this.currentWeaponIndex);
        this.notifyAmmo();

        // Crosshair bloom on weapon equip
        const hud = document.getElementById('hud');
        if (hud) {
          hud.classList.add('spread-fire');
          setTimeout(() => hud.classList.remove('spread-fire'), 120);
        }
      }
    } else if (this.swapState === 'equip') {
      this.swapTimer -= delta;
      const t = Math.min(1.0, Math.max(0.0, 1.0 - this.swapTimer / this.swapDuration));
      // Snappy cubic ease with overshoot flourish
      const blend = 1.0 - Math.pow(1.0 - t, 3);
      const overshoot = Math.sin(t * Math.PI) * (1.0 - t);

      const curY = THREE.MathUtils.lerp(-0.28, 0.0, blend) + overshoot * 0.04;
      const curRotX = THREE.MathUtils.lerp(0.55, 0.0, blend) - overshoot * 0.12;
      const curRotY = THREE.MathUtils.lerp(-0.22, 0.0, blend);
      const curRotZ = THREE.MathUtils.lerp(0.20, 0.0, blend);

      this.swapAnimOffset.set(0, curY, 0);
      this.swapAnimRot.set(curRotX, curRotY, curRotZ);

      if (this.swapTimer <= 0) {
        this.swapState = 'idle';
        this.isSwapping = false;
        this.swapAnimOffset.set(0, 0, 0);
        this.swapAnimRot.set(0, 0, 0);
      }
    }

    // 5. Spring Recoil Physics
    const stiffness = 240;
    const damping = 20;

    this.recoilVel.x += (-this.recoilPos.x * stiffness - this.recoilVel.x * damping) * delta;
    this.recoilVel.y += (-this.recoilPos.y * stiffness - this.recoilVel.y * damping) * delta;
    this.recoilVel.z += (-this.recoilPos.z * stiffness - this.recoilVel.z * damping) * delta;

    this.recoilPos.addScaledVector(this.recoilVel, delta);

    this.recoilRotVel.x += (-this.recoilRot.x * stiffness - this.recoilRotVel.x * damping) * delta;
    this.recoilRotVel.y += (-this.recoilRot.y * stiffness - this.recoilRotVel.y * damping) * delta;
    this.recoilRotVel.z += (-this.recoilRot.z * stiffness - this.recoilRotVel.z * damping) * delta;

    this.recoilRot.addScaledVector(this.recoilRotVel, delta);

    this.cameraRecoilPitch = THREE.MathUtils.lerp(this.cameraRecoilPitch, 0, 16 * delta);
    this.cameraRecoilYaw = THREE.MathUtils.lerp(this.cameraRecoilYaw, 0, 16 * delta);

    // 6. View Bobbing
    if (playerSpeed > 0.5 && onGround && !this.isAiming) {
      this.bobTimer += delta * 11.0;
    } else {
      this.bobTimer = 0;
    }
    const bobX = Math.cos(this.bobTimer * 0.5) * (this.isAiming ? 0.001 : 0.012);
    const bobY = Math.abs(Math.sin(this.bobTimer)) * (this.isAiming ? 0.002 : 0.016);

    // 7. Muzzle Flash expiration
    if (this.flashTimer > 0) {
      this.flashTimer -= delta;
      if (this.flashTimer <= 0) {
        rig.muzzleFlash.visible = false;
        rig.flashLight.intensity = 0;
        if (rig.slideOrBolt) {
          rig.slideOrBolt.position.z = 0;
        }
      }
    }

    // 8. Blend weapon container transforms
    const lerpSpeed = this.isAiming ? 20 : 12;
    this.currentOffset.lerp(this.targetOffset, lerpSpeed * delta);

    this.viewmodelContainer.position.set(
      this.currentOffset.x + this.recoilPos.x + bobX + this.swapAnimOffset.x + this.reloadAnimOffset.x,
      this.currentOffset.y + this.recoilPos.y + this.swapAnimOffset.y + bobY + this.reloadAnimOffset.y,
      this.currentOffset.z + this.recoilPos.z + this.swapAnimOffset.z + this.reloadAnimOffset.z
    );

    this.viewmodelContainer.rotation.set(
      this.recoilRot.x + this.swapAnimRot.x + this.reloadAnimRot.x,
      this.recoilRot.y + this.swapAnimRot.y + this.reloadAnimRot.y,
      this.recoilRot.z + this.swapAnimRot.z + this.reloadAnimRot.z
    );

    // Left hand leaves the handguard during a reload; the rig arms are plain groups
    // so the whole arm is driven as one piece.
    rig.leftArm.position.copy(this.reloadArmOffset);
    rig.leftArm.rotation.copy(this.reloadArmRot);

    // Charging handle / bolt carrier travel (shared with the per-shot cycling kick)
    if (rig.slideOrBolt && this.boltPull > 0) {
      rig.slideOrBolt.position.z = this.boltPull;
    }

    // 9. Update effects & targets
    this.tracerManager.update(delta);
    this.decalManager.update(delta);
    this.targetManager.update(delta);
    this.dummyManager.update(delta);
  }

  private shoot(now: number): void {
    const weapon = this.weapons[this.currentWeaponIndex];
    const rig = this.weaponRigs[this.currentWeaponIndex];

    // A gap in the trigger pull resets the spray pattern back to shot 1.
    if (now - this.lastFireTime > WeaponManager.BURST_RESET) this.burstShot = 0;

    if (weapon.currentAmmo <= 0) {
      this.soundEngine.playDryFire();
      this.lastFireTime = now;
      return;
    }

    weapon.currentAmmo--;
    this.totalShots++;
    this.lastFireTime = now;
    this.notifyAmmo();

    if (this.currentWeaponIndex === 0) {
      this.soundEngine.playRifleShot();
    } else if (this.currentWeaponIndex === 2) {
      this.soundEngine.playShotgunShot();
    } else {
      this.soundEngine.playPistolShot();
    }

    // Recoil impulse
    const kickMult = (this.isAiming ? 0.75 : 1.0) * this.stanceKickMult;
    const n = this.burstShot;
    // Consecutive shots hit harder; caps out so a full mag stays controllable.
    const escalate = 1 + Math.min(n, 9) * 0.11;

    this.recoilVel.z += weapon.recoilForce.posZ * 4.4 * kickMult * escalate;
    this.recoilVel.y += weapon.recoilForce.posZ * 1.3 * kickMult * escalate;
    this.recoilRotVel.x += weapon.recoilForce.rotX * 5.2 * kickMult * escalate;
    this.recoilRotVel.z += (Math.random() - 0.5) * 0.08 * kickMult; // authentic barrel torque twist
    this.recoilRotVel.y += (Math.random() - 0.5) * 0.05 * kickMult;

    // --- Real aim kick: this actually moves where the player is pointing ---
    const rc = weapon.recoilForce;
    const adsMult = (this.isAiming ? 0.55 : 1.0) * this.stanceKickMult;
    let pitchKick = rc.camPitch * escalate * adsMult * (0.88 + Math.random() * 0.24);
    let yawKick: number;

    if (rc.spray === 'ak') {
      // First rounds go near-vertical, then the muzzle starts snaking left/right.
      const snake = n < 5 ? (Math.random() - 0.5) * 0.5 : Math.sin((n - 5) * 0.85) * 1.9;
      yawKick = rc.camYaw * snake * adsMult * (0.85 + Math.random() * 0.3);
      // Climb tapers a touch once the pattern goes horizontal
      if (n >= 6) pitchKick *= 0.78;
    } else {
      yawKick = rc.camYaw * (Math.random() - 0.5) * 2 * adsMult;
    }

    this.onRecoil?.(pitchKick, yawKick);
    this.burstShot++;

    // Telemetry-only decaying trace of the kick
    this.cameraRecoilPitch += pitchKick;
    this.cameraRecoilYaw += yawKick;

    if (rig.slideOrBolt) {
      rig.slideOrBolt.position.z = 0.038;
    }

    // Dynamic Volumetric Muzzle Flash
    rig.muzzleFlash.visible = true;
    rig.muzzleFlash.rotation.z = Math.random() * Math.PI * 2;
    const flashScale = (this.isAiming ? 0.72 : 1.05) * (0.9 + Math.random() * 0.3);
    rig.muzzleFlash.scale.set(flashScale, flashScale, flashScale);
    rig.flashLight.intensity = 55;
    this.flashTimer = 0.042;

    // Compute Muzzle & Chamber world positions (zero-allocation)
    rig.muzzleFlash.getWorldPosition(this._muzzleWorld);
    this.viewmodelContainer.localToWorld(this._chamberWorld.copy(rig.chamberPos));

    // Spawn tumbling brass shell casing & expanding propellant gas smoke
    this.tracerManager.spawnShell(this._chamberWorld, this.camera.rotation);
    this.tracerManager.spawnMuzzleSmoke(this._muzzleWorld, this.camera.rotation);

    // Buckshot fires a cone of pellets; everything else is a single centred round.
    const pellets = weapon.pellets ?? 1;
    const spread = weapon.pelletSpread ?? 0;
    let hasHit = false;
    let headshot = false;

    for (let p = 0; p < pellets; p++) {
      if (p === 0 || spread === 0) {
        this._shotPoint.set(0, 0);
      } else {
        // Uniform disc sample so pellets don't clump on the centre
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * spread;
        this._shotPoint.set(Math.cos(a) * r, Math.sin(a) * r);
      }

      const res = this.tracePellet(weapon);
      if (res.hit) {
        hasHit = true;
        headshot = headshot || res.headshot;
      }
    }

    if (hasHit) {
      this.totalHits++;
      this.triggerHitmarker(headshot);
    }

    // Telemetry Graph Callback for Recoil Pattern & Spread Dispersion
    if (this.onRecoilTelemetry) {
      const spreadX = (Math.random() - 0.5) * (this.isAiming ? 0.25 : 0.8) + this.cameraRecoilYaw * 12;
      const spreadY = (Math.random() - 0.2) * (this.isAiming ? 0.35 : 1.1) + this.cameraRecoilPitch * 16;
      this.onRecoilTelemetry(spreadX, spreadY, hasHit);
    }

    // Crosshair bloom
    const hud = document.getElementById('hud');
    if (hud) {
      hud.classList.add('spread-fire');
      setTimeout(() => hud.classList.remove('spread-fire'), 75);
    }

    // Notify Stats
    if (this.onStatsUpdate) {
      const acc = this.totalShots > 0 ? (this.totalHits / this.totalShots) * 100 : 0;
      this.onStatsUpdate(this.totalShots, this.totalHits, acc);
    }
  }

  /**
   * Traces one projectile through the same priority chain as before
   * (dummies -> steel plates -> world -> downrange) using the aim point in
   * this._shotPoint, and spawns its tracer/decal. Called once per pellet.
   */
  private tracePellet(weapon: WeaponData): { hit: boolean; headshot: boolean } {
    this.raycaster.setFromCamera(this._shotPoint, this.camera);

    // 1. Human Combat Dummies
    const dummyHits = this.raycaster.intersectObjects(this.dummyManager.hitboxMeshes, false);
    if (dummyHits.length > 0) {
      const hit = dummyHits[0];
      const res = this.dummyManager.registerHit(hit.object as THREE.Mesh, hit.point, weapon.damage);
      this.tracerManager.spawnTracer(this._muzzleWorld, hit.point);
      this.decalManager.spawnBulletHole(hit.point, hit.face ? hit.face.normal : this._normalFallback);
      return { hit: true, headshot: res.isHeadshot };
    }

    // 2. Steel Plate Silhouette Targets
    const targetHits = this.raycaster.intersectObjects(this.targetManager.targetMeshes, false);
    if (targetHits.length > 0) {
      const hit = targetHits[0];
      this.targetManager.registerHit(hit.object as THREE.Mesh, hit.point);
      this.tracerManager.spawnTracer(this._muzzleWorld, hit.point);
      return { hit: true, headshot: false };
    }

    // 3. World Obstacles / Ground (BVH Accelerated)
    const worldHits = this.raycaster.intersectObject(this.worldCollider, false);
    if (worldHits.length > 0) {
      const hit = worldHits[0];
      this.tracerManager.spawnTracer(this._muzzleWorld, hit.point);
      this.decalManager.spawnBulletHole(hit.point, hit.face ? hit.face.normal : this._normalFallback);
      return { hit: false, headshot: false };
    }

    // 4. Fly down-range into the distance
    this._rayDir.copy(this.raycaster.ray.direction);
    this._targetPoint.copy(this.camera.position).addScaledVector(this._rayDir, 80);
    this.tracerManager.spawnTracer(this._muzzleWorld, this._targetPoint);
    return { hit: false, headshot: false };
  }

  private triggerHitmarker(isHeadshot = false): void {
    const hm = document.getElementById('hitmarker');
    if (!hm) return;

    if (isHeadshot) {
      hm.classList.add('headshot');
    } else {
      hm.classList.remove('headshot');
    }

    hm.classList.remove('hitmarker-hidden');
    setTimeout(() => {
      hm.classList.add('hitmarker-hidden');
    }, isHeadshot ? 180 : 120);
  }

  /** Linear keyframe sampler: pts are [t, value] pairs in ascending t over 0..1. */
  private static kf(t: number, pts: number[][]): number {
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i][0]) {
        const [t0, v0] = pts[i - 1];
        const [t1, v1] = pts[i];
        const k = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
        // Smoothstep between keys so the hands ease instead of snapping
        return v0 + (v1 - v0) * (k * k * (3 - 2 * k));
      }
    }
    return pts[pts.length - 1][1];
  }

  /**
   * Drives the reload pose for the current normalized progress t (0..1).
   *
   * Magazine cycle: the gun cants inboard and drops out of the sightline while the
   * support hand strips the empty mag, disappears below frame to fetch a fresh one,
   * rocks it in with a seating jolt, then travels up to rack the charging handle.
   *
   * Shell cycle: the shotgun rolls over to expose the loading port, the support hand
   * thumbs rounds in one at a time, then racks the forend to chamber.
   */
  private updateReloadAnim(t: number, weapon: WeaponData, rig: WeaponRig): void {
    const kf = WeaponManager.kf;

    if (weapon.reloadStyle === 'shells') {
      this.reloadAnimOffset.set(
        kf(t, [[0, 0], [0.14, 0.05], [0.88, 0.05], [1, 0]]),
        kf(t, [[0, 0], [0.14, -0.12], [0.86, -0.12], [0.92, -0.03], [1, 0]]),
        kf(t, [[0, 0], [0.14, 0.04], [0.88, 0.02], [1, 0]])
      );
      this.reloadAnimRot.set(
        kf(t, [[0, 0], [0.14, 0.22], [0.86, 0.2], [1, 0]]),
        kf(t, [[0, 0], [0.14, -0.3], [0.86, -0.28], [1, 0]]),
        kf(t, [[0, 0], [0.14, -0.62], [0.86, -0.6], [0.93, 0.08], [1, 0]])
      );

      // Support hand shuttles between the shell carrier and the loading port
      const shells = Math.max(1, weapon.magSize - 1);
      const feedStart = 0.18;
      const feedEnd = 0.82;
      const cycle = ((t - feedStart) / ((feedEnd - feedStart) / shells)) % 1;
      const inFeed = t > feedStart && t < feedEnd;
      const reach = inFeed ? Math.sin(Math.max(0, cycle) * Math.PI) : 0;

      this.reloadArmOffset.set(-0.02 * reach, -0.16 + 0.16 * reach, 0.12 * reach);
      this.reloadArmRot.set(0.5 * reach, 0, 0);

      // Forend rack on the tail end
      const rack = kf(t, [[0.86, 0], [0.92, 1], [0.98, 0], [1, 0]]);
      this.reloadArmOffset.z += 0.09 * rack;
      this.boltPull = 0.05 * rack;
      return;
    }

    // --- Magazine cycle ---
    this.reloadAnimOffset.set(
      kf(t, [[0, 0], [0.16, 0.07], [0.62, 0.06], [0.8, 0.02], [1, 0]]),
      kf(t, [[0, 0], [0.16, -0.16], [0.55, -0.19], [0.66, -0.08], [0.72, -0.12], [1, 0]]),
      kf(t, [[0, 0], [0.16, 0.06], [0.7, 0.04], [1, 0]])
    );
    this.reloadAnimRot.set(
      kf(t, [[0, 0], [0.16, 0.46], [0.6, 0.44], [0.68, 0.18], [1, 0]]),
      kf(t, [[0, 0], [0.16, -0.34], [0.66, -0.3], [1, 0]]),
      kf(t, [[0, 0], [0.16, -0.58], [0.6, -0.55], [0.68, -0.2], [1, 0]])
    );

    // Support hand: strip mag -> below frame -> seat new mag -> charging handle
    this.reloadArmOffset.set(
      kf(t, [[0, 0], [0.18, -0.03], [0.34, -0.06], [0.5, -0.04], [0.66, 0], [0.82, 0.04], [1, 0]]),
      kf(t, [[0, 0], [0.18, -0.1], [0.34, -0.34], [0.5, -0.3], [0.64, -0.02], [0.7, -0.06], [0.82, 0.05], [1, 0]]),
      kf(t, [[0, 0], [0.18, 0.14], [0.34, 0.2], [0.5, 0.18], [0.66, 0.12], [0.78, 0.16], [0.88, 0.24], [1, 0]])
    );
    this.reloadArmRot.set(
      kf(t, [[0, 0], [0.34, 0.6], [0.62, 0.35], [0.82, -0.1], [1, 0]]),
      0,
      kf(t, [[0, 0], [0.34, -0.2], [0.7, -0.1], [1, 0]])
    );

    // Charging handle travel at the end of the cycle
    this.boltPull = 0.055 * kf(t, [[0.78, 0], [0.85, 1], [0.9, 0], [1, 0]]);
    void rig;
  }

  private clearReloadAnim(rig: WeaponRig): void {
    this.reloadAnimOffset.set(0, 0, 0);
    this.reloadAnimRot.set(0, 0, 0);
    this.reloadArmOffset.set(0, 0, 0);
    this.reloadArmRot.set(0, 0, 0);
    this.boltPull = 0;
    rig.leftArm.position.set(0, 0, 0);
    rig.leftArm.rotation.set(0, 0, 0);
    if (rig.slideOrBolt) rig.slideOrBolt.position.z = 0;
  }

  private startReload(): void {
    const weapon = this.weapons[this.currentWeaponIndex];

    this.isReloading = true;
    this.reloadDuration = weapon.reloadTime;
    this.reloadTimer = weapon.reloadTime;
    this.nextReloadCue = 0;

    const snd = this.soundEngine;

    if (weapon.reloadStyle === 'shells') {
      // One audible shell per round actually being fed, then the forend rack
      const missing = Math.min(weapon.magSize - weapon.currentAmmo, weapon.reserveAmmo);
      const cues: { t: number; play: () => void }[] = [];
      for (let i = 0; i < missing; i++) {
        cues.push({ t: 0.2 + (0.6 * i) / Math.max(1, missing), play: () => snd.playShellInsert() });
      }
      cues.push({ t: 0.88, play: () => snd.playPumpRack() });
      this.reloadCues = cues;
    } else {
      // The recorded take already contains the whole mag-out/mag-in/charge sequence,
      // so it plays as one cue; only the synthesized fallback needs phase-by-phase cues.
      this.reloadCues = [
        {
          t: 0.02,
          play: () => {
            if (snd.playReloadCycle()) return;
            snd.playMagRelease();
          }
        },
        { t: 0.2, play: () => { if (!snd.hasSample('reload')) snd.playMagOut(); } },
        { t: 0.6, play: () => { if (!snd.hasSample('reload')) snd.playMagIn(); } },
        { t: 0.82, play: () => { if (!snd.hasSample('reload')) snd.playBoltRack(); } }
      ];
    }
  }

  private completeReload(): void {
    const weapon = this.weapons[this.currentWeaponIndex];
    this.clearReloadAnim(this.weaponRigs[this.currentWeaponIndex]);
    const needed = weapon.magSize - weapon.currentAmmo;
    const toReload = Math.min(needed, weapon.reserveAmmo);
    weapon.currentAmmo += toReload;
    weapon.reserveAmmo -= toReload;
    this.isReloading = false;
    this.notifyAmmo();
  }

  public notifyAmmo(): void {
    const weapon = this.weapons[this.currentWeaponIndex];
    if (this.onAmmoChange) {
      this.onAmmoChange(weapon.currentAmmo, weapon.reserveAmmo, weapon.name, weapon.fireMode);
    }
  }
}
