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
  'Hit_Head',
  'Death01',
  'Hit_Knockback',
  'Pistol_Idle_Loop',
  'Pistol_Aim_Neutral',
  'Pistol_Shoot',
  'Pistol_Reload',
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
  'Pistol_Aim_Neutral',
  'Pistol_Shoot',
  'Pistol_Reload',
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
  // Clip stride speeds (m/s at 1x), as in erangel-run. Clips never play
  // faster than 1x; below full speed they slow down with the body.
  WALK_CLIP_SPEED: 1.3 / 1.333,
  SPRINT_CLIP_SPEED: 5.5 / 0.667,
  CROUCH_CLIP_SPEED: 1.5 / 2,
  // Prone: no prone clip exists, so the idle pose is laid face-down.
  PRONE_BLEND_PER_S: 6,
  PRONE_HEIGHT_M: 0.15,
  // Shift so the lying body is centred on the capsule, not the feet.
  PRONE_BODY_SHIFT_M: 0.75,
  // Lift the head (rad) so a face-down body looks forward.
  PRONE_NECK_LIFT: 1.35,
  // Point the feet back (rad) so the tops of the feet lie on the ground
  // instead of the toes stabbing into it.
  PRONE_FOOT_POINT: 1.2,
  // Prone leg direction in the body frame (x out, y up, +z toward the feet).
  PRONE_LEG_DIR: [0.12, -0.18, 1] as const,
  // Frog crawl: one leg cycle per CRAWL_STRIDE_M travelled. The knee is
  // drawn up sideways along the ground (hip swings out, shin folds back).
  CRAWL_STRIDE_M: 0.6,
  CRAWL_HIP_OUT: 0.7,
  CRAWL_KNEE_BEND: 1.1,
  MOVE_ANIM_MIN_SPEED: 0.4,
  TURN_RATE_PER_S: 12,
  LAND_TIME_SCALE: 1.6,
  // First-person eye relative to the Head bone (x right, y up, -z forward).
  FPV_EYE_OFFSET: [0, 0.1, -0.05] as const,
  // Head bone scale in first-person: collapses head, hair and eyes.
  FPV_HEAD_SCALE: 0.001,
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
// The gun is posed from the hero's eyes exactly like the first-person
// viewmodel (WEAPON_DEFS offsets), so both views hold it identically.
export const GUN_HOLD = {
  // Third-person carry when not aiming/firing: the gun pivots down (rad)
  // about the right hand and angles across the body (yaw, rad). The
  // two-handed sprint carry stays shallower so the left hand keeps reach
  // while the sprint clip pumps the shoulders.
  LOW_READY_PITCH: -0.65,
  LOW_READY_YAW: 0.4,
  // ...and drops toward the right hip, clear of the head (m, body frame).
  LOW_READY_OFFSET: [0.04, -0.12, 0] as const,
  SPRINT_PITCH: -0.4,
  SPINE_PITCH_SHARE: 0.5,
  IK_BLEND_PER_S: 10,
  // Hand pose in the gun frame (x right, y up, -z forward): where the fingers
  // point and which way the palm faces. Right hand wraps the pistol grip
  // (palm toward the gun's left side); left hand cups the handguard from below.
  RIGHT_FINGERS: [-0.3, -0.3, -1] as const,
  RIGHT_PALM: [-1, 0, 0] as const,
  LEFT_FINGERS: [0.3, 0, -1] as const,
  LEFT_PALM: [0.3, 1, 0] as const,
  // Wrist sits this far behind the grip (the hero's knuckles are 11.7 cm
  // from the wrist, so the grip lands at the base of the fingers), and the
  // palm this far off the grip axis.
  PALM_REACH_M: 0.11,
  GRIP_RADIUS_M: 0.02,
  // Finger curl per joint (01, 02, 03; rad) from the straight rest pose,
  // bending toward the palm so the hand wraps the gun instead of a fist.
  // Right: index rests straight along the trigger guard.
  FINGER_CURL: {
    r: {
      index: [0.15, 0.2, 0.1],
      middle: [1.0, 1.2, 0.7],
      ring: [1.05, 1.2, 0.7],
      pinky: [1.1, 1.2, 0.7],
      thumb: [0.3, 0.5, 0.3],
    },
    l: {
      index: [0.8, 1.0, 0.6],
      middle: [0.85, 1.0, 0.6],
      ring: [0.9, 1.0, 0.6],
      pinky: [0.95, 1.0, 0.6],
      thumb: [0.3, 0.4, 0.3],
    },
  } as const,
  // Elbow pole directions in the aim frame.
  POLE_RIGHT: [0.8, -1, 0.3] as const,
  POLE_LEFT: [-0.8, -1, 0.2] as const,
} as const;

// Pistols use erangel-run's own pistol clips and hand attachment (src/main.js
// attachPistol + GUN_FIT), copied as-is. Hand-local metres / radians.
export const ERANGEL_PISTOL = {
  HAND_OFFSET: [-0.025, 0.075, 0.025] as const,
  HAND_ROT_X: Math.PI / 2,
  // GUN_FIT: y, z - fwd
  FIT: [0, -0.018, 0.012 - 0.025] as const,
  // Grip point: 16% along from the back, 22% up the gun's bounds.
  GRIP_ALONG: 0.16,
  GRIP_UP: 0.22,
  SHOOT_FADE_S: 0.04,
  RELOAD_FADE_S: 0.1,
} as const;
