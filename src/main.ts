import * as THREE from 'three';
import { GameRenderer } from './core/Renderer';
import { InputManager } from './core/InputManager';
import { OutdoorRange } from './environment/OutdoorRange';
import { PlayerController } from './player/PlayerController';
import { WeaponManager } from './weapons/WeaponManager';
import { TacticalTelemetry } from './ui/TacticalTelemetry';
import { CombatHUD } from './ui/CombatHUD';

class GameApp {
  private renderer: GameRenderer;
  private input: InputManager;
  private range: OutdoorRange;
  private player!: PlayerController;
  private weapons!: WeaponManager;
  private telemetry: TacticalTelemetry;
  private combatHud!: CombatHUD;
  private clock: THREE.Clock = new THREE.Clock();
  private isLoaded = false;

  // DOM HUD elements
  private overlayScreen = document.getElementById('overlay-screen')!;
  private startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  private startBtnText = document.getElementById('start-btn-text')!;
  private loaderStatus = document.getElementById('loader-status')!;
  private loaderPercent = document.getElementById('loader-percent')!;
  private loaderFill = document.getElementById('loader-fill')!;
  private hud = document.getElementById('hud')!;
  private fpsCounter = document.getElementById('fps-counter')!;
  private staminaBar = document.getElementById('stamina-bar')!;
  private speedText = document.getElementById('speed-text')!;
  private postureText = document.getElementById('posture-text')!;
  private ammoCurrent = document.getElementById('ammo-current')!;
  private ammoReserve = document.getElementById('ammo-reserve')!;
  private weaponName = document.getElementById('weapon-name')!;
  private fireMode = document.getElementById('fire-mode')!;
  private slotPrimary = document.getElementById('slot-primary')!;
  private slotSecondary = document.getElementById('slot-secondary')!;
  private slotTertiary = document.getElementById('slot-tertiary')!;
  private hitsCounter = document.getElementById('hits-counter')!;
  private accuracyCounter = document.getElementById('accuracy-counter')!;

  // FPS tracking
  private frameCount = 0;
  private fpsTime = 0;

  constructor() {
    const canvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;
    this.renderer = new GameRenderer(canvas);
    this.input = new InputManager(canvas);
    this.range = new OutdoorRange(this.renderer.scene);
    this.telemetry = new TacticalTelemetry();
    this.combatHud = new CombatHUD(document.getElementById('game-container')!);

    this.setupUI();
    this.startAssetLoading();

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  private async startAssetLoading(): Promise<void> {
    try {
      // Build outdoor environment, sky, and BVH tree
      await this.range.buildWithProgress((percent, status) => {
        this.loaderFill.style.width = `${percent}%`;
        this.loaderPercent.textContent = `${percent}%`;
        this.loaderStatus.textContent = status;
      });

      // Initialize player controller with BVH
      this.player = new PlayerController(
        75,
        window.innerWidth / window.innerHeight,
        this.input,
        this.range.bvh
      );

      // Add camera to scene so viewmodel children render
      this.renderer.scene.add(this.player.camera);

      // Initialize Weapons & Hands Viewmodel System with world collider mesh
      this.weapons = new WeaponManager(
        this.player.camera,
        this.input,
        this.renderer.scene,
        this.range.colliderMesh
      );
      await this.weapons.loadAssets((status) => {
        this.loaderStatus.textContent = status;
        this.loaderPercent.textContent = '95%';
        this.loaderFill.style.width = '95%';
      });
      this.setupWeaponEvents();

      // Pre-heat GPU shaders to guarantee 0 in-game hitching
      this.loaderStatus.textContent = 'PRE-HEATING GPU SHADER CACHE...';
      await new Promise(r => requestAnimationFrame(r));
      this.renderer.compile(this.player.camera);

      // Enable start button
      this.isLoaded = true;
      this.loaderStatus.textContent = 'WEAPONS & COMPOUND READY';
      this.startBtn.classList.remove('disabled');
      this.startBtn.removeAttribute('disabled');
      this.startBtnText.textContent = 'INITIALIZE OPTICS & ENTER';
    } catch (err) {
      console.error('Failed during asset loading:', err);
      this.loaderStatus.textContent = 'INITIALIZATION ERROR';
    }
  }

  private setupWeaponEvents(): void {
    this.weapons.onAmmoChange = (current, reserve, name, mode) => {
      this.ammoCurrent.textContent = `${current}`;
      this.ammoReserve.textContent = `${reserve}`;
      this.weaponName.textContent = name;
      this.fireMode.textContent = mode;

      const slots = [this.slotPrimary, this.slotSecondary, this.slotTertiary];
      slots.forEach((slot, i) => {
        if (!slot) return;
        slot.classList.toggle('active', i === this.weapons.currentWeaponIndex);
      });
    };

    this.weapons.onStatsUpdate = (_shots, hits, acc) => {
      if (this.hitsCounter) this.hitsCounter.textContent = `${hits}`;
      if (this.accuracyCounter) this.accuracyCounter.textContent = `${acc.toFixed(0)}%`;
    };

    this.weapons.onRecoilTelemetry = (spreadX, spreadY, isHit) => {
      this.telemetry.recordShot(spreadX, spreadY, isHit);
    };

    // Wire up screen-space combat damage text and target analyzer
    this.weapons.dummyManager.onDummyHit = (
      damage,
      isHeadshot,
      isKill,
      hitPoint,
      dummyId,
      currentHp,
      maxHp
    ) => {
      this.combatHud.registerHit(
        damage,
        isHeadshot,
        isKill,
        hitPoint,
        this.player.camera,
        dummyId,
        currentHp,
        maxHp
      );
    };

    this.weapons.notifyAmmo();
  }

  private setupUI(): void {
    this.startBtn.addEventListener('click', () => {
      if (!this.isLoaded) return;
      this.input.requestLock();
    });

    this.input.onLockChange = (locked) => {
      if (locked) {
        this.overlayScreen.classList.add('hidden');
        this.hud.classList.remove('hidden');
      } else {
        this.overlayScreen.classList.remove('hidden');
        this.hud.classList.add('hidden');
      }
    };

    window.addEventListener('resize', () => {
      if (this.player) {
        this.player.camera.aspect = window.innerWidth / window.innerHeight;
        this.player.camera.updateProjectionMatrix();
      }
    });
  }

  private animate(): void {
    requestAnimationFrame(this.animate);

    const delta = Math.min(this.clock.getDelta(), 0.05);

    if (this.isLoaded && this.player) {
      if (this.input.isLocked) {
        if (this.weapons) {
          this.weapons.update(delta, this.player.getSpeed(), this.player.onGround);
          this.player.recoilPitchOffset = this.weapons.cameraRecoilPitch;
          this.player.recoilYawOffset = this.weapons.cameraRecoilYaw;
        }
        this.player.update(delta);
      }

      this.updateHUD(delta);
      this.renderer.render(this.player.camera);

      // Live Telemetry Pipeline & Recoil Graphs
      this.telemetry.recordFrame(
        delta,
        this.renderer.renderer.info.render.calls,
        this.renderer.renderer.info.render.triangles
      );
    }
  }

  private updateHUD(delta: number): void {
    if (!this.player) return;

    // 1. FPS counter
    this.frameCount++;
    this.fpsTime += delta;
    if (this.fpsTime >= 0.35) {
      const currentFps = Math.round(this.frameCount / this.fpsTime);
      this.fpsCounter.textContent = `${currentFps}`;
      this.frameCount = 0;
      this.fpsTime = 0;
    }

    // 2. Stamina bar
    const staminaPercent = (this.player.stamina / this.player.maxStamina) * 100;
    this.staminaBar.style.width = `${staminaPercent}%`;

    // 3. Movement speed & posture
    const speed = this.player.getSpeed();
    this.speedText.textContent = `${speed.toFixed(1)} M/S`;

    if (!this.player.onGround) {
      this.postureText.textContent = 'AIR';
    } else if (this.player.isSprinting) {
      this.postureText.textContent = 'SPRINT';
    } else if (speed > 0.5) {
      this.postureText.textContent = 'WALK';
    } else {
      this.postureText.textContent = 'STAND';
    }
  }
}

// Boot up game on DOM load
window.addEventListener('DOMContentLoaded', () => {
  new GameApp();
});
