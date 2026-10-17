"""Renders a quick turntable sheet of a GLB for checking models: python tools/blender/preview.py in.glb out.png"""
import math
import sys
import bpy

src, out = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
mn = [min(min((o.matrix_world @ v.co)[i] for v in o.data.vertices) for o in objs) for i in range(3)]
mx = [max(max((o.matrix_world @ v.co)[i] for v in o.data.vertices) for o in objs) for i in range(3)]
c = [(a + b) / 2 for a, b in zip(mn, mx)]
size = max(b - a for a, b in zip(mn, mx))
sc = bpy.context.scene
sc.render.engine = 'CYCLES'  # EEVEE needs a GPU; Cycles renders on the CPU
sc.cycles.device = 'CPU'
sc.cycles.samples = 24
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 640, 400
world = bpy.data.worlds.new('w'); sc.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.7, 0.75, 0.8, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.rotation_euler = (0.8, 0.2, 0.6); sun.data.energy = 3
bpy.ops.mesh.primitive_plane_add(size=40, location=(c[0], c[1], mn[2]))
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
import os
frames = []
for k, ang in enumerate([0.6, 2.2, 3.9, 5.3]):
    d = size * 1.6
    cam.location = (c[0] + math.cos(ang) * d, c[1] + math.sin(ang) * d, c[2] + size * 0.45)
    dirv = [c[i] - cam.location[i] for i in range(3)]
    cam.rotation_euler = (math.atan2(math.hypot(dirv[0], dirv[1]), -dirv[2]), 0, math.atan2(dirv[1], dirv[0]) - math.pi / 2)
    sc.render.filepath = f'{out}_{k}.png'
    bpy.ops.render.render(write_still=True)
    frames.append(sc.render.filepath)
print('rendered', frames)
