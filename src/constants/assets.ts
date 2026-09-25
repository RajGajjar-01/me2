// Asset paths + model/sound manifests.
// Pure: no THREE, no DOM, no process.env. Import from '@/constants' barrel.
export const SOUNDS = {
  ak47: '/sounds/ak47.mp3',
  shotgun: '/sounds/shotgun.mp3',
  reload: '/sounds/reload.mp3',
  footstep: '/sounds/footstep.mp3',
  shellDrop: '/sounds/shell_drop.mp3',
} as const;

export type SoundKey = keyof typeof SOUNDS;
