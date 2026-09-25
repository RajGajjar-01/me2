import * as THREE from 'three';
import { WORLD } from '../constants/world';

export class GameRenderer {
  public renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;

  constructor(canvas: HTMLCanvasElement, antialias: boolean) {
    this.scene = new THREE.Scene();

    this.scene.fog = new THREE.FogExp2(WORLD.FOG_COLOR, WORLD.FOG_DENSITY);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });

    // Pixel ratio + shadow map are owned by GraphicsSettings.
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = WORLD.TONE_MAPPING_EXPOSURE;

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private onWindowResize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  public compile(camera: THREE.Camera): void {
    this.renderer.compile(this.scene, camera);
  }

  public render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }
}
