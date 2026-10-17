"""Renders several GLBs side by side from the front-left (Cycles, CPU):
    python tools/blender/lineup.py out.png a.glb b.glb ..."""
import math
import sys
import bpy

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
out, files = args[0], args[1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
x = 0.0
for f in files:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=f)
    new = [o for o in bpy.context.scene.objects if o not in before and o.parent is None]
    objs = [o for o in bpy.context.scene.objects if o not in before and o.type == 'MESH']
    xs = [(o.matrix_world @ v.co).x for o in objs for v in o.data.vertices]
    w = max(xs) - min(xs)
    for o in new:
        o.location.x += x - min(xs)
    x += w + 0.6
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 32
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 1400, 520
world = bpy.data.worlds.new('w'); sc.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.78, 0.82, 1)
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
sun.rotation_euler = (0.7, 0.3, -0.5); sun.data.energy = 3.5
bpy.ops.mesh.primitive_plane_add(size=200, location=(x / 2, 0, 0))
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 35
cx = (x - 0.6) / 2
cam.location = (cx - x * 0.15, -x * 0.75, x * 0.32)
d = [cx - cam.location[0], 0.4 - cam.location[1], 0.6 - cam.location[2]]
cam.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), -d[2]), 0, math.atan2(d[1], d[0]) - math.pi / 2)
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print('rendered', out)
