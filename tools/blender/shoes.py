"""Shoes modelled in Blender and exported as GLB (one right shoe each; the game mirrors it for the left):
    python tools/blender/shoes.py public/assets/models

shoe_trainer.glb  trainer: thick white cupsole, padded collar, laces
shoe_oxford.glb   leather oxford: thin sole, stacked heel, toe cap, closed lacing
shoe_boot.glb     safety work boot: lugged sole, high padded collar, toe cap
The upper uses material `paint` (the outfit's shoe colour). Size: 0.27 m long, toe at -Y (game +Z),
heel at +Y, sole at z = 0, centred on the footprint.
"""
import math
import sys
import bpy  # must come first: it makes bmesh importable
import bmesh

OUT = sys.argv[-1]
L = 0.27


def mat(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    return m


def half_width(t):
    """foot outline: t = 0 heel .. 1 toe"""
    if t < 0.15:
        return 0.033 + 0.012 * math.sin(t / 0.15 * math.pi / 2)
    if t < 0.7:
        return 0.045 + 0.005 * math.sin((t - 0.15) / 0.55 * math.pi / 2)
    return 0.05 * math.cos((t - 0.7) / 0.3 * math.pi / 2.15) + 0.004


def outline(n, grow=0.0):
    """closed outline (x, y) points, heel at +Y, toe at -Y"""
    pts = []
    for i in range(n):
        t = i / (n - 1)
        pts.append((half_width(t) + grow, L / 2 - t * L, t))
    right = [(x, y, t) for x, y, t in pts]
    left = [(-x, y, t) for x, y, t in reversed(pts)]
    return right + left[1:-1]


def loft(name, m, z0, profile, levels, shrink, grow=0.0, cap=True, close_front=False, subsurf=0):
    """rings of the outline from z0 up to profile(t), pinched inwards towards the top; with close_front the
    toe box and vamp close into a ridge over the instep while the collar stays open for the ankle"""
    bm = bmesh.new()
    ol = outline(24, grow)
    rings = []
    for k in range(levels + 1):
        f = k / levels
        ring = []
        for x, y, t in ol:
            ztop = profile(t)
            z = z0 + (ztop - z0) * math.sin(f * math.pi / 2)
            if close_front:
                # front closes completely at the top, the collar (t < 0.4) stays an opening
                closing = min(1.0, max(0.0, (t - 0.32) / 0.12))
                s = 1 - (shrink + (1 - shrink) * closing) * f ** 1.6
            else:
                s = 1 - shrink * f * f
            ring.append(bm.verts.new((x * s, y + (0 if t > 0.5 else -0.006 * f * f), z)))
        rings.append(ring)
    n = len(ol)
    for k in range(levels):
        for i in range(n):
            a, b = rings[k][i], rings[k][(i + 1) % n]
            c, d = rings[k + 1][(i + 1) % n], rings[k + 1][i]
            bm.faces.new((a, b, c, d))
    bm.faces.new(list(reversed(rings[0])))
    if cap:
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    me.materials.append(m)
    if subsurf:
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new('sub', 'SUBSURF')
        mod.levels = subsurf
        bpy.ops.object.modifier_apply(modifier='sub')
    return o


def block(size, loc, m, rot=(0, 0, 0), bevel=0.003):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL')
        b.width = bevel
        b.segments = 2
        bpy.ops.object.modifier_apply(modifier='bev')
    o.data.materials.append(m)
    return o


def laces(m, z_at, n=5, w=0.034):
    for k in range(n):
        t = 0.52 + k * 0.055
        y = L / 2 - t * L
        block((w, 0.006, 0.004), (0, y, z_at(t) + 0.002), m, rot=(0.35, 0, 0), bevel=0.001)


def export(name):
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/{name}.glb', export_format='GLB', export_yup=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def trainer():
    reset()
    paint = mat('paint', (0.92, 0.92, 0.92), 0.55)
    sole = mat('sole', (0.97, 0.97, 0.95), 0.6)
    accent = mat('accent', (0.15, 0.15, 0.17), 0.5)
    lace = mat('lace', (0.95, 0.95, 0.95), 0.8)
    loft('sole', sole, 0.0, lambda t: 0.03 + (0.006 if t < 0.3 else 0), 2, 0.0, grow=0.006, subsurf=1)
    upper = lambda t: 0.1 if t < 0.35 else 0.1 - (t - 0.35) / 0.65 * 0.052
    loft('upper', paint, 0.026, upper, 5, 0.25, cap=False, close_front=True, subsurf=2)
    # a contrast stripe along each side
    for s in (-1, 1):
        block((0.003, 0.09, 0.012), (s * 0.047, 0.0, 0.05), accent, rot=(0.25, 0, 0), bevel=0.001)
    laces(lace, lambda t: upper(t) - 0.012)
    export('shoe_trainer')


def oxford():
    reset()
    paint = mat('paint', (0.16, 0.1, 0.07), 0.25, 0.05)
    sole = mat('sole', (0.08, 0.06, 0.05), 0.5)
    lace = mat('lace', (0.05, 0.04, 0.03), 0.6)
    loft('sole', sole, 0.0, lambda t: 0.012, 1, 0.0, grow=0.004, subsurf=1)
    block((0.06, 0.06, 0.022), (0, L / 2 - 0.035, 0.011), sole, bevel=0.004)   # heel block
    upper = lambda t: 0.08 if t < 0.32 else 0.08 - (t - 0.32) / 0.68 * 0.042
    loft('upper', paint, 0.012, upper, 5, 0.3, cap=False, close_front=True, subsurf=2)
    # toe cap seam
    for s in (-1, 1):
        block((0.002, 0.002, 0.03), (s * 0.04, -L / 2 + 0.05, 0.03), lace, bevel=0)
    block((0.08, 0.002, 0.002), (0, -L / 2 + 0.055, 0.045), lace, bevel=0)
    laces(lace, lambda t: upper(t) - 0.01, n=4, w=0.026)
    export('shoe_oxford')


def boot():
    reset()
    paint = mat('paint', (0.32, 0.22, 0.12), 0.6)
    sole = mat('sole', (0.07, 0.07, 0.07), 0.8)
    lace = mat('lace', (0.85, 0.7, 0.3), 0.7)
    loft('sole', sole, 0.0, lambda t: 0.035, 2, 0.0, grow=0.008, subsurf=1)
    for k in range(9):
        y = L / 2 - 0.02 - k * 0.029
        block((0.1, 0.008, 0.008), (0, y, 0.002), sole, bevel=0.002)
    upper = lambda t: 0.16 if t < 0.4 else 0.16 - (t - 0.4) / 0.6 * 0.1
    loft('upper', paint, 0.033, upper, 6, 0.2, cap=False, close_front=True, subsurf=2)
    laces(lace, lambda t: upper(t) - 0.014, n=7, w=0.034)
    export('shoe_boot')


for f in (trainer, oxford, boot):
    f()
print('ok')
