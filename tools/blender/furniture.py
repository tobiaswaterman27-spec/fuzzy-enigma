"""Home furniture modelled in Blender and exported as GLB:
    python tools/blender/furniture.py public/assets/models

Convention: every piece faces game +Z (Blender -Y), sits on the floor at y = 0 and is centred
on its footprint, so the game only rotates and scales it into an obstacle rectangle.
Material `paint` is the upholstery / accent colour (recoloured per instance in the game).
"""
import math
import sys
import bpy  # must come first: it makes bmesh importable

OUT = sys.argv[-1]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, rough=0.5, metal=0.0, emission=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emission:
        p.inputs['Emission Color'].default_value = (*emission, 1)
        p.inputs['Emission Strength'].default_value = 1.0
    return m


def block(size, loc, m, bevel=0.0, segs=2, rot=(0, 0, 0), soft=0):
    """Box with optional bevel; soft > 0 adds subdivision for cushion-like rounding."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL')
        b.width = bevel
        b.segments = segs
        bpy.ops.object.modifier_apply(modifier='bev')
    if soft:
        # cushion: generously rounded edges (subdividing a thin box would turn it into an oval)
        b = o.modifiers.new('round', 'BEVEL')
        b.width = min(size) * 0.42
        b.segments = 5
        b.profile = 0.6
        bpy.ops.object.modifier_apply(modifier='round')
    for p in o.data.polygons:
        p.use_smooth = bool(bevel or soft)
    o.data.materials.append(m)
    return o


def cylinder(r, depth, loc, m, rot=(0, 0, 0), verts=16):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.active_object
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(m)
    return o


def export(name):
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/{name}.glb', export_format='GLB', export_yup=True)


# Blender: X = width (left/right), Y = depth with the FRONT at -Y, Z = up.

def sofa():
    reset()
    fab = mat('paint', (0.25, 0.38, 0.33), 0.95)
    wood = mat('wood', (0.25, 0.16, 0.09), 0.5)
    W, D, H = 2.2, 0.95, 0.85
    block((W - 0.1, D - 0.1, 0.22), (0, 0.02, 0.22), fab, 0.04, 3)                       # base
    for s in (-1, 1):                                                                    # arms
        block((0.2, D, 0.62), (s * (W / 2 - 0.1), 0, 0.42), fab, 0.08, 4)
    block((W - 0.4, 0.22, 0.5), (0, D / 2 - 0.14, 0.6), fab, 0.06, 3)                     # back frame
    n = 3
    cw = (W - 0.42) / n
    for k in range(n):
        x = -W / 2 + 0.21 + cw * (k + 0.5)
        block((cw - 0.02, D - 0.32, 0.16), (x, -0.07, 0.41), fab, 0.0, soft=2)          # seat cushions
        block((cw - 0.03, 0.18, 0.46), (x, D / 2 - 0.3, 0.68), fab, 0.0, soft=2, rot=(-0.18, 0, 0))  # back cushions
    for sx in (-1, 1):
        for sy in (-1, 1):
            cylinder(0.025, 0.1, (sx * (W / 2 - 0.08), sy * (D / 2 - 0.08), 0.05), wood)
    export('sofa')


def bed():
    reset()
    frame = mat('wood', (0.3, 0.2, 0.13), 0.5)
    sheet = mat('sheet', (0.94, 0.93, 0.9), 0.9)
    duvet = mat('paint', (0.3, 0.42, 0.62), 0.92)
    head = mat('headboard', (0.42, 0.4, 0.38), 0.95)
    W, L = 1.6, 2.1   # width across, length along Y with the headboard at +Y (back)
    block((W, L, 0.22), (0, 0, 0.22), frame, 0.015)
    for sx in (-1, 1):
        for sy in (-1, 1):
            block((0.06, 0.06, 0.12), (sx * (W / 2 - 0.05), sy * (L / 2 - 0.05), 0.06), frame)
    block((W - 0.06, L - 0.06, 0.22), (0, 0, 0.44), sheet, 0.05, 3)                    # mattress
    block((W + 0.02, L * 0.66, 0.08), (0, -L * 0.17, 0.57), duvet, 0.0, soft=2)        # duvet over the foot end
    block((W + 0.02, 0.18, 0.1), (0, L * 0.16 - 0.02, 0.58), sheet, 0.0, soft=2)       # folded sheet edge
    for sx in (-1, 1):
        block((0.62, 0.38, 0.13), (sx * 0.36, L / 2 - 0.3, 0.6), sheet, 0.0, soft=2)   # pillows
    block((W + 0.08, 0.1, 1.05), (0, L / 2 + 0.03, 0.55), head, 0.04, 4)               # upholstered headboard
    export('bed')


def wardrobe():
    reset()
    body = mat('wood', (0.45, 0.31, 0.2), 0.45)
    door = mat('door', (0.5, 0.35, 0.23), 0.4)
    metal = mat('metal', (0.75, 0.72, 0.62), 0.3, 1.0)
    W, D, H = 2.2, 0.7, 2.1
    block((W, D, H - 0.08), (0, 0, 0.08 + (H - 0.08) / 2), body, 0.01)
    block((W - 0.06, D - 0.06, 0.08), (0, 0.01, 0.04), mat('plinth', (0.12, 0.1, 0.09), 0.6))
    nd = 3
    dw = (W - 0.04) / nd
    for k in range(nd):
        x = -W / 2 + 0.02 + dw * (k + 0.5)
        block((dw - 0.012, 0.02, H - 0.16), (x, -D / 2 - 0.01, 0.12 + (H - 0.16) / 2), door, 0.004)
        hx = x + (dw / 2 - 0.08) * (1 if k % 2 == 0 else -1)
        block((0.015, 0.03, 0.3), (hx, -D / 2 - 0.035, 1.05), metal, 0.006)
    block((W + 0.02, D + 0.02, 0.03), (0, 0, H - 0.015), body, 0.008)
    export('wardrobe')


def dining_table():
    reset()
    wood = mat('wood', (0.42, 0.28, 0.17), 0.45)
    W, D, H = 1.4, 0.9, 0.75
    block((W, D, 0.04), (0, 0, H - 0.02), wood, 0.01)
    block((W - 0.16, D - 0.16, 0.08), (0, 0, H - 0.08), wood)
    for sx in (-1, 1):
        for sy in (-1, 1):
            block((0.05, 0.05, H - 0.04), (sx * (W / 2 - 0.1), sy * (D / 2 - 0.1), (H - 0.04) / 2), wood, 0.006)
    export('table')


def chair():
    reset()
    wood = mat('wood', (0.36, 0.24, 0.15), 0.45)
    seat = mat('paint', (0.35, 0.33, 0.3), 0.9)
    # back rest at +Y, so the seat faces -Y (game +Z)
    block((0.44, 0.42, 0.04), (0, 0, 0.45), wood, 0.008)
    block((0.4, 0.38, 0.04), (0, -0.005, 0.485), seat, 0.0, soft=1)
    for sx in (-1, 1):
        for sy in (-1, 1):
            block((0.035, 0.035, 0.45), (sx * 0.19, sy * 0.18, 0.225), wood)
        block((0.035, 0.035, 0.45), (sx * 0.19, 0.19, 0.69), wood, rot=(0.08, 0, 0))
    for z in (0.62, 0.82):
        block((0.4, 0.025, 0.07), (0, 0.2, z), wood, 0.005, rot=(0.08, 0, 0))
    export('chair')


def tv_unit():
    reset()
    wood = mat('wood', (0.2, 0.17, 0.15), 0.5)
    black = mat('black', (0.02, 0.02, 0.025), 0.2)
    screen = mat('screen', (0.02, 0.03, 0.05), 0.08, emission=(0.05, 0.12, 0.25))
    W, D, H = 1.6, 0.45, 0.5
    block((W, D, H - 0.08), (0, 0, 0.08 + (H - 0.08) / 2), wood, 0.01)
    for sx in (-1, 1):
        block((0.04, 0.04, 0.08), (sx * (W / 2 - 0.06), 0, 0.04), black)
    for k in range(2):
        block((W / 2 - 0.04, 0.015, H - 0.16), (-W / 4 + k * W / 2, -D / 2 - 0.005, 0.08 + (H - 0.08) / 2), mat('front', (0.3, 0.26, 0.22), 0.4), 0.004)
    # 50-inch television on a stand
    block((0.3, 0.2, 0.02), (0, 0, H + 0.01), black, 0.005)
    block((0.06, 0.04, 0.12), (0, 0.02, H + 0.08), black)
    block((1.12, 0.05, 0.66), (0, 0.02, H + 0.47), black, 0.008)
    block((1.08, 0.005, 0.62), (0, -0.007, H + 0.47), screen)
    export('tvunit')


def kitchen_base():
    """One 0.6 m base unit: carcass, door with bar handle, worktop section, kick plinth."""
    reset()
    carcass = mat('carcass', (0.88, 0.87, 0.84), 0.5)
    door = mat('paint', (0.9, 0.89, 0.86), 0.35)
    top = mat('worktop', (0.2, 0.2, 0.21), 0.3, 0.1)
    metal = mat('metal', (0.7, 0.71, 0.73), 0.25, 1.0)
    plinth = mat('plinth', (0.15, 0.15, 0.16), 0.5)
    W, D, H = 0.6, 0.6, 0.92
    block((W, D - 0.05, 0.1), (0, 0.025, 0.05), plinth)
    block((W, D - 0.02, H - 0.14), (0, 0.01, 0.1 + (H - 0.14) / 2), carcass)
    block((W - 0.006, 0.02, 0.72), (0, -D / 2 + 0.01, 0.1 + 0.37), door, 0.003)
    block((0.3, 0.025, 0.015), (0, -D / 2 - 0.02, 0.8), metal, 0.006)
    block((W, D + 0.02, 0.04), (0, -0.01, H - 0.02), top, 0.004)
    export('kitchen_base')


def cooker():
    reset()
    body = mat('steel', (0.75, 0.76, 0.77), 0.3, 0.8)
    black = mat('black', (0.03, 0.03, 0.035), 0.15)
    W, D, H = 0.6, 0.6, 0.92
    block((W, D, H - 0.04), (0, 0, (H - 0.04) / 2), body, 0.005)
    block((W - 0.04, 0.02, 0.5), (0, -D / 2 - 0.005, 0.38), black, 0.006)         # oven door glass
    block((W - 0.1, 0.03, 0.02), (0, -D / 2 - 0.03, 0.66), body, 0.008)          # handle
    block((W, D, 0.03), (0, 0, H - 0.015), black, 0.004)                       # ceramic hob
    for sx in (-1, 1):
        for sy in (-1, 1):
            cylinder(0.085, 0.002, (sx * 0.14, sy * 0.14, H + 0.001), mat('ring', (0.18, 0.18, 0.19), 0.3), verts=32)
    for k in range(4):
        cylinder(0.018, 0.02, (-0.21 + k * 0.14, -D / 2 - 0.01, H - 0.12), black, rot=(math.pi / 2, 0, 0))
    export('cooker')


def fridge():
    reset()
    body = mat('white', (0.93, 0.93, 0.92), 0.25)
    metal = mat('metal', (0.7, 0.71, 0.73), 0.25, 1.0)
    W, D, H = 0.7, 0.66, 1.85
    block((W, D, H), (0, 0, H / 2), body, 0.02)
    block((W - 0.01, 0.01, 0.006), (0, -D / 2 - 0.004, 1.15), mat('gap', (0.1, 0.1, 0.1), 0.6))
    for z0, z1 in ((0.15, 1.1), (1.2, 1.75)):
        block((0.02, 0.03, (z1 - z0) * 0.5), (W / 2 - 0.06, -D / 2 - 0.02, (z0 + z1) / 2), metal, 0.008)
    export('fridge')


def coffee_table():
    reset()
    wood = mat('wood', (0.4, 0.27, 0.16), 0.4)
    block((1.1, 0.55, 0.04), (0, 0, 0.42), wood, 0.012)
    block((1.0, 0.45, 0.02), (0, 0, 0.12), wood, 0.006)
    for sx in (-1, 1):
        for sy in (-1, 1):
            block((0.04, 0.04, 0.42), (sx * 0.5, sy * 0.23, 0.21), wood, 0.005)
    # a couple of magazines and a mug
    block((0.24, 0.3, 0.012), (-0.2, 0.02, 0.446), mat('mag', (0.75, 0.2, 0.2), 0.6), rot=(0, 0, 0.2))
    cylinder(0.04, 0.09, (0.28, -0.05, 0.485), mat('mug', (0.95, 0.95, 0.93), 0.2))
    export('coffee_table')


def bookcase():
    reset()
    wood = mat('wood', (0.58, 0.45, 0.32), 0.5)
    W, D, H = 0.9, 0.32, 1.9
    for sx in (-1, 1):
        block((0.02, D, H), (sx * (W / 2 - 0.01), 0, H / 2), wood)
    block((W, 0.01, H), (0, D / 2 - 0.005, H / 2), wood)
    import random
    rnd = random.Random(4)
    cols = [(0.6, 0.15, 0.12), (0.12, 0.25, 0.45), (0.85, 0.75, 0.5), (0.2, 0.4, 0.25), (0.15, 0.15, 0.15), (0.75, 0.55, 0.2)]
    books = [mat(f'book{i}', c, 0.7) for i, c in enumerate(cols)]
    for k in range(6):
        z = 0.04 + k * (H - 0.06) / 5
        block((W - 0.04, D, 0.02), (0, 0, z), wood)
        if k == 5:
            continue
        x = -W / 2 + 0.04
        while x < W / 2 - 0.12:
            bw = rnd.uniform(0.025, 0.05)
            bh = rnd.uniform(0.2, 0.3)
            block((bw, D * 0.8, bh), (x + bw / 2, 0.01, z + 0.01 + bh / 2), books[rnd.randrange(len(books))], 0.002)
            x += bw + 0.003
            if rnd.random() < 0.08:
                x += 0.08
    export('bookcase')


def drawers():
    reset()
    wood = mat('wood', (0.85, 0.83, 0.78), 0.45)
    metal = mat('metal', (0.6, 0.6, 0.62), 0.3, 1.0)
    W, D, H = 0.9, 0.48, 0.85
    block((W, D, H - 0.06), (0, 0, 0.06 + (H - 0.06) / 2), wood, 0.008)
    for k in range(4):
        z = 0.12 + k * 0.18 + 0.08
        block((W - 0.04, 0.02, 0.16), (0, -D / 2 - 0.008, z), wood, 0.004)
        block((0.12, 0.02, 0.015), (0, -D / 2 - 0.025, z + 0.03), metal, 0.005)
    for sx in (-1, 1):
        for sy in (-1, 1):
            block((0.03, 0.03, 0.06), (sx * (W / 2 - 0.04), sy * (D / 2 - 0.04), 0.03), metal)
    export('drawers')


for f in (sofa, bed, wardrobe, dining_table, chair, tv_unit, kitchen_base, cooker, fridge, coffee_table, bookcase, drawers):
    f()
print('ok')
