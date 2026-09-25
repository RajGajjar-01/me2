"""Copy the hero + its animation clips from ../erangel-run into src/assets/character/.

Everything comes from erangel-run's packed assets (assets/*.js), never from the
raw Quaternius libraries: new clips get packed in erangel-run first
(erangel-run/scripts/pack-animations.py), then synced here.

Quaternius license forbids redistributing the raw asset files, so the output
folder is gitignored. Run this once after cloning: python3 scripts/sync-quaternius.py
"""

import base64
import json
import sys
from pathlib import Path

ME2 = Path(__file__).resolve().parents[1]
ERANGEL = ME2.parent / "erangel-run"
OUT = ME2 / "src" / "assets" / "character"

CLIPS = [
    "anim-idle", "anim-walk", "anim-sprint", "anim-roll", "anim-hithead",
    "anim-death", "anim-slide-start", "anim-slide-loop", "anim-slide-exit",
    "anim-climb-up", "anim-crouch-idle", "anim-crouch-walk", "anim-jump-loop",
    "anim-jump-land", "anim-prone-crawl",
]


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
    for asset in CLIPS:
        clip = asset_payload(asset)
        clips[clip["name"]] = clip
    (OUT / "anims.json").write_text(json.dumps(clips, separators=(",", ":")))
    print(f"wrote hero.fbx, textures and {len(clips)} clips to {OUT}:")
    print("  " + ", ".join(clips))


if __name__ == "__main__":
    main()
