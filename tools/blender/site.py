"""Building-site equipment modelled in Blender and exported as GLB:
    python tools/blender/site.py public/assets/models

site_cabin.glb    welfare cabin (2.4 x 1.3 x 2.5 m) with door, window and steps, body in material `paint`
cement_mixer.glb  tilting drum mixer on a stand with wheels (1.1 x 1.0 x 1.4 m)
heras_panel.glb   temporary fence panel: mesh in a tube frame on rubber feet (3.5 x 0.6 x 2.0 m)
wheelbarrow.glb   builder's barrow (1.4 x 0.65 x 0.7 m)
tool_spade.glb, tool_shovel.glb, tool_hammer.glb, tool_drill.glb, tool_roller.glb
    hand tools, gripped at the origin, pointing along -Z (game +Y up the handle for long tools)
Front faces game +Z (Blender -Y), floor at z = 0.
"""
import math
import sys
import bpy  # must come first: it makes bmesh importable

OUT = sys.argv[-1]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, rough=0.5, metal=0.0, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if alpha < 1:
        p.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    return m


def block(size, loc, m, bevel=0.0, segs=2, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL'); b.width = bevel; b.segments = segs
        bpy.ops.object.modifier_apply(modifier='bev')
    for p in o.data.polygons:
        p.use_smooth = bool(bevel)
    o.data.materials.append(m)
    return o


def cylinder(r, depth, loc, m, rot=(0, 0, 0), verts=20, r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    else:
        bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.active_object
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(m)
    return o


def tube(a, b, r, m, verts=10):
    import mathutils
    A, B = mathutils.Vector(a), mathutils.Vector(b)
    d = B - A
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, location=(A + B) / 2, vertices=verts)
    o = bpy.context.active_object
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = d.to_track_quat('Z', 'Y')
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(m)
    return o


def export(name):
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/{name}.glb', export_format='GLB', export_yup=True)


def site_cabin():
    reset()
    paint = mat('paint', (0.18, 0.4, 0.62), 0.5, 0.3)
    dark = mat('dark', (0.15, 0.16, 0.17), 0.6)
    white = mat('white', (0.92, 0.92, 0.9), 0.4)
    glass = mat('glass', (0.3, 0.38, 0.45), 0.1, 0.3)
    W, D, H = 2.4, 1.3, 2.35
    block((W, D, 0.15), (0, 0, 0.075), dark)
    block((W, D, H - 0.15), (0, 0, 0.15 + (H - 0.15) / 2), paint, 0.02)
    for k in range(12):
        block((0.02, D + 0.01, H - 0.3), (-W / 2 + 0.1 + k * 0.2, 0, 0.15 + (H - 0.15) / 2), paint)
    block((W + 0.1, D + 0.1, 0.08), (0, 0, H + 0.04), white, 0.02)
    block((0.8, 0.04, 1.9), (0.6, -D / 2 - 0.01, 1.12), white, 0.01)
    block((0.06, 0.04, 0.2), (0.3, -D / 2 - 0.04, 1.1), dark)
    block((0.8, 0.03, 0.6), (-0.5, -D / 2 - 0.01, 1.5), white)
    block((0.72, 0.02, 0.52), (-0.5, -D / 2 - 0.025, 1.5), glass)
    for k in range(2):
        block((0.9, 0.3, 0.06), (0.6, -D / 2 - 0.2 - k * 0.25, 0.1 + k * 0.08), dark)
    block((0.5, 0.01, 0.35), (-0.5, -D / 2 - 0.02, 0.9), mat('sign', (0.95, 0.85, 0.1), 0.5))
    export('site_cabin')


def cement_mixer():
    reset()
    orange = mat('paint', (0.92, 0.45, 0.08), 0.45, 0.2)
    steel = mat('steel', (0.4, 0.42, 0.45), 0.4, 0.8)
    dark = mat('dark', (0.06, 0.06, 0.06), 0.8)
    grey = mat('concrete', (0.55, 0.55, 0.53), 0.95)
    tube((-0.35, 0, 0.0), (0, 0, 0.7), 0.025, steel); tube((0.35, 0, 0.0), (0, 0, 0.7), 0.025, steel)
    tube((0, 0.3, 0.0), (0, 0, 0.7), 0.025, steel)
    for sx in (-1, 1):
        cylinder(0.14, 0.06, (sx * 0.4, -0.2, 0.14), dark, rot=(0, math.pi / 2, 0))
    tube((-0.42, -0.2, 0.14), (0.42, -0.2, 0.14), 0.015, steel)
    block((0.3, 0.25, 0.25), (0.25, 0.15, 0.62), orange, 0.03)
    drum = cylinder(0.36, 0.55, (0, -0.1, 0.95), orange, rot=(0.9, 0, 0), verts=28, r2=0.2)
    cylinder(0.2, 0.02, (0, -0.31, 1.23), grey, rot=(0.9, 0, 0), verts=24)
    tube((0, 0.15, 0.7), (0, -0.05, 0.9), 0.04, steel)
    export('cement_mixer')


def heras_panel():
    reset()
    frame = mat('frame', (0.75, 0.77, 0.78), 0.35, 0.8)
    mesh = mat('mesh', (0.6, 0.62, 0.64), 0.4, 0.7, alpha=0.45)
    foot = mat('foot', (0.1, 0.1, 0.1), 0.8)
    W, H = 3.45, 2.0
    for x in (-W / 2, W / 2):
        tube((x, 0, 0.12), (x, 0, H), 0.02, frame)
        block((0.6, 0.18, 0.12), (x, 0, 0.06), foot, 0.03)
    tube((-W / 2, 0, H), (W / 2, 0, H), 0.02, frame)
    tube((-W / 2, 0, 0.14), (W / 2, 0, 0.14), 0.02, frame)
    block((W, 0.01, H - 0.16), (0, 0, 0.14 + (H - 0.16) / 2), mesh)
    for k in range(1, 18):
        tube((-W / 2 + k * W / 18, 0, 0.14), (-W / 2 + k * W / 18, 0, H), 0.003, frame, verts=4)
    for k in range(1, 9):
        tube((-W / 2, 0, 0.14 + k * (H - 0.14) / 9), (W / 2, 0, 0.14 + k * (H - 0.14) / 9), 0.003, frame, verts=4)
    export('heras_panel')


def wheelbarrow():
    reset()
    paint = mat('paint', (0.15, 0.45, 0.25), 0.45, 0.3)
    steel = mat('steel', (0.4, 0.42, 0.45), 0.4, 0.8)
    dark = mat('dark', (0.06, 0.06, 0.06), 0.8)
    cylinder(0.32, 0.38, (0, 0.05, 0.5), paint, rot=(0, 0, 0), verts=4, r2=0.22)
    bpy.context.active_object.rotation_euler = (math.pi, 0, math.pi / 4)
    cylinder(0.17, 0.08, (0, -0.55, 0.17), dark, rot=(0, math.pi / 2, 0), verts=20)
    for sx in (-1, 1):
        tube((sx * 0.22, 0.65, 0.55), (sx * 0.08, -0.55, 0.2), 0.018, steel)
        tube((sx * 0.2, 0.25, 0.32), (sx * 0.2, 0.3, 0.0), 0.015, steel)
    export('wheelbarrow')


def tool(name, parts):
    reset()
    for p in parts:
        p()
    export(name)


def tools():
    wood = lambda: mat('wood', (0.6, 0.45, 0.28), 0.6)
    steel = lambda: mat('steel', (0.55, 0.57, 0.6), 0.35, 0.85)
    tool('tool_spade', [lambda: tube((0, 0, 0.35), (0, 0, -0.75), 0.016, wood()), lambda: block((0.12, 0.02, 0.05), (0, 0, 0.36), wood()),
                        lambda: block((0.19, 0.012, 0.28), (0, 0, -0.88), steel(), 0.003)])
    tool('tool_shovel', [lambda: tube((0, 0, 0.35), (0, 0, -0.75), 0.016, wood()), lambda: block((0.12, 0.02, 0.05), (0, 0, 0.36), wood()),
                         lambda: block((0.26, 0.012, 0.3), (0, 0.04, -0.9), steel(), 0.004, rot=(0.35, 0, 0))])
    tool('tool_hammer', [lambda: tube((0, 0, 0.04), (0, 0, -0.28), 0.014, wood()), lambda: block((0.14, 0.03, 0.035), (0.02, 0, -0.3), steel(), 0.004)])
    tool('tool_drill', [lambda: block((0.06, 0.18, 0.06), (0, -0.06, 0.04), mat('body', (0.95, 0.75, 0.1), 0.45)),
                        lambda: block((0.05, 0.05, 0.14), (0, 0, -0.04), mat('grip', (0.1, 0.1, 0.1), 0.6)),
                        lambda: tube((0, -0.15, 0.04), (0, -0.25, 0.04), 0.005, steel())])
    tool('tool_roller', [lambda: tube((0, 0, 0.05), (0, 0, -0.45), 0.012, mat('grip', (0.1, 0.1, 0.1), 0.6)),
                         lambda: cylinder(0.035, 0.22, (0.1, 0, -0.5), mat('nap', (0.95, 0.94, 0.9), 0.9), rot=(0, math.pi / 2, 0))])


for f in (site_cabin, cement_mixer, heras_panel, wheelbarrow, tools):
    f()
print('ok')
