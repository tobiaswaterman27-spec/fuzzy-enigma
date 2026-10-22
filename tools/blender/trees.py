"""A broadleaf street/park tree modelled in Blender and exported as GLB (replaces the blob tree):
    python tools/blender/trees.py public/assets/models

tree.glb  about 6.5 m tall: a tapered, slightly leaning trunk with a root flare, a leader and five
          main limbs with side branches, and a crown of alpha-cut leaf cards (a painted texture of leaf
          sprays). Bark and leaf textures are drawn here with PIL and packed into the GLB.
Axes as the other props: Blender Z up, exported Y up; the trunk stands at the origin.
"""
import math
import os
import random
import sys
import tempfile

import bpy
import bmesh
from mathutils import Vector
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[-1]
TMP = tempfile.mkdtemp()


def leaf_texture(path, seed=3):
    """sprays of small leaves on a transparent background"""
    rnd = random.Random(seed)
    S = 512
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # a few twigs first, so leaves sit on them
    for _ in range(9):
        x0, y0 = rnd.uniform(0.25, 0.75) * S, rnd.uniform(0.55, 0.95) * S
        x1, y1 = x0 + rnd.uniform(-0.35, 0.35) * S, y0 - rnd.uniform(0.3, 0.55) * S
        d.line([(x0, y0), (x1, y1)], fill=(84, 64, 44, 255), width=3)
    greens = [(84, 132, 58), (102, 150, 66), (72, 118, 50), (122, 166, 78), (92, 140, 56), (134, 174, 86)]
    for _ in range(620):
        # leaves crowd the middle and thin out towards the edges, which reads as a rounded spray
        r = min(0.42, abs(rnd.gauss(0, 0.2))) * S
        a = rnd.uniform(0, 2 * math.pi)
        cx, cy = S / 2 + math.cos(a) * r, S / 2 + math.sin(a) * r * 0.9
        if not (14 < cx < S - 14 and 14 < cy < S - 14):
            continue
        L, W = rnd.uniform(16, 30), rnd.uniform(8, 13)
        ang = rnd.uniform(0, math.pi)
        pts = []
        for k in range(14):
            t = k / 13 * 2 * math.pi
            px, py = math.cos(t) * L / 2, math.sin(t) * W / 2 * (1 - 0.35 * math.cos(t))
            pts.append((cx + px * math.cos(ang) - py * math.sin(ang), cy + px * math.sin(ang) + py * math.cos(ang)))
        g = greens[rnd.randrange(len(greens))]
        shade = rnd.uniform(0.82, 1.12)
        col = tuple(max(0, min(255, int(c * shade))) for c in g) + (255,)
        d.polygon(pts, fill=col)
        # midrib
        d.line([(cx - math.cos(ang) * L * 0.42, cy - math.sin(ang) * L * 0.42), (cx + math.cos(ang) * L * 0.42, cy + math.sin(ang) * L * 0.42)], fill=tuple(int(c * 0.78) for c in col[:3]) + (255,), width=1)
    img = img.filter(ImageFilter.SMOOTH)
    img.save(path)


def bark_texture(path, seed=5):
    rnd = random.Random(seed)
    W, H = 256, 512
    img = Image.new('RGB', (W, H), (92, 80, 68))
    d = ImageDraw.Draw(img)
    for _ in range(900):
        x = rnd.uniform(0, W)
        y = rnd.uniform(0, H)
        h = rnd.uniform(20, 120)
        v = rnd.randint(-28, 22)
        d.line([(x, y), (x + rnd.uniform(-4, 4), y + h)], fill=(92 + v, 80 + v, 66 + v), width=rnd.randint(2, 5))
    for _ in range(140):
        x, y = rnd.uniform(0, W), rnd.uniform(0, H)
        d.line([(x, y), (x + rnd.uniform(-3, 3), y + rnd.uniform(15, 60))], fill=(44, 36, 30), width=2)
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    img.save(path)


def material(name, image_path, alpha_clip=False, rough=0.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(image_path)
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    if alpha_clip:
        # the glTF exporter writes alphaMode MASK when alpha passes through a "greater than" test
        cmp = nt.nodes.new('ShaderNodeMath')
        cmp.operation = 'GREATER_THAN'
        cmp.inputs[1].default_value = 0.5
        nt.links.new(tex.outputs['Alpha'], cmp.inputs[0])
        nt.links.new(cmp.outputs[0], bsdf.inputs['Alpha'])
        m.use_backface_culling = False
    return m


def tree():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rnd = random.Random(11)
    leaf_png, bark_png = os.path.join(TMP, 'leaves.png'), os.path.join(TMP, 'bark.png')
    leaf_texture(leaf_png)
    bark_texture(bark_png)
    bark = material('bark', bark_png, rough=0.95)
    leaves = material('leaves', leaf_png, alpha_clip=True, rough=0.8)

    wood = bmesh.new()
    uv_w = wood.loops.layers.uv.new()
    foliage = bmesh.new()
    uv_f = foliage.loops.layers.uv.new()

    def limb(points, r0, r1, sides=7):
        """a tapered tube along a polyline"""
        rings = []
        n = len(points)
        for i, p in enumerate(points):
            p = Vector(p)
            t = i / (n - 1)
            r = r0 + (r1 - r0) * t
            fwd = (Vector(points[min(i + 1, n - 1)]) - Vector(points[max(i - 1, 0)])).normalized()
            side = fwd.cross(Vector((0, 0, 1)))
            if side.length < 1e-3:
                side = Vector((1, 0, 0))
            side.normalize()
            up = side.cross(fwd).normalized()
            ring = [wood.verts.new(p + (side * math.cos(a) + up * math.sin(a)) * r) for a in [k * 2 * math.pi / sides for k in range(sides)]]
            rings.append((ring, t))
        for (ra, ta), (rb, tb) in zip(rings, rings[1:]):
            for k in range(sides):
                f = wood.faces.new((ra[k], ra[(k + 1) % sides], rb[(k + 1) % sides], rb[k]))
                f.smooth = True
                for loop, (u, v) in zip(f.loops, ((k / sides, ta * 3), ((k + 1) / sides, ta * 3), ((k + 1) / sides, tb * 3), (k / sides, tb * 3))):
                    loop[uv_w].uv = (u, v)

    def bent(a, b, bend, segs=4):
        """points from a to b sagging/rising by `bend` in the middle"""
        a, b = Vector(a), Vector(b)
        return [tuple(a + (b - a) * (i / segs) + Vector((0, 0, bend * math.sin(math.pi * i / segs)))) for i in range(segs + 1)]

    def cluster(c, n, spread, size):
        c = Vector(c)
        for _ in range(n):
            off = Vector((max(-1.6, min(1.6, rnd.gauss(0, 1))) * spread, max(-1.6, min(1.6, rnd.gauss(0, 1))) * spread, max(-1.6, min(1.6, rnd.gauss(0, 1))) * spread * 0.7))
            p = c + off
            # cards face out from the crown centre, tilted randomly
            nrm = (off + Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), rnd.uniform(-0.2, 0.8)))).normalized()
            t1 = nrm.cross(Vector((0, 0, 1)))
            if t1.length < 1e-3:
                t1 = Vector((1, 0, 0))
            t1.normalize()
            t2 = nrm.cross(t1).normalized()
            s = size * rnd.uniform(0.8, 1.2)
            ang = rnd.uniform(0, 2 * math.pi)
            u = t1 * math.cos(ang) + t2 * math.sin(ang)
            w = nrm.cross(u).normalized()
            vs = [foliage.verts.new(p + (u * sx + w * sy) * s / 2) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            f = foliage.faces.new(vs)
            for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
                loop[uv_f].uv = uv

    # trunk with a root flare and a slight lean; the leader carries on up through the crown
    lean = Vector((0.12, 0.05, 0))
    limb([(0, 0, 0), (0, 0, 0.25)], 0.34, 0.22, 9)
    trunk_top = Vector((0, 0, 2.5)) + lean
    limb(bent((0, 0, 0.25), trunk_top, 0.0, 3), 0.22, 0.16, 9)
    leader_top = Vector((0.1, -0.05, 6.2))
    limb(bent(trunk_top, leader_top, 0.0, 4), 0.16, 0.035, 7)
    tips = [(leader_top, 1.0)]
    for k in range(5):
        a = k * 2 * math.pi / 5 + rnd.uniform(-0.3, 0.3)
        h = rnd.uniform(2.3, 3.6)
        start = Vector((0, 0, h)) + lean * (h / 2.5)
        elev = rnd.uniform(0.55, 0.85)
        L = rnd.uniform(2.0, 2.7)
        end = start + Vector((math.cos(a) * math.cos(elev), math.sin(a) * math.cos(elev), math.sin(elev))) * L
        pts = bent(start, end, -0.25, 4)
        limb(pts, 0.1, 0.03, 6)
        tips.append((end, 1.0))
        for j in range(3):
            t = rnd.uniform(0.45, 0.85)
            s0 = Vector(pts[0]) + (Vector(pts[-1]) - Vector(pts[0])) * t
            a2 = a + rnd.uniform(-1.1, 1.1)
            e2 = s0 + Vector((math.cos(a2), math.sin(a2), rnd.uniform(0.3, 0.9))).normalized() * rnd.uniform(0.9, 1.4)
            limb(bent(s0, e2, -0.08, 3), 0.04, 0.012, 5)
            tips.append((e2, 0.75))
    for p, w in tips:
        cluster(p, int(16 * w) + 6, 0.55 * w + 0.2, 1.05)
    # fill the crown's middle so it reads as one mass
    for _ in range(5):
        cluster(Vector((rnd.uniform(-1.2, 1.2), rnd.uniform(-1.2, 1.2), rnd.uniform(3.8, 5.6))), 12, 0.6, 1.1)

    # foliage is lit as one rounded mass: every card's normals point out from the crown's centre
    crown = Vector((0.05, 0, 4.6))
    fol_normals = [((v.co - crown) * Vector((1, 1, 1.4))).normalized() for v in foliage.verts]
    for bm, name, m in ((wood, 'wood', bark), (foliage, 'foliage', leaves)):
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        if name == 'foliage':
            me.normals_split_custom_set_from_vertices(fol_normals)
        o = bpy.data.objects.new(name, me)
        o.data.materials.append(m)
        bpy.context.scene.collection.objects.link(o)
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/tree.glb', export_format='GLB', export_yup=True)


tree()
print('ok')
