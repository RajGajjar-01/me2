/**
 * Every runtime-fetched asset path in one place.
 *
 * These files live in `public/`, which Vite serves verbatim at the site root — so
 * the keys here are URLs, not bundler imports, and are fetched at runtime by
 * GLTFLoader / fetch rather than being hashed into the build.
 *
 * Adding a weapon should mean adding an entry here, not hunting for a string
 * literal inside a loader call. Licences and sources for each file are recorded
 * in `public/sounds/CREDITS.md`.
 */

export const MODELS = {
  ak47: '/models/ak47.glb',
  pistol: '/models/pistol.glb',
  shotgun: '/models/shotgun.glb',
  character: '/models/character.glb'
} as const;

export const SOUNDS = {
  /** Serves both single taps and sustained fire — see SoundEngine.playRifleShot. */
  ak47: '/sounds/ak47.mp3',
  shotgun: '/sounds/shotgun.mp3',
  reload: '/sounds/reload.mp3'
} as const;

export type ModelKey = keyof typeof MODELS;
export type SoundKey = keyof typeof SOUNDS;
