// Input bindings + sensitivity. Single source for key codes
// so PlayerController / WeaponManager / main.ts cannot drift.

export const INPUT = {
  SENSITIVITY: 0.0022,
  MOVE_FORWARD: ['KeyW', 'ArrowUp'] as const,
  MOVE_BACK: ['KeyS', 'ArrowDown'] as const,
  MOVE_RIGHT: ['KeyD', 'ArrowRight'] as const,
  MOVE_LEFT: ['KeyA', 'ArrowLeft'] as const,
  SPRINT: ['ShiftLeft', 'ShiftRight'] as const,
  JUMP: 'Space' as const,
  CROUCH_TOGGLE: 'KeyC' as const,
  PRONE_TOGGLE: 'KeyZ' as const,
  LEAN_RIGHT: 'KeyE' as const,
  LEAN_LEFT: 'KeyQ' as const,
  RELOAD: 'KeyR' as const,
  SLOT_1: 'Digit1' as const,
  SLOT_2: 'Digit2' as const,
  SLOT_3: 'Digit3' as const,
  QUICK_SWAP: 'KeyX' as const,
  PHOTO_MODE: 'KeyP' as const,
  FIRE_MOUSE_BUTTON: 0,
  ADS_MOUSE_BUTTON: 2,
} as const;
