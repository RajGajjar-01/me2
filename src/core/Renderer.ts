import * as THREE from 'three';

export class GameRenderer {
  public renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();

    this.scene.fog = new THREE.FogExp2(0xa5c7eb, 0.0035);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });

    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    window.addEventListener('resize', this.onWindowResize.bind(this));
  }

  private onWindowResize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  }

  public compile(camera: THREE.Camera): void {
    this.renderer.compile(this.scene, camera);
  }

  public render(camera: THREE.Camera): void {
    this.renderer.render(this.scene, camera);
  }
}
