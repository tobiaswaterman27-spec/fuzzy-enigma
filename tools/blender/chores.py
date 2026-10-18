"""Chore equipment modelled in Blender and exported as GLB:
    python tools/blender/chores.py public/assets/models

baler.glb       vertical cardboard baler (1.6 x 0.8 x 1.9 m) for the shop store room
dumpster.glb    1100 litre four-wheel commercial bin (1.8 x 1.1 x 1.3 m), lid in material `paint`
shopbin.glb     stainless litter bin with a push flap (0.55 x 0.55 x 0.95 m)
washer.glb      front-loading washing machine (0.6 x 0.6 x 0.85 m)
binbag.glb      a tied black refuse sack (held in the hand)
carton.glb      an empty, opened shipping case (stacked by the baler)
storage_shelf.glb  steel shelving with storage boxes and paint tins (1.0 x 0.45 x 1.85 m)
ironing_board.glb  a folded-out ironing board with an iron (1.3 x 0.4 x 0.9 m)
laundry_basket.glb a wicker basket with clothes (0.5 x 0.38 x 0.5 m)
drying_rack.glb    a clothes airer with washing hung on it (1.2 x 0.55 x 1.0 m)
bike.glb           a bicycle on its stand (1.75 x 0.5 x 1.0 m), frame in material `paint`
vacuum.glb         an upright vacuum cleaner (0.35 x 0.35 x 1.05 m)
Same conventions as furniture.py: front faces game +Z (Blender -Y), floor at z = 0, centred on the footprint.
"""
import math
import sys
import bpy  # must come first: it makes bmesh importable
import bmesh

OUT = sys.argv[-1]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, rough=0.5, metal=0.0, emission=None, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emission:
        p.inputs['Emission Color'].default_value = (*emission, 1)
        p.inputs['Emission Strength'].default_value = 1.0
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
        b = o.modifiers.new('bev', 'BEVEL')
        b.width = bevel
        b.segments = segs
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


def torus(R, r, loc, m, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, location=loc, rotation=rot, major_segments=28, minor_segments=10)
    o = bpy.context.active_object
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(m)
    return o


def export(name):
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/{name}.glb', export_format='GLB', export_yup=True)


def baler():
    reset()
    body = mat('body', (0.85, 0.55, 0.08), 0.45, 0.2)     # safety-orange steel
    steel = mat('steel', (0.55, 0.57, 0.6), 0.35, 0.8)
    dark = mat('dark', (0.12, 0.12, 0.13), 0.5, 0.3)
    mesh = mat('mesh', (0.25, 0.26, 0.28), 0.4, 0.6)
    label = mat('label', (0.95, 0.85, 0.1), 0.5)
    W, D, H = 1.5, 0.75, 1.9
    # chamber: side walls, back, base
    block((W, D, 0.12), (0, 0, 0.06), dark, 0.01)
    for sx in (-1, 1):
        block((0.08, D, H - 0.12), (sx * (W / 2 - 0.04), 0, 0.12 + (H - 0.12) / 2), body, 0.01)
    block((W, 0.06, H - 0.12), (0, D / 2 - 0.03, 0.12 + (H - 0.12) / 2), body, 0.01)
    # lower bale door (solid) and upper loading gate (mesh) with handles
    block((W - 0.18, 0.05, 0.8), (0, -D / 2 + 0.03, 0.55), body, 0.01)
    for k in range(4):
        block((W - 0.24, 0.02, 0.025), (0, -D / 2 - 0.0, 0.25 + k * 0.2), steel, 0.004)
    block((W - 0.18, 0.03, 0.62), (0, -D / 2 + 0.04, 1.3), mesh, 0.005)
    for k in range(9):
        block((0.015, 0.035, 0.6), (-0.6 + k * 0.15, -D / 2 + 0.035, 1.3), steel)
    block((0.5, 0.05, 0.035), (0, -D / 2 - 0.02, 1.0), steel, 0.01)
    # platen housing and the hydraulic ram on top
    block((W, D, 0.22), (0, 0, H - 0.11), body, 0.015)
    cylinder(0.12, 0.45, (0, 0, H + 0.22), steel, verts=24)
    cylinder(0.14, 0.05, (0, 0, H + 0.45), dark, verts=24)
    # control box with buttons on the right
    block((0.22, 0.16, 0.32), (W / 2 + 0.11, -0.1, 1.25), mat('ctrl', (0.82, 0.83, 0.85), 0.4), 0.01)
    cylinder(0.03, 0.03, (W / 2 + 0.11, -0.19, 1.32), mat('green', (0.1, 0.7, 0.2), 0.3, emission=(0.05, 0.4, 0.1)), rot=(math.pi / 2, 0, 0))
    cylinder(0.035, 0.035, (W / 2 + 0.11, -0.19, 1.2), mat('red', (0.85, 0.1, 0.08), 0.3), rot=(math.pi / 2, 0, 0))
    # warning label
    block((0.4, 0.005, 0.18), (-0.35, -D / 2 - 0.005, 1.72), label)
    export('baler')


def dumpster():
    reset()
    body = mat('body', (0.55, 0.57, 0.6), 0.35, 0.85)        # galvanised steel
    paint = mat('paint', (0.15, 0.38, 0.2), 0.55)            # plastic lid
    dark = mat('dark', (0.08, 0.08, 0.09), 0.7)
    W, D, H = 1.3, 1.0, 1.15
    # tapered body: wider at the top
    bm = bmesh.new()
    w0, d0, w1, d1 = W * 0.88, D * 0.8, W, D
    vs = [bm.verts.new(v) for v in [(-w0 / 2, -d0 / 2, 0.22), (w0 / 2, -d0 / 2, 0.22), (w0 / 2, d0 / 2, 0.22), (-w0 / 2, d0 / 2, 0.22),
                                     (-w1 / 2, -d1 / 2, H), (w1 / 2, -d1 / 2, H), (w1 / 2, d1 / 2, H), (-w1 / 2, d1 / 2, H)]]
    for f in [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]:
        bm.faces.new([vs[i] for i in f])
    me = bpy.data.meshes.new('body')
    bm.to_mesh(me)
    o = bpy.data.objects.new('body', me)
    bpy.context.collection.objects.link(o)
    me.materials.append(body)
    # rolled rim, ribs and the lifting comb
    block((W + 0.06, D + 0.06, 0.06), (0, 0, H), body, 0.02)
    for sx in (-0.35, 0, 0.35):
        block((0.05, 0.03, H - 0.3), (sx * W, -D / 2 + 0.08, 0.22 + (H - 0.3) / 2 + 0.04), body, 0.01, rot=(-0.11, 0, 0))
    block((W * 0.7, 0.08, 0.1), (0, -D / 2 + 0.02, H - 0.2), body, 0.01)
    # split plastic lid, slightly domed
    for sx in (-1, 1):
        block((W / 2 + 0.02, D + 0.1, 0.08), (sx * (W / 4 + 0.005), 0, H + 0.07), paint, 0.03, 3, rot=(0, -sx * 0.04, 0))
        block((0.25, 0.05, 0.04), (sx * W / 4, -D / 2 - 0.05, H + 0.07), paint, 0.015)
    # castors
    for sx in (-1, 1):
        for sy in (-1, 1):
            block((0.08, 0.08, 0.06), (sx * (w0 / 2 - 0.1), sy * (d0 / 2 - 0.1), 0.19), body)
            cylinder(0.075, 0.05, (sx * (w0 / 2 - 0.1), sy * (d0 / 2 - 0.1), 0.08), dark, rot=(0, math.pi / 2, 0))
    export('dumpster')


def shopbin():
    reset()
    steel = mat('steel', (0.78, 0.79, 0.8), 0.25, 0.9)
    dark = mat('dark', (0.1, 0.1, 0.11), 0.6)
    cylinder(0.25, 0.8, (0, 0, 0.42), steel, verts=32)
    cylinder(0.26, 0.04, (0, 0, 0.02), dark, verts=32)
    # domed top with a push flap
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.26, location=(0, 0, 0.82), segments=32, ring_count=12)
    o = bpy.context.active_object
    o.scale = (1, 1, 0.5)
    bpy.ops.object.transform_apply(scale=True)
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(steel)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='DESELECT')
    bpy.ops.object.mode_set(mode='OBJECT')
    for v in o.data.vertices:
        v.select = v.co.z < 0.8
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.delete(type='VERT')
    bpy.ops.object.mode_set(mode='OBJECT')
    block((0.24, 0.02, 0.14), (0, -0.2, 0.88), dark, 0.01, rot=(0.6, 0, 0))
    block((0.22, 0.02, 0.12), (0, -0.215, 0.88), mat('flap', (0.65, 0.66, 0.68), 0.3, 0.8), 0.01, rot=(0.6, 0, 0))
    export('shopbin')


def washer():
    reset()
    white = mat('white', (0.94, 0.94, 0.93), 0.3)
    chrome = mat('chrome', (0.8, 0.81, 0.83), 0.15, 1.0)
    glass = mat('glass', (0.25, 0.3, 0.35), 0.05, 0.0)
    dark = mat('dark', (0.15, 0.15, 0.16), 0.4)
    W, D, H = 0.6, 0.58, 0.85
    block((W, D, H), (0, 0, H / 2), white, 0.02, 3)
    block((W - 0.04, 0.01, 0.12), (0, -D / 2 - 0.004, H - 0.08), mat('panel', (0.88, 0.88, 0.87), 0.35), 0.005)
    block((0.18, 0.012, 0.08), (-0.17, -D / 2 - 0.008, H - 0.08), mat('drawer', (0.92, 0.92, 0.91), 0.3), 0.005)
    cylinder(0.035, 0.03, (0.18, -D / 2 - 0.012, H - 0.08), chrome, rot=(math.pi / 2, 0, 0))
    block((0.08, 0.01, 0.03), (0.05, -D / 2 - 0.01, H - 0.08), mat('lcd', (0.05, 0.1, 0.08), 0.2, emission=(0.1, 0.6, 0.3)))
    torus(0.19, 0.03, (0, -D / 2 - 0.02, 0.42), chrome, rot=(math.pi / 2, 0, 0))
    cylinder(0.17, 0.02, (0, -D / 2 - 0.015, 0.42), glass, rot=(math.pi / 2, 0, 0), verts=32)
    cylinder(0.14, 0.04, (0, -D / 2 + 0.02, 0.42), dark, rot=(math.pi / 2, 0, 0), verts=32)
    block((0.04, 0.03, 0.1), (0.21, -D / 2 - 0.035, 0.42), chrome, 0.01)
    block((W - 0.06, 0.01, 0.06), (0, -D / 2 - 0.004, 0.06), mat('kick', (0.85, 0.85, 0.84), 0.4))
    export('washer')


def binbag():
    reset()
    plastic = mat('bag', (0.04, 0.04, 0.045), 0.25)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.22, location=(0, 0, 0.24), segments=24, ring_count=14)
    o = bpy.context.active_object
    o.scale = (1, 0.85, 1.15)
    bpy.ops.object.transform_apply(scale=True)
    # lumpy contents
    import random
    random.seed(4)
    for v in o.data.vertices:
        k = 1 + (random.random() - 0.5) * 0.12
        v.co.x *= k
        v.co.y *= k
        if v.co.z < 0.06:
            v.co.z = 0.03 + (v.co.z - 0.03) * 0.3
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(plastic)
    # gathered neck and tied ears
    cylinder(0.05, 0.12, (0, 0, 0.53), plastic, r2=0.025)
    for sx in (-1, 1):
        block((0.09, 0.02, 0.05), (sx * 0.05, 0, 0.6), plastic, 0.01, rot=(0, sx * 0.6, 0))
    export('binbag')


def carton():
    reset()
    card = mat('card', (0.66, 0.5, 0.32), 0.85)
    edge = mat('edge', (0.55, 0.4, 0.24), 0.9)
    tape = mat('tape', (0.75, 0.6, 0.38), 0.4)
    W, D, H = 0.4, 0.3, 0.26
    t = 0.006
    block((W, D, t), (0, 0, t / 2), card)
    for sx in (-1, 1):
        block((t, D, H), (sx * (W / 2 - t / 2), 0, H / 2), card)
        # opened flaps folded outwards
        block((t, D, 0.14), (sx * (W / 2 + 0.05), 0, H + 0.04), edge, rot=(0, sx * 0.8, 0))
    for sy in (-1, 1):
        block((W, t, H), (0, sy * (D / 2 - t / 2), H / 2), card)
        block((W, t, 0.1), (0, sy * (D / 2 + 0.04), H + 0.03), edge, rot=(-sy * 0.9, 0, 0))
    block((0.05, D + 0.01, 0.002), (0, 0, t + 0.001), tape)
    export('carton')


def storage_shelf():
    reset()
    steel = mat('steel', (0.72, 0.74, 0.76), 0.4, 0.7)
    W, D, H = 1.0, 0.45, 1.85
    for sx in (-1, 1):
        for sy in (-1, 1):
            block((0.03, 0.03, H), (sx * (W / 2 - 0.015), sy * (D / 2 - 0.015), H / 2), steel)
    import random
    random.seed(7)
    colors = [(0.75, 0.6, 0.4), (0.2, 0.35, 0.6), (0.85, 0.85, 0.82), (0.55, 0.15, 0.12), (0.3, 0.5, 0.3)]
    for k, z in enumerate((0.08, 0.5, 0.92, 1.34, 1.76)):
        block((W, D, 0.02), (0, 0, z), steel, 0.003)
        if z > 1.7:
            continue
        x = -W / 2 + 0.05
        while x < W / 2 - 0.15:
            w = 0.18 + random.random() * 0.2
            if x + w > W / 2 - 0.03:
                break
            h = 0.15 + random.random() * 0.2
            c = colors[random.randrange(len(colors))]
            if random.random() < 0.25:
                cylinder(w / 2.4, h * 0.8, (x + w / 2, 0, z + 0.01 + h * 0.4), mat(f'tin{k}', (0.8, 0.8, 0.82), 0.3, 0.8))
            else:
                block((w - 0.02, D - 0.08, h), (x + w / 2, 0, z + 0.01 + h / 2), mat(f'box{k}{len(colors)}', c, 0.75), 0.008)
            x += w + 0.02
    export('storage_shelf')


def ironing_board():
    reset()
    cover = mat('cover', (0.55, 0.7, 0.8), 0.8)
    steel = mat('steel', (0.75, 0.76, 0.78), 0.35, 0.8)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.5, depth=0.03, location=(0, 0, 0.88), vertices=32)
    o = bpy.context.active_object
    o.scale = (1.25, 0.36, 1)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(cover)
    for sx in (-1, 1):
        block((0.025, 0.3, 1.18), (sx * 0.25, 0, 0.44), steel, rot=(0, sx * 0.72, 0))
    block((0.24, 0.12, 0.08), (0.42, 0, 0.94), mat('iron', (0.25, 0.25, 0.27), 0.3, 0.5), 0.03, 3)
    export('ironing_board')


def laundry_basket():
    reset()
    wicker = mat('wicker', (0.7, 0.55, 0.32), 0.85)
    cylinder(0.25, 0.48, (0, 0, 0.24), wicker, verts=24)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.object.mode_set(mode='OBJECT')
    import random
    random.seed(2)
    for k, c in enumerate([(0.8, 0.2, 0.2), (0.2, 0.3, 0.6), (0.9, 0.9, 0.88), (0.3, 0.3, 0.3)]):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.12, location=((random.random() - 0.5) * 0.2, (random.random() - 0.5) * 0.15, 0.5 + k * 0.02), segments=12, ring_count=8)
        o = bpy.context.active_object
        o.scale = (1.3, 1, 0.45)
        bpy.ops.object.transform_apply(scale=True)
        for p in o.data.polygons:
            p.use_smooth = True
        o.data.materials.append(mat(f'cloth{k}', c, 0.95))
    export('laundry_basket')


def drying_rack():
    reset()
    white = mat('white', (0.92, 0.92, 0.9), 0.4, 0.2)
    W, D, H = 1.2, 0.55, 1.0
    for sx in (-1, 1):
        block((0.02, D, 0.02), (sx * W / 2, 0, H), white)
        block((0.02, 0.02, H * 1.05), (sx * W / 2, -D / 2 + 0.05, H / 2), white, rot=(0.25, 0, 0))
        block((0.02, 0.02, H * 1.05), (sx * W / 2, D / 2 - 0.05, H / 2), white, rot=(-0.25, 0, 0))
    for k in range(7):
        cylinder(0.006, W, (0, -D / 2 + 0.05 + k * (D - 0.1) / 6, H), white, rot=(0, math.pi / 2, 0), verts=6)
    for k, (c, x) in enumerate([((0.85, 0.85, 0.82), -0.35), ((0.2, 0.3, 0.55), 0.0), ((0.75, 0.25, 0.25), 0.35)]):
        block((0.32, 0.01, 0.42), (x, -0.1 + k * 0.1, H - 0.2), mat(f'wash{k}', c, 0.95))
    export('drying_rack')


def bike():
    reset()
    paint = mat('paint', (0.15, 0.4, 0.6), 0.35, 0.3)
    tyre = mat('tyre', (0.05, 0.05, 0.05), 0.85)
    steel = mat('steel', (0.75, 0.76, 0.78), 0.3, 0.9)
    for x in (-0.55, 0.55):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.33, minor_radius=0.025, location=(x, 0, 0.36), rotation=(math.pi / 2, 0, 0), major_segments=32, minor_segments=8)
        bpy.context.active_object.data.materials.append(tyre)
        cylinder(0.04, 0.05, (x, 0, 0.36), steel, rot=(math.pi / 2, 0, 0))
    def tube(a, b, r=0.018, m=paint):
        import mathutils
        A, B = mathutils.Vector(a), mathutils.Vector(b)
        d = B - A
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, location=(A + B) / 2, vertices=10)
        o = bpy.context.active_object
        o.rotation_mode = 'QUATERNION'
        o.rotation_quaternion = d.to_track_quat('Z', 'Y')
        o.data.materials.append(m)
    bb = (0.0, 0, 0.32)
    seat = (-0.12, 0, 0.75)
    head = (0.42, 0, 0.78)
    tube(bb, seat); tube(seat, head); tube(bb, head)
    tube(bb, (-0.55, 0, 0.36)); tube(seat, (-0.55, 0, 0.36)); tube(head, (0.55, 0, 0.36))
    tube(head, (0.4, 0, 0.95), 0.016, steel)
    tube((0.4, -0.25, 0.95), (0.4, 0.25, 0.95), 0.014, steel)
    tube(seat, (-0.14, 0, 0.85), 0.012, steel)
    block((0.24, 0.1, 0.05), (-0.15, 0, 0.88), mat('saddle', (0.08, 0.08, 0.08), 0.6), 0.02)
    cylinder(0.09, 0.02, bb, steel, rot=(math.pi / 2, 0, 0))
    export('bike')


def vacuum():
    reset()
    body = mat('body', (0.55, 0.15, 0.6), 0.35)
    grey = mat('grey', (0.3, 0.3, 0.32), 0.5)
    block((0.3, 0.25, 0.08), (0, -0.02, 0.04), grey, 0.02)
    block((0.22, 0.18, 0.5), (0, 0.05, 0.38), body, 0.05, 3)
    cylinder(0.08, 0.3, (0, 0.03, 0.4), mat('bin', (0.75, 0.8, 0.85), 0.1), verts=20)
    cylinder(0.015, 0.45, (0, 0.08, 0.85), grey, verts=8)
    block((0.12, 0.03, 0.04), (0, 0.08, 1.06), grey, 0.01)
    export('vacuum')


for f in (baler, dumpster, shopbin, washer, binbag, carton, storage_shelf, ironing_board, laundry_basket, drying_rack, bike, vacuum):
    f()
print('ok')
