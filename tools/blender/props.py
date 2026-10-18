"""Fixtures and street furniture modelled in Blender and exported as GLB:
    python tools/blender/props.py public/assets/models

terminal.glb       wall-mounted staff clock-in terminal with screen, card reader and keypad (0.5 x 0.12 x 0.6 m, mounted 1.0-1.6 m)
locker.glb         cleaning cupboard: two-door steel locker with vents and a hazard sign (0.9 x 0.5 x 1.9 m)
kiosk.glb          self-checkout: screen, scanner, bagging area, card terminal (0.8 x 1.2 x 1.6 m)
notice_board.glb   vacancy board: framed cork board with pinned job cards and a header (6 x 0.1 x 2.4 m)
office_desk.glb    advisor desk with monitor, keyboard, tray and an office chair behind (4 x 1.2 x 1.3 m)
tree.glb           street tree: tapered trunk, branches and clustered canopy (3.4 x 3.4 x 5.5 m)
park_bench.glb     slatted bench with cast-iron ends (1.8 x 0.7 x 0.85 m)
street_bin.glb     litter bin on a post with a domed lid, body in material `paint` (0.6 x 0.6 x 1.0 m)
bus_shelter.glb    glass shelter with roof, bench and timetable panel (3.2 x 1.4 x 2.6 m)
house_plant.glb    potted plant with layered leaves (0.5 x 0.5 x 1.2 m)
floor_lamp.glb     floor lamp with fabric shade (0.4 x 0.4 x 1.6 m)
cafe_counter.glb   cafe counter with coffee machine, grinder, pastry display, till and cups (12 x 1.0 x 1.4 m)
bistro_set.glb     round cafe table with two chairs (1.4 x 1.4 x 0.9 m)
Conventions as furniture.py: front faces game +Z (Blender -Y), floor at z = 0, centred on the footprint.
"""
import math
import random
import sys
import bpy  # must come first: it makes bmesh importable

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


def blob(r, loc, m, scale=(1, 1, 1), sub=2, seed=0, jitter=0.18):
    bpy.ops.mesh.primitive_ico_sphere_add(radius=r, location=loc, subdivisions=sub)
    o = bpy.context.active_object
    random.seed(seed)
    for v in o.data.vertices:
        k = 1 + (random.random() - 0.5) * jitter * 2
        v.co.x *= k * scale[0]
        v.co.y *= k * scale[1]
        v.co.z *= k * scale[2]
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


def screen(name, color):
    return mat(name, (0.02, 0.03, 0.04), 0.15, emission=color)


def terminal():
    reset()
    body = mat('body', (0.2, 0.21, 0.23), 0.4, 0.3)
    block((0.5, 0.1, 0.6), (0, 0.01, 1.3), body, 0.02, 3)
    block((0.38, 0.01, 0.24), (0, -0.045, 1.42), screen('scr', (0.15, 0.6, 0.3)))
    block((0.16, 0.02, 0.1), (0, -0.05, 1.18), mat('reader', (0.1, 0.1, 0.11), 0.3), 0.01)
    cylinder(0.008, 0.005, (0.05, -0.06, 1.18), mat('led', (0.1, 0.9, 0.2), 0.3, emission=(0.1, 0.9, 0.2)), rot=(math.pi / 2, 0, 0), verts=8)
    for i in range(3):
        for j in range(4):
            block((0.03, 0.01, 0.025), (-0.06 + i * 0.04, -0.05, 1.11 - j * 0.032), mat('key', (0.75, 0.76, 0.78), 0.4), 0.003)
    block((0.3, 0.005, 0.04), (0, -0.05, 1.56), mat('logo', (0.95, 0.95, 0.95), 0.5))
    export('terminal')


def locker():
    reset()
    steel = mat('steel', (0.55, 0.62, 0.68), 0.45, 0.6)
    dark = mat('dark', (0.12, 0.13, 0.14), 0.5)
    W, D, H = 0.9, 0.5, 1.9
    block((W, D, H - 0.06), (0, 0, 0.06 + (H - 0.06) / 2), steel, 0.01)
    block((W, D, 0.06), (0, 0, 0.03), dark)
    for sx in (-1, 1):
        block((W / 2 - 0.02, 0.01, H - 0.12), (sx * W / 4, -D / 2 - 0.004, 0.06 + (H - 0.06) / 2), steel, 0.005)
        for k in range(5):
            block((0.22, 0.012, 0.012), (sx * W / 4, -D / 2 - 0.012, 1.6 + k * 0.03), dark)
        block((0.02, 0.03, 0.14), (sx * 0.04, -D / 2 - 0.02, 1.05), mat('handle', (0.75, 0.75, 0.77), 0.25, 0.9), 0.008)
    block((0.18, 0.005, 0.18), (-W / 4, -D / 2 - 0.012, 1.3), mat('hazard', (0.95, 0.75, 0.05), 0.5), rot=(0, math.pi / 4, 0))
    block((0.3, 0.005, 0.08), (W / 4, -D / 2 - 0.012, 1.35), mat('label', (0.95, 0.95, 0.93), 0.5))
    export('locker')


def kiosk():
    reset()
    body = mat('body', (0.2, 0.25, 0.3), 0.4, 0.2)
    white = mat('white', (0.92, 0.93, 0.94), 0.35)
    steel = mat('steel', (0.75, 0.77, 0.8), 0.25, 0.8)
    # pedestal with the scanner bed on top, screen on a stalk, bagging shelf to one side
    block((0.55, 0.55, 0.9), (0, 0.1, 0.45), body, 0.03, 3)
    block((0.6, 0.6, 0.06), (0, 0.08, 0.93), white, 0.02)
    block((0.3, 0.25, 0.01), (0, 0.0, 0.965), mat('glass', (0.1, 0.12, 0.14), 0.05, 0.3))
    cylinder(0.008, 0.005, (0, 0.0, 0.97), mat('laser', (1, 0.1, 0.1), 0.3, emission=(1, 0.1, 0.1)), verts=8)
    block((0.08, 0.08, 0.45), (0, 0.32, 1.18), body, 0.01)
    block((0.48, 0.05, 0.36), (0, 0.28, 1.5), body, 0.02, rot=(0.35, 0, 0))
    block((0.42, 0.01, 0.3), (0, 0.255, 1.5), screen('scr', (0.2, 0.5, 0.9)), rot=(0.35, 0, 0))
    block((0.1, 0.12, 0.05), (0.22, -0.05, 1.0), mat('pin', (0.12, 0.12, 0.13), 0.35), 0.01, rot=(0.4, 0, 0))
    # bagging area
    block((0.05, 0.5, 0.05), (0.62, 0.1, 0.88), steel)
    block((0.5, 0.5, 0.03), (0.6, 0.1, 0.8), white, 0.01)
    for sx in (0.4, 0.8):
        tube((sx, -0.12, 0.82), (sx, -0.12, 1.25), 0.008, steel)
        tube((sx, 0.32, 0.82), (sx, 0.32, 1.25), 0.008, steel)
    export('kiosk')


def notice_board():
    reset()
    cork = mat('cork', (0.72, 0.55, 0.36), 0.95)
    frame = mat('frame', (0.12, 0.3, 0.47), 0.5)
    W, H0, H1 = 6.0, 0.8, 2.2
    block((W, 0.04, H1 - H0), (0, 0, (H0 + H1) / 2), cork)
    for z in (H0, H1):
        block((W + 0.1, 0.07, 0.06), (0, -0.01, z), frame, 0.01)
    for x in (-W / 2, W / 2):
        block((0.06, 0.07, H1 - H0 + 0.06), (x, -0.01, (H0 + H1) / 2), frame, 0.01)
    block((W + 0.1, 0.06, 0.24), (0, -0.01, H1 + 0.15), frame, 0.01)
    block((2.0, 0.005, 0.1), (0, -0.045, H1 + 0.15), mat('title', (0.97, 0.97, 0.97), 0.5))
    random.seed(5)
    papers = [(1, 1, 1), (1, 0.97, 0.7), (0.85, 0.94, 1), (1, 0.88, 0.88)]
    for i in range(14):
        x = -W / 2 + 0.45 + (i % 7) * 0.85 + (random.random() - 0.5) * 0.1
        z = H0 + 0.4 + (i // 7) * 0.65 + (random.random() - 0.5) * 0.08
        block((0.42, 0.004, 0.55), (x, -0.024, z), mat(f'paper{i % 4}', papers[i % 4], 0.85), rot=(0, (random.random() - 0.5) * 0.12, 0))
        block((0.3, 0.003, 0.06), (x, -0.027, z + 0.18), mat('head', (0.15, 0.35, 0.6), 0.6))
        for k in range(4):
            block((0.28, 0.002, 0.012), (x, -0.027, z + 0.06 - k * 0.06), mat('ink', (0.3, 0.3, 0.32), 0.7))
        cylinder(0.012, 0.01, (x, -0.03, z + 0.25), mat(f'pin{i % 3}', [(0.9, 0.1, 0.1), (0.1, 0.5, 0.9), (0.1, 0.7, 0.2)][i % 3], 0.3), rot=(math.pi / 2, 0, 0), verts=8)
    export('notice_board')


def office_desk():
    reset()
    top = mat('top', (0.82, 0.83, 0.8), 0.45)
    steel = mat('steel', (0.5, 0.55, 0.6), 0.4, 0.6)
    dark = mat('dark', (0.1, 0.1, 0.11), 0.4)
    W, D, H = 4.0, 1.2, 0.75
    block((W, D, 0.04), (0, 0, H), top, 0.008)
    block((W, 0.03, 0.6), (0, -D / 2 + 0.03, H - 0.32), mat('modesty', (0.45, 0.5, 0.56), 0.5))
    for sx in (-1, 1):
        block((0.05, D - 0.1, H - 0.02), (sx * (W / 2 - 0.05), 0, (H - 0.02) / 2), steel)
    # pedestal drawers
    block((0.45, 0.6, 0.6), (1.4, 0.2, 0.32), steel, 0.01)
    for k in range(3):
        block((0.4, 0.01, 0.16), (1.4, 0.505, 0.15 + k * 0.19), mat('drawer', (0.62, 0.66, 0.7), 0.4), 0.004)
    # monitor (faces the customer side, -Y), keyboard on the staff side, tray, phone, papers
    block((0.6, 0.04, 0.36), (0, 0.15, H + 0.33), dark, 0.01)
    block((0.56, 0.01, 0.32), (0, 0.172, H + 0.33), screen('scr', (0.2, 0.45, 0.75)))
    block((0.08, 0.08, 0.15), (0, 0.18, H + 0.1), dark)
    block((0.25, 0.18, 0.015), (0, 0.18, H + 0.02), dark)
    block((0.45, 0.15, 0.02), (0, 0.38, H + 0.03), dark, 0.005)
    block((0.3, 0.24, 0.05), (-1.2, 0.1, H + 0.045), mat('tray', (0.2, 0.2, 0.22), 0.5), 0.01)
    block((0.21, 0.29, 0.02), (-1.2, 0.1, H + 0.07), mat('paper', (0.97, 0.97, 0.95), 0.8))
    block((0.18, 0.2, 0.06), (0.8, 0.1, H + 0.05), dark, 0.02)
    # office chair behind (staff side, +Y)
    cylinder(0.25, 0.05, (0, 0.95, 0.06), dark, verts=5)
    cylinder(0.03, 0.4, (0, 0.95, 0.28), steel, verts=10)
    block((0.5, 0.48, 0.08), (0, 0.95, 0.5), mat('fabric', (0.15, 0.2, 0.3), 0.9), 0.03, 3)
    block((0.46, 0.07, 0.5), (0, 1.17, 0.85), mat('fabric', (0.15, 0.2, 0.3), 0.9), 0.03, 3, rot=(-0.12, 0, 0))
    export('office_desk')


def tree():
    reset()
    bark = mat('bark', (0.33, 0.24, 0.17), 0.95)
    leaves = [mat('leaf0', (0.2, 0.42, 0.18), 0.85), mat('leaf1', (0.26, 0.5, 0.2), 0.85), mat('leaf2', (0.17, 0.36, 0.15), 0.85)]
    cylinder(0.22, 2.6, (0, 0, 1.3), bark, verts=12, r2=0.13)
    random.seed(11)
    tips = []
    for k in range(5):
        a = k * 2 * math.pi / 5 + random.random() * 0.4
        base = (0, 0, 2.0 + random.random() * 0.6)
        tip = (math.cos(a) * 1.1, math.sin(a) * 1.1, base[2] + 1.0 + random.random() * 0.5)
        tube(base, tip, 0.08, bark, verts=8)
        tips.append(tip)
    tips.append((0, 0, 4.3))
    for i, t in enumerate(tips):
        for j in range(3):
            c = (t[0] + (random.random() - 0.5) * 0.8, t[1] + (random.random() - 0.5) * 0.8, t[2] + (random.random() - 0.3) * 0.6)
            blob(0.75 + random.random() * 0.35, c, leaves[(i + j) % 3], scale=(1, 1, 0.8), seed=i * 7 + j, jitter=0.22)
    export('tree')


def park_bench():
    reset()
    wood = mat('wood', (0.5, 0.33, 0.2), 0.7)
    iron = mat('iron', (0.12, 0.13, 0.14), 0.5, 0.6)
    W = 1.8
    for k in range(4):
        block((W, 0.1, 0.035), (0, -0.25 + k * 0.12, 0.45), wood, 0.008)
    for k in range(3):
        block((W, 0.03, 0.09), (0, 0.17 + k * 0.025, 0.6 + k * 0.12), wood, 0.008, rot=(-0.25, 0, 0))
    for sx in (-1, 1):
        x = sx * (W / 2 - 0.12)
        tube((x, -0.3, 0.0), (x, -0.22, 0.45), 0.03, iron)
        tube((x, 0.18, 0.0), (x, 0.2, 0.9), 0.03, iron)
        tube((x, -0.3, 0.45), (x, 0.2, 0.45), 0.025, iron)
        tube((x, -0.28, 0.62), (x, 0.18, 0.62), 0.022, iron)
        tube((x, -0.28, 0.62), (x, -0.26, 0.45), 0.022, iron)
    export('park_bench')


def street_bin():
    reset()
    paint = mat('paint', (0.18, 0.36, 0.23), 0.55, 0.3)
    dark = mat('dark', (0.1, 0.1, 0.1), 0.6)
    cylinder(0.27, 0.75, (0, 0, 0.45), paint, verts=24)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.28, location=(0, 0, 0.82), segments=24, ring_count=10)
    o = bpy.context.active_object
    o.scale = (1, 1, 0.45)
    bpy.ops.object.transform_apply(scale=True)
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(paint)
    block((0.24, 0.05, 0.1), (0, -0.25, 0.86), dark, 0.02)
    for k in range(6):
        block((0.025, 0.02, 0.6), (math.cos(k) * 0.0, -0.272, 0.42), mat('band', (0.75, 0.66, 0.3), 0.4, 0.6)) if k == 0 else None
    cylinder(0.04, 0.1, (0, 0, 0.05), dark, verts=12)
    block((0.18, 0.005, 0.08), (0, -0.274, 0.6), mat('label', (0.9, 0.9, 0.88), 0.5))
    export('street_bin')


def bus_shelter():
    reset()
    frame = mat('frame', (0.25, 0.27, 0.3), 0.4, 0.7)
    glass = mat('glass', (0.7, 0.8, 0.85), 0.05, 0.0, alpha=0.3)
    W, D, H = 3.2, 1.4, 2.5
    for sx in (-1, 1):
        for sy in (-1, 1):
            block((0.06, 0.06, H), (sx * (W / 2 - 0.03), sy * (D / 2 - 0.03), H / 2), frame)
    block((W + 0.2, D + 0.3, 0.08), (0, 0, H + 0.04), frame, 0.01)
    block((W - 0.1, D + 0.2, 0.02), (0, 0, H + 0.09), mat('roofglass', (0.6, 0.7, 0.75), 0.1, alpha=0.5))
    block((W - 0.06, 0.02, H - 0.2), (0, D / 2 - 0.03, H / 2 + 0.05), glass)
    for sx in (-1, 1):
        block((0.02, D - 0.06, H - 0.2), (sx * (W / 2 - 0.03), 0, H / 2 + 0.05), glass)
    block((W - 0.6, 0.3, 0.05), (0, D / 2 - 0.25, 0.5), frame, 0.01)
    for sx in (-0.9, 0.9):
        block((0.05, 0.25, 0.48), (sx, D / 2 - 0.25, 0.24), frame)
    block((0.8, 0.05, 1.1), (W / 2 - 0.5, D / 2 - 0.06, 1.4), mat('ad', (0.95, 0.95, 0.95), 0.4, emission=(0.9, 0.85, 0.6)))
    block((0.7, 0.01, 1.0), (W / 2 - 0.5, D / 2 - 0.09, 1.4), mat('poster', (0.2, 0.45, 0.75), 0.5))
    block((0.5, 0.04, 0.3), (-W / 2 + 0.5, D / 2 - 0.06, 1.6), mat('timetable', (0.95, 0.95, 0.9), 0.6))
    export('bus_shelter')


def house_plant():
    reset()
    pot = mat('pot', (0.62, 0.36, 0.24), 0.75)
    soil = mat('soil', (0.18, 0.12, 0.08), 0.95)
    leaf = [mat('leafa', (0.18, 0.45, 0.2), 0.6), mat('leafb', (0.24, 0.55, 0.24), 0.6)]
    cylinder(0.2, 0.38, (0, 0, 0.19), pot, verts=20, r2=0.24)
    cylinder(0.22, 0.02, (0, 0, 0.37), soil, verts=20)
    random.seed(3)
    for k in range(26):
        a = k * 2.4
        h = 0.35 + random.random() * 0.7
        tip = (math.cos(a) * (0.2 + random.random() * 0.15), math.sin(a) * (0.2 + random.random() * 0.15), 0.38 + h)
        tube((0, 0, 0.38), tip, 0.008, leaf[0], verts=5)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.2, location=tip, segments=10, ring_count=6)
        o = bpy.context.active_object
        o.scale = (1.0, 0.5, 0.1)
        o.rotation_euler = (random.random() * 0.8, 0, a)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        for p in o.data.polygons:
            p.use_smooth = True
        o.data.materials.append(leaf[k % 2])
    export('house_plant')


def floor_lamp():
    reset()
    brass = mat('brass', (0.75, 0.6, 0.35), 0.3, 0.9)
    shade = mat('shade', (0.95, 0.9, 0.8), 0.7, emission=(0.6, 0.5, 0.35))
    cylinder(0.16, 0.03, (0, 0, 0.015), brass, verts=24)
    cylinder(0.012, 1.5, (0, 0, 0.77), brass, verts=10)
    cylinder(0.2, 0.3, (0, 0, 1.5), shade, verts=24, r2=0.14)
    export('floor_lamp')


def cafe_counter():
    reset()
    wood = mat('wood', (0.45, 0.17, 0.14), 0.55)
    top = mat('top', (0.15, 0.15, 0.16), 0.25)
    steel = mat('steel', (0.75, 0.77, 0.8), 0.2, 0.9)
    glass = mat('glass', (0.8, 0.9, 0.95), 0.05, alpha=0.3)
    W, D, H = 12.0, 1.0, 1.0
    block((W, D, H - 0.04), (0, 0, (H - 0.04) / 2), wood, 0.01)
    for k in range(24):
        block((0.03, 0.01, H - 0.2), (-W / 2 + 0.25 + k * 0.5, -D / 2 - 0.005, (H - 0.04) / 2), mat('slat', (0.38, 0.14, 0.11), 0.6))
    block((W + 0.05, D + 0.08, 0.04), (0, -0.02, H), top, 0.005)
    # espresso machine and grinder
    block((0.75, 0.5, 0.45), (-3.5, 0.15, H + 0.245), steel, 0.03, 3)
    block((0.7, 0.02, 0.2), (-3.5, -0.105, H + 0.36), mat('red', (0.7, 0.1, 0.08), 0.3))
    for k in range(2):
        cylinder(0.035, 0.05, (-3.7 + k * 0.4, -0.08, H + 0.18), mat('black', (0.05, 0.05, 0.05), 0.4), verts=12)
    cylinder(0.09, 0.3, (-2.9, 0.15, H + 0.17), mat('black', (0.05, 0.05, 0.05), 0.4), verts=16)
    cylinder(0.11, 0.2, (-2.9, 0.15, H + 0.42), mat('hopper', (0.5, 0.35, 0.25), 0.1, alpha=0.6), verts=16, r2=0.07)
    for k in range(6):
        cylinder(0.04, 0.09, (-3.95 + (k % 3) * 0.12, 0.25 + (k // 3) * 0.12, H + 0.5 + 0.045), mat('cup', (0.97, 0.97, 0.96), 0.2), verts=12)
    # pastry display case
    block((1.6, 0.6, 0.06), (1.0, 0.05, H + 0.05), steel)
    block((1.6, 0.6, 0.45), (1.0, 0.05, H + 0.3), glass)
    for k in range(10):
        cylinder(0.07, 0.05, (0.4 + (k % 5) * 0.3, -0.05 + (k // 5) * 0.2, H + 0.11), mat(f'pastry{k % 3}', [(0.8, 0.55, 0.25), (0.55, 0.3, 0.15), (0.9, 0.8, 0.6)][k % 3], 0.6), verts=12)
    # till
    block((0.35, 0.3, 0.12), (3.0, 0.1, H + 0.08), mat('tillb', (0.15, 0.15, 0.16), 0.4), 0.01)
    block((0.3, 0.02, 0.22), (3.0, 0.0, H + 0.28), screen('scr', (0.3, 0.6, 0.9)), rot=(0.3, 0, 0))
    export('cafe_counter')


def bistro_set():
    reset()
    top = mat('top', (0.92, 0.9, 0.86), 0.3)
    iron = mat('iron', (0.1, 0.1, 0.11), 0.4, 0.6)
    wood = mat('seat', (0.45, 0.3, 0.2), 0.6)
    cylinder(0.38, 0.03, (0, 0, 0.75), top, verts=32)
    cylinder(0.03, 0.72, (0, 0, 0.37), iron, verts=10)
    cylinder(0.25, 0.03, (0, 0, 0.015), iron, verts=24)
    for sy in (-1, 1):
        y = sy * 0.58
        cylinder(0.21, 0.04, (0, y, 0.46), wood, verts=24)
        for a in range(4):
            ang = a * math.pi / 2 + math.pi / 4
            tube((math.cos(ang) * 0.16, y + math.sin(ang) * 0.16, 0.44), (math.cos(ang) * 0.2, y + math.sin(ang) * 0.2, 0.0), 0.012, iron, verts=6)
        tube((-0.16, y + sy * 0.15, 0.46), (-0.15, y + sy * 0.2, 0.86), 0.012, iron, verts=6)
        tube((0.16, y + sy * 0.15, 0.46), (0.15, y + sy * 0.2, 0.86), 0.012, iron, verts=6)
        block((0.36, 0.03, 0.12), (0, y + sy * 0.2, 0.8), wood, 0.01)
    export('bistro_set')


def waiting_chairs():
    reset()
    frame = mat('frame', (0.3, 0.32, 0.35), 0.35, 0.8)
    seat = mat('seat', (0.12, 0.3, 0.5), 0.6)
    W = 2.2
    block((W, 0.06, 0.05), (0, 0.05, 0.4), frame)
    for sx in (-1, 1):
        tube((sx * (W / 2 - 0.15), 0.05, 0.4), (sx * (W / 2 - 0.15), -0.2, 0.0), 0.02, frame)
        tube((sx * (W / 2 - 0.15), 0.05, 0.4), (sx * (W / 2 - 0.15), 0.3, 0.0), 0.02, frame)
    for k in range(4):
        x = -W / 2 + 0.275 + k * 0.55
        block((0.48, 0.46, 0.06), (x, 0.0, 0.46), seat, 0.025, 3)
        block((0.48, 0.05, 0.45), (x, 0.24, 0.72), seat, 0.025, 3, rot=(-0.12, 0, 0))
    export('waiting_chairs')


def water_cooler():
    reset()
    white = mat('white', (0.93, 0.94, 0.95), 0.35)
    water = mat('water', (0.55, 0.75, 0.95), 0.05, alpha=0.5)
    block((0.34, 0.34, 1.0), (0, 0, 0.5), white, 0.02, 3)
    cylinder(0.14, 0.45, (0, 0, 1.25), water, verts=24)
    block((0.2, 0.05, 0.05), (0, -0.18, 0.85), mat('taps', (0.2, 0.4, 0.8), 0.3), 0.01)
    for k in range(5):
        cylinder(0.035, 0.08, (0.12, -0.12, 0.6 + k * 0.012), mat('cup', (0.97, 0.97, 0.97), 0.4), verts=10, r2=0.03)
    export('water_cooler')


def leaflet_stand():
    reset()
    frame = mat('frame', (0.75, 0.77, 0.8), 0.3, 0.8)
    block((0.5, 0.3, 0.03), (0, 0.05, 0.015), frame)
    block((0.04, 0.04, 1.4), (0, 0.12, 0.7), frame)
    for k in range(4):
        z = 0.45 + k * 0.28
        block((0.46, 0.08, 0.02), (0, -0.02, z), frame, rot=(0.3, 0, 0))
        for j in range(3):
            block((0.13, 0.01, 0.2), (-0.15 + j * 0.15, 0.0, z + 0.1), mat(f'leaflet{(k + j) % 4}', [(0.9, 0.3, 0.2), (0.2, 0.5, 0.8), (0.95, 0.85, 0.2), (0.3, 0.65, 0.35)][(k + j) % 4], 0.6), rot=(0.3, 0, 0))
    export('leaflet_stand')


for f in (waiting_chairs, water_cooler, leaflet_stand, terminal, locker, kiosk, notice_board, office_desk, tree, park_bench, street_bin, bus_shelter, house_plant, floor_lamp, cafe_counter, bistro_set):
    f()
print('ok')
