# AGENTS.md — constants discipline (enforcing)

This repo tunes a Three.js FPS. Gameplay numbers drift fast, so shared
tuning MUST live in `src/constants/`. Reviewers MUST reject new magic
numbers in gameplay logic.

## 1. Where constants live

| Domain | File | Examples |
|---|---|---|
| Assets/paths | `src/constants/assets.ts` | `MODELS`, `SOUNDS`, `HAND_MODEL_PATH` |
| Player/camera | `src/constants/player.ts` | `STANCES`, `PLAYER.GRAVITY`, `MANTLE.*`, `CAMERA.*` |
| Weapons | `src/constants/weapons.ts` | `WEAPON_DEFS`, `WEAPONS.*`, `RELOAD_CUES.*` |
| VFX pools | `src/constants/effects.ts` | `EFFECTS.MAX_TRACERS`, `MUZZLE_FLASH.*` |
| Audio | `src/constants/audio.ts` | `AUDIO.MAX_VOICES`, `REVERB_REFLECTIONS` |
| Input | `src/constants/input.ts` | `INPUT.SENSITIVITY`, key codes |
| World/targets | `src/constants/world.ts` | `WORLD.FOG_DENSITY`, `TARGETS.*` |

Import from the barrel:

```ts
// Good
import { PLAYER, STANCES } from '../constants/player';
import { WEAPONS } from '../constants/weapons';

// Bad — do not hardcode, do not duplicate
const gravity = -20.0;
const BURST_RESET = 0.35;
```

`src/assets.ts` is a backward-compat re-export shim only. New code MUST
import from `src/constants/*`.

## 2. MUST rules (blocking review)

1. No new numeric/string literals for gameplay, VFX pool sizes, audio
   levels, input bindings, or asset paths in `*.ts` logic. Name them in
   `src/constants/` and import.
2. `src/constants/` files MUST be pure: no `THREE.*` construction, no DOM,
   no `process.env`, no side effects. Store offsets as tuples
   (see `WEAPON_DEFS[].idleOffset`), build `Vector3` at the call site.
3. Grouped objects MUST use `as const`. Derive types, don't repeat unions:
   `export type Stance = keyof typeof STANCES`.
4. Scalars MUST be `SCREAMING_SNAKE_CASE` with units where relevant:
   `_S`, `_MS`, `_PER_S`, `_M`. Example: `RECOVER_HOLD_S`, `FLASH_DURATION_S`.
5. Every new constant MUST be exported through `src/constants/index.ts`.
6. Env-dependent values or secrets MUST NOT go in `constants/`. If ever
   needed, create `src/config/env.ts` with schema validation + defaults.

## 3. SHOULD rules (single-use exemption)

Per-mesh geometry positions, keyframe choreography tables
(`updateReloadAnim`), and one-off integration details (shell bounce,
smoke drag) MAY stay local IFF:

- used in exactly one file, AND
- declared `private static readonly` with a unit comment.

Promote to `src/constants/` on second use. Never copy-paste a value —
import it.

## 4. Review checklist

- [ ] New tuning number? It is in `src/constants/<domain>.ts`, not inline.
- [ ] Barrel updated? Import comes from `../constants*`, not a duplicate.
- [ ] `as const` + derived type used instead of `enum` or repeated literals?
- [ ] No value changes smuggled into a move PR (moves are verbatim)?
- [ ] `npm run typecheck` + `npm run ci:quality` pass?

## 5. Verification

```bash
npm run typecheck
npm run ci:quality
npm run build
```

Moves MUST be behavior-identical. Retunes go in a separate PR.
