import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SoundEngine } from '../audio/SoundEngine';
import { HAND_MODEL_PATH, MODELS, SOUNDS } from '../constants/assets';
import { INPUT } from '../constants/input';
import { RELOAD_CUES, WEAPON_DEFS, WEAPONS } from '../constants/weapons';
import type { InputManager } from '../core/InputManager';
import { BulletTracerManager } from '../effects/BulletTracer';
import { DecalManager } from '../effects/DecalManager';
import { DummyManager } from '../targets/DummyManager';
import { TargetManager } from '../targets/TargetManager';
import { type HandAsset, WeaponModels, type WeaponRig } from './WeaponModels';

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

  recoilForce: {
    posZ: number;
    rotX: number;
    camPitch: number;
    camYaw: number;
    spray: 'ak' | 'simple';
  };

  reloadTime: number;

  reloadStyle: 'mag' | 'shells';

  pellets?: number;

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

  public stanceKickMult = 1;

  public totalShots = 0;
  public totalHits = 0;

  private weapons: WeaponData[] = WEAPON_DEFS.map((def) => ({
    name: def.name,
    fireMode: def.fireMode,
    isAuto: def.isAuto,
    fireRate: def.fireRate,
    magSize: def.magSize,
    currentAmmo: def.startAmmo,
    reserveAmmo: def.reserveAmmo,
    damage: def.damage,
    idleOffset: new THREE.Vector3(...def.idleOffset),
    adsOffset: new THREE.Vector3(...def.adsOffset),
    recoilForce: { ...def.recoilForce },
    reloadTime: def.reloadTime,
    reloadStyle: def.reloadStyle,
    ...('pellets' in def ? { pellets: def.pellets } : {}),
    ...('pelletSpread' in def ? { pelletSpread: def.pelletSpread } : {}),
  }));

  public weaponRigs: WeaponRig[] = [];
  /** Third-person gun muzzle; when set, tracers/shells start there. */
  public thirdPersonMuzzle: THREE.Object3D | null = null;
  public soundEngine: SoundEngine;
  public tracerManager: BulletTracerManager;
  public decalManager: DecalManager;
  public targetManager: TargetManager;
  public dummyManager: DummyManager;

  private raycaster: THREE.Raycaster = new THREE.Raycaster();

  private recoilPos = new THREE.Vector3();
  private recoilVel = new THREE.Vector3();
  private recoilRot = new THREE.Vector3();
  private recoilRotVel = new THREE.Vector3();

  private bobTimer = 0;

  private lastFireTime = 0;
  private flashTimer = 0;
  private reloadTimer = 0;
  private canFireSemi = true;

  private reloadDuration = 1;
  private reloadCues: { t: number; play: () => void }[] = [];
  private nextReloadCue = 0;
  private reloadAnimOffset = new THREE.Vector3();
  private reloadAnimRot = new THREE.Euler();
  private reloadArmOffset = new THREE.Vector3();
  private reloadArmRot = new THREE.Euler();
  private boltPull = 0;

  private swapState: 'idle' | 'holster' | 'equip' = 'idle';
  private swapTimer = 0;
  private swapDuration = 0;
  private pendingWeaponIndex = 0;
  private previousWeaponIndex = 0;
  private swapAnimOffset = new THREE.Vector3();
  private swapAnimRot = new THREE.Euler();

  private currentOffset = new THREE.Vector3();
  private targetOffset = new THREE.Vector3();

  private readonly _muzzleWorld = new THREE.Vector3();
  private readonly _chamberWorld = new THREE.Vector3();
  private readonly _rayDir = new THREE.Vector3();
  private readonly _targetPoint = new THREE.Vector3();
  private readonly _normalFallback = new THREE.Vector3(0, 1, 0);
  private readonly _shotPoint = new THREE.Vector2(0, 0);

  public onAmmoChange?: (
    current: number,
    reserve: number,
    name: string,
    mode: string,
  ) => void;
  public onStatsUpdate?: (
    shots: number,
    hits: number,
    accuracy: number,
  ) => void;
  public onRecoilTelemetry?: (
    spreadX: number,
    spreadY: number,
    isHit: boolean,
  ) => void;

  public onRecoil?: (pitchDelta: number, yawDelta: number) => void;

  private burstShot = 0;
  private static readonly BURST_RESET = WEAPONS.BURST_RESET_S;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private input: InputManager,
    private scene: THREE.Scene,
    private worldCollider: THREE.Mesh,
  ) {
    this.camera.add(this.viewmodelContainer);
    (this.raycaster as any).firstHitOnly = true;

    this.soundEngine = new SoundEngine();
    this.tracerManager = new BulletTracerManager(scene, () =>
      this.soundEngine.playShellDrop(),
    );
    this.decalManager = new DecalManager(scene);
    this.targetManager = new TargetManager(scene, this.soundEngine);
    this.dummyManager = new DummyManager(scene, this.soundEngine);

    const akRig = WeaponModels.createRifleRig();
    const pistolRig = WeaponModels.createPistolRig();
    const shotgunRig = WeaponModels.createRifleRig();

    this.weaponRigs.push(akRig, pistolRig, shotgunRig);
    this.viewmodelContainer.add(akRig.root);
    this.viewmodelContainer.add(pistolRig.root);
    this.viewmodelContainer.add(shotgunRig.root);

    this.selectWeapon(0, false);
  }

  public async loadAssets(
    onProgress?: (status: string) => void,
  ): Promise<void> {
    onProgress?.('LOADING OPERATOR HANDS...');
    let handAsset: HandAsset | undefined;
    try {
      const handLoader = new GLTFLoader();
      const handGltf = await handLoader.loadAsync(HAND_MODEL_PATH);
      handAsset = { scene: handGltf.scene, clip: handGltf.animations[0] };
    } catch (err) {
      console.warn(
        'Failed to load hand model, falling back to block-glove arms:',
        err,
      );
    }

    onProgress?.('LOADING AUTHENTIC AK-47 3D MODEL...');
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(MODELS.ak47);

      const realAkRig = WeaponModels.createRealAKRig(gltf.scene, handAsset);

      const oldRig = this.weaponRigs[0];
      if (oldRig) {
        this.viewmodelContainer.remove(oldRig.root);
      }

      this.weaponRigs[0] = realAkRig;
      this.viewmodelContainer.add(realAkRig.root);
      realAkRig.root.visible = this.currentWeaponIndex === 0;

      onProgress?.('AUTHENTIC AK-47 EQUIPPED');
    } catch (err) {
      console.warn(
        'Failed to load authentic AK-47 GLB model, using procedural fallback:',
        err,
      );
    }

    onProgress?.('LOADING TACTICAL SILENCED SIDEARM...');
    try {
      const loader = new GLTFLoader();
      const pistolGltf = await loader.loadAsync(MODELS.pistol);

      const realPistolRig = WeaponModels.createRealPistolRig(
        pistolGltf.scene,
        handAsset,
      );

      const oldRig = this.weaponRigs[1];
      if (oldRig) {
        this.viewmodelContainer.remove(oldRig.root);
      }

      this.weaponRigs[1] = realPistolRig;
      this.viewmodelContainer.add(realPistolRig.root);
      realPistolRig.root.visible = this.currentWeaponIndex === 1;

      onProgress?.('TACTICAL GHOST SIDEARM EQUIPPED');
    } catch (err) {
      console.warn(
        'Failed to load pistol.glb model, using procedural fallback:',
        err,
      );
    }

    onProgress?.('LOADING 12-GAUGE BREACHING SHOTGUN...');
    try {
      const loader = new GLTFLoader();
      const shotgunGltf = await loader.loadAsync(MODELS.shotgun);

      const realShotgunRig = WeaponModels.createRealShotgunRig(
        shotgunGltf.scene,
        handAsset,
      );

      const oldRig = this.weaponRigs[2];
      if (oldRig) {
        this.viewmodelContainer.remove(oldRig.root);
      }

      this.weaponRigs[2] = realShotgunRig;
      this.viewmodelContainer.add(realShotgunRig.root);
      realShotgunRig.root.visible = this.currentWeaponIndex === 2;

      onProgress?.('BREACHER 12G EQUIPPED');
    } catch (err) {
      console.warn(
        'Failed to load shotgun.glb model, using procedural fallback:',
        err,
      );
    }

    await this.soundEngine.loadSamples(SOUNDS, onProgress);

    onProgress?.('DEPLOYING TACTICAL COMBAT DUMMIES...');
    await this.dummyManager.loadCharacterModel();
  }

  public selectWeapon(index: number, playSound = true): void {
    if (index < 0 || index >= this.weapons.length) return;
    if (index === this.currentWeaponIndex && this.swapState === 'idle') return;
    if (this.swapState === 'holster' && this.pendingWeaponIndex === index)
      return;

    if (this.isReloading)
      this.clearReloadAnim(this.weaponRigs[this.currentWeaponIndex]);
    this.isReloading = false;
    this.isSwapping = true;
    this.pendingWeaponIndex = index;

    this.swapState = 'holster';
    this.swapTimer = WEAPONS.SWAP_HOLSTER_S;
    this.swapDuration = WEAPONS.SWAP_HOLSTER_S;

    if (playSound) {
    }
  }

  public update(delta: number, playerSpeed: number, onGround: boolean): void {
    const weapon = this.weapons[this.currentWeaponIndex];
    const rig = this.weaponRigs[this.currentWeaponIndex];

    if (this.input.isKeyPressed(INPUT.SLOT_1)) this.selectWeapon(0);
    if (this.input.isKeyPressed(INPUT.SLOT_2)) this.selectWeapon(1);
    if (this.input.isKeyPressed(INPUT.SLOT_3)) this.selectWeapon(2);
    if (this.input.isKeyPressed(INPUT.QUICK_SWAP)) {
      this.selectWeapon(
        this.previousWeaponIndex === this.currentWeaponIndex
          ? (this.currentWeaponIndex + 1) % this.weapons.length
          : this.previousWeaponIndex,
      );
    }
    const wheel = this.input.consumeWheelDelta();
    if (wheel !== 0) {
      const n = this.weapons.length;
      this.selectWeapon(
        (this.currentWeaponIndex + (wheel > 0 ? 1 : n - 1)) % n,
      );
    }

    this.isAiming =
      this.input.isMouseDown(INPUT.ADS_MOUSE_BUTTON) &&
      !this.isReloading &&
      !this.isSwapping;
    this.targetOffset.copy(
      this.isAiming ? weapon.adsOffset : weapon.idleOffset,
    );

    const targetFov = this.isAiming ? WEAPONS.ADS_FOV : WEAPONS.HIP_FOV;
    this.camera.fov = THREE.MathUtils.lerp(
      this.camera.fov,
      targetFov,
      WEAPONS.ADS_LERP_RATE * delta,
    );
    this.camera.updateProjectionMatrix();

    const isFireDown = this.input.isMouseDown(INPUT.FIRE_MOUSE_BUTTON);
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

    if (
      this.input.isKeyPressed(INPUT.RELOAD) &&
      !this.isReloading &&
      !this.isSwapping
    ) {
      if (weapon.currentAmmo < weapon.magSize && weapon.reserveAmmo > 0) {
        this.startReload();
      }
    }

    if (this.isReloading) {
      this.reloadTimer -= delta;
      const t = Math.min(
        1,
        Math.max(0, 1 - this.reloadTimer / this.reloadDuration),
      );

      while (
        this.nextReloadCue < this.reloadCues.length &&
        t >= this.reloadCues[this.nextReloadCue].t
      ) {
        this.reloadCues[this.nextReloadCue++].play();
      }
      this.updateReloadAnim(t, weapon, rig);

      if (this.reloadTimer <= 0) {
        this.completeReload();
      }
    }

    if (this.swapState === 'holster') {
      this.swapTimer -= delta;
      const t = Math.min(
        1.0,
        Math.max(0.0, 1.0 - this.swapTimer / this.swapDuration),
      );
      const ease = t * t;

      this.swapAnimOffset.set(0.03 * ease, -0.25 * ease, 0.05 * ease);
      this.swapAnimRot.set(0.35 * ease, -0.12 * ease, -0.22 * ease);

      if (this.swapTimer <= 0) {
        this.weaponRigs[this.currentWeaponIndex].root.visible = false;
        this.previousWeaponIndex = this.currentWeaponIndex;
        this.currentWeaponIndex = this.pendingWeaponIndex;
        this.weaponRigs[this.currentWeaponIndex].root.visible = true;

        this.swapState = 'equip';
        this.swapTimer = WEAPONS.SWAP_EQUIP_S;
        this.swapDuration = WEAPONS.SWAP_EQUIP_S;

        this.soundEngine.playWeaponEquip(this.currentWeaponIndex);
        this.notifyAmmo();

        const hud = document.getElementById('hud');
        if (hud) {
          hud.classList.add('spread-fire');
          setTimeout(
            () => hud.classList.remove('spread-fire'),
            WEAPONS.HUD_SPREAD_FIRE_MS,
          );
        }
      }
    } else if (this.swapState === 'equip') {
      this.swapTimer -= delta;
      const t = Math.min(
        1.0,
        Math.max(0.0, 1.0 - this.swapTimer / this.swapDuration),
      );

      const blend = 1.0 - (1.0 - t) ** 3;
      const overshoot = Math.sin(t * Math.PI) * (1.0 - t);

      const curY = THREE.MathUtils.lerp(-0.28, 0.0, blend) + overshoot * 0.04;
      const curRotX = THREE.MathUtils.lerp(0.55, 0.0, blend) - overshoot * 0.12;
      const curRotY = THREE.MathUtils.lerp(-0.22, 0.0, blend);
      const curRotZ = THREE.MathUtils.lerp(0.2, 0.0, blend);

      this.swapAnimOffset.set(0, curY, 0);
      this.swapAnimRot.set(curRotX, curRotY, curRotZ);

      if (this.swapTimer <= 0) {
        this.swapState = 'idle';
        this.isSwapping = false;
        this.swapAnimOffset.set(0, 0, 0);
        this.swapAnimRot.set(0, 0, 0);
      }
    }

    const stiffness = WEAPONS.RECOIL_STIFFNESS;
    const damping = WEAPONS.RECOIL_DAMPING;

    this.recoilVel.x +=
      (-this.recoilPos.x * stiffness - this.recoilVel.x * damping) * delta;
    this.recoilVel.y +=
      (-this.recoilPos.y * stiffness - this.recoilVel.y * damping) * delta;
    this.recoilVel.z +=
      (-this.recoilPos.z * stiffness - this.recoilVel.z * damping) * delta;

    this.recoilPos.addScaledVector(this.recoilVel, delta);

    this.recoilRotVel.x +=
      (-this.recoilRot.x * stiffness - this.recoilRotVel.x * damping) * delta;
    this.recoilRotVel.y +=
      (-this.recoilRot.y * stiffness - this.recoilRotVel.y * damping) * delta;
    this.recoilRotVel.z +=
      (-this.recoilRot.z * stiffness - this.recoilRotVel.z * damping) * delta;

    this.recoilRot.addScaledVector(this.recoilRotVel, delta);

    this.cameraRecoilPitch = THREE.MathUtils.lerp(
      this.cameraRecoilPitch,
      0,
      WEAPONS.CAMERA_RECOIL_LERP_RATE * delta,
    );
    this.cameraRecoilYaw = THREE.MathUtils.lerp(
      this.cameraRecoilYaw,
      0,
      WEAPONS.CAMERA_RECOIL_LERP_RATE * delta,
    );

    if (
      playerSpeed > WEAPONS.BOB_MOVE_THRESHOLD &&
      onGround &&
      !this.isAiming
    ) {
      this.bobTimer += delta * WEAPONS.BOB_RATE;
    } else {
      this.bobTimer = 0;
    }
    const bobX =
      Math.cos(this.bobTimer * 0.5) *
      (this.isAiming ? WEAPONS.BOB_X_ADS : WEAPONS.BOB_X_HIP);
    const bobY =
      Math.abs(Math.sin(this.bobTimer)) *
      (this.isAiming ? WEAPONS.BOB_Y_ADS : WEAPONS.BOB_Y_HIP);

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

    const lerpSpeed = this.isAiming
      ? WEAPONS.VIEWMODEL_LERP_ADS
      : WEAPONS.VIEWMODEL_LERP_HIP;
    this.currentOffset.lerp(this.targetOffset, lerpSpeed * delta);

    this.viewmodelContainer.position.set(
      this.currentOffset.x +
        this.recoilPos.x +
        bobX +
        this.swapAnimOffset.x +
        this.reloadAnimOffset.x,
      this.currentOffset.y +
        this.recoilPos.y +
        this.swapAnimOffset.y +
        bobY +
        this.reloadAnimOffset.y,
      this.currentOffset.z +
        this.recoilPos.z +
        this.swapAnimOffset.z +
        this.reloadAnimOffset.z,
    );

    this.viewmodelContainer.rotation.set(
      this.recoilRot.x + this.swapAnimRot.x + this.reloadAnimRot.x,
      this.recoilRot.y + this.swapAnimRot.y + this.reloadAnimRot.y,
      this.recoilRot.z + this.swapAnimRot.z + this.reloadAnimRot.z,
    );

    rig.leftArm.position.copy(this.reloadArmOffset);
    rig.leftArm.rotation.copy(this.reloadArmRot);

    if (rig.slideOrBolt && this.boltPull > 0) {
      rig.slideOrBolt.position.z = this.boltPull;
    }

    this.tracerManager.update(delta);
    this.decalManager.update(delta);
    this.targetManager.update(delta);
    this.dummyManager.update(delta);
  }

  private shoot(now: number): void {
    const weapon = this.weapons[this.currentWeaponIndex];
    const rig = this.weaponRigs[this.currentWeaponIndex];

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

    const kickMult =
      (this.isAiming ? WEAPONS.KICK_ADS_MULT : WEAPONS.KICK_HIP_MULT) *
      this.stanceKickMult;
    const n = this.burstShot;

    const escalate =
      1 + Math.min(n, WEAPONS.ESCALATE_MAX_SHOTS) * WEAPONS.ESCALATE_PER_SHOT;

    this.recoilVel.z +=
      weapon.recoilForce.posZ * WEAPONS.POS_Z_TO_VEL * kickMult * escalate;
    this.recoilVel.y +=
      weapon.recoilForce.posZ * WEAPONS.POS_Z_TO_LIFT * kickMult * escalate;
    this.recoilRotVel.x +=
      weapon.recoilForce.rotX * WEAPONS.ROT_X_TO_VEL * kickMult * escalate;
    this.recoilRotVel.z +=
      (Math.random() - 0.5) * WEAPONS.ROLL_RANDOM * kickMult;
    this.recoilRotVel.y +=
      (Math.random() - 0.5) * WEAPONS.YAW_RANDOM * kickMult;

    const rc = weapon.recoilForce;
    const adsMult =
      (this.isAiming ? WEAPONS.ADS_PITCH_MULT : WEAPONS.KICK_HIP_MULT) *
      this.stanceKickMult;
    let pitchKick =
      rc.camPitch *
      escalate *
      adsMult *
      (WEAPONS.PITCH_RANDOM_MIN + Math.random() * WEAPONS.PITCH_RANDOM_SPAN);
    let yawKick: number;

    if (rc.spray === 'ak') {
      const snake =
        n < WEAPONS.AK_SNAKE_START
          ? (Math.random() - 0.5) * WEAPONS.AK_SNAKE_RANDOM
          : Math.sin((n - WEAPONS.AK_SNAKE_START) * WEAPONS.AK_SNAKE_FREQ) *
            WEAPONS.AK_SNAKE_AMP;
      yawKick =
        rc.camYaw *
        snake *
        adsMult *
        (WEAPONS.PITCH_RANDOM_MIN + Math.random() * WEAPONS.PITCH_RANDOM_SPAN);

      if (n >= WEAPONS.AK_PITCH_DAMP_FROM_SHOT)
        pitchKick *= WEAPONS.AK_PITCH_DAMP_MULT;
    } else {
      yawKick = rc.camYaw * (Math.random() - 0.5) * 2 * adsMult;
    }

    this.onRecoil?.(pitchKick, yawKick);
    this.burstShot++;

    this.cameraRecoilPitch += pitchKick;
    this.cameraRecoilYaw += yawKick;

    if (rig.slideOrBolt) {
      rig.slideOrBolt.position.z = WEAPONS.SLIDE_KICK_Z;
    }

    rig.muzzleFlash.visible = true;
    rig.muzzleFlash.rotation.z = Math.random() * Math.PI * 2;
    const flashScale =
      (this.isAiming ? WEAPONS.FLASH_ADS_SCALE : WEAPONS.FLASH_HIP_SCALE) *
      (WEAPONS.FLASH_RANDOM_MIN + Math.random() * WEAPONS.FLASH_RANDOM_SPAN);
    rig.muzzleFlash.scale.set(flashScale, flashScale, flashScale);
    rig.flashLight.intensity = WEAPONS.FLASH_LIGHT_INTENSITY;
    this.flashTimer = WEAPONS.FLASH_DURATION_S;

    const tppMuzzle = this.thirdPersonMuzzle;
    if (tppMuzzle?.parent) {
      tppMuzzle.getWorldPosition(this._muzzleWorld);
      tppMuzzle.parent.localToWorld(this._chamberWorld.copy(rig.chamberPos));
    } else {
      rig.muzzleFlash.getWorldPosition(this._muzzleWorld);
      this.viewmodelContainer.localToWorld(
        this._chamberWorld.copy(rig.chamberPos),
      );
    }

    this.tracerManager.spawnShell(this._chamberWorld, this.camera.rotation);
    this.tracerManager.spawnMuzzleSmoke(
      this._muzzleWorld,
      this.camera.rotation,
    );

    const pellets = weapon.pellets ?? 1;
    const spread = weapon.pelletSpread ?? 0;
    let hasHit = false;
    let headshot = false;

    for (let p = 0; p < pellets; p++) {
      if (p === 0 || spread === 0) {
        this._shotPoint.set(0, 0);
      } else {
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

    if (this.onRecoilTelemetry) {
      const spreadX =
        (Math.random() - 0.5) *
          (this.isAiming ? WEAPONS.SPREAD_X_ADS : WEAPONS.SPREAD_X_HIP) +
        this.cameraRecoilYaw * WEAPONS.SPREAD_YAW_TO_TELEMETRY;
      const spreadY =
        (Math.random() - 0.2) *
          (this.isAiming ? WEAPONS.SPREAD_Y_ADS : WEAPONS.SPREAD_Y_HIP) +
        this.cameraRecoilPitch * WEAPONS.SPREAD_PITCH_TO_TELEMETRY;
      this.onRecoilTelemetry(spreadX, spreadY, hasHit);
    }

    const hud = document.getElementById('hud');
    if (hud) {
      hud.classList.add('spread-fire');
      setTimeout(
        () => hud.classList.remove('spread-fire'),
        WEAPONS.HUD_SPREAD_SHOT_MS,
      );
    }

    if (this.onStatsUpdate) {
      const acc =
        this.totalShots > 0 ? (this.totalHits / this.totalShots) * 100 : 0;
      this.onStatsUpdate(this.totalShots, this.totalHits, acc);
    }
  }

  private tracePellet(weapon: WeaponData): { hit: boolean; headshot: boolean } {
    this.raycaster.setFromCamera(this._shotPoint, this.camera);

    const dummyHits = this.raycaster.intersectObjects(
      this.dummyManager.hitboxMeshes,
      false,
    );
    if (dummyHits.length > 0) {
      const hit = dummyHits[0];
      const res = this.dummyManager.registerHit(
        hit.object as THREE.Mesh,
        hit.point,
        weapon.damage,
      );
      this.tracerManager.spawnTracer(this._muzzleWorld, hit.point);
      this.decalManager.spawnBulletHole(
        hit.point,
        hit.face ? hit.face.normal : this._normalFallback,
      );
      return { hit: true, headshot: res.isHeadshot };
    }

    const targetHits = this.raycaster.intersectObjects(
      this.targetManager.targetMeshes,
      false,
    );
    if (targetHits.length > 0) {
      const hit = targetHits[0];
      this.targetManager.registerHit(hit.object as THREE.Mesh, hit.point);
      this.tracerManager.spawnTracer(this._muzzleWorld, hit.point);
      return { hit: true, headshot: false };
    }

    const worldHits = this.raycaster.intersectObject(this.worldCollider, false);
    if (worldHits.length > 0) {
      const hit = worldHits[0];
      this.tracerManager.spawnTracer(this._muzzleWorld, hit.point);
      this.decalManager.spawnBulletHole(
        hit.point,
        hit.face ? hit.face.normal : this._normalFallback,
      );
      return { hit: false, headshot: false };
    }

    this._rayDir.copy(this.raycaster.ray.direction);
    this._targetPoint
      .copy(this.camera.position)
      .addScaledVector(this._rayDir, WEAPONS.MISS_RAY_DISTANCE);
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
    setTimeout(
      () => {
        hm.classList.add('hitmarker-hidden');
      },
      isHeadshot ? WEAPONS.HITMARKER_HEADSHOT_MS : WEAPONS.HITMARKER_MS,
    );
  }

  private static kf(t: number, pts: number[][]): number {
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i][0]) {
        const [t0, v0] = pts[i - 1];
        const [t1, v1] = pts[i];
        const k = t1 === t0 ? 1 : (t - t0) / (t1 - t0);

        return v0 + (v1 - v0) * (k * k * (3 - 2 * k));
      }
    }
    return pts[pts.length - 1][1];
  }

  private updateReloadAnim(
    t: number,
    weapon: WeaponData,
    rig: WeaponRig,
  ): void {
    const kf = WeaponManager.kf;

    if (weapon.reloadStyle === 'shells') {
      this.reloadAnimOffset.set(
        kf(t, [
          [0, 0],
          [0.14, 0.05],
          [0.88, 0.05],
          [1, 0],
        ]),
        kf(t, [
          [0, 0],
          [0.14, -0.12],
          [0.86, -0.12],
          [0.92, -0.03],
          [1, 0],
        ]),
        kf(t, [
          [0, 0],
          [0.14, 0.04],
          [0.88, 0.02],
          [1, 0],
        ]),
      );
      this.reloadAnimRot.set(
        kf(t, [
          [0, 0],
          [0.14, 0.22],
          [0.86, 0.2],
          [1, 0],
        ]),
        kf(t, [
          [0, 0],
          [0.14, -0.3],
          [0.86, -0.28],
          [1, 0],
        ]),
        kf(t, [
          [0, 0],
          [0.14, -0.62],
          [0.86, -0.6],
          [0.93, 0.08],
          [1, 0],
        ]),
      );

      const shells = Math.max(1, weapon.magSize - 1);
      const feedStart = 0.18;
      const feedEnd = 0.82;
      const cycle = ((t - feedStart) / ((feedEnd - feedStart) / shells)) % 1;
      const inFeed = t > feedStart && t < feedEnd;
      const reach = inFeed ? Math.sin(Math.max(0, cycle) * Math.PI) : 0;

      this.reloadArmOffset.set(
        -0.02 * reach,
        -0.16 + 0.16 * reach,
        0.12 * reach,
      );
      this.reloadArmRot.set(0.5 * reach, 0, 0);

      const rack = kf(t, [
        [0.86, 0],
        [0.92, 1],
        [0.98, 0],
        [1, 0],
      ]);
      this.reloadArmOffset.z += 0.09 * rack;
      this.boltPull = 0.05 * rack;
      return;
    }

    this.reloadAnimOffset.set(
      kf(t, [
        [0, 0],
        [0.16, 0.07],
        [0.62, 0.06],
        [0.8, 0.02],
        [1, 0],
      ]),
      kf(t, [
        [0, 0],
        [0.16, -0.16],
        [0.55, -0.19],
        [0.66, -0.08],
        [0.72, -0.12],
        [1, 0],
      ]),
      kf(t, [
        [0, 0],
        [0.16, 0.06],
        [0.7, 0.04],
        [1, 0],
      ]),
    );
    this.reloadAnimRot.set(
      kf(t, [
        [0, 0],
        [0.16, 0.46],
        [0.6, 0.44],
        [0.68, 0.18],
        [1, 0],
      ]),
      kf(t, [
        [0, 0],
        [0.16, -0.34],
        [0.66, -0.3],
        [1, 0],
      ]),
      kf(t, [
        [0, 0],
        [0.16, -0.58],
        [0.6, -0.55],
        [0.68, -0.2],
        [1, 0],
      ]),
    );

    this.reloadArmOffset.set(
      kf(t, [
        [0, 0],
        [0.18, -0.03],
        [0.34, -0.06],
        [0.5, -0.04],
        [0.66, 0],
        [0.82, 0.04],
        [1, 0],
      ]),
      kf(t, [
        [0, 0],
        [0.18, -0.1],
        [0.34, -0.34],
        [0.5, -0.3],
        [0.64, -0.02],
        [0.7, -0.06],
        [0.82, 0.05],
        [1, 0],
      ]),
      kf(t, [
        [0, 0],
        [0.18, 0.14],
        [0.34, 0.2],
        [0.5, 0.18],
        [0.66, 0.12],
        [0.78, 0.16],
        [0.88, 0.24],
        [1, 0],
      ]),
    );
    this.reloadArmRot.set(
      kf(t, [
        [0, 0],
        [0.34, 0.6],
        [0.62, 0.35],
        [0.82, -0.1],
        [1, 0],
      ]),
      0,
      kf(t, [
        [0, 0],
        [0.34, -0.2],
        [0.7, -0.1],
        [1, 0],
      ]),
    );

    this.boltPull =
      0.055 *
      kf(t, [
        [0.78, 0],
        [0.85, 1],
        [0.9, 0],
        [1, 0],
      ]);
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
      const missing = Math.min(
        weapon.magSize - weapon.currentAmmo,
        weapon.reserveAmmo,
      );
      const cues: { t: number; play: () => void }[] = [];
      for (let i = 0; i < missing; i++) {
        cues.push({
          t:
            RELOAD_CUES.SHELL_CUE_BASE +
            (RELOAD_CUES.SHELL_CUE_STEP * i) / Math.max(1, missing),
          play: () => snd.playShellInsert(),
        });
      }
      cues.push({
        t: RELOAD_CUES.SHELLS_RACK_T,
        play: () => snd.playPumpRack(),
      });
      this.reloadCues = cues;
    } else {
      this.reloadCues = [
        {
          t: RELOAD_CUES.MAG_RELEASE_T,
          play: () => {
            if (snd.playReloadCycle()) return;
            snd.playMagRelease();
          },
        },
        {
          t: RELOAD_CUES.SHELL_CUE_BASE,
          play: () => {
            if (!snd.hasSample('reload')) snd.playMagOut();
          },
        },
        {
          t: RELOAD_CUES.MAG_IN_T,
          play: () => {
            if (!snd.hasSample('reload')) snd.playMagIn();
          },
        },
        {
          t: RELOAD_CUES.BOLT_RACK_T,
          play: () => {
            if (!snd.hasSample('reload')) snd.playBoltRack();
          },
        },
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
      this.onAmmoChange(
        weapon.currentAmmo,
        weapon.reserveAmmo,
        weapon.name,
        weapon.fireMode,
      );
    }
  }
}
