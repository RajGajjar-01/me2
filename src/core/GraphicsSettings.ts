import * as THREE from 'three';
import type { WebGLPathTracer } from 'three-gpu-pathtracer';
import {
  GRAPHICS,
  QUALITY_PRESETS,
  type QualityPreset,
} from '../constants/graphics';
import { WORLD } from '../constants/world';

export interface GraphicsOptions {
  preset: QualityPreset | 'custom';
  resolutionScale: number;
  shadows: boolean;
  shadowMapSize: number;
  softShadows: boolean;
  antialias: boolean;
  rayTracing: boolean;
  fpsCap: number;
  dynamicResolution: boolean;
  showFps: boolean;
}

export interface HardwareInfo {
  gpu: string;
  ramGb?: number;
  cores?: number;
}

export function detectPreset(hw: HardwareInfo): QualityPreset {
  const lowRam = hw.ramGb !== undefined && hw.ramGb < GRAPHICS.LOW_RAM_GB;
  const lowCpu = hw.cores !== undefined && hw.cores <= GRAPHICS.LOW_CPU_CORES;
  if (GRAPHICS.LOW_GPU_PATTERN.test(hw.gpu) || lowRam || lowCpu) return 'low';
  if (GRAPHICS.HIGH_GPU_PATTERN.test(hw.gpu)) {
    return (hw.cores ?? 0) >= 8 ? 'ultra' : 'high';
  }
  return 'medium';
}

export function presetOptions(
  preset: QualityPreset,
): Omit<GraphicsOptions, 'fpsCap' | 'showFps' | 'rayTracing'> {
  const p = QUALITY_PRESETS[preset];
  return {
    preset,
    resolutionScale: p.RESOLUTION_SCALE,
    shadows: p.SHADOWS,
    shadowMapSize: p.SHADOW_MAP_SIZE,
    softShadows: p.SOFT_SHADOWS,
    antialias: p.ANTIALIAS,
    // Low-end machines need it most; high-end keeps a fixed scale.
    dynamicResolution: preset === 'low' || preset === 'medium',
  };
}

function readHardware(): HardwareInfo {
  let gpu = '';
  const gl = document.createElement('canvas').getContext('webgl2');
  if (gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  return { gpu, ramGb: nav.deviceMemory, cores: nav.hardwareConcurrency };
}

function loadOptions(): { opts: GraphicsOptions; detected: QualityPreset } {
  const hw = readHardware();
  const detected = detectPreset(hw);
  const defaults: GraphicsOptions = {
    ...presetOptions(detected),
    rayTracing: false,
    fpsCap: GRAPHICS.DEFAULT_FPS_CAP,
    showFps: true,
  };
  try {
    const saved = localStorage.getItem(GRAPHICS.STORAGE_KEY);
    if (saved) return { opts: { ...defaults, ...JSON.parse(saved) }, detected };
  } catch {
    // Blocked storage or corrupt JSON: fall back to detected defaults.
  }
  return { opts: defaults, detected };
}

export class GraphicsSettings {
  public readonly opts: GraphicsOptions;
  public readonly detectedPreset: QualityPreset;
  public onChange?: () => void;

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private sun!: THREE.DirectionalLight;
  private sky!: THREE.Object3D;

  private dynScale: number;
  private dynAccS = 0;
  private dynFrames = 0;
  private dynGoodWindows = 0;
  private lastFrameMs = 0;

  private pathTracer?: WebGLPathTracer;
  private photoMode = false;

  constructor() {
    const { opts, detected } = loadOptions();
    this.opts = opts;
    this.detectedPreset = detected;
    this.dynScale = opts.resolutionScale;
  }

  /** Antialias is a context-creation flag, so the renderer reads it here. */
  public get antialias(): boolean {
    return this.opts.antialias;
  }

  public attach(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    sun: THREE.DirectionalLight,
    sky: THREE.Object3D,
  ): void {
    this.renderer = renderer;
    this.scene = scene;
    this.sun = sun;
    this.sky = sky;
    window.addEventListener('resize', () => this.applyPixelRatio());
    this.apply();
  }

  public update(patch: Partial<GraphicsOptions>): void {
    Object.assign(this.opts, patch);
    if (patch.resolutionScale !== undefined || patch.dynamicResolution) {
      this.dynScale = this.opts.resolutionScale;
    }
    try {
      localStorage.setItem(GRAPHICS.STORAGE_KEY, JSON.stringify(this.opts));
    } catch {
      // Storage blocked: settings still apply for this session.
    }
    if (this.renderer) this.apply();
    this.onChange?.();
  }

  public setPreset(preset: QualityPreset): void {
    this.update(presetOptions(preset));
  }

  private apply(): void {
    this.applyPixelRatio();

    const sm = this.renderer.shadowMap;
    const type = this.opts.softShadows
      ? THREE.PCFSoftShadowMap
      : THREE.PCFShadowMap;
    const shadowsChanged = sm.enabled !== this.opts.shadows || sm.type !== type;
    sm.enabled = this.opts.shadows;
    sm.type = type;
    this.sun.castShadow = this.opts.shadows;

    const size = this.opts.shadowMapSize;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      // Frees the old GPU texture; three reallocates at the new size.
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }

    // Shadow on/off changes shader defines; force program rebuild.
    if (shadowsChanged) {
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!m) return;
        for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
      });
    }
  }

  private applyPixelRatio(): void {
    const scale = this.opts.dynamicResolution
      ? this.dynScale
      : this.opts.resolutionScale;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, WORLD.PIXEL_RATIO_MAX) * scale,
    );
  }

  public get currentScale(): number {
    return this.opts.dynamicResolution
      ? this.dynScale
      : this.opts.resolutionScale;
  }

  /** FPS cap gate: call with the rAF timestamp; false = skip this frame. */
  public shouldRenderFrame(nowMs: number): boolean {
    if (this.opts.fpsCap <= 0) return true;
    const interval = 1000 / this.opts.fpsCap;
    const elapsed = nowMs - this.lastFrameMs;
    // Half-ms slack so a 60 cap on a 60Hz display never drops frames.
    if (elapsed < interval - 0.5) return false;
    // Advance on a fixed grid; resync after a stall (tab switch, hitch).
    this.lastFrameMs =
      elapsed > interval * 2 ? nowMs : this.lastFrameMs + interval;
    return true;
  }

  /**
   * Dynamic resolution: drop fast when frames miss the target, climb back
   * slowly (several good windows) so it doesn't oscillate.
   */
  public trackFrame(deltaS: number): void {
    if (!this.opts.dynamicResolution) return;
    this.dynAccS += deltaS;
    this.dynFrames++;
    if (this.dynAccS < GRAPHICS.DYNRES_WINDOW_S) return;

    const avgMs = (this.dynAccS / this.dynFrames) * 1000;
    this.dynAccS = 0;
    this.dynFrames = 0;
    const targetMs = 1000 / (this.opts.fpsCap || GRAPHICS.DEFAULT_FPS_CAP);

    let next = this.dynScale;
    if (avgMs > targetMs * GRAPHICS.DYNRES_DOWN_RATIO) {
      next -= GRAPHICS.DYNRES_STEP;
      this.dynGoodWindows = 0;
    } else if (avgMs < targetMs * GRAPHICS.DYNRES_UP_RATIO) {
      if (++this.dynGoodWindows >= GRAPHICS.DYNRES_UP_WINDOWS) {
        next += GRAPHICS.DYNRES_STEP;
        this.dynGoodWindows = 0;
      }
    }
    next = THREE.MathUtils.clamp(
      next,
      GRAPHICS.RESOLUTION_SCALE_MIN,
      this.opts.resolutionScale,
    );
    if (next !== this.dynScale) {
      this.dynScale = next;
      this.applyPixelRatio();
    }
  }

  // ── Ray tracing: progressive path-traced still ("photo mode") ──
  // Real-time path tracing isn't viable for gameplay in WebGL, so RT
  // freezes the frame and converges a path-traced image of it.

  public get inPhotoMode(): boolean {
    return this.photoMode;
  }

  public async togglePhotoMode(camera: THREE.Camera): Promise<void> {
    if (this.photoMode) {
      this.photoMode = false;
      this.sky.visible = true;
      this.scene.background = null;
      return;
    }
    if (!this.opts.rayTracing) return;
    if (!this.pathTracer) {
      // Lazy-load so low-end machines never download the path tracer.
      const { WebGLPathTracer } = await import('three-gpu-pathtracer');
      const pt = new WebGLPathTracer(this.renderer);
      pt.bounces = GRAPHICS.RT_BOUNCES;
      pt.tiles.set(GRAPHICS.RT_TILES, GRAPHICS.RT_TILES);
      pt.minSamples = 1;
      pt.renderDelay = 0;
      pt.dynamicLowRes = true;
      pt.lowResScale = GRAPHICS.RT_LOW_RES_SCALE;
      this.pathTracer = pt;
    }
    // The Sky shader dome would occlude the sun in the path tracer; swap
    // it for a flat sky colour that also acts as environment light.
    this.sky.visible = false;
    this.scene.background = new THREE.Color(WORLD.FOG_COLOR);
    this.pathTracer.setScene(this.scene, camera);
    this.photoMode = true;
  }

  public renderPhotoSample(): number {
    this.pathTracer!.renderSample();
    return Math.floor(this.pathTracer!.samples);
  }
}
