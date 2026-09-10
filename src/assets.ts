export const MODELS = {
  ak47: '/models/ak47.glb',
  pistol: '/models/pistol.glb',
  shotgun: '/models/shotgun.glb',
  character: '/models/character.glb',
} as const;

export const SOUNDS = {
  ak47: '/sounds/ak47.mp3',
  shotgun: '/sounds/shotgun.mp3',
  reload: '/sounds/reload.mp3',

  footstep: '/sounds/footstep.mp3',
} as const;

export type ModelKey = keyof typeof MODELS;
export type SoundKey = keyof typeof SOUNDS;
