// Player movement / stance / camera tuning.
// Units suffixed where it matters (_S seconds, _PER_S per-second).
// Values moved verbatim from PlayerController — do not retune here.

export const STANCES = {
  stand: { height: 1.35, eyeOffset: 0.28, speed: 5.2 },
  crouch: { height: 0.35, eyeOffset: 0.22, speed: 3.7 },
  prone: { height: 0.1, eyeOffset: -0.03, speed: 1.3 },
} as const;

export type Stance = keyof typeof STANCES;

export const STRIDE = {
  stand: 1.6,
  crouch: 1.3,
  prone: 0.9,
} as const;

export const SPRINT_STRIDE_MULT = 1.35;

export const PLAYER = {
  CAPSULE_RADIUS: 0.38,
  CAPSULE_START_Y: 0.4,
  CAPSULE_START_Z: 28,
  SPRINT_SPEED: 8.6,
  JUMP_FORCE: 6.8,
  GRAVITY: -20.0,
  MAX_STAMINA: 100,
  STAMINA_MIN_TO_SPRINT: 5,
  STAMINA_DRAIN_PER_S: 26,
  STAMINA_REGEN_PER_S: 20,
  DAMPING_GROUND: 12.0,
  DAMPING_AIR: 2.5,
  RECOIL_RECOVERY: 0.7,
  RECOVER_HOLD_S: 0.09,
  RECOVER_RATE: 9,
  STANCE_BLEND_RATE: 10,
  LEAN_BLEND_RATE: 14,
  LEAN_OFFSET: 0.38,
  LEAN_ROLL: 0.22,
  LEAN_MARGIN: 0.15,
  LEAN_DROP_PER_LEAN: 0.03,
  LEAN_ACTIVE_EPS: 0.001,
  BOB_RATE_WALK: 9,
  BOB_RATE_SPRINT: 14,
  BOB_AMP_X: 0.022,
  BOB_AMP_Y: 0.032,
  PITCH_LIMIT_DIVISOR: 2.1,
  MOUSE_RECENTER_EPS: 0.0004,
  MOVE_EPS_SQ: 0.001,
  SPEED_WALK_LABEL_THRESHOLD: 0.5,
  COLLISION_GROUND_Y: 0.2,
  GROUND_NORMAL_Y: 0.45,
  COLLISION_MARGIN: 0.02,
  NORMAL_EPS_SQ: 0.000001,
  PHYSICS_SUBSTEPS: 2,
} as const;

export const MANTLE = {
  MAX_HEIGHT: 1.5,
  DURATION_S: 0.35,
  MAX_WORLD_Y: 3.0,
  EYE_PROBE_HEIGHT: 1.0,
  WALL_DIST_BONUS: 0.55,
  LIP_PUSH: 0.15,
  PROBE_TOP_BONUS: 0.3,
  PROBE_BOTTOM_SLACK: 0.3,
  LEDGE_TOP_SLACK: 0.02,
  LEDGE_MIN_LIFT: 0.15,
  UP_END_T: 0.6,
  FWD_START_T: 0.4,
  FWD_END_T: 0.6,
} as const;

export const CAMERA = {
  DEFAULT_FOV: 75,
  NEAR: 0.05,
  FAR: 1000,
} as const;
