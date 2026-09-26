"""Copy the hero + its animation clips from ../erangel-run into src/assets/character/.

Everything comes from erangel-run's packed assets (assets/*.js), never from the
raw Quaternius libraries: new clips get packed in erangel-run first
(erangel-run/scripts/pack-animations.py), then synced here.

The output is committed (Quaternius assets are CC0, credited in README.md), so
this only needs re-running when the packed assets in erangel-run change.
"""

import base64
import json
import shutil
import sys
from pathlib import Path

ME2 = Path(__file__).resolve().parents[1]
ERANGEL = ME2.parent / "erangel-run"
OUT = ME2 / "src" / "assets" / "character"

CLIPS = [
    "anim-idle", "anim-walk", "anim-sprint", "anim-roll", "anim-hithead",
    "anim-death", "anim-slide-start", "anim-slide-loop", "anim-slide-exit",
    "anim-climb-up", "anim-crouch-idle", "anim-crouch-walk", "anim-jump-loop",
    "anim-jump-land", "anim-hit-knockback", "anim-pistol-idle", "anim-pistol-aim",
    "anim-pistol-shoot", "anim-pistol-reload", "anim-jab", "anim-cross",
]

# Guns (Quaternius Ultimate Guns, OBJ + MTL). Keep in sync with GUN_MODELS[].FILE
# in src/constants/weapons.ts.
GUNS = ["AssaultRifle_2", "Pistol_1", "Shotgun_2"]
# Attachments from the pack's Accessories folder (GUN_MODELS[].SCOPE.FILE).
ACCESSORIES = ["Scope_2"]


def asset_payload(name):
    """erangel-run ships binaries as `window.__ASSETS[name] = <json or base64>`."""
    text = (ERANGEL / "assets" / f"{name}.js").read_text()
    return json.loads(text[text.index("=", text.index("]")) + 1 :].strip().rstrip(";"))


def main():
    if not ERANGEL.is_dir():
        sys.exit(f"erangel-run not found at {ERANGEL}")
    OUT.mkdir(parents=True, exist_ok=True)

    (OUT / "hero.fbx").write_bytes(base64.b64decode(asset_payload("hero-fbx")))
    # Female dummy body + long hair (GLB, same UE skeleton as the hero).
    for name in ("female", "hair-long"):
        (OUT / f"{name}.glb").write_bytes(base64.b64decode(asset_payload(name)))
    for key, uri in asset_payload("hero-tex").items():
        (OUT / f"{key}.jpg").write_bytes(base64.b64decode(uri.split(",", 1)[1]))

    clips = {}
    for asset in CLIPS:
        clip = asset_payload(asset)
        clips[clip["name"]] = clip
    (OUT / "anims.json").write_text(json.dumps(clips, separators=(",", ":")))

    guns_out = OUT / "guns"
    guns_out.mkdir(exist_ok=True)
    (obj_dir,) = (ERANGEL).glob("OBJ-*/OBJ")
    for gun in GUNS:
        for ext in (".obj", ".mtl"):
            shutil.copy(obj_dir / f"{gun}{ext}", guns_out / f"{gun}{ext}")
    for part in ACCESSORIES:
        for ext in (".obj", ".mtl"):
            shutil.copy(obj_dir / "Accessories" / f"{part}{ext}", guns_out / f"{part}{ext}")
    print(f"wrote hero.fbx, textures and {len(clips)} clips to {OUT}:")
    print("  then regenerate hero.glb: see scripts/fbx-to-glb.py")
    print("  " + ", ".join(clips))
    print("  guns: " + ", ".join(GUNS + ACCESSORIES))


if __name__ == "__main__":
    main()
