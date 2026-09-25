// Quaternius hero character: clips, locomotion timings, third-person camera,
// and the procedural rifle-hold IK. Assets come from scripts/sync-quaternius.py.

export const HERO_CLIPS = [
  'Idle_Loop',
  'Walk_Loop',
  'Sprint_Loop',
  'Crouch_Idle_Loop',
  'Crouch_Fwd_Loop',
  'Jump_Loop',
  'Jump_Land',
  'Roll',
  'Swim_Fwd_Loop',
  'Hit_Head',
  'Death01',
  'Hit_Knockback',
  'Slide_Start',
  'Slide_Loop',
  'Slide_Exit',
  'ClimbUp_1m',
] as const;

export type HeroClip = (typeof HERO_CLIPS)[number];

// Clips that play once and hold their last frame.
export const HERO_ONE_SHOTS: readonly HeroClip[] = [
  'Jump_Land',
  'Roll',
  'Hit_Head',
  'Death01',
  'Hit_Knockback',
  'Slide_Start',
  'Slide_Exit',
  'ClimbUp_1m',
];

export const HERO = {
  // UAL rest pelvis height (m); clip pelvis translation is rescaled to the rig.
  UAL_PELVIS_REST_M: 0.918,
  // UAL clips put the soles 1-4 cm below rig zero.
  FOOT_LIFT_M: 0.035,
  FADE_S: 0.2,
  FADE_FAST_S: 0.08,
  // Clip playback rate matched to physics speed (m/s the clip was authored at).
  WALK_CLIP_SPEED: 1.9,
  SPRINT_CLIP_SPEED: 6.2,
  CROUCH_CLIP_SPEED: 1.6,
  PRONE_CLIP_SPEED: 1.2,
  // Swim_Fwd_Loop is the face-down crawl used for prone; it sits below rig zero.
  PRONE_LIFT_M: 0.14,
  MOVE_ANIM_MIN_SPEED: 0.4,
  TURN_RATE_PER_S: 12,
  LAND_TIME_SCALE: 1.6,
  // Enemies
  ENEMY_WALK_SPEED_SCALE: 1.15,
} as const;

export const MOVES = {
  // Roll: UAL1 Roll travels 4.99 m over its first 0.864 s.
  ROLL_SPEED: 5.78,
  ROLL_MOVE_S: 0.864,
  ROLL_DURATION_S: 1.2,
  // Slide: starts at sprint speed and bleeds off.
  SLIDE_DURATION_S: 1.0,
  SLIDE_FRICTION_PER_S: 1.6,
  SLIDE_EXIT_S: 0.5,
} as const;

export const TPP_CAMERA = {
  DISTANCE_M: 2.6,
  SHOULDER_RIGHT_M: 0.55,
  HEIGHT_ABOVE_EYE_M: 0.15,
  COLLISION_MARGIN_M: 0.2,
  MIN_DISTANCE_M: 0.4,
  FREE_LOOK_PITCH_LIMIT: 1.2,
  FREE_LOOK_RETURN_PER_S: 10,
} as const;

// Rifle hold, all in the aim frame (x right, y up, -z forward), metres.
// Right-hand grip target relative to the chest bone; the gun hangs off it.
export const GUN_HOLD = {
  RIGHT_HAND_ANCHOR: [0.15, -0.02, -0.32] as const,
  // Lowered carry pitch when not aiming (rad); sprint lowers it further.
  LOWERED_PITCH: -0.35,
  SPRINT_PITCH: -0.75,
  SPINE_PITCH_SHARE: 0.5,
  IK_BLEND_PER_S: 10,
  // Elbow pole directions in the aim frame.
  POLE_RIGHT: [0.8, -1, 0.3] as const,
  POLE_LEFT: [-0.8, -1, 0.2] as const,
} as const;

// Per weapon (index matches WEAPON_DEFS): hand grips + muzzle in rig space.
// Values are the viewmodel hand placements from WeaponModels.
export const GUN_GRIPS = [
  {
    RIGHT: [0.03, -0.14, -0.34] as const,
    LEFT: [0.0, -0.085, -0.6] as const,
    MUZZLE: [0, 0.07, -0.97] as const,
  },
  {
    RIGHT: [0.012, -0.06, 0.045] as const,
    LEFT: [-0.022, -0.07, 0.02] as const,
    MUZZLE: [0, 0.032, -0.29] as const,
  },
  {
    RIGHT: [0.028, -0.09, -0.386] as const,
    LEFT: [-0.03, -0.062, -0.64] as const,
    MUZZLE: [0, 0.045, -0.815] as const,
  },
] as const;
