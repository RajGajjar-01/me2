"""Copy the Quaternius hero + animation clips from ../erangel-run into src/assets/character/.

Quaternius license forbids redistributing the raw asset files, so the output
folder is gitignored. Run this once after cloning: python3 scripts/sync-quaternius.py
"""

import base64
import importlib.util
import json
import sys
from pathlib import Path

ME2 = Path(__file__).resolve().parents[1]
ERANGEL = ME2.parent / "erangel-run"
OUT = ME2 / "src" / "assets" / "character"

# Reuse erangel-run's GLB -> Three.js clip packer (pelvis translation + bone rotations).
spec = importlib.util.spec_from_file_location("pack", ERANGEL / "scripts" / "pack-animations.py")
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)

# Root-motion (_RM) libraries: forward travel lives on the dropped `root` bone,
# so every clip plays in place and the game's physics moves the capsule.
LIBRARIES = {
    "Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard_RM.glb": [
        "Idle_Loop", "Walk_Loop", "Sprint_Loop",
        "Crouch_Idle_Loop", "Crouch_Fwd_Loop",
        "Jump_Loop", "Jump_Land",
        "Roll", "Swim_Fwd_Loop",
        "Hit_Chest", "Hit_Head", "Death01",
    ],
    "Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard_RM.glb": [
        "Slide_Start", "Slide_Loop", "Slide_Exit", "ClimbUp_1m",
    ],
}


def read_glb(path):
    data = path.read_bytes()
    if data[:4] != b"glTF":
        raise ValueError(f"{path} is not a binary glTF")
    size = int.from_bytes(data[12:16], "little")
    return json.loads(data[20 : 20 + size]), memoryview(data)[28 + size :]


def asset_payload(name):
    """erangel-run ships binaries as `window.__ASSETS[name] = <json or base64>`."""
    text = (ERANGEL / "assets" / f"{name}.js").read_text()
    return json.loads(text[text.index("=", text.index("]")) + 1 :].strip().rstrip(";"))


def main():
    if not ERANGEL.is_dir():
        sys.exit(f"erangel-run not found at {ERANGEL}")
    OUT.mkdir(parents=True, exist_ok=True)

    (OUT / "hero.fbx").write_bytes(base64.b64decode(asset_payload("hero-fbx")))
    for key, uri in asset_payload("hero-tex").items():
        (OUT / f"{key}.jpg").write_bytes(base64.b64decode(uri.split(",", 1)[1]))

    clips = {}
    for rel, names in LIBRARIES.items():
        glb = Path(rel).stem
        document, binary = read_glb(ERANGEL / rel)
        animations = {a["name"]: a for a in document["animations"]}
        for name in names:
            clips[name] = pack.pack_clip(document, binary, animations[name], glb)
    (OUT / "anims.json").write_text(json.dumps(clips, separators=(",", ":")))
    print(f"wrote hero.fbx, textures and {len(clips)} clips to {OUT}")


if __name__ == "__main__":
    main()
