"""Retargets CMU motion capture (public BVH conversion, free for any use) onto the game's
17-bone human and writes public/assets/anim/clips.json.

    python tools/build_anims.py <bvh cache dir> public/assets/human/body.json public/assets/anim

BVH files are fetched from github.com/una-dinosauria/cmu-mocap (B. Hahne's conversion of the
CMU Graphics Lab Motion Capture Database) into the cache dir if missing.

Method: forward kinematics on the capture gives every joint's world rotation per frame. Frame 0
is a T-pose, so D(t) = W(t) W(0)^-1 is the change of each joint from the T-pose. Our skeleton's
rest pose has the arms down, so each bone gets an alignment A that turns its rest direction into
the capture's T-pose direction; its world rotation is then D(t) A and its local rotation follows
from its parent. Loops are cut at the two most similar poses one cycle apart and cross-faded.
"""
import json
import math
import os
import sys
import urllib.request

import numpy as np

CACHE, BODY, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
SRC = 'https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data'
FPS = 30

# our bone -> (capture joint, capture child joint used for the bone's direction)
MAP = {
    'hips': ('Hips', 'Spine'),  # LowerBack sits on the hips (zero offset)
    'spine': ('Spine', 'Spine1'),
    'chest': ('Spine1', 'Neck1'),  # Neck sits on Spine1 (zero offset)
    'neck': ('Neck', 'Head'),
    'head': ('Head', None),
    'armL': ('LeftArm', 'LeftForeArm'), 'foreL': ('LeftForeArm', 'LeftHand'), 'handL': ('LeftHand', 'LeftHandIndex1'),
    'armR': ('RightArm', 'RightForeArm'), 'foreR': ('RightForeArm', 'RightHand'), 'handR': ('RightHand', 'RightHandIndex1'),
    'thighL': ('LeftUpLeg', 'LeftLeg'), 'shinL': ('LeftLeg', 'LeftFoot'), 'footL': ('LeftFoot', 'LeftToeBase'),
    'thighR': ('RightUpLeg', 'RightLeg'), 'shinR': ('RightLeg', 'RightFoot'), 'footR': ('RightFoot', 'RightToeBase'),
}
PARENT = {'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck', 'armL': 'chest', 'foreL': 'armL', 'handL': 'foreL',
          'armR': 'chest', 'foreR': 'armR', 'handR': 'foreR', 'thighL': 'hips', 'shinL': 'thighL', 'footL': 'shinL',
          'thighR': 'hips', 'shinR': 'thighR', 'footR': 'shinR'}
OUR_CHILD = {'hips': 'spine', 'spine': 'chest', 'chest': 'neck', 'neck': 'head', 'armL': 'foreL', 'foreL': 'handL', 'armR': 'foreR',
             'foreR': 'handR', 'thighL': 'shinL', 'shinL': 'footL', 'thighR': 'shinR', 'shinR': 'footR'}

# clip name -> capture, time window (s), loop?, kind
CLIPS = {
    'walk': ('08_01', None, True, 'cycle', (0.9, 1.4)),
    'run': ('09_01', None, True, 'cycle', (0.55, 0.85)),
    'idle': ('40_10', (6.0, 20.0), True, 'free', (5.0, 9.0)),
    'carry_walk': ('69_69', None, True, 'cycle', (0.9, 1.5)),
    'pickup': ('69_70', None, True, 'pick', None),
    'sit': ('13_05', None, True, 'seated', (3.0, 6.0)),
    'mop': ('14_13', (3.0, 25.0), True, 'free', (1.2, 2.6)),
    'talk': ('18_08', (2.0, 30.0), True, 'free', (3.0, 6.0)),
    'eat': ('13_09', None, True, 'free', (2.0, 4.0)),
}


# ---------------------------------------------------------------- math
def rot(axis, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    if axis == 'X':
        return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == 'Y':
        return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def align(a, b):
    """minimal rotation matrix taking unit vector a onto unit vector b"""
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c < -0.9999:
        axis = np.cross(a, [1, 0, 0])
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(a, [0, 1, 0])
        axis /= np.linalg.norm(axis)
        return 2 * np.outer(axis, axis) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1 / (1 + c))


def mat2quat(m):
    t = np.trace(m)
    if t > 0:
        s = math.sqrt(t + 1) * 2
        w, x, y, z = 0.25 * s, (m[2, 1] - m[1, 2]) / s, (m[0, 2] - m[2, 0]) / s, (m[1, 0] - m[0, 1]) / s
    elif m[0, 0] > m[1, 1] and m[0, 0] > m[2, 2]:
        s = math.sqrt(1 + m[0, 0] - m[1, 1] - m[2, 2]) * 2
        w, x, y, z = (m[2, 1] - m[1, 2]) / s, 0.25 * s, (m[0, 1] + m[1, 0]) / s, (m[0, 2] + m[2, 0]) / s
    elif m[1, 1] > m[2, 2]:
        s = math.sqrt(1 + m[1, 1] - m[0, 0] - m[2, 2]) * 2
        w, x, y, z = (m[0, 2] - m[2, 0]) / s, (m[0, 1] + m[1, 0]) / s, 0.25 * s, (m[1, 2] + m[2, 1]) / s
    else:
        s = math.sqrt(1 + m[2, 2] - m[0, 0] - m[1, 1]) * 2
        w, x, y, z = (m[1, 0] - m[0, 1]) / s, (m[0, 2] + m[2, 0]) / s, (m[1, 2] + m[2, 1]) / s, 0.25 * s
    q = np.array([x, y, z, w])
    return q / np.linalg.norm(q)


def slerp(a, b, t):
    d = float(np.dot(a, b))
    if d < 0:
        b, d = -b, -d
    if d > 0.9995:
        r = a + (b - a) * t
        return r / np.linalg.norm(r)
    th = math.acos(d)
    return (math.sin((1 - t) * th) * a + math.sin(t * th) * b) / math.sin(th)


# ---------------------------------------------------------------- BVH
def load_bvh(path):
    toks = open(path).read().split()
    i = 0
    joints, stack, order = {}, [], []
    cur = None
    while toks[i] != 'MOTION':
        t = toks[i]
        if t in ('ROOT', 'JOINT'):
            name = toks[i + 1]
            joints[name] = {'parent': stack[-1] if stack else None, 'offset': None, 'channels': [], 'children': []}
            if stack:
                joints[stack[-1]]['children'].append(name)
            order.append(name)
            cur = name
            i += 2
        elif t == 'End':
            cur = None
            i += 2
        elif t == '{':
            stack.append(cur)
            i += 1
        elif t == '}':
            stack.pop()
            i += 1
        elif t == 'OFFSET':
            if cur is not None and joints[cur]['offset'] is None:
                joints[cur]['offset'] = np.array([float(x) for x in toks[i + 1:i + 4]])
            i += 4
        elif t == 'CHANNELS':
            n = int(toks[i + 1])
            joints[cur]['channels'] = toks[i + 2:i + 2 + n]
            i += 2 + n
        else:
            i += 1
    nframes = int(toks[i + 2])
    ft = float(toks[i + 5])
    data = np.array([float(x) for x in toks[i + 6:]]).reshape(nframes, -1)
    return joints, order, data, ft


def fk(joints, order, data):
    """world rotation matrices and positions for every joint and frame"""
    nf = data.shape[0]
    W = {j: np.zeros((nf, 3, 3)) for j in order}
    P = {j: np.zeros((nf, 3)) for j in order}
    col = 0
    cols = {}
    for j in order:
        cols[j] = col
        col += len(joints[j]['channels'])
    for f in range(nf):
        row = data[f]
        for j in order:
            J = joints[j]
            c = cols[j]
            R = np.eye(3)
            pos = J['offset'].copy()
            for k, ch in enumerate(J['channels']):
                v = row[c + k]
                if ch.endswith('position'):
                    pos['XYZ'.index(ch[0])] = v
                else:
                    R = R @ rot(ch[0], v)
            if J['parent'] is None:
                W[j][f] = R
                P[j][f] = pos
            else:
                pa = J['parent']
                W[j][f] = W[pa][f] @ R
                P[j][f] = P[pa][f] + W[pa][f] @ J['offset']
    return W, P


# ---------------------------------------------------------------- retarget
def our_rest_dirs(body):
    J = {k: np.array(v) for k, v in body['joints'].items()}
    d = {}
    for b, c in OUR_CHILD.items():
        d[b] = J[c] - J[b]
    d['head'] = np.array([0, 1.0, 0])
    d['handL'] = J['handL'] - J['foreL']
    d['handR'] = J['handR'] - J['foreR']
    d['footL'] = np.array([0, -0.35, 1.0])
    d['footR'] = np.array([0, -0.35, 1.0])
    return d


def retarget(path, body):
    joints, order, data, ft = load_bvh(path)
    W, P = fk(joints, order, data)
    nf = data.shape[0]
    ours = our_rest_dirs(body)
    A = {}
    for b, (j, c) in MAP.items():
        if c is None:
            # head: capture T-pose direction from neck to head continues upwards
            dcap = P['Head'][0] - P['Neck1'][0]
        else:
            dcap = P[c][0] - P[j][0]
        if np.linalg.norm(dcap) < 1e-6:
            raise SystemExit(f'zero-length capture bone for {b}: {j} -> {c}')
        A[b] = align(ours[b], dcap)
    world = {b: np.einsum('fij,jk->fik', np.einsum('fij,kj->fik', W[j], W[j][0]), A[b]) for b, (j, c) in MAP.items()}
    hips = P['Hips'].copy()
    return world, hips, 1.0 / ft, nf


def face_forward(world, hips, travel):
    """rotate the whole take so the subject travels (or faces) along +Z"""
    if travel:
        d = hips[-1] - hips[0]
    else:
        f = world['hips'][len(hips) // 2] @ np.array([0, 0, 1.0])
        d = f
    yaw = math.atan2(d[0], d[2])
    R = rot('Y', -math.degrees(yaw))
    for b in world:
        world[b] = np.einsum('ij,fjk->fik', R, world[b])
    return (R @ hips.T).T


def locals_from_world(world):
    out = {}
    for b, Wb in world.items():
        pa = PARENT.get(b)
        if pa is None:
            out[b] = Wb
        else:
            out[b] = np.einsum('fji,fjk->fik', world[pa], Wb)
    return out


def resample(seq, src_fps, t0, t1):
    n = max(2, int(round((t1 - t0) * FPS)) + 1)
    times = np.linspace(t0, t1, n)
    return [seq[min(len(seq) - 1, int(round(t * src_fps)))] for t in times], times - t0


def pose_dist(L, i, j, bones=('thighL', 'thighR', 'shinL', 'shinR', 'armL', 'armR', 'spine', 'hips')):
    return sum(np.linalg.norm(L[b][i] - L[b][j]) for b in bones)


def build_clip(name, spec, body):
    take, window, loop, kind, cyc = spec
    path = os.path.join(CACHE, f'{take}.bvh')
    if not os.path.exists(path):
        urllib.request.urlretrieve(f'{SRC}/{take[:2].zfill(3)}/{take}.bvh', path)
    world, hips, fps, nf = retarget(path, body)
    # skip the T-pose frame and settle-in frames
    first = int(0.25 * fps)
    lo, hi = first, nf - 1
    if window:
        lo, hi = max(first, int(window[0] * fps)), min(nf - 1, int(window[1] * fps))
    travel = kind in ('cycle',)
    hips = face_forward(world, hips, travel)
    L = locals_from_world(world)
    stand_y = hips[0, 1]  # T-pose hip height = standing
    if kind == 'pick':
        # centre a 2.4 s window on the deepest crouch
        k = lo + int(np.argmin(hips[lo:hi, 1]))
        a, b = max(lo, k - int(1.2 * fps)), min(hi, k + int(1.2 * fps))
    elif kind == 'seated':
        # longest stretch with the hips low and still
        low = hips[:, 1] < stand_y * 0.62
        best, cur, start, bs = 0, 0, 0, 0
        for f in range(lo, hi):
            if low[f]:
                if cur == 0:
                    start = f
                cur += 1
                if cur > best:
                    best, bs = cur, start
            else:
                cur = 0
        a, b = bs, bs + best - 1
        cycmin, cycmax = cyc
        # most similar pair one 'cycle' apart within the seated stretch
        best_d, pair = 1e9, (a, min(b, a + int(cycmin * fps)))
        step = max(1, int(fps / 15))
        for i in range(a, b, step):
            for j in range(i + int(cycmin * fps), min(b, i + int(cycmax * fps)), step):
                d = pose_dist(L, i, j)
                if d < best_d:
                    best_d, pair = d, (i, j)
        a, b = pair
    else:
        cycmin, cycmax = cyc
        best_d, pair = 1e9, (lo, min(hi, lo + int(cycmin * fps)))
        step = max(1, int(fps / 30))
        # locomotion: only cut where the subject is really walking (hips moving steadily)
        vel = np.zeros(nf)
        w = int(0.25 * fps)
        for f in range(w, nf - w):
            vel[f] = np.hypot(*(hips[f + w] - hips[f - w])[[0, 2]]) / (2 * w / fps)
        moving = vel > (0.6 * vel[lo:hi].max() if kind == 'cycle' else -1)
        for i in range(lo, hi, step):
            if not moving[i]:
                continue
            for j in range(i + int(cycmin * fps), min(hi, i + int(cycmax * fps)), step):
                if not moving[j]:
                    continue
                d = pose_dist(L, i, j)
                if d < best_d:
                    best_d, pair = d, (i, j)
        a, b = pair
    t0, t1 = a / fps, b / fps
    quats = {}
    for bn in MAP:
        seq = [mat2quat(m) for m in L[bn]]
        # keep the quaternion sign continuous
        for k in range(1, len(seq)):
            if np.dot(seq[k], seq[k - 1]) < 0:
                seq[k] = -seq[k]
        r, times = resample(seq, fps, t0, t1)
        quats[bn] = r
    hp, _ = resample(list(hips), fps, t0, t1)
    hp = np.array(hp)
    # in place: remove travel; keep sway. Heights scale to the game's 0.95 m standing hip
    trend = np.linspace(hp[0], hp[-1], len(hp)) if travel else np.repeat(hp[:1], len(hp), axis=0)
    sway = hp - trend
    scale = 0.95 / stand_y
    hipsPos = [[float(s[0] * scale), float(0.95 * h[1] / stand_y), float(s[2] * scale)] for s, h in zip(sway, hp)]
    if kind != 'cycle':
        for v in hipsPos:
            v[0] *= 0.3
            v[2] *= 0.3
    n = len(times)
    if loop:
        # cross-fade the last 20% into the first frames so the loop is seamless
        k = max(2, n // 5)
        for bn in quats:
            q0 = quats[bn][0]
            for i in range(k):
                t = (i + 1) / k
                quats[bn][n - k + i] = slerp(quats[bn][n - k + i], q0, t * t * (3 - 2 * t))
        for i in range(k):
            t = (i + 1) / k
            for c in range(3):
                hipsPos[n - k + i][c] = hipsPos[n - k + i][c] * (1 - t) + hipsPos[0][c] * t
    speed = float(np.hypot(hp[-1][0] - hp[0][0], hp[-1][2] - hp[0][2]) * scale / max(1e-6, times[-1])) if travel else 0.0
    return {
        'source': f'CMU motion capture {take}',
        'speed': round(speed, 3),
        'dur': float(times[-1]),
        'times': [round(float(t), 4) for t in times],
        'bones': {bn: [round(float(x), 5) for q in v for x in q] for bn, v in quats.items()},
        'hips': [round(x, 5) for v in hipsPos for x in v],
    }


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    body = json.load(open(BODY))
    if isinstance(body.get('joints'), str):
        import ast
        body['joints'] = ast.literal_eval(body['joints'])
    clips = {}
    for name, spec in CLIPS.items():
        clips[name] = build_clip(name, spec, body)
        print(name, 'from', spec[0], f"{clips[name]['dur']:.2f}s", len(clips[name]['times']), 'frames', 'speed', clips[name]['speed'])
    json.dump({'fps': FPS, 'license': 'CMU Graphics Lab Motion Capture Database: no restrictions on use', 'clips': clips}, open(os.path.join(OUT, 'clips.json'), 'w'), separators=(',', ':'))


main()
