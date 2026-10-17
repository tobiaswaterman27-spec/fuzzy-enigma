"""Prints triangle counts of GLB files: python tools/blender/stats.py a.glb b.glb"""
import sys
import bpy
for path in [a for a in sys.argv[1:] if a.endswith('.glb')]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    tris = 0
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            tris += len(o.data.loop_triangles)
    print(path, tris, 'triangles')
