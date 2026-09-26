# Pack a Quaternius "Modular Character Outfits" glTF into one GLB with its
# textures embedded as 2K JPEGs (the pack keeps 4K PNGs in a separate
# Textures/ folder). Output is committed (CC0), so this only reruns on a new outfit:
#   uv run --no-project --with pillow python scripts/pack-outfit.py PACK_DIR Male_Peasant OUT.glb
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image

pack, name, dst = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
TEX_PX = 2048

src = pack / "Exports" / "glTF (Godot-Unreal)" / "Outfits" / f"{name}.gltf"
gltf = json.loads(src.read_text())
blob = bytearray((src.parent / gltf["buffers"][0]["uri"]).read_bytes())


def find_texture(uri: str) -> Path:
    # Skip the pack's DirectX copies; glTF expects OpenGL normals.
    return next(p for p in (pack / "Textures").rglob(uri) if "Unreal" not in str(p))


def pad() -> None:
    blob.extend(b"\0" * (-len(blob) % 4))


for img in gltf["images"]:
    im = Image.open(find_texture(img.pop("uri"))).convert("RGB")
    out = io.BytesIO()
    im.resize((TEX_PX, TEX_PX), Image.LANCZOS).save(out, "JPEG", quality=90)
    pad()
    gltf["bufferViews"].append(
        {"buffer": 0, "byteOffset": len(blob), "byteLength": out.tell()}
    )
    blob += out.getvalue()
    img["bufferView"] = len(gltf["bufferViews"]) - 1
    img["mimeType"] = "image/jpeg"

pad()
gltf["buffers"] = [{"byteLength": len(blob)}]
js = json.dumps(gltf, separators=(",", ":")).encode()
js += b" " * (-len(js) % 4)
body = (
    struct.pack("<II", len(js), 0x4E4F534A) + js
    + struct.pack("<II", len(blob), 0x004E4942) + bytes(blob)
)
dst.write_bytes(struct.pack("<III", 0x46546C67, 2, 12 + len(body)) + body)
print(f"wrote {dst} ({dst.stat().st_size / 1e6:.1f} MB)")
