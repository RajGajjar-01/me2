import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { WeaponModels, WeaponRig } from './WeaponModels';
import { SoundEngine } from '../audio/SoundEngine';
import { BulletTracerManager } from '../effects/BulletTracer';
import { TargetManager } from '../targets/TargetManager';
import { DummyManager } from '../targets/DummyManager';
import { DecalManager } from '../effects/DecalManager';
import { InputManager } from '../core/InputManager';

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
  recoilForce: { posZ: number; rotX: number };
}

export class WeaponManager {
  public viewmodelContainer: THREE.Group = new THREE.Group();
  public currentWeaponIndex = 0;
  public isAiming = false;
  public isReloading = false;
  public isSwapping = false;

  public cameraRecoilPitch = 0;
  public cameraRecoilYaw = 0;

  public totalShots = 0;
  public totalHits = 0;

  private weapons: WeaponData[] = [
    {
      name: 'AK-47',
      fireMode: 'AUTO // 7.62x39mm',
      isAuto: true,
      fireRate: 10.0,
      magSize: 30,
      currentAmmo: 30,
      reserveAmmo: 120,
      damage: 48,
      idleOffset: new THREE.Vector3(0.18, -0.20, -0.26),
      adsOffset: new THREE.Vector3(0.0, -0.142, -0.18),
      recoilForce: { posZ: 0.052, rotX: 0.08 }
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
      idleOffset: new THREE.Vector3(0.13, -0.15, -0.24),
      adsOffset: new THREE.Vector3(0.0, -0.055, -0.18),
      recoilForce: { posZ: 0.038, rotX: 0.06 }
    }
  ];

  private weaponRigs: WeaponRig[] = [];
  public soundEngine: SoundEngine;
  public tracerManager: BulletTracerManager;
  public decalManager: DecalManager;
  public targetManager: TargetManager;
  public dummyManager: DummyManager;

  private raycaster: THREE.Raycaster = new THREE.Raycaster();
  private screenCenter: THREE.Vector2 = new THREE.Vector2(0, 0);

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

  // Events
  public onAmmoChange?: (current: number, reserve: number, name: string, mode: string) => void;
  public onStatsUpdate?: (shots: number, hits: number, accuracy: number) => void;
  public onRecoilTelemetry?: (spreadX: number, spreadY: number, isHit: boolean) => void;

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

    this.weaponRigs.push(akRig, pistolRig);
    this.viewmodelContainer.add(akRig.root);
    this.viewmodelContainer.add(pistolRig.root);

    this.selectWeapon(0, false);
  }

  /**
   * Loads high-fidelity 3D weapon models asynchronously.
   * Hot-swaps the authentic photorealistic AK-47 and Tactical Silenced Ghost Sidearm models into the viewmodel.
   */
  public async loadAssets(onProgress?: (status: string) => void): Promise<void> {
    onProgress?.('LOADING AUTHENTIC AK-47 3D MODEL...');
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync('/models/ak47.glb');

      // Build real AK-47 rig with articulated operator arms and calibrated sightline
      const realAkRig = WeaponModels.createRealAKRig(gltf.scene);

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
      const pistolGltf = await loader.loadAsync('/models/pistol.glb');

      // Build real pistol rig with operator arms & suppressed muzzle alignment
      const realPistolRig = WeaponModels.createRealPistolRig(pistolGltf.scene);

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
    if (this.input.isKeyPressed('KeyQ')) {
      this.selectWeapon(this.previousWeaponIndex === this.currentWeaponIndex ? (this.currentWeaponIndex === 0 ? 1 : 0) : this.previousWeaponIndex);
    }
    const wheel = this.input.consumeWheelDelta();
    if (wheel !== 0) {
      this.selectWeapon(this.currentWeaponIndex === 0 ? 1 : 0);
    }

    // 2. Handle ADS
    this.isAiming = this.input.isMouseDown(2) && !this.isReloading && !this.isSwapping;
    this.targetOffset.copy(this.isAiming ? weapon.adsOffset : weapon.idleOffset);

    const targetFov = this.isAiming ? 54 : 75;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 14 * delta);
    this.camera.updateProjectionMatrix();

    // 3. Firing Logic
    const isFireDown = this.input.isMouseDown(0);
    const now = performance.now() / 1000;
    const fireInterval = 1.0 / weapon.fireRate;

    if (isFireDown && !this.isReloading && !this.isSwapping) {
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
      this.currentOffset.x + this.recoilPos.x + bobX + this.swapAnimOffset.x,
      this.currentOffset.y + this.recoilPos.y - (this.isReloading ? 0.1 : 0) + this.swapAnimOffset.y + bobY,
      this.currentOffset.z + this.recoilPos.z + this.swapAnimOffset.z
    );

    this.viewmodelContainer.rotation.set(
      this.recoilRot.x + this.swapAnimRot.x,
      this.recoilRot.y + this.swapAnimRot.y,
      this.recoilRot.z + (this.isReloading ? -0.25 : 0) + this.swapAnimRot.z
    );

    // 9. Update effects & targets
    this.tracerManager.update(delta);
    this.decalManager.update(delta);
    this.targetManager.update(delta);
    this.dummyManager.update(delta);
  }

  private shoot(now: number): void {
    const weapon = this.weapons[this.currentWeaponIndex];
    const rig = this.weaponRigs[this.currentWeaponIndex];

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
    } else {
      this.soundEngine.playPistolShot();
    }

    // Recoil impulse
    const kickMult = this.isAiming ? 0.75 : 1.0;
    this.recoilVel.z += weapon.recoilForce.posZ * 4.4 * kickMult;
    this.recoilVel.y += weapon.recoilForce.posZ * 1.3 * kickMult;
    this.recoilRotVel.x += weapon.recoilForce.rotX * 5.2 * kickMult;
    this.recoilRotVel.z += (Math.random() - 0.5) * 0.08 * kickMult; // authentic barrel torque twist
    this.recoilRotVel.y += (Math.random() - 0.5) * 0.05 * kickMult;

    this.cameraRecoilPitch += (this.isAiming ? 0.015 : 0.026);
    this.cameraRecoilYaw += (Math.random() - 0.5) * (this.isAiming ? 0.007 : 0.014);

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

    // Raycast hit detection from screen center
    this.raycaster.setFromCamera(this.screenCenter, this.camera);

    let hasHit = false;

    // 1. Test Human Combat Dummies First
    const dummyHits = this.raycaster.intersectObjects(this.dummyManager.hitboxMeshes, false);

    if (dummyHits.length > 0) {
      const hit = dummyHits[0];
      this.totalHits++;
      hasHit = true;

      const res = this.dummyManager.registerHit(hit.object as THREE.Mesh, hit.point, weapon.damage);
      this.tracerManager.spawnTracer(this._muzzleWorld, hit.point);
      const normal = hit.face ? hit.face.normal : this._normalFallback;
      this.decalManager.spawnBulletHole(hit.point, normal);
      this.triggerHitmarker(res.isHeadshot);
    } else {
      // 2. Test Steel Plate Silhouette Targets
      const targetHits = this.raycaster.intersectObjects(this.targetManager.targetMeshes, false);

      if (targetHits.length > 0) {
        const hit = targetHits[0];
        this.totalHits++;
        hasHit = true;

        // Register target hit & spring knockback
        this.targetManager.registerHit(hit.object as THREE.Mesh, hit.point);

        // Spawn tracer to target
        this.tracerManager.spawnTracer(this._muzzleWorld, hit.point);

        // Trigger on-screen Hitmarker
        this.triggerHitmarker(false);
      } else {
        // 3. Test World Obstacles / Ground (BVH Accelerated)
        const worldHits = this.raycaster.intersectObject(this.worldCollider, false);

        if (worldHits.length > 0) {
          const hit = worldHits[0];
          const normal = hit.face ? hit.face.normal : this._normalFallback;
          this.tracerManager.spawnTracer(this._muzzleWorld, hit.point);
          this.decalManager.spawnBulletHole(hit.point, normal);
        } else {
          // Fly down-range into distance
          this._rayDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
          this._targetPoint.copy(this.camera.position).addScaledVector(this._rayDir, 80);
          this.tracerManager.spawnTracer(this._muzzleWorld, this._targetPoint);
        }
      }
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

  private startReload(): void {
    this.isReloading = true;
    this.reloadTimer = 1.35;
    this.soundEngine.playReloadSound();
  }

  private completeReload(): void {
    const weapon = this.weapons[this.currentWeaponIndex];
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
