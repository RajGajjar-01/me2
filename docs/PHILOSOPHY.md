# Project philosophy & roadmap

Browser TDM shooter. PUBG-grade *feel*, Valorant-grade *art direction*,
5v5 on one small map. Not battle royale — that does not fit a browser tab.

This doc is the thing we re-read when tempted to polish the wrong layer.

---

## 1. The ranking function

Work on whatever is **most expensive to change later**, not whatever is
most fun today.

```
netcode architecture   ← structural, invalidates everything above it
game feel / sim        ← structural-ish
content & systems      ← additive
art & graphics         ← almost entirely swappable
```

Art is the most reworkable layer in a game. Studios do a whole "art pass"
at the end for exactly this reason. An ugly working game becomes beautiful;
a beautiful singleplayer game does not become multiplayer without rewriting
the sim underneath it.

**Therefore: netcode first, art last.** Not because art does not matter —
it is our differentiator — but because art built on a design netcode later
forces us to change is the most expensive thing we can throw away.

## 2. Vertical slice, always

Build the thinnest *complete* slice of the real game, end to end, as early
as possible.

> Two players connect → run around a grey box → shoot each other → someone
> dies → respawns → score updates.

Ugly. Cubes for players. One gun. That is a complete game in miniature.
Everything after it is amplification.

**Failure mode this protects against:** eight months on the best weapon
inspect animation in browser history, in a game that never has a second
player in it. Solo projects die here.

**Attack the scariest unknown first.** We already know we can make a gun
feel good — that is done. We do not know that hit registration feels fair
at 80ms ping. Go find out at 6k lines, not 20k.

## 3. Graphics: direction, not fidelity

Browser shooters do not look bad because WebGL is weak. WebGL2 does PBR,
cascaded shadows, SSAO, bloom, TAA. They look bad because of:

1. **No art direction** — programmer art, clashing palette, flat lighting.
   Free to fix. The biggest one.
2. **Download budget** — the real constraint. PUBG ships 40GB. We get
   ~50-150MB before players close the tab.
3. **No baked lighting** — real-time everything on a mid laptop looks washed out.
4. Deliberate low-fi (Krunker targets Chromebooks). Not our choice.

We will never out-texture PUBG. We can out-*look* every browser shooter
with a coherent style. Stylized and readable, not photoreal.

Where browser graphics money actually goes:

- Baked lightmaps + good skybox > more real-time lights
- One consistent material vocabulary > high-res textures everywhere
- KTX2/Basis textures + Draco/meshopt geometry — often 5-10x smaller, build step only
- Restrained post chain: tone mapping (have it), bloom, SSAO, sharpen
- Silhouette and readability over detail — an enemy must read at 80m in 200ms

## 4. Scope discipline

One map. One gun. No progression, no cosmetics, no lobby chat, no ranked.

Every one of those can be added to a working game. None of them save a
broken one.

## 5. Stack decisions (settled — do not relitigate)

| Decision | Choice | Why |
|---|---|---|
| Renderer | **three.js**, stay | 6.3k lines of working systems. Babylon is the better engine on a blank slate; we are not on a blank slate. |
| WebGPU | not yet | We are nowhere near a GPU bottleneck. No custom GLSL, so the swap stays a ~15-line diff whenever we want it. |
| Physics | rapier3d **when ragdolls are needed** | Beside three, not a migration. The only real gap vs Babylon's Havok. |
| Culling | frustum (three's default) | ~300 objects, open outdoor scene. Occlusion queries and octrees are pessimizations at this scale. |
| Transport | **Colyseus / WebSocket** to start | Netcode shape is transport-agnostic. Swap to geckos.io/WebTransport only if measured loss degrades feel. |

Browsers cannot open raw UDP sockets. They *can* get UDP semantics via
WebRTC DataChannel (`ordered:false, maxRetransmits:0`) or WebTransport
datagrams. That is a later transport swap, not an architecture decision.

## 6. Netcode: what actually makes it feel good

In order of impact. **None of these depend on UDP.**

1. **Client-side prediction** — move on keypress, do not wait for the server.
   Without this the game feels broken at any ping.
2. **Server reconciliation** — server corrects, client replays unacked inputs.
3. **Entity interpolation** — render others ~100ms in the past, smoothly.
4. **Lag compensation** — server rewinds hitboxes to what the shooter saw.
   This is what makes hitscan feel fair.
5. ...then transport.

Right over WebSocket feels good. Wrong over UDP feels awful.

---

## Roadmap

- [ ] **0. Fixed-timestep refactor** — a day now, a nightmare later.
      `main.ts:205` uses a variable rAF delta; prediction needs a
      deterministic fixed step. `update(input, FIXED_DT)` taking an input
      struct, accumulator loop, render interpolates between sim states.
- [ ] **1. Two-player networked slice** — cubes, grey box, one gun.
      Prediction + reconciliation + interpolation + lag comp.
      The hard part of the whole project. Do it while nothing can break.
- [ ] **2. Make it fun** — 5v5, spawn logic, scoring, round flow.
      Playtest with real people. Cheapest possible moment to learn the game is bad.
- [ ] **3. One real map** — blocked out for gameplay first, art second.
      Level design is gameplay, not decoration.
- [ ] **4. Art pass** — baked lighting, materials, post, compression budget.
      Now the graphics ambition pays off, landing on a game that works.

### The one exception to "art last"

A pure grey box for six months kills motivation, and motivation is the
scarce resource in a solo project. **One look-dev spike, timeboxed to a
week**: a single small scene, not gameplay, that proves the visual target
is achievable in browser and gives us something to aim at. Then put it
aside and go back to netcode.

Buying proof and morale cheaply is not a violation of the rule. Building
the whole game's art early is.

### Testing netcode

`tc netem` profiles (Linux, already installed). Remove with
`sudo tc qdisc del dev lo root`.

| Scenario | Command tail |
|---|---|
| Good broadband | `delay 15ms 3ms loss 0.1%` |
| Average | `delay 40ms 10ms loss 1%` |
| Bad wifi | `delay 60ms 30ms loss 3% 25%` |
| Mobile | `delay 100ms 40ms loss 5% 25% reorder 2% 50%` |

```bash
sudo tc qdisc add dev lo root netem delay 40ms 10ms distribution normal loss 3%
```

`reorder` is the sneaky one — it catches code that assumes snapshots arrive
in order. Snapshots need a sequence number; stale ones get dropped.
