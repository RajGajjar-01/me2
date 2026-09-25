// Graphics quality presets + hardware-tier heuristics.
// Low targets a 2017 ThinkPad (8GB, Intel HD 620): fill-rate bound, so
// resolution + shadows are cut first. Ultra targets discrete / Apple GPUs.

export const QUALITY_PRESETS = {
  low: {
    RESOLUTION_SCALE: 0.75,
    SHADOWS: false,
    SHADOW_MAP_SIZE: 512,
    SOFT_SHADOWS: false,
    ANTIALIAS: false,
  },
  medium: {
    RESOLUTION_SCALE: 1.0,
    SHADOWS: true,
    SHADOW_MAP_SIZE: 1024,
    SOFT_SHADOWS: false,
    ANTIALIAS: false,
  },
  high: {
    RESOLUTION_SCALE: 1.0,
    SHADOWS: true,
    SHADOW_MAP_SIZE: 2048,
    SOFT_SHADOWS: true,
    ANTIALIAS: true,
  },
  ultra: {
    RESOLUTION_SCALE: 1.25,
    SHADOWS: true,
    SHADOW_MAP_SIZE: 4096,
    SOFT_SHADOWS: true,
    ANTIALIAS: true,
  },
} as const;

export type QualityPreset = keyof typeof QUALITY_PRESETS;

export const GRAPHICS = {
  STORAGE_KEY: 'me2.graphics.v1',
  SHADOW_MAP_SIZES: [512, 1024, 2048, 4096] as const,
  RESOLUTION_SCALE_MIN: 0.5,
  RESOLUTION_SCALE_MAX: 1.5,
  RESOLUTION_SCALE_STEP: 0.05,
  // 0 = uncapped (vsync only).
  FPS_CAPS: [30, 60, 90, 120, 144, 0] as const,
  DEFAULT_FPS_CAP: 60,
  // Chrome reports navigator.deviceMemory capped at 8; anything below is low tier.
  LOW_RAM_GB: 8,
  LOW_CPU_CORES: 4,
  // Renderer strings that mean integrated / software GPU.
  LOW_GPU_PATTERN: /intel|swiftshader|llvmpipe|software|mali|adreno|powervr/i,
  HIGH_GPU_PATTERN: /nvidia|geforce|rtx|radeon rx|apple m\d/i,
  // Dynamic resolution: step scale when frame time misses target for this long.
  DYNRES_WINDOW_S: 1.0,
  DYNRES_STEP: 0.05,
  DYNRES_DOWN_RATIO: 1.15,
  // Frame-interval ratio vs target; vsync pins interval at target, so ~1.
  DYNRES_UP_RATIO: 1.05,
  DYNRES_UP_WINDOWS: 3,
  // Ray tracing (path-traced paused frame).
  RT_BOUNCES: 4,
  RT_TILES: 2,
  RT_LOW_RES_SCALE: 0.25,
} as const;
