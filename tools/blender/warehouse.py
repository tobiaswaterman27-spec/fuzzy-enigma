"""Warehouse equipment modelled in Blender and exported as GLB:
    python tools/blender/warehouse.py public/assets/models

rack_bay.glb     one 2.7 m bay of adjustable pallet racking, 1.1 m deep, 4.2 m tall: blue uprights,
                 orange beams at 1.6 and 3.0 m with mesh decks; pick face (ground level) left empty for the game's stock
pallet_load.glb  a shrink-wrapped pallet of cases (1.2 x 1.0 x 1.3 m) for the upper levels and staging lanes
pallet.glb       an empty euro pallet (1.2 x 0.8 x 0.15 m)
forklift.glb     a counterbalance forklift truck (2.3 x 1.2 x 2.2 m), body in material `paint`
roller_door.glb  an industrial roller shutter (closed), 4 x 4 m, front at -Y
Axes as furniture.py: front faces game +Z (Blender -Y), floor at z = 0.
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
        b = o.modifiers.new('bev', 'BEVEL')
        b.width = bevel
        b.segments = segs
        bpy.ops.object.modifier_apply(modifier='bev')
    for p in o.data.polygons:
        p.use_smooth = bool(bevel)
    o.data.materials.append(m)
    return o


def cylinder(r, depth, loc, m, rot=(0, 0, 0), verts=20):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.active_object
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(m)
    return o


def export(name):
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/{name}.glb', export_format='GLB', export_yup=True)


def euro_pallet(x, y, z, wood, w=1.2, d=0.8):
    for k in range(5):
        block((w, d / 5 - 0.03, 0.022), (x, y - d / 2 + (k + 0.5) * d / 5, z + 0.133), wood)
    for sx in (-1, 0, 1):
        block((0.1, d, 0.022), (x + sx * (w / 2 - 0.05), y, z + 0.111), wood)
        for sy in (-1, 0, 1):
            block((0.12, 0.1, 0.078), (x + sx * (w / 2 - 0.06), y + sy * (d / 2 - 0.05), z + 0.061), wood)
    for k in range(3):
        block((w, 0.1, 0.022), (x, y - d / 2 + 0.05 + k * (d - 0.1) / 2, z + 0.011), wood)


def cases_on_pallet(x, y, z, w, d, layers, card, wrap=None, seed=0):
    import random
    random.seed(seed)
    cw, cd, ch = 0.4, 0.3, 0.26
    nx, ny = int(w / cw), int(d / cd)
    for l in range(layers):
        for i in range(nx):
            for j in range(ny):
                if l == layers - 1 and random.random() < 0.15:
                    continue
                block((cw - 0.01, cd - 0.01, ch - 0.005), (x - w / 2 + (i + 0.5) * w / nx, y - d / 2 + (j + 0.5) * d / ny, z + l * ch + ch / 2), card, 0.004)
    if wrap:
        block((w + 0.02, d + 0.02, layers * ch), (x, y, z + layers * ch / 2), wrap, 0.02)


def rack_bay():
    reset()
    blue = mat('upright', (0.08, 0.22, 0.55), 0.45, 0.4)
    orange = mat('beam', (0.95, 0.42, 0.05), 0.4, 0.3)
    deck = mat('deck', (0.6, 0.62, 0.64), 0.45, 0.7)
    wood = mat('wood', (0.62, 0.48, 0.3), 0.85)
    card = mat('card', (0.66, 0.5, 0.32), 0.85)
    wrap = mat('wrap', (0.85, 0.9, 0.95), 0.15, 0.0, alpha=0.18)
    W, D, H = 2.7, 1.1, 4.2
    for sx in (-1, 1):
        for sy in (-1, 1):
            block((0.08, 0.07, H), (sx * (W / 2 - 0.04), sy * (D / 2 - 0.035), H / 2), blue)
            block((0.16, 0.16, 0.01), (sx * (W / 2 - 0.04), sy * (D / 2 - 0.035), 0.005), blue)
        # frame bracing
        for k in range(6):
            z0 = 0.2 + k * 0.65
            bpy.ops.mesh.primitive_cylinder_add(radius=0.012, depth=math.hypot(D - 0.1, 0.65), location=(sx * (W / 2 - 0.04), 0, z0 + 0.325), rotation=((1 if k % 2 else -1) * math.atan2(D - 0.1, 0.65), 0, 0), vertices=6)
            bpy.context.active_object.data.materials.append(blue)
        # column guards at the aisle
        block((0.18, 0.12, 0.4), (sx * (W / 2 - 0.04), -D / 2 - 0.02, 0.2), mat('guard', (0.95, 0.8, 0.05), 0.4))
    for z in (1.6, 3.0):
        for sy in (-1, 1):
            block((W - 0.16, 0.05, 0.12), (0, sy * (D / 2 - 0.035), z), orange, 0.005)
        block((W - 0.16, D - 0.1, 0.02), (0, 0, z + 0.07), deck)
        # full pallets above the pick face
        for k, px in enumerate((-0.68, 0.68)):
            euro_pallet(px, 0, z + 0.08, wood, w=1.2, d=1.0)
            cases_on_pallet(px, 0, z + 0.23, 1.2, 0.9, 4 if z < 2 else 3, card, wrap, seed=int(z * 10) + k)
    # location labels on the lower beam
    block((0.3, 0.005, 0.08), (-0.68, -D / 2 - 0.035, 1.6), mat('label', (0.97, 0.97, 0.95), 0.5))
    block((0.3, 0.005, 0.08), (0.68, -D / 2 - 0.035, 1.6), mat('label', (0.97, 0.97, 0.95), 0.5))
    export('rack_bay')


def pallet_load():
    reset()
    wood = mat('wood', (0.62, 0.48, 0.3), 0.85)
    card = mat('card', (0.66, 0.5, 0.32), 0.85)
    wrap = mat('wrap', (0.85, 0.9, 0.95), 0.15, 0.0, alpha=0.18)
    euro_pallet(0, 0, 0, wood, w=1.2, d=1.0)
    cases_on_pallet(0, 0, 0.15, 1.2, 0.9, 4, card, wrap, seed=3)
    export('pallet_load')


def pallet():
    reset()
    euro_pallet(0, 0, 0, mat('wood', (0.62, 0.48, 0.3), 0.85))
    export('pallet')


def forklift():
    reset()
    paint = mat('paint', (0.95, 0.65, 0.05), 0.4, 0.2)
    dark = mat('dark', (0.12, 0.12, 0.13), 0.5, 0.3)
    steel = mat('steel', (0.4, 0.42, 0.45), 0.35, 0.8)
    tyre = mat('tyre', (0.05, 0.05, 0.05), 0.85)
    seat = mat('seat', (0.1, 0.1, 0.1), 0.6)
    # chassis (front of the truck = forks = -Y)
    block((1.1, 1.5, 0.55), (0, 0.2, 0.45), paint, 0.04)
    block((1.12, 0.5, 0.75), (0, 0.85, 0.55), dark, 0.08, 3)              # counterweight
    block((0.5, 0.5, 0.35), (0, 0.45, 0.9), seat, 0.06, 3)                # seat base
    block((0.5, 0.1, 0.5), (0, 0.68, 1.25), seat, 0.04, 3)                # back rest
    block((0.3, 0.3, 0.1), (0, -0.3, 0.95), dark, 0.03)                   # dashboard
    cylinder(0.16, 0.03, (0, -0.25, 1.15), dark, rot=(0.9, 0, 0))         # steering wheel
    # overhead guard
    for sx in (-1, 1):
        block((0.06, 0.06, 1.45), (sx * 0.5, -0.35, 1.45), dark, rot=(0.12, 0, 0))
        block((0.06, 0.06, 1.3), (sx * 0.5, 0.75, 1.4), dark)
    block((1.06, 1.25, 0.05), (0, 0.2, 2.15), dark)
    for k in range(5):
        block((1.0, 0.03, 0.03), (0, -0.3 + k * 0.25, 2.12), steel)
    # mast and forks
    for sx in (-1, 1):
        block((0.08, 0.12, 2.1), (sx * 0.32, -0.65, 1.1), steel)
        block((0.12, 1.1, 0.05), (sx * 0.25, -1.25, 0.08), steel)
        block((0.12, 0.05, 0.6), (sx * 0.25, -0.72, 0.38), steel)
    block((0.75, 0.06, 0.5), (0, -0.7, 0.45), steel)
    cylinder(0.05, 1.6, (0, -0.6, 1.2), steel, verts=12)
    # wheels
    for sx in (-1, 1):
        cylinder(0.27, 0.22, (sx * 0.5, -0.35, 0.27), tyre, rot=(0, math.pi / 2, 0), verts=24)
        cylinder(0.2, 0.18, (sx * 0.48, 0.85, 0.2), tyre, rot=(0, math.pi / 2, 0), verts=24)
    # beacon
    cylinder(0.05, 0.08, (0.4, 0.75, 2.22), mat('beacon', (1.0, 0.55, 0.0), 0.3))
    export('forklift')


def roller_door():
    reset()
    steel = mat('steel', (0.62, 0.65, 0.68), 0.4, 0.7)
    dark = mat('dark', (0.22, 0.23, 0.25), 0.5, 0.4)
    yellow = mat('yellow', (0.95, 0.8, 0.05), 0.45)
    W, H = 4.0, 4.0
    for k in range(int(H / 0.1)):
        block((W, 0.04, 0.095), (0, 0, 0.05 + k * 0.1), steel, 0.01)
    block((W + 0.4, 0.5, 0.45), (0, 0.15, H + 0.22), dark, 0.02)
    for sx in (-1, 1):
        block((0.12, 0.15, H), (sx * (W / 2 + 0.06), 0, H / 2), dark)
        block((0.2, 0.25, 1.0), (sx * (W / 2 + 0.2), -0.05, 0.5), yellow, 0.02)
    block((W, 0.08, 0.06), (0, -0.01, 0.03), dark)
    export('roller_door')


for f in (rack_bay, pallet_load, pallet, forklift, roller_door):
    f()
print('ok')
