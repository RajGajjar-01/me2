import * as THREE from 'three';
import { Hero, loadOutfitAssets } from '../character/HeroModel';
import { MENU_HERO } from '../constants/character';

/** Idle hero rendered on its own transparent canvas beside the start menu. */
export class MenuHero {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(MENU_HERO.FOV_DEG, 1, 0.1, 50);
  private clock = new THREE.Clock();
  private hero: Hero | null = null;
  private targetYaw = 0;
  private yaw = 0;
  private frame = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, MENU_HERO.MAX_PIXEL_RATIO),
    );
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = MENU_HERO.EXPOSURE;

    this.camera.position.set(...MENU_HERO.CAMERA_POS_M);
    this.camera.lookAt(...MENU_HERO.LOOK_AT_M);

    const light = (
      color: number,
      intensity: number,
      pos: readonly number[],
    ) => {
      const l = new THREE.DirectionalLight(color, intensity);
      l.position.set(pos[0], pos[1], pos[2]);
      this.scene.add(l);
    };
    this.scene.add(
      new THREE.HemisphereLight(
        MENU_HERO.HEMI_SKY,
        MENU_HERO.HEMI_GROUND,
        MENU_HERO.HEMI_INTENSITY,
      ),
    );
    light(MENU_HERO.KEY_COLOR, MENU_HERO.KEY_INTENSITY, MENU_HERO.KEY_POS_M);
    light(MENU_HERO.RIM_COLOR, MENU_HERO.RIM_INTENSITY, MENU_HERO.RIM_POS_M);
    light(MENU_HERO.FILL_COLOR, MENU_HERO.FILL_INTENSITY, MENU_HERO.FILL_POS_M);

    new ResizeObserver(() => this.resize()).observe(canvas);
    window.addEventListener('pointermove', (e) => {
      this.targetYaw =
        ((e.clientX / window.innerWidth) * 2 - 1) * MENU_HERO.POINTER_YAW_RAD;
    });

    loadOutfitAssets().then((assets) => {
      this.hero = new Hero(assets);
      this.hero.play(MENU_HERO.CLIP, 0);
      this.scene.add(this.hero.root);
      canvas.classList.add('ready');
    });
    this.setActive(true);
  }

  /** Render only while the menu is visible. */
  public setActive(active: boolean): void {
    cancelAnimationFrame(this.frame);
    if (!active) return;
    this.clock.getDelta();
    const tick = () => {
      this.render();
      this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private render(): void {
    const dt = this.clock.getDelta();
    if (this.hero) {
      this.yaw +=
        (this.targetYaw - this.yaw) *
        Math.min(1, dt * MENU_HERO.POINTER_FOLLOW_PER_S);
      this.hero.root.rotation.y = MENU_HERO.YAW_RAD + this.yaw;
      this.hero.update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
