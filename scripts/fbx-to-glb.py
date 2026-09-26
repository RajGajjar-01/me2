# Lossless FBX -> GLB (no mesh compression, no embedded textures: the game
# assigns its own materials by name), facing three.js forward (-Z) with
# identity nodes so the loader needs no rotation. Needs no Blender install:
#   uv run --no-project --python 3.11 --with bpy python scripts/fbx-to-glb.py IN.fbx OUT.glb
import sys

import bpy

src, dst = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
# Bake the import's axis rotation into the data so every node exports as
# identity and the character already faces -Z.
for o in bpy.data.objects:
    o.select_set(o.parent is None)
bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    export_image_format="NONE",
    export_animations=False,
    export_draco_mesh_compression_enable=False,
    export_skins=True,
    export_normals=True,
    export_texcoords=True,
    export_yup=True,
)
