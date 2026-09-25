import * as THREE from 'three';
import { loadHeroAssets } from './character/HeroModel';
import { AUDIO } from './constants/audio';
import { INPUT } from './constants/input';
import { CAMERA, PLAYER } from './constants/player';
import { WEAPONS } from './constants/weapons';
import { WORLD } from './constants/world';
import { GraphicsSettings } from './core/GraphicsSettings';
import { InputManager } from './core/InputManager';
import { GameRenderer } from './core/Renderer';
import { OutdoorRange } from './environment/OutdoorRange';
import { PlayerCharacter } from './player/PlayerCharacter';
import { PlayerController } from './player/PlayerController';
import { CombatHUD } from './ui/CombatHUD';
import { SettingsPanel } from './ui/SettingsPanel';
import { TacticalTelemetry } from './ui/TacticalTelemetry';
import { WeaponManager } from './weapons/WeaponManager';

class GameApp {
  private gfx = new GraphicsSettings();
  private settingsPanel: SettingsPanel;
  private renderer: GameRenderer;
  private input: InputManager;
  private range: OutdoorRange;
  private player!: PlayerController;
  private weapons!: WeaponManager;
  private playerCharacter!: PlayerCharacter;
  private telemetry: TacticalTelemetry;
  private combatHud!: CombatHUD;
  private clock: THREE.Clock = new THREE.Clock();
  private isLoaded = false;

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
  private settingsBtn = document.getElementById('settings-btn')!;
  private photoBadge = document.getElementById('photo-badge')!;
  private photoSpp = document.getElementById('photo-spp')!;

  private frameCount = 0;
  private fpsTime = 0;

  constructor() {
    const canvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;
    this.renderer = new GameRenderer(canvas, this.gfx.antialias);
    this.input = new InputManager(canvas);
    this.range = new OutdoorRange(this.renderer.scene);
    this.telemetry = new TacticalTelemetry();
    this.combatHud = new CombatHUD(document.getElementById('game-container')!);
    this.settingsPanel = new SettingsPanel(this.gfx);

    this.setupUI();
    this.startAssetLoading();

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  private async startAssetLoading(): Promise<void> {
    try {
      await this.range.buildWithProgress((percent, status) => {
        this.loaderFill.style.width = `${percent}%`;
        this.loaderPercent.textContent = `${percent}%`;
        this.loaderStatus.textContent = status;
      });

      this.gfx.attach(
        this.renderer.renderer,
        this.renderer.scene,
        this.range.sunLight,
        this.range.sky,
      );

      this.player = new PlayerController(
        CAMERA.DEFAULT_FOV,
        window.innerWidth / window.innerHeight,
        this.input,
        this.range.bvh,
      );

      this.renderer.scene.add(this.player.camera);

      this.weapons = new WeaponManager(
        this.player.camera,
        this.input,
        this.renderer.scene,
        this.range.colliderMesh,
      );

      this.weapons.onRecoil = (pitch, yaw) =>
        this.player!.applyRecoil(pitch, yaw);

      this.player.onFootstep = (stance, isSprinting) => {
        const gain =
          stance === 'prone'
            ? AUDIO.FOOTSTEP_GAIN_PRONE
            : stance === 'crouch'
              ? AUDIO.FOOTSTEP_GAIN_CROUCH
              : isSprinting
                ? AUDIO.FOOTSTEP_GAIN_SPRINT
                : AUDIO.FOOTSTEP_GAIN_WALK;
        this.weapons.soundEngine.playFootstep(
          gain,
          isSprinting ? AUDIO.FOOTSTEP_RATE_SPRINT : AUDIO.FOOTSTEP_RATE_WALK,
        );
      };
      await this.weapons.loadAssets((status) => {
        this.loaderStatus.textContent = status;
        this.loaderPercent.textContent = '95%';
        this.loaderFill.style.width = '95%';
      });
      this.setupWeaponEvents();
      this.playerCharacter = new PlayerCharacter(
        this.renderer.scene,
        this.player,
        await loadHeroAssets(),
        this.weapons.weaponRigs,
      );

      this.loaderStatus.textContent = 'PRE-HEATING GPU SHADER CACHE...';
      await new Promise((r) => requestAnimationFrame(r));
      this.renderer.compile(this.player.camera);

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
      if (this.accuracyCounter)
        this.accuracyCounter.textContent = `${acc.toFixed(0)}%`;
    };

    this.weapons.onRecoilTelemetry = (spreadX, spreadY, isHit) => {
      this.telemetry.recordShot(spreadX, spreadY, isHit);
    };

    this.weapons.dummyManager.onDummyHit = (
      damage,
      isHeadshot,
      isKill,
      hitPoint,
      dummyId,
      currentHp,
      maxHp,
    ) => {
      this.combatHud.registerHit(
        damage,
        isHeadshot,
        isKill,
        hitPoint,
        this.player.camera,
        dummyId,
        currentHp,
        maxHp,
      );
    };

    this.weapons.notifyAmmo();
  }

  private setupUI(): void {
    this.settingsBtn.addEventListener('click', () => this.settingsPanel.open());

    this.startBtn.addEventListener('click', () => {
      if (!this.isLoaded) return;
      this.input.requestLock();
    });

    this.input.onLockChange = (locked) => {
      if (!locked && this.gfx.inPhotoMode) this.togglePhotoMode();
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

  private togglePhotoMode(): void {
    this.gfx.togglePhotoMode(this.player.camera).then(() => {
      this.photoBadge.classList.toggle('hidden', !this.gfx.inPhotoMode);
    });
  }

  private animate(now: number): void {
    requestAnimationFrame(this.animate);
    if (!this.gfx.shouldRenderFrame(now)) return;

    const delta = Math.min(this.clock.getDelta(), WORLD.FRAME_DELTA_MAX_S);

    if (this.isLoaded && this.player) {
      if (this.input.isLocked && this.input.isKeyPressed(INPUT.PHOTO_MODE)) {
        this.togglePhotoMode();
      }
      if (this.gfx.inPhotoMode) {
        // Frozen frame: drop look input so the camera doesn't jump on exit.
        this.input.consumeMouseDelta();
        this.photoSpp.textContent = `${this.gfx.renderPhotoSample()}`;
        return;
      }
      if (this.input.isLocked) {
        const aiming =
          this.weapons.isAiming ||
          this.input.isMouseDown(INPUT.FIRE_MOUSE_BUTTON);
        const tpp = this.player.viewMode === 'tpp';
        this.player.aimLock = aiming;
        this.player.sprintBlocked = this.weapons.isReloading;
        this.weapons.proneHold = this.player.stance === 'prone';
        this.weapons.viewmodelContainer.visible = !tpp;
        this.weapons.thirdPersonMuzzle = tpp
          ? this.playerCharacter.muzzle(this.weapons.currentWeaponIndex)
          : null;
        if (this.weapons) {
          this.weapons.stanceKickMult =
            this.player.stance === 'prone'
              ? WEAPONS.STANCE_KICK_PRONE
              : this.player.stance === 'crouch'
                ? WEAPONS.STANCE_KICK_CROUCH
                : WEAPONS.STANCE_KICK_STAND;
          this.weapons.update(
            delta,
            this.player.getSpeed(),
            this.player.onGround,
          );
        }
        this.player.update(delta);
        this.playerCharacter.update(
          delta,
          this.weapons.currentWeaponIndex,
          aiming,
        );
      }

      this.updateHUD(delta);
      this.renderer.render(this.player.camera);
      this.gfx.trackFrame(delta);

      this.telemetry.recordFrame(
        delta,
        this.renderer.renderer.info.render.calls,
        this.renderer.renderer.info.render.triangles,
      );
    }
  }

  private updateHUD(delta: number): void {
    if (!this.player) return;

    this.frameCount++;
    this.fpsTime += delta;
    if (this.fpsTime >= WORLD.HUD_FPS_WINDOW_S) {
      const currentFps = Math.round(this.frameCount / this.fpsTime);
      this.fpsCounter.textContent = `${currentFps}`;
      this.frameCount = 0;
      this.fpsTime = 0;
    }

    const staminaPercent = (this.player.stamina / this.player.maxStamina) * 100;
    this.staminaBar.style.width = `${staminaPercent}%`;

    const speed = this.player.getSpeed();
    this.speedText.textContent = `${speed.toFixed(1)} M/S`;

    const move = this.player.move;
    if (move !== 'normal') {
      this.postureText.textContent =
        move === 'mantle' ? 'CLIMB' : move.toUpperCase();
    } else if (!this.player.onGround) {
      this.postureText.textContent = 'AIR';
    } else if (this.player.stance === 'prone') {
      this.postureText.textContent = 'PRONE';
    } else if (this.player.stance === 'crouch') {
      this.postureText.textContent = 'CROUCH';
    } else if (this.player.isSprinting) {
      this.postureText.textContent = 'SPRINT';
    } else if (speed > PLAYER.SPEED_WALK_LABEL_THRESHOLD) {
      this.postureText.textContent = 'WALK';
    } else {
      this.postureText.textContent = 'STAND';
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new GameApp();
});
