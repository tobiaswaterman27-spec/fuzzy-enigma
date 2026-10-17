"""Builds the game's realistic human asset from MakeHuman CC0 data.

Inputs (downloaded from github.com/makehumancommunity/makehuman, CC0):
  base.obj, default.mhskel, default_weights.mhw, targets/*.target
Output:
  public/assets/human/body.json  - metadata (counts, joints, morph names, regions)
  public/assets/human/body.bin   - packed binary arrays (see LAYOUT in body.json)
  public/assets/human/skin_masks.png - feature masks in MakeHuman UV space

Pipeline: parse mesh -> remap 163 MakeHuman bones onto the game's 17 bones ->
re-pose from MakeHuman's A-pose to the game's arms-down rest pose with linear
blend skinning (for the base mesh and every morph target) -> quantise deltas.
"""
import json, math, os, struct, sys
import numpy as np

SRC = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)

BONES = ['hips', 'spine', 'chest', 'neck', 'head', 'armL', 'foreL', 'handL', 'armR', 'foreR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']
BI = {b: i for i, b in enumerate(BONES)}
PARENT = {'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck', 'armL': 'chest', 'foreL': 'armL', 'handL': 'foreL', 'armR': 'chest', 'foreR': 'armR', 'handR': 'foreR',
          'thighL': 'hips', 'shinL': 'thighL', 'footL': 'shinL', 'thighR': 'hips', 'shinR': 'thighR', 'footR': 'shinR'}

# MakeHuman bone -> game bone (anything not listed inherits from its nearest mapped ancestor)
DIRECT = {
    'root': 'hips', 'pelvis.L': 'hips', 'pelvis.R': 'hips', 'spine05': 'hips',
    'spine04': 'spine', 'spine03': 'spine',
    'spine02': 'chest', 'spine01': 'chest', 'breast.L': 'chest', 'breast.R': 'chest', 'clavicle.L': 'chest', 'clavicle.R': 'chest',
    'neck01': 'neck', 'neck02': 'neck', 'neck03': 'neck', 'head': 'head',
    'shoulder01.L': 'armL', 'upperarm01.L': 'armL', 'upperarm02.L': 'armL', 'lowerarm01.L': 'foreL', 'lowerarm02.L': 'foreL', 'wrist.L': 'handL',
    'shoulder01.R': 'armR', 'upperarm01.R': 'armR', 'upperarm02.R': 'armR', 'lowerarm01.R': 'foreR', 'lowerarm02.R': 'foreR', 'wrist.R': 'handR',
    'upperleg01.L': 'thighL', 'upperleg02.L': 'thighL', 'lowerleg01.L': 'shinL', 'lowerleg02.L': 'shinL', 'foot.L': 'footL',
    'upperleg01.R': 'thighR', 'upperleg02.R': 'thighR', 'lowerleg01.R': 'shinR', 'lowerleg02.R': 'shinR', 'foot.R': 'footR',
}
# game joint = head of this MakeHuman bone
JOINT_OF = {'hips': 'root', 'spine': 'spine04', 'chest': 'spine02', 'neck': 'neck01', 'head': 'head',
            'armL': 'upperarm01.L', 'foreL': 'lowerarm01.L', 'handL': 'wrist.L', 'armR': 'upperarm01.R', 'foreR': 'lowerarm01.R', 'handR': 'wrist.R',
            'thighL': 'upperleg01.L', 'shinL': 'lowerleg01.L', 'footL': 'foot.L', 'thighR': 'upperleg01.R', 'shinR': 'lowerleg01.R', 'footR': 'foot.R'}

# ------------------------------------------------------------------ parse obj
V, VT, faces = [], [], []
group = None
with open(os.path.join(SRC, 'base.obj')) as fh:
    for line in fh:
        if line.startswith('v '):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith('vt '):
            VT.append([float(x) for x in line.split()[1:3]])
        elif line.startswith('g '):
            group = line.split()[1]
        elif line.startswith('f '):
            idx = [p.split('/') for p in line.split()[1:]]
            faces.append((group, [int(a[0]) - 1 for a in idx], [int(a[1]) - 1 for a in idx]))
V = np.array(V, dtype=np.float64)
VT = np.array(VT, dtype=np.float64)
print('vertices', len(V), 'uvs', len(VT), 'faces', len(faces))

skel = json.load(open(os.path.join(SRC, 'default.mhskel')))
joint_lists = skel['joints']
weights_mh = json.load(open(os.path.join(SRC, 'default_weights.mhw')))['weights']

def game_bone(mh):
    b = mh
    while b is not None:
        if b in DIRECT:
            return DIRECT[b]
        b = skel['bones'][b]['parent'] if b in skel['bones'] else None
    return 'hips'

# per-vertex weights onto the 17 game bones
W = np.zeros((len(V), len(BONES)))
for mh, lst in weights_mh.items():
    gb = BI[game_bone(mh)]
    for vi, w in lst:
        W[vi, gb] += w
s = W.sum(1, keepdims=True)
s[s == 0] = 1
W /= s
none = W.sum(1) == 0
W[none, BI['hips']] = 1

def joints_of(Vx):
    J = {}
    for b, mh in JOINT_OF.items():
        J[b] = Vx[joint_lists[skel['bones'][mh]['head']]].mean(0)
    return J

# eye centres for eyeballs (from the helper eye meshes)
eye_groups = {g: sorted({v for (gg, vs, _) in faces if gg == g for v in vs}) for g in ('helper-l-eye', 'helper-r-eye')}

# ------------------------------------------------------------------ posing
def rot_align(a, b):
    a = a / np.linalg.norm(a); b = b / np.linalg.norm(b)
    v = np.cross(a, b); c = float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1 / (1 + c))

def pose(Vx):
    """Linear-blend-skin MakeHuman's A-pose into the game's rest pose (limbs hanging straight)."""
    J = joints_of(Vx)
    G = {b: (np.eye(3), np.zeros(3)) for b in BONES}  # global (R, t): p' = R p + t
    def compose(parent, R_local, pivot):
        Rp, tp = G[parent]
        # rotate about pivot (in already-transformed space of the parent)
        piv = Rp @ pivot + tp
        R = R_local @ Rp
        t = R_local @ (tp - piv) + piv
        return R, t
    def place(Jt):
        return {b: G[b][0] @ Jt[b] + G[b][1] for b in BONES}
    for side, sx in (('L', 1), ('R', -1)):
        arm, fore, hand = 'arm' + side, 'fore' + side, 'hand' + side
        # upper arm: hang down with a slight outward angle
        P = place(J)
        d = P[fore] - P[arm]
        G[arm] = compose('chest', rot_align(d, np.array([sx * 0.06, -1, -0.01])), J[arm])
        P = {b: G[arm][0] @ J[b] + G[arm][1] for b in BONES}
        d = P[hand] - P[fore]
        G[fore] = compose(arm, rot_align(d, np.array([sx * 0.02, -1, 0.06])), J[fore])
        G[hand] = G[fore]
        th, sh, ft = 'thigh' + side, 'shin' + side, 'foot' + side
        d = J[sh] - J[th]
        G[th] = compose('hips', rot_align(d, np.array([sx * 0.015, -1, 0.0])), J[th])
        Psh = G[th][0] @ J[sh] + G[th][1]
        Pft = G[th][0] @ J[ft] + G[th][1]
        G[sh] = compose(th, rot_align(Pft - Psh, np.array([sx * 0.005, -1, -0.015])), J[sh])
        G[ft] = G[sh]
    out = np.zeros_like(Vx)
    for b in BONES:
        R, t = G[b]
        out += W[:, BI[b]:BI[b] + 1] * (Vx @ R.T + t)
    Jp = {b: G[b][0] @ J[b] + G[b][1] for b in BONES}
    # child joints live in the parent's moved frame: recompute from the hierarchy
    for b in BONES:
        p = PARENT.get(b)
        if p:
            Jp[b] = G[p][0] @ J[b] + G[p][1]
    eyes = []
    for g in ('helper-l-eye', 'helper-r-eye'):
        pts = Vx[eye_groups[g]]
        R, t = G['head']
        c = pts.mean(0)
        eyes.append((R @ c + t, float(np.linalg.norm(pts - c, axis=1).mean())))
    return out, Jp, eyes

# ------------------------------------------------------------------ targets
TARGETS = [
    'african-male-young', 'african-female-young', 'asian-male-young', 'asian-female-young', 'caucasian-male-young', 'caucasian-female-young',
    'universal-male-young-maxmuscle-averageweight', 'universal-male-young-minmuscle-averageweight', 'universal-male-young-averagemuscle-maxweight', 'universal-male-young-averagemuscle-minweight',
    'universal-female-young-maxmuscle-averageweight', 'universal-female-young-minmuscle-averageweight', 'universal-female-young-averagemuscle-maxweight', 'universal-female-young-averagemuscle-minweight',
    'height-male-maxheight', 'height-male-minheight', 'height-female-maxheight', 'height-female-minheight', 'prop-male', 'prop-female',
]

def load_target(name):
    D = np.zeros_like(V)
    with open(os.path.join(SRC, 'targets', name + '.target')) as fh:
        for line in fh:
            if line.startswith('#') or not line.strip():
                continue
            p = line.split()
            D[int(p[0])] = [float(p[1]), float(p[2]), float(p[3])]
    return D

# neutral reference = average of the six ethnic/gender shapes (MakeHuman's default 50/50 mix)
ethnic = [load_target(t) for t in TARGETS[:6]]
neutral_delta = sum(ethnic) / 6.0
V0 = V + neutral_delta

SCALE = 0.1  # MakeHuman works in decimetres
posed0, J0, eyes0 = pose(V0)
ground = posed0[[i for (g, vs, _) in faces if g == 'body' for i in vs]][:, 1].min()
def to_m(P):
    Q = (P - np.array([0, ground, 0])) * SCALE
    return Q

base = to_m(posed0)
jbase = {b: to_m(J0[b][None])[0] for b in BONES}
eyes_base = [(to_m(c[None])[0].tolist(), r * SCALE) for c, r in eyes0]
print('height', base[:, 1].max(), 'hips', jbase['hips'], 'shoulder', jbase['armL'], 'wrist', jbase['handL'])

deltas = []
jdeltas = []
eyedeltas = []
for i, name in enumerate(TARGETS):
    T = ethnic[i] if i < 6 else load_target(name)
    # ethnic targets are blended relative to the neutral mix
    Vt = V + (T if i < 6 else neutral_delta + T)
    posed, Jt, eyes = pose(Vt)
    P = to_m(posed)
    deltas.append(P - base)
    jdeltas.append({b: (to_m(Jt[b][None])[0] - jbase[b]).tolist() for b in BONES})
    eyedeltas.append([(to_m(c[None])[0] - np.array(eyes_base[k][0])).tolist() for k, (c, r) in enumerate(eyes)])
    print('target', name, 'max delta', float(np.abs(P - base).max()))

# ------------------------------------------------------------------ render vertices (split at UV seams)
INCLUDE = {'body'} | {g for (g, _, _) in faces if g.startswith('helper-') and 'eyelashes' in g}
key_index = {}
orig = []
uvs = []
tris = []
tri_group = []
for g, vs, ts in faces:
    if g not in INCLUDE:
        continue
    ids = []
    for v, t in zip(vs, ts):
        k = (v, t)
        if k not in key_index:
            key_index[k] = len(orig)
            orig.append(v)
            uvs.append(VT[t])
        ids.append(key_index[k])
    for a in range(1, len(ids) - 1):
        tris.append((ids[0], ids[a], ids[a + 1]))
        tri_group.append(0 if g == 'body' else 1)
orig = np.array(orig)
uvs = np.array(uvs)
tris = np.array(tris, dtype=np.uint32)
nV = len(orig)
print('render vertices', nV, 'triangles', len(tris))

# skin weights: top 4 per vertex
Wv = W[orig]
top = np.argsort(-Wv, axis=1)[:, :4]
topw = np.take_along_axis(Wv, top, 1)
topw /= topw.sum(1, keepdims=True)

# body regions per triangle (used to hide skin under clothing)
REGIONS = ['head', 'neck', 'torso_upper', 'torso_lower', 'arm_upper', 'arm_lower', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'lash']
P = base[orig]
def region_of(tri, grp):
    if grp == 1:
        return REGIONS.index('lash')
    w = Wv[list(tri)].sum(0)
    b = BONES[int(np.argmax(w))]
    c = P[list(tri)].mean(0)
    if b == 'head':
        return 0
    if b == 'neck':
        return 1
    if b in ('chest', 'spine'):
        return 2 if c[1] > jbase['spine'][1] + 0.05 else 3
    if b == 'hips':
        return 3
    if b in ('armL', 'armR'):
        sh = jbase['armL' if b == 'armL' else 'armR']
        el = jbase['foreL' if b == 'armL' else 'foreR']
        t = (sh[1] - c[1]) / max(1e-6, sh[1] - el[1])
        return 4 if t < 0.5 else 5
    if b in ('foreL', 'foreR'):
        return 6
    if b in ('handL', 'handR'):
        return 7
    if b in ('thighL', 'thighR'):
        return 8
    if b in ('shinL', 'shinR'):
        return 9 if c[1] > 0.12 else 10
    return 10
region = np.array([region_of(t, g) for t, g in zip(tris, tri_group)], dtype=np.uint8)
print('regions', {REGIONS[i]: int((region == i).sum()) for i in range(len(REGIONS))})

# ------------------------------------------------------------------ face feature masks (lips, brows, nails, cheeks)
lips_mh = {'oris01', 'oris02', 'oris03.L', 'oris03.R', 'oris04.L', 'oris04.R', 'oris05', 'oris06', 'oris06.L', 'oris06.R', 'oris07.L', 'oris07.R'}
lipw = np.zeros(len(V))
for mh in lips_mh:
    for vi, w in weights_mh.get(mh, []):
        lipw[vi] += w
mouth = V0[joint_lists['oris01____head'] if 'oris01____head' in joint_lists else joint_lists[skel['bones']['oris01']['head']]].mean(0)
dist_mouth = np.linalg.norm(V0 - mouth, axis=1)
lip_mask = np.clip((lipw - 0.35) * 2.2, 0, 1) * (dist_mouth < 0.55)
eyeL = V0[eye_groups['helper-l-eye']].mean(0); eyeR = V0[eye_groups['helper-r-eye']].mean(0)
brow = np.zeros(len(V))
for e in (eyeL, eyeR):
    d = V0 - e
    band = np.exp(-((d[:, 1] - 0.27) / 0.075) ** 2) * np.exp(-(d[:, 0] / 0.33) ** 2) * (d[:, 2] > 0.0)
    brow = np.maximum(brow, band * (W[:, BI['head']] > 0.9))
brow = np.clip(brow * 1.4 - 0.25, 0, 1)
nails = np.zeros(len(V))
for side in ('L', 'R'):
    for f in range(1, 6):
        for vi, w in weights_mh.get(f'finger{f}-3.{side}', []):
            nails[vi] = max(nails[vi], w)
cheek = np.zeros(len(V))
for e in (eyeL, eyeR):
    d = V0 - e
    cheek = np.maximum(cheek, np.exp(-((d[:, 1] + 0.35) ** 2 + (d[:, 0] * 0.8) ** 2) / 0.05) * (d[:, 2] > -0.2) * (W[:, BI['head']] > 0.9))

try:
    from PIL import Image, ImageDraw, ImageFilter
    S = 2048
    imgs = [Image.new('L', (S, S), 0) for _ in range(4)]
    draws = [ImageDraw.Draw(im) for im in imgs]
    feats = [brow, lip_mask, nails, cheek]
    for (a, b, c), g in zip(tris, tri_group):
        if g:
            continue
        poly = [(uvs[i][0] * S, (1 - uvs[i][1]) * S) for i in (a, b, c)]
        for k in range(4):
            val = feats[k][orig[[a, b, c]]].mean()
            if val > 0.02:
                draws[k].polygon(poly, fill=int(min(255, val * 255)))
    imgs = [im.filter(ImageFilter.GaussianBlur(3)) for im in imgs]
    rgba = Image.merge('RGBA', imgs)
    rgba.save(os.path.join(OUT, 'skin_masks.png'))
    print('wrote skin masks')
except ImportError:
    print('PIL missing: skipping masks')

# ------------------------------------------------------------------ write binary
def q16(arr, scale):
    return np.clip(np.round(arr / scale), -32767, 32767).astype(np.int16)

layout = []
blob = bytearray()
def put(name, arr):
    arr = np.ascontiguousarray(arr)
    while len(blob) % 4:
        blob.append(0)
    layout.append({'name': name, 'offset': len(blob), 'dtype': str(arr.dtype), 'count': int(arr.size)})
    blob.extend(arr.tobytes())

POS_Q = 1 / 8192  # ~0.12 mm
put('position', base[orig].astype(np.float32))
put('uv', uvs.astype(np.float32))
put('index', tris.reshape(-1))
put('region', region)
put('skinIndex', top.astype(np.uint8))
put('skinWeight', (topw * 255).round().astype(np.uint8))
put('origIndex', orig.astype(np.uint32))
for i, name in enumerate(TARGETS):
    put('morph:' + name, q16(deltas[i][orig], POS_Q))
with open(os.path.join(OUT, 'body.bin'), 'wb') as fh:
    fh.write(blob)
meta = {
    'source': 'MakeHuman (CC0) base mesh, targets and default rig weights, re-posed and remapped for THE BIGSHOT',
    'vertexCount': nV, 'triangleCount': int(len(tris)), 'bones': BONES, 'regions': REGIONS, 'morphs': TARGETS, 'morphScale': POS_Q,
    'joints': {b: jbase[b].tolist() for b in BONES}, 'jointDeltas': jdeltas,
    'eyes': eyes_base, 'eyeDeltas': eyedeltas, 'layout': layout,
}
json.dump(meta, open(os.path.join(OUT, 'body.json'), 'w'))
print('wrote', len(blob) // 1024, 'KB')
