// Asset paths + model/sound manifests.
// Pure: no THREE, no DOM, no process.env. Import from '@/constants' barrel.
export const MODELS = {
  ak47: '/models/ak47.glb',
  pistol: '/models/pistol.glb',
  shotgun: '/models/shotgun.glb',
} as const;

export const SOUNDS = {
  ak47: '/sounds/ak47.mp3',
  shotgun: '/sounds/shotgun.mp3',
  reload: '/sounds/reload.mp3',
  footstep: '/sounds/footstep.mp3',
  shellDrop: '/sounds/shell_drop.mp3',
} as const;

export const HAND_MODEL_PATH = '/models/hands/rigged_hand.glb';

export type ModelKey = keyof typeof MODELS;
export type SoundKey = keyof typeof SOUNDS;
