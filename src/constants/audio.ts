// Audio tuning: voice caps, reverb impulse, footstep gains.
// Values moved verbatim from SoundEngine + main.ts footstep mapping.

export const AUDIO = {
  MAX_VOICES: 8,
  REVERB_SECONDS: 2.2,
  REVERB_WET: 0.38,
  REVERB_PREDELAY: 0.016,
  REVERB_DECAY_EXP: 2.3,
  FOOTSTEP_GAIN_PRONE: 0.12,
  FOOTSTEP_GAIN_CROUCH: 0.3,
  FOOTSTEP_GAIN_WALK: 0.55,
  FOOTSTEP_GAIN_SPRINT: 0.75,
  FOOTSTEP_RATE_SPRINT: 1.12,
  FOOTSTEP_RATE_WALK: 1.0,
  SHELL_DROP_MAX_DURATION_S: 0.68,
} as const;

export const REVERB_REFLECTIONS = [
  [19, 0.62],
  [37, 0.45],
  [58, 0.3],
  [97, 0.2],
  [168, 0.15],
  [247, 0.1],
  [352, 0.062],
] as const;
