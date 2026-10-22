"""Models the game's vehicles in Blender and exports them as glTF binaries.

Run with a Python that has the `bpy` module (pip install bpy):
    python tools/blender/vehicles.py public/assets/models

Produces car.glb (a five-door hatchback), saloon.glb (a four-door saloon), suv.glb (a family SUV),
sports.glb (a low two-door coupe) and van.glb (a delivery van).
Conventions: metres, +Y up in glTF (Blender +Z up is converted on export),
vehicle front faces +Z in the game (Blender -Y here, converted by the exporter).
Materials are named so the game can recolour the body paint per car.
"""
import math
import sys
import bpy  # must come first: it makes bmesh importable
import bmesh

OUT = sys.argv[-1]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, rough=0.5, metal=0.0, emission=None, alpha=1.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if coat:
        p.inputs['Coat Weight'].default_value = coat
        p.inputs['Coat Roughness'].default_value = 0.05
    if emission:
        p.inputs['Emission Color'].default_value = (*emission, 1)
        p.inputs['Emission Strength'].default_value = 2.0
    if alpha < 1:
        p.inputs['Alpha'].default_value = alpha
        m.blend_method = 'BLEND'
    return m


def lerp_profile(pts, x):
    """piecewise-linear profile through (x, y) points"""
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x <= x1:
            t = (x - x0) / (x1 - x0)
            # smoothstep inside each segment for softer transitions
            t = t * t * (3 - 2 * t)
            return y0 + (y1 - y0) * t
    return pts[-1][1]


def body_mesh(name, length, top, belt, width, bottom, inset, nose_round, sections=48, ring=None):
    """Lofted body: cross-sections along the length (Blender Y, front at -Y), each a rounded
    profile from the sill up the side to the beltline, then the glasshouse leaning in to the roof."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    half = length / 2
    for i in range(sections + 1):
        v = i / sections                # 0 = rear, 1 = front
        y = -(-half + v * length)       # Blender: front towards -Y
        t = lerp_profile(top, v)
        b = min(lerp_profile(belt, v), t - 0.02)
        w = lerp_profile(width, v)
        bot = lerp_profile(bottom, v)
        ins = inset if t - b > 0.08 else 0.0
        # rounded ends in plan: pull the corners in at the nose and tail
        endk = min(v, 1 - v)
        round_in = nose_round * max(0.0, 1 - endk / 0.08) ** 2
        w2 = max(0.2, w - round_in)
        prof = [
            (0.0, bot - 0.02),
            (w2 * 0.82, bot),
            (w2 * 0.98, bot + 0.08),
            (w2, bot + 0.25),
            (w2, b - 0.04),
            (w2 * 0.995, b),
            (w2 - ins * 0.55, b + (t - b) * 0.5),
            (w2 - ins, t - 0.03),
            (w2 * 0.6 - ins * 0.5, t),
            (0.0, t + 0.005),
        ]
        full = [(-x, z) for x, z in reversed(prof[1:])] + prof  # mirrored: left side then right side
        ring_v = [bm.verts.new((x, y, z)) for x, z in full]
        rings.append(ring_v)
    n = len(rings[0])
    for a, b2 in zip(rings, rings[1:]):
        for k in range(n - 1):
            bm.faces.new((a[k], a[k + 1], b2[k + 1], b2[k]))
    # close the open bottom seam and both ends
    for k in (0,):
        pass
    for r in (rings[0], rings[-1]):
        bm.faces.new(r if r is rings[-1] else list(reversed(r)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # recalculation can settle on all-inward for some shapes: the roof must face up
    roof = max(bm.faces, key=lambda f: f.calc_center_median().z)
    if roof.normal.z < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def assign_glass(ob, body_m, glass_m, belt, top, width, length, glass_ranges, inset, screens):
    """Side windows: between the beltline and the roof edge inside `glass_ranges` (pillars stay paint).
    Screens: on the steeply sloped parts of the roof line (windscreen, rear window) inside `screens`,
    the top surface itself is glass, leaving a frame of paint at the edges."""
    ob.data.materials.append(body_m)
    ob.data.materials.append(glass_m)
    half = length / 2
    for f in ob.data.polygons:
        c = f.center
        v = (-c.y + half) / length
        b = lerp_profile(belt, v)
        t = lerp_profile(top, v)
        w = lerp_profile(width, v)
        side = any(lo + 0.008 <= v <= hi - 0.008 for lo, hi in glass_ranges) and b + 0.04 < c.z < t - 0.04 and abs(c.x) > w - inset - 0.06
        screen = any(lo + 0.006 <= v <= hi - 0.006 for lo, hi in screens) and c.z > b + 0.05 and abs(c.x) < w - inset - 0.07 and f.normal.z > 0.15
        f.material_index = 1 if side or screen else 0


def modifiers(ob, levels=2):
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = levels
    sub.render_levels = levels
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier='sub')
    for p in ob.data.polygons:
        p.use_smooth = True


def cut_arches(ob, wheels, r):
    for (x, y, z) in wheels:
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=3.0, location=(x, y, z), rotation=(0, math.pi / 2, 0), vertices=48)
        cutter = bpy.context.active_object
        mod = ob.modifiers.new('arch', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = cutter
        mod.solver = 'EXACT'
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        before = len(ob.data.vertices)
        bpy.ops.object.modifier_apply(modifier='arch')
        print('arch cut', before, '->', len(ob.data.vertices))
        bpy.data.objects.remove(cutter)
        # dark wheel-well liner so the arch never shows the hollow body
        bpy.ops.mesh.primitive_cylinder_add(radius=r - 0.01, depth=1.3, location=(x, y, z), rotation=(0, math.pi / 2, 0), vertices=32)
        liner = bpy.context.active_object
        liner.data.materials.append(bpy.data.materials['trim'])


def wheel(name, x, y, radius, width, tyre_m, rim_m, hub_m):
    """Tyre with rounded shoulders and a five-spoke rim."""
    objs = []
    bpy.ops.mesh.primitive_torus_add(major_radius=radius - 0.075, minor_radius=0.085, major_segments=32, minor_segments=10, location=(x, y, radius), rotation=(0, math.pi / 2, 0))
    t = bpy.context.active_object
    t.scale = (1, 1, width / 0.17)
    t.data.materials.append(tyre_m)
    objs.append(t)
    # rim disc slightly inset from the outer face
    side = 1 if x > 0 else -1
    bpy.ops.mesh.primitive_cylinder_add(radius=radius * 0.62, depth=0.04, vertices=40, location=(x + side * 0.03, y, radius), rotation=(0, math.pi / 2, 0))
    d = bpy.context.active_object
    d.data.materials.append(hub_m)
    objs.append(d)
    for k in range(5):
        a = k * 2 * math.pi / 5
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x + side * 0.065, y + math.cos(a) * radius * 0.3, radius + math.sin(a) * radius * 0.3), rotation=(a, 0, 0))
        s = bpy.context.active_object
        s.scale = (0.03, 0.055, radius * 0.6)
        s.data.materials.append(rim_m)
        objs.append(s)
    bpy.ops.mesh.primitive_torus_add(major_radius=radius * 0.6, minor_radius=0.018, major_segments=40, minor_segments=8, location=(x + side * 0.065, y, radius), rotation=(0, math.pi / 2, 0))
    lip = bpy.context.active_object
    lip.data.materials.append(rim_m)
    objs.append(lip)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=0.06, vertices=16, location=(x + side * 0.08, y, radius), rotation=(0, math.pi / 2, 0))
    hub = bpy.context.active_object
    hub.data.materials.append(rim_m)
    objs.append(hub)
    for o in objs:
        for p in o.data.polygons:
            p.use_smooth = True
    return objs


def rounded_box(name, size, loc, m, bevel=0.02, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    b = o.modifiers.new('bev', 'BEVEL')
    b.width = bevel
    b.segments = 3
    bpy.ops.object.modifier_apply(modifier='bev')
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(m)
    return o


def join_all(name):
    bpy.ops.object.select_all(action='SELECT')
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def export(path):
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True, use_selection=False)


def build_car():
    reset()
    paint = mat('paint', (0.8, 0.8, 0.8), rough=0.28, metal=0.55, coat=1.0)
    glass = mat('glass', (0.06, 0.08, 0.1), rough=0.05, metal=0.2)
    trim = mat('trim', (0.03, 0.03, 0.035), rough=0.6)
    chrome = mat('chrome', (0.85, 0.86, 0.88), rough=0.15, metal=1.0)
    tyre = mat('tyre', (0.025, 0.025, 0.025), rough=0.85)
    rim = mat('rim', (0.7, 0.72, 0.75), rough=0.25, metal=1.0)
    hub = mat('rimdark', (0.12, 0.12, 0.13), rough=0.4, metal=0.6)
    head = mat('headlight', (0.95, 0.95, 0.9), rough=0.1, emission=(1.0, 0.95, 0.8))
    tail = mat('taillight', (0.6, 0.02, 0.02), rough=0.2, emission=(0.9, 0.05, 0.05))
    L = 4.15
    # profiles along v (0 = rear, 1 = front)
    top = [(0, 0.98), (0.05, 1.16), (0.15, 1.4), (0.3, 1.46), (0.46, 1.46), (0.6, 1.28), (0.69, 1.0), (0.76, 0.95), (0.94, 0.86), (1, 0.72)]
    belt = [(0, 0.92), (0.1, 0.98), (0.6, 0.95), (0.72, 0.93), (1, 0.82)]
    width = [(0, 0.8), (0.1, 0.87), (0.5, 0.89), (0.9, 0.86), (1, 0.8)]
    bottom = [(0, 0.34), (0.08, 0.26), (0.92, 0.26), (1, 0.34)]
    body = body_mesh('body', L, top, belt, width, bottom, inset=0.13, nose_round=0.18)
    assign_glass(body, paint, glass, belt, top, width, L, [(0.14, 0.22), (0.235, 0.39), (0.405, 0.6)], 0.13, [(0.02, 0.13), (0.49, 0.685)])
    modifiers(body, 1)
    wb = 1.35
    wheels = [(sx * 0.82, wy, 0.32) for sx in (-1, 1) for wy in (-wb, wb)]
    cut_arches(body, [(0, wy, 0.32) for wy in (-wb, wb)], 0.39)
    for (x, y, z) in wheels:
        wheel('w', x, y, 0.32, 0.2, tyre, rim, hub)
    # bumpers, grille, lights, mirrors, handles
    rounded_box('bumper_f', (1.7, 0.16, 0.22), (0, -L / 2 + 0.05, 0.42), trim, 0.06)
    rounded_box('bumper_r', (1.66, 0.16, 0.22), (0, L / 2 - 0.05, 0.44), trim, 0.06)
    rounded_box('grille', (0.8, 0.06, 0.14), (0, -L / 2 + 0.03, 0.62), trim, 0.03)
    for s in (-1, 1):
        rounded_box('head', (0.36, 0.08, 0.12), (s * 0.55, -L / 2 + 0.07, 0.72), head, 0.03, rot=(0, 0, -s * 0.12))
        rounded_box('tail', (0.3, 0.06, 0.16), (s * 0.66, L / 2 - 0.02, 0.86), tail, 0.03)
        rounded_box('mirror', (0.18, 0.08, 0.1), (s * 0.95, -0.55, 1.05), paint, 0.03)
        for y in (-0.35, 0.45):
            rounded_box('handle', (0.03, 0.14, 0.03), (s * 0.895, y, 0.95), chrome, 0.01)
    rounded_box('plate_f', (0.5, 0.02, 0.11), (0, -L / 2 - 0.02, 0.45), mat('plate', (0.95, 0.95, 0.92), 0.4), 0.01)
    rounded_box('plate_r', (0.5, 0.02, 0.11), (0, L / 2 + 0.02, 0.62), bpy.data.materials['plate'], 0.01)
    export(f'{OUT}/car.glb')


def build_van():
    reset()
    paint = mat('paint', (0.92, 0.92, 0.92), rough=0.35, metal=0.3, coat=0.6)
    glass = mat('glass', (0.06, 0.08, 0.1), rough=0.05, metal=0.2)
    trim = mat('trim', (0.03, 0.03, 0.035), rough=0.6)
    tyre = mat('tyre', (0.025, 0.025, 0.025), rough=0.85)
    rim = mat('rim', (0.55, 0.57, 0.6), rough=0.3, metal=1.0)
    hub = mat('rimdark', (0.12, 0.12, 0.13), rough=0.4, metal=0.6)
    head = mat('headlight', (0.95, 0.95, 0.9), rough=0.1, emission=(1.0, 0.95, 0.8))
    tail = mat('taillight', (0.6, 0.02, 0.02), rough=0.2, emission=(0.9, 0.05, 0.05))
    stripe = mat('stripe', (0.95, 0.75, 0.05), rough=0.4)
    L = 5.2
    top = [(0, 2.1), (0.02, 2.2), (0.7, 2.2), (0.76, 2.12), (0.86, 1.55), (0.9, 1.25), (0.97, 1.12), (1, 0.95)]
    belt = [(0, 1.95), (0.7, 1.95), (0.76, 1.95), (0.82, 1.2), (1, 1.05)]
    width = [(0, 0.97), (0.5, 0.99), (0.9, 0.97), (1, 0.9)]
    bottom = [(0, 0.4), (0.05, 0.36), (0.95, 0.36), (1, 0.42)]
    body = body_mesh('body', L, top, belt, width, bottom, inset=0.06, nose_round=0.16)
    assign_glass(body, paint, glass, belt, top, width, L, [(0.76, 0.86)], 0.06, [(0.84, 0.9)])
    modifiers(body, 1)
    wb = 1.75
    cut_arches(body, [(0, -wb - 0.05, 0.36), (0, wb - 0.2, 0.36)], 0.42)
    for sx in (-1, 1):
        for wy in (-wb - 0.05, wb - 0.2):
            wheel('w', sx * 0.88, wy, 0.35, 0.22, tyre, rim, hub)
    rounded_box('bumper_f', (1.9, 0.18, 0.25), (0, -L / 2 + 0.06, 0.48), trim, 0.06)
    rounded_box('bumper_r', (1.9, 0.18, 0.25), (0, L / 2 - 0.04, 0.5), trim, 0.06)
    rounded_box('grille', (1.0, 0.06, 0.25), (0, -L / 2 + 0.05, 0.78), trim, 0.03)
    for s in (-1, 1):
        rounded_box('head', (0.3, 0.08, 0.16), (s * 0.66, -L / 2 + 0.08, 0.92), head, 0.03)
        rounded_box('tail', (0.12, 0.05, 0.42), (s * 0.9, L / 2 - 0.01, 1.1), tail, 0.02)
        rounded_box('mirror', (0.2, 0.1, 0.22), (s * 1.08, -1.25, 1.5), trim, 0.03)
        rounded_box('stripe', (0.012, 3.2, 0.3), (s * 0.99, 0.5, 1.3), stripe, 0.004)
    export(f'{OUT}/van.glb')


def build_styled(fname, L, top, belt, width, bottom, glass_ranges, screens, wb, r, track, inset=0.12, ride=0.0, lamp_h=0.72, tail_h=0.86):
    """another body style from the same parts: lofted shell, arches, wheels, lights, trim"""
    reset()
    paint = mat('paint', (0.8, 0.8, 0.8), rough=0.28, metal=0.55, coat=1.0)
    glass = mat('glass', (0.06, 0.08, 0.1), rough=0.05, metal=0.2)
    trim = mat('trim', (0.03, 0.03, 0.035), rough=0.6)
    chrome = mat('chrome', (0.85, 0.86, 0.88), rough=0.15, metal=1.0)
    tyre = mat('tyre', (0.025, 0.025, 0.025), rough=0.85)
    rim = mat('rim', (0.7, 0.72, 0.75), rough=0.25, metal=1.0)
    hub = mat('rimdark', (0.12, 0.12, 0.13), rough=0.4, metal=0.6)
    head = mat('headlight', (0.95, 0.95, 0.9), rough=0.1, emission=(1.0, 0.95, 0.8))
    tail = mat('taillight', (0.6, 0.02, 0.02), rough=0.2, emission=(0.9, 0.05, 0.05))
    body = body_mesh('body', L, top, belt, width, bottom, inset=inset, nose_round=0.18)
    assign_glass(body, paint, glass, belt, top, width, L, glass_ranges, inset, screens)
    modifiers(body, 1)
    cut_arches(body, [(0, wy, r + ride) for wy in (-wb, wb)], r + 0.07)
    for sx in (-1, 1):
        for wy in (-wb, wb):
            wheel('w', sx * track, wy, r, 0.21, tyre, rim, hub)
    wmax = max(w for _, w in width)
    rounded_box('bumper_f', (wmax * 1.9, 0.16, 0.22), (0, -L / 2 + 0.05, bottom[1][1] + 0.16), trim, 0.06)
    rounded_box('bumper_r', (wmax * 1.88, 0.16, 0.22), (0, L / 2 - 0.05, bottom[-2][1] + 0.18), trim, 0.06)
    rounded_box('grille', (wmax * 0.9, 0.06, 0.14), (0, -L / 2 + 0.03, lamp_h - 0.1), trim, 0.03)
    for sd in (-1, 1):
        rounded_box('head', (0.38, 0.08, 0.11), (sd * wmax * 0.62, -L / 2 + 0.07, lamp_h), head, 0.03, rot=(0, 0, -sd * 0.12))
        rounded_box('tail', (0.32, 0.06, 0.14), (sd * wmax * 0.74, L / 2 - 0.02, tail_h), tail, 0.03)
        rounded_box('mirror', (0.18, 0.08, 0.1), (sd * (wmax + 0.06), -L * 0.13, lerp_profile(belt, 0.62) + 0.1), paint, 0.03)
        rounded_box('handle', (0.03, 0.14, 0.03), (sd * (wmax + 0.005), -L * 0.08, lerp_profile(belt, 0.5) - 0.02), chrome, 0.01)
    rounded_box('plate_f', (0.5, 0.02, 0.11), (0, -L / 2 - 0.02, bottom[1][1] + 0.18), mat('plate', (0.95, 0.95, 0.92), 0.4), 0.01)
    rounded_box('plate_r', (0.5, 0.02, 0.11), (0, L / 2 + 0.02, tail_h - 0.22), bpy.data.materials['plate'], 0.01)
    export(f'{OUT}/{fname}')


def build_saloon():
    # three-box: long bonnet, upright cabin, separate boot
    build_styled('saloon.glb', 4.7,
                 top=[(0, 0.86), (0.04, 0.98), (0.2, 1.02), (0.27, 1.12), (0.36, 1.42), (0.56, 1.44), (0.66, 1.22), (0.72, 0.96), (0.94, 0.88), (1, 0.74)],
                 belt=[(0, 0.9), (0.2, 0.96), (0.6, 0.94), (0.72, 0.92), (1, 0.8)],
                 width=[(0, 0.82), (0.1, 0.89), (0.5, 0.91), (0.9, 0.88), (1, 0.8)],
                 bottom=[(0, 0.32), (0.08, 0.25), (0.92, 0.25), (1, 0.32)],
                 glass_ranges=[(0.31, 0.45), (0.465, 0.62)], screens=[(0.25, 0.34), (0.58, 0.71)],
                 wb=1.45, r=0.32, track=0.83, tail_h=0.84)


def build_suv():
    # tall, boxy, high ground clearance
    build_styled('suv.glb', 4.55,
                 top=[(0, 1.3), (0.04, 1.62), (0.1, 1.72), (0.5, 1.74), (0.62, 1.62), (0.7, 1.24), (0.78, 1.16), (0.95, 1.08), (1, 0.92)],
                 belt=[(0, 1.18), (0.1, 1.2), (0.6, 1.18), (0.72, 1.14), (1, 1.0)],
                 width=[(0, 0.88), (0.1, 0.94), (0.5, 0.96), (0.9, 0.93), (1, 0.86)],
                 bottom=[(0, 0.5), (0.08, 0.4), (0.92, 0.4), (1, 0.5)],
                 glass_ranges=[(0.07, 0.23), (0.245, 0.43), (0.445, 0.63)], screens=[(0.0, 0.08), (0.6, 0.71)],
                 wb=1.42, r=0.38, track=0.88, ride=0.04, lamp_h=0.92, tail_h=1.1)


def build_sports():
    # low two-door coupe: long nose, fastback
    build_styled('sports.glb', 4.4,
                 top=[(0, 0.82), (0.06, 0.92), (0.22, 1.06), (0.38, 1.22), (0.5, 1.24), (0.6, 1.08), (0.68, 0.84), (0.9, 0.74), (1, 0.6)],
                 belt=[(0, 0.8), (0.2, 0.86), (0.55, 0.84), (0.68, 0.8), (1, 0.66)],
                 width=[(0, 0.86), (0.15, 0.94), (0.5, 0.9), (0.85, 0.92), (1, 0.82)],
                 bottom=[(0, 0.24), (0.08, 0.17), (0.92, 0.17), (1, 0.24)],
                 glass_ranges=[(0.33, 0.56)], screens=[(0.12, 0.37), (0.55, 0.69)],
                 wb=1.35, r=0.33, track=0.86, inset=0.15, lamp_h=0.58, tail_h=0.72)


if __name__ == '__main__':
    which = sys.argv[-2] if len(sys.argv) > 2 and sys.argv[-2] in ('car', 'van', 'saloon', 'suv', 'sports') else None
    if which in (None, 'car'):
        build_car()
    if which in (None, 'van'):
        build_van()
    if which in (None, 'saloon'):
        build_saloon()
    if which in (None, 'suv'):
        build_suv()
    if which in (None, 'sports'):
        build_sports()
    print('ok')
