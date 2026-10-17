"""Shop fixtures modelled in Blender and exported as GLB:
    python tools/blender/fixtures.py public/assets/models

gondola_bay.glb: one 1.25 m bay of a double-sided supermarket gondola (1.2 m deep, 1.85 m tall),
shelf tops at 0.17, 0.62, 1.07 and 1.52 m to match the game's product layout.
The game tiles bays along a run. Material `paint` is the shop's accent colour (recoloured in game).
Axes: Blender X = across the gondola, Y = along the run, Z = up.
"""
import math
import sys
import bpy  # must come first: it makes bmesh importable

OUT = sys.argv[-1]


def mat(name, color, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    return m


def block(size, loc, m, bevel=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        b = o.modifiers.new('bev', 'BEVEL')
        b.width = bevel
        b.segments = 2
        b.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier='bev')
    o.data.materials.append(m)
    return o


def gondola_bay():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    steel = mat('steel', (0.86, 0.87, 0.88), 0.35, 0.3)
    dark = mat('dark', (0.18, 0.19, 0.2), 0.5, 0.2)
    slot = mat('slot', (0.05, 0.05, 0.055), 0.6)
    ticket = mat('ticket', (0.93, 0.93, 0.9), 0.45)
    paint = mat('paint', (0.18, 0.55, 0.34), 0.45)
    back = mat('back', (0.8, 0.81, 0.82), 0.5, 0.1)
    L = 1.25          # bay length (Y)
    H = 1.85
    half = 0.6        # half depth (X)
    # plinth: base deck plus angled kick plates in the accent colour
    block((1.12, L, 0.1), (0, 0, 0.05), dark, 0.005)
    for s in (-1, 1):
        block((0.02, L, 0.12), (s * 0.585, 0, 0.065), paint, 0.004, rot=(0, s * 0.12, 0))
    # back panel (slatwall): panel with horizontal grooves on both faces
    block((0.04, L - 0.06, H - 0.1), (0, 0, 0.1 + (H - 0.1) / 2), back, 0.003)
    for k in range(14):
        z = 0.25 + k * 0.11
        for s in (-1, 1):
            block((0.004, L - 0.1, 0.012), (s * 0.021, 0, z), slot)
    # uprights at both ends of the bay, with a column of hanger slots
    for y in (-L / 2 + 0.025, L / 2 - 0.025):
        block((0.08, 0.05, H), (0, y, H / 2), steel, 0.006)
        for s in (-1, 1):
            block((0.003, 0.014, H - 0.3), (s * 0.041, y, 0.2 + (H - 0.3) / 2), slot)
    # shelves: deck, front lip with ticket rail, brackets under the deck
    for z in (0.17, 0.62, 1.07, 1.52):
        for s in (-1, 1):
            depth = 0.52
            xc = s * (0.02 + depth / 2)
            block((depth, L - 0.07, 0.02), (xc, 0, z - 0.01), steel, 0.004)
            xf = s * (0.02 + depth)
            block((0.012, L - 0.07, 0.05), (xf, 0, z - 0.005), steel, 0.003)
            block((0.006, L - 0.08, 0.034), (xf + s * 0.008, 0, z - 0.012), ticket, 0.002, rot=(0, -s * 0.15, 0))
            for y in (-L / 2 + 0.06, L / 2 - 0.06):
                # triangular bracket plate from the upright out under the shelf
                me = bpy.data.meshes.new('bracket')
                me.from_pydata([(s * 0.03, y, z - 0.02), (s * 0.48, y, z - 0.02), (s * 0.03, y, z - 0.2)], [], [(0, 1, 2)])
                br = bpy.data.objects.new('bracket', me)
                bpy.context.collection.objects.link(br)
                sol = br.modifiers.new('sol', 'SOLIDIFY')
                sol.thickness = 0.008
                bpy.context.view_layer.objects.active = br
                bpy.ops.object.modifier_apply(modifier='sol')
                br.data.materials.append(steel)
    # top: header rail in the accent colour
    block((0.1, L, 0.06), (0, 0, H + 0.03), paint, 0.005)
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/gondola_bay.glb', export_format='GLB', export_yup=True)


def checkout():
    """4 m checkout counter, 1.2 m deep. Customer side faces -Y (game +Z), the cashier stands at +Y."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lam = mat('laminate', (0.82, 0.82, 0.8), 0.5)
    paint = mat('paint', (0.18, 0.55, 0.34), 0.45)
    top = mat('worktop', (0.08, 0.08, 0.085), 0.25, 0.1)
    rubber = mat('belt', (0.02, 0.02, 0.022), 0.75)
    steel = mat('steel', (0.75, 0.76, 0.78), 0.25, 1.0)
    dark = mat('dark', (0.06, 0.06, 0.065), 0.4)
    glass = mat('scanglass', (0.25, 0.05, 0.03), 0.05, 0.0)
    screen = mat('screen', (0.05, 0.12, 0.25), 0.15)
    screen.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (0.2, 0.45, 0.9, 1)
    screen.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 1.2
    L, D, H = 4.0, 1.2, 0.92
    # cabinet: recessed toe kick, laminate carcass, accent front panel facing the customer
    block((L, D - 0.1, 0.1), (0, 0.02, 0.05), dark)
    block((L, D, H - 0.14), (0, 0, 0.1 + (H - 0.14) / 2), lam, 0.01)
    block((L - 0.1, 0.02, H - 0.3), (0, -D / 2 - 0.005, 0.12 + (H - 0.3) / 2), paint, 0.006)
    block((L + 0.04, D + 0.04, 0.04), (0, 0, H - 0.02), top, 0.008)
    # conveyor: recessed belt with steel side rails, end roller and a divider bar
    bx0, bx1 = -L / 2 + 0.12, 0.35
    blen = bx1 - bx0
    block((blen, 0.5, 0.02), ((bx0 + bx1) / 2, -0.18, H + 0.005), rubber)
    for y in (-0.44, 0.08):
        block((blen, 0.03, 0.05), ((bx0 + bx1) / 2, y, H + 0.02), steel, 0.006)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.025, depth=0.5, location=(bx1 + 0.02, -0.18, H + 0.005), rotation=(math.pi / 2, 0, 0), vertices=16)
    bpy.context.active_object.data.materials.append(steel)
    block((0.36, 0.04, 0.04), (bx0 + 0.6, -0.1, H + 0.04), mat('divider', (0.85, 0.2, 0.15), 0.5), 0.01)
    # flat-bed scanner and the vertical scan window
    block((0.36, 0.36, 0.01), (0.65, -0.12, H + 0.003), glass)
    block((0.36, 0.06, 0.24), (0.65, 0.1, H + 0.12), dark, 0.01)
    block((0.3, 0.005, 0.16), (0.65, 0.068, H + 0.13), glass)
    # cashier screen on a pole, customer display and card terminal
    bpy.ops.mesh.primitive_cylinder_add(radius=0.025, depth=0.32, location=(1.2, 0.3, H + 0.16), vertices=16)
    bpy.context.active_object.data.materials.append(steel)
    block((0.42, 0.04, 0.3), (1.2, 0.3, H + 0.42), dark, 0.01, rot=(-0.25, 0, 0))
    block((0.37, 0.005, 0.25), (1.2, 0.33, H + 0.42), screen, 0.0, rot=(-0.25, 0, 0))
    block((0.2, 0.03, 0.12), (1.2, 0.26, H + 0.62), dark, 0.008, rot=(0.25, 0, 0))
    block((0.17, 0.005, 0.09), (1.2, 0.243, H + 0.62), screen, 0.0, rot=(0.25, 0, 0))
    block((0.09, 0.16, 0.05), (0.95, -0.4, H + 0.06), dark, 0.012, rot=(0.35, 0, 0))
    block((0.07, 0.005, 0.05), (0.95, -0.44, H + 0.09), screen, 0.0, rot=(0.35, 0, 0))
    # cash drawer under the screen on the cashier side, and a bagging shelf at the end
    block((0.45, 0.04, 0.12), (1.2, D / 2 + 0.01, H - 0.12), dark, 0.006)
    block((0.55, 0.9, 0.03), (L / 2 - 0.32, -0.1, H - 0.12), steel, 0.005)
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/checkout.glb', export_format='GLB', export_yup=True)


gondola_bay()
checkout()
print('ok')
